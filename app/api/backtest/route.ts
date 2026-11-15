import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEngineData, getDataStatus } from '@/lib/server/data';
import { runBacktest } from '@/lib/engine/backtest';
import { loadBotSettings, loadRealNews } from '@/lib/server/backtestRunner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // وضع meta الخفيف: بصمة النتيجة فقط (بلا سجل الصفقات) — يستعمله استطلاع المزامنة
  // كل 4 ثوانٍ عند كل مستخدم بدل تنزيل آلاف الصفقات في كل نبضة
  const metaOnly = req.nextUrl.searchParams.get('meta') === '1';
  try {
    const row = await db.backtestRun.findFirst({ orderBy: { runAt: 'desc' } });
    if (!row) return NextResponse.json({ exists: false });
    if (metaOnly) {
      const s = JSON.parse(row.statsJson) as Record<string, unknown>;
      return NextResponse.json({
        exists: true, meta: true, id: row.id, runAt: row.runAt,
        summary: { totalTrades: s.totalTrades, winRate: s.winRate, netPnl: s.netPnl },
      });
    }
    return NextResponse.json({
      exists: true,
      id: row.id,
      runAt: row.runAt,
      trades: JSON.parse(row.tradesJson),
      stats: JSON.parse(row.statsJson),
    });
  } catch {
    return NextResponse.json({ exists: false });
  }
}

export async function POST(req: NextRequest) {
  const status = getDataStatus();
  if (!status.ok) {
    return NextResponse.json({
      error: status.connected
        ? 'البيانات الحقيقية الواردة من MT5 غير كافية بعد — اترك الجسر يعمل عدة دقائق حتى تكتمل الشموع ثم أعد الاختبار'
        : 'لا توجد بيانات حقيقية — شغّل أمر التشغيل على جهازك (جسر MT5) لربط طرفية ميتاتريدر 5 بالبوت، فالباك تيست يعمل على شموع XAUUSD الحقيقية فقط'
    }, { status: 503 });
  }
  // التاريخ الكامل — الباك تيست اليدوي يستعرض كل التاريخ الحقيقي المتوفر
  const data = getEngineData(0);
  if (!data) return NextResponse.json({ error: 'فشل بناء بيانات المحرك من شموع MT5 الحقيقية' }, { status: 503 });

  const settings = await loadBotSettings();
  // أخبار ForexFactory الحقيقية فقط — إن لم تتوفر يعمل الفلتر بلا حجب (لا مواعيد مولّدة)
  const realNews = await loadRealNews();

  const t0 = Date.now();
  const result = runBacktest(data, settings, Date.now(), realNews);
  const runMs = Date.now() - t0;

  // حفظ آخر نتيجة — الحفظ يجعلها مرئية فوراً لكل المستخدمين (مزامنة لحظية)
  let savedId: string | null = null;
  try {
    const tradesCompact = result.trades.slice(-3000);
    const saved = await db.backtestRun.create({
      data: {
        tradesJson: JSON.stringify(tradesCompact),
        statsJson: JSON.stringify({ ...result.stats, finalStructure: result.finalStructure, runMs }),
      },
    });
    savedId = saved.id;
    // الاحتفاظ بآخر 3 نتائج فقط
    const runs = await db.backtestRun.findMany({ orderBy: { runAt: 'desc' }, skip: 3, select: { id: true } });
    for (const r of runs) await db.backtestRun.delete({ where: { id: r.id } });
  } catch { /* لا يفشل التشغيل بسبب الحفظ */ }

  return NextResponse.json({
    id: savedId,
    runAt: new Date().toISOString(),
    runMs,
    source: 'mt5-real',
    coverage: {
      from: status.from, to: status.to,
      counts: status.counts, symbol: status.symbol,
    },
    // آخر 3000 صفقة للعرض — الإحصائيات الكاملة محسوبة على كل الصفقات (stats.equity كامل)
    trades: result.trades.slice(-3000),
    stats: { ...result.stats, finalStructure: result.finalStructure, runMs },
    decisionLog: result.decisionLog,
  });
}
