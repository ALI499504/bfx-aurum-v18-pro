'use client';

// شارت الصفقة — شموع حول فترة الصفقة + خطوط الدخول/الوقف/الهدف/الخروج
import { useEffect, useRef } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type CandlestickData, type Time, type SeriesMarker,
} from 'lightweight-charts';

interface ChartCandle { t: number; o: number; h: number; l: number; c: number }

export function TradeChart({ candles, entry, sl, tp, dir, exit, entryT, exitT }: {
  candles: ChartCandle[];
  entry: number; sl: number; tp: number; dir: 'buy' | 'sell';
  exit?: number;    // سعر الخروج الفعلي (صفقات MT5 الحقيقية)
  entryT?: number;  // وقت الدخول (ms) — لرسم علامة الدخول
  exitT?: number;   // وقت الخروج (ms)
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const csRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0e17' },
        textColor: '#8a94a6',
        fontFamily: "'Segoe UI', Tahoma, sans-serif",
        attributionLogo: false,
      },
      grid: { vertLines: { color: '#131a29' }, horzLines: { color: '#131a29' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1b2334' },
      timeScale: { borderColor: '#1b2334', timeVisible: true, secondsVisible: false },
      autoSize: true,
    });
    const cs = chart.addCandlestickSeries({
      upColor: '#2ebd85', downColor: '#f6465d',
      borderUpColor: '#2ebd85', borderDownColor: '#f6465d',
      wickUpColor: '#2ebd85', wickDownColor: '#f6465d',
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    chartRef.current = chart;
    csRef.current = cs;
    return () => { chart.remove(); chartRef.current = null; csRef.current = null; };
  }, []);

  useEffect(() => {
    const cs = csRef.current;
    if (!cs || !candles.length) return;
    cs.setData(candles.map(c => ({
      time: (c.t / 1000) as Time, open: c.o, high: c.h, low: c.l, close: c.c,
    })) as CandlestickData<Time>[]);

    // خطوط الخطة: الدخول ذهبي، الوقف أحمر، الهدف أخضر، الخروج رمادي
    const lines: ReturnType<typeof cs.createPriceLine>[] = [];
    const mk = (price: number, color: string, title: string) => lines.push(cs.createPriceLine({
      price, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title,
    }));
    mk(entry, '#d9b45c', 'دخول');
    if (sl > 0) mk(sl, '#f6465d', 'وقف');
    if (tp > 0) mk(tp, '#2ebd85', 'هدف');
    if (exit && exit > 0) mk(exit, '#c8cfdb', 'خروج');

    // علامات الدخول/الخروج على الزمن الحقيقي
    const markers: SeriesMarker<Time>[] = [];
    const markAt = (tMs: number, shape: 'arrowUp' | 'arrowDown' | 'circle', color: string, text: string) => {
      if (!tMs) return;
      const c0 = candles[0].t, cN = candles[candles.length - 1].t + 12 * 3600e3;
      if (tMs < c0 - 3600e3 || tMs > cN) return;
      const near = candles.reduce((b, c) => (Math.abs(c.t - tMs) < Math.abs(b.t - tMs) ? c : b), candles[0]);
      markers.push({ time: (near.t / 1000) as Time, position: shape === 'arrowUp' ? 'belowBar' : 'aboveBar', color, shape, text });
    };
    if (entryT) markAt(entryT, dir === 'buy' ? 'arrowUp' : 'arrowDown', dir === 'buy' ? '#2ebd85' : '#f6465d', dir === 'buy' ? 'شراء' : 'بيع');
    if (exitT) markAt(exitT, 'circle', '#d9b45c', 'خروج');
    cs.setMarkers(markers);

    return () => { for (const l of lines) cs.removePriceLine(l); cs.setMarkers([]); };
  }, [candles, entry, sl, tp, dir, exit, entryT, exitT]);

  return <div ref={ref} className="w-full h-full min-h-[180px]" />;
}
