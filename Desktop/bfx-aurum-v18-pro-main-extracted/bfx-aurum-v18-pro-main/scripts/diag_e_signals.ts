// سكربت تشخيصي: كم إشارة تولّد كاشف E فعلياً على البيانات الحقيقية؟ ولماذا قليلة؟
import { readFileSync } from 'fs';
import { detectE } from '/home/z/my-project/src/lib/engine/strategies';

type Candle = { t: number; o: number; h: number; l: number; c: number };

const snap = JSON.parse(readFileSync('/home/z/my-project/db/mt5-feed-snapshot.json', 'utf8'));
const c15: Candle[] = (snap.tfs['15m'] as unknown as (number | string)[][]).map(a => ({
  t: Number(a[0]), o: Number(a[1]), h: Number(a[2]), l: Number(a[3]), c: Number(a[4]),
}));
console.log('c15 candles:', c15.length, '| from', new Date(c15[0].t).toISOString().slice(0, 10), 'to', new Date(c15[c15.length - 1].t).toISOString().slice(0, 10));

const levels: number[] = [];
const start = Math.ceil(c15[0].l / 100) * 100;
for (let v = start; v <= c15[c15.length - 1].h; v += 100) levels.push(v);
console.log('levels:', levels.length, `(${levels[0]} → ${levels[levels.length - 1]})`);

const sigs = detectE({ c15 } as never);
console.log('إجمالي إشارات E:', sigs.length, '| لكل يوم:', (sigs.length / ((c15[c15.length - 1].t - c15[0].t) / 86400000)).toFixed(2));

// توزيع حسب النوع من نص السبب
const kinds: Record<string, number> = {};
for (const s of sigs) {
  const k = s.reason.includes('لمسة') ? 'touch' : s.reason.includes('كسر') ? 'break' : 'approach';
  kinds[k] = (kinds[k] ?? 0) + 1;
}
console.log('حسب النوع:', kinds);

// توزيع يومي لآخر 30 يوماً
const dayMap: Record<string, number> = {};
for (const s of sigs) {
  const d = new Date(s.knownAt).toISOString().slice(0, 10);
  dayMap[d] = (dayMap[d] ?? 0) + 1;
}
const recent = Object.entries(dayMap).sort().slice(-30);
console.log('آخر 30 يوم (إشارات/يوم):', recent.map(([d, n]) => `${d.slice(5)}:${n}`).join(' '));

// لماذا قليلة؟ عدّ اللمسات المؤهلة يدوياً لمستوى واحد قريب من السعر الحالي
const price = c15[c15.length - 1].c;
const lvl = Math.round(price / 100) * 100;
let touches = 0, genuine = 0, throttled = 0, lastSig = -1, lastAway = -1;
for (let i = 1; i < c15.length; i++) {
  const b = c15[i], t = b.t + 900000;
  if (b.l <= lvl && b.h >= lvl) {
    touches++;
    if (lastAway > 0 && t - lastAway <= 3600000) {
      genuine++;
      if (lastSig < 0 || t - lastSig >= 5400000) { lastSig = t; } else throttled++;
    }
    continue;
  }
  if (Math.abs(b.c - lvl) / 0.1 >= 15) lastAway = t;
}
console.log(`\nمستوى ${lvl} (الأقرب للسعر ${price.toFixed(2)}): لمسات=${touches} مؤهلة=${genuine} مُخنوقة بالحد الزمني=${throttled}`);
