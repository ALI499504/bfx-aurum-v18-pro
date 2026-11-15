// السيناريو الثاني: اختبار بوابة wf (قتل المثبت خسارته) + حدود الربح/الخسارة اليومية + الحجم
import { PrismaClient } from '@prisma/client';
import { loadData, runBacktest, EngineData } from '../src/lib/engine/backtest';
import { DEFAULT_SETTINGS, Settings } from '../src/lib/engine/rules';
import { mt5Feed } from '../src/lib/server/mt5feed';
import type { Candle } from '../src/lib/engine/types';

const db = new PrismaClient();
function fmt(n: number) { return (Math.round(n * 100) / 100).toString(); }

async function loadSettings(): Promise<Settings> {
  const row = await (db as any).botSettings.findUnique({ where: { key: 'main' } });
  const saved = row ? JSON.parse(row.json) : {};
  return {
    ...DEFAULT_SETTINGS, ...saved,
    globalRules: { ...DEFAULT_SETTINGS.globalRules, ...(saved.globalRules ?? {}) },
    sessions: { ...DEFAULT_SETTINGS.sessions, ...(saved.sessions ?? {}) },
    indicators: { ...DEFAULT_SETTINGS.indicators, ...(saved.indicators ?? {}) },
    manualLevels: { ...DEFAULT_SETTINGS.manualLevels, ...(saved.manualLevels ?? {}) },
    priority: saved.priority?.length === 3 ? saved.priority : DEFAULT_SETTINGS.priority,
  } as unknown as Settings;
}

function buildData(): EngineData | null {
  const s = mt5Feed();
  const raw: Record<string, Candle[]> = {};
  for (const tf of ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']) {
    const arr = s.tfs[tf]; if (arr && arr.length) raw[tf] = arr as Candle[];
  }
  if (!raw['5m'] || raw['5m'].length < 250) return null;
  return loadData(raw);
}

function brief(label: string, r: ReturnType<typeof runBacktest>) {
  const st = r.stats;
  console.log(`${label.padEnd(34)} | صفقات=${String(st.totalTrades).padStart(4)} | WR=${fmt(st.winRate).padStart(5)}% | صافي=${fmt(st.netPnl).padStart(8)}$ | PF=${fmt(st.profitFactor).padStart(5)} | DD=${fmt(st.maxDrawdownPct).padStart(6)}% | OOS=${fmt(st.oos.winRate).padStart(5)}%`);
  return st;
}

async function main() {
  const data = buildData();
  if (!data) return;
  const base0 = await loadSettings();
  const v = (fn: (s: any) => void): Settings => { const s = JSON.parse(JSON.stringify(base0)); fn(s); return s as Settings; };

  brief('خط الأساس', runBacktest(data, v(() => {})));
  brief('بوابة wf فقط (قيمة 40)', runBacktest(data, v(s => { s.globalRules.quality_gate = { enabled: true, value: 40 }; })));
  brief('بوابة wf (40) + ربح يومي مطفأ', runBacktest(data, v(s => { s.globalRules.quality_gate = { enabled: true, value: 40 }; s.globalRules.daily_profit_stop = { enabled: false, value: 30 }; })));
  brief('ربح يومي مطفأ فقط', runBacktest(data, v(s => { s.globalRules.daily_profit_stop = { enabled: false, value: 30 }; })));
  brief('ربح يومي 60', runBacktest(data, v(s => { s.globalRules.daily_profit_stop = { enabled: true, value: 60 }; })));
  brief('ربح 60 + خسارة 100', runBacktest(data, v(s => { s.globalRules.daily_profit_stop = { enabled: true, value: 60 }; s.globalRules.daily_loss_stop = { enabled: true, value: 100 }; })));
  brief('ربح مطفأ + خسارة 100', runBacktest(data, v(s => { s.globalRules.daily_profit_stop = { enabled: false, value: 30 }; s.globalRules.daily_loss_stop = { enabled: true, value: 100 }; })));
  const best = v(s => { s.globalRules.quality_gate = { enabled: true, value: 40 }; s.globalRules.daily_profit_stop = { enabled: false, value: 30 }; s.globalRules.daily_loss_stop = { enabled: true, value: 100 }; });
  brief('الأفضل + مخاطرة 0.5%', runBacktest(data, v(s => { s.globalRules.quality_gate = { enabled: true, value: 40 }; s.globalRules.daily_profit_stop = { enabled: false, value: 30 }; s.globalRules.daily_loss_stop = { enabled: true, value: 100 }; s.globalRules.risk_sizing = { enabled: true, value: 0.5 }; })));
  const r = runBacktest(data, best);
  console.log('\nblocked:', JSON.stringify(r.stats.blocked));
  console.log('railHits:', JSON.stringify(r.stats.railHits));
  console.log('ranking:', r.stats.ranking.slice(0, 8).map(x => `${x.strategy}:${fmt(x.net)}$/${x.trades}`).join('  '));
  console.log('أسوأ:', r.stats.ranking.slice(-4).map(x => `${x.strategy}:${fmt(x.net)}$/${x.trades}`).join('  '));
  console.log('شهري:', r.stats.monthly.map(m => `${m.month}:${fmt(m.net)}`).join('  '));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
