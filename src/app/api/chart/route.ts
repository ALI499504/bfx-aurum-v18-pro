import { NextRequest, NextResponse } from 'next/server';
import { getLiveCandles, getClockSkewMs, isMt5Fresh, mt5Feed } from '@/lib/server/mt5feed';
import { TF_MS, TF } from '@/lib/engine/types';
import { emaSeries } from '@/lib/engine/indicators';

export const dynamic = 'force-dynamic';

/** شموع الشارت + مؤشرات العرض (EMA) — يدعم نطاقاً زمنياً (from/to) لشارت الصفقة
 *  شموع XAUUSD الحقيقية من طرفية MT5 فقط — لا بيانات محاكاة */
export async function GET(req: NextRequest) {
  // إصلاح «تجميد الشارت عند إغلاق شمعة 5m» (2026-11-17):
  // كان هذا الملف يستدعي getEngineData() — وهي تهدم كاش المحرك (تحليل الهيكل +
  // 29 كاشفاً + الإشارات) عند كل شمعة جديدة، فيُعاد بناؤه 4–8 ثوانٍ متزامنة
  // على instance واحد. القياس على الإنتاج: الشارت توقّف 40 ثانية لحظة إغلاق
  // شمعة (02:06:06) بينما كل قياس آخر 0.6–0.8s.
  //
  // الشارت لا يحتاج محرك القرارات إطلاقاً — يحتاج الشموع فقط، وهي متاحة مباشرة
  // من مخزن البث. بلا محرك: صفر هدم كاش، صفر تجميد، والشارت يُقاس الآن بنفس
  // سرعة أي قراءة أخرى.
  if (!isMt5Fresh(30 * 60_000)) {
    return NextResponse.json({ error: 'no_real_data', message: 'بانتظار الشموع الحقيقية من طرفية MT5 — شغّل أمر التشغيل على جهازك' }, { status: 503 });
  }

  const tf = (req.nextUrl.searchParams.get('tf') ?? '15m') as TF;
  const limit = Math.min(800, Number(req.nextUrl.searchParams.get('limit') ?? 350));
  const from = Number(req.nextUrl.searchParams.get('from') ?? 0);
  const to = Number(req.nextUrl.searchParams.get('to') ?? 0);

  // شموع العرض: المحاذاة الزمنية والقصّ يتمّان داخل getLiveCandles (مصدر واحد)،
  // فزمن آخر شمعة هو «الآن» الحقيقي لا ساعة الوسيط المتقدمة — وهذا سبب فراغ الشارت.
  const arr = getLiveCandles(tf, 60) ?? getLiveCandles('15m', 60);
  if (!arr || !arr.length) {
    return NextResponse.json({ error: 'no_real_data', message: 'شموع غير كافية للفريم المطلوب بعد' }, { status: 503 });
  }

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
    // فرق ساعة الجسر عن UTC بالدقائق (0 = متزامنة) — للتشخيص في الواجهة
    clockSkewMin: Math.round(getClockSkewMs() / 60e3),
    nowT: Date.now(),
    candles: slice,
    emaFast: emaFast.map((v, i) => ({ t: slice[i].t, v: Number.isFinite(v) ? v : null })),
    emaSlow: emaSlow.map((v, i) => ({ t: slice[i].t, v: Number.isFinite(v) ? v : null })),
    lastT: arr[arr.length - 1].t,
  });
}
