// إقلاع الوكيل الحارس مع عملية الخادم — مراقبة وإصلاح تلقائي على مدار الساعة
// يعمل تلقائياً عند تشغيل الخادم (dev أو production) دون أي تدخل يدوي.
import { JARVIS_SECTION_CLOSED } from '@/lib/jarvis-flag';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { guardian } = await import('@/lib/monitor/guardian');
      guardian.start();
    } catch (e) {
      console.error('[guardian] تعذر إقلاع الوكيل الحارس:', e);
    }
    // تسخين صوت جارفس — العبارات الجاهزة تُولَّد صامتة عند الإقلاع
    // فتنطق فوراً (كاش ساخن) عند أول أمر بدل انتظار التوليد.
    // (القسم مغلق بقرار المالك → لا تسخين صوت إطلاقاً)
    if (!JARVIS_SECTION_CLOSED) {
      try {
        const { warmVoice } = await import('@/lib/server/jarvis/voice');
        warmVoice([
          'حاضر يا سيدي.',
          'لحظات يا سيدي.',
          'في الخدمة يا سيدي.',
          'حاضر، أنفّذ الأمر الآن.',
          'تعذر إنجاز الأمر، التفاصيل أمامك يا سيدي.',
          'انقطع الاتصال بالخادم أثناء التنفيذ، أعد الأمر يا سيدي.',
        ]);
      } catch { /* الصوت اختياري */ }
    }
    // تسخين كاش الباك تيست الدائم — لقطات تحليل السنوات تُبنى مرة واحدة
    // صامتةً بعد الإقلاع، فأول «باك تيست 2025» من السيد فوري تماماً
    // بلا أي انتظار ولا إعادة بناء (جذر إصلاح عطل «خطأ يحتاج تدخل»).
    try {
      const { prewarmBacktest } = await import('@/lib/server/backtestCache');
      setTimeout(() => { prewarmBacktest().catch(() => { /* اختياري */ }); }, 20_000);
    } catch { /* التسخين اختياري */ }
  }
}
