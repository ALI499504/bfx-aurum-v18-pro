// نقطة دخول البوابة — تتحقق من كلمة السر وتفتح جلسة شهر كامل (بطلب السيد)
import { NextRequest, NextResponse } from 'next/server';
import { checkPasscode, makeGateToken, GATE_COOKIE, GATE_TTL_S } from '@/lib/server/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeNext(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('://')) return raw;
  return '/';
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const password = form ? String(form.get('password') ?? '') : null;
  const next = safeNext(form ? String(form.get('next') ?? '/') : '/');

  const url = req.nextUrl.clone();
  if (!checkPasscode(password)) {
    url.pathname = '/login';
    url.search = `?e=1&next=${encodeURIComponent(next)}`;
    return NextResponse.redirect(url, 303);
  }
  url.pathname = next;
  url.search = '';
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(GATE_COOKIE, makeGateToken(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: GATE_TTL_S,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
