// تشخيص متقدم لC (مُسَرَّع بـ idxFrom): بعد السحب والترند — الكسر الداخلي والفيبو
import fs from 'node:fs';
import path from 'node:path';
import { loadData, runBacktest, getCachedStructure } from '../src/lib/engine/backtest';
import { DEFAULT_TAMSA_PARAMS } from '../src/lib/engine/tamsa-params';
import { findPivotsTF } from '../src/lib/engine/structure';
import { DEFAULT_SETTINGS } from '../src/lib/engine/rules';
import { PIP, TF_MS } from '../src/lib/engine/types';

function idxFrom(c: { t: number }[], t: number): number {
  let lo = 0, hi = c.length - 1, i = c.length;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (c[mid].t >= t) { i = mid; hi = mid - 1; } else lo = mid + 1; }
  return i;
}

async function main() {
  const snapPath = path.join(process.cwd(), 'db', 'mt5-feed-snapshot.json');
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as { tfs: Record<string, unknown[]> };
  const files: Record<string, unknown> = {};
  for (const [tf, arr] of Object.entries(snap.tfs)) {
    if (!Array.isArray(arr) || !arr.length) continue;
    files[tf] = (arr as unknown[][]).map(a => {
      const c = a as unknown[];
      return { t: Number(c[0]), o: Number(c[1]), h: Number(c[2]), l: Number(c[3]), c: Number(c[4]), v: Number(c[5] ?? 0) };
    });
  }
  const data = loadData(files as never);
  runBacktest(data, structuredClone(DEFAULT_SETTINGS), Date.now(), []);
  const { struct1d, struct4h } = getCachedStructure();
  const tl4 = struct4h!.trendTimeline, tlD = struct1d!.trendTimeline;
  const trendAt = (tl: { t: number; trend: string }[], t: number) => { let d = 'range'; for (const p of tl) { if (p.t <= t) d = p.trend; else break; } return d; };
  const P = DEFAULT_TAMSA_PARAMS.C;

  const raw5 = findPivotsTF(data.c5, '5m', 1);
  const series: typeof raw5 = [];
  for (const p of raw5) {
    const last = series[series.length - 1];
    if (last && last.kind === p.kind) {
      if ((p.kind === 'high' && p.price > last.price) || (p.kind === 'low' && p.price < last.price)) series[series.length - 1] = p;
    } else series.push(p);
  }
  const internalLows: typeof raw5 = [];
  for (let i = 0; i + 2 < series.length; i++) {
    const [x, y, z] = [series[i], series[i + 1], series[i + 2]];
    if (x.kind === 'high' && y.kind === 'low' && z.kind === 'high' && z.price > x.price) internalLows.push(y);
  }
  console.log('internalLows 5M:', internalLows.length);

  const realsH = struct4h!.realPivots.filter(p => p.kind === 'HH' || p.kind === 'LH');
  let stageSweep = 0, stageTrend = 0, stageInternal = 0, stageFib = 0, stageSl = 0;
  const ms5 = TF_MS['5m'];
  for (const pv of realsH) {
    let sweep: { t: number; h: number } | null = null;
    for (let bi = idxFrom(data.c4h, pv.confirmedAt); bi < data.c4h.length; bi++) {
      const bar = data.c4h[bi];
      if (bar.t + TF_MS['4h'] <= pv.confirmedAt) continue;
      if ((bar.h - pv.price) / PIP >= P.minLevelBreakPips) { sweep = bar; break; }
      if (bar.h < pv.price - 2000) break;
    }
    if (!sweep) continue;
    stageSweep++;
    const sweepT = sweep.t + TF_MS['4h'];
    if (!(trendAt(tl4, sweepT) === 'down' && trendAt(tlD, sweepT) === 'down')) continue;
    stageTrend++;
    let brkBar: { t: number; c: number } | null = null;
    const internals = internalLows.filter(p => p.confirmedAt > sweepT);
    for (const iv of internals) {
      const capIv = iv.confirmedAt + 3 * 86400e3;
      for (let bi5 = idxFrom(data.c5, iv.confirmedAt); bi5 < data.c5.length; bi5++) {
        const bar = data.c5[bi5];
        if (bar.t >= capIv) break;
        const ext = (iv.price - bar.c) / PIP;
        if (bar.c < iv.price - P.internalBreakMin && ext <= P.internalBreakMax) { brkBar = bar; break; }
      }
      if (brkBar) break;
    }
    if (!brkBar) continue;
    stageInternal++;
    let fib100 = -Infinity, waveStartT = sweep.t;
    for (let bj = idxFrom(data.c5, sweep.t); bj < data.c5.length; bj++) {
      const b = data.c5[bj];
      if (b.t + ms5 > brkBar.t + ms5) break;
      if (b.h > fib100) { fib100 = b.h; waveStartT = b.t; }
    }
    let fib0 = Infinity;
    for (let bj = idxFrom(data.c5, waveStartT); bj < data.c5.length; bj++) {
      const b = data.c5[bj];
      if (b.t + ms5 > brkBar.t + ms5) break;
      fib0 = Math.min(fib0, b.l);
    }
    if (!Number.isFinite(fib100) || !Number.isFinite(fib0) || fib100 === fib0) continue;
    stageFib++;
    const fibPrice = (r: number) => fib100 + (fib0 - fib100) * (r / 100);
    const entry = fibPrice(P.fibTouch);
    const dist100 = Math.abs(fibPrice(100) - entry) / PIP;
    const slAnchor = dist100 <= P.slFlexMaxPips ? fibPrice(100) : fibPrice(P.forcedFibLevel);
    const slPips = Math.abs(entry - slAnchor) / PIP;
    if (!(slPips > 0)) continue;
    stageSl++;
  }
  console.log(`C مراحل: سحب=${stageSweep} → ترند=${stageTrend} → كسر داخلي=${stageInternal} → فيبو=${stageFib} → ستوب=${stageSl}`);
}
main();
