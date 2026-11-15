// إقلاع الوكيل الحارس مع عملية الخادم — مراقبة وإصلاح تلقائي على مدار الساعة
// يعمل تلقائياً عند تشغيل الخادم (dev أو production) دون أي تدخل يدوي.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { guardian } = await import('@/lib/monitor/guardian');
      guardian.start();
    } catch (e) {
      console.error('[guardian] تعذر إقلاع الوكيل الحارس:', e);
    }
  }
}
