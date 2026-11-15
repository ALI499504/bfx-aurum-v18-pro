// دراسة تشخيصية: إعدادات البوت الحالية + آخر باك تيست حقيقي من DB
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

function fmt(n: number) { return (Math.round(n * 100) / 100).toString(); }

async function main() {
  // 1) الإعدادات المحفوظة فعلياً
  const row = await (db as any).botSettings.findUnique({ where: { key: 'main' } });
  if (!row) { console.log('== SETTINGS: NULL (الافتراضيات فقط) =='); }
  else {
    const s = JSON.parse(row.json);
    console.log('== SETTINGS SAVED AT ==');
    console.log('priority:', JSON.stringify(s.priority));
    console.log('tpRatio(top-level):', s.tpRatio);
    console.log('indicators:', JSON.stringify(s.indicators));
    console.log('--- sessions (per strategy: asia/london/londonNY/ny) ---');
    for (const [k, v] of Object.entries(s.sessions ?? {})) {
      const o = v as any;
      console.log(`  ${k}: asia=${o.asia ? 1 : 0} ldn=${o.london ? 1 : 0} ldnNY=${o.londonNY ? 1 : 0} ny=${o.ny ? 1 : 0}`);
    }
    console.log('--- globalRules (key: enabled/value) ---');
    for (const [k, v] of Object.entries(s.globalRules ?? {})) {
      const o = v as any;
      console.log(`  ${k}: ${o.enabled ? 1 : 0}${o.value !== undefined ? '/' + o.value : ''}`);
    }
  }

  // 2) آخر باك تيست
  const run = await (db as any).backtestRun.findFirst({ orderBy: { runAt: 'desc' } });
  if (!run) { console.log('== NO BACKTEST RUN =='); return; }
  const stats = JSON.parse(run.statsJson);
  const trades = JSON.parse(run.tradesJson);
  console.log('\n== LAST BACKTEST RUN ==');
  console.log('runAt:', run.runAt, '| startT:', new Date(stats.startT).toISOString(), '| endT:', new Date(stats.endT).toISOString());
  console.log(`totalTrades=${stats.totalTrades} winRate=${fmt(stats.winRate)}% netPnl=${fmt(stats.netPnl)}$ PF=${fmt(stats.profitFactor)} maxDD=${fmt(stats.maxDrawdown)}$ (${fmt(stats.maxDrawdownPct)}%)`);
  console.log(`signalsCount=${stats.signalsCount} fillsBlocked=${stats.fillsBlocked} | spread=${stats.spreadCents}c lot=${stats.lot} tpRatio=${stats.tpRatio} emaEnabled=${stats.emaEnabled}`);
  console.log(`OOS: trades=${stats.oos.trades} wr=${fmt(stats.oos.winRate)}% avgR=${fmt(stats.oos.avgR)} gatePass=${stats.oos.gatePass} (threshold=${stats.oos.threshold}, minTrades=${stats.oos.minTrades})`);
  console.log(`dailyKPI: daysTraded=${stats.dailyKpi.daysTraded} days2Plus=${stats.dailyKpi.daysWith2Plus} pct=${fmt(stats.dailyKpi.pct)}% excludedStopDays=${stats.dailyKpi.excludedStopDays}`);

  console.log('--- result distribution (all trades in tradesJson=آخر3000) ---');
  const byResult: Record<string, { n: number; pnl: number }> = {};
  for (const t of trades) {
    byResult[t.result] ??= { n: 0, pnl: 0 };
    byResult[t.result].n++; byResult[t.result].pnl += t.pnl;
  }
  for (const [k, v] of Object.entries(byResult)) console.log(`  ${k}: n=${v.n} pnl=${fmt(v.pnl)}$`);

  console.log('--- per strategy (from tradesJson) ---');
  const byStrat: Record<string, { n: number; pnl: number; w: number }> = {};
  for (const t of trades) {
    byStrat[t.strategy] ??= { n: 0, pnl: 0, w: 0 };
    byStrat[t.strategy].n++; byStrat[t.strategy].pnl += t.pnl;
    if (t.pnl > 0) byStrat[t.strategy].w++;
  }
  for (const [k, v] of Object.entries(byStrat).sort((a, b) => b[1].pnl - a[1].pnl))
    console.log(`  ${k}: n=${v.n} wr=${fmt(v.w / v.n * 100)}% pnl=${fmt(v.pnl)}$`);

  console.log('--- per session (from tradesJson) ---');
  const bySess: Record<string, { n: number; pnl: number; w: number }> = {};
  for (const t of trades) {
    bySess[t.session] ??= { n: 0, pnl: 0, w: 0 };
    bySess[t.session].n++; bySess[t.session].pnl += t.pnl;
    if (t.pnl > 0) bySess[t.session].w++;
  }
  for (const [k, v] of Object.entries(bySess).sort((a, b) => b[1].pnl - a[1].pnl))
    console.log(`  ${k}: n=${v.n} wr=${fmt(v.w / v.n * 100)}% pnl=${fmt(v.pnl)}$`);

  console.log('--- hold time & R multiples ---');
  const holds = trades.map(t => (t.exitT - t.entryT) / 3600e3);
  holds.sort((a, b) => a - b);
  if (holds.length) {
    const q = (p: number) => holds[Math.min(holds.length - 1, Math.floor(p * holds.length))];
    console.log(`  hold hours: p10=${fmt(q(0.1))} p50=${fmt(q(0.5))} p90=${fmt(q(0.9))} max=${fmt(holds[holds.length - 1])}`);
  }
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const avgW = wins.length ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0;
  const avgL = losses.length ? losses.reduce((a, t) => a + t.pnl, 0) / losses.length : 0;
  console.log(`  avgWin=${fmt(avgW)}$ avgLoss=${fmt(avgL)}$ | ratio=${fmt(Math.abs(avgL) > 0 ? avgW / Math.abs(avgL) : 0)}`);

  console.log('--- monthly net ---');
  const byMonth: Record<string, number> = {};
  for (const t of trades) {
    const mk = new Date(t.entryT + 3 * 3600e3).toISOString().slice(0, 7);
    byMonth[mk] = (byMonth[mk] ?? 0) + t.pnl;
  }
  for (const [k, v] of Object.entries(byMonth).sort()) console.log(`  ${k}: ${fmt(v)}$`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
