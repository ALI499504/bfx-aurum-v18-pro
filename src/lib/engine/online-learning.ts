// ============================================================
// Online Learning — التعلم المستمر من الصفقات الحية
// يحدث النموذج أسبوعياً دون إعادة تدريب كاملة
// ============================================================
import { FeatureVector, LightGBMModel, LightGBMPrediction } from './lightgbm-filter';
import { Trade } from './types';

export interface TradeOutcome {
  features: FeatureVector;
  predictedTrend: string;
  actualTrend: 'up' | 'down' | 'range';
  profit: number;
  timestamp: number;
}

export function createTradeOutcome(features: FeatureVector, predictedTrend: string, actualTrend: 'up' | 'down' | 'range', profit: number, timestamp: number): TradeOutcome {
  return { features, predictedTrend, actualTrend, profit, timestamp };
}

export interface ModelPerformance {
  totalTrades: number;
  winRate: number;
  avgProfit: number;
  profitFactor: number;
  accuracy: number;
  lastUpdate: number;
}

const STORAGE_KEY = 'online_learning_buffer';

export class OnlineLearner {
  private buffer: TradeOutcome[] = [];
  private maxBufferSize = 5000;
  private minUpdateSize = 100;
  private model: any; // سيتم تعيينه عند التهيئة
  
  constructor(model?: any) {
    this.model = model;
    this.loadFromStorage();
  }
  
  /** إضافة نتيجة صفقة للتدريب */
  addOutcome(outcome: TradeOutcome): void {
    this.buffer.push(outcome);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize);
    }
    this.saveToStorage();
  }
  
  /** التحقق مما إذا كان الوقت مناسباً للتحديث */
  shouldUpdate(): boolean {
    return this.buffer.length >= this.minUpdateSize;
  }
  
  /** تحديث النموذج باستخدام البيانات الجديدة (Gradient Boosting تدريجي) */
  updateModel(baseModel: any): any {
    if (!this.shouldUpdate()) return baseModel;
    
    console.log(`[OnlineLearning] تحديث النموذج بـ ${this.buffer.length} صفقة جديدة...`);
    
    // حساب الأوزان بناءً على الأداء
    const recent = this.buffer.slice(-500);
    const performance = this.calculatePerformance(recent);
    
    // تحديث الأوزان في النموذج البديل (Simulated)
    if (this.model && this.model.updateWeights) {
      this.model.updateWeights(recent, performance);
    }
    
    console.log(`[OnlineLearning] تم التحديث. Performance: WR=${performance.winRate.toFixed(1)}%, PF=${performance.profitFactor.toFixed(2)}`);
    
    this.buffer = this.buffer.slice(-2000); // الاحتفاظ بالأحدث
    this.saveToStorage();
    
    return baseModel; // في التطبيق الحقيقي، يعيد النموذج المحدث
  }
  
  private calculatePerformance(trades: TradeOutcome[]): ModelPerformance {
    if (trades.length === 0) {
      return { totalTrades: 0, winRate: 0, avgProfit: 0, profitFactor: 0, accuracy: 0, lastUpdate: Date.now() };
    }
    
    const wins = trades.filter(t => t.profit > 0);
    const losses = trades.filter(t => t.profit <= 0);
    const correct = trades.filter(t => t.predictedTrend === t.actualTrend);
    
    const grossProfit = wins.reduce((s, t) => s + t.profit, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
    
    return {
      totalTrades: trades.length,
      winRate: (wins.length / trades.length) * 100,
      avgProfit: trades.reduce((s, t) => s + t.profit, 0) / trades.length,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 999,
      accuracy: (correct.length / trades.length) * 100,
      lastUpdate: Date.now(),
    };
  }
  
  /** استخراج النتيجة الفعلية من الصفقة */
  static createOutcome(trade: Trade, features: FeatureVector, prediction: string): TradeOutcome {
    const actualTrend = trade.pnl > 0 ? 'up' : trade.pnl < 0 ? 'down' : 'range';
    return createTradeOutcome(features, prediction, actualTrend, trade.pnl, trade.exitT ?? Date.now());
  }
  
  private saveToStorage(): void {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.buffer.slice(-2000)));
      }
    } catch {}
  }
  
  private loadFromStorage(): void {
    try {
      if (typeof window !== 'undefined') {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) this.buffer = JSON.parse(data);
      }
    } catch {}
  }
  
  /** الحصول على إحصائيات الأداء الحالية */
  getPerformance(): ModelPerformance {
    return this.calculatePerformance(this.buffer);
  }
}