import fs from 'node:fs'; import path from 'node:path';
import { loadData, getCachedStructure } from '../src/lib/engine/backtest';
import { DEFAULT_SETTINGS } from '../src/lib/engine/rules';
const snapPath = path.join(process.cwd(), 'db', 'mt5-feed-snapshot.json');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as { tfs: Record<string, unknown[]> };
const files: Record<string, unknown> = {};
for (const [tf, arr] of Object.entries(snap.tfs)) {
  if (!Array.isArray(arr) || !arr.length) continue;
  files[tf] = (arr as unknown[][]).map(a => { const c = a as unknown[]; return { t: Number(c[0]), o: Number(c[1]), h: Number(c[2]), l: Number(c[3]), c: Number(c[4]), v: Number(c[5] ?? 0) }; });
}
const data = loadData(files as never);
run: {
  const { analyzeStructure } = await import('../src/lib/engine/structure');
  const s1d = analyzeStructure(data.c1d, '1d');
  const s4h = analyzeStructure(data.c4h, '4h');
  console.log('=== 1d timeline ===');
  for (const p of s1d.trendTimeline) console.log(new Date(p.t).toISOString().slice(0,10), p.trend);
  console.log('=== 4h timeline (آخر 12) ===');
  for (const p of s4h.trendTimeline.slice(-12)) console.log(new Date(p.t).toISOString().slice(0,16), p.trend);
  console.log('=== 1d realPivots (آخر 8) ===');
  for (const p of s1d.realPivots.slice(-8)) console.log(p.kind, p.price.toFixed(1), new Date(p.t).toISOString().slice(0,10));
}
