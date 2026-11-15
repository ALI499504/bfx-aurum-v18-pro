// عزل الانحراف: عدّ أحداث SmcEngine مقابل أرقام البحث (disp=1.0 → 9266 إشارة)
import { readFileSync } from 'fs';
import { Candle, TF_MS } from '../src/lib/engine/types';
import { SmcEngine } from '../src/lib/engine/smc';

const toCandles = (rows: unknown[]): Candle[] =>
  (rows as [number, number, number, number, number, number][])
    .filter(r => Array.isArray(r) && r.length >= 5 && Number.isFinite(r[0]) && r[0] > 0 && r[2] >= r[3])
    .map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] ?? 0 }));

const snap = JSON.parse(readFileSync('db/research/mt5-feed-snapshot.json', 'utf8'));
const t: Record<string, unknown[]> = snap.tfs;
const c5 = toCandles(t['5m']);
const c15 = toCandles(t['15m']);
const c1d = toCandles(t['1d']);
const c1w = toCandles(t['1w']);
const c1M = toCandles(t['1M']);

const lastClosed = (() => { let k = c5.length - 1; while (k >= 0 && c5[k].t + TF_MS['5m'] > Date.now()) k--; return k; })();

const eng = new SmcEngine(c1M, c1w, c1d, c15, c5);
let n = 0;
const byTf: Record<string, number> = { '15m': 0, '5m': 0 };
const byType: Record<string, number> = { sweep: 0, BOS: 0 };
const first: { t: number; tf: string; type: string; price: number }[] = [];
for (let i = 0; i <= lastClosed; i++) {
  const evs = eng.advance(c5[i].t + TF_MS['5m']);
  n += evs.length;
  for (const e of evs) {
    byTf[e.tf]++; byType[e.type]++;
    if (first.length < 8) first.push({ t: e.t, tf: e.tf, type: e.type, price: e.price });
  }
}
console.log('SmcEngine أحداث:', n, JSON.stringify(eng.counters), 'dbg:', JSON.stringify(eng.dbg));
console.log('حسب الفريم:', byTf, 'حسب النوع:', byType);
console.log('أول الأحداث:', JSON.stringify(first.slice(0, 5)));
console.log('المتوقع من البحث (disp=1.0, both, w0.5): 9266 | sweepConf 363, bosConf 8903');
