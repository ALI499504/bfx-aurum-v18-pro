import { NextRequest, NextResponse } from 'next/server';
import { getLiveCandles, isMt5Fresh } from '@/lib/server/mt5feed';
import { TF } from '@/lib/engine/types';
import { buildForecast } from '@/lib/engine/forecast';

export const dynamic = 'force-dynamic';

/** التنبؤ الهيكلي — شموع مستقبلية متوقعة حتمية + نطاق الثقة + مزيج القرار
 *  يعمل على شموع XAUUSD الحقيقية من طرفية MT5 فقط. */
export async function GET(req: NextRequest) {
  // بلا مساس بكاش المحرك: التنبؤ يحتاج الشموع فقط (كان getEngineData هنا
  // يُهدم كاش المحرك عند كل شمعة جديدة — أحد جذور تجميد الشارت).
  if (!isMt5Fresh(30 * 60_000)) {
    return NextResponse.json({ error: 'no_real_data', message: 'بانتظار الشموع الحقيقية من طرفية MT5 — شغّل أمر التشغيل على جهازك' }, { status: 503 });
  }

  const tf = (req.nextUrl.searchParams.get('tf') ?? '15m') as TF;
  const arr = getLiveCandles(tf, 40) ?? getLiveCandles('15m', 40);
  if (!arr || arr.length < 40) return NextResponse.json({ error: 'not enough data' }, { status: 503 });

  const slice = arr.slice(-600);
  const fc = buildForecast(slice, tf);

  // شموع سياق حقيقية أخيرة (~70) لعرضها قبل الشموع المتنبأ بها
  const context = slice.slice(-70).map(c => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c }));

  return NextResponse.json({ ...fc, context, source: 'mt5-real' });
}
