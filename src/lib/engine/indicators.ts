// ============================================================
// المؤشرات الفنية: EMA 20/90، ATR، متوسط الحجم، فجوات FVG
// ============================================================
import { Candle, TF_MS } from './types';

export function ema(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (!values.length) return out;
  const k = 2 / (period + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** EMA محسوبة مسبقاً لكامل مصفوفة شموع — تُستخدم بالبحث عن الكسر اللحظي */
export function emaSeries(candles: Candle[], period: number): number[] {
  return ema(candles.map(c => c.c), period);
}

export function atr(candles: Candle[], period = 14): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  let prev = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const tr = i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c));
    prev = i === 0 ? tr : (prev * (period - 1) + tr) / period;
    out[i] = prev;
  }
  return out;
}

export function sma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out[i] = i >= period - 1 ? sum / period : NaN;
  }
  return out;
}

/**
 * فحص وجود فجوة سعرية حقيقية (Fair Value Gap / Imbalance) بين الشمعة الأولى والثالثة
 * ضمن نموذج ثلاثي الشموع، بالاتجاه المحدد.
 * bull: low(3) > high(1) — الشمعة الثالثة لم تلمس ذيل الأولى.
 */
export function hasFVG(c1: Candle, c2: Candle, c3: Candle, dir: 'up' | 'down'): boolean {
  if (dir === 'up') return c3.l > c1.h;
  return c3.h < c1.l;
}

/** حجم شمعة كبير نسبياً: الجسم > 55% من المدى والمدى > 1.5×ATR */
export function isImpulsive(c: Candle, atrVal: number): boolean {
  if (!isFinite(atrVal) || atrVal <= 0) return false;
  const range = c.h - c.l;
  const body = Math.abs(c.c - c.o);
  return range > 1.5 * atrVal && body > 0.55 * range;
}
