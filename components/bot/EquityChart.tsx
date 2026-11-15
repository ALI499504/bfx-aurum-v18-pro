'use client';

// منحنى الرصيد — منحنى نمو الحساب من الباك تيست
import { useEffect, useRef } from 'react';
import {
  createChart, ColorType, CrosshairMode,
  type IChartApi, type ISeriesApi, type Time, type LineData,
} from 'lightweight-charts';

export function EquityChart({ points, base }: {
  points: { t: number; v: number }[];
  base: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaRef = useRef<ISeriesApi<'Area'> | null>(null);
  const baseRef = useRef<ISeriesApi<'Line'> | null>(null);

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
      timeScale: { borderColor: '#1b2334', timeVisible: false, secondsVisible: false },
      autoSize: true,
    });
    const area = chart.addAreaSeries({
      lineColor: '#d9b45c', lineWidth: 2,
      topColor: 'rgba(217,180,92,0.28)', bottomColor: 'rgba(217,180,92,0.02)',
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      priceLineVisible: false, lastValueVisible: true,
    });
    const baseline = chart.addLineSeries({
      color: 'rgba(138,148,166,0.5)', lineWidth: 1, lineStyle: 2,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    chartRef.current = chart;
    areaRef.current = area;
    baseRef.current = baseline;
    return () => { chart.remove(); chartRef.current = null; };
  }, []);

  useEffect(() => {
    if (!areaRef.current || !points.length) return;
    const data: LineData<Time>[] = [];
    let lastT = -1;
    for (const p of points) {
      const s = Math.floor(p.t / 1000);
      if (s === lastT) continue; // إزالة التكرار الزمني
      lastT = s;
      data.push({ time: s as Time, value: +p.v.toFixed(2) });
    }
    areaRef.current.setData(data);
    const first = points[0]?.t ?? 0, last = points[points.length - 1]?.t ?? 0;
    baseRef.current?.setData([
      { time: Math.floor(first / 1000) as Time, value: base },
      { time: Math.floor(last / 1000) as Time, value: base },
    ]);
    chartRef.current?.timeScale().fitContent();
  }, [points, base]);

  return <div ref={ref} className="w-full h-full min-h-[200px]" />;
}
