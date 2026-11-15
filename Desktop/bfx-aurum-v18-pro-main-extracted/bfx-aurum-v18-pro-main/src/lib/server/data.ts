// ============================================================
// مصدر بيانات المحرك — بيانات XAUUSD الحقيقية فقط
// تبني EngineData مباشرة من شموع MT5 الحقيقية القادمة من
// طرفية MetaTrader 5 على جهاز المستخدم عبر جسر البث.
// لا يوجد أي مصدر محاكاة أو بيانات مولّدة — إن لم يكن الجسر
// متصلاً ولم تصل شموع حقيقية يرجع null وتُعرض رسالة واضحة.
// ============================================================
import type { Candle } from '@/lib/engine/types';
import { TF_MS } from '@/lib/engine/types';
import { loadData, EngineData, resetEngineCache } from '@/lib/engine/backtest';
import { mt5Feed, isMt5Fresh } from './mt5feed';

const memory: { data?: EngineData; key?: number; maxDays?: number } = {};

const ENGINE_TFS = ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const;

/** الحد الأدنى المعقول من الشموع الحقيقية لكل فريم لتشغيل محرك الباك تيست */
const MIN_5M = 250;
const MIN_1H = 150;

/**
 * سماحية الباك تيست/التحليل: الشموع التاريخية الحقيقية تبقى صالحة
 * حتى لو توقف الجسر عشرات الدقائق (إعادة تشغيل، سحب تاريخ، إغلاق مؤقت)
 * — بخلاف البث اللحظي في الواجهة الذي يتطلب نبضة حية خلال دقيقتين.
 */
const ENGINE_FRESH_MS = 30 * 60_000;

/**
 * نافذة المحرك الافتراضية للصفحات الحية (الشارت/التنبؤ/الإشارات/الحارس): 120 يوماً
 * — أوسع بغزارة من كل ما يحتاجه التحليل (مستويات أسبوعية، فيبو، تتبع الظل 45 يوماً،
 * أوامر يدوية بعمر 30 يوماً) لكنها تُبقي التحليل الثقيل في حدود عشرات الآلاف من الشموع
 * بدل مئات الآلاف، كي لا يتجمد الخادم عشرات الثواني عند كل شمعة 5m جديدة.
 * الباك تيست اليدوي/التلقائي يستدعي getEngineData(0) للتاريخ الكامل كما هو.
 */
export const ENGINE_WINDOW_DAYS = 120;

export function getEngineData(maxDays: number = ENGINE_WINDOW_DAYS): EngineData | null {
  if (!isMt5Fresh(ENGINE_FRESH_MS)) return null;
  const s = mt5Feed();
  const raw: Record<string, Candle[]> = {};
  for (const tf of ENGINE_TFS) {
    const arr = s.tfs[tf];
    if (arr && arr.length) raw[tf] = arr as Candle[];
  }
  if (!raw['5m'] || raw['5m'].length < MIN_5M) return null;
  if (!raw['1h'] || raw['1h'].length < MIN_1H) return null;

  // قصّ النافذة الزمنية (بحث ثنائي عن أول شمعة داخل النافذة) — يقلّص تكلفة
  // التحليل المسبق والتجميعات والكاشفات بمقدار أضعاف دون أي مساس بصحة النهاية
  if (maxDays > 0) {
    const c5all = raw['5m'];
    const cutoff = c5all[c5all.length - 1].t - maxDays * 86400e3;
    if (cutoff > c5all[0].t) {
      const cut = (a: Candle[]): Candle[] => {
        let lo = 0, hi = a.length - 1, i = a.length;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (a[mid].t >= cutoff) { i = mid; hi = mid - 1; } else lo = mid + 1; }
        return i === 0 ? a : a.slice(i);
      };
      // فريمات المناطق (يومي/أسبوعي/شهري) تبقى بكامل تاريخها — صغيرة الحجم
      // واستراتيجية رأس الذيل تحتاج عمر المناطق الكامل
      for (const tf of ENGINE_TFS) {
        if (!raw[tf] || tf === '1d' || tf === '1w' || tf === '1M') continue;
        raw[tf] = cut(raw[tf]);
      }
    }
  }

  // بوابة جودة: فريم أكثر تناثراً من نصف العدد المتوقع مقابل تغطية 5m
  // يُستبعد ويُبنى تجميعياً من شموع 5m الحقيقية الأكثر كثافة — كي لا
  // تُضلّل الفجوات الزمنية تحليل الهيكل (كل المصادر تبقى حقيقية 100%)
  const spanMs = Math.max(1, raw['5m'][raw['5m'].length - 1].t - raw['5m'][0].t);
  for (const tf of ['15m', '30m', '1h', '4h'] as const) {
    const arr = raw[tf];
    if (!arr) continue;
    if (arr.length < (spanMs / TF_MS[tf]) * 0.5) delete raw[tf];
  }

  // مفتاح إعادة البناء: آخر شمعة 5m مغلقة + العدد — كي لا تُعاد
  // عملية التحليل الثقيلة مع كل نبضة بث (2ث) بل عند شمعة جديدة فقط
  const c5 = raw['5m'];
  const key = c5[c5.length - 1].t * 1000 + c5.length;
  if (memory.data && memory.key === key && memory.maxDays === maxDays) return memory.data;
  resetEngineCache();
  memory.data = loadData(raw);
  memory.key = key;
  memory.maxDays = maxDays;
  return memory.data;
}

export function getDataStatus(): {
  ok: boolean; connected: boolean; from?: string; to?: string;
  candles5m?: number; counts?: Record<string, number>; symbol?: string;
} {
  const s = mt5Feed();
  const connected = isMt5Fresh(ENGINE_FRESH_MS);
  const c5 = s.tfs['5m'];
  const c1h = s.tfs['1h'];
  if (!connected || !c5 || c5.length < MIN_5M || !c1h || c1h.length < MIN_1H) {
    return { ok: false, connected };
  }
  const first = c5[0].t <= (c1h[0]?.t ?? Infinity) ? c5[0] : c1h[0];
  return {
    ok: true,
    connected: true,
    from: new Date(first.t).toISOString(),
    to: new Date(c5[c5.length - 1].t).toISOString(),
    candles5m: c5.length,
    counts: Object.fromEntries(ENGINE_TFS.map(tf => [tf, s.tfs[tf]?.length ?? 0])),
    symbol: s.symbol,
  };
}
