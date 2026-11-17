import { NextResponse } from 'next/server';
import { alignMs, getClockSkewMs, isMt5Fresh, mergedLastCandle, mt5Feed, TF_KEYS } from '@/lib/server/mt5feed';
import { currentSession, syriaHour } from '@/lib/engine/sessions';

export const dynamic = 'force-dynamic';

let binanceCache: { t: number; price: number; changePct: number } | null = null;

// كاش النبضة الفائق القصر: كل طلبات كل الأجهزة/التبويبات ضمن نفس النبضة (~650ms)
// تأخذ نفس الحمولة المحسوبة مسبقاً — عشرات الطلبات في الثانية من عدة نوافذ
// لا تكلف الخادم سوى حساب واحد، وهذا كان السبب الرئيسي لتباطؤ الموقع مع تعدد النوافذ.
let tickCache: { t: number; payload: Record<string, unknown> } | null = null;

/** نقطة نبضة السعر اللحظية — أخف من status ومخصصة للتحديث السريع للواجهة:
 *  Dashboard تسحبها كل 700ms وTopBar كل ثانية، فيتحرك السعر في الشارت
 *  والشريط العلوي بنفس إيقاع شارت ميتاتريدر (خط Bid). */
export async function GET() {
  const t = Date.now();
  if (tickCache && t - tickCache.t < 650) {
    return NextResponse.json(tickCache.payload);
  }
  let payload: Record<string, unknown> | null = null;

  // 1) البث الحي من طرفية MetaTrader 5 على جهاز المستخدم
  if (isMt5Fresh()) {
    const s = mt5Feed();
    if (s.tick) {
      const bid = s.tick.bid;
      const d1 = s.tfs['1d'];
      const open = d1?.length ? d1[d1.length - 1].o : null;
      payload = {
        source: 'mt5',
        connected: true,
        bridgeV: s.bridgeV,
        symbol: s.symbol,
        broker: s.broker,
        price: bid,
        bid,
        ask: s.tick.ask,
        spread: +(s.tick.ask - s.tick.bid).toFixed(2),
        changePct: open ? +(((bid - open) / open) * 100).toFixed(2) : null,
        session: currentSession(t),
        syriaHour: syriaHour(t),
        // التيك بزمن UTC حقيقي (ساعة الوسيط تُحاذى في طبقة الجسر)
        tick: { ...s.tick, time: alignMs(s.tick.time) },
        clockSkewMin: Math.round(getClockSkewMs() / 60e3),
        serverTime: t,
        // آخر شمعة لكل فريم (مدموجة مع تيك البث الحي) — تحديث الشمعة الجارية بلا إعادة تحميل
        last: Object.fromEntries(TF_KEYS.map(tf => {
          const c = mergedLastCandle(s.tfs[tf], s.tick);
          return [tf, c ? { t: c.t, o: c.o, h: c.h, l: c.l, c: c.c } : null];
        })),
      };
    }
  }

  // 2) المرجع الاحتياطي: Binance PAXG (كاش 10 ثوانٍ) — بلا جسر حي
  if (!payload) {
    if (!binanceCache || t - binanceCache.t > 10000) {
      try {
        const r = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          binanceCache = { t, price: parseFloat(j.lastPrice), changePct: parseFloat(j.priceChangePercent) };
        }
      } catch { /* keep old cache */ }
    }
    payload = {
      source: 'binance',
      connected: false,
      bridgeV: mt5Feed().bridgeV,
      symbol: 'XAUUSD',
      price: binanceCache?.price ?? null,
      bid: binanceCache?.price ?? null,
      ask: null,
      spread: null,
      changePct: binanceCache?.changePct ?? null,
      session: currentSession(t),
      syriaHour: syriaHour(t),
      tick: null,
      serverTime: t,
      last: {},
    };
  }

  tickCache = { t, payload };
  return NextResponse.json(payload);
}
