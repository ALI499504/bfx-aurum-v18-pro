// ============================================================
// بحث نهائي v5: استراتيجية SMC PRO «S — Smart Money Sweep»
// ICT/SMC — المراجع: joshyattridge/smart-money-concepts (2.1k★)، ICT Silver Bullet
// ملزمة بالقواعد السبع للمالك (المناطق/الاختيار/الصلاحية/الإبطال/التأكيد/الهدف/R:R)
// إدارة احترافية: جني جزئي 50% عند +1R + تعادل / تعادل عند +1R / وقف زمني
// القاعدة 3 حرفياً: المنطقة الملمسة تحتاج تأكيداً أقوى (Sweep بدل BOS)
// ============================================================
import { readFileSync } from 'fs';
import { Candle, TF_MS } from '../src/lib/engine/types';

const toCandles = (rows: unknown[]): Candle[] =>
  (rows as [number, number, number, number, number, number][])
    .filter(r => Array.isArray(r) && r.length >= 5 && Number.isFinite(r[0]) && r[0] > 0 && r[2] >= r[3])
    .map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] ?? 0 }));

const snap = JSON.parse(readFileSync('db/research/mt5-feed-snapshot.json', 'utf8'));
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
const TOUCH_TOL = 0.1, MAX_DIST = 3.0;
const SWEEP_MIN = 0.1, SWEEP_BARS = 3, PIPE_TTL = 30, COOLDOWN = 96;
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
interface EState { idx: number; a: ATRs; swHi: number | null; swLo: number | null }

interface Zone {
  id: number; tf: ZoneTf; side: 'upper' | 'lower';
  top: number; bottom: number; tip: number; stopRef: number; atr: number;
  state: 'FRESH' | 'TOUCHED' | 'INVALIDATED';
  formedT: number; structural: number; invalidatedT?: number;
}
interface ZState { idx: number; a: ATRs; events: { level: number; side: 'high' | 'low' }[]; levels: Map<string, { level: number; side: 'high' | 'low' }> }

interface Pipe {
  touchIdx: number; swept: boolean; sweptIdx: number; extreme: number;
  bosRefHi: number | null; bosRefLo: number | null;
  doneIdx: number; ctype: 'sweep' | 'BOS';
}

interface Signal {
  t: number; tf: EntryTf; dir: 'buy' | 'sell';
  zoneId: number; zoneTf: ZoneTf; side: 'upper' | 'lower'; zstate: 'FRESH' | 'TOUCHED';
  tip: number; zoneTop: number; zoneBottom: number; stopRef: number; zoneAtr: number;
  closePrice: number; sweepExtreme: number;
  fvgLo: number | null; fvgHi: number | null;
  score: number; nearest5: number; nearest7: number;
  target: number | null; ctype: 'sweep' | 'BOS'; atrEntry: number;
}

class ZoneEngine {
  zones: Zone[] = [];
  dbg = { zonesRaw: 0, zonesKept: 0, touches: 0, sweeps: 0, sweepConf: 0, bosConf: 0, sigs: 0 };
  private seq = 1;
  private zs: Record<ZoneTf, ZState>;
  private es: Record<EntryTf, EState>;
  private pipes = new Map<string, Pipe>();
  private _curT = 0;
  constructor(private c1M: Candle[], private c1w: Candle[], private c1d: Candle[], private c15: Candle[], private c5: Candle[], private minWick: number) {
    const mkZ = (): ZState => ({ idx: 0, a: newAtr(), events: [], levels: new Map() });
    this.zs = { '1M': mkZ(), '1w': mkZ(), '1d': mkZ() };
    this.es = { '15m': { idx: 0, a: newAtr(), swHi: null, swLo: null }, '5m': { idx: 0, a: newAtr(), swHi: null, swLo: null } };
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
        for (const z of this.zones) {   // القاعدة 4: إبطال بالإغلاق الجسمي الخارج على فريم المنطقة
          if (z.tf !== tf || z.state === 'INVALIDATED' || z.formedT >= closeT) continue;
          if (z.side === 'upper' ? bodyLo > z.top : bodyHi < z.bottom) { z.state = 'INVALIDATED'; z.invalidatedT = closeT; }
        }
        // تكوين منطقة من طرف الشدو (القاعدة 1)
        const wU = c.h - Math.max(c.o, c.c), wL = Math.min(c.o, c.c) - c.l;
        const upV = wU >= this.minWick * atr, loV = wL >= this.minWick * atr;
        if (!(upV && loV) && (upV || loV)) {
          const side = upV ? 'upper' as const : 'lower' as const;
          const top = upV ? c.h : Math.min(c.o, c.c);
          const bottom = upV ? Math.max(c.o, c.c) : c.l;
          if (top - bottom >= 0.2 * atr) {
            const tip = upV ? top : bottom;
            const stopRef = upV ? top + 0.15 * atr : bottom - 0.15 * atr;
            const structural = (distToRound50(tip) <= ROUND_TOL * atr ? 2 : 0)
              + (this.hasLevel(tf, side, tip, atr) ? 2 : 0)
              + ((upV ? wU : wL) >= 1.5 * atr ? 1 : 0) + AGE[tf];
            const z: Zone = { id: this.seq++, tf, side, top, bottom, tip, stopRef, atr, state: 'FRESH', formedT: closeT, structural };
            this.dbg.zonesRaw++;
            if (this.liveScore(z) >= 5) { this.zones.push(z); this.dbg.zonesKept++; }
          }
        }
        // مستويات مؤكدة (عنصر القوة — القاعدة 2)
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

  advance(upToT: number, dispMult: number, confirm: 'both' | 'sweep', out: Signal[]): void {
    this._curT = upToT;
    this.stepZoneTf('1M', upToT); this.stepZoneTf('1w', upToT); this.stepZoneTf('1d', upToT);
    this.stepEntry('15m', this.c15, dispMult, confirm, out);
    this.stepEntry('5m', this.c5, dispMult, confirm, out);
  }

  /** لمسة → تأكيد (Sweep: اختراق الطرف ثم إغلاق راجع داخله / BOS: كسر آخر قمة/قاع
   *  متأرجح بمرجع مجمّد لحظة اللمسة) بإزاحة ≥ disp×ATR خلال ≤3 شموع →
   *  FVG (نمط 3 شموع) → إشارة عند إغلاق الشمعة التالية. */
  private stepEntry(tf: EntryTf, arr: Candle[], dispMult: number, confirm: 'both' | 'sweep', out: Signal[]): void {
    const st = this.es[tf];
    while (st.idx < arr.length && arr[st.idx].t + TF_MS[tf] <= this._curT) {
      const n = st.idx; const c = arr[n]; const closeT = c.t + TF_MS[tf];
      const atr = stepAtr(st.a, c);
      if (n >= 4) {
        const f = arr[n - 2];
        if (f.h > arr[n - 4].h && f.h > arr[n - 3].h && f.h > arr[n - 1].h && f.h > arr[n].h) st.swHi = f.h;
        if (f.l < arr[n - 4].l && f.l < arr[n - 3].l && f.l < arr[n - 1].l && f.l < arr[n].l) st.swLo = f.l;
      }
      if (atr !== null) {
        for (const z of this.zones) {
          if (z.state === 'INVALIDATED') continue;
          const key = `${z.id}:${tf}`;
          let p = this.pipes.get(key) ?? null;
          if (p && p.doneIdx < 0 && n > p.touchIdx + PIPE_TTL) { this.pipes.delete(key); p = null; }
          const touch = c.l <= z.top && c.h >= z.bottom;
          if (touch) {
            if (z.state === 'FRESH') z.state = 'TOUCHED';   // القاعدة 3
            if (!p) {
              p = { touchIdx: n, swept: false, sweptIdx: -1, extreme: z.side === 'upper' ? c.h : c.l, bosRefHi: st.swHi, bosRefLo: st.swLo, doneIdx: -1, ctype: 'BOS' };
              this.dbg.touches++;
            }
            this.pipes.set(key, p);
          }
          if (!p) continue;
          if (!p.swept) {
            const pierce = z.side === 'upper'
              ? c.h > z.tip + SWEEP_MIN * atr : c.l < z.tip - SWEEP_MIN * atr;
            if (pierce) { p.swept = true; p.sweptIdx = n; this.dbg.sweeps++; }
          }
          if (p.swept) p.extreme = z.side === 'upper' ? Math.max(p.extreme, c.h) : Math.min(p.extreme, c.l);
          if (p.doneIdx < 0) {
            const body = Math.abs(c.c - c.o);
            if (body < dispMult * atr) continue;
            const sweepOk = confirm !== 'bos' ? false : false;   // placeholder
            void sweepOk;
            const sw = p.swept && n - p.sweptIdx <= SWEEP_BARS - 1
              && (z.side === 'upper' ? c.c < z.tip : c.c > z.tip);
            const bo = z.side === 'lower'
              ? p.bosRefHi !== null && c.c > (p.bosRefHi as number)
              : p.bosRefLo !== null && c.c < (p.bosRefLo as number);
            const ok = confirm === 'sweep' ? sw : (sw || bo);
            if (!ok) continue;
            if (sw) this.dbg.sweepConf++; else this.dbg.bosConf++;
            p.doneIdx = n; p.ctype = sw ? 'sweep' : 'BOS';
            continue;
          }
          if (n === p.doneIdx + 1) {
            let fvgLo: number | null = null, fvgHi: number | null = null;
            if (z.side === 'lower') {
              const gapLo = arr[n - 2].h, gapHi = c.l;
              if (gapHi > gapLo && gapHi - gapLo >= 0.05 * atr) { fvgLo = gapLo; fvgHi = gapHi; }
            } else {
              const gapLo = c.h, gapHi = arr[n - 2].l;
              if (gapLo < gapHi && gapHi - gapLo >= 0.05 * atr) { fvgLo = gapLo; fvgHi = gapHi; }
            }
            const dir = z.side === 'lower' ? 'buy' as const : 'sell' as const;
            const score = this.liveScore(z);
            const n5 = this.nearest(c.c, 5), n7 = this.nearest(c.c, 7);
            const entryGuess = fvgLo !== null ? ((fvgLo as number) + (fvgHi as number)) / 2 : c.c;
            const target = this.oppositeTarget(dir, entryGuess);
            out.push({
              t: closeT, tf, dir, zoneId: z.id, zoneTf: z.tf, side: z.side, zstate: z.state,
              tip: z.tip, zoneTop: z.top, zoneBottom: z.bottom, stopRef: z.stopRef, zoneAtr: z.atr,
              closePrice: c.c, sweepExtreme: p.extreme,
              fvgLo, fvgHi, score, nearest5: n5?.id ?? -1, nearest7: n7?.id ?? -1,
              target, ctype: p.ctype, atrEntry: atr,
            });
            this.dbg.sigs++;
            this.pipes.delete(key);
          } else if (n > p.doneIdx + 1) {
            this.pipes.delete(key);
          }
        }
      }
      st.idx++;
    }
  }
}

// ---------- المتغيرات ----------
interface Variant {
  kz: string; entry: 'fvg' | 'close' | 'tip'; disp: number; score: number;
  stop: 'ref' | 'tight'; confirm: 'both' | 'sweep';
  mgmt: 'partial50' | 'p50r07' | 'p50r05' | 'be1R';   // جني جزئي 50% عند 1R/0.7R/0.5R + تعادل، أو تعادل عند 1R
  rule3: boolean;                                      // القاعدة 3: منطقة ملمسة → Sweep فقط
  tf: 'both' | 'm15'; minWick: number;
}
const KZ_WINDOWS: Record<string, [number, number][]> = {
  none: [], ldn: [[10, 13]], ny: [[16.5, 19.5]], sb: [[17, 18]], both: [[10, 13], [16.5, 19.5]],
};
const inKz = (t: number, kz: string): boolean => {
  const wins = KZ_WINDOWS[kz]; if (!wins.length) return true;
  const h = ((t + 3 * 3600e3) % 86400e3) / 3600e3;
  if (new Date(t + 3 * 3600e3).getUTCDay() === 6) return false;
  return wins.some(([a, b]) => h >= a && h < b);
};

interface Trade {
  dir: 'buy' | 'sell'; entryT: number; exitT: number; entry: number; exit: number;
  sl: number; tp: number; zoneId: number; pnl: number;
  halfDone: boolean; banked: number; slOrig: number;
}

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
  const finish = (tr: Trade, atT: number) => {
    const move = tr.dir === 'buy' ? tr.exit - tr.entry : tr.entry - tr.exit;
    tr.pnl = tr.banked + move * (tr.halfDone ? 0.5 : 1) - SPREAD_D;
    const ki = open.indexOf(tr); if (ki >= 0) open.splice(ki, 1);
    zoneOpen.delete(tr.zoneId);
    trades.push(tr);
  };
  for (let i = 0; i < c5arr.length; i++) {
    const bar = c5arr[i]; const closeT = bar.t + TF_MS['5m'];
    while (si < sigs.length && sigs[si].t <= closeT) {
      const s = sigs[si++];
      if (v.tf === 'm15' && s.tf !== '15m') { bump('tf'); continue; }
      if (!inKz(s.t, v.kz)) { bump('kz'); continue; }
      // القاعدة 3 حرفياً: المنطقة الملمسة أضعف → تأكيد أقوى (Sweep)
      if (v.rule3 && s.zstate === 'TOUCHED' && s.ctype === 'BOS') { bump('rule3'); continue; }
      const nearestId = v.score === 7 ? s.nearest7 : s.nearest5;
      if (s.score < v.score || nearestId !== s.zoneId) { bump('score_or_nearest'); continue; }
      if (zoneOpen.has(s.zoneId) || (cooldown.get(s.zoneId) ?? 0) > s.t) { bump('zone_busy'); continue; }
      const FLOOR = 0.1;
      const sl = v.stop === 'ref' ? s.stopRef
        : (s.dir === 'buy'
          ? Math.min(s.tip - FLOOR * s.zoneAtr, s.sweepExtreme - 0.05 * s.atrEntry)
          : Math.max(s.tip + FLOOR * s.zoneAtr, s.sweepExtreme + 0.05 * s.atrEntry));
      const limit = v.entry === 'fvg' && s.fvgLo !== null ? ((s.fvgLo as number) + (s.fvgHi as number)) / 2
        : v.entry === 'tip' ? s.tip : null;
      const entry0 = limit ?? s.closePrice;
      const risk = Math.abs(entry0 - sl);
      if (!(risk > 0) || !Number.isFinite(risk)) { bump('fail_safe'); continue; }
      const tp = s.target ?? (s.dir === 'buy' ? entry0 + 3 * risk : entry0 - 3 * risk);
      const reward = Math.abs(tp - entry0);
      if (reward / risk < MIN_RR) { bump('rr'); continue; }
      if (limit !== null) orders.push({ sig: s, limit, sl, tp, expireIdx: i + 12 });
      else {
        const tr: Trade = { dir: s.dir, entryT: s.t, exitT: 0, entry: s.closePrice, exit: 0, sl, tp, zoneId: s.zoneId, pnl: 0, halfDone: false, banked: 0, slOrig: sl };
        open.push(tr); zoneOpen.add(s.zoneId); cooldown.set(s.zoneId, s.t + COOLDOWN * TF_MS['5m']);
      }
    }
    for (let k = orders.length - 1; k >= 0; k--) {
      const o = orders[k];
      if (i > o.expireIdx) { orders.splice(k, 1); bump('limit_expired'); continue; }
      if (zoneOpen.has(o.sig.zoneId)) { orders.splice(k, 1); bump('limit_zone_busy'); continue; }
      const fill = o.sig.dir === 'buy' ? bar.l <= o.limit : bar.h >= o.limit;
      if (!fill) continue;
      orders.splice(k, 1);
      const tr: Trade = { dir: o.sig.dir, entryT: closeT, exitT: 0, entry: o.limit, exit: 0, sl: o.sl, tp: o.tp, zoneId: o.sig.zoneId, pnl: 0, halfDone: false, banked: 0, slOrig: o.sl };
      open.push(tr); zoneOpen.add(tr.zoneId); cooldown.set(tr.zoneId, closeT + COOLDOWN * TF_MS['5m']);
      if (tr.dir === 'buy' && bar.l <= tr.sl) { tr.exit = tr.sl; finish(tr, closeT); }
      else if (tr.dir === 'sell' && bar.h >= tr.sl) { tr.exit = tr.sl; finish(tr, closeT); }
    }
    for (let k = open.length - 1; k >= 0; k--) {
      const tr = open[k];
      if (tr.exitT || tr.entryT >= closeT) continue;
      const riskD = Math.abs(tr.entry - tr.slOrig);
      const prof = tr.dir === 'buy' ? bar.h - tr.entry : tr.entry - bar.l;
      const partR = v.mgmt === 'p50r07' ? 0.7 : v.mgmt === 'p50r05' ? 0.5 : 1.0;
      if (!tr.halfDone && (v.mgmt === 'partial50' || v.mgmt === 'p50r07' || v.mgmt === 'p50r05') && prof >= partR * riskD) {
        tr.banked = 0.5 * partR * riskD;
        const be = tr.dir === 'buy' ? tr.entry + SPREAD_D + 0.05 : tr.entry - SPREAD_D - 0.05;
        tr.sl = tr.dir === 'buy' ? Math.max(tr.sl, be) : Math.min(tr.sl, be);
        tr.halfDone = true;
      }
      if (!tr.halfDone && v.mgmt === 'be1R' && prof >= riskD) {
        const be = tr.dir === 'buy' ? tr.entry + SPREAD_D + 0.05 : tr.entry - SPREAD_D - 0.05;
        tr.sl = tr.dir === 'buy' ? Math.max(tr.sl, be) : Math.min(tr.sl, be);
      }
      // وقف زمني احترافي: صفقة راكدة 96 شمعة (8 ساعات) → إغلاق بالسوق
      if (!tr.exitT && i - (tr.entryT - TF_MS['5m']) / TF_MS['5m'] > 96) {
        tr.exit = bar.c; finish(tr, closeT); continue;
      }
      if (tr.dir === 'buy') {
        if (bar.l <= tr.sl) { tr.exit = tr.sl; finish(tr, closeT); }
        else if (bar.h >= tr.tp) { tr.exit = tr.tp; finish(tr, closeT); }
      } else {
        if (bar.h >= tr.sl) { tr.exit = tr.sl; finish(tr, closeT); }
        else if (bar.l <= tr.tp) { tr.exit = tr.tp; finish(tr, closeT); }
      }
    }
  }
  const last = c5arr[c5arr.length - 1];
  for (const tr of [...open]) if (!tr.exitT) { tr.exit = last.c; finish(tr, last.t + TF_MS['5m']); }
  return { trades, blocked };
}

// ---------- التشغيل ----------
const lastClosed = (() => { let k = c5.length - 1; while (k >= 0 && c5[k].t + TF_MS['5m'] > Date.now()) k--; return k; })();
const endT = c5[lastClosed].t + TF_MS['5m'];
const startT = c5[0].t;
const IS_T = startT + (endT - startT) * 0.7;
console.log(`5m: ${c5.length} | النهاية: ${new Date(endT).toISOString()} | IS/OOS عند: ${new Date(IS_T).toISOString()}`);

const variants: Variant[] = [];
for (const kz of ['none', 'ldn', 'ny', 'sb', 'both'])
  for (const entry of ['fvg', 'close', 'tip'] as const)
    for (const disp of [0.6, 1.0])
      for (const score of [5, 7])
        for (const stop of ['ref', 'tight'] as const)
          for (const confirm of ['both', 'sweep'] as const)
            for (const mgmt of ['partial50', 'p50r07', 'p50r05', 'be1R'] as const)
              for (const rule3 of [false, true])
                for (const tf of ['both', 'm15'] as const)
                  for (const minWick of [0.5, 1.0])
                    variants.push({ kz, entry, disp, score, stop, confirm, mgmt, rule3, tf, minWick });

const combos: { disp: number; confirm: 'both' | 'sweep'; minWick: number }[] = [];
for (const disp of [0.6, 1.0]) for (const confirm of ['both', 'sweep'] as const) for (const minWick of [0.5, 1.0]) combos.push({ disp, confirm, minWick });
const signalsByCombo = new Map<string, Signal[]>();
for (const { disp, confirm, minWick } of combos) {
  const eng = new ZoneEngine(c1M, c1w, c1d, c15, c5, minWick);
  const sigs: Signal[] = [];
  for (let i = 0; i <= lastClosed; i++) eng.advance(c5[i].t + TF_MS['5m'], disp, confirm, sigs);
  signalsByCombo.set(`${disp}:${confirm}:${minWick}`, sigs);
  console.log(`disp=${disp} confirm=${confirm} minWick=${minWick}: ${sigs.length} إشارة`, JSON.stringify(eng.dbg));
}

const stat = (trades: Trade[]) => {
  const wins = trades.filter(t => t.pnl > 0).length;
  const net = trades.reduce((a, t) => a + t.pnl, 0);
  const gw = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const gl = Math.abs(trades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
  return { n: trades.length, wr: trades.length ? wins / trades.length * 100 : 0, net, pf: gl > 0 ? gw / gl : gw > 0 ? 99 : 0, avg: trades.length ? net / trades.length : 0 };
};

const firstManageable = c5[0].t + TF_MS['5m'];
const runCfg = (v: Variant) => {
  const sigs0 = signalsByCombo.get(`${v.disp}:${v.confirm}:${v.minWick}`)!;
  const sigs = sigs0.filter(s => s.t >= firstManageable);   // بلا إشارات قبل نافذة الإدارة
  return simulate(v, sigs, c5).trades;
};
const CFGS: [string, Variant][] = [
  ['A both|close|d1|s5|tight|p50r05', { kz: 'both', entry: 'close', disp: 1.0, score: 5, stop: 'tight', confirm: 'both', mgmt: 'p50r05', rule3: false, tf: 'both', minWick: 0.5 }],
  ['B ldn |close|d0.6|s5|tight|p50r05', { kz: 'ldn', entry: 'close', disp: 0.6, score: 5, stop: 'tight', confirm: 'both', mgmt: 'p50r05', rule3: false, tf: 'both', minWick: 0.5 }],
  ['C both|close|d1|s5|tight|be1R', { kz: 'both', entry: 'close', disp: 1.0, score: 5, stop: 'tight', confirm: 'both', mgmt: 'be1R', rule3: false, tf: 'both', minWick: 0.5 }],
  ['D both|close|d1|s5|tight|p50r07', { kz: 'both', entry: 'close', disp: 1.0, score: 5, stop: 'tight', confirm: 'both', mgmt: 'p50r07', rule3: false, tf: 'both', minWick: 0.5 }],
];
console.log('==== مقارنة التكوينات (بعد إصلاح الإشارات المبكرة) ====');
for (const [label, v] of CFGS) {
  const tr = runCfg(v);
  const s = stat(tr);
  const isT = tr.filter(t => t.entryT < IS_T), oosT = tr.filter(t => t.entryT >= IS_T);
  const si = stat(isT), so = stat(oosT);
  let bal = 0, peak = 0, dd = 0;
  for (const t of [...tr].sort((a, b) => a.exitT - b.exitT)) { bal += t.pnl; peak = Math.max(peak, bal); dd = Math.max(dd, peak - bal); }
  console.log(`${label.padEnd(36)} | ALL(${s.n}, ${s.wr.toFixed(1)}%, ${s.net >= 0 ? '+' : ''}${s.net.toFixed(0)}$, pf ${s.pf.toFixed(2)}, avg ${s.avg.toFixed(1)}$) | IS(${si.n}, ${si.wr.toFixed(0)}%, ${si.net.toFixed(0)}$) | OOS(${so.n}, ${so.wr.toFixed(0)}%, ${so.net >= 0 ? '+' : ''}${so.net.toFixed(0)}$) | DD ${dd.toFixed(0)}$`);
}
const FINAL = CFGS[0][1];
const trades = runCfg(FINAL);
const st = stat(trades);
console.log('==== التكوين النهائي S v2.0 ====');
console.log(`صفقات: ${st.n} | نسبة النجاح: ${st.wr.toFixed(1)}% | صافي: ${st.net.toFixed(2)}$ | PF: ${st.pf.toFixed(2)} | متوسط: ${st.avg.toFixed(2)}$/صفقة`);
const isT = trades.filter(t => t.entryT < IS_T), oosT = trades.filter(t => t.entryT >= IS_T);
const si = stat(isT), so = stat(oosT);
console.log(`IS (حتى ${new Date(IS_T).toISOString().slice(0,10)}): ${si.n} صفقة، ${si.wr.toFixed(1)}%، ${si.net.toFixed(0)}$`);
console.log(`OOS: ${so.n} صفقة، ${so.wr.toFixed(1)}%، ${so.net.toFixed(0)}$`);

// شهرياً
const mm = new Map<string, { n: number; w: number; net: number }>();
for (const t of trades) {
  const k = new Date(t.entryT + 3 * 3600e3).toISOString().slice(0, 7);
  const m = mm.get(k) ?? { n: 0, w: 0, net: 0 };
  m.n++; if (t.pnl > 0) m.w++; m.net += t.pnl;
  mm.set(k, m);
}
console.log('\nشهرياً (شهر | صفقات | نجاح% | صافي$):');
for (const [k, m] of [...mm.entries()].sort())
  console.log(`${k} | ${m.n} | ${(m.w / m.n * 100).toFixed(0)}% | ${m.net >= 0 ? '+' : ''}${m.net.toFixed(0)}$`);

// شراء/بيع + فريم المنطقة + نوع التأكيد غير متاح في Trade — نضيفه عبر إشارة مطابقة
// دروداون
let bal = 0, peak = 0, dd = 0;
const eq: { t: number; v: number }[] = [];
for (const t of [...trades].sort((a, b) => a.exitT - b.exitT)) {
  bal += t.pnl; peak = Math.max(peak, bal); dd = Math.max(dd, peak - bal);
  eq.push({ t: t.exitT, v: bal });
}
console.log(`\nأقصى تراجع (0.01 لوت): ${dd.toFixed(2)}$ | الرصيد النهائي فوق الأساس: ${bal.toFixed(2)}$`);

// توزيع النتائج
const tp = trades.filter(t => t.pnl >= 5).length;
const be = trades.filter(t => t.pnl > 0 && t.pnl < 5).length;
const sl = trades.filter(t => t.pnl < 0).length;
console.log(`جني كامل/كبير (>=5$): ${tp} | جني جزئي/تعادل (0-5$): ${be} | خسائر: ${sl}`);

// شراء/بيع عبر إعادة التشغيل مع تبويب الاتجاه
const buys = trades.filter(t => t.dir === 'buy'), sells = trades.filter(t => t.dir === 'sell');
for (const [label, arr] of [['شراء', buys], ['بيع', sells]] as const) {
  const s2 = stat(arr);
  console.log(`${label}: ${s2.n} صفقة، ${s2.wr.toFixed(1)}%، ${s2.net >= 0 ? '+' : ''}${s2.net.toFixed(0)}$`);
}
// سنوياً
const yy = new Map<string, { n: number; w: number; net: number }>();
for (const t of trades) {
  const k = new Date(t.entryT + 3 * 3600e3).toISOString().slice(0, 4);
  const m = yy.get(k) ?? { n: 0, w: 0, net: 0 };
  m.n++; if (t.pnl > 0) m.w++; m.net += t.pnl;
  yy.set(k, m);
}
console.log('سنوياً:');
for (const [k, m] of [...yy.entries()].sort())
  console.log(`${k} | ${m.n} | ${(m.w / m.n * 100).toFixed(0)}% | ${m.net >= 0 ? '+' : ''}${m.net.toFixed(0)}$`);
