import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getMt5Status } from '@/lib/server/mt5feed';

export const dynamic = 'force-dynamic';

// ============================================================
// السلة المعتمدة — محفظة ظل معزولة على أساس افتراضي 1000$
// تُحسب من صفقات آخر باك تيست محفوظ (بيانات MT5 حقيقية) ولا تمس
// أي حساب حقيقي. الأرقام هنا مشتقة مباشرة من الصفقات: لا تقديرات.
// ============================================================

interface Trade {
  strategy: string;
  entryT: number; exitT: number; pnl: number; result: string; r?: number;
}

interface Metrics {
  n: number; wr: number; pf: number; net: number; dd: number; ddp: number;
  risk: number; riskp: number; minbal: number; streak: number; avgr: number;
}

const BASE = 1000;

function metrics(trades: Trade[]): Metrics {
  const n = trades.length;
  if (!n) {
    return { n: 0, wr: 0, pf: 0, net: 0, dd: 0, ddp: 0, risk: 0, riskp: 0, minbal: BASE, streak: 0, avgr: 0 };
  }
  let bal = BASE, peak = BASE, minbal = BASE, maxDd = 0;
  let wins = 0, grossWin = 0, grossLoss = 0, streak = 0, maxStreak = 0, rSum = 0, rN = 0;
  for (const t of trades) {
    bal += t.pnl;
    if (bal > peak) peak = bal;
    const dd = peak - bal;
    if (dd > maxDd) maxDd = dd;
    if (bal < minbal) minbal = bal;
    if (t.pnl > 0) { wins++; grossWin += t.pnl; streak = 0; }
    else if (t.pnl < 0) { grossLoss += Math.abs(t.pnl); streak++; if (streak > maxStreak) maxStreak = streak; }
    if (Number.isFinite(t.r)) { rSum += t.r as number; rN++; }
  }
  const net = bal - BASE;
  const losses = n - wins;
  const risk = losses ? grossLoss / losses : 0;
  return {
    n,
    wr: +(100 * wins / n).toFixed(2),
    pf: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : grossWin > 0 ? 99 : 0,
    net: +net.toFixed(2),
    dd: +maxDd.toFixed(2),
    ddp: +(100 * maxDd / BASE).toFixed(2),
    risk: +risk.toFixed(2),
    riskp: +(100 * risk / BASE).toFixed(2),
    minbal: +minbal.toFixed(2),
    streak: maxStreak,
    avgr: rN ? +(rSum / rN).toFixed(4) : 0,
  };
}

export async function GET() {
  const run = await db.backtestRun.findFirst({ orderBy: { runAt: 'desc' } });
  if (!run) {
    return NextResponse.json({ ok: false, error: 'لا توجد صفقات محفوظة بعد — شغّل الباك تيست أولاً' }, { status: 409 });
  }
  const trades = (JSON.parse(run.tradesJson) as Trade[]).slice().sort((a, b) => a.entryT - b.entryT);
  const now = Date.now();
  const window365 = trades.filter(t => t.entryT >= now - 365 * 86400e3);
  const lastTrade = trades[trades.length - 1];

  // منحنى الرصيد والتدفق الشهري
  const monthly: { month: string; net: number }[] = [];
  const byMonth = new Map<string, number>();
  for (const t of trades) {
    const d = new Date(t.entryT);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + t.pnl);
  }
  for (const [month, net] of [...byMonth.entries()].sort()) monthly.push({ month, net: +net.toFixed(2) });

  const all = metrics(trades);
  const recent = metrics(window365);
  const status = getMt5Status();
  const lastDayNet = trades.filter(t => t.exitT >= now - 86400e3).reduce((a, t) => a + t.pnl, 0);

  return NextResponse.json({
    ok: true,
    computedAt: now,
    candles: status.counts['1h'] ?? 0,
    dataFrom: (status.oldest as Record<string, number | null>)['1h'] ?? null,
    dataTo: lastTrade?.exitT ?? null,
    note: 'السلة المعتمدة تعمل بمعزولها الحرفي — محفظة ظل على أساس افتراضي 1000$ ولا تمس الحساب الحقيقي',
    validation: Object.entries(
      trades.reduce<Record<string, Trade[]>>((acc, t) => {
        (acc[t.strategy] ??= []).push(t);
        return acc;
      }, {}),
    ).map(([strategy, list]) => ({ name: strategy, window: 'all', m: metrics(list) })),
    live: {
      equityNow: +(BASE + all.net).toFixed(2),
      netNow: all.net,
      floatingNow: 0,
      peakEquity: +(BASE + all.net + all.dd).toFixed(2),
      fuseTrips: { daily: 0, weekly: 0, equity: 0 },
      fuseState: { dayBlocked: false, weekBlocked: false, equityHalted: false },
      dayPnlNow: +lastDayNet.toFixed(2),
      weekPnlNow: +trades.filter(t => t.exitT >= now - 7 * 86400e3).reduce((a, t) => a + t.pnl, 0).toFixed(2),
      metricsAll: all,
      metrics365: recent,
      monthly,
      open: [],
    },
    runAt: run.runAt.toISOString(),
  });
}
