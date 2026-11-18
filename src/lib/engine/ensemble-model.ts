// ============================================================
// Ensemble Model — نظام تصويت متقدم لثلاثة نماذج
// يجمع بين LightGBM, XGBoost (simulated), Random Forest
// ============================================================
import { FeatureVector, LightGBMModel, SurrogateTrendModel, softmax } from './lightgbm-filter';

export type EnsemblePrediction = {
  trend: 'up' | 'down' | 'range';
  confidence: number;
  probabilities: { up: number; down: number; range: number };
  modelVotes: { lgbm: number; xgb: number; rf: number };
  agreement: number; // 0-1: نسبة توافق النماذج
};

/** نموذج XGBoost محاكي (Surrogate) */
class XGBoostSurrogate implements LightGBMModel {
  readonly name = 'xgboost-surrogate-v1';
  
  predictRaw(f: FeatureVector): [number, number, number] {
    const momentum = 0.4 * f.macd_histogram + 0.3 * f.rsi_momentum / 50 + 0.3 * f.ret_5;
    const trend = 0.5 * f.ema20_gap_atr + 0.3 * f.adx_value / 50 + 0.2 * f.multi_tf_alignment;
    const vol = 0.6 * f.atr_ratio + 0.4 * f.volatility_regime / 2;
    
    const up = trend + momentum + 0.2 * vol;
    const down = -trend - momentum + 0.2 * vol;
    const range = 0.5 - Math.abs(trend) - Math.abs(momentum) + 0.3 * (1 - vol);
    
    return [up, down, range];
  }
}

/** نموذج Random Forest محاكي (Surrogate) */
class RandomForeSurrogate implements LightGBMModel {
  readonly name = 'randomforest-surrogate-v1';
  
  predictRaw(f: FeatureVector): [number, number, number] {
    // متوسط عدة "أشجار" بخصائص مختلفة
    const tree1 = 0.5 * f.ema20_gap_atr + 0.3 * f.rsi14 / 100;
    const tree2 = 0.4 * f.macd_histogram + 0.4 * f.stoch_k / 100;
    const tree3 = 0.3 * f.adx_value / 50 + 0.5 * f.structure_score;
    const tree4 = 0.6 * f.bb_position - 0.3;
    const tree5 = 0.4 * f.vol_ratio + 0.4 * f.candle_pattern;
    
    const avg = (tree1 + tree2 + tree3 + tree4 + tree5) / 5;
    const up = avg;
    const down = -avg;
    const range = 0.4 - Math.abs(avg) + 0.2 * (f.atr_ratio < 1 ? 1 : 0);
    
    return [up, down, range];
  }
}

export class EnsembleModel implements LightGBMModel {
  readonly name = 'ensemble-pro-v1';
  
  private models: LightGBMModel[];
  private weights: number[];
  
  constructor(weights?: [number, number, number]) {
    this.models = [
      new SurrogateTrendModel(),
      new XGBoostSurrogate(),
      new RandomForeSurrogate(),
    ];
    this.weights = weights ?? [0.5, 0.3, 0.2]; // LightGBM أثقل
  }
  
  predictRaw(f: FeatureVector): [number, number, number] {
    const predictions = this.models.map(m => m.predictRaw(f));
    
    let up = 0, down = 0, range = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < predictions.length; i++) {
      const [u, d, r] = predictions[i];
      const w = this.weights[i];
      up += u * w;
      down += d * w;
      range += r * w;
      totalWeight += w;
    }
    
    if (totalWeight > 0) {
      up /= totalWeight;
      down /= totalWeight;
      range /= totalWeight;
    }
    
    return [up, down, range];
  }
  
  /** حساب نسبة التوافق بين النماذج */
  calculateAgreement(f: FeatureVector): number {
    const predictions = this.models.map(m => {
      const [u, d, r] = m.predictRaw(f);
      const probs = softmax([u, d, r]);
      const trend = probs[0] >= probs[1] && probs[0] >= probs[2] ? 'up'
        : probs[1] >= probs[2] ? 'down' : 'range';
      return trend;
    });
    
    const agreements = [
      predictions[0] === predictions[1] ? 1 : 0,
      predictions[1] === predictions[2] ? 1 : 0,
      predictions[0] === predictions[2] ? 1 : 0,
    ];
    
    return agreements.reduce((a, b) => a + b, 0) / 3;
  }
  
  predict(f: FeatureVector): EnsemblePrediction {
    const raw = this.predictRaw(f);
    const probs = softmax(raw);
    const trend = probs[0] >= probs[1] && probs[0] >= probs[2] ? 'up'
      : probs[1] >= probs[2] ? 'down' : 'range';
    
    const modelVotes = {
      lgbm: softmax(this.models[0].predictRaw(f))[0],
      xgb: softmax(this.models[1].predictRaw(f))[0],
      rf: softmax(this.models[2].predictRaw(f))[0],
    };
    
    return {
      trend,
      confidence: probs[trend === 'up' ? 0 : trend === 'down' ? 1 : 2],
      probabilities: { up: probs[0], down: probs[1], range: probs[2] },
      modelVotes,
      agreement: this.calculateAgreement(f),
    };
  }
}
