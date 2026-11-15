// نقطة دخول البوابة — تتحقق من كلمة السر وتفتح جلسة شهر كامل (بطلب السيد)
import { NextRequest, NextResponse } from 'next/server';
import { checkPasscode, makeGateToken, GATE_COOKIE, GATE_TTL_S } from '@/lib/server/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeNext(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('://')) return raw;
  return '/';
}

/**
 * إعادة توجيه بصفحة HTML (meta refresh) بمسار نسبي — لا ترويسة Location إطلاقاً.
 * السبب: خادم standalone يعمم ترويسة Location الصادرة من route handlers إلى
 * عنوان الحاوية الداخلي (0.0.0.0:10000 خلف بروكسي Render) فيكسر التحويل،
 * بينما meta refresh بمسار نسبي يُحل في المتصفح على النطاق العام دائماً.
 */
function htmlRedirect(loc: string, extraCookie?: string): NextResponse {
  const safe = loc.replace(/"/g, '%22').replace(/</g, '%3C');
  const html = `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="refresh" content="0;url=${safe}">`
    + `<title>BFX AURUM</title></head><body></body></html>`;
  const res = new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
  if (extraCookie) res.headers.append('set-cookie', extraCookie);
  return res;
}

export async function POST(req: NextRequest) {
  // قراءة مرنة: formData أولاً وإن أعادت كلمة فارغة نقرأ الجسم الخام يدوياً —
  // (خلف بروكسي Render قد يصل الجسم بصيغة لا يفككها formData مباشرة)
  let password: string | null = null;
  let next = '/';
  let parsed = 'form';
  const form = await req.formData().catch(() => null);
  if (form && String(form.get('password') ?? '') !== '') {
    password = String(form.get('password') ?? '');
    next = safeNext(String(form.get('next') ?? '/'));
  } else {
    const raw = await req.text().catch(() => '');
    const sp = new URLSearchParams(raw);
    if (sp.get('password')) {
      parsed = 'raw';
      password = sp.get('password');
      next = safeNext(sp.get('next'));
    }
  }
  const ok = checkPasscode(password);
  // سجل تشخيصي بلا أي سر — يظهر في Logs على Render: هل الجسم وصل وهل متغير البيئة مضبوط
  console.log(`[gate] parsed=${parsed} hasPassword=${Boolean(password)} ok=${ok} envSet=${Boolean(process.env.SITE_PASSWORD)}`);

  if (!ok) {
    return htmlRedirect(`/login?e=1&next=${encodeURIComponent(next)}`);
  }
  const tok = makeGateToken();
  const cookie = `${GATE_COOKIE}=${tok}; Path=/; Max-Age=${GATE_TTL_S}; HttpOnly; SameSite=Lax`
    + (process.env.NODE_ENV === 'production' ? '; Secure' : '');
  return htmlRedirect(next, cookie);
}
