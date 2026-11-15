// ============================================================
// السلة المعتمدة — محفظة الظل المستقلة على أساس افتراضي 1000$
// ------------------------------------------------------------
// قرار المالك بعد المحاكاة المعتمدة (سلة A على 1000$):
//   سلة A = TSMOM-30d + Sunrise Ogle — بوضع محاكاة على خط أساس
//   افتراضي 1000$ والحساب الحقيقي (190$) لا يمس إطلاقاً.
//
// لماذا مسار مستقل؟ القياس الحي أثبت أن زرع مكوّنات السلة داخل
// محرك TAMSA المزدحم (18 استراتيجية + صمامات مشتركة + سلم
// أولويات) يخنقها: TSMOM أُعطي 3 صفقات بدل 26، وOgle هبط من
// PF 2.15 إلى 0.61 — النتيجة بلا معنى ولا تطابق المعتمد.
// هنا تعمل السلة في مسارها الخاص بمعزولها المعتمد حرفياً:
//
// • نقل حرفي (حرفاً بحرفاً) من المحاكاة المعتمدة basket1000.py:
//   إشارة على إغلاق i → دخول على افتتاح i+1، SL أولاً داخل الشمعة،
//   لوت 0.01 (= 1$ لكل 1$ حركة)، سبريد 0.30$ لكل صفقة ذهاب-إياب.
// • TSMOM خام بلا بوابة ER (البوابة تجربة مرفوضة — أضرت به).
// • Ogle دائماً مسموحة (تربح في النظامين الاتجاهي والعرضي).
// • EWMAC + دونشييان: إضافات التحقق المزدوج — تُحتسب للعرض.
// • الصمامات المعتمدة على إيكويتي المحفظة الافتراضي:
//     يومي 3% (30$) / أسبوعي 6% (60$) → منع دخول جديد فقط،
//     والمفتوحة تبقى محكومة بوقفها وهدفها؛
//     حاجز كارثة: تراجع الإيكويتي عن قمته ≥ 50% → منع دخول جديد.
// • نمطان في الوحدة نفسها:
//     runValidation — المحاكاة النقية المعتمدة (بلا صمامات) على
//       نوافذ 365/730 يوماً للتحقق من مطابقة أرقام الاعتماد؛
//     runLive — المحفظة التشغيلية بالصمامات على كامل التاريخ
//       الحي (هذه هي السلة «الحية» على أساس 1000$).
// ============================================================
import { mt5Feed } from '@/lib/server/mt5feed';

// ---------- الثوابت المعتمدة (من المحاكاة — لا تغيير) ----------
export const BASKET_BALANCE = 1000;      // الخط الأساسي الافتراضي المعتمد
const SPREAD = 0.30;                     // 30 سنت لكل صفقة ذهاب-إياب (قاعدة البوت)
const SYRIA_MS = 3 * 3600e3;             // توقيت دمشق
const WARMUP = 800;                      // إحماء شموع الساعة (كما في المحاكاة)
const TSMOM_N = 720;                     // 30 يوماً × 24 ساعة
// الصمامات المعتمدة (قرار المالك بعد المحاكاة على 1000$)
const FUSE_DAILY_USD = 30;               // 3% من 1000$
const FUSE_WEEKLY_USD = 60;              // 6% من 1000$
// حاجز الكارثة: الإيكويتي (الرصيد+العائم) دون 50% من الأساس = 500$.
// ملاحظة التصميم: النص المعتمد يضمن أن العتبة «أبعد من أقصى تراجع متحقق للسلة
// (45.2% في سنتين) فلا تمس السلوك المتحقق أبداً» — وهذا يتحقق حصراً بقياس
// نسبي للأساس (أدنى إيكويتي متحقق 548$ > 500$). القياس النسبي للقمة المركّبة
// يُثار في ظل السلوك المتحقق نفسه (أثبت القياس الحي: 5 مرات في 3.4 سنوات)
// فيخالف الضمان المعتمد، كما أنه يجمّد المحفظة نهائياً (بلا صفقات لا يتحرك
// الإيكويتي فلا يتعافى) — ولذلك اعتُمد قياس الأساس مع دورة تجريبية للتعافي.
const FUSE_EQUITY_FLOOR_USD = 500;       // 50% من الأساس
const FUSE_PROBATION_DAYS = 30;          // دورة تجريبية بعد الحاجز ثم إعادة تسليح

export interface BasketCandle { t: number; o: number; h: number; l: number; c: number }

interface Sig { dir: 1 | -1; sl: number; tp: number | null }

interface Pos {
  dir: 1 | -1; entry: number; sl: number; tp: number | null;
  i0: number; held: number; comp: string;
}

export interface BasketTrade {
  comp: string; entryT: number; exitT: number; dir: 1 | -1;
  entry: number; exit: number; sl: number; tp: number | null;
  pnl: number; r: number; why: 'sl' | 'tp' | 'rule' | 'eod' | 'time'; heldH: number;
}

export interface BasketMetrics {
  n: number; wr: number; pf: number; net: number;
  dd: number; ddp: number; risk: number; riskp: number;
  minbal: number; streak: number; avgr: number;
}

interface CompState {
  cum: number; pos: Pos | null; trades: BasketTrade[];
  eq: number[]; dayStartCum: number; weekStartCum: number;
}

export interface FusedRun {
  equityNow: number; netNow: number; floatingNow: number;
  peakEquity: number; trades: BasketTrade[]; eq: number[];
  fuseTrips: { daily: number; weekly: number; equity: number };
  fuseState: { dayBlocked: boolean; weekBlocked: boolean; equityHalted: boolean };
  dayPnlNow: number; weekPnlNow: number;
  openNow: Pos[];
}

// ---------- المؤشرات (نقل حرفي من strategy_shootout.py) ----------
function emaSeries(vals: number[], n: number): number[] {
  const out = new Array<number>(vals.length).fill(NaN);
  const k = 2.0 / (n + 1);
  let e = NaN;
  for (let i = 0; i < vals.length; i++) {
    e = Number.isNaN(e) ? vals[i] : vals[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

function atrSeries(cs: BasketCandle[], n = 14): (number | null)[] {
  const out = new Array<number | null>(cs.length).fill(null);
  const trs: number[] = [];
  for (let i = 1; i < cs.length; i++) {
    const c = cs[i], p = cs[i - 1];
    const tr = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
    trs.push(tr);
    if (trs.length > n) trs.shift();
    if (i >= n) out[i] = trs.reduce((a, b) => a + b, 0) / trs.length;
  }
  return out;
}

// ---------- كاشفات السلة (نقل حرفي من المحاكاة المعتمدة) ----------

/** TSMOM-30d الخام — المعتمد بلا بوابة (البوابة تجربة مرفوضة) */
function sigTsmom(c1: BasketCandle[], atr: (number | null)[]): Map<number, Sig> {
  const sig = new Map<number, Sig>();
  let last = 0;
  for (let i = TSMOM_N; i < c1.length; i++) {
    const mom = c1[i].c / c1[i - TSMOM_N].c - 1.0;
    const want: 1 | -1 = mom > 0 ? 1 : -1;
    if (want !== last) {
      const a = atr[i];
      if (a) sig.set(i, { dir: want, sl: c1[i].c - 3 * a * want, tp: null });
      last = want;
    }
  }
  return sig;
}

function tsmomExit(c1: BasketCandle[], i: number, p: Pos): boolean {
  if (i < TSMOM_N) return false;
  const mom = c1[i].c / c1[i - TSMOM_N].c - 1.0;
  return (p.dir === 1 && mom < 0) || (p.dir === -1 && mom > 0);
}

/** Sunrise Ogle — بولباك ويندو بآلة حالات (EMA 14/18/24، SL 2.5×ATR، TP 12×ATR) */
function sigOgle(c1: BasketCandle[], atr: (number | null)[]): Map<number, Sig> {
  const closes = c1.map(x => x.c);
  const e14 = emaSeries(closes, 14);
  const e18 = emaSeries(closes, 18);
  const e24 = emaSeries(closes, 24);
  const sig = new Map<number, Sig>();
  let pullUp = 0, pullDn = 0;
  for (let i = 24; i < c1.length; i++) {
    const a = atr[i];
    if (!a) continue;
    const up = e14[i] > e18[i] && e18[i] > e24[i];
    const dn = e14[i] < e18[i] && e18[i] < e24[i];
    if (up) {
      if (closes[i] < e14[i]) pullUp++;
      else {
        if (pullUp >= 1 && pullUp <= 3 && closes[i] > Math.max(c1[i - 1].h, c1[i - 2].h)) {
          sig.set(i, { dir: 1, sl: closes[i] - 2.5 * a, tp: closes[i] + 12 * a });
        }
        pullUp = 0;
      }
      pullDn = 0;
    } else if (dn) {
      if (closes[i] > e14[i]) pullDn++;
      else {
        if (pullDn >= 1 && pullDn <= 3 && closes[i] < Math.min(c1[i - 1].l, c1[i - 2].l)) {
          sig.set(i, { dir: -1, sl: closes[i] + 2.5 * a, tp: closes[i] - 12 * a });
        }
        pullDn = 0;
      }
      pullUp = 0;
    } else {
      pullUp = 0; pullDn = 0;
    }
  }
  return sig;
}

function ogleExit(c1: BasketCandle[], i: number, p: Pos, e24: number[]): boolean {
  return (p.dir === 1 && (c1[i].c < e24[i] || p.held > 120)) ||
         (p.dir === -1 && (c1[i].c > e24[i] || p.held > 120));
}

/** EWMAC 32/128 — إضافة التحقق المزدوج */
function sigEwmac(c1: BasketCandle[], atr: (number | null)[]): Map<number, Sig> {
  const closes = c1.map(x => x.c);
  const e32 = emaSeries(closes, 32);
  const e128 = emaSeries(closes, 128);
  const sig = new Map<number, Sig>();
  let last = 0;
  for (let i = 128; i < c1.length; i++) {
    const want: 1 | -1 = e32[i] > e128[i] ? 1 : -1;
    if (want !== last) {
      const a = atr[i];
      if (a) sig.set(i, { dir: want, sl: c1[i].c - 3 * a * want, tp: null });
      last = want;
    }
  }
  return sig;
}

function ewmacExit(c1: BasketCandle[], i: number, p: Pos, e32: number[], e128: number[]): boolean {
  return (p.dir === 1 && e32[i] < e128[i]) || (p.dir === -1 && e32[i] > e128[i]);
}

/** دونشييان 120/60 — إضافة التحقق المزدوج */
function sigDonchian(c1: BasketCandle[], atr: (number | null)[]): Map<number, Sig> {
  const sig = new Map<number, Sig>();
  for (let i = 120; i < c1.length; i++) {
    const a = atr[i];
    if (!a) continue;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - 120; j < i; j++) { hh = Math.max(hh, c1[j].h); ll = Math.min(ll, c1[j].l); }
    if (c1[i].c > hh) sig.set(i, { dir: 1, sl: c1[i].c - 2 * a, tp: null });
    else if (c1[i].c < ll) sig.set(i, { dir: -1, sl: c1[i].c + 2 * a, tp: null });
  }
  return sig;
}

function donchianExit(c1: BasketCandle[], i: number, p: Pos): boolean {
  let hh = -Infinity, ll = Infinity;
  for (let j = i - 60; j < i; j++) { hh = Math.max(hh, c1[j].h); ll = Math.min(ll, c1[j].l); }
  return (p.dir === 1 && c1[i].c < ll) || (p.dir === -1 && c1[i].c > hh);
}

// ---------- المحرك التسلسلي لكل مكوّن (نقل حرفي من run_meta) ----------
// fusesAt: دالة اختيارية تُقيَّم قبل الدخول (وضع التشغيل بالصمامات).
interface RunOut { trades: BasketTrade[]; eq: number[]; cumEnd: number }

function runComponent(
  candles: BasketCandle[],
  sig: Map<number, Sig>,
  exitFn: (i: number, p: Pos) => boolean,
  w0t: number,
  comp: string,
  canEnter: (i: number) => boolean = () => true,
): RunOut {
  const eq = new Array<number>(candles.length).fill(0);
  const trades: BasketTrade[] = [];
  let cum = 0;
  let pos: Pos | null = null;
  for (let i = WARMUP; i < candles.length; i++) {
    const c = candles[i];
    let closed: { px: number; why: BasketTrade['why'] } | null = null;
    if (pos === null) {
      const s = sig.get(i - 1);
      if (s && (s.dir === 1 ? c.o > s.sl : c.o < s.sl) && canEnter(i)) {
        pos = { dir: s.dir, entry: c.o, sl: s.sl, tp: s.tp, i0: i, held: 0, comp };
        if (s.dir === 1 && c.l <= s.sl) closed = { px: s.sl, why: 'sl' };
        else if (s.dir === 1 && s.tp !== null && c.h >= s.tp) closed = { px: s.tp, why: 'tp' };
        else if (s.dir === -1 && c.h >= s.sl) closed = { px: s.sl, why: 'sl' };
        else if (s.dir === -1 && s.tp !== null && c.l <= s.tp) closed = { px: s.tp, why: 'tp' };
      }
    } else {
      pos.held++;
      if (pos.dir === 1) {
        if (c.l <= pos.sl) closed = { px: pos.sl, why: 'sl' };
        else if (pos.tp !== null && c.h >= pos.tp) closed = { px: pos.tp, why: 'tp' };
        else if (exitFn(i, pos)) closed = { px: c.c, why: 'rule' };
      } else {
        if (c.h >= pos.sl) closed = { px: pos.sl, why: 'sl' };
        else if (pos.tp !== null && c.l <= pos.tp) closed = { px: pos.tp, why: 'tp' };
        else if (exitFn(i, pos)) closed = { px: c.c, why: 'rule' };
      }
    }
    if (closed !== null && pos !== null) {
      const pnl = (closed.px - pos.entry) * pos.dir - SPREAD;
      if (candles[pos.i0].t >= w0t) {
        const risk = Math.abs(pos.entry - pos.sl);
        trades.push({
          comp, entryT: candles[pos.i0].t, exitT: c.t, dir: pos.dir,
          entry: pos.entry, exit: closed.px, sl: pos.sl, tp: pos.tp,
          pnl, r: risk > 1e-9 ? pnl / risk : 0, why: closed.why,
          heldH: pos.held,
        });
        cum += pnl;
      }
      pos = null;
    }
    eq[i] = cum;
  }
  if (pos !== null) {
    const c = candles[candles.length - 1];
    const pnl = (c.c - pos.entry) * pos.dir - SPREAD;
    if (candles[pos.i0].t >= w0t) {
      const risk = Math.abs(pos.entry - pos.sl);
      trades.push({
        comp, entryT: candles[pos.i0].t, exitT: c.t, dir: pos.dir,
        entry: pos.entry, exit: c.c, sl: pos.sl, tp: pos.tp,
        pnl, r: risk > 1e-9 ? pnl / risk : 0, why: 'eod', heldH: pos.held,
      });
      cum += pnl;
    }
    eq[candles.length - 1] = cum;
  }
  return { trades, eq, cumEnd: cum };
}

// ---------- المقاييس (نقل حرفي من metrics) ----------
export function basketMetrics(trades: BasketTrade[], eq: number[]): BasketMetrics {
  const n = trades.length;
  if (n === 0) {
    return { n: 0, wr: 0, pf: 0, net: 0, dd: 0, ddp: 0, risk: 0, riskp: 0, minbal: BASKET_BALANCE, streak: 0, avgr: 0 };
  }
  let gw = 0, gl = 0, wins = 0;
  for (const t of trades) {
    if (t.pnl > 0) { gw += t.pnl; wins++; } else gl += -t.pnl;
  }
  let peak = 0, dd = 0;
  for (const v of eq) { peak = Math.max(peak, v); dd = Math.max(dd, peak - v); }
  let streak = 0, worst = 0;
  for (const t of trades) {
    streak = t.pnl <= 0 ? streak + 1 : 0;
    worst = Math.max(worst, streak);
  }
  const net = gw - gl;
  const risk = trades.reduce((a, t) => a + Math.abs(t.entry - t.sl), 0) / n;
  return {
    n, wr: (100 * wins) / n, pf: gl > 1e-9 ? gw / gl : 99, net,
    dd, ddp: (100 * dd) / BASKET_BALANCE, risk, riskp: (100 * risk) / BASKET_BALANCE,
    minbal: BASKET_BALANCE - Math.min(...eq), streak: worst,
    avgr: trades.reduce((a, t) => a + t.r, 0) / n,
  };
}

// ---------- حدود دمشق الزمنية (مطابقة للمحرك الرسمي) ----------
function syriaDayNum(t: number): number {
  return Math.floor((t + SYRIA_MS) / 86400e3);
}

function weekKey(t: number): number {
  const d = new Date(t + SYRIA_MS);
  const day = d.getUTCDay(); // 0=الأحد
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((day + 6) % 7) * 86400e3;
  return monday;
}

// ---------- الوضع 1: التحقق النقي المعتمد (بلا صمامات) ----------
export interface ValidationRow { name: string; window: string; m: BasketMetrics }

function runValidation(c1: BasketCandle[]): { rows: ValidationRow[] } {
  const atr = atrSeries(c1, 14);
  const lastT = c1[c1.length - 1].t;
  const rows: ValidationRow[] = [];

  const comps = {
    TSMOM: () => {
      const sig = sigTsmom(c1, atr);
      return runComponent(c1, sig, (i, p) => tsmomExit(c1, i, p), 0, 'TSMOM');
    },
    Ogle: () => {
      const sig = sigOgle(c1, atr);
      const e24 = emaSeries(c1.map(x => x.c), 24);
      return runComponent(c1, sig, (i, p) => ogleExit(c1, i, p, e24), 0, 'Ogle');
    },
    EWMAC: () => {
      const sig = sigEwmac(c1, atr);
      const e32 = emaSeries(c1.map(x => x.c), 32);
      const e128 = emaSeries(c1.map(x => x.c), 128);
      return runComponent(c1, sig, (i, p) => ewmacExit(c1, i, p, e32, e128), 0, 'EWMAC');
    },
    Donchian: () => {
      const sig = sigDonchian(c1, atr);
      return runComponent(c1, sig, (i, p) => donchianExit(c1, i, p), 0, 'Donchian');
    },
  };

  for (const [tag, days] of [['365يوم', 365], ['730يوم', 730]] as const) {
    const w0t = lastT - days * 86400e3;
    const out: Record<string, RunOut> = {};
    for (const [k, fn] of Object.entries(comps)) {
      const r = fn();
      // إعادة التصفية حسب النافذة (w0t) — كما في المحاكاة المعتمدة
      const trades = r.trades.filter(t => t.entryT >= w0t);
      // منحنى النافذة: التراكمي داخل النافذة فقط (كما في python: cum يبدأ من صفر عند w0t)
      const eqWin = new Array<number>(c1.length).fill(0);
      let cum = 0;
      const byExit = new Map<number, number>();
      for (const t of trades) byExit.set(t.exitT, (byExit.get(t.exitT) ?? 0) + t.pnl);
      for (let i = WARMUP; i < c1.length; i++) {
        cum += byExit.get(c1[i].t) ?? 0;
        eqWin[i] = cum;
      }
      out[k] = { trades, eq: eqWin, cumEnd: cum };
      rows.push({ name: NAME_AR[k], window: tag, m: basketMetrics(trades, eqWin) });
    }
    // سلة A المعتمدة: TSMOM + Ogle — المنحنى مجموع المنحنيات (كما في python zip-sum)
    const addCombo = (name: string, parts: RunOut[]) => {
      const trades = parts.flatMap(p => p.trades).sort((a, b) => a.entryT - b.entryT);
      const comboEq = new Array<number>(c1.length).fill(0);
      for (let i = 0; i < c1.length; i++) comboEq[i] = parts.reduce((a, p) => a + p.eq[i], 0);
      rows.push({ name, window: tag, m: basketMetrics(trades, comboEq) });
      return { trades, comboEq };
    };
    addCombo('سلة A: TSMOM + Ogle (المعتمدة)', [out.TSMOM, out.Ogle]);
    addCombo('سلة B الموسعة: + EWMAC + دونشييان', [out.TSMOM, out.Ogle, out.EWMAC, out.Donchian]);
  }

  // صف مرجعي إضافي: سلة A النقية على كامل التاريخ المتاح — مرجع قياس تكلفة الصمامات
  const fullOut: Record<string, RunOut> = {};
  for (const [k, fn] of Object.entries(comps)) {
    const r = fn();
    fullOut[k] = { trades: r.trades, eq: r.eq, cumEnd: r.cumEnd };
  }
  {
    const trades = [...fullOut.TSMOM.trades, ...fullOut.Ogle.trades].sort((a, b) => a.entryT - b.entryT);
    const comboEq = new Array<number>(c1.length).fill(0);
    for (let i = 0; i < c1.length; i++) comboEq[i] = fullOut.TSMOM.eq[i] + fullOut.Ogle.eq[i];
    rows.push({ name: 'سلة A كامل التاريخ (نقية بلا صمامات)', window: 'كامل', m: basketMetrics(trades, comboEq) });
  }
  return { rows };
}

const NAME_AR: Record<string, string> = {
  TSMOM: 'TSMOM-30d (خام — المعتمد)',
  Ogle: 'Sunrise Ogle (دائماً)',
  EWMAC: 'EWMAC 32/128 (تحقق مزدوج)',
  Donchian: 'دونشييان 120/60 (تحقق مزدوج)',
};

// ---------- الوضع 2: المحفظة التشغيلية بالصمامات (السلة الحية على 1000$) ----------
function runFused(c1: BasketCandle[], maxHoldHours = 0): FusedRun & { metricsAll: BasketMetrics; metrics365: BasketMetrics } {
  const atr = atrSeries(c1, 14);
  const closes = c1.map(x => x.c);
  const e24 = emaSeries(closes, 24);

  // إشارات المكوّنات المعتمدة للتشغيل: سلة A = TSMOM + Ogle حصراً (قرار المالك).
  // EWMAC ودونشييان تحت المراقبة فقط — تُعرض مقاييسها النقية في جدول التحقق
  // ولا تدخل إيكويتي المحفظة التشغيلية إلا بقرار مستقبلي صريح.
  const sigs: Record<string, Map<number, Sig>> = {
    TSMOM: sigTsmom(c1, atr),
    Ogle: sigOgle(c1, atr),
  };
  const exitFns: Record<string, (i: number, p: Pos) => boolean> = {
    TSMOM: (i, p) => tsmomExit(c1, i, p),
    Ogle: (i, p) => ogleExit(c1, i, p, e24),
  };
  const compNames = Object.keys(sigs);

  // حالة كل مكوّن — المحرك التسلسلي المشترك: كل مكوّن مستقل بصفقة واحدة،
  // والصمامات تُقيَّم على المحفظة المجمعة (القرار المعتمد).
  const st: Record<string, CompState> = {};
  for (const k of compNames) {
    st[k] = { cum: 0, pos: null, trades: [], eq: new Array<number>(c1.length).fill(0), dayStartCum: 0, weekStartCum: 0 };
  }

  let dayNumPrev = -1, weekPrev = -1;
  let dayBlocked = false, weekBlocked = false, equityHalted = false;
  let haltedSinceDay = 0;
  let lastDayPnl = 0, lastWeekPnl = 0;
  const fuseTrips = { daily: 0, weekly: 0, equity: 0 };
  const eqCurve = new Array<number>(c1.length).fill(BASKET_BALANCE);

  const portfolioCum = () => compNames.reduce((a, k) => a + st[k].cum, 0);
  const floating = (i: number) => compNames.reduce((a, k) => {
    const p = st[k].pos;
    if (!p) return a;
    return a + (c1[i].c - p.entry) * p.dir;
  }, 0);

  for (let i = WARMUP; i < c1.length; i++) {
    const c = c1[i];

    // ---- بداية يوم/أسبوع دمشق جديد: تصفير الصمامات الزمنية ----
    const dn = syriaDayNum(c.t);
    if (dn !== dayNumPrev) {
      dayNumPrev = dn;
      dayBlocked = false;
      for (const k of compNames) st[k].dayStartCum = st[k].cum;
    }
    const wk = weekKey(c.t);
    if (wk !== weekPrev) {
      weekPrev = wk;
      weekBlocked = false;
      for (const k of compNames) st[k].weekStartCum = st[k].cum;
    }

    // ---- تقييم الصمامات الثلاثة كل شمعة (قبل الدخول) — على المحفظة المجمعة ----
    const cumAll = portfolioCum();
    // العائم المعاير لنهاية الشمعة السابقة (بلا تسلل: قرار الدخول من معطيات مكتملة)
    const flPrev = i > WARMUP ? floating(i - 1) : 0;
    // بداية اليوم/الأسبوع للمحفظة = مجموع بدايات المكوّنات (ليس المكوّن الأول!)
    const dayStartAll = compNames.reduce((a, k) => a + st[k].dayStartCum, 0);
    const weekStartAll = compNames.reduce((a, k) => a + st[k].weekStartCum, 0);
    const dayClosed = cumAll - dayStartAll;
    const weekClosed = cumAll - weekStartAll;
    const dayPnlNow = dayClosed + flPrev;
    const weekPnlNow = weekClosed + flPrev;
    const eqNow = BASKET_BALANCE + cumAll + flPrev;
    // حاجز الكارثة (نسبي للأساس) + دورة تجريبية للتعافي (يمنع الجمود الدائم:
    // بلا صفقات لا يتحرك الإيكويتي، فإبقاء الحاجز للأبد يعني موت المحفظة)
    const nowHaltedRaw = eqNow < FUSE_EQUITY_FLOOR_USD;
    if (nowHaltedRaw && !equityHalted) {
      equityHalted = true;
      haltedSinceDay = dn;
      fuseTrips.equity++;
    } else if (equityHalted && dn - haltedSinceDay >= FUSE_PROBATION_DAYS) {
      equityHalted = false; // دورة تجريبية — إن بقي دون الحاجز يُثار من جديد
      haltedSinceDay = dn;
    } else if (equityHalted && !nowHaltedRaw && eqNow >= FUSE_EQUITY_FLOOR_USD * 1.10) {
      equityHalted = false; // تعافي فعلي فوق الحاجز بهامش 10%
    }
    const nowDayBlocked = dayPnlNow <= -FUSE_DAILY_USD;
    const nowWeekBlocked = weekPnlNow <= -FUSE_WEEKLY_USD;
    if (nowDayBlocked && !dayBlocked) fuseTrips.daily++;
    if (nowWeekBlocked && !weekBlocked) fuseTrips.weekly++;
    dayBlocked = nowDayBlocked;
    weekBlocked = nowWeekBlocked;
    lastDayPnl = dayPnlNow;
    lastWeekPnl = weekPnlNow;

    // ---- تنفيذ كل مكوّن (دخول من إشارة i-1 على افتتاح i، أو إدارة المفتوح) ----
    for (const k of compNames) {
      const s0 = st[k];
      let closed: { px: number; why: BasketTrade['why'] } | null = null;
      if (s0.pos === null) {
        const s = sigs[k].get(i - 1);
        const blockedNow = dayBlocked || weekBlocked || equityHalted;
        if (s && !blockedNow && (s.dir === 1 ? c.o > s.sl : c.o < s.sl)) {
          s0.pos = { dir: s.dir, entry: c.o, sl: s.sl, tp: s.tp, i0: i, held: 0, comp: k };
          if (s.dir === 1 && c.l <= s.sl) closed = { px: s.sl, why: 'sl' };
          else if (s.dir === 1 && s.tp !== null && c.h >= s.tp) closed = { px: s.tp, why: 'tp' };
          else if (s.dir === -1 && c.h >= s.sl) closed = { px: s.sl, why: 'sl' };
          else if (s.dir === -1 && s.tp !== null && c.l <= s.tp) closed = { px: s.tp, why: 'tp' };
        }
      } else {
        s0.pos.held++;
        const p = s0.pos;
        // الخروج الوقائي بالسقف الزمني (قاعدة 4): إغلاق على آخر شمعة ما زالت الصفقة
        // ضمن السقف — لو انتظرنا الشمعة التالية لانزلقت مدة الصفقة عبر فجوة العطلة
        // الأسبوعية إلى أيام فوق السقف. الأولوية: الوقف ← الهدف ← قاعدة الخروج ← السقف الزمني.
        const capBreach = maxHoldHours > 0 && i + 1 < c1.length && (c1[i + 1].t - c1[p.i0].t) >= maxHoldHours * 3600e3;
        if (p.dir === 1) {
          if (c.l <= p.sl) closed = { px: p.sl, why: 'sl' };
          else if (p.tp !== null && c.h >= p.tp) closed = { px: p.tp, why: 'tp' };
          else if (exitFns[k](i, p)) closed = { px: c.c, why: 'rule' };
          else if (capBreach) closed = { px: c.c, why: 'time' };
        } else {
          if (c.h >= p.sl) closed = { px: p.sl, why: 'sl' };
          else if (p.tp !== null && c.l <= p.tp) closed = { px: p.tp, why: 'tp' };
          else if (exitFns[k](i, p)) closed = { px: c.c, why: 'rule' };
          else if (capBreach) closed = { px: c.c, why: 'time' };
        }
      }
      if (closed !== null && s0.pos !== null) {
        const p = s0.pos;
        const pnl = (closed.px - p.entry) * p.dir - SPREAD;
        const risk = Math.abs(p.entry - p.sl);
        s0.trades.push({
          comp: k, entryT: c1[p.i0].t, exitT: c.t, dir: p.dir,
          entry: p.entry, exit: closed.px, sl: p.sl, tp: p.tp,
          pnl, r: risk > 1e-9 ? pnl / risk : 0, why: closed.why, heldH: p.held,
        });
        s0.cum += pnl;
        s0.pos = null;
      }
      s0.eq[i] = s0.cum;
    }

    // ---- منحنى إيكويتي المحفظة (نهاية الشمعة) ----
    eqCurve[i] = BASKET_BALANCE + portfolioCum() + floating(i);
  }

  const allTrades = compNames.flatMap(k => st[k].trades).sort((a, b) => a.entryT - b.entryT);
  const lastI = c1.length - 1;
  const openNow = compNames.map(k => st[k].pos).filter((p): p is Pos => p !== null);
  let eqPeak = BASKET_BALANCE;
  for (const v of eqCurve) eqPeak = Math.max(eqPeak, v);

  // المقاييس الكاملة: على منحنى صافي الربح التراكمي للمحفظة
  const netCurve = eqCurve.map(v => v - BASKET_BALANCE);
  const metricsAll = basketMetrics(allTrades, netCurve);
  // مقاييس آخر 365 يوماً: منحنى النافذة يبدأ من صفر عند الحد (كما في التحقق)
  const t365 = c1[lastI].t - 365 * 86400e3;
  const idx365 = Math.max(WARMUP, c1.findIndex(x => x.t >= t365));
  const base365 = netCurve[idx365];
  const tr365 = allTrades.filter(t => t.entryT >= t365);
  const metrics365 = basketMetrics(tr365, netCurve.map((v, i) => (i < idx365 ? 0 : v - base365)));

  return {
    equityNow: eqCurve[lastI],
    netNow: portfolioCum(),
    floatingNow: floating(lastI),
    peakEquity: eqPeak,
    trades: allTrades,
    eq: eqCurve,
    fuseTrips,
    fuseState: { dayBlocked, weekBlocked, equityHalted },
    dayPnlNow: lastDayPnl,
    weekPnlNow: lastWeekPnl,
    openNow,
    metricsAll,
    metrics365: { ...metrics365, net: metrics365.net },
  };
}

// ---------- الواجهة العامة مع الكاش (شمعة ساعة واحدة = حساب واحد) ----------
export interface BasketReport {
  ok: boolean;
  computedAt: number;
  candles: number;
  dataFrom: number | null;
  dataTo: number | null;
  note: string;
  validation: ValidationRow[];
  live: {
    equityNow: number; netNow: number; floatingNow: number; peakEquity: number;
    fuseTrips: { daily: number; weekly: number; equity: number };
    fuseState: { dayBlocked: boolean; weekBlocked: boolean; equityHalted: boolean };
    dayPnlNow: number; weekPnlNow: number;
    metricsAll: BasketMetrics;
    metrics365: BasketMetrics;
    monthly: { month: string; net: number }[];
    open: { comp: string; dir: 1 | -1; entry: number; sl: number; tp: number | null; sinceT: number; floating: number }[];
    lastTrades: BasketTrade[];
    eqDaily: { t: number; v: number }[];
  } | null;
}

const gB = globalThis as unknown as {
  __basketCache?: { key: number; payload: BasketReport; busy: Promise<void> | null };
};
const bCache = gB.__basketCache ?? (gB.__basketCache = { key: -1, payload: null as unknown as BasketReport, busy: null });

export function getBasketData(): BasketCandle[] | null {
  const s = mt5Feed();
  const arr = s.tfs['1h'];
  if (!arr || arr.length < WARMUP + 400) return null;
  return arr.map(x => ({ t: x.t, o: x.o, h: x.h, l: x.l, c: x.c })) as BasketCandle[];
}

export async function buildBasketReport(): Promise<BasketReport> {
  const c1 = getBasketData();
  if (!c1) {
    return {
      ok: false, computedAt: Date.now(), candles: 0, dataFrom: null, dataTo: null,
      note: 'شموع الساعة الحية غير كافية بعد — بانتظار بثّ MT5 (يلزم 1200 شمعة ساعة على الأقل)',
      validation: [], live: null,
    };
  }
  const key = c1[c1.length - 1].t;
  if (bCache.payload && bCache.key === key) return bCache.payload;
  if (bCache.busy) { await bCache.busy; return bCache.payload; }
  const job = (async () => {
    const { rows } = runValidation(c1);
    // سقف الاحتفاظ الزمني (قاعدة 4) من الإعدادات المحفوظة — يُطبق على المحفظة التشغيلية
    // فقط؛ محاكاة التحقق النقية تبقى بلا سقف حفاظاً على مطابقة أرقام الاعتماد.
    let maxHoldHours = 0;
    try {
      const { loadBotSettings } = await import('@/lib/server/backtestRunner');
      const s = await loadBotSettings();
      const r4 = s.globalRules?.max_hold_hours;
      if (r4?.enabled && r4.value && r4.value > 0) maxHoldHours = r4.value;
    } catch { /* بلا سقف إن تعذر قراءة الإعدادات */ }
    const fused = runFused(c1, maxHoldHours);
    // التجميع الشهري للمحفظة التشغيلية
    const mm = new Map<string, number>();
    for (const t of fused.trades) {
      const mk = new Date(t.entryT + SYRIA_MS).toISOString().slice(0, 7);
      mm.set(mk, (mm.get(mk) ?? 0) + t.pnl);
    }
    const monthly = [...mm.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, net]) => ({ month, net: Math.round(net * 100) / 100 }));
    // منحنى الإيكويتي اليومي مصغّراً
    const byDay = new Map<number, number>();
    for (let i = WARMUP; i < c1.length; i++) byDay.set(syriaDayNum(c1[i].t), fused.eq[i]);
    const eqDaily = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([d, v]) => ({ t: d * 86400e3 - SYRIA_MS, v: Math.round(v * 100) / 100 }));
    const report: BasketReport = {
      ok: true,
      computedAt: Date.now(),
      candles: c1.length,
      dataFrom: c1[0].t,
      dataTo: c1[c1.length - 1].t,
      note: 'السلة المعتمدة تعمل بمعزولها الحرفي — محفظة ظل على أساس افتراضي 1000$ ولا تمس الحساب الحقيقي',
      validation: rows.map(r => ({ ...r, m: { ...r.m, net: Math.round(r.m.net * 100) / 100, pf: Math.round(r.m.pf * 100) / 100, wr: Math.round(r.m.wr * 10) / 10, dd: Math.round(r.m.dd * 100) / 100, ddp: Math.round(r.m.ddp * 10) / 10, risk: Math.round(r.m.risk * 100) / 100, riskp: Math.round(r.m.riskp * 100) / 100, avgr: Math.round(r.m.avgr * 1000) / 1000 } })),
      live: {
        equityNow: Math.round(fused.equityNow * 100) / 100,
        netNow: Math.round(fused.netNow * 100) / 100,
        floatingNow: Math.round(fused.floatingNow * 100) / 100,
        peakEquity: Math.round(fused.peakEquity * 100) / 100,
        fuseTrips: fused.fuseTrips,
        fuseState: fused.fuseState,
        dayPnlNow: Math.round(fused.dayPnlNow * 100) / 100,
        weekPnlNow: Math.round(fused.weekPnlNow * 100) / 100,
        metricsAll: fused.metricsAll,
        metrics365: fused.metrics365,
        monthly,
        open: fused.openNow.map(p => ({
          comp: p.comp, dir: p.dir, entry: p.entry, sl: p.sl, tp: p.tp,
          sinceT: c1[p.i0].t,
          floating: Math.round(((c1[c1.length - 1].c - p.entry) * p.dir) * 100) / 100,
        })),
        lastTrades: fused.trades.slice(-12).reverse(),
        eqDaily: eqDaily.length > 800 ? eqDaily.filter((_, i) => i % Math.ceil(eqDaily.length / 800) === 0) : eqDaily,
      },
    };
    bCache.payload = report;
    bCache.key = key;
  })();
  bCache.busy = job.catch(() => { /* تبقى النتيجة القديمة */ });
  try { await job; } finally { bCache.busy = null; }
  return bCache.payload;
}
