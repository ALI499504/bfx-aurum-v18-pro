import fs from 'node:fs'; import path from 'node:path';
import { loadData } from '../src/lib/engine/backtest';
import { DEFAULT_TAMSA_PARAMS } from '../src/lib/engine/tamsa-params';
import { syriaHour } from '../src/lib/engine/sessions';
import { PIP, TF_MS } from '../src/lib/engine/types';
const snapPath = path.join(process.cwd(), 'db', 'mt5-feed-snapshot.json');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as { tfs: Record<string, unknown[]> };
const files: Record<string, unknown> = {};
for (const [tf, arr] of Object.entries(snap.tfs)) {
  if (!Array.isArray(arr) || !arr.length) continue;
  files[tf] = (arr as unknown[][]).map(a => { const c = a as unknown[]; return { t: Number(c[0]), o: Number(c[1]), h: Number(c[2]), l: Number(c[3]), c: Number(c[4]), v: Number(c[5] ?? 0) }; });
}
const data = loadData(files as never);
const P = DEFAULT_TAMSA_PARAMS.D;
const c5 = data.c5, ms5 = TF_MS['5m'];
let dayKey = '', prevClose = 0, upper = 0, lower = 0;
let hitUp = false, hitDn = false, gapClosed = false;
let nQualify = 0, nClosed = 0, nD1 = 0;
const sampleGaps: number[] = [];
for (const bar of c5) {
  const h = syriaHour(bar.t);
  const dnum = Math.floor((bar.t + 3 * 3600e3) / 86400e3);
  const isNewAsiaDay = String(dnum) !== dayKey && h >= 1 && h < 2;
  if (isNewAsiaDay) {
    const gapPips = prevClose ? Math.abs(bar.o - prevClose) / PIP : 0;
    if (dayKey && prevClose && gapPips >= P.gapMinPips && gapPips <= P.gapMaxPips) {
      upper = Math.max(prevClose, bar.o); lower = Math.min(prevClose, bar.o);
      hitUp = false; hitDn = false; gapClosed = false;
      dayKey = String(dnum); nQualify++;
      if (sampleGaps.length < 8) sampleGaps.push(Math.round(gapPips));
    } else { dayKey = String(dnum); upper = 0; }
    prevClose = bar.o;
    continue;
  }
  if (!dayKey || dayKey !== String(dnum)) { prevClose = bar.c; continue; }
  prevClose = bar.c;
  if (h >= 10) continue;
  if (!gapClosed && upper) {
    if (bar.h >= upper) hitUp = true;
    if (bar.l <= lower) hitDn = true;
    if (hitUp && hitDn) { gapClosed = true; nClosed++; continue; }
  }
  if (!gapClosed || !upper) continue;
  const extUp = (bar.h - upper) / PIP, extDown = (lower - bar.l) / PIP;
  const bodyUp = (bar.c - upper) / PIP, bodyDown = (lower - bar.c) / PIP;
  if ((bodyUp >= P.bodyBreakMin && extUp >= P.totalMin && extUp <= P.totalMax) ||
      (bodyDown >= P.bodyBreakMin && extDown >= P.totalMin && extDown <= P.totalMax)) { nD1++; gapClosed = false; }
}
console.log(`D: أيام مؤهلة (فجوة 20-150)=${nQualify} · أُغلقت الفجوة خلال آسيا=${nClosed} · كسر D1=${nD1}`);
console.log('عينات فجوات (بيب):', sampleGaps.join(', '));
