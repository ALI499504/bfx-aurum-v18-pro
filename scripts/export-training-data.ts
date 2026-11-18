// ============================================================
// تصدير مجموعة تدريب حقيقية من شموع MT5 الحقيقية
// ------------------------------------------------------------
// يقرأ db/mt5-feed-snapshot.json (شموع MT5 حقيقية من وسيط المستخدم)
// ويكتب dataset JSON جاهزاً لتدريب LightGBM.
//
// المبدأ الحاكم: المتجهات تُحسب بدالة computeFeatures() الإنتاجية نفسها
// (src/lib/engine/lightgbm-filter.ts) — لا نسخة ثانية ولا إعادة كتابة.
// أي اختلاف بين التدريب والاستدلال يُفسد النموذج صامتاً، لذا نستدعي
// نفس الكود حرفياً.
//
// التشغيل:  bun run scripts/export-training-data.ts
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { computeFeatures, FEATURE_NAMES, rsiSeries } from '../src/lib/engine/lightgbm-filter';
import { analyzeStructure } from '../src/lib/engine/structure';
import {
  atr, sma, emaSeries, bollinger, stochK, viabilityRatio,
  adx as computeAdx, macd as computeMacd, cci as computeCci,
} from '../src/lib/engine/indicators';
import type { Candle, Dir } from '../src/lib/engine/types';

const SNAPSHOT = path.join(process.cwd(), 'db', 'mt5-feed-snapshot.json');
const OUT_DIR = path.join(process.cwd(), 'db');
const OUT = path.join(OUT_DIR, 'training-dataset.json');

/** عتبة التصنيف: عائد يتجاوز هذه النسبة من ATR يُعد اتجاهاً */
const LABEL_ATR_MULT = 0.5;
/** أدنى عدد شموع 1h تاريخية قبل بدء أخذ العينات (إحماء المؤشرات) */
const WARMUP = 210;

type Row = [number, number, number, number, number, number];

function toRows(raw: unknown[]): Candle[] {
  const out: Candle[] = [];
  for (const r of raw) {
    let t: number, o: number, h: number, l: number, c: number, v: number;
    if (Array.isArray(r)) {
      [t, o, h, l, c, v] = r as Row;
    } else if (r && typeof r === 'object') {
      const o2 = r as Record<string, number>;
      t = o2.t; o = o2.o; h = o2.h; l = o2.l; c = o2.c; v = o2.v ?? 0;
    } else continue;
    if (![t, o, h, l, c].every(Number.isFinite)) continue;
    if (!(h >= l && h >= o && h >= c && l <= o && l <= c && c > 0)) continue;
    out.push({ t, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** اتجاه الهيكل عند لحظة زمنية — مطابق لدلالة trendAt في المحرك */
function trendAt(timeline: { t: number; trend: Dir }[], t: number): Dir {
  let d: Dir = 'range';
  for (const e of timeline) { if (e.t <= t) d = e.trend; else break; }
  return d;
}

/** تجميع شموع 1h إلى فريم أعلى (4h = 4 شموع، 1d = 24 شمعة) */
function aggregate(c: Candle[], factor: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + factor <= c.length; i += factor) {
    const slice = c.slice(i, i + factor);
    out.push({
      t: slice[0].t,
      o: slice[0].o,
      h: Math.max(...slice.map(x => x.h)),
      l: Math.min(...slice.map(x => x.l)),
      c: slice[slice.length - 1].c,
      v: slice.reduce((s, x) => s + x.v, 0),
    });
  }
  return out;
}

/**
 * التسمية: هل تحرك السعر في الشمعة التالية خارج عتبة ATR؟
 * up   = العائد ≥ +عتبة
 * down = العائد ≤ −عتبة
 * range = داخل العتبة
 * العتبة نسبية إلى ATR كي تتكيف مع تقلب السوق عبر السنوات.
 */
function labelAt(c: Candle[], idx: number, atrVals: number[]): 0 | 1 | 2 | null {
  if (idx + 1 >= c.length) return null;
  const a = atrVals[idx];
  if (!Number.isFinite(a) || a <= 0) return null;
  const next = c[idx + 1];
  const move = next.c - c[idx].c;
  const th = a * LABEL_ATR_MULT;
  if (move >= th) return 0;   // up
  if (move <= -th) return 1;  // down
  return 2;                    // range
}

function main() {
  if (!fs.existsSync(SNAPSHOT)) {
    console.error(`[export] لقطة MT5 غير موجودة: ${SNAPSHOT}`);
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')) as {
    symbol?: string; broker?: string; tfs?: Record<string, unknown[]>;
  };
  const tfs = snap.tfs ?? {};
  const c1h = toRows(tfs['1h'] ?? []);
  console.log(`[export] الرمز: ${snap.symbol} · الوسيط: ${snap.broker}`);
  console.log(`[export] شموع 1h حقيقية: ${c1h.length}`);
  if (c1h.length < WARMUP + 100) {
    console.error('[export] شموع 1h غير كافية للتدريب');
    process.exit(1);
  }
  const from = new Date(c1h[0].t).toISOString().slice(0, 10);
  const to = new Date(c1h[c1h.length - 1].t).toISOString().slice(0, 10);
  console.log(`[export] المدى الفعلي: ${from} → ${to}`);

  // الهيكل يُحسب مرة واحدة على كامل السلسلة ثم يُقرأ زمنياً (بلا تسريب مستقبلي
  // لأن structureScore يفلتر بـ confirmedAt ≤ لحظة الشمعة)
  const h1 = analyzeStructure(c1h, '1h');
  const c4h = aggregate(c1h, 4);
  const c1d = aggregate(c1h, 24);
  const h4 = analyzeStructure(c4h, '4h');
  const d1 = analyzeStructure(c1d, '1d');

  const atrVals = atr(c1h, 14);

  // المؤشرات تُحسب مرة واحدة على كامل السلسلة — نفس دوال indicators.ts
  // التي يستعملها الاستدلال، فلا ينشأ أي فرق بين التدريب والتشغيل.
  const closes = c1h.map(x => x.c);
  const precomputed = {
    e20s: emaSeries(c1h, 20),
    e50s: emaSeries(c1h, 50),
    e200s: emaSeries(c1h, 200),
    atr14: atrVals,
    atrSma50: sma(atrVals.map(v => (Number.isFinite(v) ? v : 0)), 50),
    volSma20: sma(c1h.map(x => x.v), 20),
    rsi: rsiSeries(closes, 14),
    macd: computeMacd(closes, 12, 26, 9),
    bb: bollinger(closes, 20, 2),
    adx: computeAdx(c1h, 14),
    stoch: stochK(c1h, 14),
    cci: computeCci(c1h, 20),
    viability: viabilityRatio(closes, 20),
  };
  console.log('[export] حُسبت المؤشرات مرة واحدة — جاهز لتوليد العينات');

  const X: number[][] = [];
  const y: number[] = [];
  const ts: number[] = [];

  for (let i = WARMUP; i < c1h.length; i++) {
    const label = labelAt(c1h, i, atrVals);
    if (label === null) continue;
    const now = c1h[i].t;
    const f = computeFeatures({
      c1h,
      idx: i,
      trend1h: trendAt(h1.trendTimeline, now),
      trend4h: trendAt(h4.trendTimeline, now),
      trend1d: trendAt(d1.trendTimeline, now),
      real1h: h1.realPivots,
      precomputed,
    });
    X.push(FEATURE_NAMES.map(k => f[k]));
    y.push(label);
    ts.push(now);
  }

  const dist = [0, 0, 0];
  for (const v of y) dist[v]++;
  console.log(`[export] عينات: ${X.length}`);
  console.log(`[export] التوزيع: up=${dist[0]} down=${dist[1]} range=${dist[2]}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    symbol: snap.symbol ?? 'XAUUSD',
    broker: snap.broker ?? null,
    featureNames: FEATURE_NAMES,
    labelAtrMult: LABEL_ATR_MULT,
    horizon: 1,
    timeframe: '1h',
    rangeFrom: from,
    rangeTo: to,
    n: X.length,
    X, y, ts,
  }));
  console.log(`[export] كُتب: ${OUT}`);
}

main();
