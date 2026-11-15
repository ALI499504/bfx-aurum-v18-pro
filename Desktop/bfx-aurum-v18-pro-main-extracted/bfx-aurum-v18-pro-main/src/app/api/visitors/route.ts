import { NextRequest, NextResponse } from 'next/server';
import { heartbeat, leaveVisitor, listVisitors } from '@/lib/server/visitors';

export const dynamic = 'force-dynamic';

/**
 * نبضة الجهاز (POST):
 * • body { id, leave:true }  → مغادرة فورية (إغلاق تبويب) — يختفي من القائمة لحظياً
 * • body { id, ... }         → تسجيل نبضة + يرجع القائمة الحية في نفس الرد
 *   (يمكن إرسالها عبر sendBeacon/keepalive عند pagehide)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = typeof body?.id === 'string' && body.id.trim()
      ? body.id.trim().slice(0, 64)
      : '';
    if (!id) return NextResponse.json({ error: 'id مطلوب' }, { status: 400 });

    // مغادرة فورية — لا نبضة بعد الآن
    if (body?.leave === true) {
      await leaveVisitor(id);
      const list = await listVisitors();
      return NextResponse.json({ ok: true, left: true, list });
    }

    const rec = await heartbeat({
      id,
      ip: clientIp(req.headers),
      uaRaw: req.headers.get('user-agent') ?? '',
      screen: typeof body?.screen === 'string' ? body.screen : undefined,
      viewport: typeof body?.viewport === 'string' ? body.viewport : undefined,
      lang: typeof body?.lang === 'string' ? body.lang : undefined,
      tz: typeof body?.tz === 'string' ? body.tz : undefined,
      tab: typeof body?.tab === 'string' ? body.tab : undefined,
      tf: typeof body?.tf === 'string' ? body.tf : undefined,
      referrer: typeof body?.referrer === 'string' ? body.referrer : undefined,
    });
    // القائمة الحية تُعاد مع كل نبضة — العدّاد لحظي بدون أي طلب إضافي
    const list = await listVisitors();
    return NextResponse.json({ ok: true, self: rec, list });
  } catch {
    return NextResponse.json({ error: 'تعذر تسجيل النبضة' }, { status: 500 });
  }
}

/** القائمة الحية (GET) — الأجهزة المتصلة فعلياً في هذه اللحظة فقط */
export async function GET() {
  try {
    const data = await listVisitors();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ online: 0, total: 0, now: Date.now(), visitors: [] });
  }
}

function clientIp(h: Headers): string {
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return h.get('x-real-ip') || h.get('cf-connecting-ip') || 'غير معروف';
}
