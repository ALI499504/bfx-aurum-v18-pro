// اختبار تكامل: بث MT5 مُصنّع → /api/tamsa → JSON كامل
import { ingestMt5, mt5Feed } from '../src/lib/server/mt5feed';
import { getEngineData } from '../src/lib/server/data';
import { tamsaEngine } from '../src/lib/engine/tamsa-engine';
import { DEFAULT_TAMSA_PARAMS } from '../src/lib/engine/tamsa-params';
import { DEFAULT_SETTINGS } from '../src/lib/engine/rules';
import type { Candle } from '../src/lib/engine/types';

const H = 3600e3;
let fails = 0;
const check = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); if (!c) fails++; };

let seed = 777;
const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
function series(n: number, sp: number, drift: number, vol: number, tf: number, t0: number): Candle[] {
  const out: Candle[] = [];
  const base = (i: number) => sp + drift * i + Math.sin(i / 11) * vol * 6 + Math.sin(i / 3.1) * vol * 0.8;
  for (let i = 0; i < n; i++) {
    const o = base(i - 1) + noise() * vol * 0.6, c = base(i) + noise() * vol * 0.6;
    out.push({
      t: t0 + i * tf, o,
      h: Math.max(o, c) + Math.abs(noise()) * vol * 0.5 + vol * 0.15,
      l: Math.min(o, c) - Math.abs(noise()) * vol * 0.5 - vol * 0.15,
      c, v: 1000 + (i % 7) * 100,
    });
  }
  return out;
}

// الجسر يبث الشموع كصفوف [t, o, h, l, c, v] — التحويل إلزامي
const asRows = (cs: Candle[]) => cs.map(c => [c.t, c.o, c.h, c.l, c.c, c.v]);

const now = Date.UTC(2026, 10, 16, 12, 0, 0);
const c5 = series(3000, 2400, 0.01, 0.9, 300e3, now - 3000 * 300e3);
const c15 = series(1200, 2400, 0.03, 1.0, 900e3, now - 1200 * 900e3);
const c30 = series(700, 2400, 0.05, 1.1, 1800e3, now - 700 * 1800e3);
const c1h = series(700, 2400, 0.09, 1.3, H, now - 700 * H);
const c4h = series(400, 2400, 0.2, 2.0, 4 * H, now - 400 * 4 * H);
const c1d = series(200, 2300, 0.8, 6, 24 * H, now - 200 * 24 * H);
// نحيفظ التواريخ داخل نطاق مقبول (بعد 2000-01-01)
for (const arr of [c5, c15, c30, c1h, c4h, c1d]) {
  if (arr[0].t < 946684800000) throw new Error('نطاق زمني غير صالح للاختبار');
}

// محاكاة بث الجسر
ingestMt5({
  symbol: 'XAUUSD',
  account: { login: '99999', balance: 1000, equity: 1012, profit: 12, currency: 'USD' },
  tfs: {
    '5m': asRows(c5), '15m': asRows(c15), '30m': asRows(c30),
    '1h': asRows(c1h), '4h': asRows(c4h), '1d': asRows(c1d),
  },
  positions: [], deals: [],
} as never);

const feed = mt5Feed();
check('البث: استُقبلت الشموع', Object.keys(feed.tfs).length > 0, `tfs=${Object.keys(feed.tfs).join(',')}`);

const data = getEngineData(0);
check('getEngineData: تُرجع بيانات', !!data, data ? `1h=${data.c1h.length}` : 'null');

if (data) {
  const snap = tamsaEngine.analyze(
    { '5m': data.c5, '15m': data.c15, '30m': data.c30, '1h': data.c1h, '4h': data.c4h, '1d': data.c1d, '1w': data.c1w, '1M': data.c1M },
    DEFAULT_TAMSA_PARAMS, DEFAULT_SETTINGS as never, { dayPnL: 12 },
  );
  check('التكامل: لقطة كاملة', !!snap && snap.structure.h1.realPivots.length > 0, `pivots=${snap.structure.h1.realPivots.length}`);
  check('التكامل: اتجاه مرصود', snap.structure.trend1h !== undefined, `1h=${snap.structure.trend1h} 4h=${snap.structure.trend4h} 1d=${snap.structure.trend1d}`);
  check('التكامل: LightGBM يعمل', !!snap.lightGBM, snap.lightGBM ? `${snap.lightGBM.trend} ${snap.lightGBM.confidence.toFixed(2)}` : 'none');
  check('التكامل: لوت ثابت', snap.risk.lot === 0.01);
  check('التكامل: الملخص نصي', snap.summary.length > 30);
  check('التكامل: JSON قابل للتسلسل', (() => { try { JSON.stringify(snap); return true; } catch { return false; } })());

  // أهم اختبار: هل تُصدر إشارات "حديثة" فعلاً؟
  const fresh = snap.proposals.filter(p => snap.at - p.setup.createdAt <= 24 * 3600e3);
  check('التكامل: المقترحات كلها حديثة (≤24 ساعة)', fresh.length === snap.proposals.length,
    `fresh=${fresh.length}/${snap.proposals.length}`);
  check('التكامل: معدل الحجب معقول', snap.diagnostics.passed <= snap.diagnostics.signalsRaw,
    `raw=${snap.diagnostics.signalsRaw} passed=${snap.diagnostics.passed} stale=${snap.diagnostics.blockedByGate['stale'] ?? 0}`);
  console.log('   summary:', snap.summary.slice(0, 220));
  console.log('   blocked:', JSON.stringify(snap.diagnostics.blockedByGate));
}

console.log(`\n${fails === 0 ? '🎯 اختبار التكامل نجح' : `⚠️ ${fails} اختبار فشل`}`);
process.exit(fails === 0 ? 0 : 1);
