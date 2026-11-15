// فحص حدث محدد في كلا المحركين: entryT=1764573000000, entry=4242.4
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
for (let i = 0; i <= lastClosed; i++) {
  const evs = eng.advance(c5[i].t + TF_MS['5m']);
  for (const e of evs) {
    if (e.t === 1764573000000 && Math.abs(e.price - 4242.4) < 0.01) {
      const z = e.zone;
      const atrE = eng.entryAtr(e.tf) ?? 0;
      console.log('الحدث موجود في SmcEngine:');
      console.log('  tf:', e.tf, 'dir:', e.dir, 'zoneId:', z.id, 'zoneTf:', z.tf);
      console.log('  tip:', z.tip.toFixed(2), 'zoneAtr:', z.atr.toFixed(2), 'sweepExtreme:', e.sweepExtreme.toFixed(2), 'atrEntry:', atrE.toFixed(2));
      console.log('  sl_tip  =', (z.tip - 0.1 * z.atr).toFixed(2));
      console.log('  sl_extreme =', (e.sweepExtreme - 0.05 * atrE).toFixed(2));
      console.log('  sl (min) =', Math.min(z.tip - 0.1 * z.atr, e.sweepExtreme - 0.05 * atrE).toFixed(2));
      console.log('  risk =', (e.price - Math.min(z.tip - 0.1 * z.atr, e.sweepExtreme - 0.05 * atrE)).toFixed(2));
    }
  }
}
