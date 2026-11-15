import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, checkCode, cookieOptions, isAuthed, makeToken } from '@/lib/server/jarvis/auth';
import { JARVIS_SECTION_CLOSED } from '@/lib/jarvis-flag';

export const dynamic = 'force-dynamic';

// ============================================================
// جارفس — مسار المصادقة (فتح/غلق/فحص الخدمة)
// POST {code}  → رمز صحيح = كوكي جلسة موقّع (شهر) | خطأ = 401
// DELETE       → إغلاق الخدمة فوراً (إبطال الجلسة)
// GET          → حالة القفل الحالية {locked}
// ============================================================

export async function GET(req: NextRequest) {
  // القسم مغلق — الحالة دائماً مقفولة مع إعلان الغلق
  if (JARVIS_SECTION_CLOSED) return Response.json({ ok: true, locked: true, closed: true });
  return Response.json({ ok: true, locked: !isAuthed(req) });
}

export async function POST(req: NextRequest) {
  // القسم مغلق بقرار المالك — لا فتح جلسات جديدة (إعادة الفتح: src/lib/jarvis-flag.ts)
  if (JARVIS_SECTION_CLOSED) {
    return Response.json({ ok: false, closed: true, error: 'قسم جارفس — القلب النابض مغلق حالياً. البوت يعمل بشكل طبيعي.' }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  if (!checkCode(body?.code)) {
    return Response.json({ ok: false, error: 'الرمز السري غير صحيح' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, makeToken(), cookieOptions);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
