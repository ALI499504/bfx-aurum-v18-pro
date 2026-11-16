// ============================================================
// /api/tamsa — لقطة المحرك الموحّد (هيكل + LightGBM + أربع نقاط)
// ------------------------------------------------------------
// قراءة فقط: لا تنفّذ صفقة ولا تعدّل أي إعداد ولا تحسب لوتاً.
// تعرض ما يقرره المحرك على بيانات MT5 الحية وإعداداتك المحفوظة.
// ============================================================
import { NextResponse } from 'next/server';
import { getEngineData, getDataStatus } from '@/lib/server/data';
import { loadBotSettings } from '@/lib/server/backtestRunner';
import { mt5Feed, isMt5Fresh } from '@/lib/server/mt5feed';
import { tamsaEngine } from '@/lib/engine/tamsa-engine';
import { DEFAULT_TAMSA_PARAMS } from '@/lib/engine/tamsa-params';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('ml'); // strict | scenario | off

  const data = getEngineData();
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

  return NextResponse.json({
    ok: true,
    engine: 'tamsa',
    live: isMt5Fresh(),
    at: snapshot.at,
    // الهيكل
    structure: {
      trend1h: snapshot.structure.trend1h,
      trend4h: snapshot.structure.trend4h,
      trend1d: snapshot.structure.trend1d,
      sequence1h: snapshot.structure.sequence1h,
      pivots1h: snapshot.structure.h1.realPivots.length,
      events1h: snapshot.structure.h1.events.slice(-10),
      consolidations: snapshot.structure.consolidations.length,
    },
    // بوابة الحقن
    lightgbm: snapshot.lightGBM,
    // التأكيد الرباعي
    fourPoints: {
      confirmed: snapshot.fourPoints.confirmed,
      trend: snapshot.fourPoints.trend,
      score: snapshot.fourPoints.score,
      trailing: snapshot.fourPoints.trailing,
      gaps: snapshot.fourPoints.gaps,
      invalidated: snapshot.fourPoints.invalidated,
      reason: snapshot.fourPoints.reason,
    },
    // القواعد العليا (للشفافية فقط — لا تعديل)
    rules: {
      lot: snapshot.risk.lot,
      slCapPips: Number.isFinite(snapshot.risk.slCap) ? snapshot.risk.slCap : null,
      canOpen: snapshot.risk.canOpen,
      blocks: snapshot.risk.blocks,
    },
    // المقترحات
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
    // المحجوب
    blocked: snapshot.blocked.slice(0, 40),
    diagnostics: snapshot.diagnostics,
    summary: snapshot.summary,
  });
}
