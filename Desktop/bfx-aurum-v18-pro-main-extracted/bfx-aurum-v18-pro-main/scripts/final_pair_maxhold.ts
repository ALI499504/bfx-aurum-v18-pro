// ============================================================
// الزوج النهائي: قبل (القاعدة 4 معطلة) مقابل بعد (سقف 48 ساعة من قاعدة البيانات)
// نفس لقطة البيانات لكلا التشغيلين — عدالة كاملة للمقارنة + منحنيات الإيكويتي
// ============================================================
import { withBacktestEngine, resolveWindow } from '../src/lib/server/backtestCache';
import { resetEngineCache, runBacktest } from '../src/lib/engine/backtest';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';

const settings = await loadBotSettings();
const news = await loadRealNews();
const w = resolveWindow(null);
if (!w) { console.error('لا توجد بيانات'); process.exit(1); }
console.log('قاعدة 4 من قاعدة البيانات:', JSON.stringify(settings.globalRules.max_hold_hours));

function variant(capOff: boolean) {
  const s = JSON.parse(JSON.stringify(settings)) as typeof settings;
  if (capOff) s.globalRules.max_hold_hours = { enabled: false, value: 8 };
  return s;
}

const out: Record<string, unknown> = { runAt: new Date().toISOString(), variants: {} };
const rows: string[] = [];
for (const [key, capOff, label] of [
  ['before', true, 'قبل — بلا سقف (الوضع القديم)'],
  ['after48', false, 'بعد — سقف 48 ساعة (يومان) بخروج وقائي'],
] as const) {
  resetEngineCache();
  const t0 = Date.now();
  const rr = withBacktestEngine(w, data => runBacktest(data, variant(capOff), Date.now(), news));
  if (!rr.ok) { console.error(`${label} فشل: ${rr.reason}`); process.exit(1); }
  const r = rr.result;
  const st = r.stats;
  const dursH = r.trades.map(t => (t.exitT - t.entryT) / 3600e3);
  const over48 = dursH.filter(d => d > 48).length;
  const over72 = dursH.filter(d => d > 72).length;
  const longestH = Math.max(...dursH);
  const timeExits = r.trades.filter(t => t.result === 'time').length;
  rows.push(`${label} | ${st.totalTrades} | ${st.netPnl.toFixed(2)} | ${st.profitFactor.toFixed(3)} | ${st.winRate.toFixed(1)} | ${st.maxDrawdownPct.toFixed(2)} | ${timeExits} | ${over48} | ${over72} | ${(longestH / 24).toFixed(2)} يوم | ${Date.now() - t0}ms`);
  (out.variants as Record<string, unknown>)[key] = {
    label, stats: st,
    equity: st.equity,
    trades: r.trades.map(t => ({ s: t.strategy, dir: t.dir, eT: t.entryT, xT: t.exitT, pnl: Math.round(t.pnl * 100) / 100, res: t.result, sess: t.session })),
  };
}
console.log('النوع | صفقات | صافي$ | PF | نجاح% | DD% | خروج زمني | >48س | >72س | أطول صفقة');
for (const r of rows) console.log(r);
await Bun.write('/tmp/bt_final_pair.json', JSON.stringify(out));
console.log('\n[pair] saved /tmp/bt_final_pair.json');
