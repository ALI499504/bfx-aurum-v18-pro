'use client';

// شارت الشموع الذهب — أسلوب MT5 الرسمي:
// شموع صلبة واضحة الحواف + خط السعر الحالي + علامة مائية + شبكة هادئة + صندوق OHLC
import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type CandlestickData, type Time, type SeriesMarker, type LineData, type MouseEventParams,
} from 'lightweight-charts';

interface ChartCandle { t: number; o: number; h: number; l: number; c: number; v?: number }
interface TradeMarker { entryT: number; dir: string; strategy: string; pnl: number }

interface OhlcBox { o: number; h: number; l: number; c: number; time: number }

export function GoldChart({ candles, emaFast, emaSlow, trades, showEma, levels, tfLabel, liveCandle }: {
  candles: ChartCandle[];
  emaFast: { t: number; v: number | null }[];
  emaSlow: { t: number; v: number | null }[];
  trades: TradeMarker[];
  showEma: boolean;
  levels: { price: number; title: string; color: string }[];
  tfLabel?: string;
  liveCandle?: ChartCandle | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const fastRef = useRef<ISeriesApi<'Line'> | null>(null);
  const slowRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([]);
  const [hovered, setHovered] = useState<OhlcBox | null>(null);
  const [liveLast, setLiveLast] = useState<ChartCandle | null>(null);
  // آخر زمن رسمته سلسلة الشموع فعلاً — حاجز أحادي يمنع أي update() بوقت أقدم مهما كان سباق التحديثات
  const lastSeriesTRef = useRef(0);
  // التأطير الأولي: مرة واحدة لكل فريم فقط — بعدها لا نلمس تكبير/تمرير المستخدم إطلاقاً
  // (الإعادة كل تحديث كانت تلغي زوم المستخدم كل 0.7 ثانية — كان هذا سبب "الزوم لا يستجيب")
  const rangeInitTfRef = useRef<string | null>(null);

  // تكبير/تصغير حول مركز العرض — وعند الالتصاق بالحافة اليمنى (آخر الأسعار) نكبّر نحو الحافة
  const zoomBy = (factor: number) => {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    const r = ts.getVisibleLogicalRange();
    if (!r) return;
    const span = Math.max(12, Math.min((r.to - r.from) * factor, 100000));
    if (r.to >= candles.length - 3) ts.setVisibleLogicalRange({ from: r.to - span, to: r.to });
    else {
      const center = (r.from + r.to) / 2;
      ts.setVisibleLogicalRange({ from: center - span / 2, to: center + span / 2 });
    }
  };
  // العودة للعرض الافتراضي: آخر 140 شمعة بحجم مريح
  const resetView = () => {
    const ts = chartRef.current?.timeScale();
    if (!ts || !candles.length) return;
    const visible = Math.min(candles.length, 140);
    ts.setVisibleLogicalRange({ from: candles.length - visible - 2, to: candles.length + 5 });
  };

  // إنشاء الشارت مرة واحدة
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
        text: 'XAUUSD',
        color: 'rgba(217,180,92,0.045)',
        fontSize: 58,
        horzAlign: 'center',
        vertAlign: 'center',
      },
      grid: {
        vertLines: { color: 'rgba(27,35,52,0.30)' },
        horzLines: { color: 'rgba(27,35,52,0.30)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#46536b', width: 1, style: LineStyle.LargeDashed, labelBackgroundColor: '#1b2334' },
        horzLine: { color: '#46536b', width: 1, style: LineStyle.LargeDashed, labelBackgroundColor: '#1b2334' },
      },
      rightPriceScale: { borderColor: '#1b2334', scaleMargins: { top: 0.1, bottom: 0.24 } },
      // minBarSpacing 1.5 → حتى عند أقصى تصغير تبقى الشموع مقروءة لا خيوطاً باهتة
      timeScale: { borderColor: '#1b2334', timeVisible: true, secondsVisible: false, barSpacing: 9, rightOffset: 8, minBarSpacing: 1.5 },
      autoSize: true,
    });
    // شموع حقيقية صلبة — أجسام واضحة الحواف وذيول بلون الجسم كامل العتامة (أوضح للعين)
    const cs = chart.addCandlestickSeries({
      upColor: '#2ebd85', downColor: '#f6465d',
      borderUpColor: '#2ebd85', borderDownColor: '#f6465d',
      wickUpColor: '#2ebd85', wickDownColor: '#f6465d',
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      priceLineVisible: true, priceLineColor: '#d9b45c', priceLineStyle: LineStyle.Dotted,
      lastValueVisible: true,
    });
    // حجم التداول الحقيقي (tick volume من طرفية MT5) — أعمدة هادئة أسفل الشموع
    const vol = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      base: 0,
      priceLineVisible: false, lastValueVisible: false,
    });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const fast = chart.addLineSeries({
      color: '#e2bd60', lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const slow = chart.addLineSeries({
      color: '#8fa7ff', lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // صندوق OHLC يتبع مؤشر التقاطع مثل MT5
    const onMove = (p: MouseEventParams<Time>) => {
      if (!p.time || !cs) { setHovered(null); return; } // بلا تقاطع → آخر شمعة
      const d = p.seriesData.get(cs) as CandlestickData<Time> | undefined;
      if (d) setHovered({ o: d.open, h: d.high, l: d.low, c: d.close, time: Number(p.time) * 1000 });
    };
    chart.subscribeCrosshairMove(onMove);

    chartRef.current = chart;
    candleRef.current = cs;
    volRef.current = vol;
    fastRef.current = fast;
    slowRef.current = slow;
    return () => { chart.remove(); chartRef.current = null; };
  }, []);

  // تحديث الشموع + حجم التداول + نافذة عرض أولية أنيقة (آخر 170 شمعة كبيرة واضحة، والبقية بالتمرير)
  useEffect(() => {
    const cs = candleRef.current;
    if (!cs || !candles.length) return;
    const data: CandlestickData<Time>[] = candles.map(c => ({
      time: (c.t / 1000) as Time,
      open: c.o, high: c.h, low: c.l, close: c.c,
    }));
    cs.setData(data);
    lastSeriesTRef.current = candles[candles.length - 1].t;
    volRef.current?.setData(candles.map(c => ({
      time: (c.t / 1000) as Time,
      value: Math.max(1, c.v ?? 0),
      color: c.c >= c.o ? 'rgba(46,189,133,0.30)' : 'rgba(246,70,93,0.30)',
    })));
    // نافذة أولية أنيقة: تُطبق مرة واحدة فقط لكل فريم (أول تحميل أو تبديل فريم)
    // بعدها نحترم تكبير المستخدم ونحترم موضع التمرير — لا إعادة ضبط إطلاقاً
    if (rangeInitTfRef.current !== (tfLabel ?? '')) {
      rangeInitTfRef.current = tfLabel ?? '';
      const visible = Math.min(candles.length, 140);
      chartRef.current?.timeScale().setVisibleLogicalRange({
        from: candles.length - visible - 2,
        to: candles.length + 5,
      });
    }

    // علامات الصفقات داخل النطاق المعروض
    const t0 = candles[0].t, t1 = candles[candles.length - 1].t;
    const markers: SeriesMarker<Time>[] = trades
      .filter(tr => tr.entryT >= t0 && tr.entryT <= t1)
      .slice(-120)
      .map(tr => ({
        time: (tr.entryT / 1000) as Time,
        position: (tr.dir === 'buy' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
        color: tr.dir === 'buy' ? '#2ebd85' : '#f6465d',
        shape: (tr.dir === 'buy' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
        text: tr.strategy,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    cs.setMarkers(markers);

    // خطوط المستويات المرجعية
    for (const pl of priceLinesRef.current) { cs.removePriceLine(pl); }
    priceLinesRef.current = levels.map(l => cs.createPriceLine({
      price: l.price, color: l.color, lineWidth: 1, lineStyle: 2,
      axisLabelVisible: true, title: l.title,
    }));
  }, [candles, trades, levels]);

  // خطوط EMA
  useEffect(() => {
    const toLine = (arr: { t: number; v: number | null }[]): LineData<Time>[] =>
      arr.filter(x => x.v !== null).map(x => ({ time: (x.t / 1000) as Time, value: x.v as number }));
    fastRef.current?.setData(showEma ? toLine(emaFast) : []);
    slowRef.current?.setData(showEma ? toLine(emaSlow) : []);
  }, [emaFast, emaSlow, showEma]);

  // الشمعة الحية من بث MT5 — تحديث فوري لآخر شمعة عبر update() دون إعادة رسم الشارت
  useEffect(() => {
    const cs = candleRef.current;
    if (!cs || !liveCandle) return;
    if (liveCandle.t < lastSeriesTRef.current) return; // أقدم مما رسمته السلسلة — تجاهل
    try {
      cs.update({
        time: (liveCandle.t / 1000) as Time,
        open: liveCandle.o, high: liveCandle.h, low: liveCandle.l, close: liveCandle.c,
      });
      lastSeriesTRef.current = Math.max(lastSeriesTRef.current, liveCandle.t);
      setLiveLast(liveCandle);
    } catch { /* سباق رسم نادر — الدفعة القادمة ستُصحح */ }
  }, [liveCandle, candles]);

  // الصندوق يعرض الشمعة تحت المؤشر، وإلا آخر شمعة حية ثم آخر شمعة معروضة
  const lastC = liveLast && (!candles.length || liveLast.t >= candles[candles.length - 1].t)
    ? liveLast
    : (candles.length ? candles[candles.length - 1] : null);
  const box = hovered ?? (lastC ? { o: lastC.o, h: lastC.h, l: lastC.l, c: lastC.c, time: lastC.t } : null);
  const up = box ? box.c >= box.o : true;
  const change = box ? ((box.c - box.o) / box.o) * 100 : 0;

  return (
    <div className="relative w-full h-full min-h-0">
      <div ref={ref} className="w-full h-full" />
      {/* أزرار التكبير — أسلوب MT5: + / − / عرض افتراضي */}
      <div className="absolute top-2 right-16 z-10 flex flex-col gap-1" dir="ltr">
        <button onClick={() => zoomBy(0.7)} title="تكبير — شموع أكبر وأوضح"
          className="w-7 h-7 rounded-md border border-[#2a3550] bg-[#0a0e17]/85 backdrop-blur-sm text-[#c9d2e3] hover:text-[#d9b45c] hover:border-[#d9b45c]/60 transition-colors flex items-center justify-center shadow-lg">
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => zoomBy(1 / 0.7)} title="تصغير — رؤية أوسع"
          className="w-7 h-7 rounded-md border border-[#2a3550] bg-[#0a0e17]/85 backdrop-blur-sm text-[#c9d2e3] hover:text-[#d9b45c] hover:border-[#d9b45c]/60 transition-colors flex items-center justify-center shadow-lg">
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button onClick={resetView} title="العودة للعرض الافتراضي"
          className="w-7 h-7 rounded-md border border-[#2a3550] bg-[#0a0e17]/85 backdrop-blur-sm text-[#c9d2e3] hover:text-[#d9b45c] hover:border-[#d9b45c]/60 transition-colors flex items-center justify-center shadow-lg">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* صندوق معلومات MT5 */}
      {box && (
        <div className="absolute top-2 left-2 z-10 pointer-events-none rounded-md border border-[#1b2334]/80 bg-[#0a0e17]/78 backdrop-blur-sm px-2.5 py-1.5 flex items-center gap-2.5 shadow-lg" dir="ltr">
          <span className="text-[10px] font-bold text-[#d9b45c]">XAUUSD {tfLabel ?? ''}</span>
          <Ohlc k="O" v={box.o} up />
          <Ohlc k="H" v={box.h} up />
          <Ohlc k="L" v={box.l} up={false} />
          <Ohlc k="C" v={box.c} up={up} />
          <span className={`font-mono text-[10.5px] font-bold ${up ? 'text-[#2ebd85]' : 'text-[#f6465d]'}`}>
            {up ? '+' : ''}{change.toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  );
}

function Ohlc({ k, v, up }: { k: string; v: number; up: boolean }) {
  return (
    <span className="text-[10px]">
      <span className="text-[#5a6474]">{k}</span>{' '}
      <span className={`font-mono font-semibold ${up ? 'text-[#2ebd85]' : 'text-[#f6465d]'}`}>{v.toFixed(2)}</span>
    </span>
  );
}
