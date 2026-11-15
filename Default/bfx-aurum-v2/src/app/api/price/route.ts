import { NextResponse } from 'next/server';
import { getDataStatus } from '@/lib/server/data';
import { isMt5Fresh, mt5Feed } from '@/lib/server/mt5feed';
import { currentSession, syriaHour } from '@/lib/engine/sessions';

export const dynamic = 'force-dynamic';

let cachePrice: { t: number; data: unknown } | null = null;

/** السعر اللحظي + حالة المحرك — أولوية لبث MT5 الحي ثم Binance كمرجع */
export async function GET() {
  const t = Date.now();

  // 1) البث الحي من طرفية MetaTrader 5 على جهاز المستخدم
  if (isMt5Fresh()) {
    const s = mt5Feed();
    if (s.tick) {
      // شارت MT5 يعرض Bid — نطابقه تماماً لإلغاء أي اختلاف محسوس
      const bid = s.tick.bid;
      const d1 = s.tfs['1d'];
      const open = d1?.length ? d1[d1.length - 1].o : null;
      return NextResponse.json({
        source: 'mt5',
        symbol: s.symbol,
        broker: s.broker,
        price: bid,
        bid: s.tick.bid,
        ask: s.tick.ask,
        spread: +(s.tick.ask - s.tick.bid).toFixed(2),
        changePct: open ? +(((bid - open) / open) * 100).toFixed(2) : null,
        session: currentSession(t),
        syriaHour: syriaHour(t),
        dataStatus: getDataStatus(),
        serverTime: t,
      });
    }
  }

  // 2) المرجع الاحتياطي: Binance PAXG (كاش 10 ثوانٍ)
  if (!cachePrice || t - cachePrice.t > 10000) {
    try {
      const r = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        cachePrice = {
          t,
          data: {
            price: parseFloat(j.lastPrice),
            changePct: parseFloat(j.priceChangePercent),
            high: parseFloat(j.highPrice),
            low: parseFloat(j.lowPrice),
          },
        };
      }
    } catch { /* keep old cache */ }
  }
  const status = getDataStatus();
  return NextResponse.json({
    source: 'binance',
    price: (cachePrice?.data as { price?: number } | undefined)?.price ?? null,
    changePct: (cachePrice?.data as { changePct?: number } | undefined)?.changePct ?? null,
    session: currentSession(t),
    syriaHour: syriaHour(t),
    dataStatus: status,
    serverTime: t,
  });
}
