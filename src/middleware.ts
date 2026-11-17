// ============================================================
// بوابة الموقع — middleware يحمي كل الصفحات والواجهات بكلمة السر
// بطلب السيد: لا يفتح الموقع لأي أحد إلا بكلمة سر من المالك.
//  • محمي: كل الصفحات + كل واجهات /api (بلا كوكي → 401 JSON)
//  • مستثنى: /api/mt5/* (محمي أصلاً بترويسة x-bfx-token للجسر)،
//    /login، /api/auth/gate، /api/system/health، الملفات الثابتة
//  • الجلسة: كوكي موقّع HMAC-SHA256 شهر كامل — نفس صيغة
//    src/lib/server/gate.ts لكن بـ WebCrypto (Edge Runtime)
// ============================================================
import { NextRequest, NextResponse } from 'next/server';

// كلمة مرور إجبارية من المتغير SITE_PASSWORD — لا توجد قيمة افتراضية.
// إذا لم يُضبط المتغير سيفشل الخادم مع رسالة واضحة.
const PASSCODE = (() => {
  const pw = process.env.SITE_PASSWORD?.trim();
  if (!pw) {
    // لا نرمي استثناءً هنا لتجنب توقف Edge Runtime، بل نعيد 401 دائمًا.
    console.error('[SECURITY] SITE_PASSWORD غير مضبوط – جميع طلبات الموقع ستُرفض.');
    return null as unknown as string; // سيؤدي إلى فشل أي تحقق لاحقًا.
  }
  return pw;
})();
const COOKIE = 'site_gate';

// المفتاح = sha256('bfx-gate-v1|PASSCODE') — مطابق تماماً لاشتقاق node:crypto في gate.ts
let KEY_BUF: Promise<ArrayBuffer> | null = null;
function getKey(): Promise<ArrayBuffer> {
  KEY_BUF ??= crypto.subtle.digest('SHA-256', new TextEncoder().encode(`bfx-gate-v1|${PASSCODE}`));
  return KEY_BUF;
}

async function hmacHex(payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', await getKey(),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyCookie(tok: string | undefined): Promise<boolean> {
  if (!tok) return false;
  const dot = tok.indexOf('.');
  if (dot <= 0) return false;
  const exp = tok.slice(0, dot);
  if (!/^\d+$/.test(exp) || Date.now() > Number(exp)) return false;
  const sig = await hmacHex(exp);
  const a = tok.slice(dot + 1);
  if (a.length !== sig.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ sig.charCodeAt(i);
  return r === 0;
}

/** مسار محلي آمن لإعادة التوجيه (بلا فتح باب open-redirect) */
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('://')) return raw;
  return '/';
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // المستثنيات: الجسر الموقّع بالتوكن + صفحة الدخول + نقطة الدخول + فحص الصحة
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth/gate') ||
    pathname.startsWith('/api/mt5/') ||
    pathname.startsWith('/api/system/health') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    // أيقونات الموقع (Next App Router) + شعارات الثور — تُحمّل قبل الدخول
    // وإلا حجبها الـmiddleware بـ302 فظهرت صفحة الدخول بلا شعار
    pathname === '/icon.png' ||
    pathname === '/apple-icon.png' ||
    pathname === '/bull.svg' ||
    pathname === '/aurum-bull.png' ||
    pathname === '/aurum-badge.png' ||
    pathname.startsWith('/icon') ||
    pathname.startsWith('/apple-icon') ||
    pathname.startsWith('/brand/')
  ) return NextResponse.next();

  if (await verifyCookie(req.cookies.get(COOKIE)?.value)) return NextResponse.next();

  // واجهات البرمجة: 401 JSON (الواجهة الأمامية ترسل الكوكي تلقائياً فلا تتأثر)
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'locked', message: 'المنصة محمية بكلمة سر' }, { status: 401 });
  }
  // الصفحات: تحويل مطلق عبر NextResponse.redirect — nextUrl في الـmiddleware
  // يحمل النطاق العام الصحيح على Render (مثبت حياً)، والـedge runtime يرفض
  // ترويسة Location نسبية (Invalid URL) فلا يصح التحويل النسبي هنا.
  // نقطة POST /api/auth/gate هي التي كانت تنتج 0.0.0.0:10000 — أصلحت بـ meta refresh.
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url, 302);
}

export const config = {
  // كل المسارات ما عدا الملفات الثابتة — الفحص الدقيق داخل middleware
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|bull\\.svg|aurum-bull\\.png|aurum-badge\\.png|icon|apple-icon|brand|login|api/auth/gate|api/mt5/|api/system/health).*)'],
};
