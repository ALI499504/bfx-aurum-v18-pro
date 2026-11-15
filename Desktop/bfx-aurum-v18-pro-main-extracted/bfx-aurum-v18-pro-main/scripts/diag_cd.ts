// تشخيص C وD: أين تتوقف شروط كل حالة
import fs from 'node:fs';
import path from 'node:path';
import { loadData, runBacktest, getCachedStructure } from '../src/lib/engine/backtest';
import { DEFAULT_SETTINGS } from '../src/lib/engine/rules';
import { syriaHour } from '../src/lib/engine/sessions';
import { PIP } from '../src/lib/engine/types';

async function main() {
  const snapPath = path.join(process.cwd(), 'db', 'mt5-feed-snapshot.json');
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as { tfs: Record<string, unknown[]> };
  const files: Record<string, never> = {};
  for (const [tf, arr] of Object.entries(snap.tfs)) {
    if (!Array.isArray(arr) || !arr.length) continue;
    (files as Record<string, unknown>)[tf] = (arr as unknown[][]).map(a => {
      const c = a as unknown[];
      return { t: Number(c[0]), o: Number(c[1]), h: Number(c[2]), l: Number(c[3]), c: Number(c[4]), v: Number(c[5] ?? 0) };
    });
  }
  const data = loadData(files);
  const settings = structuredClone(DEFAULT_SETTINGS);
  runBacktest(data, settings, Date.now(), []);
  const { struct1d, struct4h } = getCachedStructure();

  // ---- C: مراحل الشروط ----
  const tl4 = struct4h!.trendTimeline, tlD = struct1d!.trendTimeline;
  const trendAt = (tl: { t: number; trend: string }[], t: number) => { let d = 'range'; for (const p of tl) { if (p.t <= t) d = p.trend; else break; } return d; };
  const dist4: Record<string, number> = {};
  for (const p of tl4) dist4[p.trend] = (dist4[p.trend] ?? 0) + 1;
  const distD: Record<string, number> = {};
  for (const p of tlD) distD[p.trend] = (distD[p.trend] ?? 0) + 1;
  console.log('توزيع ترند 4H:', dist4, ' | ترند يومي:', distD);

  const realsH = struct4h!.realPivots.filter(p => p.kind === 'HH' || p.kind === 'LH');
  const realsL = struct4h!.realPivots.filter(p => p.kind === 'HL' || p.kind === 'LL');
  console.log('realPivots 4H: قمم =', realsH.length, 'قيعان =', realsL.length);

  let sweepDown = 0, sweepTrendOk = 0;
  for (const pv of realsH) {
    const start = data.c4h.findIndex(b => b.t + 3600e3 * 4 > pv.confirmedAt);
    for (let bi = Math.max(0, start); bi < data.c4h.length; bi++) {
      const bar = data.c4h[bi];
      if (bar.t + 4 * 3600e3 <= pv.confirmedAt) continue;
      if ((bar.h - pv.price) / PIP >= 100) {
        sweepDown++;
        const t4 = trendAt(tl4, bar.t), td = trendAt(tlD, bar.t);
        if (t4 === 'down' && td === 'down') sweepTrendOk++;
        break;
      }
      if (bar.h < pv.price - 2000) break;
    }
  }
  console.log('C-case1: قمم مع سحب ≥100 بيب:', sweepDown, '· منها ترند 4H+يومي هابط معاً:', sweepTrendOk);

  // ---- D: فجوات الافتتاح الحقيقية ----
  const gaps: number[] = [];
  let prevClose = 0, prevDay = '';
  for (const bar of data.c5) {
    const dnum = Math.floor((bar.t + 3 * 3600e3) / 86400e3);
    const h = syriaHour(bar.t);
    if (String(dnum) !== prevDay) { prevDay = String(dnum); }
    if (h >= 1 && h < 2 && prevClose) {
      gaps.push(Math.abs(bar.o - prevClose) / PIP);
      prevClose = bar.o;
      continue;
    }
    prevClose = bar.c;
  }
  gaps.sort((a, b) => a - b);
  const q = (p: number) => gaps[Math.floor(gaps.length * p)]?.toFixed(1);
  console.log(`D: عدد أيام آسيا = ${gaps.length} · وسيط الفجوة = ${q(0.5)}$ · p90 = ${q(0.9)}$ · p99 = ${q(0.99)}$ · ≥20 بيب = ${gaps.filter(g => g >= 20).length} · ضمن 20-150 = ${gaps.filter(g => g >= 20 && g <= 150).length}`);
}
main();
