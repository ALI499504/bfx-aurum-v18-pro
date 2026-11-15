// تنزيل بيانات الذهب (PAXGUSDT كبديل لـ XAUUSD) من Binance
// الفريمات: 5m (أساسي)، 1h، 4h، 1d، 1w، 1M — من 2025-01-01 حتى الآن
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';

const SYMBOL = 'PAXGUSDT';
const START = Date.UTC(2025, 0, 1);
const OUT = '/home/z/my-project/data';
mkdirSync(OUT, { recursive: true });

interface K { t: number; o: number; h: number; l: number; c: number; v: number }

async function fetchAll(interval: string, endTime = Date.now()): Promise<K[]> {
  const all: K[] = [];
  let cursor = START;
  while (cursor < endTime) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${interval}&startTime=${cursor}&limit=1000`;
    let rows: any[] = [];
    let lastErr = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const r = await fetch(url);
        if (r.ok) { rows = await r.json(); break; }
        lastErr = `HTTP ${r.status}`;
      } catch (e) { lastErr = String(e); }
      console.log(`  retry ${interval} @${new Date(cursor).toISOString()}: ${lastErr}`);
      await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
    }
    if (!rows.length) break;
    for (const k of rows) {
      all.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] });
    }
    const last = rows[rows.length - 1][0];
    const next = last + 1;
    if (next <= cursor) break;
    cursor = next;
    if (rows.length < 1000) break;
    await new Promise(res => setTimeout(res, 120));
  }
  return all;
}

async function main() {
  const intervals = ['5m', '15m', '1h', '4h', '1d', '1w', '1M'];
  for (const iv of intervals) {
    const file = `${OUT}/xau_${iv}.json`;
    if (existsSync(file)) {
      const prev = JSON.parse(readFileSync(file, 'utf8')) as K[];
      if (prev.length && prev[prev.length - 1].t > Date.now() - 86400e3) {
        console.log(`skip ${iv} (${prev.length} candles, fresh)`);
        continue;
      }
    }
    const t0 = Date.now();
    const data = await fetchAll(iv);
    if (!data.length) { console.error(`EMPTY ${iv} — abort`); process.exit(1); }
    writeFileSync(file, JSON.stringify(data));
    console.log(`${iv}: ${data.length} candles in ${((Date.now() - t0) / 1000).toFixed(1)}s (${new Date(data[0]?.t).toISOString()} → ${new Date(data[data.length - 1]?.t).toISOString()})`);
  }
  console.log('DONE');
}
main().catch(e => { console.error('FAIL', e); process.exit(1); });
