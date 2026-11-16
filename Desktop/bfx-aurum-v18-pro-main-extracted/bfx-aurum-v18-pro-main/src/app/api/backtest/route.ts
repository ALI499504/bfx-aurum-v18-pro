import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getDataStatus } from '@/lib/server/data';
import { runBacktestCached } from '@/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '@/lib/server/backtestRunner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const AR_DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

/** تجميع النتائج لكل استراتيجية — يخدم لوحة الأداء والمقارنة الدقيقة قبل/بعد إصلاحات خطة التحويل */
function byStrategy(trades: { strategy: string; pnl: number }[]) {
  const agg = new Map<string, { n: number; net: number; wins: number; gw: number; gl: number }>();
  for (const t of trades) {
    const a = agg.get(t.strategy) ?? { n: 0, net: 0, wins: 0, gw: 0, gl: 0 };
    a.n++; a.net += t.pnl;
    if (t.pnl > 0) { a.wins++; a.gw += t.pnl; } else if (t.pnl < 0) a.gl += -t.pnl;
    agg.set(t.strategy, a);
  }
  return [...agg.entries()].map(([strategy, a]) => ({
    strategy,
    trades: a.n,
    net: Math.round(a.net * 100) / 100,
    winrate: a.n ? Math.round((a.wins / a.n) * 1000) / 10 : 0,
    pf: a.gl > 0 ? Math.round((a.gw / a.gl) * 100) / 100 : (a.gw > 0 ? 99 : 0),
  })).sort((x, y) => y.net - x.net);
}

/** قراءة سنة مرنة: رقم، أو نص بأرقام لاتينية/عربية-هندية (من المايك: «٢٠٢٥» أو "2025") */
function parseYear(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string') {
    const s = v.replace(/[٠-٩۰-۹]/g, d => AR_DIGITS[d] ?? d).replace(/[^\d]/g, '');
    if (/^\d{4}$/.test(s)) return Number(s);
  }
  return null;
}

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
  // باك تيست لفترة محددة: {"year": 2025} أو {"from": 2020, "to": 2023} — يُحسب على
  // شموع XAUUSD الحقيقية الكاملة مع تسخين 180 يوماً قبل بداية الفترة، ولا صفقات
  // خارج نافذة التقرير. بلا وسائل = التاريخ الكامل كما هو.
  // الأداء: طبقة كاش اللقطات الدائمة — سنة منتهية تُبنى مرة واحدة ثم فورية للأبد
  // (وإلا كان كل طلب بعد شمعة 5m جديدة يعيد بناء التاريخ كاملاً 40+ث فيقطع خط الأنابيب).
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const b = body as Record<string, unknown>;
  const year = parseYear(b.year);
  const fromYear = parseYear(b.from);
  const toYear = parseYear(b.to);
  const MIN_YEAR = 2015;
  const MAX_YEAR = new Date().getFullYear();
  const checkYear = (y: number | null, name: string): string | null =>
    y !== null && (y < MIN_YEAR || y > MAX_YEAR) ? `السنة ${name} خارج النطاق المدعوم — المتاح من ${MIN_YEAR} إلى ${MAX_YEAR}` : null;
  const bad = checkYear(year, String(year ?? '')) ?? checkYear(fromYear, String(fromYear ?? '')) ?? checkYear(toYear, String(toYear ?? ''));
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  if ((fromYear !== null) !== (toYear !== null)) {
    return NextResponse.json({ error: 'لتحديد مدى مرّر from وto معاً (مثال {"from": 2020, "to": 2023})' }, { status: 400 });
  }

  const status = getDataStatus();
  const settings = await loadBotSettings();
  // أخبار ForexFactory الحقيقية فقط — إن لم تتوفر يعمل الفلتر بلا حجب (لا مواعيد مولّدة)
  const realNews = await loadRealNews();

  const result = runBacktestCached(year, settings, realNews, fromYear, toYear);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 503 });
  }
  const runMs = result.ms;

  // حفظ آخر نتيجة — الحفظ يجعلها مرئية فوراً لكل المستخدمين (مزامنة لحظية)
  let savedId: string | null = null;
  try {
    const tradesCompact = result.trades.slice(-3000);
    const saved = await db.backtestRun.create({
      data: {
        tradesJson: JSON.stringify(tradesCompact),
        statsJson: JSON.stringify({ ...result.stats, finalStructure: result.finalStructure, runMs, byStrategy: byStrategy(result.trades) }),
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
    source: status.connected ? 'mt5-real' : 'imported-history',
    ...(result.period ? { ...(year !== null ? { year } : {}), fromYear, toYear, period: result.period } : {}),
    coverage5m: result.cov5m ?? null,
    coverage: {
      from: status.from ?? '2015-01-01', to: status.to ?? new Date().toISOString(),
      counts: status.counts ?? {}, symbol: status.symbol ?? 'XAUUSD',
    },
    // آخر 3000 صفقة للعرض — الإحصائيات الكاملة محسوبة على كل الصفقات (stats.equity كامل)
    trades: result.trades.slice(-3000),
    stats: { ...result.stats, finalStructure: result.finalStructure, runMs, byStrategy: byStrategy(result.trades) },
    decisionLog: result.decisionLog,
  });
}
