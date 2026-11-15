import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getDataStatus } from '@/lib/server/data';
import { runBacktestCached } from '@/lib/server/backtestCache';
import { loadBotSettings, loadRealNews, summarizeStats } from '@/lib/server/backtestRunner';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const TOKEN = process.env.MT5_TOKEN ?? 'bfx-aurum-mt5-v1';

/**
 * تشغيل الباك تيست الحقيقي تلقائياً — يستدعيها الجسر v17 من جهاز
 * المستخدم فور اكتمال سحب التاريخ العميق (2025-01-01 → اليوم).
 * تعمل على شموع XAUUSD الحقيقية الواصلة من طرفية MT5 فقط، وتحفظ
 * النتيجة في قاعدة البيانات كي تظهر مباشرة في صفحة الباك تيست.
 */
export async function POST(req: NextRequest) {
  if (req.headers.get('x-bfx-token') !== TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const status = getDataStatus();
  if (!status.ok) {
    return NextResponse.json({
      ok: false,
      error: status.connected
        ? 'البيانات الحقيقية الواردة من MT5 غير كافية بعد — لن يُشغَّل باك تيست على شموع ناقصة'
        : 'لا توجد بيانات حقيقية متصلة — لن يُشغَّل باك تيست بدون شموع حقيقية من طرفية MT5',
    }, { status: 503 });
  }

  // منع التكرار: نتيجة محفوظة منذ أقل من 10 دقائق؟ أعد ملخصها فقط
  try {
    const last = await db.backtestRun.findFirst({ orderBy: { runAt: 'desc' } });
    if (last && Date.now() - new Date(last.runAt).getTime() < 10 * 60_000) {
      const stats = JSON.parse(last.statsJson);
      return NextResponse.json({
        ok: true, skipped: true, runAt: last.runAt,
        coverage: { from: stats.startT, to: stats.endT, counts: status.counts, symbol: status.symbol },
        summary: summarizeStats(stats),
      });
    }
  } catch { /* تابع التشغيل */ }

  // التاريخ الكامل عبر كاش اللقطات — بلا إعادة بناء ثقيلة مع كل نداء
  const realNews = await loadRealNews();
  const settings = await loadBotSettings();
  const result = runBacktestCached(null, settings, realNews);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: 503 });
  }
  const runMs = result.ms;
  const stats = result.stats;
  const trades = result.trades;

  try {
    await db.backtestRun.create({
      data: {
        tradesJson: JSON.stringify(trades.slice(-3000)),
        statsJson: JSON.stringify({ ...stats, finalStructure: result.finalStructure, runMs }),
      },
    });
    // الاحتفاظ بآخر 3 نتائج فقط
    const runs = await db.backtestRun.findMany({ orderBy: { runAt: 'desc' }, skip: 3, select: { id: true } });
    for (const r of runs) await db.backtestRun.delete({ where: { id: r.id } });
  } catch { /* لا يفشل التشغيل بسبب الحفظ */ }

  return NextResponse.json({
    ok: true,
    runAt: new Date().toISOString(),
    runMs,
    source: 'mt5-real',
    coverage: {
      fromMs: stats.startT, toMs: stats.endT,
      from: status.from, to: status.to,
      counts: status.counts, symbol: status.symbol,
    },
    summary: summarizeStats(stats),
  });
}
