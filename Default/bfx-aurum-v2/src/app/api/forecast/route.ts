import { NextRequest, NextResponse } from 'next/server';
import { getEngineData } from '@/lib/server/data';
import { getLiveCandles } from '@/lib/server/mt5feed';
import { TF } from '@/lib/engine/types';
import { buildForecast } from '@/lib/engine/forecast';
import { db } from '@/lib/db';
import { DEFAULT_SETTINGS, Settings } from '@/lib/engine/rules';

export const dynamic = 'force-dynamic';

/** التنبؤ الهيكلي — شموع مستقبلية متوقعة حتمية + نطاق الثقة + مزيج القرار
 *  يعمل على شموع XAUUSD الحقيقية من طرفية MT5 فقط.
 *  يلتزم بإعدادات المستخدم (indicators.ema / emaFast / emaSlow) المُحدّدة مسبقاً. */
export async function GET(req: NextRequest) {
  const data = getEngineData();
  if (!data) {
    return NextResponse.json({ error: 'no_real_data', message: 'بانتظار الشموع الحقيقية من طرفية MT5 — شغّل أمر التشغيل على جهازك' }, { status: 503 });
  }

  const tf = (req.nextUrl.searchParams.get('tf') ?? '15m') as TF;
  const series: Record<string, typeof data.c5> = {
    '5m': data.c5, '15m': data.c15, '30m': data.c30, '1h': data.c1h,
    '4h': data.c4h, '1d': data.c1d, '1w': data.c1w, '1M': data.c1M,
  };
  const arr = getLiveCandles(tf, 40) ?? series[tf] ?? data.c15;
  if (!arr || arr.length < 40) return NextResponse.json({ error: 'not enough data' }, { status: 503 });

  // تحميل إعدادات المستخدم — يلتزم التنبؤ بها كما حدّدها المستخدم مسبقاً
  let settings: Settings = DEFAULT_SETTINGS as Settings;
  try {
    const row = await db.botSettings.findUnique({ where: { key: 'main' } });
    if (row) {
      const saved = JSON.parse(row.json) as Settings;
      settings = {
        ...DEFAULT_SETTINGS,
        ...saved,
        globalRules: { ...DEFAULT_SETTINGS.globalRules, ...(saved.globalRules ?? {}) },
        sessions: { ...DEFAULT_SETTINGS.sessions, ...(saved.sessions ?? {}) },
        indicators: { ...DEFAULT_SETTINGS.indicators, ...(saved.indicators ?? {}) },
        manualLevels: { ...DEFAULT_SETTINGS.manualLevels, ...(saved.manualLevels ?? {}) },
        priority: saved.priority?.length === 3 ? saved.priority : DEFAULT_SETTINGS.priority,
      } as Settings;
    }
  } catch {
    // تعذّر القراءة — نستخدم الافتراضي ولا نمنع التنبؤ
  }

  const slice = arr.slice(-600);
  const fc = buildForecast(slice, tf, settings);

  // شموع سياق حقيقية أخيرة (~70) لعرضها قبل الشموع المتنبأ بها
  const context = slice.slice(-70).map(c => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c }));

  return NextResponse.json({ ...fc, context, source: 'mt5-real' });
}
