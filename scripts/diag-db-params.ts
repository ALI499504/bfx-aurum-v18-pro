// تشخيص نهائي: عزل سبب صفر إشارات S–W داخل الخادم
// يجرّب: (1) معاملات DB + بوابات DB (2) معاملات افتراضية — ويطبع الفروق
import { loadData, resetEngineCache } from '../src/lib/engine/backtest';
import { detectS, detectT, detectU, detectV, detectW, resetTamsaState } from '../src/lib/engine/strategies';
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
  resetEngineCache();
  const data = loadData(raw as never);
  console.log('c15:', data.c15.length, '| c1h:', data.c1h.length, '| c4h:', data.c4h.length);

  const row = await prisma.botSettings.findUnique({ where: { key: 'main' } });
  const saved = row ? JSON.parse(row.json) : {} as Record<string, unknown>;
  const sp = (saved.strategyParams ?? {}) as Record<string, Record<string, unknown>>;
  console.log('DB S raw:', JSON.stringify(sp.S).slice(0, 300));
  console.log('DB T raw:', JSON.stringify(sp.T).slice(0, 300));
  console.log('DB U raw:', JSON.stringify(sp.U).slice(0, 200));

  const mergeDeep = (b: Record<string, unknown>, s: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = structuredClone(b);
    for (const k of Object.keys(s)) {
      const bv = b[k], sv = s[k];
      if (bv && typeof bv === 'object' && !Array.isArray(bv) && sv && typeof sv === 'object' && !Array.isArray(sv)) out[k] = mergeDeep(bv as Record<string, unknown>, sv as Record<string, unknown>);
      else if (sv !== undefined) out[k] = sv;
    }
    return out;
  };
  const paramsDB = mergeDeep(DEFAULT_TAMSA_PARAMS as unknown as Record<string, unknown>, sp) as unknown as typeof DEFAULT_TAMSA_PARAMS;
  const scenarioSessions = (saved.scenarioSessions ?? {}) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;

  const inp = {
    c5: data.c5, c15: data.c15, c30: data.c30, c1h: data.c1h, c4h: data.c4h, c1d: data.c1d, c1w: data.c1w, c1M: data.c1M,
    cons15: [], trend1h: [], trend4h: [], trend1d: [], real1h: [], real4h: [],
  } as never;

  const mkCtx = (params: unknown, sessions: unknown) => ({
    params,
    emaAt: () => null,
    sessionsOf: (st: string, cs: string | undefined, scenario: 1 | 2) => {
      const node = (sessions as Record<string, Record<string, Record<string, Record<string, unknown>>>>)?.[st]?.[cs ?? 'main'];
      const v = node?.[scenario === 1 ? 's1' : 's2'];
      return { enabled: v?.enabled !== false, asia: v?.asia ?? true, london: v?.london ?? true, londonNY: v?.londonNY ?? true, ny: v?.ny ?? true };
    },
  });

  const names = ['S', 'T', 'U', 'V', 'W'];
  const fns = [detectS, detectT, detectU, detectV, detectW];

  console.log('\n--- مع معاملات DB وبوابات DB ---');
  resetTamsaState();
  const ctxDB = mkCtx(paramsDB, scenarioSessions);
  for (let i = 0; i < fns.length; i++) {
    try {
      const sig = fns[i](inp, ctxDB as never);
      console.log(`${names[i]}: ${sig.length}`);
    } catch (e) { console.log(`${names[i]}: استثناء — ${(e as Error).message}`); }
  }

  console.log('\n--- مع الافتراضي الكامل وبوابات مفتوحة ---');
  resetTamsaState();
  const ctxDef = mkCtx(DEFAULT_TAMSA_PARAMS, {});
  for (let i = 0; i < fns.length; i++) {
    try {
      const sig = fns[i](inp, ctxDef as never);
      console.log(`${names[i]}: ${sig.length}`);
    } catch (e) { console.log(`${names[i]}: استثناء — ${(e as Error).message}`); }
  }

  // مقارنة المعاملات المدمجة مقابل الافتراضي لكل استراتيجية جديدة
  console.log('\n--- فرق المعاملات ---');
  for (const st of names) {
    const a = JSON.stringify((DEFAULT_TAMSA_PARAMS as unknown as Record<string, unknown>)[st]);
    const b = JSON.stringify((paramsDB as unknown as Record<string, unknown>)[st]);
    console.log(`${st}: ${a === b ? 'مطابق' : 'مختلف!'}`);
    if (a !== b) { console.log('  def:', a.slice(0, 200)); console.log('  db :', b.slice(0, 200)); }
  }
}

main().finally(() => prisma.$disconnect());
