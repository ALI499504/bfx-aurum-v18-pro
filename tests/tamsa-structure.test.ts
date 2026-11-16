// اختبارات صحة بنية المحرك — تحمي إصلاح تكرار المحاور من الانتكاس
import { analyzeStructure, normalizeRealPivots } from '../src/lib/engine/structure';
import { confirm4Points } from '../src/lib/engine/structure';
import type { Candle, RealPivot } from '../src/lib/engine/types';

const H = 3600e3;
let fails = 0;
const check = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); if (!c) fails++; };

let seed = 987654321;
const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };

function series(n: number, sp: number, drift: number, vol: number, tf = H, t0 = Date.UTC(2025, 0, 2)): Candle[] {
  const out: Candle[] = [];
  const base = (i: number) => sp + drift * i + Math.sin(i / 11) * vol * 6 + Math.sin(i / 3.1) * vol * 0.8;
  for (let i = 0; i < n; i++) {
    const o = base(i - 1) + noise() * vol * 0.6, c = base(i) + noise() * vol * 0.6;
    out.push({
      t: t0 + i * tf, o,
      h: Math.max(o, c) + Math.abs(noise()) * vol * 0.5 + vol * 0.15,
      l: Math.min(o, c) - Math.abs(noise()) * vol * 0.5 - vol * 0.15,
      c, v: 1000 + (i % 7) * 120,
    });
  }
  return out;
}

const isHigh = (k: string) => k === 'HH' || k === 'LH';

function auditPivots(name: string, c: Candle[], tf: '1h' | '4h' | '1d') {
  const s = analyzeStructure(c, tf);
  const rp = s.realPivots;

  const seenT = new Set<number>();
  let dupes = 0;
  for (const p of rp) { if (seenT.has(p.t)) dupes++; seenT.add(p.t); }

  let outByT = 0;
  for (let i = 1; i < rp.length; i++) if (rp[i].t < rp[i - 1].t) outByT++;

  let alt = 0;
  for (let i = 1; i < rp.length; i++) if (isHigh(rp[i].kind) !== isHigh(rp[i - 1].kind)) alt++;
  const altRate = rp.length > 1 ? alt / (rp.length - 1) : 1;

  // كل محور يجب أن يكون قمة/قاعاً حقيقياً مقابل جاره
  let notExtreme = 0;
  for (let i = 1; i < rp.length - 1; i++) {
    const p = rp[i], prev = rp[i - 1], next = rp[i + 1];
    const hi = isHigh(p.kind);
    if (hi ? !(p.price > prev.price && p.price > next.price) : !(p.price < prev.price && p.price < next.price)) notExtreme++;
  }

  check(`${name}: صفر تكرار زمني`, dupes === 0, `dupes=${dupes}/${rp.length}`);
  check(`${name}: ترتيب زمني سليم`, outByT === 0, `outOfOrder=${outByT}`);
  check(`${name}: تناوب تعرّج 100%`, altRate === 1, `${(altRate * 100).toFixed(1)}%`);
  check(`${name}: كل محور طرف حقيقي`, notExtreme === 0, `bad=${notExtreme}/${Math.max(0, rp.length - 2)}`);
  return rp;
}

// ---------- 1) ثلاث سلاسل مختلفة ----------
auditPivots('صاعد', series(700, 2000, 0.35, 1.4), '1h');
auditPivots('هابط', series(500, 2600, -0.45, 1.5, H, Date.UTC(2025, 0, 2) + 700 * H), '1h');
auditPivots('عرضي', series(600, 2200, 0.0, 1.6, H, Date.UTC(2025, 0, 2) + 5000 * H), '1h');
auditPivots('مختلط 4H', series(900, 2100, 0.08, 1.8), '4h');

// ---------- 2) تطبيع دالة مستقلة ----------
const mk = (kind: RealPivot['kind'], price: number, t: number): RealPivot =>
  ({ kind, tf: '1h', price, t, confirmedAt: t + H, trendAtConfirm: 'up' });

const messy: RealPivot[] = [
  mk('HH', 2100, 300), mk('HH', 2100, 300),   // تكرار تام
  mk('HH', 2150, 400),                         // قمة أعلى متتالية → تُحلّ محلّها
  mk('HL', 2050, 500),
  mk('LL', 1900, 100),                         // خارج الترتيب (أقدم)
  mk('LH', 2200, 200),
];
const norm = normalizeRealPivots(messy);
check('التطبيع: يزيل التكرار', new Set(norm.map(p => p.t)).size === norm.length, `n=${norm.length}`);
check('التطبيع: يرتّب زمنياً', norm.every((p, i) => i === 0 || p.t > norm[i - 1].t));
check('التطبيع: يطوي القمم المتتالية للأعلى', norm.filter(p => isHigh(p.kind)).length <= 2,
  norm.map(p => p.kind).join(','));
check('التطبيع: يحفظ التناوب', norm.every((p, i) => i === 0 || isHigh(p.kind) !== isHigh(norm[i - 1].kind)),
  norm.map(p => p.kind).join(','));

// ---------- 3) المحاور النظيفة تُغذّي الأربع نقاط بلا تدخّل ----------
const cleanPool: RealPivot[] = [
  mk('LL', 1900, 10), mk('HH', 2100, 20), mk('HL', 2000, 30), mk('HH', 2200, 40),
];
const fp = confirm4Points(cleanPool, 'up');
check('الأربع نقاط: تعمل على محاور نظيفة', fp.confirmed && fp.gaps === 0, fp.reason);

// ---------- 4) المحرك لم يعد يحتاج تطبيعاً خارجياً ----------
const s = analyzeStructure(series(700, 2000, 0.35, 1.4), '1h');
const twice = normalizeRealPivots(s.realPivots);
check('idempotent: التطبيع مرة أخرى لا يغيّر شيئاً',
  twice.length === s.realPivots.length && twice.every((p, i) => p.t === s.realPivots[i].t),
  `${s.realPivots.length} → ${twice.length}`);

// ---------- 5) الشموع القصيرة لا تنهار ----------
const tiny = analyzeStructure(series(5, 2000, 0.5, 1), '1h');
check('شموع قليلة: لا انهيار', Array.isArray(tiny.realPivots));
const empty = analyzeStructure([], '1h');
check('بلا شموع: لا انهيار', empty.realPivots.length === 0);

// ---------- 6) الأحداث والأتجاه لم تنكسر ----------
const full = analyzeStructure(series(700, 2000, 0.35, 1.4), '1h');
check('الأحداث: BOS موجود', full.events.some(e => e.type === 'BOS'), `events=${full.events.length}`);
check('الأحداث: الترند مسجّل', full.trendTimeline.length > 0, `timeline=${full.trendTimeline.length}`);
check('الأحداث: كل حدث زمنه صالح', full.events.every(e => Number.isFinite(e.t) && e.t > 0));
check('الأحداث: كل محور له confirmedAt ≥ t', full.realPivots.every(p => p.confirmedAt >= p.t));

console.log(`\n${fails === 0 ? '🎯 كل اختبارات البنية نجحت' : `⚠️ ${fails} اختبار فشل`}`);
process.exit(fails === 0 ? 0 : 1);
