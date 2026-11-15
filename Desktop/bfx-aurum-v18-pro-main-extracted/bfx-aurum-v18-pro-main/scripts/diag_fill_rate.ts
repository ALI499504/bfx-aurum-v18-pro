// قياس نسبة الملء النظرية لكل نوع من إشارات E (بلا قيود مجمّعة) — أين تموت الإشارات؟
import { readFileSync } from 'fs';
import { detectE } from '/home/z/my-project/src/lib/engine/strategies';

type Candle = { t: number; o: number; h: number; l: number; c: number };

const snap = JSON.parse(readFileSync('/home/z/my-project/db/mt5-feed-snapshot.json', 'utf8'));
const mk = (a: unknown[]) => ({ t: Number(a[0]), o: Number(a[1]), h: Number(a[2]), l: Number(a[3]), c: Number(a[4]) });
const c15: Candle[] = (snap.tfs['15m'] as unknown[][]).map(mk);
const c5: Candle[] = (snap.tfs['5m'] as unknown[][]).map(mk);

const sigs = detectE({ c15 } as never);
const kinds = (s: { reason: string }) => s.reason.includes('لمسة') ? 'touch' : s.reason.includes('كسر') ? 'break' : 'approach';

// فهرسة شموع 5m بالوقت للبحث السريع
let ptr = 0;
const stats: Record<string, { total: number; filled: number }> = { touch: { total: 0, filled: 0 }, break: { total: 0, filled: 0 }, approach: { total: 0, filled: 0 } };

for (const s of sigs) {
  const k = kinds(s);
  stats[k].total++;
  const ttl = s.reason.includes('لمسة') ? 12 : 24;
  const deadline = s.knownAt + ttl * 3600e3;
  // تقدم بمؤشر شموع 5m حتى knownAt
  while (ptr < c5.length && c5[ptr].t + 300e3 <= s.knownAt) ptr++;
  let filled = false;
  for (let j = ptr; j < c5.length && c5[j].t <= deadline; j++) {
    const b = c5[j];
    if (s.dir === 'buy' ? (b.o <= s.entry || b.l <= s.entry) : (b.o >= s.entry || b.h >= s.entry)) { filled = true; break; }
  }
  if (filled) stats[k].filled++;
}

const days = (c15[c15.length - 1].t - c15[0].t) / 86400000;
for (const [k, v] of Object.entries(stats)) {
  console.log(`${k}: إشارات=${v.total} (${(v.total / days).toFixed(1)}/يوم) | تُملأ نظرياً=${v.filled} (${(100 * v.filled / v.total).toFixed(0)}%) = ${(v.filled / days).toFixed(2)} ملء/يوم`);
}
const totalF = Object.values(stats).reduce((a, b) => a + b.filled, 0);
console.log(`السقف النظري الكلي: ${totalF} ملء = ${(totalF / days).toFixed(2)}/يوم (قبل أي قيود مجمّعة أو سعة)`);
