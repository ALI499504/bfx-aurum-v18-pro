import { NextRequest, NextResponse } from 'next/server';
import { mt5Feed } from '@/lib/server/mt5feed';
import { rateLimit, getClientIp, makeRateLimitKey } from '@/lib/server/rateLimiter';

export const dynamic = 'force-dynamic';

const TOKEN = process.env.MT5_TOKEN;

function hasValidToken(token: string | null): boolean {
  if (!TOKEN) return false;
  if (!token) return false;
  return token === TOKEN;
}

/** مسح كامل لذاكرة الشموع الحقيقية المخزنة على الخادم
 *  ?meta=1 → العدادات وأقدم طابع فقط — بدون الحمولة الكاملة
 *  بدون meta → اللقطة الكاملة (tfs + حساب + صفقات) بصيغة snapshot القياسية
 *  يستخدمه الضابط الذاتي لسحب البيانات الحقيقية للتدريب خارج الخادم */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const key = makeRateLimitKey(ip, 'dump');
  const limit = rateLimit(key, 60000, 5); // 5 طلبات كل دقيقة — حمولة ثقيلة
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

  const s = mt5Feed();
  const counts: Record<string, number> = {};
  const oldest: Record<string, number | null> = {};
  for (const [tf, arr] of Object.entries(s.tfs)) {
    if (!Array.isArray(arr)) continue;
    counts[tf] = arr.length;
    oldest[tf] = arr.length ? arr[0].t : null;
  }
  if (req.nextUrl.searchParams.get('meta') === '1') {
    return NextResponse.json({
      ok: true, symbol: s.symbol, broker: s.broker, bridgeV: s.bridgeV,
      counts, oldest, updatedAt: s.updatedAt || null, serverTime: Date.now(),
    });
  }
  return NextResponse.json({
    ok: true, symbol: s.symbol, broker: s.broker, bridgeV: s.bridgeV,
    account: s.account, tick: s.tick, positions: s.positions, deals: s.deals,
    updatedAt: s.updatedAt || null, savedAt: Date.now(), tfs: s.tfs,
  });
}
