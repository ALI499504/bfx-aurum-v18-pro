// ============================================================
// قناة التنفيذ الحي — نقطة الاتصال بين عقل القرار والجسر على MT5
// ------------------------------------------------------------
// GET  (الجسر كل ~4 ثوانٍ): حمولة الأوامر المسموحة دستورياً
//      { open: خطط دخول, close: إغلاقات إجبارية, cancelAllPending }
// POST (الجسر كل دورة): تقارير التنفيذ + التعويض الذاتي من حالة MT5
// المصادقة: ترويسة x-bfx-token (نفس توكن الجسر المعتمد)
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { getLiveOrdersPayload, applyBridgeReports, applyReconcile, type BridgeReport, type BridgeReconcile } from '@/lib/server/liveOrders';
import { rateLimit, getClientIp, makeRateLimitKey } from '@/lib/server/rateLimiter';

export const dynamic = 'force-dynamic';

const TOKEN = process.env.MT5_TOKEN;

function hasValidToken(token: string | null): boolean {
  if (!TOKEN) return false;
  if (!token) return false;
  return token === TOKEN;
}

/** GET – جلب حمولة الأوامر للمُنفِّذ */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const key = makeRateLimitKey(ip, 'liveOrders_GET');
  const limit = rateLimit(key, 5000, 20); // 20 طلب كل 5‑ثوانٍ
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: 'rate-limited', retryAfter: limit.retryAfter },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    );
  }
  const token = req.headers.get('x-bfx-token');
  if (!hasValidToken(token)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const payload = await getLiveOrdersPayload();
  return NextResponse.json({ ok: true, ...payload });
}

/** POST – تقارير الجسر */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const key = makeRateLimitKey(ip, 'liveOrders_POST');
  const limit = rateLimit(key, 5000, 20);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: 'rate-limited', retryAfter: limit.retryAfter },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    );
  }

  const token = req.headers.get('x-bfx-token');
  if (!hasValidToken(token)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { reports?: BridgeReport[]; reconcile?: BridgeReconcile } | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }
  if (Array.isArray(body.reports) && body.reports.length) {
    await applyBridgeReports(body.reports.slice(0, 50));
  }
  if (body.reconcile && typeof body.reconcile === 'object') {
    await applyReconcile(body.reconcile);
  }
  return NextResponse.json({ ok: true, serverTime: Date.now() });
}
