// ============================================================
// الجلسات بتوقيت سوريا (UTC+3 ثابت، بلا توقيت صيفي منذ 2022)
// ============================================================
import { Candle, SessionId, SESSION_TIMES } from './types';

export const SYRIA_OFFSET_MS = 3 * 3600e3;

/** ساعة سوريا العشرية لطابع زمني UTC */
export function syriaHour(t: number): number {
  return ((t + SYRIA_OFFSET_MS) % 86400e3) / 3600e3;
}

/** يوم الأسبوع بتوقيت سوريا (0=الأحد ... 6=السبت) */
export function syriaWeekday(t: number): number {
  return new Date(t + SYRIA_OFFSET_MS).getUTCDay();
}

/** الجلسة الحالية — نسخة سريعة حسابية بلا إنشاء Date */
export function fastSession(t: number): SessionId | null {
  const shifted = t + SYRIA_OFFSET_MS;
  const day = Math.floor(shifted / 86400e3);
  const wd = (day + 4) % 7; // 1970-01-01 = خميس → 0=الأحد
  if (wd === 6) return null;
  if (wd === 0 && (shifted % 86400e3) < 3600e3) return null;
  const h = (shifted % 86400e3) / 3600e3;
  if (h < 1) return null;
  if (h < 10) return 'asia';
  if (h < 15) return 'london';
  if (h < 19) return 'londonNY';
  if (h < 23) return 'ny';
  return null;
}

/** رقم يوم سوريا (بتوقيت UTC+3) */
export function syriaDayNum(t: number): number {
  return Math.floor((t + SYRIA_OFFSET_MS) / 86400e3);
}

/** الجلسة الحالية (واجهة متوافقة مع النسخة السريعة) */
export function currentSession(t: number): SessionId | null {
  return fastSession(t);
}

/** هل لحظة t تقع ضمن جلسة معينة؟ */
export function inSession(t: number, s: SessionId): boolean {
  const { start, end } = SESSION_TIMES[s];
  const h = syriaHour(t);
  const wd = syriaWeekday(t);
  if (wd === 6) return false;
  if (wd === 0 && h < 1) return false;
  return h >= start && h < end;
}

/**
 * قمة وقاع جلسة أمريكا لليوم السابق (للاستراتيجية M).
 * أمريكا: 19:00 حتى 23:00 سوريا + استكمال حتى 00:00 (نافذة نيويورك).
 * نبحث في فريم 5m ضمن نافذة أمريكا اليوم السابق (بتوقيت سوريا).
 */
export function previousUSHighLow(c5: Candle[], asiaOpenT: number): { high: number; low: number; t: number } | null {
  // بداية آسيا الحالية = asiaOpenT (بتوقيت UTC). نافذة أمريكا السابقة: من 19:00 حتى 23:59 سوريا قبل 15 ساعة تقريباً
  const syria = new Date(asiaOpenT + SYRIA_OFFSET_MS);
  const dayStart = Date.UTC(syria.getUTCFullYear(), syria.getUTCMonth(), syria.getUTCDate()) - SYRIA_OFFSET_MS;
  const prevUSFrom = dayStart - 86400e3 + 19 * 3600e3; // 19:00 أمس سوريا
  const prevUSTo = dayStart - 86400e3 + 24 * 3600e3;   // منتصف الليل أمس سوريا
  let high = -Infinity, low = Infinity, found = false;
  for (const c of c5) {
    if (c.t >= prevUSTo) break;
    if (c.t >= prevUSFrom) { high = Math.max(high, c.h); low = Math.min(low, c.l); found = true; }
  }
  return found ? { high, low, t: prevUSFrom } : null;
}
