// ============================================================
// Market Regime Detection — تصنيف السوق الذكي
// يحدد حالة السوق ويختار الاستراتيجيات الأنسب تلقائياً
// ============================================================
import { Candle } from './types';
import { atr, emaSeries, sma, adx as computeAdx, bollinger } from './indicators';
import { FeatureVector, computeFeatures } from './lightgbm-filter';

export type MarketRegime = 'strong_bull' | 'weak_bull' | 'strong_bear' | 'weak_bear' | 'range_low_vol' | 'range_high_vol' | 'volatile_breakout';

export interface RegimeAnalysis {
  regime: MarketRegime;
  confidence: number;
  adx: number;
  atrRatio: number;
  trendStrength: number;
  bbPosition: number;
  recommendedStrategies: string[];
  avoidStrategies: string[];
}

/**
 * تصنيف السوق إلى 7 حالات:
 * - Strong Bull: ADX>30, EMA20>EMA50>EMA200, MACD>0
 * - Weak Bull: ADX<25, اتجاه صاعد ضعيف
 * - Strong Bear: ADX>30, EMA20<EMA50<EMA200, MACD<0
 * - Weak Bear: ADX<25, اتجاه هابط ضعيف
 * - Range Low Vol: ADX<20, ATR منخفض, BB ضيق
 * - Range High Vol: ADX<20, ATR مرتفع
 * - Volatile Breakout: ADX>40, ATR>2× المتوسط
 */
export function detectRegime(candles: Candle[], idx?: number): RegimeAnalysis {
  const c = candles;
  if (c.length < 200) {
    return {
      regime: 'range_low_vol',
      confidence: 0.5,
      adx: 20,
      atrRatio: 1,
      trendStrength: 0,
      bbPosition: 0.5,
      recommendedStrategies: ['L', 'M', 'Q'],
      avoidStrategies: ['AA', 'W', 'X'],
    };
  }
  
  const i = idx ?? c.length - 1;
  const closes = c.map(x => x.c);
  const e20 = emaSeries(c, 20)[i];
  const e50 = emaSeries(c, 50)[i];
  const e200 = emaSeries(c, 200)[i];
  const a = atr(c, 14)[i];
  const aAvg = sma(atr(c, 14).map(v => isFinite(v) ? v : 0), 50)[i];
  const adxVal = computeAdx(c, 14)[i];
  const bb = bollinger(closes, 20, 2);
  
  const close = closes[i];
  const bbPos = (close - bb.lower[i]) / (bb.upper[i] - bb.lower[i] || 1);
  const atrRatio = a / (aAvg || 1);
  
  // قوة الاتجاه
  const emaBull = e20 > e50 && e50 > e200;
  const emaBear = e20 < e50 && e50 < e200;
  const trendStrength = emaBull ? 1 : emaBear ? -1 : 0;
  
  // تصنيف regime
  let regime: MarketRegime = 'range_low_vol';
  let confidence = 0.5;
  
  if (adxVal > 40 && atrRatio > 1.8) {
    regime = 'volatile_breakout';
    confidence = 0.85;
  } else if (adxVal > 30) {
    if (emaBull && bbPos > 0.6) {
      regime = 'strong_bull';
      confidence = 0.8;
    } else if (emaBear && bbPos < 0.4) {
      regime = 'strong_bear';
      confidence = 0.8;
    } else {
      regime = emaBull ? 'weak_bull' : 'weak_bear';
      confidence = 0.6;
    }
  } else if (adxVal < 20) {
    regime = atrRatio < 0.8 ? 'range_low_vol' : 'range_high_vol';
    confidence = 0.7;
  } else {
    regime = emaBull ? 'weak_bull' : emaBear ? 'weak_bear' : 'range_low_vol';
    confidence = 0.5;
  }
  
  // توصيات الاستراتيجيات حسب regime
  const recommendations: Record<MarketRegime, { rec: string[]; avoid: string[] }> = {
    strong_bull: { rec: ['AA', 'E', 'W', 'X'], avoid: ['F', 'N', 'M'] },
    weak_bull: { rec: ['E', 'L', 'K'], avoid: ['AA', 'W', 'F'] },
    strong_bear: { rec: ['AA', 'F', 'N'], avoid: ['E', 'W', 'X'] },
    weak_bear: { rec: ['F', 'M', 'L'], avoid: ['AA', 'E', 'W'] },
    range_low_vol: { rec: ['L', 'M', 'Q', 'K'], avoid: ['AA', 'W', 'X', 'Y'] },
    range_high_vol: { rec: ['L', 'M', 'Z'], avoid: ['AA', 'W', 'E'] },
    volatile_breakout: { rec: ['AA', 'F', 'N', 'Z'], avoid: ['L', 'M', 'Q'] },
  };
  
  const recs = recommendations[regime];
  
  return {
    regime,
    confidence,
    adx: adxVal ?? 20,
    atrRatio,
    trendStrength,
    bbPosition: bbPos,
    recommendedStrategies: recs.rec,
    avoidStrategies: recs.avoid,
  };
}

/** تكييف معاملات الاستراتيجية حسب regime */
export function adaptStrategyParams(regime: MarketRegime, baseParams: any): any {
  switch (regime) {
    case 'strong_bull':
    case 'strong_bear':
      return { ...baseParams, slAtrMult: 2.5, tpAtrMult: 4 }; // وقف أوسع، هدف أبعد
    case 'range_low_vol':
      return { ...baseParams, slAtrMult: 1.5, tpAtrMult: 2 }; // وقف أضيق، هدف أقرب
    case 'volatile_breakout':
      return { ...baseParams, slAtrMult: 3, tpAtrMult: 5 }; // وقف واسع جداً
    default:
      return baseParams;
  }
}
