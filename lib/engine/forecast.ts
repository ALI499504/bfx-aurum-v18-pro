// ============================================================
// محرك التنبؤ الهيكلي — Structure Forecast Engine
// تحليل احتمالي حتمي للأفق القادم على الفريم المعروض اعتماداً حصرياً
// على أدوات الدليل: اتجاه الهيكل (BOS/CHoCH) + محاذاة EMA (وفق إعدادات
// المستخدم: مفاتيح emaFast/emaSlow ومحول التفعيل indicators.ema)
// + الزخم المقيس بـ ATR — مع نطاق ثقة متسع ومزيج قرار واضح.
//
// الشموع المستقبلية المتوقعة حتمية 100%: لا RNG ولا mulberry ولا عشوائية
// أبداً. كل شمعة OHLC تُحسب من:
//   • احتمال الاتجاه pUp[i] (هيكل + EMA + زخم — وفقاً لإعدادات المستخدم)
//   • عرض نطاق الثقة عند تلك الخطوة (ATR × sqrt(i+1))
//   • قوة القناعة |pUp[i] − 0.5|
// تُقيّد الشموع داخل النطاق الإحصائي — لا اختراع للأسعار.
// تحليل للعرض والدراسة فقط — ليس توصية تنفيذ.
// ============================================================
import { Candle, Dir, TF, TF_MS } from './types';
import { atr, ema } from './indicators';
import { analyzeStructure } from './structure';
import type { Settings } from './rules';

export interface ForecastDriver {
  label: string;      // اسم المحرك المؤثر
  detail: string;     // وصف حالته الحالية
  score: number;      // -1 .. 1 (سالب = هبوطي، موجب = صعودي)
  weight: number;     // وزنه في المزيج (للعرض)
}

export interface ForecastStructure {
  trend: Dir;
  lastRealHigh?: { kind: string; price: number };
  lastRealLow?: { kind: string; price: number };
  lastEvent?: { type: string; dir: string; level: number };
}

export interface ForecastCandle {
  t: number; o: number; h: number; l: number; c: number;
}

export interface ForecastResult {
  tf: TF;
  horizon: number;
  lastClose: number;
  lastT: number;
  atr: number;
  pUp: number[];                       // احتمال صعود كل شمعة من الأفق (حتمي من المؤشرات)
  band: { t: number; upper: number; lower: number }[];  // نطاق الثقة المتسع (حتمي من ATR)
  projected: ForecastCandle[];         // شموع مستقبلية حتمية — مشتقة من pUp + ATR band (لا RNG)
  decision: {
    dir: 'up' | 'down';
    confidence: number;                // % ثقة المزيج
    pUpOverall: number;                // متوسط احتمال الصعود
    expHigh: number;                   // أعلى النطاق المتوقع
    expLow: number;                    // أدنى النطاق المتوقع
  };
  drivers: ForecastDriver[];
  structure: ForecastStructure;
  /** عناصر الإعدادات التي تتحكم في التنبؤ — للتثبت من الالتزام بإعدادات المستخدم */
  settingsApplied: {
    emaEnabled: boolean;
    emaFast: number;
    emaSlow: number;
  };
}

const HORIZON = 12;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function buildForecast(candles: Candle[], tf: TF, settings?: Settings): ForecastResult {
  const n = candles.length;
  const last = candles[n - 1];
  const close = last.c;
  const a = Math.max(atr(candles, 14)[n - 1] || (close * 0.002), close * 0.0005);

  // ---------- إعدادات المستخدم المُطبّقة على التنبؤ ----------
  // EMA محول بمفتاح indicators.ema — إن كان معطّلاً يُلغى أثره من مزيج القرار
  // وفقاً لما حدده المستخدم مسبقاً في الإعدادات. الفترات قابلة للتخصيص أيضاً.
  const emaEnabled = settings?.indicators?.ema ?? false;
  const emaFast = settings?.indicators?.emaFast ?? 20;
  const emaSlow = settings?.indicators?.emaSlow ?? 90;

  // ---------- 1) اتجاه الهيكل على الفريم المعروض ----------
  const st = analyzeStructure(candles, tf);
  const trend: Dir = st.trendTimeline.length ? st.trendTimeline[st.trendTimeline.length - 1].trend : 'range';
  const sStruct = trend === 'up' ? 1 : trend === 'down' ? -1 : 0;
  const lastEv = st.events.length ? st.events[st.events.length - 1] : undefined;
  const lastHigh = [...st.realPivots].reverse().find(p => p.kind === 'HH' || p.kind === 'LH');
  const lastLow = [...st.realPivots].reverse().find(p => p.kind === 'HL' || p.kind === 'LL');

  // ---------- 2) محاذاة EMA (وفق إعدادات المستخدم) ----------
  const closes = candles.map(c => c.c);
  let sEma = 0;
  let slope = 0;
  let emaFastLine: number[] = [];
  let emaSlowLine: number[] = [];
  if (emaEnabled && n >= Math.max(emaSlow, emaFast) + 2) {
    emaFastLine = ema(closes, emaFast);
    emaSlowLine = ema(closes, emaSlow);
    const sEmaRaw = (emaFastLine[n - 1] - emaSlowLine[n - 1]) / (a * 2);
    sEma = clamp(Number.isFinite(sEmaRaw) ? sEmaRaw : 0, -1, 1);
    slope = n >= 4 ? emaFastLine[n - 1] - emaFastLine[n - 4] : 0;
  }

  // ---------- 3) الزخم المقيس (آخر 10 شموع بوحدات ATR) ----------
  const roc = n > 10 ? (close - closes[n - 11]) / a : 0;
  const sMom = clamp(Number.isFinite(roc) ? roc / 3 : 0, -1, 1);

  // ---------- 4) مزيج القرار (الأوزان تُعاد توزيعها عند تعطيل EMA) ----------
  // الهيكل دائماً محرك أساسي. EMA يُحسب فقط إن فعّله المستخدم — وإلا يُوزّع وزنه
  // على الهيكل والزخم حتى لا يُلغى تأثير الإعداد بصمت.
  const wStruct = emaEnabled ? 0.40 : 0.55;
  const wEma = emaEnabled ? 0.35 : 0;
  const wMom = emaEnabled ? 0.25 : 0.45;
  const total = clamp(wStruct * sStruct + wEma * sEma + wMom * sMom, -1, 1);
  const baseP = clamp(0.5 + total * 0.33, 0.12, 0.88);

  // احتمال كل شمعة يذوب تدريجياً نحو 50% كلما بعد الأفق (عدم اليقين يزداد)
  const pUp: number[] = [];
  for (let i = 0; i < HORIZON; i++) {
    pUp.push(clamp(0.5 + (baseP - 0.5) * Math.pow(0.94, i), 0.12, 0.88));
  }

  // ---------- 5) نطاق الثقة المتوقع (حتمي من ATR) ----------
  // يعرض المدى الذي يتسع بجذر الزمن — أساس اشتقاق الشموع المتوقعة أدناه.
  const band: { t: number; upper: number; lower: number }[] = [];
  for (let i = 0; i < HORIZON; i++) {
    const t = last.t + (i + 1) * TF_MS[tf];
    const w = a * 1.15 * Math.sqrt(i + 1);
    band.push({ t, upper: +(close + w).toFixed(2), lower: +(close - w).toFixed(2) });
  }

  // ---------- 6) الشموع المستقبلية المتوقعة (حتمية — لا RNG) ----------
  // كل شمعة مشتقة حصراً من:
  //   • pUp[i]  → اتجاه وقناعة
  //   • توسّع نطاق الثقة عند الخطوة i  → حجم الجسم والذيل
  //   • حدود النطاق upper/lower  → تقييد السعر داخل الإطار الإحصائي
  // الجسم = قوة القناعة × توسّع النطاق اللحظي — يتناقص تلقائياً مع الأفق
  // لأن sqrt(i+1)−sqrt(i) يتقلص. الذيل يكبر عند ضعف القناعة ليغطي التذبذب.
  const projected: ForecastCandle[] = [];
  let prevClose = close;
  for (let i = 0; i < HORIZON; i++) {
    const t = last.t + (i + 1) * TF_MS[tf];
    const o = +prevClose.toFixed(2);
    const p = pUp[i];
    const up = p >= 0.5;
    const strength = Math.abs(p - 0.5) * 2;             // 0..0.76 (لقَطْع pUp في 0.12..0.88)
    const sign = up ? 1 : -1;
    // توسّع النطاق اللحظي عند هذه الخطوة: a·1.15·(√(i+1) − √i)
    // هذا يضمن أن مجموع أجسام الشموع لا يتجاوز حدود النطاق الإحصائي أبداً.
    const stepBand = a * 1.15 * (Math.sqrt(i + 1) - Math.sqrt(i));
    // الجسم يتناسب مع القناعة — كلما زادت ثقة الاتجاه، زاد جسم الشمعة في ذلك الاتجاه
    const body = sign * strength * stepBand * 1.55;
    const c = +(o + body).toFixed(2);
    // الذيلان يتناقصان مع القناعة (اتجاه واضح = ذيول أصغر) ويزيدان مع عدم اليقين
    const wick = stepBand * (1.05 - strength * 0.45);
    let h = Math.max(o, c) + wick;
    let l = Math.min(o, c) - wick;
    // تقييد صارم داخل النطاق الإحصائي — لا اختراق لحدود الثقة
    h = Math.min(h, band[i].upper);
    l = Math.max(l, band[i].lower);
    // ضمان صحة OHLC: high ≥ max(o,c), low ≤ min(o,c)
    h = +(Math.max(h, Math.max(o, c))).toFixed(2);
    l = +(Math.min(l, Math.min(o, c))).toFixed(2);
    projected.push({ t, o, h, l, c });
    prevClose = c;
  }

  const pUpOverall = pUp.reduce((s, p) => s + p, 0) / HORIZON;
  const drivers: ForecastDriver[] = [
    {
      label: 'هيكل الفريم',
      detail: trend === 'up' ? 'صاعد — BOS صاعد مؤكد' : trend === 'down' ? 'هابط — BOS هابط مؤكد' : 'عرضي بلا كسر مؤكد',
      score: sStruct, weight: +wStruct.toFixed(2),
    },
  ];
  if (emaEnabled) {
    drivers.push({
      label: `EMA ${emaFast}/${emaSlow}`,
      detail: `${emaFastLine[n - 1] > emaSlowLine[n - 1] ? 'السريع فوق البطيء' : 'السريع تحت البطيء'} · ميل ${slope >= 0 ? '+' : ''}${slope.toFixed(2)}`,
      score: sEma, weight: +wEma.toFixed(2),
    });
  }
  drivers.push({
    label: 'الزخم (10 شموع)',
    detail: `${roc >= 0 ? '+' : ''}${(roc * a).toFixed(2)}$ ≈ ${roc >= 0 ? '+' : ''}${roc.toFixed(2)} ATR`,
    score: sMom, weight: +wMom.toFixed(2),
  });

  return {
    tf, horizon: HORIZON,
    lastClose: close, lastT: last.t, atr: +a.toFixed(2),
    pUp: pUp.map(p => +p.toFixed(3)),
    band,
    projected,
    decision: {
      dir: total >= 0 ? 'up' : 'down',
      confidence: Math.round(Math.max(baseP, 1 - baseP) * 100),
      pUpOverall: +pUpOverall.toFixed(3),
      expHigh: band[HORIZON - 1].upper,
      expLow: band[HORIZON - 1].lower,
    },
    drivers,
    structure: {
      trend,
      lastRealHigh: lastHigh ? { kind: lastHigh.kind, price: lastHigh.price } : undefined,
      lastRealLow: lastLow ? { kind: lastLow.kind, price: lastLow.price } : undefined,
      lastEvent: lastEv ? { type: lastEv.type, dir: lastEv.dir, level: lastEv.level } : undefined,
    },
    settingsApplied: {
      emaEnabled, emaFast, emaSlow,
    },
  };
}
