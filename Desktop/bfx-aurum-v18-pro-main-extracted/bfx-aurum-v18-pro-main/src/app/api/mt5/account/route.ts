import { NextResponse } from 'next/server';
import { getMt5LiveSnapshot } from '@/lib/server/mt5feed';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface DealLike {
  t: number; dir: 'buy' | 'sell'; entry: 'in' | 'out';
  volume: number; price: number; profit: number;
  swap: number; commission: number; position: number;
  sl: number; tp: number; comment: string;
}

interface ClosedTrade {
  position: number;
  dir: 'buy' | 'sell';
  volume: number;
  openT: number; closeT: number;
  openPrice: number; closePrice: number;
  sl: number; tp: number;
  profit: number;       // صافي = ربح + عمولات + سواب كل صفقات المركز
  comment: string;
  dealsCount: number;
}

/** مطابقة صفقات MT5 المنفذة (deals) إلى صفقات مكتملة حقيقية حسب رقم المركز */
function matchDeals(deals: DealLike[]): ClosedTrade[] {
  const groups = new Map<number, DealLike[]>();
  for (const d of deals) {
    if (!d.position) continue;
    const g = groups.get(d.position);
    if (g) g.push(d); else groups.set(d.position, [d]);
  }
  const out: ClosedTrade[] = [];
  for (const [position, g] of groups) {
    const ins = g.filter(d => d.entry === 'in');
    const outs = g.filter(d => d.entry === 'out');
    if (!ins.length || !outs.length) continue;
    const volIn = ins.reduce((s, d) => s + d.volume, 0);
    if (volIn <= 0) continue;
    // متوسط مرجّح بالحجم
    const wAvg = (arr: DealLike[]) => {
      const v = arr.reduce((s, d) => s + d.volume, 0);
      if (v <= 0) return arr[0]?.price ?? 0;
      return arr.reduce((s, d) => s + d.price * d.volume, 0) / v;
    };
    const openT = Math.min(...ins.map(d => d.t));
    const closeT = Math.max(...outs.map(d => d.t));
    const sl = outs.map(d => d.sl).find(x => x > 0) ?? ins.map(d => d.sl).find(x => x > 0) ?? 0;
    const tp = outs.map(d => d.tp).find(x => x > 0) ?? ins.map(d => d.tp).find(x => x > 0) ?? 0;
    out.push({
      position,
      dir: ins[0].dir,
      volume: volIn,
      openT, closeT,
      openPrice: wAvg(ins),
      closePrice: wAvg(outs),
      sl, tp,
      profit: g.reduce((s, d) => s + d.profit + d.swap + d.commission, 0),
      comment: ins[0].comment || outs[0].comment || '',
      dealsCount: g.length,
    });
  }
  return out.sort((a, b) => b.closeT - a.closeT);
}

export async function GET() {
  const snap = getMt5LiveSnapshot();
  if (!snap.connected) {
    return NextResponse.json({ connected: false });
  }
  // مستويات الصفقات الحية (المعلقة والمفتوحة) — من سجل محرك التنفيذ المصحح ذاتياً
  // (reconcile يغلق الصفوف المنفذة فعلياً من MT5 — فلا تبقى خطوط قديمة على الشارت)
  const liveLevels = await db.liveOrder.findMany({
    where: { status: { in: ['sent', 'placed', 'filled'] } },
    orderBy: { createdAtMs: 'desc' },
    take: 8,
  }).catch(() => []);
  const closed = matchDeals(snap.deals as DealLike[]);
  const openIds = new Set(snap.positions.map(p => p.ticket));
  return NextResponse.json({
    connected: true,
    symbol: snap.symbol,
    broker: snap.broker,
    account: snap.account,
    tick: snap.tick,
    updatedAt: snap.updatedAt,
    positions: snap.positions,
    openTrades: snap.positions.map(p => ({
      position: p.ticket,
      dir: p.dir,
      volume: p.volume,
      openT: p.t,
      openPrice: p.priceOpen,
      currentPrice: p.priceCurrent,
      sl: p.sl,
      tp: p.tp,
      floating: p.profit + p.swap,
      swap: p.swap,
      comment: p.comment,
    })),
    closedTrades: closed.filter(t => !openIds.has(t.position)),
    // مستويات الصفقات الحية — خطوط الدخول/الوقف/الهدف على شارت لوحة القيادة
    liveLevels: liveLevels.map(r => ({
      kind: r.status === 'filled' ? 'position' : 'pending',
      ticket: r.ticket ?? r.planId,
      dir: r.dir === 'buy' ? 'buy' : 'sell',
      strategy: r.strategy,
      entry: r.entry,
      sl: r.sl,
      tp: r.tp,
      t: Math.round(r.status === 'filled' ? (r.updatedAtMs || r.createdAtMs) : r.createdAtMs),
    })),
  });
}
