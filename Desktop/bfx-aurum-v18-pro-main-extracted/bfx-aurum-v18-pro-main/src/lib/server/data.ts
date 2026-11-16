// ============================================================
// مصدر بيانات المحرك — بيانات XAUUSD من MT5 الحقيقية أو استيراد تاريخي
// الأولوية: بيانات MT5 الحقيقية (إذا كانت حديثة وكافية)
// السقوط التلقائي: بيانات تاريخية مستوردة من CSV/JSON (تغطي الفترات قبل يونيو 2025)
// ============================================================
import type { Candle } from '@/lib/engine/types';
import { TF_MS } from '@/lib/engine/types';
import { loadData, EngineData, resetEngineCache } from '@/lib/engine/backtest';
import { mt5Feed, isMt5Fresh } from './mt5feed';
import path from 'node:path';

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
  // Try MT5 real data first
  const s = mt5Feed();
  const raw: Record<string, Candle[]> = {};
  for (const tf of ENGINE_TFS) {
    const arr = s.tfs[tf];
    if (arr && arr.length) raw[tf] = arr as Candle[];
  }
  
  // Fallback: use imported historical data if MT5 data insufficient
  const MIN_FALLBACK_5M = 100; // fewer candles acceptable from imported data
  const MIN_FALLBACK_1H = 50;
  
  if (!raw['5m'] || raw['5m'].length < MIN_5M) {
    // Try imported data from snapshot
    const imported = tryGetImportedData();
    if (imported && imported['5m'] && imported['5m'].length >= MIN_FALLBACK_5M) {
      raw['5m'] = imported['5m'] as Candle[];
      console.log('[data] Using imported historical data for 5m');
    }
  }
  if (!raw['1h'] || raw['1h'].length < MIN_1H) {
    const imported = tryGetImportedData();
    if (imported && imported['1h'] && imported['1h'].length >= MIN_FALLBACK_1H) {
      raw['1h'] = imported['1h'] as Candle[];
      console.log('[data] Using imported historical data for 1h');
    }
  }
  
  // If still insufficient after fallback, return null
  if (!raw['5m'] || raw['5m'].length < MIN_FALLBACK_5M) return null;
  if (!raw['1h'] || raw['1h'].length < MIN_FALLBACK_1H) return null;

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

function tryGetImportedData(): Record<string, Candle[]> | null {
  // Read from disk snapshot if exists
  try {
    const snapPath = path.join(process.cwd(), 'db', 'mt5-feed-snapshot.json');
    const fs = require('node:fs');
    if (!fs.existsSync(snapPath)) return null;
    const j = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as Record<string, unknown>;
    const tfs = j.tfs && typeof j.tfs === 'object' ? j.tfs : {};
    const result: Record<string, Candle[]> = {};
    for (const tf of ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const) {
      const arr = tfs[tf];
      if (Array.isArray(arr)) {
        // Each candle is [t, o, h, l, c, v]
        const candles: Candle[] = arr.map((c: unknown) => ({
          t: typeof c === 'object' && c !== null ? c[0] as number : 0,
          o: typeof c === 'object' && c !== null ? c[1] as number : 0,
          h: typeof c === 'object' && c !== null ? c[2] as number : 0,
          l: typeof c === 'object' && c !== null ? c[3] as number : 0,
          c: typeof c === 'object' && c !== null ? c[4] as number : 0,
          v: typeof c === 'object' && c !== null ? c[5] as number : 0,
        })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c));
        if (candles.length > 0) result[tf] = candles;
      }
    }
    return Object.keys(result).length ? result : null;
  } catch {
    return null;
  }
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
