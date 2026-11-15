'use client';

// شارت التنبؤ — وضوح كامل لما يحدث:
// شموع حقيقية صلبة (مؤكدة) + شموع متوقعة حتمية (شفافة بحدّ ذهبي، مشتقة من pUp + ATR)
// + نطاق متوقع حتمي من ATR (حدّان ذهبيان) + فاصل «الآن» + مفتاح ألوان
// الشموع المتوقعة حتمية 100% — لا RNG ولا عشوائية: كل OHLC محسوب من إعدادات
// المستخدم + احتمال pUp + توسّع نطاق الثقة، ومُقيّد داخل حدود النطاق الإحصائي.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type CandlestickData, type Time, type LineData,
} from 'lightweight-charts';

interface FCandle { t: number; o: number; h: number; l: number; c: number }

export function ForecastChart({ context, band, projected, liveCandle }: {
  context: FCandle[];
  band: { t: number; upper: number; lower: number }[];
  projected?: FCandle[];
  liveCandle?: FCandle | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const realRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const projRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const upperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lowerRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lastRealTRef = useRef<number>(0);
  const [nowX, setNowX] = useState<number | null>(null);

  // موقع فاصل «الآن» — إحداثيات آخر شمعة حقيقية على المحور
  const updateNowX = useCallback(() => {
    const chart = chartRef.current;
    const t = lastRealTRef.current;
    if (!chart || !t) { setNowX(null); return; }
    const x = chart.timeScale().timeToCoordinate((t / 1000) as Time);
    setNowX(x === null ? null : x);
  }, []);

  // إنشاء الشارت مرة واحدة — سلسلة شموع حقيقية + سلسلة شموع متوقعة + حدّا النطاق
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0d1220' },
        textColor: '#8a94a6',
        fontFamily: "'Segoe UI', Tahoma, sans-serif",
        attributionLogo: false,
      },
      watermark: {
        visible: true,
        text: 'XAUUSD • FORECAST',
        color: 'rgba(217,180,92,0.05)',
        fontSize: 44,
        horzAlign: 'center',
        vertAlign: 'center',
      },
      grid: {
        vertLines: { color: 'rgba(27,35,52,0.45)' },
        horzLines: { color: 'rgba(27,35,52,0.45)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#46536b', width: 1, style: LineStyle.LargeDashed, labelBackgroundColor: '#1b2334' },
        horzLine: { color: '#46536b', width: 1, style: LineStyle.LargeDashed, labelBackgroundColor: '#1b2334' },
      },
      rightPriceScale: { borderColor: '#1b2334', scaleMargins: { top: 0.14, bottom: 0.14 } },
      timeScale: { borderColor: '#1b2334', timeVisible: true, secondsVisible: false, rightOffset: 10, barSpacing: 7 },
      autoSize: true,
    });

    // الشموع الحقيقية: صلبة بالكامل وذيول كاملة العتامة — مطابقة للشارت الأساسي
    const real = chart.addCandlestickSeries({
      upColor: '#2ebd85', downColor: '#f6465d',
      borderUpColor: '#2ebd85', borderDownColor: '#f6465d',
      wickUpColor: '#2ebd85', wickDownColor: '#f6465d',
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      priceLineVisible: true, priceLineColor: '#d9b45c', priceLineStyle: LineStyle.Dotted,
      lastValueVisible: true,
    });

    // الشموع المتوقعة: شفافة بحدّ ذهبي وذيل ذهبي ناعم — تميّزها بصرياً عن المؤكدة
    // ألوان أخفت بنسبة 35% فقط (عتامة 0.35) لتظهر بوضوح كتنبؤ، ولون ذهبي يميّزها
    // عن الشموع الحقيقية الخضراء/الحمراء الصلبة.
    const proj = chart.addCandlestickSeries({
      upColor: 'rgba(46,189,133,0.35)',
      downColor: 'rgba(246,70,93,0.35)',
      borderUpColor: '#e8c66f',
      borderDownColor: '#e8c66f',
      wickUpColor: 'rgba(232,198,111,0.55)',
      wickDownColor: 'rgba(232,198,111,0.55)',
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      priceLineVisible: false, lastValueVisible: false,
    });

    // نطاق الثقة الحتمي: حدّان ذهبيان محسوبان من ATR
    const upper = chart.addLineSeries({
      color: 'rgba(217,180,92,0.75)', lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    const lower = chart.addLineSeries({
      color: 'rgba(217,180,92,0.75)', lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    realRef.current = real;
    projRef.current = proj;
    upperRef.current = upper;
    lowerRef.current = lower;
    const ts = chart.timeScale();
    ts.subscribeVisibleTimeRangeChange(updateNowX);
    return () => {
      ts.unsubscribeVisibleTimeRangeChange(updateNowX);
      chart.remove();
      chartRef.current = null;
    };
  }, [updateNowX]);

  // تحديث البيانات
  useEffect(() => {
    const real = realRef.current;
    if (!real || !context.length) return;
    real.setData(context.map(c => ({
      time: (c.t / 1000) as Time, open: c.o, high: c.h, low: c.l, close: c.c,
    })) as CandlestickData<Time>[]);
    // الشموع المتوقعة — تُرسم بعد الشموع الحقيقية مباشرة بنفس المحور الزمني
    const proj = projRef.current;
    if (proj && projected && projected.length) {
      proj.setData(projected.map(c => ({
        time: (c.t / 1000) as Time, open: c.o, high: c.h, low: c.l, close: c.c,
      })) as CandlestickData<Time>[]);
    } else if (proj) {
      proj.setData([] as CandlestickData<Time>[]);
    }
    upperRef.current?.setData(band.map(b => ({ time: (b.t / 1000) as Time, value: b.upper })) as LineData<Time>[]);
    lowerRef.current?.setData(band.map(b => ({ time: (b.t / 1000) as Time, value: b.lower })) as LineData<Time>[]);
    lastRealTRef.current = context[context.length - 1].t;
    // تمديد العرض ليغطي نطاق الثقة كامل عرض الشارت — شموع كبيرة واضحة بدون فراغات
    const total = context.length + band.length;
    chartRef.current?.timeScale().setVisibleLogicalRange({ from: -4, to: total + 4 });
    const raf = requestAnimationFrame(updateNowX);
    return () => cancelAnimationFrame(raf);
  }, [context, band, projected, updateNowX]);

  // آخر شمعة حقيقية حية من بث MT5 — تحديث فوري دون إعادة رسم الشارت
  useEffect(() => {
    const real = realRef.current;
    if (!real || !liveCandle || !context.length) return;
    if (liveCandle.t < lastRealTRef.current) return; // أقدم مما رسمته السلسلة — تجاهل
    try {
      real.update({
        time: (liveCandle.t / 1000) as Time,
        open: liveCandle.o, high: liveCandle.h, low: liveCandle.l, close: liveCandle.c,
      });
      lastRealTRef.current = Math.max(lastRealTRef.current, liveCandle.t);
    } catch { /* سباق رسم نادر — الدفعة القادمة ستُصحح */ }
  }, [liveCandle, context]);

  return (
    <div className="relative w-full h-full min-h-0">
      <div ref={ref} className="w-full h-full" />

      {/* منطقة التوقعات — تدرّج ذهبي ناعم يميّز الزمن المستقبلي عن المؤكد */}
      {nowX !== null && (
        <div
          className="absolute inset-y-0 right-0 z-0 pointer-events-none"
          style={{
            left: nowX,
            background: 'linear-gradient(90deg, rgba(217,180,92,0.085) 0%, rgba(217,180,92,0.03) 60%, rgba(217,180,92,0.0) 100%)',
          }}
        />
      )}

      {/* فاصل «الآن» — يفصل الزمن المؤكد عن منطقة التوقعات، بتوهج ذهبي ناعم */}
      {nowX !== null && (
        <div className="absolute inset-y-0 z-10 pointer-events-none" style={{ left: nowX }}>
          <div
            className="absolute inset-y-0 -left-px border-l border-dashed border-[#d9b45c]/90"
            style={{ boxShadow: '0 0 12px rgba(217,180,92,0.35)' }}
          />
          <span
            className="absolute top-1.5 -left-[17px] bg-gradient-to-b from-[#e8c66f] to-[#d9b45c] text-[#0a0e17] text-[9px] font-black leading-none px-1.5 py-[3px] rounded-sm shadow-[0_2px_10px_rgba(217,180,92,0.45)] whitespace-nowrap"
          >
            الآن
          </span>
        </div>
      )}

      {/* عنوان منطقة التوقعات */}
      {nowX !== null && (
        <span className="absolute top-1.5 right-2 z-10 pointer-events-none text-[9px] font-bold text-[#d9b45c]/85 bg-[#0a0e17]/60 rounded px-1.5 py-0.5 border border-[#d9b45c]/25">
          منطقة التوقعات
        </span>
      )}

      {/* مفتاح الألوان — يشرح الفرق بين المؤكد والمتوقع والنطاق */}
      <div className="absolute top-2 left-2 z-10 pointer-events-none flex items-center gap-1.5 flex-wrap max-w-[60%]">
        <span className="flex items-center gap-1.5 rounded-md border border-[#1b2334]/80 bg-[#0a0e17]/75 backdrop-blur-sm px-2 py-1 text-[10px] text-[#c3cbd9] shadow">
          <span className="flex items-end gap-[2px]">
            <span className="w-[5px] h-[10px] rounded-[1px] bg-[#2ebd85]" />
            <span className="w-[5px] h-[10px] rounded-[1px] bg-[#f6465d]" />
          </span>
          حقيقية — مؤكدة
        </span>
        <span className="flex items-center gap-1.5 rounded-md border border-[#e8c66f]/45 bg-[#0a0e17]/75 backdrop-blur-sm px-2 py-1 text-[10px] text-[#e8c66f] shadow">
          <span className="flex items-end gap-[2px]">
            <span className="w-[5px] h-[10px] rounded-[1px] border border-[#e8c66f] bg-[#2ebd85]/30" />
            <span className="w-[5px] h-[10px] rounded-[1px] border border-[#e8c66f] bg-[#f6465d]/30" />
          </span>
          متوقعة — حتمية
        </span>
        <span className="flex items-center gap-1.5 rounded-md border border-[#1b2334]/80 bg-[#0a0e17]/75 backdrop-blur-sm px-2 py-1 text-[10px] text-[#c3cbd9] shadow">
          <span className="w-[9px] h-0 border-t border-dashed border-[#d9b45c]" />
          نطاق الثقة — ATR
        </span>
      </div>
    </div>
  );
}
