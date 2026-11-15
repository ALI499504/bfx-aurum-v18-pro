// ============================================================
// تدقيق الالتزام الصارم بالقواعد السبع — يشغّل الباك تيست ويفحص كل صفقة
// ============================================================
import { readFileSync } from 'fs';
import { runBacktest, loadData } from '../src/lib/engine/backtest';
import { DEFAULT_SETTINGS } from '../src/lib/engine/rules';
import type { Candle } from '../src/lib/engine/types';

const snap = JSON.parse(readFileSync('/home/z/my-project/db/mt5-feed-snapshot.json', 'utf8'));
const raw: Record<string, Candle[]> = {};
for (const [tf, arr] of Object.entries(snap.tfs as Record<string, any[]>)) {
  raw[tf] = (arr as any[]).map((c: any) => (Array.isArray(c) ? { t: c[0], o: c[1], h: c[2], l: c[3], c: c[4], v: c[5] ?? 0 } : c));
}
const data = loadData(raw);
const res = runBacktest(data, DEFAULT_SETTINGS);

console.log('=== ملخص ===');
console.log(`صفقات: ${res.stats.totalTrades} | ربحية: ${res.stats.winRate.toFixed(1)}% | صافي: ${res.stats.netPnl.toFixed(2)}$ | PF: ${res.stats.profitFactor.toFixed(2)}`);
console.log(`مناطق: ${res.stats.zones.formed} | ميتة: ${res.stats.zones.dead} (إغلاق عبر: ${res.stats.zones.deadByClose})`);
console.log(`مرفوضات: ${JSON.stringify(res.stats.blocked)}`);
console.log(`توزيع الفريمات: MN1=${res.stats.perTf.MN1.trades} W1=${res.stats.perTf.W1.trades} D1=${res.stats.perTf.D1.trades}`);

// ---------- كاشفات المخالفات ----------
let violations = 0;
const bad = (msg: string) => { violations++; console.log(`⚠ مخالفة: ${msg}`); };

for (const tr of res.trades) {
  // القاعدة 7: R:R >= 1:2 إلزامي
  if ((tr.rr ?? 0) < 2) bad(`صفقة #${tr.id} R:R=${tr.rr?.toFixed(2)} < 1:2`);
  // القاعدة 3: أول لمسة على فريم المنطقة شرط أساسي — كل صفقة يجب أن تكون من منطقة ملموسة (لمسات >= 1)
  const m = tr.reason.match(/لمسات فريم المنطقة (\d+)/);
  if (!m) bad(`صفقة #${tr.id} بلا عدد لمسات فريم المنطقة في السبب`);
  else if (Number(m[1]) === 0) bad(`صفقة #${tr.id} دخلت من منطقة لم تُلمس على فريمها (${m[1]} لمسة)`);
  // اتجاه الصفقة يوافق المنطقة: شراء من دعم وبيع من مقاومة
  if (tr.dir === 'buy' && !tr.reason.includes('دعم')) bad(`صفقة #${tr.id} شراء من غير دعم`);
  if (tr.dir === 'sell' && !tr.reason.includes('مقاومة')) bad(`صفقة #${tr.id} بيع من غير مقاومة`);
  // القاعدة 6: التأكيد على M5 أو M15 فقط
  if (tr.confirmTf !== 'M5' && tr.confirmTf !== 'M15') bad(`صفقة #${tr.id} تأكيد على فريم غير M5/M15: ${tr.confirmTf}`);
  // القاعدة 6: لا دخول إلا بتأكيد BOS أو سحب سيولة
  if (!tr.reason.includes('BOS') && !tr.reason.includes('سحب سيولة')) bad(`صفقة #${tr.id} بلا تأكيد BOS/سحب سيولة`);
}

// التوزيع
const first = res.trades.filter(t => t.reason.includes('الفرصة الأساسية')).length;
const touched = res.trades.filter(t => t.reason.includes('منطقة ملموسة')).length;
console.log(`\nالفرصة الأساسية (بعد أول لمسة): ${first} | منطقة ملموسة (M15 فقط): ${touched}`);

// التأكيدات
const bos = res.trades.filter(t => t.reason.includes('BOS')).length;
const sweep = res.trades.filter(t => t.reason.includes('سحب سيولة')).length;
console.log(`تأكيد BOS: ${bos} | تأكيد سحب سيولة: ${sweep}`);

// عينة من أول 10 صفقات
console.log('\n=== عينة الصفقات (أول 10) ===');
for (const tr of res.trades.slice(0, 10)) {
  console.log(`#${tr.id} ${new Date(tr.entryT).toISOString().slice(0, 10)} ${tr.dir} دخول ${tr.entry.toFixed(2)} وقف ${tr.sl.toFixed(2)} هدف ${tr.tp.toFixed(2)} R:R=${tr.rr} ${tr.result} ${tr.pnl >= 0 ? '+' : ''}${tr.pnl.toFixed(2)}$ [${tr.zoneTf}/${tr.confirmTf}]`);
  console.log(`   ${tr.reason}`);
}

// آخر 5 صفقات
console.log('\n=== آخر 5 صفقات ===');
for (const tr of res.trades.slice(-5)) {
  console.log(`#${tr.id} ${new Date(tr.entryT).toISOString().slice(0, 10)} ${tr.dir} [${tr.zoneTf}/${tr.confirmTf}] ${tr.result} ${tr.pnl >= 0 ? '+' : ''}${tr.pnl.toFixed(2)}$ R:R=${tr.rr}`);
  console.log(`   ${tr.reason}`);
}

console.log(`\nإجمالي المخالفات المكتشفة: ${violations}`);
