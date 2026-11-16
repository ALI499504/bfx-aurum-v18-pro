// ============================================================
// مقارنة المرشحين الجدد على البيانات الحقيقية — نفس النافذة المثبتة
// خط الأساس = البذرة المعتمدة (6327.61$) ثم تفعيل كل مرشح وحده ثم معاً.
// التشغيل: cd bfx-work && DATABASE_URL="file:./db/custom.db" bun scripts/compare-candidates.ts
// ============================================================
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { ingestMt5 } from '../src/lib/server/mt5feed';
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings } from '../src/lib/server/backtestRunner';
import type { Settings } from '../src/lib/engine/rules';

const SNAP = 'db/mt5-feed-snapshot.json.gz';
const CANDIDATES = ['BB', 'CC', 'DD'] as const;

async function main(): Promise<void> {
  const raw = gunzipSync(readFileSync(SNAP));
  const snap = JSON.parse(raw.toString('utf8')) as { tfs: Record<string, unknown[]>; symbol?: string; broker?: string; bridgeV?: number };
  ingestMt5({ tfs: snap.tfs, symbol: snap.symbol, broker: snap.broker, v: snap.bridgeV ?? 21 });

  const base = await loadBotSettings();
  const clone = (): Settings => JSON.parse(JSON.stringify(base)) as Settings;

  const run = (label: string, s: Settings): void => {
    const r = runBacktestCached(null, s, []);
    if (!r.ok) { console.log(`${label}: فشل — ${r.reason}`); return; }
    const st = r.stats;
    console.log(`${label.padEnd(22)} صافي=${st.netPnl.toFixed(2)}$ | صفقات=${st.totalTrades} | نجاح=${st.winRate.toFixed(1)}% | PF=${st.profitFactor.toFixed(2)} | DD=${st.maxDrawdownPct.toFixed(1)}% | R=${(st.totalR ?? 0).toFixed(1)}`);
  };

  console.log('--- المقارنة على النافذة المثبتة (نفس خط الأساس) ---');
  run('خط الأساس (البذرة)', clone());
  for (const id of CANDIDATES) {
    const s = clone();
    ((s.strategyParams as Record<string, { enabled?: boolean }>)[id] as { enabled?: boolean }).enabled = true;
    run(`+${id} وحده`, s);
  }
  const all = clone();
  for (const id of CANDIDATES) ((all.strategyParams as Record<string, { enabled?: boolean }>)[id] as { enabled?: boolean }).enabled = true;
  run('+BB+CC+DD معاً', all);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
