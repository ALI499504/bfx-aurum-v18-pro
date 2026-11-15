// إعادة إنتاج التقييم الأصلي للمدير الآلي — بالإعدادات قبل التعطيل (X/H/I مفعّلة)
import Database from 'bun:sqlite';
import { runBacktest } from '../src/lib/engine/backtest';
import { getEngineData } from '../src/lib/server/data';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';

const settings = await loadBotSettings();
// إعادة الحالة الأصلية: X/H/I مفعّلة كما كانت عند أول دورة
const sp = settings.strategyParams as unknown as Record<string, { enabled?: boolean }>;
sp.X = { ...(sp.X ?? {}), enabled: true };
sp.H = { ...(sp.H ?? {}), enabled: true };
sp.I = { ...(sp.I ?? {}), enabled: true };

const realNews = await loadRealNews();
const data = getEngineData();
if (!data) { console.log('لا بيانات'); process.exit(1); }

const result = runBacktest(data, settings, Date.now(), realNews);
const allTr = result.trades as unknown as { strategy: string; pnl: number; entryT?: number }[];
console.log('إجمالي الصفقات:', allTr.length);

const nowMs = Date.now();
const WINDOW_MS = 90 * 86400e3;
const evaluate = allTr.filter(t => (t.entryT ?? 0) >= nowMs - WINDOW_MS);
console.log('نافذة تقييم 90 يوماً:', evaluate.length);

function metrics(trades: typeof allTr, st: string) {
  const t = trades.filter(x => x.strategy === st);
  if (!t.length) return null;
  let gw = 0, gl = 0, net = 0, wins = 0;
  for (const x of t) { net += x.pnl; if (x.pnl >= 0) { gw += x.pnl; wins++; } else gl += -x.pnl; }
  return { n: t.length, pf: Math.round((gl > 0 ? gw / gl : 99) * 100) / 100, net: Math.round(net * 100) / 100, wr: Math.round(wins / t.length * 100) };
}

// معايير التعطيل: n>=10 && pf<1.0 && net<0
console.log('\n=== في نافذة التقييم (90 يوماً) ===');
for (const st of ['X', 'H', 'I', 'W', 'Y', 'AA', 'U', 'V']) {
  const m = metrics(evaluate, st);
  if (!m) { console.log(st, '— لا صفقات'); continue; }
  const disable = m.n >= 10 && m.pf < 1.0 && m.net < 0;
  console.log(`${st}: n=${m.n} pf=${m.pf} net=${m.net}$ wr=${m.wr}% ${disable ? '← ← ← معطل بالمعايير' : ''}`);
}

console.log('\n=== على النافذة الكاملة ===');
for (const st of ['X', 'H', 'I', 'W', 'Y', 'AA']) {
  const m = metrics(allTr, st);
  if (m) console.log(`${st}: n=${m.n} pf=${m.pf} net=${m.net}$ wr=${m.wr}%`);
}

// صمامات: كم ضربت؟
console.log('\nالصمامات:', JSON.stringify((result.stats as { fuseTrips?: unknown }).fuseTrips ?? {}));
