// ============================================================
// تحقق نهائي: تشغيل محرك الإنتاج runBacktest (نفس كود الـ API)
// على البيانات الحقيقية وطباعة الإحصاءات الموثقة
// ============================================================
import { readFileSync } from 'fs';
import { Candle } from '../src/lib/engine/types';
import { loadData, runBacktest } from '../src/lib/engine/backtest';

const toCandles = (rows: unknown[]): Candle[] =>
  (rows as [number, number, number, number, number, number][])
    .filter(r => Array.isArray(r) && r.length >= 5 && Number.isFinite(r[0]) && r[0] > 0 && r[2] >= r[3])
    .map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] ?? 0 }));

const snap = JSON.parse(readFileSync('db/mt5-feed-snapshot.json', 'utf8'));
const files: Record<string, Candle[]> = {};
for (const [k, v] of Object.entries(snap.tfs as Record<string, unknown[]>)) {
  const c = toCandles(v);
  if (c.length > 50) files[k] = c;
}
console.log('frames:', Object.entries(files).map(([k, v]) => `${k}=${v.length}`).join(' '));

const data = loadData(files);
const settings = { lot: 0.01, spreadCents: 30 };
const lastT = data.c5[data.c5.length - 1].t + 300e3;
const res = runBacktest(data, settings, lastT);

const s = res.stats;
const fmt = (n: number) => n.toFixed(2);
console.log('════════ نتيجة التحقق النهائي — محرك الإنتاج S v2.0 ════════');
console.log(`الفترة: ${new Date(s.startT).toISOString()} → ${new Date(s.endT).toISOString()}`);
console.log(`صفقات: ${s.totalTrades} | رابحة: ${s.wins} | خاسرة: ${s.losses}`);
console.log(`نسبة النجاح: ${fmt(s.winRate)}%`);
console.log(`صافي الربح: ${fmt(s.netPnl)}$ | PF: ${fmt(s.profitFactor)} | أقصى تراجع: ${fmt(s.maxDrawdownPct)}%`);
console.log(`IS (أول 70%): ${res.stats.totalTrades ? '—' : ''} | OOS (آخر 30%): ${s.oos.trades} صفقة بنجاح ${fmt(s.oos.winRate)}%`);
console.log(`إجمالي R: ${fmt(s.totalR)} | متوسط R: ${fmt(s.avgR)}`);
console.log('حسب فريم المنطقة:');
for (const [k, v] of Object.entries(s.perTf))
  console.log(`  ${k}: ${v.trades} صفقة | نجاح ${fmt(v.winRate)}% | صافي ${fmt(v.net)}$ | avgR ${fmt(v.avgR)}`);
console.log(`مرفوضات البوابات: ${JSON.stringify(s.blocked)}`);
