import fs from 'node:fs'; import path from 'node:path';
import { loadData } from '../src/lib/engine/backtest';
import { syriaHour } from '../src/lib/engine/sessions';
const snapPath = path.join(process.cwd(), 'db', 'mt5-feed-snapshot.json');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as { tfs: Record<string, unknown[]> };
const arr = (snap.tfs['5m'] as unknown[][]).map(a => { const c = a as unknown[]; return { t: Number(c[0]), o: Number(c[1]), h: Number(c[2]), l: Number(c[3]), c: Number(c[4]) }; });
const byHour: Record<number, number> = {};
for (const b of arr) { const h = Math.floor(syriaHour(b.t)); byHour[h] = (byHour[h] ?? 0) + 1; }
console.log('توزيع الشموع 5M على ساعات دمشق:');
for (let h = 0; h < 24; h++) console.log(`${String(h).padStart(2,'0')}:00 → ${byHour[h] ?? 0}`);
// عينة: الفجوات حول افتتاح 01:00 لآخر 10 أيام
const days = new Map<number, { lastPrev: number | null; firstAsia: number | null }>();
for (const b of arr) {
  const d = Math.floor((b.t + 3*3600e3)/86400e3);
  const h = syriaHour(b.t);
  const rec = days.get(d) ?? { lastPrev: null, firstAsia: null };
  if (h < 1) rec.lastPrev = b.c;
  if (h >= 1 && h < 2 && rec.firstAsia === null) rec.firstAsia = b.o;
  days.set(d, rec);
}
let n = 0;
for (const [d, r] of [...days.entries()].sort((a,b)=>b[0]-a[0])) {
  if (r.firstAsia !== null && r.lastPrev !== null && n < 10) {
    console.log(`يوم ${new Date(d*86400e3).toISOString().slice(0,10)}: آخر إغلاق قبل 01:00 = ${r.lastPrev} · افتتاح أول شمعة آسيا = ${r.firstAsia} · الفجوة = ${Math.abs(r.firstAsia - r.lastPrev).toFixed(2)}$ = ${Math.round(Math.abs(r.firstAsia - r.lastPrev)/0.1)} بيب`);
    n++;
  }
}

// فجوات الاثنين ورأس الشهر فقط
let monCount = 0, monQual = 0, monthCount = 0, monthQual = 0;
const seenMon = new Set<number>(), seenMonth = new Set<number>();
for (const [d, r] of [...days.entries()].sort((a, b) => a[0] - b[0])) {
  if (r.firstAsia === null || r.lastPrev === null) continue;
  const dt = new Date(d * 86400e3);
  const gap = Math.abs(r.firstAsia - r.lastPrev) / 0.1;
  if (dt.getUTCDay() === 1 && !seenMon.has(d)) { seenMon.add(d); monCount++; if (gap >= 20 && gap <= 150) monQual++; }
  if (dt.getUTCDate() <= 3 && !seenMonth.has(dt.getUTCFullYear() * 100 + dt.getUTCMonth())) { seenMonth.add(dt.getUTCFullYear() * 100 + dt.getUTCMonth()); monthCount++; if (gap >= 20 && gap <= 150) monthQual++; }
}
console.log(`اثنين: ${monCount} افتتاح أسبوعي · مؤهل 20-150 بيب = ${monQual} · رأس شهر: ${monthCount} · مؤهل = ${monthQual}`);
