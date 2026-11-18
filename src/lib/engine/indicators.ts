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

/** مؤشر ADX (Average Directional Index) — قوة الاتجاه */
export function adx(candles: Candle[], period = 14): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < period + 1) return out;
  
  const plusDM = new Array(candles.length).fill(0);
  const minusDM = new Array(candles.length).fill(0);
  const tr = new Array(candles.length).fill(0);
  
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1];
    const upMove = c.h - prev.h;
    const downMove = prev.l - c.l;
    
    if (upMove > downMove && upMove > 0) plusDM[i] = upMove;
    else if (downMove > upMove && downMove > 0) minusDM[i] = downMove;
    
    tr[i] = Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c));
  }
  
  const plusSM = new Array(candles.length).fill(0);
  const minusSM = new Array(candles.length).fill(0);
  const trSmooth = new Array(candles.length).fill(0);
  
  // أول قيمة smoothed
  for (let i = 1; i <= period; i++) {
    plusSM[period] += plusDM[i];
    minusSM[period] += minusDM[i];
    trSmooth[period] += tr[i];
  }
  
  for (let i = period + 1; i < candles.length; i++) {
    plusSM[i] = plusSM[i - 1] - plusSM[i - 1] / period + plusDM[i];
    minusSM[i] = minusSM[i - 1] - minusSM[i - 1] / period + minusDM[i];
    trSmooth[i] = trSmooth[i - 1] - trSmooth[i - 1] / period + tr[i];
  }
  
  const plusDI = new Array(candles.length).fill(0);
  const minusDI = new Array(candles.length).fill(0);
  const dx = new Array(candles.length).fill(0);
  
  for (let i = period; i < candles.length; i++) {
    const trS = trSmooth[i];
    if (trS > 0) {
      plusDI[i] = 100 * plusSM[i] / trS;
      minusDI[i] = 100 * minusSM[i] / trS;
    }
    const sumDI = plusDI[i] + minusDI[i];
    if (sumDI > 0) dx[i] = 100 * Math.abs(plusDI[i] - minusDI[i]) / sumDI;
  }
  
  // ADX = SMA of DX
  let sumDX = 0;
  for (let i = period; i < period * 2; i++) sumDX += dx[i];
  out[period * 2 - 1] = sumDX / period;
  
  for (let i = period * 2; i < candles.length; i++) {
    sumDX = sumDX - dx[i - period] + dx[i];
    out[i] = sumDX / period;
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

/** MACD: fastEMA, slowEMA, signal line */
export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): { line: number[]; sig: number[]; hist: number[] } {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const diff = closes.map((_, i) => f[i] - s[i]);
  const sig = ema(diff, signal);
  return { line: diff, sig, hist: diff.map((d, i) => d - sig[i]) };
}

/** Bollinger Bands: middle ± k×stddev */
export function bollinger(closes: number[], period = 20, k = 2) {
  const mid = sma(closes, period);
  const upper: number[] = [], lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); continue; }
    let ss = 0;
    for (let j = i - period + 1; j <= i; j++) ss += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(ss / period);
    upper.push(mid[i] + k * sd);
    lower.push(mid[i] - k * sd);
  }
  return { mid, upper, lower };
}

/** Stochastic %K */
export function stochK(candles: Candle[], period = 14): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  for (let i = period - 1; i < candles.length; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].l < lo) lo = candles[j].l;
      if (candles[j].h > hi) hi = candles[j].h;
    }
    const range = hi - lo || 1e-9;
    out[i] = ((candles[i].c - lo) / range) * 100;
  }
  return out;
}

/** CCI (Commodity Channel Index) */
export function cci(candles: Candle[], period = 20): number[] {
  const tp = candles.map(c => (c.h + c.l + c.c) / 3);
  const out: number[] = new Array(candles.length).fill(NaN);
  for (let i = period - 1; i < candles.length; i++) {
    const mean = sma(tp, period)[i];
    if (!isFinite(mean)) continue;
    let md = 0;
    for (let j = i - period + 1; j <= i; j++) md += Math.abs(tp[j] - mean);
    const mdAvg = md / period;
    out[i] = mdAvg > 0 ? (tp[i] - mean) / (0.015 * mdAvg) : 0;
  }
  return out;
}

/** Viability Ratio — نسبة الاتجاه إلى التذبذب */
export function viabilityRatio(closes: number[], period = 20): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  for (let i = period; i < closes.length; i++) {
    const drift = Math.abs(closes[i] - closes[i - period]);
    let vol = 0;
    for (let j = i - period + 1; j <= i; j++) vol += Math.abs(closes[j] - closes[j - 1]);
    out[i] = vol > 0 ? drift / vol : 1;
  }
  return out;
}
