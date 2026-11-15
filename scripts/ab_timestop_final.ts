// ============================================================
// A/B نهائي: سقف الاحتفاظ الزمني (القاعدة 4) — يجيب على سؤال المالك:
// «ماذا تقترح لمنع بقاء الصفقة أكثر من يومين أو ثلاثة؟»
// المقارنة: 48 ساعة (المعتمد) / 72 ساعة / بلا سقف — مع وأثر تحجيم الجودة ×2
// نفس منهجية الباك تست الثابتة: لوت 0.01 أساس، سبريد 30 سنت، شموع MT5 الحقيقية
// ============================================================
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';
import { Settings } from '../src/lib/engine/rules';

const base = await loadBotSettings();
const realNews = await loadRealNews();
console.log('[ab] settings loaded — تشغيل السيناريوهات...');

const variants: { name: string; maxHold?: number; holdOff?: boolean; noSizing?: boolean }[] = [
  { name: 'أ) سقف 48 ساعة (المعتمد) + تحجيم ×2' },
  { name: 'ب) سقف 72 ساعة (ثلاثة أيام) + تحجيم ×2', maxHold: 72 },
  { name: 'ج) بلا سقف زمني + تحجيم ×2', holdOff: true },
  { name: 'د) سقف 48 ساعة بلا تحجيم ×2', noSizing: true },
];

const rows: string[] = [];
for (const v of variants) {
  const settings = structuredClone(base) as Settings;
  if (v.maxHold) settings.globalRules.max_hold_hours = { enabled: true, value: v.maxHold };
  if (v.holdOff) settings.globalRules.max_hold_hours = { enabled: false, value: 48 };
  if (v.noSizing) settings.globalRules.sizing_quality = { enabled: false, value: 2 };
  const t0 = Date.now();
  const r = runBacktestCached(null, settings, realNews);
  if (!r.ok) { console.error(`[${v.name}] FAILED:`, r.reason); continue; }
  const s = r.stats;
  const holds = r.trades.map(t => (t.exitT - t.entryT) / 3600e3);
  const maxHoldH = holds.length ? Math.max(...holds) : 0;
  const timeExits = r.trades.filter(t => t.result === 'time').length;
  const capH = v.holdOff ? 0 : (v.maxHold ?? 48);
  const overCap = capH > 0 ? holds.filter(h => h > capH + 0.1).length : 0;
  const line = `${v.name}\n   صفقات ${s.totalTrades} | صافي ${s.netPnl.toFixed(2)}$ | PF ${s.profitFactor.toFixed(3)} | DD ${s.maxDrawdownPct.toFixed(2)}% | نجاح ${s.winRate.toFixed(1)}%\n   أطول احتفاظ ${maxHoldH.toFixed(1)} ساعة | إغلاقات زمنية ${timeExits} | فوق السقف ${overCap} | (${((Date.now() - t0) / 1000).toFixed(0)} ثانية)`;
  console.log('\n' + line);
  rows.push(line);
}

await Bun.write('/tmp/ab_timestop_final.txt', rows.join('\n\n'));
console.log('\n[ab] saved /tmp/ab_timestop_final.txt');
