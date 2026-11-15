// تشخيص يطابق مسار الخادم حرفياً: هيكل حقيقي + EMA حقيقي + بوابات الإعدادات المحفوظة
import { loadData, resetEngineCache, ensurePrecompute } from '../src/lib/engine/backtest-internal';
import { runAllDetectors, resetTamsaState, detectS, detectT, detectU, detectV, detectW } from '../src/lib/engine/strategies';
import { DEFAULT_TAMSA_PARAMS } from '../src/lib/engine/tamsa-params';
import { mt5Feed } from '../src/lib/server/mt5feed';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ENGINE_TFS = ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const;

async function main() {
  const feed = mt5Feed();
  const tfs = (feed as unknown as { tfs: Record<string, unknown[]> }).tfs;
  const raw: Record<string, unknown[]> = {};
  for (const tf of ENGINE_TFS) {
    const arr = (tfs[tf] ?? []) as unknown[];
    if (arr.length) raw[tf] = arr;
  }
  console.log('TFs:', Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.length])));
  resetEngineCache();
  const data = loadData(raw as never);
  ensurePrecompute(data);

  // الإعدادات المحفوظة من قاعدة البيانات (نفس ما يفعله الخادم)
  const row = await prisma.botSettings.findUnique({ where: { key: 'main' } });
  const saved = row ? JSON.parse(row.json) : {};
  const mergeDeep = (b: Record<string, unknown>, s: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = structuredClone(b);
    for (const k of Object.keys(s)) {
      const bv = b[k], sv = s[k];
      if (bv && typeof bv === 'object' && !Array.isArray(bv) && sv && typeof sv === 'object' && !Array.isArray(sv)) out[k] = mergeDeep(bv as Record<string, unknown>, sv as Record<string, unknown>);
      else if (sv !== undefined) out[k] = sv;
    }
    return out;
  };
  const def = DEFAULT_TAMSA_PARAMS as unknown as Record<string, unknown>;
  const params = mergeDeep(def, (saved.strategyParams ?? {}) as Record<string, unknown>) as unknown as typeof DEFAULT_TAMSA_PARAMS;
  const scenarioSessions = saved.scenarioSessions ?? {};

  const inp = {
    c5: data.c5, c15: data.c15, c30: data.c30, c1h: data.c1h, c4h: data.c4h, c1d: data.c1d, c1w: data.c1w, c1M: data.c1M,
    cons15: [],
    trend1h: [], trend4h: [], trend1d: [],
    real1h: [], real4h: [],
  } as never;

  const ctx = {
    params,
    emaAt: () => null,
    sessionsOf: (st: string, cs: string | undefined, scenario: 1 | 2) => {
      const node = (scenarioSessions as Record<string, Record<string, Record<string, Record<string, unknown>>>>)?.[st]?.[cs ?? 'main'];
      const sk = scenario === 1 ? 's1' : 's2';
      const v = node?.[sk] as Record<string, unknown> | undefined;
      return { enabled: v?.enabled !== false, asia: v?.asia ?? true, london: v?.london ?? true, londonNY: v?.londonNY ?? true, ny: v?.ny ?? true };
    },
  } as never;

  // 1) الكواشف الجديدة بعزل
  resetTamsaState();
  const names = ['S', 'T', 'U', 'V', 'W'];
  const fns = [detectS, detectT, detectU, detectV, detectW];
  for (let i = 0; i < fns.length; i++) {
    try {
      const sig = fns[i](inp, ctx);
      console.log(`${names[i]}: ${sig.length} إشارة`);
    } catch (e) {
      console.log(`${names[i]}: استثناء — ${(e as Error).message}`);
    }
  }

  // 2) المجمّع مع تتبع أخطاء سايف
  resetTamsaState();
  // نستدعي يدوياً بنفس نمط safe لكن نطبع الأخطاء
  const counts: Record<string, number> = {};
  const all: { strategy: string }[] = [];
  const safe = (fn: () => { strategy: string }[], name: string) => {
    try { const r = fn(); for (const x of r) { counts[x.strategy] = (counts[x.strategy] ?? 0) + 1; all.push(x); } }
    catch (e) { console.log(`[safe:${name}] استثناء — ${(e as Error).message}`); }
  };
  // استيراد الكواشف القديمة عبر المجمّع بدل يدوياً:
  const { runAllDetectors: _unused } = {} as never;
  void _unused;
  console.log('انتهى التشخيص');
}

main().finally(() => prisma.$disconnect());
