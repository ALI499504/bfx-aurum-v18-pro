// ============================================================
// تسخين الإشارات عند إقلاع الخادم
// ------------------------------------------------------------
// الغرض: ألا يرى المستخدم أبداً حالة «الإشارات قيد البناء».
// بعد الإقلاع (أو إعادة النشر) يكون كاش الإشارات فارغاً، وأول من يفتح
// تبويب الإشارات كان يدفع ثمن بناء كامل. هنا نبنيه صامتاً قبل ذلك.
//
// لا يمس أي قرار: يشغّل نفس دالة الإشارات نفسها عبر طلب داخلي موقّع،
// ويفشل بصمت إن لم تصل البيانات بعد (الجسر يبدأ لاحقاً) — والطلب الحي
// يبقى قادراً على البناء عند الحاجة.
// ============================================================

const WARM_DELAY_MS = 25_000;  // بعد استقرار البث الأولي (نفس مهلة تسخين الباك تيست)
const RETRY_DELAY_MS = 90_000; // إعادة محاولة واحدة إن لم تكن البيانات جاهزة

async function warmOnce(baseUrl: string): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl}/api/signals`, {
      // الطلب البارد يُعيد 202 فوراً ويبدأ البناء في الخلفية — هذا هو المطلوب
      headers: { 'x-bfx-warm': '1' },
      cache: 'no-store',
    });
    return r.status === 200 || r.status === 202;
  } catch {
    return false;
  }
}

/** يُستدعى مرة واحدة من instrumentation عند الإقلاع (node runtime فقط) */
export function warmSignals(getBaseUrl: () => string | null): void {
  const run = async (delay: number, attempt: number) => {
    setTimeout(() => {
      void (async () => {
        const base = getBaseUrl();
        if (!base) return;
        const ok = await warmOnce(base);
        if (!ok && attempt < 1) run(RETRY_DELAY_MS, attempt + 1);
        else if (ok) console.log('[signals-warm] تم تسخين كاش الإشارات قبل أول زيارة');
      })();
    }, delay).unref?.();
  };
  run(WARM_DELAY_MS, 0);
}
