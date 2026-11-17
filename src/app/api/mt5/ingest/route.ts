import { NextRequest, NextResponse } from 'next/server';
import { ingestMt5 } from '@/lib/server/mt5feed';
import { rateLimit, getClientIp, makeRateLimitKey } from '@/lib/server/rateLimiter';

export const dynamic = 'force-dynamic';

const TOKEN = process.env.MT5_TOKEN;

// إذا لم يكن التوكن مضبوطاً، ارفض كل الطلبات — fail securely
function hasValidToken(token: string | null): boolean {
  if (!TOKEN) return false; // لا توكن افتراضي — يجب ضبط SITE_PASSWORD
  if (!token) return false;
  return token === TOKEN;
}

/** استقبال الشموع الحية من جسر MT5 على جهاز المستخدم */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const key = makeRateLimitKey(ip, 'ingest');
  const limit = rateLimit(key, 10000, 30); // 30 طلب كل 10 ثوانٍ

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

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }

  const { stored, counts } = ingestMt5(body as Parameters<typeof ingestMt5>[0]);
  return NextResponse.json({ ok: true, stored, counts, serverTime: Date.now() });
}
