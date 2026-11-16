import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// كلمة مرور الدخول للبوت — تُقرأ من بيئة الخادم (Render env) أو القيمة الافتراضية
const PASSWORD = process.env.BFX_PASSWORD || 'blackhat'

// مسارات لا تحتاج كلمة مرور
const PUBLIC_ROUTES = ['/login', '/api/system/health']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // الملفات الساكنة — لا نوقفها أبداً
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname === '/favicon.ico' ||
    /\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$/i.test(pathname)
  ) {
    return NextResponse.next()
  }

  // صفحة الدخول نفسها تبقى مفتوحة
  if (PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(route + '/'))) {
    return NextResponse.next()
  }

  // 1) كلمة المرور في الرابط (يستخدمها نموذج الدخول للتحقق)
  const passwordFromQuery = request.nextUrl.searchParams.get('password')
  if (passwordFromQuery) {
    if (passwordFromQuery === PASSWORD) {
      // صحيحة — نسجل كوكي الدخول ونعيد التوجيه إلى الصفحة النظيفة
      const target = new URL(pathname, request.url)
      const response = NextResponse.redirect(target, 307)
      response.cookies.set('bfx_auth', PASSWORD, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 يوماً
        path: '/',
      })
      return response
    }
    // خاطئة — نرجع لصفحة الدخول مع رسالة خطأ
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('returnTo', pathname)
    loginUrl.searchParams.set('error', '1')
    return NextResponse.redirect(loginUrl, 302)
  }

  // 2) كوكي دخول صالح — نمر الطلب
  const cookies = request.cookies
  if (cookies.get('bfx_auth')?.value === PASSWORD) {
    return NextResponse.next()
  }

  // 3) بلا مصادقة — صفحة طلب كلمة المرور
  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('returnTo', pathname)
  return NextResponse.redirect(loginUrl, 307)
}

export const config = {
  matcher: [
    // كل المسارات عدا الملفات الساكنة
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
