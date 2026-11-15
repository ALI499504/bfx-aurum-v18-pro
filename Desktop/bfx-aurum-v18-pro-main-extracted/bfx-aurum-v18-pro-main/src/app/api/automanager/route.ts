import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { loadBotSettings, loadRealNews } from '@/lib/server/backtestRunner';
import { runBacktestCached } from '@/lib/server/backtestCache';
import { computeAutoDecisions, applyAutoDecisions, buildReport, AutoManagerReport } from '@/lib/engine/autoManager';
import { DEFAULT_SETTINGS, buildScenarioSessions, defaultLadders, Settings } from '@/lib/engine/rules';
import { pushAlert } from '@/lib/server/alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** قراءة آخر تقرير مدير آلي محفوظ */
export async function GET() {
  try {
    const row = await db.botSettings.findUnique({ where: { key: 'autoManager' } });
    if (!row) return NextResponse.json({ exists: false });
    const j = JSON.parse(row.json) as { report?: AutoManagerReport };
    return NextResponse.json({ exists: true, report: j.report, updatedAt: row.updatedAt });
  } catch (e) {
    return NextResponse.json({ exists: false, error: String(e).slice(0, 150) });
  }
}

/**
 * تشغيل المدير الآلي:
 * 1) إعادة ضبط المصنع لبوابات الجلسات (إزالة أثر التحكم اليدوي القديم)
 * 2) باك تيست كامل على الشموع الحقيقية بالإعدادات الحالية
 * 3) قرارات تعطيل/تفعيل/قتل جلسات مسببة بالأرقام
 * 4) تطبيق القرارات على إعدادات البوت + توثيق التقرير
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const factory = body?.factoryReset !== false; // افتراضياً يعيد بوابات الجلسات للافتراضي

    const status = getDataStatusSafe();
    if (!status) {
      return NextResponse.json({ ok: false, error: 'لا توجد شموع حقيقية مستلمة من MT5 — فعّل الجسر أولاً' }, { status: 503 });
    }

    // 1) إعدادات الأساس: المصنع لبوابات الجلسات والسلم، والحفاظ على معاملات الضبط
    const saved = await loadBotSettings();
    const base: Settings = {
      ...saved,
      scenarioSessions: factory ? buildScenarioSessions() : saved.scenarioSessions,
      priorityLadder: factory ? defaultLadders() : saved.priorityLadder,
    };

    // 2) الباك تيست الكامل (كل التاريخ المتوفر من شموع MT5)
    const news = await loadRealNews();
    const result = runBacktestCached(null, base, news);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: 503 });
    }

    // 3) القرارات من الصفقات الحقيقية — بعينة الحكم (القاعدة 29) وبوابة السبريد (القاعدة 2)
    const trades = result.trades as unknown as { strategy: string; session: string; pnl: number; result: string }[];
    const currentEnabled: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(base.strategyParams as unknown as Record<string, { enabled?: boolean }>)) {
      currentEnabled[k] = v?.enabled !== false;
    }
    const grAuto = base.globalRules as Record<string, { enabled?: boolean; value?: number } | undefined>;
    const spreadCentsAuto = grAuto.fixed_spread?.enabled !== false ? (grAuto.fixed_spread?.value ?? 30) : 0;
    const lotAuto = grAuto.fixed_lot?.enabled !== false ? (grAuto.fixed_lot?.value ?? 0.01) : 0.01;
    const { decisions, enable, sessionKills } = computeAutoDecisions(trades, {
      currentEnabled,
      spreadCostPerTrade: (spreadCentsAuto / 100) * (lotAuto / 0.01),
      spreadGuardFactor: grAuto.gate_spread_guard?.value ?? 1,
      minSample: grAuto.gate_min_sample?.enabled !== false ? (grAuto.gate_min_sample?.value ?? 30) : 1,
    });

    // 4) التطبيق والتوثيق
    const applied = applyAutoDecisions(base, decisions, sessionKills);
    const report = buildReport(trades, decisions, enable, {
      from: result.stats.startT ? new Date(result.stats.startT).toISOString() : undefined,
      to: result.stats.endT ? new Date(result.stats.endT).toISOString() : undefined,
    }, factory ? 'factory-reset+decide' : 'decide');

    const merged = { ...(DEFAULT_SETTINGS as unknown as Record<string, unknown>), ...(applied as unknown as Record<string, unknown>) };
    await db.botSettings.upsert({
      where: { key: 'main' },
      create: { key: 'main', json: JSON.stringify(merged) },
      update: { json: JSON.stringify(merged) },
    });
    await db.botSettings.upsert({
      where: { key: 'autoManager' },
      create: { key: 'autoManager', json: JSON.stringify({ report }) },
      update: { json: JSON.stringify({ report }) },
    });

    // تنبيه قرارات المدير الآلي — السجل الحي وتليجرام
    const disabled = decisions.filter(d => d.kind === 'disable-strategy');
    const enabled = decisions.filter(d => d.kind === 'enable-strategy');
    pushAlert('auto', 'قرارات المدير الآلي',
      `تعطيل: ${disabled.map(d => d.strategy).join('، ') || 'لا شيء'}\nتفعيل: ${enabled.map(d => d.strategy).join('، ') || 'لا شيء'}\nقتل جلسات: ${report.summary.sessionKills} | إجمالي الصفقات: ${report.summary.totalTrades}`);

    return NextResponse.json({
      ok: true,
      summary: report.summary,
      decisions: report.decisions,
      stats: {
        totalTrades: result.stats.totalTrades,
        winRate: result.stats.winRate,
        pf: result.stats.profitFactor,
        net: result.stats.netPnl,
        dd: result.stats.maxDrawdownPct,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200) }, { status: 500 });
  }
}

function getDataStatusSafe(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDataStatus } = require('@/lib/server/data') as { getDataStatus(): { ok: boolean } };
    return getDataStatus().ok;
  } catch {
    return false;
  }
}
