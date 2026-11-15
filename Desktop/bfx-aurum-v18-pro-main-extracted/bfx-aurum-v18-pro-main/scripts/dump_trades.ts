// ============================================================
// استخراج كل الصفقات من الباك تست المعتمد لتحليل مدد الاحتفاظ
// يكتب /tmp/bt_trades.json — بلا تعديل أي منطق، تشغيل حتمي مطابق
// ============================================================
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';

const settings = await loadBotSettings();
const realNews = await loadRealNews();
console.log('[dump] settings loaded — running full backtest...');
const t0 = Date.now();
const r = runBacktestCached(null, settings, realNews);
if (!r.ok) { console.error('[dump] FAILED:', r.reason); process.exit(1); }
console.log(`[dump] done in ${Date.now() - t0}ms | trades=${r.stats.totalTrades}`);

const gr = (settings as { globalRules?: Record<string, { enabled: boolean; value?: number }> }).globalRules ?? {};
console.log('قاعدة 3 min_hold_min:', JSON.stringify(gr.min_hold_min));
console.log('قاعدة 4 max_hold_hours:', JSON.stringify(gr.max_hold_hours));

const rows = r.trades.map(t => ({
  s: t.strategy, dir: t.dir, eT: t.entryT, xT: t.exitT, pnl: Math.round(t.pnl * 100) / 100,
  res: t.result, sess: t.session, lot: t.lot,
}));
await Bun.write('/tmp/bt_trades.json', JSON.stringify({ stats: r.stats, trades: rows }));
console.log(`[dump] saved /tmp/bt_trades.json (${rows.length} trades)`);
