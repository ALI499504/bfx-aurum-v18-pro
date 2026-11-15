'use client';

// شارت XAUUSD — محاكي MetaTrader 5 طبق الأصل (محرك Canvas مخصص، بلا أي مكتبة رسم)
// مطابق لوثائق ميتاتريدر الرسمية حرفياً:
//  • المخططات الرسمية الأربعة كما في نافذة Properties ← Colors ← Scheme:
//    «Green on Black» (المخطط المصنعي الافتراضي للطرفية) / «Yellow on Black» / «Black on White» / «Color on White»
//  • خوارزمية رسم الشمعة الرسمية من توثيق MetaQuotes:
//    Bar up  = لون فتيل الشمعة الصاعدة و«حواف» جسمها
//    Bar down = لون فتيل الشمعة الهابطة و«حواف» جسمها
//    Bull/Bear candle = لون «تعبئة» جسم الشمعة (في Black on White يصبح الجسم مجوّفاً كالميتاتريدر تماماً)
//    Line chart = لون شموع الدوجي
//    Volumes = لون أعمدة حجم التداول (أخضر داكن صلب كالميتاتريدر)
//  • خلفية نقية + شبكة 1px + محور سعر يمين ومحور وقت أسفل بخط Tahoma
//  • خط Bid متقطع مع بطاقة السعر الرمادية على المحور + تقاطع منقّط مع بطاقات السعر/الوقت
//  • سطر معلومات OHLC + V بلون النص الأمامي فقط (كالطرفية — بلا تلوين بالنسب)
//  • خطوط الصفقات: دخول أزرق متقطع بعنوان «sell 0.01 XAUUSD.m [H]»، وقف أحمر «sl»، هدف أخضر «tp»
//  • سلوك MT5: عجلة الفأرة تكبّر/تصغّر، السحب يحرّك الزمن، الشمعة الحية تتحدث لحظياً مع كل تيك
import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface ChartCandle { t: number; o: number; h: number; l: number; c: number; v?: number }
interface TradeMarker { entryT: number; dir: string; strategy: string; pnl: number }
interface ChartLevel { price: number; title: string; color: string; t?: number }
interface OhlcBox { o: number; h: number; l: number; c: number; time: number; v?: number }

// تسمية الفريمات بطريقة MetaTrader 5 الرسمية
const MT5_TF: Record<string, string> = {
  '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D1', '1w': 'W1', '1M': 'MN',
};

// ===== مخططات ميتاتريدر 5 الرسمية — القيم كما في نافذة Chart Properties =====
export type Mt5SchemeId = 'green' | 'yellow' | 'blackOnWhite' | 'colorOnWhite';

export interface Mt5Scheme {
  id: Mt5SchemeId;
  name: string;        // الاسم الرسمي كما في الطرفية
  bg: string;          // Background
  fg: string;          // Foreground (محاور + سطر OHLC)
  grid: string;        // Grid
  axis: string;        // إطار المحاور
  barUp: string;       // Bar up — فتيل وحواف الشمعة الصاعدة
  barDown: string;     // Bar down — فتيل وحواف الشمعة الهابطة
  bull: string;        // Bull candle — تعبئة الجسم الصاعد
  bear: string;        // Bear candle — تعبئة الجسم الهابط
  line: string;        // Line chart — الدوجي
  vol: string;         // Volumes
  bid: string;         // Bid line
  bidTagBg: string;    // خلفية بطاقة السعر على المحور
  bidTagText: string;
  cross: string;       // التقاطع
  crossTagBg: string;  // خلفية بطاقة التقاطع
  crossTagText: string;
  entry: string;       // خط الدخول
  sl: string;          // خط الوقف
  tp: string;          // خط الهدف
  struct: string;      // مستويات الهيكل
  buyArrow: string;    // سهم الشراء
  sellArrow: string;   // سهم البيع
  emaFast: string;
  emaSlow: string;
  plate: string;       // خلفية لوحات العناوين فوق الخطوط
  dark: boolean;       // خلفية داكنة؟ (لظل النص)
}

export const MT5_SCHEMES: Record<Mt5SchemeId, Mt5Scheme> = {
  green: {
    id: 'green', name: 'Green on Black',
    bg: '#000000', fg: '#c8c8c8', grid: '#282828', axis: '#3a3a3a',
    barUp: '#00ff00', barDown: '#ff0000',
    bull: '#00ff00', bear: '#ff0000',
    line: '#00ff00', vol: '#008000',
    bid: '#c8c8c8', bidTagBg: '#b4b4b4', bidTagText: '#000000', cross: '#7f7f7f', crossTagBg: '#6f6f6f', crossTagText: '#ffffff',
    entry: '#4e86e0', sl: '#ff2d2d', tp: '#00e70b', struct: '#7a7a7a',
    buyArrow: '#4d9feb', sellArrow: '#ff4444', emaFast: '#e2bd60', emaSlow: '#8fa7ff',
    plate: 'rgba(0,0,0,0.78)', dark: true,
  },
  yellow: {
    id: 'yellow', name: 'Yellow on Black',
    bg: '#000000', fg: '#c8c8c8', grid: '#282828', axis: '#3a3a3a',
    barUp: '#ffff00', barDown: '#ffff00',
    bull: '#ffff00', bear: '#ffff00',
    line: '#ffff00', vol: '#008000',
    bid: '#c8c8c8', bidTagBg: '#b4b4b4', bidTagText: '#000000', cross: '#7f7f7f', crossTagBg: '#6f6f6f', crossTagText: '#ffffff',
    entry: '#4e86e0', sl: '#ff2d2d', tp: '#00e70b', struct: '#7a7a7a',
    buyArrow: '#4d9feb', sellArrow: '#ff4444', emaFast: '#e2bd60', emaSlow: '#8fa7ff',
    plate: 'rgba(0,0,0,0.78)', dark: true,
  },
  blackOnWhite: {
    id: 'blackOnWhite', name: 'Black on White',
    bg: '#ffffff', fg: '#000000', grid: '#c0c0c0', axis: '#a0a0a0',
    barUp: '#000000', barDown: '#000000',
    bull: '#ffffff', bear: '#000000',   // الجسم الصاعد = لون الخلفية → مجوّف بحدود سوداء كالميتاتريدر
    line: '#000000', vol: '#008000',
    bid: '#909090', bidTagBg: '#b4b4b4', bidTagText: '#000000', cross: '#7f7f7f', crossTagBg: '#6f6f6f', crossTagText: '#ffffff',
    entry: '#0000cc', sl: '#cc0000', tp: '#008000', struct: '#909090',
    buyArrow: '#0000cc', sellArrow: '#cc0000', emaFast: '#b8860b', emaSlow: '#0000cd',
    plate: 'rgba(255,255,255,0.85)', dark: false,
  },
  colorOnWhite: {
    id: 'colorOnWhite', name: 'Color on White',
    bg: '#ffffff', fg: '#000000', grid: '#c0c0c0', axis: '#a0a0a0',
    barUp: '#008000', barDown: '#ff0000',
    bull: '#ffffff', bear: '#ff0000',   // صاعد مجوّف بحدود خضراء / هابط أحمر مملوء — كالميتاتريدر
    line: '#0000ff', vol: '#008000',
    bid: '#909090', bidTagBg: '#b4b4b4', bidTagText: '#000000', cross: '#7f7f7f', crossTagBg: '#6f6f6f', crossTagText: '#ffffff',
    entry: '#0000cc', sl: '#cc0000', tp: '#008000', struct: '#909090',
    buyArrow: '#0000cc', sellArrow: '#cc0000', emaFast: '#b8860b', emaSlow: '#0000cd',
    plate: 'rgba(255,255,255,0.85)', dark: false,
  },
};

export const MT5_SCHEME_ORDER: Mt5SchemeId[] = ['green', 'yellow', 'blackOnWhite', 'colorOnWhite'];

const LS_SCHEME = 'bfx-mt5-scheme';
export function loadScheme(): Mt5SchemeId {
  try {
    const v = localStorage.getItem(LS_SCHEME) as Mt5SchemeId | null;
    return v && MT5_SCHEMES[v] ? v : 'green';
  } catch { return 'green'; }
}
export function saveScheme(id: Mt5SchemeId) {
  try { localStorage.setItem(LS_SCHEME, id); } catch { /* ignore */ }
}

const AXIS_W = 64;   // عرض محور الأسعار يمين — مثل MT5
const TIME_H = 22;   // ارتفاع محور الوقت أسفل
const FONT = '11px Tahoma, "Segoe UI", sans-serif';
const FONT_TAG = 'bold 10px Tahoma, "Segoe UI", sans-serif';
const FONT_LABEL = '10px Tahoma, "Segoe UI", sans-serif';

function pad2(n: number) { return n < 10 ? `0${n}` : `${n}`; }
/** تنسيق وقت UTC — توقيت الطرفية (أوقات الشموع تُخزَّن UTC) */
function fmtTime(t: number) {
  const d = new Date(t);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
function fmtDay(t: number) {
  const d = new Date(t);
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${M[d.getUTCMonth()]}`;
}
/** خطوة شبكة سعر «مرتبة» كالميتاتريدر: 1/2/2.5/5 × 10^n */
function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / p;
  if (r <= 1) return p;
  if (r <= 2) return 2 * p;
  if (r <= 2.5) return 2.5 * p;
  if (r <= 5) return 5 * p;
  return 10 * p;
}
const TIME_STEPS = [
  60e3, 5 * 60e3, 15 * 60e3, 30 * 60e3, 60e3 * 60, 2 * 3600e3, 3 * 3600e3, 4 * 3600e3,
  6 * 3600e3, 8 * 3600e3, 12 * 3600e3, 24 * 3600e3, 2 * 86400e3, 7 * 86400e3, 30 * 86400e3,
];

export function GoldChart({ candles, emaFast, emaSlow, trades, showEma, levels, tfLabel, liveCandle, scheme: schemeId }: {
  candles: ChartCandle[];
  emaFast: { t: number; v: number | null }[];
  emaSlow: { t: number; v: number | null }[];
  trades: TradeMarker[];
  showEma: boolean;
  levels: ChartLevel[];
  tfLabel?: string;
  liveCandle?: ChartCandle | null;
  scheme?: Mt5SchemeId;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const S = MT5_SCHEMES[schemeId ?? 'green'];

  // البيانات المدموجة (شموع محمّلة + الشمعة الحية من بث MT5)
  const dataRef = useRef<ChartCandle[]>([]);
  // حالة العرض: spacing = عرض الشمعة بالبكسل، rightIdx = مؤشر عائم عند الحافة اليمنى لمنطقة الرسم
  const viewRef = useRef({ spacing: 10, rightIdx: 0 });
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const rafRef = useRef(0);
  // أول زمن في الدفعة — لتعمير العرض عند تبديل الفريم فقط (لا نمس زوم المستخدم لاحقاً)
  const initKeyRef = useRef<string | null>(null);
  const [hovered, setHovered] = useState<OhlcBox | null>(null);
  const hoveredIdxRef = useRef<number>(-1);
  const [liveLast, setLiveLast] = useState<ChartCandle | null>(null);

  const requestDraw = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; draw(); });
  };

  // ===== دمج الشمعة الحية مع البيانات — منطق MT5: آخر شمعة تتحرك مع كل تيك =====
  useEffect(() => {
    const base = candles.length ? candles.slice() : [];
    dataRef.current = base;
    if (liveCandle) {
      const last = base[base.length - 1];
      // شمعة tick الحية بلا حقول v — نرث حجم التداول المتراكم من بيانات الشارت الحقيقية
      if (!last || liveCandle.t > last.t) base.push({ v: 1, ...liveCandle });
      else if (liveCandle.t === last.t) base[base.length - 1] = { v: last.v, ...liveCandle };
    }
    // الشمعة الحية ترث حجم التداول المتراكم من الشمعة الأساسية (سطر OHLC يعرض V كالميتاتريدر)
    setLiveLast(() => {
      if (!candles.length) return null;
      const baseLast = candles[candles.length - 1];
      if (liveCandle && liveCandle.t >= baseLast.t) return { v: baseLast.v, ...liveCandle };
      return baseLast;
    });
    // تعمير أولي عند تبديل الفريم/إعادة التحميل: آخر 130 شمعة + إزاحة يمين (Chart Shift) كالميتاتريدر
    const key = candles.length ? `${candles[0].t}:${candles.length}:${tfLabel ?? ''}` : 'empty';
    if (initKeyRef.current !== key && candles.length) {
      initKeyRef.current = key;
      const v = viewRef.current;
      if (v.spacing < 4 || v.spacing > 14) v.spacing = 10;
      const el = wrapRef.current;
      const shiftBars = el ? Math.max(8, Math.round((el.clientWidth * 0.1) / v.spacing)) : Math.max(6, Math.round(90 / v.spacing));
      v.rightIdx = candles.length - 1 + shiftBars;
    }
    requestDraw();
  }, [candles, liveCandle, tfLabel]);

  // ===== القياس مع DPR =====
  useEffect(() => {
    const el = wrapRef.current;
    const cv = canvasRef.current;
    if (!el || !cv) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = Math.max(80, Math.round(r.width));
      const h = Math.max(80, Math.round(r.height));
      if (sizeRef.current.w !== w || sizeRef.current.h !== h || sizeRef.current.dpr !== dpr) {
        sizeRef.current = { w, h, dpr };
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        cv.style.width = `${w}px`;
        cv.style.height = `${h}px`;
        requestDraw();
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ===== تفاعل الفأرة — سحب زمني + تقاطع، والعجلة تكبير حول الحافة اليمنى كالميتاتريدر =====
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let dragging = false;
    let lastX = 0;

    const idxFromX = (x: number) => {
      const { spacing, rightIdx } = viewRef.current;
      return rightIdx - (sizeRef.current.w - AXIS_W - x) / spacing;
    };
    const clampView = () => {
      const v = viewRef.current;
      const n = dataRef.current.length;
      v.spacing = Math.max(1.2, Math.min(v.spacing, 42));
      const maxRight = n - 1 + Math.max(6, Math.round(120 / v.spacing)) + 40;
      const minRight = Math.min(n - 1, Math.max(4, 40 / v.spacing));
      v.rightIdx = Math.max(minRight, Math.min(v.rightIdx, maxRight));
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const f = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      v.spacing = Math.max(1.2, Math.min(v.spacing * f, 42));
      clampView();
      requestDraw();
    };
    const onDown = (e: MouseEvent) => {
      dragging = true; lastX = e.clientX;
      cv.style.cursor = 'grabbing';
    };
    const onMove = (e: MouseEvent) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (dragging) {
        const v = viewRef.current;
        v.rightIdx += (e.clientX - lastX) / v.spacing;
        lastX = e.clientX;
        clampView();
        requestDraw();
      }
      // التقاطع يظهر فقط داخل مساحة الشارت — خارجها يختفي كالميتاتريدر تماماً
      const inside = y >= 0 && x >= 0 && x <= sizeRef.current.w && y <= sizeRef.current.h;
      if (!inside) {
        if (hoverRef.current || hoveredIdxRef.current !== -1) {
          hoverRef.current = null;
          hoveredIdxRef.current = -1;
          setHovered(null);
          requestDraw();
        }
        return;
      }
      hoverRef.current = { x, y };
      const i = Math.round(idxFromX(x));
      if (i !== hoveredIdxRef.current) {
        hoveredIdxRef.current = i;
        const d = dataRef.current[i];
        setHovered(d && x < sizeRef.current.w - AXIS_W ? { o: d.o, h: d.h, l: d.l, c: d.c, time: d.t, v: d.v } : null);
      }
      requestDraw();
    };
    const onUp = () => { dragging = false; cv.style.cursor = 'crosshair'; };
    const onLeave = () => {
      dragging = false;
      hoverRef.current = null;
      hoveredIdxRef.current = -1;
      setHovered(null);
      requestDraw();
    };
    // لمس: سحب بإصبع واحد
    const onTouchStart = (e: TouchEvent) => { if (e.touches.length === 1) { lastX = e.touches[0].clientX; dragging = true; } };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && dragging) {
        const v = viewRef.current;
        v.rightIdx += (lastX - e.touches[0].clientX) / v.spacing;
        lastX = e.touches[0].clientX;
        clampView();
        requestDraw();
      }
    };
    const onTouchEnd = () => { dragging = false; };

    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    cv.addEventListener('mouseleave', onLeave);
    cv.addEventListener('touchstart', onTouchStart, { passive: true });
    cv.addEventListener('touchmove', onTouchMove, { passive: true });
    cv.addEventListener('touchend', onTouchEnd);
    cv.style.cursor = 'crosshair';
    return () => {
      cv.removeEventListener('wheel', onWheel);
      cv.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      cv.removeEventListener('mouseleave', onLeave);
      cv.removeEventListener('touchstart', onTouchStart);
      cv.removeEventListener('touchmove', onTouchMove);
      cv.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  // أزرار التكبير — تعديل مباشر ثم رسم
  const zoomBy = (factor: number) => {
    const v = viewRef.current;
    v.spacing = Math.max(1.2, Math.min(v.spacing * factor, 42));
    const n = dataRef.current.length;
    v.rightIdx = Math.max(Math.min(n - 1, Math.max(4, 40 / v.spacing)),
      Math.min(v.rightIdx, n - 1 + Math.max(6, Math.round(120 / v.spacing)) + 40));
    requestDraw();
  };
  const resetView = () => {
    const n = dataRef.current.length;
    if (!n) return;
    const el = wrapRef.current;
    const shiftBars = el ? Math.max(8, Math.round((el.clientWidth * 0.1) / 10)) : 9;
    viewRef.current = { spacing: 10, rightIdx: n - 1 + shiftBars };
    requestDraw();
  };

  // ===== المحرك الرسمي — نفس تسلسل رسم MT5: خلفية → شبكة → حجم → شموع → خطوط → محاور =====
  const draw = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    const data = dataRef.current;
    const v = viewRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const plotW = w - AXIS_W;
    const plotH = h - TIME_H;
    ctx.fillStyle = S.bg;
    ctx.fillRect(0, 0, w, h);
    if (!data.length || plotW < 30 || plotH < 40) return;

    const xFor = (i: number) => plotW - (v.rightIdx - i) * v.spacing;
    const idxFromX = (x: number) => v.rightIdx - (plotW - x) / v.spacing;
    const i0 = Math.max(0, Math.floor(v.rightIdx - plotW / v.spacing) - 1);
    const i1 = Math.min(data.length - 1, Math.ceil(v.rightIdx) + 1);

    // نطاق السعر من الشموع المرئية + السعر الحي (فوق/تحت هامش 8% كالميتاتريدر)
    let pMin = Infinity, pMax = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const d = data[i];
      if (d.l < pMin) pMin = d.l;
      if (d.h > pMax) pMax = d.h;
    }
    const bid = liveLast?.c ?? data[data.length - 1].c;
    if (bid > pMax * 0.92 && bid < pMax * 1.15) pMax = Math.max(pMax, bid);
    if (bid < pMin * 1.08 && bid > pMin * 0.85) pMin = Math.min(pMin, bid);
    if (!isFinite(pMin) || !isFinite(pMax)) return;
    const pad = (pMax - pMin) * 0.08 || 0.5;
    pMin -= pad; pMax += pad;
    const yFor = (p: number) => plotH - ((p - pMin) / (pMax - pMin)) * plotH;
    const pFor = (y: number) => pMin + ((plotH - y) / plotH) * (pMax - pMin);
    const dec = pMax < 50 ? 3 : 2;

    // ===== الشبكة: خطوط سعر مرتبة + خطوط وقت — 1px بلون Grid كالميتاتريدر =====
    ctx.strokeStyle = S.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const priceStep = niceStep((pMax - pMin) / 6);
    let p = Math.ceil(pMin / priceStep) * priceStep;
    const priceTicks: number[] = [];
    for (; p <= pMax; p += priceStep) { priceTicks.push(p); ctx.moveTo(0, Math.round(yFor(p)) + 0.5); ctx.lineTo(plotW, Math.round(yFor(p)) + 0.5); }
    // خطوة زمنية مرتبة: أقرب مضاعف زمني يعطي ≥ 75px بين الخطوط، والخطوط على أزمنة مستديرة
    const barDur = data.length > 1 ? data[data.length - 1].t - data[data.length - 2].t : 60e3;
    let tStep = TIME_STEPS[TIME_STEPS.length - 1];
    for (const s of TIME_STEPS) { if ((s / barDur) * v.spacing >= 75) { tStep = s; break; } }
    const timeTicks: { i: number; t: number; day: boolean }[] = [];
    for (let i = i0; i <= i1; i++) {
      const t = data[i].t;
      if (t % tStep === 0) timeTicks.push({ i, t, day: tStep >= 86400e3 });
    }
    // حماية للفريمات الكبيرة (D1/W1/MN) وأزمنة الوسيط غير المستديرة: شبكة بديلة على ترتيب الشموع
    if (!timeTicks.length) {
      const stepBars = Math.max(1, Math.ceil(75 / v.spacing));
      for (let i = i0; i <= i1; i++) if (i % stepBars === 0) timeTicks.push({ i, t: data[i].t, day: tStep >= 86400e3 });
    }
    for (const tt of timeTicks) { const x = Math.round(xFor(tt.i)) + 0.5; if (x >= 0 && x <= plotW) { ctx.moveTo(x, 0); ctx.lineTo(x, plotH); } }
    ctx.stroke();

    // ===== حجم التداول (Tick Volume) — أعمدة بلون Volumes الصلب أسفل الشارت كالميتاتريدر =====
    let vMax = 1;
    for (let i = i0; i <= i1; i++) vMax = Math.max(vMax, data[i].v ?? 1);
    const volH = plotH * 0.18;
    const bodyW = Math.max(1, Math.round(v.spacing - Math.max(1, v.spacing * 0.3)));
    const bwOff = Math.floor(bodyW / 2);
    ctx.fillStyle = S.vol;
    for (let i = i0; i <= i1; i++) {
      const d = data[i];
      const x = Math.round(xFor(i));
      const vh = Math.max(1, Math.round(((d.v ?? 1) / vMax) * volH));
      ctx.fillRect(x - bwOff, plotH - vh, bodyW, vh);
    }

    // ===== الشموع — خوارزمية MT5 الرسمية من توثيق MetaQuotes =====
    // الفتيل (tails) بلون Bar up/Bar down + جسم بتعبئة Bull/Bear candle وحواف 1px بلون Bar up/Bar down
    // (في Black on White / Color on White الجسم الصاعد بلون الخلفية → مجوّف بحدود واضحة كالطرفية تماماً)
    const minBody = 1;
    for (let i = i0; i <= i1; i++) {
      const d = data[i];
      const x = Math.round(xFor(i));
      const up = d.c >= d.o;
      const doji = Math.abs(d.c - d.o) < 0.005;
      const wickCol = doji ? S.line : (up ? S.barUp : S.barDown);
      const fillCol = doji ? S.line : (up ? S.bull : S.bear);
      // الفتيل (High→Low) — 1px في منتصف الشمعة تماماً كالميتاتريدر
      const yH = Math.round(yFor(d.h));
      const yL = Math.round(yFor(d.l));
      ctx.fillStyle = wickCol;
      ctx.fillRect(x, yH, 1, Math.max(1, yL - yH));
      // الجسم (Open→Close): صندوق بلون الحواف ثم تعبئة داخلية (تترك الإطار 1px ظاهراً)
      const yO = yFor(d.o), yC = yFor(d.c);
      const top = Math.min(yO, yC);
      const bh = Math.max(minBody, Math.round(Math.abs(yO - yC)));
      const bx = x - bwOff;
      if (bh <= minBody) {
        ctx.fillStyle = fillCol;
        ctx.fillRect(bx, Math.round(top), bodyW, 1); // دوجي/جسم صغير → خط 1px بلون التعبئة
      } else {
        ctx.fillStyle = wickCol;                     // الحواف (edges) بلون Bar up/down — المواصفة الرسمية
        ctx.fillRect(bx, Math.round(top), bodyW, bh);
        if (bodyW > 2 && bh > 2) {
          ctx.fillStyle = fillCol;                   // التعبئة الداخلية بلون Bull/Bear candle
          ctx.fillRect(bx + 1, Math.round(top) + 1, bodyW - 2, bh - 2);
        }
      }
    }

    // ===== خطوط EMA (اختيارية) =====
    if (showEma) {
      const drawLine = (arr: { t: number; v: number | null }[], color: string) => {
        ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath();
        let started = false;
        const tToI = new Map<number, number>();
        for (let i = i0; i <= i1; i++) tToI.set(data[i].t, i);
        for (const pt of arr) {
          const i = tToI.get(pt.t);
          if (i === undefined || pt.v === null) { started = false; continue; }
          const x = xFor(i), y = yFor(pt.v);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      drawLine(emaFast, S.emaFast);
      drawLine(emaSlow, S.emaSlow);
    }

    // ===== أسهم دخول الصفقات — أزرق شراء / أحمر بيع مع اسم الاستراتيجية (نمط MT5) =====
    const t0 = data[i0]?.t ?? 0, t1 = data[i1]?.t ?? 0;
    ctx.font = FONT_LABEL;
    for (const tr of trades) {
      if (tr.entryT < t0 || tr.entryT > t1) continue;
      // أقرب شمعة لزمن الدخول
      let idx = -1, best = Infinity;
      for (let i = i0; i <= i1; i++) { const dd = Math.abs(data[i].t - tr.entryT); if (dd < best) { best = dd; idx = i; } }
      if (idx < 0) continue;
      const d = data[idx];
      const x = Math.round(xFor(idx));
      const buy = tr.dir === 'buy';
      const col = buy ? S.buyArrow : S.sellArrow;
      const y = buy ? yFor(d.l) + 14 : yFor(d.h) - 14;
      ctx.fillStyle = col;
      ctx.beginPath();
      if (buy) { ctx.moveTo(x, y - 6); ctx.lineTo(x - 4.5, y + 2); ctx.lineTo(x + 4.5, y + 2); }
      else { ctx.moveTo(x, y + 6); ctx.lineTo(x - 4.5, y - 2); ctx.lineTo(x + 4.5, y - 2); }
      ctx.closePath();
      ctx.fill();
      const label = tr.strategy;
      if (label && v.spacing > 4) {
        const ty = buy ? y + 13 : y - 9;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = S.plate;
        ctx.fillRect(x - tw / 2 - 2, ty - 9, tw + 4, 12);
        ctx.fillStyle = col;
        ctx.textAlign = 'center';
        ctx.fillText(label, x, ty + 1);
        ctx.textAlign = 'left';
      }
    }

    // ===== خطوط المستويات — نمط MT5: دخول أزرق «sell 0.01 XAUUSD.m»، وقف أحمر «sl»، هدف أخضر «tp» =====
    ctx.font = FONT_LABEL;
    for (const lv of levels) {
      const y = Math.round(yFor(lv.price));
      if (y < -4 || y > plotH + 4) continue;
      const isStruct = lv.color === S.struct;
      ctx.strokeStyle = lv.color;
      ctx.lineWidth = 1;
      ctx.setLineDash(isStruct ? [2, 3] : [5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5); ctx.lineTo(plotW, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      // العنوان فوق الخط عند شمعة الصفقة إن كانت مرئية، وإلا عند يسار الشارت
      let lx = 6;
      if (lv.t) {
        let idx = -1, best = Infinity;
        for (let i = i0; i <= i1; i++) { const dd = Math.abs(data[i].t - lv.t); if (dd < best) { best = dd; idx = i; } }
        if (idx >= 0 && best <= barDur * 2) lx = Math.max(6, Math.min(plotW - 130, xFor(idx) + 6));
      }
      const tw = ctx.measureText(lv.title).width;
      ctx.fillStyle = S.plate;
      ctx.fillRect(lx - 3, y - 13, tw + 6, 12);
      ctx.fillStyle = lv.color;
      ctx.fillText(lv.title, lx, y - 3);
    }

    // ===== خط Bid المتقطع — يتحرك مع السعر الحي كالميتاتريدر =====
    const yBid = Math.round(yFor(bid));
    if (yBid >= 0 && yBid <= plotH) {
      ctx.strokeStyle = S.bid;
      ctx.lineWidth = 1;
      ctx.setLineDash([1, 3]);
      ctx.beginPath();
      ctx.moveTo(0, yBid + 0.5); ctx.lineTo(plotW, yBid + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ===== محور الأسعار يمين — خلفية الشارت + أرقام Tahoma بلون Foreground (قبل البطاقات كي تظهر فوقها) =====
    ctx.fillStyle = S.bg;
    ctx.fillRect(plotW, 0, AXIS_W, plotH);
    ctx.strokeStyle = S.axis;
    ctx.beginPath();
    ctx.moveTo(plotW + 0.5, 0); ctx.lineTo(plotW + 0.5, plotH);
    ctx.moveTo(0, plotH + 0.5); ctx.lineTo(plotW, plotH + 0.5);
    ctx.stroke();
    ctx.font = FONT;
    ctx.fillStyle = S.fg;
    for (const pt of priceTicks) {
      const y = Math.round(yFor(pt));
      if (y < 8 || y > plotH - 4) continue;
      ctx.fillText(pt.toFixed(dec), plotW + 6, y + 3.5);
    }
    // أزمنة المحور السفلي — التاريخ عند حدود اليوم كالميتاتريدر
    ctx.font = FONT;
    ctx.fillStyle = S.fg;
    for (const tt of timeTicks) {
      const x = Math.round(xFor(tt.i));
      if (x < 18 || x > plotW - 18) continue;
      const isMidnight = new Date(tt.t).getUTCHours() === 0 && new Date(tt.t).getUTCMinutes() === 0;
      const label = tt.day || isMidnight ? fmtDay(tt.t) : fmtTime(tt.t);
      ctx.textAlign = 'center';
      ctx.fillText(label, x, plotH + 14);
      ctx.textAlign = 'left';
    }

    // ===== بطاقة السعر الرمادية على المحور — فوق المحور تماماً كما في MT5 =====
    const yTag = Math.max(8, Math.min(plotH - 8, yBid));
    ctx.fillStyle = S.bidTagBg;
    ctx.fillRect(plotW, yTag - 9, AXIS_W, 18);
    ctx.fillStyle = S.bidTagText;
    ctx.font = FONT_TAG;
    ctx.textAlign = 'center';
    ctx.fillText(bid.toFixed(dec), plotW + AXIS_W / 2, yTag + 4);
    ctx.textAlign = 'left';

    // ===== التقاطع (Crosshair) — خطان منقّطان مع بطاقات السعر/الوقت فوق كل شيء (نمط MT5) =====
    const hv = hoverRef.current;
    if (hv && hv.x < plotW) {
      const hi = Math.round(idxFromX(hv.x));
      const hc = data[Math.max(0, Math.min(data.length - 1, hi))];
      ctx.strokeStyle = S.cross;
      ctx.lineWidth = 1;
      ctx.setLineDash([1, 2]);
      ctx.beginPath();
      const hx = Math.round(xFor(hi)) + 0.5;
      ctx.moveTo(hx, 0); ctx.lineTo(hx, plotH);
      if (hv.y <= plotH) { ctx.moveTo(0, Math.round(hv.y) + 0.5); ctx.lineTo(plotW, Math.round(hv.y) + 0.5); }
      ctx.stroke();
      ctx.setLineDash([]);
      // بطاقة السعر تحت المؤشر
      if (hv.y <= plotH) {
        const py = Math.max(8, Math.min(plotH - 8, hv.y));
        ctx.fillStyle = S.crossTagBg;
        ctx.fillRect(plotW, py - 9, AXIS_W, 18);
        ctx.fillStyle = S.crossTagText;
        ctx.font = FONT_TAG;
        ctx.textAlign = 'center';
        ctx.fillText(pFor(hv.y).toFixed(dec), plotW + AXIS_W / 2, py + 4);
      }
      // بطاقة الوقت أسفل المؤشر
      if (hc) {
        const label = tStep >= 86400e3 ? fmtDay(hc.t) : fmtTime(hc.t);
        const tw = ctx.measureText(label).width + 10;
        const tx = Math.max(2, Math.min(plotW - tw - 2, hx - tw / 2));
        ctx.fillStyle = S.crossTagBg;
        ctx.fillRect(tx, plotH, tw, TIME_H - 2);
        ctx.fillStyle = S.crossTagText;
        ctx.font = FONT_TAG;
        ctx.textAlign = 'center';
        ctx.fillText(label, tx + tw / 2, plotH + 14);
      }
      ctx.textAlign = 'left';
    }
  };

  // إعادة رسم عند تغير أي خاصية (مستويات/صفقات/EMA/شمعة حية/المخطط)
  useEffect(() => { requestDraw(); });

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // الصندوق يعرض الشمعة تحت المؤشر، وإلا آخر شمعة حية — منطق MT5
  const lastC = liveLast && (!candles.length || liveLast.t >= candles[candles.length - 1].t)
    ? liveLast
    : (candles.length ? candles[candles.length - 1] : null);
  const box = hovered ?? (lastC ? { o: lastC.o, h: lastC.h, l: lastC.l, c: lastC.c, time: lastC.t, v: lastC.v } : null);
  const up = box ? box.c >= box.o : true;

  return (
    <div ref={wrapRef} className="relative w-full h-full min-h-0" style={{ backgroundColor: S.bg }}>
      <canvas ref={canvasRef} className="block w-full h-full" />
      {/* أزرار التكبير — أسلوب MT5: + / − / عرض افتراضي */}
      <div className="absolute top-2 right-16 z-10 flex flex-col gap-1" dir="ltr">
        <button onClick={() => zoomBy(1.3)} title="تكبير — شموع أكبر وأوضح"
          className="w-7 h-7 rounded-md border border-[#3a3a3a] bg-[#111111]/90 text-[#c0c0c0] hover:text-white hover:border-[#5a5a5a] transition-colors flex items-center justify-center shadow-lg">
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => zoomBy(1 / 1.3)} title="تصغير — رؤية أوسع"
          className="w-7 h-7 rounded-md border border-[#3a3a3a] bg-[#111111]/90 text-[#c0c0c0] hover:text-white hover:border-[#5a5a5a] transition-colors flex items-center justify-center shadow-lg">
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button onClick={resetView} title="العودة للعرض الافتراضي"
          className="w-7 h-7 rounded-md border border-[#3a3a3a] bg-[#111111]/90 text-[#c0c0c0] hover:text-white hover:border-[#5a5a5a] transition-colors flex items-center justify-center shadow-lg">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* سطر المعلومات العلوي بأسلوب MT5: الرمز والفريم ثم OHLC + V بلون النص الأمامي الرسمي */}
      {box && (
        <div className="absolute top-1.5 left-2 z-10 pointer-events-none select-none" dir="ltr"
          style={{ textShadow: S.dark ? '0 1px 2px rgba(0,0,0,0.9)' : '0 1px 2px rgba(255,255,255,0.8)' }}>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold" style={{ color: S.fg, fontFamily: 'Tahoma, sans-serif' }}>
              XAUUSD.m,{MT5_TF[tfLabel ?? ''] ?? (tfLabel ?? '')}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5" style={{ fontFamily: 'Tahoma, sans-serif' }}>
            <span className="text-[10.5px]" style={{ color: S.fg }}>O <b>{box.o.toFixed(2)}</b></span>
            <span className="text-[10.5px]" style={{ color: S.fg }}>H <b>{box.h.toFixed(2)}</b></span>
            <span className="text-[10.5px]" style={{ color: S.fg }}>L <b>{box.l.toFixed(2)}</b></span>
            <span className="text-[10.5px]" style={{ color: S.fg }}>C <b>{box.c.toFixed(2)}</b></span>
            {box.v !== undefined && <span className="text-[10.5px]" style={{ color: S.fg }}>V <b>{box.v.toLocaleString('en-US')}</b></span>}
          </div>
        </div>
      )}
    </div>
  );
}
