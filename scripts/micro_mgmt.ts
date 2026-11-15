// اختبار مصغر: سقف جني النصف المتبقي على أفضل طبقتي كشف
import { readFileSync } from 'fs';
import { Candle, TF_MS } from '../src/lib/engine/types';

const toCandles = (rows: unknown[]): Candle[] =>
  (rows as [number, number, number, number, number, number][])
    .filter(r => Array.isArray(r) && r.length >= 5 && Number.isFinite(r[0]) && r[0] > 0 && r[2] >= r[3])
    .map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] ?? 0 }));

const snap = JSON.parse(readFileSync('db/research/mt5-feed-snapshot.json', 'utf8'));
const t: Record<string, unknown[]> = snap.tfs;
const c5 = toCandles(t['5m']);
const c15raw = toCandles(t['15m']);
const c1d = toCandles(t['1d']);
const c1w = toCandles(t['1w']);
const c1M = toCandles(t['1M']);
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
const c15 = c15raw;

// نسخة مصغرة من المحرك — نفس منطق research_final (disp/score/stop/confirm مضمنة بالتكوين)
const ATRP = 14, SWEEP_MIN = 0.1, SWEEP_BARS = 3, PIPE_TTL = 30, COOLDOWN = 96;
const ROUND_STEP = 50, ROUND_TOL = 0.25, LVLTOL = 0.3, CROSS_TOL = 0.5, MAX_DIST = 3.0, TOUCH_TOL = 0.1;
const SPREAD_D = 0.30, MIN_RR = 2.0;
const AGE: Record<string, number> = { '1M': 3, '1w': 2, '1d': 1 };
const nextMonthStart = (x: number): number => { const d = new Date(x); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };
const d50 = (p: number): number => Math.abs(p - Math.round(p / ROUND_STEP) * ROUND_STEP);
const FINER: Record<string, number> = { '1d': 0, '1w': 1, '1M': 2 };
interface ATRs { atr: number; init: number; prev: number | null }
const newAtr = (): ATRs => ({ atr: 0, init: 0, prev: null });
function stepAtr(s: ATRs, c: Candle): number | null {
  const tr = s.prev === null ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - s.prev), Math.abs(c.l - s.prev));
  s.prev = c.c;
  if (s.init < ATRP) { s.init++; s.atr += (tr - s.atr) / s.init; }
  else s.atr = (s.atr * (ATRP - 1) + tr) / ATRP;
  return s.init >= ATRP ? s.atr : null;
}
interface Zone { id: number; tf: string; side: 'upper' | 'lower'; top: number; bottom: number; tip: number; stopRef: number; atr: number; state: 'FRESH' | 'TOUCHED' | 'INVALIDATED'; formedT: number; structural: number }
interface Sig { t: number; tf: '15m' | '5m'; dir: 'buy' | 'sell'; zoneId: number; tip: number; zoneTop: number; zoneBottom: number; zoneAtr: number; closePrice: number; sweepExtreme: number; score: number; nearest5: number; target: number | null; atrEntry: number }

class Eng {
  zones: Zone[] = []; private seq = 1;
  private zs: Record<string, { idx: number; a: ATRs; events: { level: number; side: 'high' | 'low' }[]; levels: Map<string, number> }> = {
    '1M': { idx: 0, a: newAtr(), events: [], levels: new Map() }, '1w': { idx: 0, a: newAtr(), events: [], levels: new Map() }, '1d': { idx: 0, a: newAtr(), events: [], levels: new Map() },
  };
  private es: Record<string, { idx: number; a: ATRs; swHi: number | null; swLo: number | null }> = {
    '15m': { idx: 0, a: newAtr(), swHi: null, swLo: null }, '5m': { idx: 0, a: newAtr(), swHi: null, swLo: null },
  };
  private pipes = new Map<string, { touchIdx: number; swept: boolean; sweptIdx: number; extreme: number; bHi: number | null; bLo: number | null; done: number }>();
  private curT = 0;
  constructor(private arrs: Record<string, Candle[]>, private disp: number) {}
  conf(z: Zone): boolean {
    for (const o of this.zones) {
      if (o.id === z.id || o.tf === z.tf || o.state === 'INVALIDATED') continue;
      if (Math.abs(z.tip - o.tip) <= CROSS_TOL * (FINER[z.tf] <= FINER[o.tf] ? z.atr : o.atr)) return true;
    }
    return false;
  }
  score(z: Zone): number { return z.structural + (this.conf(z) ? 3 : 0) + (z.state === 'FRESH' ? 2 : 0); }
  nearest(p: number): Zone | null {
    let b: Zone | null = null, bd = Infinity;
    for (const z of this.zones) {
      if (z.state === 'INVALIDATED' || this.score(z) < 5 || Math.abs(p - z.tip) > MAX_DIST * z.atr) continue;
      if (Math.abs(p - z.tip) < bd) { bd = Math.abs(p - z.tip); b = z; }
    }
    return b;
  }
  opp(dir: 'buy' | 'sell', e: number): number | null {
    let b: number | null = null, bd = Infinity;
    for (const z of this.zones) {
      if (z.state === 'INVALIDATED' || this.score(z) < 5) continue;
      if (dir === 'buy') { if (z.side !== 'upper' || z.bottom <= e) continue; if (z.bottom - e < bd) { bd = z.bottom - e; b = z.bottom; } }
      else { if (z.side !== 'lower' || z.top >= e) continue; if (e - z.top < bd) { bd = e - z.top; b = z.top; } }
    }
    return b;
  }
  advance(upTo: number, out: Sig[]): void {
    this.curT = upTo;
    for (const tf of ['1M', '1w', '1d'] as const) {
      const arr = this.arrs[tf]; const s = this.zs[tf];
      while (s.idx < arr.length) {
        const c = arr[s.idx];
        const closeT = tf === '1M' ? nextMonthStart(c.t) : c.t + TF_MS[tf];
        if (closeT > upTo) break;
        const atr = stepAtr(s.a, c);
        if (atr !== null) {
          const bl = Math.min(c.o, c.c), bh = Math.max(c.o, c.c);
          for (const z of this.zones) if (z.tf === tf && z.state !== 'INVALIDATED' && z.formedT < closeT && (z.side === 'upper' ? bl > z.top : bh < z.bottom)) z.state = 'INVALIDATED';
          const wU = c.h - bh, wL = bl - c.l;
          const upV = wU >= 0.5 * atr, loV = wL >= 0.5 * atr;
          if (!(upV && loV) && (upV || loV)) {
            const side = upV ? 'upper' : 'lower';
            const top = upV ? c.h : bh, bottom = upV ? bl : c.l;
            if (top - bottom >= 0.2 * atr) {
              const tip = upV ? top : bottom;
              const structural = (d50(tip) <= ROUND_TOL * atr ? 2 : 0)
                + ([...s.levels.values()].some(lv => Math.abs(tip - lv) <= LVLTOL * atr) ? 2 : 0)
                + ((upV ? wU : wL) >= 1.5 * atr ? 1 : 0) + AGE[tf];
              const z: Zone = { id: this.seq++, tf, side, top, bottom, tip, stopRef: upV ? top + 0.15 * atr : bottom - 0.15 * atr, atr, state: 'FRESH', formedT: closeT, structural };
              if (this.score(z) >= 5) this.zones.push(z);
            }
          }
          for (const ev of s.events) {
            const hit = ev.side === 'high' ? c.h >= ev.level && c.h - ev.level <= TOUCH_TOL * atr && c.c < ev.level
              : c.l <= ev.level && ev.level - c.l <= TOUCH_TOL * atr && c.c > ev.level;
            if (hit && !s.levels.has(`${ev.side}:${ev.level}`)) s.levels.set(`${ev.side}:${ev.level}`, ev.level);
          }
          if (c.c < c.h) s.events.push({ level: c.h, side: 'high' });
          if (c.c > c.l) s.events.push({ level: c.l, side: 'low' });
        }
        s.idx++;
      }
    }
    this.stepEntry('15m', this.arrs['15m'], out);
    this.stepEntry('5m', this.arrs['5m'], out);
  }
  private stepEntry(tf: '15m' | '5m', arr: Candle[], out: Sig[]): void {
    const st = this.es[tf];
    while (st.idx < arr.length && arr[st.idx].t + TF_MS[tf] <= this.curT) {
      const n = st.idx, c = arr[n], closeT = c.t + TF_MS[tf];
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
          if (p && p.done < 0 && n > p.touchIdx + PIPE_TTL) { this.pipes.delete(key); p = null; }
          if (c.l <= z.top && c.h >= z.bottom) {
            if (z.state === 'FRESH') z.state = 'TOUCHED';
            if (!p) p = { touchIdx: n, swept: false, sweptIdx: -1, extreme: z.side === 'upper' ? c.h : c.l, bHi: st.swHi, bLo: st.swLo, done: -1 };
            this.pipes.set(key, p);
          }
          if (!p) continue;
          if (!p.swept) {
            const pierce = z.side === 'upper' ? c.h > z.tip + SWEEP_MIN * atr : c.l < z.tip - SWEEP_MIN * atr;
            if (pierce) { p.swept = true; p.sweptIdx = n; }
          }
          if (p.swept) p.extreme = z.side === 'upper' ? Math.max(p.extreme, c.h) : Math.min(p.extreme, c.l);
          if (p.done < 0) {
            if (Math.abs(c.c - c.o) < this.disp * atr) continue;
            const sw = p.swept && n - p.sweptIdx <= SWEEP_BARS - 1 && (z.side === 'upper' ? c.c < z.tip : c.c > z.tip);
            const bo = z.side === 'lower' ? p.bHi !== null && c.c > p.bHi! : p.bLo !== null && c.c < p.bLo!;
            if (!sw && !bo) continue;
            p.done = n; continue;
          }
          if (n === p.done + 1) {
            const dir = z.side === 'lower' ? 'buy' as const : 'sell' as const;
            const n5 = this.nearest(c.c);
            out.push({ t: closeT, tf, dir, zoneId: z.id, tip: z.tip, zoneTop: z.top, zoneBottom: z.bottom, zoneAtr: z.atr, closePrice: c.c, sweepExtreme: p.extreme, score: this.score(z), nearest5: n5?.id ?? -1, target: this.opp(dir, c.c), atrEntry: atr });
            this.pipes.delete(key);
          } else if (n > p.done + 1) this.pipes.delete(key);
        }
      }
      st.idx++;
    }
  }
}

interface Trade { dir: 'buy' | 'sell'; entryT: number; exitT: number; entry: number; exit: number; sl: number; tp: number; zoneId: number; pnl: number; half: boolean; banked: number; slO: number }

function sim(sigs: Sig[], kz: 'both' | 'ldn', partR: number, capR: number | null): Trade[] {
  const wins = kz === 'both' ? [[10, 13], [16.5, 19.5]] : [[10, 13]];
  const inKz = (x: number) => {
    const h = ((x + 3 * 3600e3) % 86400e3) / 3600e3;
    if (new Date(x + 3 * 3600e3).getUTCDay() === 6) return false;
    return wins.some(([a, b]) => h >= a && h < b);
  };
  const trades: Trade[] = [];
  const open: Trade[] = [];
  const cooldown = new Map<number, number>();
  const zoneOpen = new Set<number>();
  const finish = (tr: Trade, atT: number) => {
    const move = tr.dir === 'buy' ? tr.exit - tr.entry : tr.entry - tr.exit;
    tr.pnl = tr.banked + move * (tr.half ? 0.5 : 1) - SPREAD_D;
    const i = open.indexOf(tr); if (i >= 0) open.splice(i, 1);
    zoneOpen.delete(tr.zoneId);
    trades.push(tr);
  };
  let si = 0;
  const sorted = [...sigs].filter(s => s.t >= c5[0].t + TF_MS['5m']).sort((a, b) => a.t - b.t || (a.tf === '15m' ? -1 : 1));
  for (let i = 0; i < c5.length; i++) {
    const bar = c5[i], closeT = bar.t + TF_MS['5m'];
    while (si < sorted.length && sorted[si].t <= closeT) {
      const s = sorted[si++];
      if (!inKz(s.t)) continue;
      if (s.score < 5 || s.nearest5 !== s.zoneId) continue;
      if (zoneOpen.has(s.zoneId) || (cooldown.get(s.zoneId) ?? 0) > s.t) continue;
      const sl = s.dir === 'buy' ? Math.min(s.tip - 0.1 * s.zoneAtr, s.sweepExtreme - 0.05 * s.atrEntry)
        : Math.max(s.tip + 0.1 * s.zoneAtr, s.sweepExtreme + 0.05 * s.atrEntry);
      const entry = s.closePrice;
      const risk = Math.abs(entry - sl);
      if (!(risk > 0)) continue;
      const zoneTp = s.target ?? (s.dir === 'buy' ? entry + 3 * risk : entry - 3 * risk);
      const cappedTp = capR !== null
        ? (s.dir === 'buy' ? Math.min(zoneTp, entry + capR * risk) : Math.max(zoneTp, entry - capR * risk))
        : zoneTp;
      if (Math.abs(cappedTp - entry) / risk < MIN_RR) continue;
      const tr: Trade = { dir: s.dir, entryT: s.t, exitT: 0, entry, exit: 0, sl, tp: cappedTp, zoneId: s.zoneId, pnl: 0, half: false, banked: 0, slO: sl };
      open.push(tr); zoneOpen.add(s.zoneId); cooldown.set(s.zoneId, s.t + COOLDOWN * TF_MS['5m']);
    }
    for (let k = open.length - 1; k >= 0; k--) {
      const tr = open[k];
      if (tr.exitT || tr.entryT >= closeT) continue;
      const riskD = Math.abs(tr.entry - tr.slO);
      const prof = tr.dir === 'buy' ? bar.h - tr.entry : tr.entry - bar.l;
      if (!tr.half && prof >= partR * riskD) {
        tr.banked = 0.5 * partR * riskD;
        const be = tr.dir === 'buy' ? tr.entry + SPREAD_D + 0.05 : tr.entry - SPREAD_D - 0.05;
        tr.sl = tr.dir === 'buy' ? Math.max(tr.sl, be) : Math.min(tr.sl, be);
        tr.half = true;
      }
      if (!tr.exitT && i - (tr.entryT - TF_MS['5m']) / TF_MS['5m'] > 96) { tr.exit = bar.c; finish(tr, closeT); continue; }
      if (tr.dir === 'buy') {
        if (bar.l <= tr.sl) { tr.exit = tr.sl; finish(tr, closeT); }
        else if (bar.h >= tr.tp) { tr.exit = tr.tp; finish(tr, closeT); }
      } else {
        if (bar.h >= tr.sl) { tr.exit = tr.sl; finish(tr, closeT); }
        else if (bar.l <= tr.tp) { tr.exit = tr.tp; finish(tr, closeT); }
      }
    }
  }
  const last = c5[c5.length - 1];
  for (const tr of [...open]) if (!tr.exitT) { tr.exit = last.c; finish(tr, last.t + TF_MS['5m']); }
  return trades;
}

const lastClosed = (() => { let k = c5.length - 1; while (k >= 0 && c5[k].t + TF_MS['5m'] > Date.now()) k--; return k; })();
const endT = c5[lastClosed].t + TF_MS['5m'];
const IS_T = c5[0].t + (endT - c5[0].t) * 0.7;
console.log(`البيانات: ${c5.length} شمعة 5m | IS/OOS عند ${new Date(IS_T).toISOString().slice(0, 10)}`);

const engB = new Eng({ '1M': c1M, '1w': c1w, '1d': c1d, '15m': c15, '5m': c5 }, 1.0);
const sigsB: Sig[] = [];
for (let i = 0; i <= lastClosed; i++) engB.advance(c5[i].t + TF_MS['5m'], sigsB);
const engA = new Eng({ '1M': c1M, '1w': c1w, '1d': c1d, '15m': c15, '5m': c5 }, 0.6);
const sigsA: Sig[] = [];
for (let i = 0; i <= lastClosed; i++) engA.advance(c5[i].t + TF_MS['5m'], sigsA);


// تفريغ إشارات micro (بعد الفلترة كما في sim)
{
  const firstBar = c5[0].t + TF_MS['5m'];
  const inKzLdn = (x: number) => { const h = ((x + 3 * 3600e3) % 86400e3) / 3600e3; if (new Date(x + 3 * 3600e3).getUTCDay() === 6) return false; return h >= 10 && h < 13; };
  const kept = sigsA.filter(s => s.t >= firstBar && inKzLdn(s.t) && s.score >= 5 && s.nearest5 === s.zoneId);
  require('fs').writeFileSync('/tmp/micro_signals.json', JSON.stringify(kept.map(s => ({ t: s.t, tf: s.tf, dir: s.dir, zoneId: s.zoneId, close: s.closePrice }))));
  console.log('micro signals kept:', kept.length);
}


// تفريغ المناطق
require('fs').writeFileSync('/tmp/micro_zones.json', JSON.stringify(engA.zones.map(z => ({ id: z.id, tf: z.tf, side: z.side, tip: +z.tip.toFixed(2), formedT: z.formedT, state: z.state }))));
const st = (tr: Trade[]) => {
  const w = tr.filter(x => x.pnl > 0).length;
  const net = tr.reduce((a, x) => a + x.pnl, 0);
  const gw = tr.filter(x => x.pnl > 0).reduce((a, x) => a + x.pnl, 0);
  const gl = Math.abs(tr.filter(x => x.pnl < 0).reduce((a, x) => a + x.pnl, 0));
  let bal = 0, peak = 0, dd = 0;
  for (const x of [...tr].sort((a, b) => a.exitT - b.exitT)) { bal += x.pnl; peak = Math.max(peak, bal); dd = Math.max(dd, peak - bal); }
  return { n: tr.length, wr: tr.length ? w / tr.length * 100 : 0, net, pf: gl > 0 ? gw / gl : 99, dd };
};

console.log('\nطبقة كشف B (both kz, disp=1.0, close, s5, tight) + إدارة:');
for (const partR of [0.4, 0.5, 0.6])
  for (const capR of [null, 2, 3]) {
    const tr = sim(sigsB, 'both', partR, capR);
    const s = st(tr);
    const oos = st(tr.filter(x => x.entryT >= IS_T));
    console.log(`  جزئي@${partR}R سقف=${capR ?? 'بلا'} | ALL(${s.n}, ${s.wr.toFixed(1)}%, ${s.net >= 0 ? '+' : ''}${s.net.toFixed(0)}$, pf ${s.pf.toFixed(2)}, DD ${s.dd.toFixed(0)}$) | OOS(${oos.n}, ${oos.wr.toFixed(0)}%, ${oos.net >= 0 ? '+' : ''}${oos.net.toFixed(0)}$)`);
  }
console.log('\nطبقة كشف A (ldn kz, disp=0.6, close, s5, tight) + إدارة:');
// تفريغ تكوين المقارنة: ldn, جزئي@0.5R, بلا سقف
{
  const tr = sim(sigsA, 'ldn', 0.5, null);
  require('fs').writeFileSync('/tmp/micro_trades.json', JSON.stringify(tr.map(x => ({ entryT: x.entryT, entry: x.entry, exit: x.exit, pnl: x.pnl, exitT: x.exitT }))));
}

for (const partR of [0.4, 0.5, 0.6])
  for (const capR of [null, 2, 3]) {
    const tr = sim(sigsA, 'ldn', partR, capR);
    const s = st(tr);
    const oos = st(tr.filter(x => x.entryT >= IS_T));
    console.log(`  جزئي@${partR}R سقف=${capR ?? 'بلا'} | ALL(${s.n}, ${s.wr.toFixed(1)}%, ${s.net >= 0 ? '+' : ''}${s.net.toFixed(0)}$, pf ${s.pf.toFixed(2)}, DD ${s.dd.toFixed(0)}$) | OOS(${oos.n}, ${oos.wr.toFixed(0)}%, ${oos.net >= 0 ? '+' : ''}${oos.net.toFixed(0)}$)`);
  }
