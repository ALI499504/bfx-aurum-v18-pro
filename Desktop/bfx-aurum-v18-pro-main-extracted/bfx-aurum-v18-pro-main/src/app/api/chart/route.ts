import { NextRequest, NextResponse } from 'next/server';
import { getEngineData } from '@/lib/server/data';
import { getLiveCandles, mt5Feed } from '@/lib/server/mt5feed';
import { TF_MS, TF } from '@/lib/engine/types';
import { emaSeries } from '@/lib/engine/indicators';

export const dynamic = 'force-dynamic';

/** شموع الشارت + مؤشرات العرض (EMA) — يدعم نطاقاً زمنياً (from/to) لشارت الصفقة
 *  شموع XAUUSD الحقيقية من طرفية MT5 فقط — لا بيانات محاكاة */
export async function GET(req: NextRequest) {
  const data = getEngineData();
  if (!data) {
    return NextResponse.json({ error: 'no_real_data', message: 'بانتظار الشموع الحقيقية من طرفية MT5 — شغّل أمر التشغيل على جهازك' }, { status: 503 });
  }

  const tf = (req.nextUrl.searchParams.get('tf') ?? '15m') as TF;
  const limit = Math.min(800, Number(req.nextUrl.searchParams.get('limit') ?? 350));
  const from = Number(req.nextUrl.searchParams.get('from') ?? 0);
  const to = Number(req.nextUrl.searchParams.get('to') ?? 0);

  const series: Record<string, typeof data.c5> = {
    '5m': data.c5, '15m': data.c15, '30m': data.c30, '1h': data.c1h,
    '4h': data.c4h, '1d': data.c1d, '1w': data.c1w, '1M': data.c1M,
  };
  const live = getLiveCandles(tf, 60);
  const arr = live ?? series[tf] ?? data.c15;

  // وضع النطاق: شموع حول فترة الصفقة (لفتح تفاصيل صفقة معينة)
  const slice = from && to
    ? arr.filter(c => c.t >= from - 30 * TF_MS[tf] && c.t <= to + 12 * TF_MS[tf]).slice(-180)
    : arr.slice(-limit);

  const emaFast = emaSeries(slice, 20);
  const emaSlow = emaSeries(slice, 90);

  return NextResponse.json({
    tf,
    source: 'mt5-real',
    symbol: mt5Feed().symbol,
    candles: slice,
    emaFast: emaFast.map((v, i) => ({ t: slice[i].t, v: Number.isFinite(v) ? v : null })),
    emaSlow: emaSlow.map((v, i) => ({ t: slice[i].t, v: Number.isFinite(v) ? v : null })),
    lastT: arr[arr.length - 1].t,
  });
}
