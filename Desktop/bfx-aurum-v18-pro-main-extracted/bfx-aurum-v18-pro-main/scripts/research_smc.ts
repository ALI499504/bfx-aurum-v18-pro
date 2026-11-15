// ============================================================
// سكربت بحث v2: استراتيجية SMC PRO «S — Smart Money Sweep»
// نموذج المحترفين (ICT/SMC — المرجع: joshyattridge/smart-money-concepts 2.1k★
// و ICT Silver Bullet) ملزمة بالقواعد السبع للمالك:
// 1) منطقة = طرف شدو MN1/W1/D1، ستوب خلف الطرف بهامش 0.1-0.2×ATR(فريم المنطقة)
// 2) الاختيار = الأقرب الأقوى ضمن 3×ATR، أولوية M>W>D، التقاطع/رقم نفسي/مستوى مؤكد/ذيل كبير/عمر
// 3) أول لمسة شرط صلاحية؛ لمسات الصغيرة لا تلغي؛ ملمسة مرفوضة بقوة تبقى صالحة
// 4) إغلاق جسم خارج المنطقة على فريم المنطقة = إبطال؛
//    اختراق بالذيل مع إغلاق راجع داخل المنطقة = Liquidity Sweep (رفض إيجابي)
// 5) الدخول = رفض + تأكيد M15/M5 (Liquidity Sweep) — الاحترافي: إزاحة + FVG retrace
// 6) الهدف = أقرب منطقة معاكسة قوية (fallback entry±3R)
// 7) بوابة R:R >= 2 إلزامية
// ============================================================
import { readFileSync } from 'fs';
import { Candle, TF_MS } from '../src/lib/engine/types';

// ---------- تحميل البيانات الحقيقية ----------
const toCandles = (rows: unknown[]): Candle[] =>
  (rows as [number, number, number, number, number, number][])
    .filter(r => Array.isArray(r) && r.length >= 5 && Number.isFinite(r[0]) && r[0] > 0 && r[2] >= r[3])
    .map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] ?? 0 }));

const snap = JSON.parse(readFileSync('db/mt5-feed-snapshot.json', 'utf8'));
const tfs: Record<string, unknown[]> = snap.tfs;
const c5 = toCandles(tfs['5m']);
const c15raw = toCandles(tfs['15m']);
const c1d = toCandles(tfs['1d']);
const c1w = toCandles(tfs['1w']);
const c1M = toCandles(tfs['1M']);

const aggregate = (base: Candle[], ms: number): Candle[] => {
  const out: Candle[] = []; let cur: Candle | null = null;
  for (const c of base) {
    const b = Math.floor(c.t / ms) * ms;
    if (!cur || cur.t !== b) { if (cur) out.push(cur); cur = { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }; }
    else { cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l); cur.c = c.c; cur.v += c.v; }
  }
  if (cur) out.push(cur);
  return out;
};
const c15 = c15raw.length > c5.length / 4 ? c15raw : aggregate(c5, TF_MS['15m']);

// ---------- ثوابت (القواعد 1-4) ----------
const ATRP = 14;
const BUFFER = 0.15, MIN_WICK = 1.0, TOUCH_TOL = 0.1, MAX_DIST = 3.0;
const SWEEP_MIN = 0.1, SWEEP_BARS = 3, COOLDOWN_BARS = 20, PIPE_TTL = 20;
const ROUND_STEP = 50, ROUND_TOL = 0.25, LVLTOL = 0.3, CROSS_TOL = 0.5;
const SPREAD_D = 0.30;
const MIN_RR = 2.0;      // القاعدة 7
const AGE: Record<ZoneTf, number> = { '1M': 3, '1w': 2, '1d': 1 };
type ZoneTf = '1M' | '1w' | '1d';
type EntryTf = '15m' | '5m';

const nextMonthStart = (t: number): number => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };
const distToRound50 = (p: number): number => Math.abs(p - Math.round(p / ROUND_STEP) * ROUND_STEP);
const FINER: Record<ZoneTf, number> = { '1d': 0, '1w': 1, '1M': 2 };

interface ATRs { atr: number; init: number; prev: number | null }
const newAtr = (): ATRs => ({ atr: 0, init: 0, prev: null });
function stepAtr(s: ATRs, c: Candle): number | null {
  const tr = s.prev === null ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - s.prev), Math.abs(c.l - s.prev));
  s.prev = c.c;
  if (s.init < ATRP) { s.init++; s.atr += (tr - s.atr) / s.init; }
  else s.atr = (s.atr * (ATRP - 1) + tr) / ATRP;
  return s.init >= ATRP ? s.atr : null;
}

interface Zone {
  id: number; tf: ZoneTf; side: 'upper' | 'lower';
  top: number; bottom: number; tip: number; stopRef: number; atr: number;
  state: 'FRESH' | 'TOUCHED' | 'INVALIDATED';
  formedT: number; structural: number; invalidatedT?: number;
}
interface ZState { idx: number; a: ATRs; events: { level: number; side: 'high' | 'low' }[]; levels: Map<string, { level: number; side: 'high' | 'low' }> }

interface Signal {
  t: number; tf: EntryTf; dir: 'buy' | 'sell';
  zoneId: number; zoneTf: ZoneTf; side: 'upper' | 'lower';
  tip: number; zoneTop: number; zoneBottom: number; stopRef: number; zoneAtr: number;
  closePrice: number; sweepExtreme: number;
  fvgLo: number | null; fvgHi: number | null;
  score: number; nearest5: number; nearest6: number;
  target: number | null;
}

class ZoneEngine {
  zones: Zone[] = [];
  private seq = 1;
  private zs: Record<ZoneTf, ZState>;
  private es: Record<EntryTf, { idx: number; a: ATRs }>;
  private pipes = new Map<string, Pipe>();
  private _curT = 0;
  constructor(private c1M: Candle[], private c1w: Candle[], private c1d: Candle[], private c15: Candle[], private c5: Candle[]) {
    const mkZ = (): ZState => ({ idx: 0, a: newAtr(), events: [], levels: new Map() });
    this.zs = { '1M': mkZ(), '1w': mkZ(), '1d': mkZ() };
    this.es = { '15m': { idx: 0, a: newAtr() }, '5m': { idx: 0, a: newAtr() } };
  }
  confluenceNow(z: Zone): boolean {
    for (const o of this.zones) {
      if (o.id === z.id || o.tf === z.tf || o.state === 'INVALIDATED') continue;
      const tol = CROSS_TOL * (FINER[z.tf] <= FINER[o.tf] ? z.atr : o.atr);
      if (Math.abs(z.tip - o.tip) <= tol) return true;
    }
    return false;
  }
  liveScore(z: Zone): number {
    return z.structural + (this.confluenceNow(z) ? 3 : 0) + (z.state === 'FRESH' ? 2 : 0);
  }
  private hasLevel(tf: ZoneTf, side: 'upper' | 'lower', tip: number, atr: number): boolean {
    const want = side === 'upper' ? 'high' : 'low';
    for (const lv of this.zs[tf].levels.values())
      if (lv.side === want && Math.abs(tip - lv.level) <= LVLTOL * atr) return true;
    return false;
  }
  private stepZoneTf(tf: ZoneTf, upToT: number): void {
    const arr = tf === '1M' ? this.c1M : tf === '1w' ? this.c1w : this.c1d;
    const s = this.zs[tf];
    while (s.idx < arr.length) {
      const c = arr[s.idx];
      const closeT = tf === '1M' ? nextMonthStart(c.t) : c.t + TF_MS[tf];
      if (closeT > upToT) break;
      const atr = stepAtr(s.a, c);
      if (atr !== null) {
        const bodyLo = Math.min(c.o, c.c), bodyHi = Math.max(c.o, c.c);
        for (const z of this.zones) {   // القاعدة 4: إبطال بالإغلاق الجسمي الخارج
          if (z.tf !== tf || z.state === 'INVALIDATED' || z.formedT >= closeT) continue;
          if (z.side === 'upper' ? bodyLo > z.top : bodyHi < z.bottom) { z.state = 'INVALIDATED'; z.invalidatedT = closeT; }
        }
        // تكوين منطقة (القاعدة 1)
        const wU = c.h - Math.max(c.o, c.c), wL = Math.min(c.o, c.c) - c.l;
        const upV = wU >= MIN_WICK * atr, loV = wL >= MIN_WICK * atr;
        if (!(upV && loV) && (upV || loV)) {
          const side = upV ? 'upper' as const : 'lower' as const;
          const top = upV ? c.h : Math.min(c.o, c.c);
          const bottom = upV ? Math.max(c.o, c.c) : c.l;
          if (top - bottom >= 0.2 * atr) {
            const tip = upV ? top : bottom;
            const stopRef = upV ? top + BUFFER * atr : bottom - BUFFER * atr;
            const structural = (distToRound50(tip) <= ROUND_TOL * atr ? 2 : 0)
              + (this.hasLevel(tf, side, tip, atr) ? 2 : 0)
              + ((upV ? wU : wL) >= 1.5 * atr ? 1 : 0) + AGE[tf];
            const z: Zone = { id: this.seq++, tf, side, top, bottom, tip, stopRef, atr, state: 'FRESH', formedT: closeT, structural };
            if (this.liveScore(z) >= 5) this.zones.push(z);
          }
        }
        // مستويات مؤكدة (لعنصر confirmedPivot — القاعدة 2)
        for (const ev of s.events) {
          const hit = ev.side === 'high'
            ? c.h >= ev.level && c.h - ev.level <= TOUCH_TOL * atr && c.c < ev.level
            : c.l <= ev.level && ev.level - c.l <= TOUCH_TOL * atr && c.c > ev.level;
          if (hit) {
            const k = `${ev.side}:${ev.level}`;
            if (!s.levels.has(k)) s.levels.set(k, { level: ev.level, side: ev.side });
          }
        }
        if (c.c < c.h) s.events.push({ level: c.h, side: 'high' });
        if (c.c > c.l) s.events.push({ level: c.l, side: 'low' });
      }
      s.idx++;
    }
  }
  nearest(price: number, gate: number): Zone | null {
    let best: Zone | null = null; let bd = Infinity;
    for (const z of this.zones) {
      if (z.state === 'INVALIDATED') continue;
      if (this.liveScore(z) < gate) continue;
      if (Math.abs(price - z.tip) > MAX_DIST * z.atr) continue;
      const d = Math.abs(price - z.tip);
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }
  oppositeTarget(dir: 'buy' | 'sell', entry: number): number | null {
    let best: number | null = null; let bd = Infinity;
    for (const z of this.zones) {
      if (z.state === 'INVALIDATED' || this.liveScore(z) < 5) continue;
      if (dir === 'buy') {
        if (z.side !== 'upper' || z.bottom <= entry) continue;
        const d = z.bottom - entry; if (d < bd) { bd = d; best = z.bottom; }
      } else {
        if (z.side !== 'lower' || z.top >= entry) continue;
        const d = entry - z.top; if (d < bd) { bd = d; best = z.top; }
      }
    }
    return best;
  }
  entryAtr(tf: EntryTf): number | null { const s = this.es[tf]; return s.a.init >= ATRP ? s.a.atr : null; }

  advance(upToT: number, dispMult: number, out: Signal[]): void {
    this._curT = upToT;
    this.stepZoneTf('1M', upToT); this.stepZoneTf('1w', upToT); this.stepZoneTf('1d', upToT);
    this.stepEntry('15m', this.c15, dispMult, out);
    this.stepEntry('5m', this.c5, dispMult, out);
  }

  /**
   * النموذج الاحترافي (القاعدة 5): لمسة → سحب (اختراق الطرف) → استعادة داخل المنطقة
   * خلال ≤3 شموع من الاختراق بشمعة إزاحة (جسم ≥ disp×ATR) → FVG بنمط 3 شموع
   * (شمعة الاستعادة وسطه) يؤكد بإغلاق الشمعة التالية → دخول بارتداد على منتصف الفجوة
   * أو fallback بإغلاق شمعة التأكيد.
   */
  private stepEntry(tf: EntryTf, arr: Candle[], dispMult: number, out: Signal[]): void {
    const st = this.es[tf];
    while (st.idx < arr.length && arr[st.idx].t + TF_MS[tf] <= this._curT) {
      const n = st.idx; const c = arr[n]; const closeT = c.t + TF_MS[tf];
      const atr = stepAtr(st.a, c);
      if (atr !== null) {
        for (const z of this.zones) {
          if (z.state === 'INVALIDATED') continue;
          const key = `${z.id}:${tf}`;
          let p = this.pipes.get(key) ?? null;
          // انتهاء صلاحية الأنبوب (20 شمعة بلا سحب)
          if (p && !p.swept && n > p.touchIdx + PIPE_TTL) { this.pipes.delete(key); p = null; }
          const inZone = c.l <= z.top && c.h >= z.bottom;
          const touch = inZone || (z.side === 'upper' ? c.l <= z.top : c.h >= z.bottom);
          if (touch) {
            if (z.state === 'FRESH') z.state = 'TOUCHED';   // القاعدة 3
            if (!p) p = { touchIdx: n, swept: false, sweptIdx: -1, extreme: z.side === 'upper' ? c.h : c.l, rejIdx: -1 };
            this.pipes.set(key, p);
          }
          if (!p) continue;
          // السحب: اختراق الطرف بـ > 0.1×ATR (سحب السيولة خلف الطرف)
          if (!p.swept) {
            const pierce = z.side === 'upper'
              ? c.h > z.tip + SWEEP_MIN * atr : c.l < z.tip - SWEEP_MIN * atr;
            if (pierce) { p.swept = true; p.sweptIdx = n; }
          }
          if (p.swept) p.extreme = z.side === 'upper' ? Math.max(p.extreme, c.h) : Math.min(p.extreme, c.l);
          if (p.rejIdx < 0) {
            if (!p.swept || n > p.sweptIdx + SWEEP_BARS - 1) continue;   // الاستعادة خلال ≤3 شموع من الاختراق
            // الاستعادة داخل المنطقة (القاعدة 4 حرفياً) + إزاحة Displacement
            const reclaim = z.side === 'upper' ? c.c < z.tip : c.c > z.tip;
            if (!reclaim) continue;
            const body = Math.abs(c.c - c.o);
            if (body < dispMult * atr) continue;
            p.rejIdx = n;
            continue;   // التأكيد النهائي عند إغلاق الشمعة التالية (نمط FVG)
          }
          // إغلاق الشمعة التالية للاستعادة = لحظة كشف FVG (بلا تسلل مستقبلي)
          if (n === p.rejIdx + 1) {
            let fvgLo: number | null = null, fvgHi: number | null = null;
            if (z.side === 'lower') {          // شراء: FVG صاعد — l[n] > h[n-2] والاستعادة وسط النمط
              const gapLo = arr[n - 2].h, gapHi = c.l;
              if (gapHi > gapLo && gapHi - gapLo >= 0.05 * atr) { fvgLo = gapLo; fvgHi = gapHi; }
            } else {                            // بيع: FVG هابط — h[n] < l[n-2]
              const gapLo = c.h, gapHi = arr[n - 2].l;
              if (gapLo < gapHi && gapHi - gapLo >= 0.05 * atr) { fvgLo = gapLo; fvgHi = gapHi; }
            }
            const dir = z.side === 'lower' ? 'buy' as const : 'sell' as const;
            const score = this.liveScore(z);
            const n5 = this.nearest(c.c, 5), n6 = this.nearest(c.c, 6);
            const entryGuess = fvgLo !== null ? (fvgLo + (fvgHi as number)) / 2 : c.c;
            const target = this.oppositeTarget(dir, entryGuess);
            out.push({
              t: closeT, tf, dir, zoneId: z.id, zoneTf: z.tf, side: z.side,
              tip: z.tip, zoneTop: z.top, zoneBottom: z.bottom, stopRef: z.stopRef, zoneAtr: z.atr,
              closePrice: c.c, sweepExtreme: p.extreme,
              fvgLo, fvgHi, score, nearest5: n5?.id ?? -1, nearest6: n6?.id ?? -1, target,
            });
            this.pipes.delete(key);
          } else if (n > p.rejIdx + 1) {
            this.pipes.delete(key);
          }
        }
      }
      st.idx++;
    }
  }
}

// ---------- المتغيرات ----------
interface Variant { kz: string; entry: 'fvg' | 'close'; disp: number; score: number; be: boolean; stop: 'ref' | 'extreme' }
const KZ_WINDOWS: Record<string, [number, number][]> = {
  none: [], ldn: [[10, 13]], ny: [[16.5, 19.5]], sb: [[17, 18]], both: [[10, 13], [16.5, 19.5]],
};
const inKz = (t: number, kz: string): boolean => {
  const wins = KZ_WINDOWS[kz]; if (!wins.length) return true;
  const h = ((t + 3 * 3600e3) % 86400e3) / 3600e3;
  const wd = new Date(t + 3 * 3600e3).getUTCDay();
  if (wd === 6) return false;
  return wins.some(([a, b]) => h >= a && h < b);
};

interface Trade { dir: 'buy' | 'sell'; entryT: number; exitT: number; entry: number; exit: number; sl: number; tp: number; zoneId: number; pnl: number }

function simulate(v: Variant, signals: Signal[], c5arr: Candle[]): { trades: Trade[]; blocked: Record<string, number> } {
  const trades: Trade[] = [];
  const blocked: Record<string, number> = {};
  const bump = (k: string) => { blocked[k] = (blocked[k] ?? 0) + 1; };
  const sigs = [...signals].sort((a, b) => a.t - b.t || (a.tf === '15m' ? -1 : 1));
  let si = 0;
  const orders: { sig: Signal; limit: number; sl: number; tp: number; expireIdx: number }[] = [];
  const open: Trade[] = [];
  const cooldown = new Map<number, number>();
  const zoneOpen = new Set<number>();
  const closeTrade = (tr: Trade, exit: number, atT: number) => {
    tr.exit = exit; tr.exitT = atT;
    const move = tr.dir === 'buy' ? exit - tr.entry : tr.entry - exit;
    tr.pnl = move - SPREAD_D;
    const ki = open.indexOf(tr); if (ki >= 0) open.splice(ki, 1);
    zoneOpen.delete(tr.zoneId);
    trades.push(tr);
  };
  for (let i = 0; i < c5arr.length; i++) {
    const bar = c5arr[i]; const closeT = bar.t + TF_MS['5m'];
    // 1) إشارات عند هذا الإغلاق
    while (si < sigs.length && sigs[si].t <= closeT) {
      const s = sigs[si++];
      if (!inKz(s.t, v.kz)) { bump('kz'); continue; }
      const nearestId = v.score === 6 ? s.nearest6 : s.nearest5;
      if (s.score < v.score || nearestId !== s.zoneId) { bump('score_or_nearest'); continue; }
      if (zoneOpen.has(s.zoneId) || (cooldown.get(s.zoneId) ?? 0) > s.t) { bump('zone_busy'); continue; }
      // الوقف (القاعدة 1): خلف الطرف بهامش ≥0.1×ATR(فريم المنطقة)، يتوسع خلف extreme السحب
      const sl = v.stop === 'ref' ? s.stopRef
        : s.dir === 'buy' ? Math.min(s.stopRef, s.sweepExtreme - 0.1 * s.zoneAtr)
        : Math.max(s.stopRef, s.sweepExtreme + 0.1 * s.zoneAtr);
      const limit = v.entry === 'fvg' && s.fvgLo !== null ? ((s.fvgLo as number) + (s.fvgHi as number)) / 2 : null;
      const entry0 = limit ?? s.closePrice;
      const risk = Math.abs(entry0 - sl);
      if (!(risk > 0) || !Number.isFinite(risk)) { bump('fail_safe'); continue; }
      // الهدف (القاعدة 6) + بوابة R:R (القاعدة 7)
      const tp = s.target ?? (s.dir === 'buy' ? entry0 + 3 * risk : entry0 - 3 * risk);
      const reward = Math.abs(tp - entry0);
      if (reward / risk < MIN_RR) { bump('rr'); continue; }
      if (limit !== null) {
        orders.push({ sig: s, limit, sl, tp, expireIdx: i + 12 });
      } else {
        const tr: Trade = { dir: s.dir, entryT: s.t, exitT: 0, entry: s.closePrice, exit: 0, sl, tp, zoneId: s.zoneId, pnl: 0 };
        open.push(tr); zoneOpen.add(s.zoneId); cooldown.set(s.zoneId, s.t + COOLDOWN_BARS * TF_MS['5m']);
      }
    }
    // 2) ملء أوامر Limit (صلاحية 12 شمعة M5)
    for (let k = orders.length - 1; k >= 0; k--) {
      const o = orders[k];
      if (i > o.expireIdx) { orders.splice(k, 1); bump('limit_expired'); continue; }
      if (zoneOpen.has(o.sig.zoneId)) { orders.splice(k, 1); bump('limit_zone_busy'); continue; }
      const fill = o.sig.dir === 'buy' ? bar.l <= o.limit : bar.h >= o.limit;
      if (!fill) continue;
      orders.splice(k, 1);
      const tr: Trade = { dir: o.sig.dir, entryT: closeT, exitT: 0, entry: o.limit, exit: 0, sl: o.sl, tp: o.tp, zoneId: o.sig.zoneId, pnl: 0 };
      open.push(tr); zoneOpen.add(tr.zoneId); cooldown.set(tr.zoneId, closeT + COOLDOWN_BARS * TF_MS['5m']);
      if (tr.dir === 'buy' && bar.l <= tr.sl) closeTrade(tr, tr.sl, closeT);        // متحفظ
      else if (tr.dir === 'sell' && bar.h >= tr.sl) closeTrade(tr, tr.sl, closeT);
    }
    // 3) إدارة: وقف أولاً + BE بعد +1R (يُفعَّل من الشمعة التالية)
    for (let k = open.length - 1; k >= 0; k--) {
      const tr = open[k];
      if (tr.exitT || tr.entryT >= closeT) continue;
      const riskD = Math.abs(tr.entry - tr.sl);
      if (v.be && riskD > 0) {
        const beLevel = tr.dir === 'buy' ? tr.entry + SPREAD_D + 0.05 : tr.entry - SPREAD_D - 0.05;
        const hit1R = tr.dir === 'buy' ? bar.h >= tr.entry + riskD : bar.l <= tr.entry - riskD;
        if (hit1R) tr.sl = tr.dir === 'buy' ? Math.max(tr.sl, beLevel) : Math.min(tr.sl, beLevel);
      }
      if (tr.dir === 'buy') {
        if (bar.l <= tr.sl) closeTrade(tr, tr.sl, closeT);
        else if (bar.h >= tr.tp) closeTrade(tr, tr.tp, closeT);
      } else {
        if (bar.h >= tr.sl) closeTrade(tr, tr.sl, closeT);
        else if (bar.l <= tr.tp) closeTrade(tr, tr.tp, closeT);
      }
    }
  }
  const last = c5arr[c5arr.length - 1];
  for (const tr of [...open]) if (!tr.exitT) closeTrade(tr, last.c, last.t + TF_MS['5m']);
  return { trades, blocked };
}

// ---------- التشغيل ----------
const lastClosed = (() => { let k = c5.length - 1; while (k >= 0 && c5[k].t + TF_MS['5m'] > Date.now()) k--; return k; })();
const endT = c5[lastClosed].t + TF_MS['5m'];
const startT = c5[0].t;
const IS_T = startT + (endT - startT) * 0.7;
console.log(`5m: ${c5.length} | نهاية البيانات: ${new Date(endT).toISOString()} | فصل IS/OOS عند: ${new Date(IS_T).toISOString()}`);

const variants: Variant[] = [];
for (const kz of ['none', 'ldn', 'ny', 'sb', 'both'])
  for (const entry of ['fvg', 'close'] as const)
    for (const disp of [0.6, 1.0])
      for (const score of [5, 6])
        for (const be of [false, true])
          for (const stop of ['ref', 'extreme'] as const)
            variants.push({ kz, entry, disp, score, be, stop });

const dispVals = [0.6, 1.0];
const signalsByDisp = new Map<number, Signal[]>();
for (const disp of dispVals) {
  const eng = new ZoneEngine(c1M, c1w, c1d, c15, c5);
  const sigs: Signal[] = [];
  for (let i = 0; i <= lastClosed; i++) {
    const t = c5[i].t + TF_MS['5m'];
    eng.advance(t, disp, sigs);
  }
  signalsByDisp.set(disp, sigs);
  console.log(`disp=${disp}: ${sigs.length} إشارة`);
}

const stat = (trades: Trade[]) => {
  const wins = trades.filter(t => t.pnl > 0).length;
  const net = trades.reduce((a, t) => a + t.pnl, 0);
  const gw = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const gl = Math.abs(trades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
  return { n: trades.length, wr: trades.length ? wins / trades.length * 100 : 0, net, pf: gl > 0 ? gw / gl : gw > 0 ? 99 : 0 };
};

const rows: { v: Variant; is: ReturnType<typeof stat>; oos: ReturnType<typeof stat>; all: ReturnType<typeof stat> }[] = [];
for (const v of variants) {
  const sigs = signalsByDisp.get(v.disp)!;
  const { trades } = simulate(v, sigs, c5);
  const isT = trades.filter(t => t.entryT < IS_T);
  const oosT = trades.filter(t => t.entryT >= IS_T);
  rows.push({ v, is: stat(isT), oos: stat(oosT), all: stat(trades) });
}
rows.sort((a, b) => b.oos.wr - a.oos.wr || b.oos.n - a.oos.n);

console.log('\n==== أفضل 25 حسب WR خارج العينة (OOS = آخر 30% من الفترة) ====');
console.log('kz|entry|disp|score|be|stop | IS(n,wr%,net) | OOS(n,wr%,net) | ALL(n,wr%,net,pf)');
for (const r of rows.slice(0, 25)) {
  const { kz, entry, disp, score, be, stop } = r.v;
  console.log(`${kz.padEnd(5)}|${entry.padEnd(5)}|${disp}|${score}|${be ? 'Y' : 'N'}|${stop.padEnd(7)} | IS(${r.is.n}, ${r.is.wr.toFixed(1)}%, ${r.is.net.toFixed(0)}$) | OOS(${r.oos.n}, ${r.oos.wr.toFixed(1)}%, ${r.oos.net.toFixed(0)}$) | ALL(${r.all.n}, ${r.all.wr.toFixed(1)}%, ${r.all.net.toFixed(0)}$, pf ${r.all.pf.toFixed(2)})`);
}
console.log('\n==== أعلى 15 حسب WR الكلي مع n>=60 ====');
for (const r of rows.filter(r => r.all.n >= 60).sort((a, b) => b.all.wr - a.all.wr).slice(0, 15)) {
  const { kz, entry, disp, score, be, stop } = r.v;
  console.log(`${kz.padEnd(5)}|${entry.padEnd(5)}|${disp}|${score}|${be ? 'Y' : 'N'}|${stop.padEnd(7)} | ALL(${r.all.n}, ${r.all.wr.toFixed(1)}%, ${r.all.net.toFixed(0)}$, pf ${r.all.pf.toFixed(2)}) | OOS(${r.oos.n}, ${r.oos.wr.toFixed(1)}%, ${r.oos.net.toFixed(0)}$)`);
}
