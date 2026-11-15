// ============================================================
// تشخيص قمع الإشارات — أين تموت الفرص؟ (لمسة → سحب → تأكيد → FVG → بوابات)
// التشغيل: bun scripts/funnel-debug.ts
// ============================================================
import { mt5Feed } from '../src/lib/server/mt5feed';
import { loadData, resetEngineCache, runBacktest } from '../src/lib/engine/backtest';
import type { EngineData } from '../src/lib/engine/backtest';
import { SMC_CFG } from '../src/lib/engine/smc';
import type { Settings } from '../src/lib/engine/rules';

const settings: Settings = { lot: 0.01, spreadCents: 30 };

function getData(): EngineData {
  const s = mt5Feed();
  const raw: Record<string, unknown> = {};
  for (const tf of ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']) raw[tf] = s.tfs[tf];
  resetEngineCache();
  return loadData(raw);
}

resetEngineCache();
const data = getData();
// نعيد التشغيل مرتين: الأولى لتقدير zones عبر dbg داخل نفس التشغيل
const r = runBacktest(data, settings, Date.now());
const st = r.stats;
console.log(`صفقات: ${st.totalTrades} — إشارات (events): ${st.signalsCount} — مرفوضة: ${st.fillsBlocked}`);
console.log(`مرفوضة بالسبب:`, JSON.stringify(st.blocked));
console.log(`مناطق تشكّلت: ${st.zones.formed} — أُبطلت: ${st.zones.dead}`);
console.log(`صفقات/يوم نشط: ${(st.totalTrades / Math.max(1, st.daily.filter(d => d.trades > 0).length)).toFixed(2)}`);

// نطبع توزيع نتائج الخروج
const byResult: Record<string, number> = {};
for (const t of r.trades) byResult[t.result] = (byResult[t.result] ?? 0) + 1;
console.log(`توزيع الخروج:`, JSON.stringify(byResult));

// توزيع صفقات اليوم: أعلى 10 أيام
const top = [...st.daily].sort((a, b) => b.trades - a.trades).slice(0, 10);
console.log(`أعلى الأيام صفقات:`, top.map(d => `${d.day}:${d.trades}`).join(' '));
