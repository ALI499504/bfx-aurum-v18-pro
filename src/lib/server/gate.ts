// ============================================================
// بوابة الموقع — قفل كلمة السر للمالك ومدعوينه (server-only)
// بطلب السيد: الموقع لا يُفتح إلا بكلمة سر من المالك نفسه.
// كلمة السر من متغير البيئة SITE_PASSWORD وإلا الثابت المعتمد
// من السيد في الكود (يصمد لإعادة تشغيل الحاوية).
// الجلسة: كوكي httpOnly موقّع HMAC-SHA256 بصلاحية 30 يوماً،
// والتحقق بمقارنة زمن-ثابت (timing-safe) — نفس نمط قفل جارفس.
// ملاحظة: middleware يعمل على Edge Runtime لذا يعيد حساب
// التوقيع بـ WebCrypto بنفس الصيغة تماماً (نتيجة حتمية متطابقة).
// ============================================================
import crypto from 'node:crypto';

export const GATE_PASSCODE = process.env.SITE_PASSWORD || 'black hat';
export const GATE_COOKIE = 'site_gate';
export const GATE_TTL_MS = 30 * 86400e3;   // جلسة شهر كامل من آخر فتح
export const GATE_TTL_S = 60 * 60 * 24 * 30;

const SECRET = crypto.createHash('sha256').update(`bfx-gate-v1|${GATE_PASSCODE}`).digest();

function sign(payload: string): string {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

/** توكن جلسة موقّع: <انتهاء الصلاحية>.<البصمة> */
export function makeGateToken(): string {
  const exp = String(Date.now() + GATE_TTL_MS);
  return `${exp}.${sign(exp)}`;
}

/** مقارنة زمن-ثابت لسلسلتي hex بنفس الطول */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** التحقق من كوكي البوابة */
export function verifyGateToken(tok: string | undefined | null): boolean {
  if (!tok) return false;
  const dot = tok.indexOf('.');
  if (dot <= 0) return false;
  const exp = tok.slice(0, dot);
  const sig = tok.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Date.now() > Number(exp)) return false;
  return safeEqual(sig, sign(exp));
}

/** التحقق من كلمة السر المُرسلة بمقارنة زمن-ثابت على بصماتها */
export function checkPasscode(input: string | null | undefined): boolean {
  if (!input) return false;
  const a = crypto.createHash('sha256').update(input).digest('hex');
  const b = crypto.createHash('sha256').update(GATE_PASSCODE).digest('hex');
  return safeEqual(a, b);
}
