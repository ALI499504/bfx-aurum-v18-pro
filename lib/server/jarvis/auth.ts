// ============================================================
// جارفس — قفل الخدمة بالرمز السري (server-only)
// بطلب السيد: خدمة جارفس (المحادثة + التاريخ + الصوت) لا تُفتح
// إلا برمز سري — الرمز من متغير البيئة JARVIS_PASSCODE وإلا
// الثابت المعتمد من السيد في الكود (يصمد لإعادة تشغيل الحاوية
// لأن .env يُعاد توليده عند الإقلاع).
// الجلسة: كوكي httpOnly موقّع HMAC-SHA256 بصلاحية 30 يوماً —
// الفحص بمقارنة زمن-ثابت (timing-safe) في كل المسارات المحمية.
// ============================================================
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';

export const PASSCODE = process.env.JARVIS_PASSCODE || 'ali12345';
export const AUTH_COOKIE = 'jarvis_auth';
const TTL_MS = 30 * 86400e3; // جلسة شهر كامل من آخر فتح

const SECRET = crypto.createHash('sha256').update(`jarvis-auth-v1|${PASSCODE}`).digest();

function sign(payload: string): string {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

/** توكن جلسة موقّع: <انتهاء الصلاحية>.<البصمة> */
export function makeToken(): string {
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${sign(exp)}`;
}

export function verifyToken(tok: string | undefined | null): boolean {
  if (!tok) return false;
  const dot = tok.lastIndexOf('.');
  if (dot <= 0) return false;
  const exp = tok.slice(0, dot);
  const sig = tok.slice(dot + 1);
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
  const good = sign(exp);
  if (sig.length !== good.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)); }
  catch { return false; }
}

/** فحص الرمز المُرسل بمقارنة زمن-ثابت (لا تسريب عبر زمن الاستجابة) */
export function checkCode(code: unknown): boolean {
  if (typeof code !== 'string' || !code) return false;
  const a = crypto.createHash('sha256').update(code).digest();
  const b = crypto.createHash('sha256').update(PASSCODE).digest();
  return crypto.timingSafeEqual(a, b);
}

/** هل هذا الطلب يحمل جلسة صالحة؟ (كوكي أو ترويزة x-jarvis-auth) */
export function isAuthed(req: NextRequest): boolean {
  return verifyToken(req.cookies.get(AUTH_COOKIE)?.value ?? req.headers.get('x-jarvis-auth'));
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: Math.floor(TTL_MS / 1000),
};

/** رد 401 الموحد لكل المسارات المحمية */
export function lockedResponse(): Response {
  return Response.json(
    { ok: false, locked: true, error: 'خدمة جارفس مقفولة — أدخل الرمز السري' },
    { status: 401 },
  );
}
