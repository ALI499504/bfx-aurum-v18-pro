// ============================================================
// Rate Limiter بسيط للذاكرة — حماية ضد الإساءة والتحميل الزائد
// يعمل على مستوى العملية (process-wide) — مناسب لـ Next.js standalone
// ============================================================

interface RateLimitWindow {
  count: number;
  resetAt: number;
}

const windowMap = new Map<string, RateLimitWindow>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

/**
 * Rate limiter انزلاقي بسيط:
 * - windowMs: نافذة زمنية (مثلاً 60000 = دقيقة)
 * - max: أقصى طلبات في النافذة
 * - key: مفتاح فريد (IP + endpoint مثلاً)
 */
export function rateLimit(key: string, windowMs: number, max: number): RateLimitResult {
  const now = Date.now();
  const w = windowMap.get(key);

  if (!w || now >= w.resetAt) {
    // نافذة جديدة
    const newWindow = { count: 1, resetAt: now + windowMs };
    windowMap.set(key, newWindow);
    return { ok: true, remaining: max - 1, resetAt: newWindow.resetAt };
  }

  if (w.count >= max) {
    // تجاوز الحد
    return {
      ok: false,
      remaining: 0,
      resetAt: w.resetAt,
      retryAfter: Math.ceil((w.resetAt - now) / 1000),
    };
  }

  w.count++;
  return { ok: true, remaining: max - w.count, resetAt: w.resetAt };
}

/** تنظيف النوافذ القديمة كل 5 دقائق */
function cleanup() {
  const now = Date.now();
  for (const [key, w] of windowMap.entries()) {
    if (now >= w.resetAt + 60000) {
      windowMap.delete(key);
    }
  }
}

// تشغيل التنظيف كل 5 دقائق
if (typeof globalThis !== 'undefined') {
  const g = globalThis as unknown as { __rateLimitCleanup?: ReturnType<typeof setInterval> };
  if (!g.__rateLimitCleanup) {
    g.__rateLimitCleanup = setInterval(cleanup, 300000);
    g.__rateLimitCleanup.unref?.();
  }
}

/** استخراج IP من الطلب (مع مراعاة البروكسي) */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    // أول IP في السلسلة هو العميل الحقيقي
    return forwarded.split(',')[0].trim();
  }
  // في بيئة Vercel/Render
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  // fallback
  return 'unknown';
}

/** توليد مفتاح rate limit فريد */
export function makeRateLimitKey(ip: string, endpoint: string): string {
  return `${ip}:${endpoint}`;
}
