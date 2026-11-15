// اختبار محرك استراتيجية رأس الذيل على بيانات MT5 الحقيقية من اللقطة
import fs from 'node:fs';
import { loadData, runBacktest } from '../src/lib/engine/backtest';
import type { Candle } from '../src/lib/engine/types';
import { DEFAULT_SETTINGS } from '../src/lib/engine/rules';

type Raw = [number, number, number, number, number, number];

function toCandles(a: Raw[]): Candle[] {
  return a.map(x => ({ t: x[0], o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] }));
}

const snap = JSON.parse(fs.readFileSync('db/mt5-feed-snapshot.json', 'utf8'));
const tfs = snap.tfs as Record<string, Raw[]>;
const files: Record<string, Candle[]> = {};
for (const tf of ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']) {
  if (tfs[tf]?.length) files[tf] = toCandles(tfs[tf]);
}

const fmtD = (t: number) => new Date(t + 3 * 3600e3).toISOString().slice(0, 10);

function report(label: string, year: number | null) {
  const data = loadData(files);
  const r = runBacktest(data, { ...DEFAULT_SETTINGS }, Date.now(), year ? {
    fromT: Date.UTC(year, 0, 1),
    toT: Math.min(Date.UTC(year + 1, 0, 1) - 1, files['5m'][files['5m'].length - 1].t + 300e3),
  } : undefined);
  const s = r.stats;
  console.log(`\n========== ${label} ==========`);
  console.log(`الفترة: ${fmtD(s.startT)} → ${fmtD(s.endT)}`);
  console.log(`الصفقات: ${s.totalTrades} | رابحة ${s.wins} | خاسرة ${s.losses} | نجاح ${s.winRate.toFixed(1)}%`);
  console.log(`صافي: ${s.netPnl >= 0 ? '+' : ''}${s.netPnl.toFixed(2)}$ | PF ${s.profitFactor.toFixed(2)} | أقصى تراجع ${s.maxDrawdown.toFixed(2)}$ (${s.maxDrawdownPct.toFixed(1)}%)`);
  console.log(`R: مجموع ${s.totalR} | متوسط ${s.avgR}`);
  console.log(`تأكيدات: ${s.signalsCount} | مرفوض: ${s.fillsBlocked} | الأسباب:`, JSON.stringify(s.blocked));
  console.log(`مناطق: تشكلت ${s.zones.formed} | أُبطلت بإغلاق عبرها ${s.zones.deadByClose} | رفض قوية ${s.zones.strongRejections}`);
  console.log('تفكيك الفريمات:', JSON.stringify(s.perTf));
  const sample = r.trades.slice(-6);
  console.log('عينة آخر الصفقات:');
  for (const t of sample) {
    console.log(`  #${t.id} ${t.dir === 'buy' ? 'شراء' : 'بيع'} ${t.zoneTf}/${t.confirmTf} دخول ${t.entry.toFixed(2)} → خروج ${t.exit.toFixed(2)} (${t.result}) R:R 1:${t.rr?.toFixed(2)} pnl ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}$`);
    console.log(`    ${t.reason.slice(0, 150)}`);
  }
  console.log(`أوامر بانتظار التأكيد الآن: ${r.finalPending.length}`);
  for (const p of r.finalPending.slice(0, 4)) {
    console.log(`  ${p.dir === 'buy' ? 'شراء' : 'بيع'} ${p.zoneTf} ${p.side === 'support' ? 'دعم' : 'مقاومة'} ${p.tip.toFixed(2)} — ${p.awaiting}`);
  }
  console.log(`مناطق قريبة الآن: ${r.zonesNear.length}`);
  for (const z of r.zonesNear.slice(0, 6)) {
    console.log(`  ${z.tf} ${z.side === 'support' ? 'دعم' : 'مقاومة'} ${z.tip.toFixed(2)} قوة ${z.strength} لمسات ${z.touches}`);
  }
  if (r.decisionLog.length) {
    console.log('آخر سطور سجل القرارات:');
    for (const d of r.decisionLog.slice(-8)) console.log('  ' + d.line);
  }
  return s;
}

report('كل التاريخ المتاح (5m منذ 2025-06)', null);
report('سنة 2025', 2025);
report('سنة 2026 حتى اليوم', 2026);
