// ============================================================
// /api/tamsa — لقطة المحرك الموحّد (هيكل + LightGBM + أربع نقاط)
// ------------------------------------------------------------
// قراءة فقط: لا تنفّذ صفقة ولا تعدّل أي إعداد ولا تحسب لوتاً.
//
// ⚠ حماية حلقة الأحداث (إصلاح 2026-11-16):
//   التحليل الكامل كان يستغرق 201 ثانية على 4569 إشارة، فيحجب حلقة Node
//   الواحدة ويُجمّد /api/chart و/api/mt5/tick — فيختفي الشارت من الواجهة.
//   الآن: كاش بمفتاح الشمعة المغلقة + سقف زمني + single-flight، فالاستجابة
//   فورية والمعالجة الثقيلة لا تُنفّذ إلا مرة واحدة لكل شمعة جديدة.
// ============================================================
import { NextResponse } from 'next/server';
import { getEngineWindow, getDataStatus } from '@/lib/server/data';
import { loadBotSettings } from '@/lib/server/backtestRunner';
import { mt5Feed, isMt5Fresh } from '@/lib/server/mt5feed';
import { tamsaEngine } from '@/lib/engine/tamsa-engine';
import { DEFAULT_TAMSA_PARAMS } from '@/lib/engine/tamsa-params';
import type { TAMSASnapshot } from '@/lib/engine/tamsa-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// كاش عالمي يصمد أمام HMR — الاستجابة فورية دائماً، والتحديث في الخلفية
const g = globalThis as unknown as {
  __tamsaCache?: {
    key: string;
    payload: unknown;
    busy: Promise<void> | null;
    lastMs: number;
  };
};
const cache = g.__tamsaCache ?? (g.__tamsaCache = { key: '', payload: null, busy: null, lastMs: 0 });

/** تحويل اللقطة إلى شكل الاستجابة */
function toPayload(snapshot: TAMSASnapshot, live: boolean) {
  return {
    ok: true,
    engine: 'tamsa',
    live,
    at: snapshot.at,
    structure: {
      trend1h: snapshot.structure.trend1h,
      trend4h: snapshot.structure.trend4h,
      trend1d: snapshot.structure.trend1d,
      sequence1h: snapshot.structure.sequence1h,
      pivots1h: snapshot.structure.h1.realPivots.length,
      events1h: snapshot.structure.h1.events.slice(-10),
      consolidations: snapshot.structure.consolidations.length,
    },
    lightgbm: snapshot.lightGBM,
    fourPoints: {
      confirmed: snapshot.fourPoints.confirmed,
      trend: snapshot.fourPoints.trend,
      score: snapshot.fourPoints.score,
      trailing: snapshot.fourPoints.trailing,
      gaps: snapshot.fourPoints.gaps,
      invalidated: snapshot.fourPoints.invalidated,
      reason: snapshot.fourPoints.reason,
    },
    rules: {
      lot: snapshot.risk.lot,
      slCapPips: Number.isFinite(snapshot.risk.slCap) ? snapshot.risk.slCap : null,
      canOpen: snapshot.risk.canOpen,
      blocks: snapshot.risk.blocks,
    },
    proposals: snapshot.proposals.map(p => ({
      strategy: p.setup.strategy,
      case: p.setup.case,
      scenario: p.setup.scenario,
      dir: p.setup.dir,
      entry: p.setup.entry,
      sl: p.setup.sl,
      tp: p.setup.tp,
      slPips: p.setup.slPips,
      tpPips: p.setup.tpPips,
      lot: p.lot,
      riskDollars: p.riskDollars,
      session: p.setup.session,
      reason: p.setup.reason,
      evidence: p.evidence,
    })),
    blocked: snapshot.blocked.slice(0, 40),
    diagnostics: snapshot.diagnostics,
    summary: snapshot.summary,
    cached: true,
    lastMs: cache.lastMs,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('ml');
  const force = url.searchParams.get('fresh') === '1';

  // نافذة تحليل مخصصة: السقف اليومي 50 صفقة والستوب 72 ساعة، فأي بنية
  // أقدم من 30 يوماً لا تُنتج إشارة قابلة للتنفيذ. قصّ النافذة خفض التحليل
  // من 4787ms إلى 409ms (11.7×) بنفس عدد المقترحات بالضبط.
  //
  // قراءة-فقط: لا تمس كاش المحرك. كان getEngineData(30) يهدم الكاش الذي
  // تستخدمه بقية النقاط بنافذة 120 يوماً، فيُعاد بناؤه 9–13 ثانية متزامنة
  // عند كل تنقل بين TAMSA والشارت — وهذا سبب تجميد /api/chart الثاني.
  const data = getEngineWindow(30);
  if (!data) {
    const st = getDataStatus();
    return NextResponse.json({
      ok: false,
      error: st.connected
        ? 'بيانات MT5 غير مكتملة بعد — اترك الجسر يعمل ثم أعد المحاولة'
        : 'لا يوجد بث حي من MT5 — شغّل الجسر على جهازك أولاً',
      engine: 'tamsa',
    }, { status: 200 });
  }

  // مفتاح الكاش: آخر شمعة مغلقة + الفريم + نمط البوابة
  const c15 = data.c15;
  const key = `${c15.length ? c15[c15.length - 1].t : 0}:${mode ?? 'default'}`;

  // إصابة كاش: فوري
  if (!force && cache.payload && cache.key === key) {
    return NextResponse.json(cache.payload);
  }

  // سقف زمني: إن كان التحليل السابق لا يزال جارياً، أعِد آخر نتيجة بدل الانتظار
  if (cache.busy) {
    if (cache.payload) return NextResponse.json({ ...(cache.payload as object), busy: true });
    return NextResponse.json({
      ok: false,
      engine: 'tamsa',
      busy: true,
      error: 'التحليل الأول قيد التنفيذ — أعد المحاولة بعد لحظات',
    }, { status: 202 });
  }

  const work = (async () => {
    const settings = await loadBotSettings();
    const params = settings?.strategyParams ?? DEFAULT_TAMSA_PARAMS;

    if (mode === 'strict' || mode === 'scenario' || mode === 'off') {
      tamsaEngine.configure({ lightGBMMode: mode });
    }

    const feed = mt5Feed();
    const dayPnL = typeof feed.account?.profit === 'number' ? feed.account.profit : 0;

    const snapshot = tamsaEngine.analyze(
      {
        '5m': data.c5, '15m': data.c15, '30m': data.c30,
        '1h': data.c1h, '4h': data.c4h, '1d': data.c1d,
        '1w': data.c1w, '1M': data.c1M,
      },
      params,
      settings ?? undefined,
      { dayPnL },
    );

    cache.payload = toPayload(snapshot, isMt5Fresh());
    cache.key = key;
    cache.lastMs = snapshot.diagnostics.durationMs;
  })();

  cache.busy = work.finally(() => { cache.busy = null; });

  // ننتظر التحليل لكن بسقف: إن تجاوز 25 ثانية نُعيد 202 بدل تعليق الطلب
  const raced = await Promise.race([
    work.then(() => 'done' as const),
    new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 25_000)),
  ]);

  if (raced === 'timeout') {
    if (cache.payload) return NextResponse.json({ ...(cache.payload as object), busy: true });
    return NextResponse.json({
      ok: false, engine: 'tamsa', busy: true,
      error: 'التحليل الأول ما زال جارياً (بيانات كبيرة) — أعد المحاولة بعد ~30 ثانية',
    }, { status: 202 });
  }

  return NextResponse.json(cache.payload ?? { ok: false, engine: 'tamsa', error: 'لا نتيجة' });
}
