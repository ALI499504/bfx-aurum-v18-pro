// فحص سريع لبيانات الباك تيست المتوفرة
import { readFileSync, existsSync } from 'fs';
import { Candle } from '../src/lib/engine/types';

const path = 'db/mt5-feed-snapshot.json';
console.log('exists:', existsSync(path));
if (existsSync(path)) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const tfs = raw.tfs as Record<string, Candle[]>;
  console.log('top keys:', Object.keys(raw));
  console.log('tfs keys:', Object.keys(tfs));
  for (const [k, v] of Object.entries(tfs)) {
    const arr = v as Candle[];
    if (Array.isArray(arr) && arr.length) {
      const valid = arr.filter(c => c && typeof c.t === 'number' && isFinite(c.t) && c.t > 0);
      if (!valid.length) { console.log(`${k}: ${arr.length} rows, t غير صالح — sample:`, JSON.stringify(arr[0])); continue; }
      const first = new Date(valid[0].t).toISOString();
      const last = new Date(valid[valid.length - 1].t).toISOString();
      console.log(`${k}: ${valid.length} candles | ${first} → ${last}`);
    }
  }
}
// أيضاً أي ملفات بيانات أخرى
import { readdirSync, statSync } from 'fs';
const dbDir = 'db';
if (existsSync(dbDir)) {
  for (const f of readdirSync(dbDir)) {
    const st = statSync(`${dbDir}/${f}`);
    console.log(`db/${f}: ${st.size} bytes`);
  }
}
