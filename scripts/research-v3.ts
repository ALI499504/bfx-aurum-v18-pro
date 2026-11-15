// ============================================================
// بحث v3 — مرشّحات استراتيجيات المحترفين من GitHub (بنفس طبقة انضباط المالك)
// المرشّحون:
//   C1  Daily Liquidity Sweep     — PDH/PDL sweep (GitHub: ikeawesom/xauusd-backtest)
//   C2  Opening Range Breakout    — ORB لندن/نيويورك (المعيار الاحترافي الكلاسيكي)
//   C3  EMA Pullback Window       — Sunrise Ogle معدّلة (GitHub: ilahuerta-IA, PF 1.64 على 5 سنوات)
//   C4  Silver Bullet FVG         — ICT (نوافذ زمنية + FVG)
//   C5  Asian Range Sweep London  — كنسحب لندن لرينج آسيا (Judas Swing — روتين المحترفين للذهب)
// طبقة التنفيذ موحّدة ومطابقة لمحرك backtest.ts حرفياً:
//   دخول بإغلاق شمعة 5m، إدارة من الشمعة التالية (وقف أولاً — تحفّظي)، هدف ثابت 10$،
//   وقف 10–15$ (clamp)، سبريد 30¢، صفقة واحدة، وقف زمني 12×M5، نوافذ لندن/نيويورك دمشق،
//   قاطع تراجع يومي 10%، هدف يومي +3% مع ≥10 صفقات.
// ============================================================
import { mt5Feed } from '../src/lib/server/mt5feed';

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

const TP_USD = 10;
const MIN_SL = 10, MAX_SL = 15;
const SPREAD = 0.3;
const TIME_STOP = 12;
const TF5 = 300e3;
const KZ_LDN: [number, number] = [6, 14];
const KZ_NY: [number, number] = [13, 21.5];

const killzone = (t: number): boolean => {
  const tt = t + 3 * 3600e3;
  if (new Date(tt).getUTCDay() === 6) return false;
  const h = (tt % 86400e3) / 3600e3;
  return (h >= KZ_LDN[0] && h < KZ_LDN[1]) || (h >= KZ_NY[0] && h < KZ_NY[1]);
};
const dayKey = (t: number): string => new Date(t + 3 * 3600e3).toISOString().slice(0, 10);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

// ---------- مؤشرات ----------
function ema(vals: number[], period: number): number[] {
  const out = new Array<number>(vals.length).fill(NaN);
  const k = 2 / (period + 1);
  let e = vals[0];
  out[0] = e;
  for (let i = 1; i < vals.length; i++) { e = vals[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
function atr(c: Candle[], period = 14): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  let a = NaN;
  for (let i = 0; i < c.length; i++) {
    const tr = i === 0 ? c[0].h - c[0].l
      : Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    a = i === period - 1 ? (c.slice(0, period).reduce((s, x, j) => s + (j === 0 ? 0 : Math.max(x.h - x.l, Math.abs(x.h - c[j - 1].c), Math.abs(x.l - c[j - 1].c))), 0) + c[0].h - c[0].l) / period
      : Number.isFinite(a) ? (a * (period - 1) + tr) / period : NaN;
    out[i] = a;
  }
  return out;
}

// ---------- واجهة المرشّح ----------
interface Sig { dir: 'buy' | 'sell'; slRaw: number; tag: string }
interface Ctx {
  i: number; t: number; closeT: number;           // t = open time of closed 5m bar
  bar: Candle;
  c5: Candle[]; atr5: number[]; e14: number[]; e18: number[]; e24: number[];
  pdh: number; pdl: number;                       // قمة/قاع اليوم السابق (يوم UTC)
  asiaHigh: number; asiaLow: number;              // رينج آسيا لليوم الحالي (00:00–06:00 دمشق)
}
interface Cand {
  name: string;
  onBar(ctx: Ctx): Sig | null;
  onTradeClosed?(tag: string, dir: 'buy' | 'sell'): void;
}

// ============ C1 — Daily Liquidity Sweep (PDH/PDL) ============
function mkDailySweep(bufferAtr: number, cooldownBars: number): Cand {
  let cdBuy = 0, cdSell = 0;
  return {
    name: `C1 PDH/PDL Sweep (buf=${bufferAtr}×ATR, cd=${cooldownBars})`,
    onBar(ctx) {
      cdBuy = Math.max(0, cdBuy - 1); cdSell = Math.max(0, cdSell - 1);
      if (!killzone(ctx.closeT)) return null;
      const a = ctx.atr5[ctx.i] || 2;
      const buf = bufferAtr * a;
      // سحب القاع السابق ثم إغلاق فوقه → شراء
      if (ctx.pdl > 0 && ctx.bar.l < ctx.pdl - buf && ctx.bar.c > ctx.pdl && cdBuy === 0) {
        cdBuy = cooldownBars;
        return { dir: 'buy', slRaw: ctx.bar.l - 0.1 * a, tag: 'PDL' };
      }
      // سحب القمة السابقة ثم إغلاق تحتها → بيع
      if (ctx.pdh > 0 && ctx.bar.h > ctx.pdh + buf && ctx.bar.c < ctx.pdh && cdSell === 0) {
        cdSell = cooldownBars;
        return { dir: 'sell', slRaw: ctx.bar.h + 0.1 * a, tag: 'PDH' };
      }
      return null;
    },
  };
}

// ============ C2 — Opening Range Breakout (لندن + نيويورك) ============
interface OrbOpts {
  orMin: number;            // مدة الرينج بالدقائق
  minW: number;             // أضيق رينج مقبول
  maxW: number;             // أعرض رينج مقبول (0 = بلا حد)
  maxTry: number;           // محاولات لكل اتجاه داخل النافذة
  resetPerSession: boolean; // تصفير المحاولات عند تبدّل النافذة
  windows: number[];        // بدايات نوافذ OR (دمشق ساعات عشرية)
  bufferAtr: number;        // هامش تأكيد الاختراق فوق حافة الرينج
  minAtr: number;           // فلتر تذبذب: ATR5 ألا يقل عن هذا
  cdBars: number;
  trendH1: boolean;         // محاذاة اتجاه EMA50 على ساعة
  alternating: boolean;     // تناوب إلزامي: لا تكرار نفس الاتجاه قبل إشارة معاكسة
  deadInvalid: boolean;     // نطاق غير صالح = تعطيل كامل اليوم (لا صفقات)
}
function mkORB2(o: OrbOpts): Cand {
  interface OrState { hi: number; lo: number; done: boolean; valid: boolean; day: string; side: '' | 'buy' | 'sell'; triedBuy: number; triedSell: number; cd: number; w: number }
  const st: OrState = { hi: 0, lo: 0, done: false, valid: false, day: '', side: '', triedBuy: 0, triedSell: 0, cd: 0, w: -1 };
  // النافذة الفعّالة: من بداية OR حتى بداية النافذة التالية (أو نهاية يوم التداول)
  const allW = [...o.windows].sort((a, b) => a - b);
  let e50h: number[] | null = null;
  let e50hIdx = new Map<number, number>();
  return {
    name: `ORB2 w=[${o.windows.join(',')}] or=${o.orMin}m buf=${o.bufferAtr} minATR=${o.minAtr} maxW=${o.maxW} try=${o.maxTry} cd=${o.cdBars} rps=${o.resetPerSession} trend=${o.trendH1}`,
    onBar(ctx) {
      const hh = ((ctx.closeT + 3 * 3600e3) % 86400e3) / 3600e3;
      const dk = dayKey(ctx.closeT);
      if (dk !== st.day) { st.day = dk; st.hi = 0; st.lo = 0; st.done = false; st.valid = false; st.side = ''; st.triedBuy = 0; st.triedSell = 0; st.cd = 0; st.w = -1; }
      st.cd = Math.max(0, st.cd - 1);
      // أقرب نافذة بداية ≤ hh
      let wIdx = -1;
      for (let k = 0; k < allW.length; k++) if (hh >= allW[k]) wIdx = k;
      if (wIdx < 0) return null;
      const wStart = allW[wIdx];
      const nextStart = wIdx + 1 < allW.length ? allW[wIdx + 1] : 22;
      if (hh >= nextStart) return null;
      const inOr = hh < wStart + o.orMin / 60;
      if (inOr) {
        if (st.w !== wIdx) { st.w = wIdx; st.hi = ctx.bar.h; st.lo = ctx.bar.l; st.done = false; st.valid = false; st.triedBuy = 0; st.triedSell = 0; }
        else { st.hi = Math.max(st.hi, ctx.bar.h); st.lo = Math.min(st.lo, ctx.bar.l); }
        return null;
      }
      if (st.w !== wIdx) return null;   // خارج نافذة OR الحالية
      if (o.resetPerSession) { st.triedBuy = 0; st.triedSell = 0; }
      if (!st.done) {
        st.done = true;
        if (st.hi - st.lo < o.minW || (o.maxW > 0 && st.hi - st.lo > o.maxW)) {
          if (o.deadInvalid) return null;   // نطاق غير صالح = تعطيل كامل اليوم
          return null;
        }
        st.valid = true;
      }
      if (o.deadInvalid && !st.valid) return null;
      if (st.cd > 0) return null;
      if (!killzone(ctx.closeT)) return null;
      if (o.minAtr > 0 && (ctx.atr5[ctx.i] || 0) < o.minAtr) return null;
      const a = ctx.atr5[ctx.i] || 2;
      const buf = o.bufferAtr * a;
      // فلتر اتجاه الساعة (EMA50 على 1h — قيمة آخر ساعة مكتملة فقط: بلا تسلل مستقبلي)
      let trendOk = (dir: 'buy' | 'sell') => true;
      if (o.trendH1) {
        if (!e50h) {
          const h1: Candle[] = [];
          const seen = new Set<number>();
          for (const c of ctx.c5) { const b = Math.floor(c.t / 3600e3) * 3600e3; if (!seen.has(b)) { seen.add(b); h1.push({ t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }); } else { const p = h1[h1.length - 1]; p.h = Math.max(p.h, c.h); p.l = Math.min(p.l, c.l); p.c = c.c; } }
          h1.forEach((c, k) => e50hIdx.set(c.t, k));
          e50h = ema(h1.map(x => x.c), 50);
        }
        const curBucket = Math.floor(ctx.bar.t / 3600e3) * 3600e3;
        const idx = e50hIdx.get(curBucket);
        const e = idx !== undefined && idx - 1 >= 0 ? e50h[idx - 1] : NaN;   // آخر ساعة مغلقة
        if (Number.isFinite(e)) trendOk = dir => dir === 'buy' ? ctx.bar.c > e : ctx.bar.c < e;
      }
      const maxTry = o.maxTry;
      if (ctx.bar.c > st.hi + buf && st.triedBuy < maxTry && trendOk('buy') && !(o.alternating && st.side === 'buy')) {
        st.triedBuy++; st.side = 'buy'; st.cd = o.cdBars;
        return { dir: 'buy', slRaw: (st.hi + st.lo) / 2 - 0.1 * a, tag: `ORB2-${wStart}` };
      }
      if (ctx.bar.c < st.lo - buf && st.triedSell < maxTry && trendOk('sell') && !(o.alternating && st.side === 'sell')) {
        st.triedSell++; st.side = 'sell'; st.cd = o.cdBars;
        return { dir: 'sell', slRaw: (st.hi + st.lo) / 2 + 0.1 * a, tag: `ORB2-${wStart}` };
      }
      return null;
    },
  };
}


function mkORB(orMin: number, maxWidth: number, reentry: boolean): Cand {
  interface OrState { hi: number; lo: number; done: boolean; day: string; side: '' | 'buy' | 'sell'; triedBuy: boolean; triedSell: boolean; cd: number }
  const st: OrState = { hi: 0, lo: 0, done: false, day: '', side: '', triedBuy: false, triedSell: false, cd: 0 };
  const sessionOf = (h: number): 'ldn' | 'ny' | null =>
    h >= KZ_LDN[0] && h < KZ_LDN[1] ? 'ldn' : (h >= KZ_NY[0] && h < KZ_NY[1] ? 'ny' : null);
  const orStart = { ldn: KZ_LDN[0], ny: KZ_NY[0] };
  return {
    name: `C2 ORB ${orMin}m (minW=${maxWidth}, re=${reentry})`,
    onBar(ctx) {
      const hh = ((ctx.closeT + 3 * 3600e3) % 86400e3) / 3600e3;
      const dk = dayKey(ctx.closeT);
      const sess = sessionOf(hh);
      // يوم جديد → تصفير
      if (dk !== st.day) { st.day = dk; st.hi = 0; st.lo = 0; st.done = false; st.side = ''; st.triedBuy = false; st.triedSell = false; st.cd = 0; }
      st.cd = Math.max(0, st.cd - 1);
      if (!sess) return null;
      const hStart = orStart[sess];
      if (hh < hStart) return null;
      const inOr = hh >= hStart && hh < hStart + orMin / 60;
      if (inOr) {
        st.hi = st.hi === 0 ? ctx.bar.h : Math.max(st.hi, ctx.bar.h);
        st.lo = st.lo === 0 ? ctx.bar.l : Math.min(st.lo, ctx.bar.l);
        return null;
      }
      if (!st.done) {
        // تأكد أن الرينج اكتمل فعلاً (الوقت تجاوز نهاية OR)
        if (hh < hStart + orMin / 60) return null;
        st.done = true;
        if (st.hi - st.lo < maxWidth) return null;   // رينج ضيق جداً = ضجيج
      }
      if (st.cd > 0) return null;
      // دخول كسر الرينج
      const a = ctx.atr5[ctx.i] || 2;
      if (!st.triedBuy || (reentry && st.side !== 'buy')) {
        if (ctx.bar.c > st.hi) {
          st.triedBuy = true; st.side = 'buy'; st.cd = 6;
          return { dir: 'buy', slRaw: (st.hi + st.lo) / 2 - 0.1 * a, tag: `ORB-${sess}` };
        }
      }
      if (!st.triedSell || (reentry && st.side !== 'sell')) {
        if (ctx.bar.c < st.lo) {
          st.triedSell = true; st.side = 'sell'; st.cd = 6;
          return { dir: 'sell', slRaw: (st.hi + st.lo) / 2 + 0.1 * a, tag: `ORB-${sess}` };
        }
      }
      return null;
    },
  };
}

// ============ C3 — EMA Pullback Window Breakout (Sunrise Ogle معدّلة) ============
function mkEmaPullback(pullbackMax: number, slopeMinAtr: number, cooldownBars: number, useSessions: boolean): Cand {
  let arm = '' as '' | 'long' | 'short';
  let pullCount = 0;
  let windowHi = 0, windowLo = 0;
  let cd = 0;
  return {
    name: `C3 EMA Pullback Window (pb≤${pullbackMax}, slope=${slopeMinAtr}×ATR, cd=${cooldownBars}, sess=${useSessions})`,
    onBar(ctx) {
      cd = Math.max(0, cd - 1);
      const { i, bar, e14, e18, e24, atr5 } = ctx;
      if (!Number.isFinite(e24[i]) || !Number.isFinite(atr5[i])) return null;
      if (useSessions && !killzone(ctx.closeT)) { arm = ''; pullCount = 0; return null; }
      const a = atr5[i];
      const stackUp = e14[i] > e18[i] && e18[i] > e24[i];
      const stackDn = e14[i] < e18[i] && e18[i] < e24[i];
      const slopeUp = (e14[i] - e14[Math.max(0, i - 3)]) > slopeMinAtr * a;
      const slopeDn = (e14[Math.max(0, i - 3)] - e14[i]) > slopeMinAtr * a;
      const bull = stackUp && slopeUp, bear = stackDn && slopeDn;
      // إبطال عام عند انقلاب التراص
      if (arm === 'long' && !bull) { arm = ''; pullCount = 0; }
      if (arm === 'short' && !bear) { arm = ''; pullCount = 0; }
      if (cd > 0) return null;
      // تتبع التراجع 1–3 شموع عكس الاتجاه
      if (bull && bar.c < e14[i]) {
        if (arm !== 'long') { arm = 'long'; pullCount = 1; windowHi = bar.h; windowLo = bar.l; }
        else if (pullCount < pullbackMax) { pullCount++; windowHi = Math.max(windowHi, bar.h); windowLo = Math.min(windowLo, bar.l); }
        return null;
      }
      if (bear && bar.c > e14[i]) {
        if (arm !== 'short') { arm = 'short'; pullCount = 1; windowHi = bar.h; windowLo = bar.l; }
        else if (pullCount < pullbackMax) { pullCount++; windowHi = Math.max(windowHi, bar.h); windowLo = Math.min(windowLo, bar.l); }
        return null;
      }
      // دخول: كسر نافذة التراجع (أعلى/أدنى شمعتي النافذة)
      if (arm === 'long' && pullCount >= 1 && bar.c > windowHi) {
        arm = ''; pullCount = 0; cd = cooldownBars;
        return { dir: 'buy', slRaw: bar.c - 2.5 * a, tag: 'EMA-PB' };
      }
      if (arm === 'short' && pullCount >= 1 && bar.c < windowLo) {
        arm = ''; pullCount = 0; cd = cooldownBars;
        return { dir: 'sell', slRaw: bar.c + 2.5 * a, tag: 'EMA-PB' };
      }
      return null;
    },
  };
}

// ============ C4 — Silver Bullet FVG (ICT) ============
function mkSilverBullet(minFvgAtr: number, validBars: number, cooldownBars: number): Cand {
  interface Fvg { dir: 'buy' | 'sell'; lo: number; hi: number; bornI: number }
  const pend: Fvg[] = [];
  let cd = 0;
  const windows: [number, number][] = [[9, 11], [17, 19]];   // لندن SB + نيويورك AM SB (دمشق)
  return {
    name: `C4 Silver Bullet FVG (min=${minFvgAtr}×ATR, val=${validBars}, cd=${cooldownBars})`,
    onBar(ctx) {
      cd = Math.max(0, cd - 1);
      const { i, bar, c5, atr5 } = ctx;
      if (i < 2) return null;
      const a = atr5[i] || 2;
      const hh = ((ctx.closeT + 3 * 3600e3) % 86400e3) / 3600e3;
      const inWin = windows.some(([x, y]) => hh >= x && hh < y);
      // تكوين FVG (3 شموع مكتملة: 1 و3)
      const c1 = c5[i - 2], c3 = bar;
      if (inWin && c3.l > c1.h && (c3.l - c1.h) >= minFvgAtr * a) {
        pend.push({ dir: 'buy', lo: c1.h, hi: c3.l, bornI: i });
      }
      if (inWin && c3.h < c1.l && (c1.l - c3.h) >= minFvgAtr * a) {
        pend.push({ dir: 'sell', lo: c3.h, hi: c1.l, bornI: i });
      }
      // إزالة المنتهية
      for (let k = pend.length - 1; k >= 0; k--) if (i - pend[k].bornI > validBars) pend.splice(k, 1);
      if (!inWin || cd > 0) return null;
      // ارتداد نحو الفجوة
      for (let k = 0; k < pend.length; k++) {
        const f = pend[k];
        if (f.dir === 'buy' && bar.l <= f.hi && bar.c > f.lo) {
          pend.splice(k, 1); cd = cooldownBars;
          return { dir: 'buy', slRaw: f.lo - 0.25 * a, tag: 'SB-FVG' };
        }
        if (f.dir === 'sell' && bar.h >= f.lo && bar.c < f.hi) {
          pend.splice(k, 1); cd = cooldownBars;
          return { dir: 'sell', slRaw: f.hi + 0.25 * a, tag: 'SB-FVG' };
        }
      }
      return null;
    },
  };
}

// ============ C5 — Asian Range Sweep at London (Judas Swing) ============
function mkAsiaSweep(windowH: number, cooldownBars: number): Cand {
  let cdBuy = 0, cdSell = 0;
  let day = '', aH = 0, aL = 0;
  return {
    name: `C5 Asia Sweep→London (win≤${windowH}h, cd=${cooldownBars})`,
    onBar(ctx) {
      const dk = dayKey(ctx.closeT);
      if (dk !== day) { day = dk; aH = 0; aL = 0; cdBuy = 0; cdSell = 0; }
      cdBuy = Math.max(0, cdBuy - 1); cdSell = Math.max(0, cdSell - 1);
      const hh = ((ctx.closeT + 3 * 3600e3) % 86400e3) / 3600e3;
      // بناء رينج آسيا 00:00–06:00 دمشق
      if (hh < 6) {
        aH = aH === 0 ? ctx.bar.h : Math.max(aH, ctx.bar.h);
        aL = aL === 0 ? ctx.bar.l : Math.min(aL, ctx.bar.l);
        return null;
      }
      if (hh >= 6 && hh < 6 + windowH) {
        if (aH - aL < 3) return null;    // رينج آسيا ضيق جداً
        const a = ctx.atr5[ctx.i] || 2;
        if (ctx.bar.l < aL && ctx.bar.c > aL && cdBuy === 0 && killzone(ctx.closeT)) {
          cdBuy = cooldownBars;
          return { dir: 'buy', slRaw: ctx.bar.l - 0.1 * a, tag: 'ASIA-SWEEP' };
        }
        if (ctx.bar.h > aH && ctx.bar.c < aH && cdSell === 0 && killzone(ctx.closeT)) {
          cdSell = cooldownBars;
          return { dir: 'sell', slRaw: ctx.bar.h + 0.1 * a, tag: 'ASIA-SWEEP' };
        }
      }
      return null;
    },
  };
}

// ============================================================
// المحاكي الموحّد — مطابق لمحرك backtest.ts
// ============================================================
interface SimTrade { entryT: number; dir: 'buy' | 'sell'; entry: number; sl: number; tp: number; exitT: number; exit: number; result: string; pnl: number; tag: string }

function simulate(c5: Candle[], cand: Cand) {
  let sigCount = 0;
  const e14 = ema(c5.map(x => x.c), 14);
  const e18 = ema(c5.map(x => x.c), 18);
  const e24 = ema(c5.map(x => x.c), 24);
  const atr5 = atr(c5, 14);

  const trades: SimTrade[] = [];
  let open: SimTrade | null = null;
  let balance = 1000;
  const dayAgg = new Map<string, { startBal: number; peak: number; trades: number; net: number; capped: boolean; targetHit: boolean }>();
  let curDay = '';
  const rollDay = (t: number) => {
    const k = dayKey(t);
    if (k !== curDay) {
      curDay = k;
      if (!dayAgg.has(k)) dayAgg.set(k, { startBal: balance, peak: balance, trades: 0, net: 0, capped: false, targetHit: false });
    }
    const d = dayAgg.get(k)!;
    if (balance > d.peak) d.peak = balance;
  };

  // PDH/PDL: قمة/قاع يوم UTC السابق
  let utcDay = -1, dayHi = 0, dayLo = 0, pdh = 0, pdl = 0;

  const startI = 30;
  const lastI = c5.length - 2;   // آخر شمعة مغلقة
  for (let i = startI; i <= lastI; i++) {
    const bar = c5[i];
    const closeT = bar.t + TF5;
    // تحديث يوم UTC → PDH/PDL
    const ud = Math.floor(bar.t / 86400e3);
    if (ud !== utcDay) { utcDay = ud; pdh = dayHi; pdl = dayLo; dayHi = bar.h; dayLo = bar.l; }
    else { dayHi = Math.max(dayHi, bar.h); dayLo = Math.min(dayLo, bar.l); }

    rollDay(closeT);
    const d = dayAgg.get(curDay)!;

    // إشارة المرسّح تُحسب كل شمعة (حتى تتقدم حالته الداخلية دائماً — كمحرك smc)
    const sig = cand.onBar({ i, t: bar.t, closeT, bar, c5, atr5, e14, e18, e24, pdh, pdl, asiaHigh: 0, asiaLow: 0 });
    if (sig) sigCount++;

    // بوابات الانضباط تُقيَّم قبل إغلاقات هذه الشمعة (مطابق للمحرك: الدخول قبل الإدارة)
    const ddPct = d.peak > 0 ? (d.peak - balance) / d.peak * 100 : 0;
    const cappedNow = ddPct >= 10;
    if (cappedNow) d.capped = true;
    const dayPct = d.startBal > 0 ? d.net / d.startBal * 100 : 0;
    const targetNow = d.trades >= 10 && dayPct >= 3;
    if (targetNow) d.targetHit = true;

    // دخول جديد؟ (بعد فحص كل بوابات الانضباط — صفقة واحدة فقط)
    if (sig && !open && !cappedNow && !targetNow) {
      const entry = bar.c;
      let risk = Math.abs(entry - sig.slRaw);
      if (Number.isFinite(risk) && risk > 0) {
        risk = clamp(risk, MIN_SL, MAX_SL);
        const sl = sig.dir === 'buy' ? entry - risk : entry + risk;
        const tp = sig.dir === 'buy' ? entry + TP_USD : entry - TP_USD;
        open = { entryT: closeT, dir: sig.dir, entry, sl, tp, exitT: 0, exit: 0, result: '', pnl: 0, tag: sig.tag };
      }
    }

    // إدارة الصفقة المفتوحة (مطابق للمحرك: من الشمعة التالية، وقف أولاً)
    if (open && closeT > open.entryT) {
      if (open.dir === 'buy') {
        if (bar.l <= open.sl) { open.exit = open.sl; open.exitT = closeT; open.result = 'sl'; }
        else if (bar.h >= open.tp) { open.exit = open.tp; open.exitT = closeT; open.result = 'tp'; }
      } else {
        if (bar.h >= open.sl) { open.exit = open.sl; open.exitT = closeT; open.result = 'sl'; }
        else if (bar.l <= open.tp) { open.exit = open.tp; open.exitT = closeT; open.result = 'tp'; }
      }
      if (open.exitT === 0 && closeT >= open.entryT + TIME_STOP * TF5) {
        open.exit = bar.c; open.exitT = closeT; open.result = 'time';
      }
      if (open.exitT !== 0) {
        const move = open.dir === 'buy' ? open.exit - open.entry : open.entry - open.exit;
        open.pnl = move - SPREAD;
        balance += open.pnl;
        d.trades++; d.net += open.pnl;
        if (balance > d.peak) d.peak = balance;
        trades.push(open);
        cand.onTradeClosed?.(open.tag, open.dir);
        open = null;
      }
    }

  }
  return { trades, dayAgg, sigCount };
}

// ============================================================
// التقرير
// ============================================================
function report(name: string, trades: SimTrade[], dayAgg: Map<string, { startBal: number; peak: number; trades: number; net: number; capped: boolean; targetHit: boolean }>, spanMs: number, split = 0.7) {
  const n = trades.length;
  if (!n) { console.log(`  ${name}: لا صفقات`); return; }
  const wins = trades.filter(t => t.pnl > 0).length;
  const gw = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const gl = Math.abs(trades.filter(t => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0));
  const net = trades.reduce((a, t) => a + t.pnl, 0);
  let bal = 1000, peak = 1000, maxDD = 0;
  for (const t of trades) { bal += t.pnl; peak = Math.max(peak, bal); maxDD = Math.max(maxDD, peak - bal); }
  const activeDays = [...dayAgg.values()].filter(d => d.trades > 0).length;
  const days10 = [...dayAgg.values()].filter(d => d.trades >= 10).length;
  const capped = [...dayAgg.values()].filter(d => d.capped).length;
  const target = [...dayAgg.values()].filter(d => d.targetHit).length;
  const days = Math.max(1, spanMs / 86400e3);
  const midT = trades[0].entryT + (trades[n - 1].entryT - trades[0].entryT) * split;
  const oos = trades.filter(t => t.entryT >= midT);
  const oosNet = oos.reduce((a, t) => a + t.pnl, 0);
  const oosWR = oos.length ? oos.filter(t => t.pnl > 0).length / oos.length * 100 : 0;
  const byRes = { tp: trades.filter(t => t.result === 'tp').length, sl: trades.filter(t => t.result === 'sl').length, time: trades.filter(t => t.result === 'time').length };
  console.log(`  ${name}`);
  console.log(`    صفقات=${n} (tp=${byRes.tp}/sl=${byRes.sl}/time=${byRes.time}) — نجاح=${(wins / n * 100).toFixed(1)}% — PF=${gl > 0 ? (gw / gl).toFixed(2) : '∞'} — صافي=${net.toFixed(0)}$ — DD=${(maxDD / 10).toFixed(1)}%`);
  console.log(`    صفقات/يوم=${(n / days).toFixed(1)} — أيام ≥10 صفقات=${days10}/${[...dayAgg.values()].length} — قاطع مفعّل=${capped} — هدف يومي=${target} — OOS: صافي=${oosNet.toFixed(0)}$ نجاح=${oosWR.toFixed(1)}% (n=${oos.length})`);
}

async function main() {
  const s = mt5Feed();
  const c5 = (s.tfs['5m'] ?? []) as Candle[];
  console.log(`=== بحث v3: ${c5.length} شمعة 5m حقيقية (${new Date(c5[0].t).toISOString().slice(0, 10)} → ${new Date(c5[c5.length - 1].t).toISOString().slice(0, 10)}) ===`);
  const spanMs = c5[c5.length - 1].t - c5[0].t;

  const cands: Cand[] = [];
  const mk = (cd: number, maxW = 0, buf = 0, w: number[] = [6], alt = true, rps = false, minAtr = 0, dead = false) =>
    cands.push(mkORB2({ orMin: 15, minW: 1, maxW, maxTry: 99, resetPerSession: rps, windows: w, bufferAtr: buf, minAtr, cdBars: cd, trendH1: false, alternating: alt, deadInvalid: dead }));
  // البطل + مقارنة دلالة النطاق غير الصالح (شمعة واحدة مقابل تعطيل اليوم كاملاً)
  mk(12, 8, 0, [6], true, false, 1, false);   // مرجع البطل (تخطيط شمعة واحدة)
  mk(12, 8, 0, [6], true, false, 1, true);    // نطاق غير صالح = يوم ميت
  mk(12, 0, 0, [6], true, false, 1, true);    // يوم ميت بلا فلتر عرض
  mk(12, 8, 0, [6], true, false, 0, true);    // يوم ميت بلا فلتر ATR

  console.log(`\n---------- نتائج المرشّحين (نفس طبقة الانضباط: هدف 10$، وقف 10–15$، صفقة واحدة) ----------`);
  for (const cand of cands) {
    const { trades, dayAgg, sigCount } = simulate(c5, cand);
    console.log(`    [إشارات=${sigCount}]`);
    report(cand.name, trades, dayAgg, spanMs);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
