// ============================================================
// A/B: سقف الاحتفاظ الزمني (قاعدة 4) — قبل/48س/72س على النافذة الكاملة
// نفس المنهجية الثابتة: لوت 0.01، سبريد 30 سنت، نفس البيانات الحقيقية
// ============================================================
import { withBacktestEngine, resolveWindow } from '../src/lib/server/backtestCache';
import { resetEngineCache, runBacktest } from '../src/lib/engine/backtest';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';

const settings = await loadBotSettings();
const news = await loadRealNews();
const w = resolveWindow(null);
if (!w) { console.error('لا توجد بيانات'); process.exit(1); }

function variant(maxH: number | null) {
  const s = JSON.parse(JSON.stringify(settings)) as typeof settings;
  if (maxH === null) s.globalRules.max_hold_hours = { enabled: false, value: 8 };
  else s.globalRules.max_hold_hours = { enabled: true, value: maxH };
  return s;
}

const variants: { label: string; maxH: number | null; key: string }[] = [
  { label: 'قبل — القاعدة 4 معطلة (الوضع الحالي)', maxH: null, key: 'before' },
  { label: 'سقف 48 ساعة (يومان)', maxH: 48, key: 'h48' },
  { label: 'سقف 72 ساعة (ثلاثة أيام)', maxH: 72, key: 'h72' },
];

const out: Record<string, unknown> = { runAt: new Date().toISOString(), variants: {} };
console.log('النوع | صفقات | صافي$ | PF | نجاح% | DD% | خروج زمني');
for (const v of variants) {
  resetEngineCache();
  const t0 = Date.now();
  const rr = withBacktestEngine(w, data => runBacktest(data, variant(v.maxH), Date.now(), news));
  if (!rr.ok) { console.error(`${v.label} فشل: ${rr.reason}`); process.exit(1); }
  const r = rr.result;
  const st = r.stats;
  const timeExits = r.trades.filter(t => t.result === 'time').length;
  const over48 = r.trades.filter(t => t.exitT - t.entryT > 48 * 3600e3).length;
  const over72 = r.trades.filter(t => t.exitT - t.entryT > 72 * 3600e3).length;
  const maxHold = Math.max(...r.trades.map(t => (t.exitT - t.entryT) / 3600e3));
  console.log(`${v.label} | ${st.totalTrades} | ${st.netPnl.toFixed(2)} | ${st.profitFactor.toFixed(3)} | ${st.winRate.toFixed(1)} | ${st.maxDrawdownPct.toFixed(2)} | ${timeExits} | >48س:${over48} | >72س:${over72} | أطول:${maxHold.toFixed(1)}س | ${Date.now() - t0}ms`);
  (out.variants as Record<string, unknown>)[v.key] = {
    label: v.label,
    stats: st,
    trades: r.trades.map(t => ({ s: t.strategy, dir: t.dir, eT: t.entryT, xT: t.exitT, pnl: Math.round(t.pnl * 100) / 100, res: t.result })),
    equity: st.equityAll ?? null,
  };
}
await Bun.write('/tmp/bt_maxhold_ab.json', JSON.stringify(out));
console.log('\n[A/B] saved /tmp/bt_maxhold_ab.json');
