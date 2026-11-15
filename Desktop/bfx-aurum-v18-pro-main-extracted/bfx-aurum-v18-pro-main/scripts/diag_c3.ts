// اختبار عالمي: هل يحدث كسر داخلي 100-500 بيب إطلاقاً؟
import fs from 'node:fs'; import path from 'node:path';
import { loadData, getCachedStructure } from '../src/lib/engine/backtest';
import { DEFAULT_TAMSA_PARAMS } from '../src/lib/engine/tamsa-params';
import { findPivotsTF } from '../src/lib/engine/structure';
import { PIP, TF_MS } from '../src/lib/engine/types';
function idxFrom(c: { t: number }[], t: number): number {
  let lo = 0, hi = c.length - 1, i = c.length;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (c[mid].t >= t) { i = mid; hi = mid - 1; } else lo = mid + 1; }
  return i;
}
const snapPath = path.join(process.cwd(), 'db', 'mt5-feed-snapshot.json');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as { tfs: Record<string, unknown[]> };
const files: Record<string, unknown> = {};
for (const [tf, arr] of Object.entries(snap.tfs)) {
  if (!Array.isArray(arr) || !arr.length) continue;
  files[tf] = (arr as unknown[][]).map(a => { const c = a as unknown[]; return { t: Number(c[0]), o: Number(c[1]), h: Number(c[2]), l: Number(c[3]), c: Number(c[4]), v: Number(c[5] ?? 0) }; });
}
const data = loadData(files as never);
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
const ms5 = TF_MS['5m'];
let any100 = 0, any50 = 0, any20 = 0, inWindow = 0;
for (const iv of internalLows.slice(0, 2000)) {
  const capIv = iv.confirmedAt + 3 * 86400e3;
  let found100 = false, found50 = false, found20 = false;
  for (let bi = idxFrom(data.c5, iv.confirmedAt); bi < data.c5.length; bi++) {
    const bar = data.c5[bi];
    if (bar.t >= capIv) break;
    const ext = (iv.price - bar.c) / PIP;
    if (bar.c < iv.price && ext > 0) {
      if (ext >= 20) found20 = true;
      if (ext >= 50) found50 = true;
      if (ext >= 100 && ext <= 500) { found100 = true; break; }
    }
  }
  if (found20) any20++; if (found50) any50++; if (found100) { any100++; inWindow++; }
}
console.log(`من ${Math.min(2000, internalLows.length)} قاع داخلي: إغلاق تحت القاع بـ≥20 بيب = ${any20} · ≥50 = ${any50} · ضمن 100-500 خلال 3 أيام = ${any100}`);
