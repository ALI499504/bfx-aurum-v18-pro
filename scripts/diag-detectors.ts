// تشخيص مباشر للكواشف الجديدة S–W على بيانات اللقطة الحقيقية
import { readFileSync } from 'fs';
import { loadData, resetEngineCache } from '../src/lib/engine/backtest';
import { runAllDetectors, resetTamsaState } from '../src/lib/engine/strategies';
import { DEFAULT_SETTINGS, buildScenarioSessions } from '../src/lib/engine/rules';
import { DEFAULT_TAMSA_PARAMS } from '../src/lib/engine/tamsa-params';
import { mt5Feed } from '../src/lib/server/mt5feed';
import { detectS, detectT, detectU, detectV, detectW } from '../src/lib/engine/strategies';

// بناء الحالة كما في الخادم
const feed = mt5Feed();
// اللقطة تُسترجع عند أول استدعاء mt5Feed() — نتحقق
const tfs = (feed as unknown as { tfs: Record<string, unknown[]> }).tfs;
const c5all = (tfs['5m'] ?? []) as { t: number }[];
console.log('5m candles:', c5all.length);
if (c5all.length < 250) { console.error('لا شموع — تحقق من اللقطة'); process.exit(1); }

const ENGINE_TFS = ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const;
const raw: Record<string, unknown[]> = {};
for (const tf of ENGINE_TFS) {
  const arr = (tfs[tf] ?? []) as unknown[];
  if (arr.length) raw[tf] = arr;
}
resetEngineCache();
const data = loadData(raw as never);

const settings = DEFAULT_SETTINGS;
settings.scenarioSessions = buildScenarioSessions();
const inp = {
  c5: data.c5, c15: data.c15, c30: data.c30, c1h: data.c1h, c4h: data.c4h, c1d: data.c1d, c1w: data.c1w, c1M: data.c1M,
  cons15: (data as unknown as { cons15?: unknown }).cons15 ?? [],
  trend1h: [], trend4h: [], trend1d: [],
  real1h: [], real4h: [],
} as never;

const ctx = {
  params: DEFAULT_TAMSA_PARAMS,
  emaAt: () => null,
  sessionsOf: () => ({ enabled: true, asia: true, london: true, londonNY: true, ny: true }),
} as never;

resetTamsaState();
const names = ['S', 'T', 'U', 'V', 'W'];
const fns = [detectS, detectT, detectU, detectV, detectW];
for (let i = 0; i < fns.length; i++) {
  try {
    const sig = fns[i](inp, ctx);
    console.log(`${names[i]}: ${sig.length} إشارة`);
    for (const s of sig.slice(0, 3)) console.log(`   مثال: ${s.dir} @${s.entry.toFixed(2)} sl=${s.slPips} tp=${s.tpPips} knownAt=${new Date(s.knownAt).toISOString().slice(0, 16)}`);
  } catch (e) {
    console.log(`${names[i]}: استثناء — ${(e as Error).message}`);
  }
}
// المجمّع الكامل
resetTamsaState();
const all = runAllDetectors(inp, ctx);
const cnt: Record<string, number> = {};
for (const s of all) cnt[s.strategy] = (cnt[s.strategy] ?? 0) + 1;
console.log('المجمّع:', JSON.stringify(cnt));
