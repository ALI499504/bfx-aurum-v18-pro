// ============================================================
// محرك الهيكل السوقي — Market Structure Core Engine
// الجزء الأول حتى الخامس من الدليل:
// HH/HL/LH/LL، القمم والقيعان الحقيقية، BOS/CHoCH،
// سيناريو التحقق بعد التصحيح، سيناريو الاندفاع والامبالانس،
// فلاتر الضجيج، وكشف التجميع (Consolidation)
// ============================================================
import { Candle, Consolidation, Dir, RealKind, RealPivot, StructureEvent, Swing, TF, TF_MS, pips } from './types';
import { atr, hasFVG, isImpulsive, sma } from './indicators';

// ---------- اكتشاف القمم والقيعان (Pivots) ----------
/** pivot = قمة/قاع محيطية تُعرف فقط بعد k شموع لاحقة (بلا تسلل مستقبلي) */
export function findPivots(c: Candle[], k = 2): Swing[] {
  const out: Swing[] = [];
  for (let i = k; i < c.length - k; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (c[j].h >= c[i].h) isHigh = false;
      if (c[j].l <= c[i].l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ tf: '1h' as TF, kind: 'high', price: c[i].h, idx: i, t: c[i].t, confirmedAt: c[i + k].t + TF_MS['1h'] });
    if (isLow) out.push({ tf: '1h' as TF, kind: 'low', price: c[i].l, idx: i, t: c[i].t, confirmedAt: c[i + k].t + TF_MS['1h'] });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function findPivotsTF(c: Candle[], tf: TF, k = 2): Swing[] {
  return findPivots(c, k).map(p => ({ ...p, tf, confirmedAt: c[p.idx + k].t + TF_MS[tf] }));
}

export interface StructureAnalysis {
  pivots: Swing[];
  realPivots: RealPivot[];
  events: StructureEvent[];
  trendTimeline: { t: number; trend: Dir }[];
}

/**
 * تحليل هيكل كامل لفريم معين (يُستخدم أساساً على 1h و4h).
 * كل حدث يحمل confirmedAt = وقت إغلاق الشمعة المؤكدة (بلا lookahead).
 */
export function analyzeStructure(c: Candle[], tf: TF = '1h'): StructureAnalysis {
  const ms = TF_MS[tf];
  const pivots = findPivotsTF(c, tf, 2);
  const realPivots: RealPivot[] = [];
  const events: StructureEvent[] = [];
  const trendTimeline: { t: number; trend: Dir }[] = [];
  const setTrend = (d: Dir, t: number) => { if (S.trend !== d) { S.trend = d; trendTimeline.push({ t, trend: d }); } };
  const a = atr(c, 14);
  const volSma = sma(c.map(x => x.v), 20);

  const S: { trend: Dir } = { trend: 'range' };
  let mainHigh: { price: number; t: number } | null = null;   // آخر قمة رئيسية مرشحة
  let mainLow: { price: number; t: number } | null = null;    // آخر قاع رئيسي مرشح
  let pivotPtr = 0;
  // حالة سيناريو التحقق (قلب الاتجاه بعد تصحيح)
  let pendingFlip: Dir | null = null;
  let flipExtreme: { price: number; t: number } | null = null; // القاع/القمة الجديد بعد خطوة 1
  let correctionSwing: Swing | null = null;                    // قمة التصحيح (LH) أو قاعه (HL)

  const confirmReal = (kind: RealKind, price: number, t: number, confirmedAt: number) => {
    realPivots.push({ kind, tf, price, t, confirmedAt, trendAtConfirm: S.trend === 'range' ? 'up' : S.trend });
  };

  for (let i = 0; i < c.length; i++) {
    const bar = c[i];
    const closeT = bar.t + ms;

    // 1) إدخال المحاور المؤكدة حتى هذا الإغلاق
    while (pivotPtr < pivots.length && pivots[pivotPtr].confirmedAt <= closeT) {
      const p = pivots[pivotPtr];
      if (p.kind === 'high') {
        if (!mainHigh || p.t > (mainHigh.t ?? 0)) { /* تحديث مرشح */ }
        mainHigh = { price: p.price, t: p.t };
      } else {
        mainLow = { price: p.price, t: p.t };
      }
      // تتبع محور التصحيح في حالة فرضية القلب
      if (pendingFlip === 'down' && p.kind === 'high' && (!correctionSwing || p.t > correctionSwing.t)) {
        correctionSwing = p; // قمة التصحيح بعد كسر القاع (مرشحة LH)
      }
      if (pendingFlip === 'up' && p.kind === 'low' && (!correctionSwing || p.t > correctionSwing.t)) {
        correctionSwing = p; // قاع التصحيح بعد كسر القمة (مرشح HL)
      }
      pivotPtr++;
    }

    // 2) تتبع القاع/القمة الجديد بعد خطوة 1 من سيناريو التحقق
    if (pendingFlip === 'down') {
      if (!flipExtreme || bar.l < flipExtreme.price) flipExtreme = { price: bar.l, t: bar.t };
      // خطوة 3: كسر القاع الجديد بإغلاق جسم تحته مع وجود قمة تصحيح
      if (correctionSwing && bar.c < flipExtreme.price) {
        setTrend('down', closeT);
        confirmReal('LL', flipExtreme.price, flipExtreme.t, closeT);
        confirmReal('LH', correctionSwing.price, correctionSwing.t, closeT);
        events.push({ type: 'BOS', tf, dir: 'down', level: flipExtreme.price, t: closeT });
        pendingFlip = null; flipExtreme = null; correctionSwing = null;
        mainLow = { price: realPivots[realPivots.length - 2].price, t: realPivots[realPivots.length - 2].t };
        mainHigh = { price: realPivots[realPivots.length - 1].price, t: realPivots[realPivots.length - 1].t };
        continue;
      }
    } else if (pendingFlip === 'up') {
      if (!flipExtreme || bar.h > flipExtreme.price) flipExtreme = { price: bar.h, t: bar.t };
      if (correctionSwing && bar.c > flipExtreme.price) {
        setTrend('up', closeT);
        confirmReal('HH', flipExtreme.price, flipExtreme.t, closeT);
        confirmReal('HL', correctionSwing.price, correctionSwing.t, closeT);
        events.push({ type: 'BOS', tf, dir: 'up', level: flipExtreme.price, t: closeT });
        pendingFlip = null; flipExtreme = null; correctionSwing = null;
        mainHigh = { price: realPivots[realPivots.length - 2].price, t: realPivots[realPivots.length - 2].t };
        mainLow = { price: realPivots[realPivots.length - 1].price, t: realPivots[realPivots.length - 1].t };
        continue;
      }
    }

    if (!mainHigh || !mainLow) continue;

    const impulsiveDown = isImpulsive(bar, a[i]) && (volSma[i] ? bar.v > 1.5 * volSma[i] : true);
    const fvgDown = i >= 2 && hasFVG(c[i - 2], c[i - 1], c[i], 'down');
    const impulsiveUp = isImpulsive(bar, a[i]) && (volSma[i] ? bar.v > 1.5 * volSma[i] : true);
    const fvgUp = i >= 2 && hasFVG(c[i - 2], c[i - 1], c[i], 'up');

    // 3) إغلاق جسم فوق القمة الرئيسية → اعتماد HH + HL جديد
    if (bar.c > mainHigh.price) {
      if (S.trend === 'down') {
        // كسر قمة رئيسية أثناء ترند هابط: فرضية سحب سيولة أو قلب اندفاعي
        if (impulsiveUp && fvgUp) {
          // السيناريو الثاني: اختراق اندفاعي حاد مع امبالانس → قلب فوري
          setTrend('up', closeT);
          confirmReal('HH', mainHigh.price, mainHigh.t, closeT);
          events.push({ type: 'BOS', tf, dir: 'up', level: mainHigh.price, t: closeT, fvg: true });
          mainLow = { price: Math.min(bar.l, mainLow.price), t: bar.t };
          pendingFlip = null; flipExtreme = null; correctionSwing = null;
        } else if (pendingFlip !== 'up') {
          events.push({ type: 'CHoCH', tf, dir: 'up', level: mainHigh.price, t: closeT });
          pendingFlip = 'up'; flipExtreme = null; correctionSwing = null;
        }
      } else {
        // ترند صاعد/عرضي: BOS + اعتماد القاع الأخير كـ HL والقمة المكسورة كـ HH
        const lastLowBefore = latestPivotBefore(pivots, pivotPtr, 'low', bar.t);
        setTrend('up', closeT);
        confirmReal('HH', mainHigh.price, mainHigh.t, closeT);
        if (lastLowBefore) confirmReal('HL', lastLowBefore.price, lastLowBefore.t, closeT);
        events.push({ type: 'BOS', tf, dir: 'up', level: mainHigh.price, t: closeT, fvg: impulsiveUp && fvgUp });
        pendingFlip = null; flipExtreme = null; correctionSwing = null;
      }
      mainHigh = { price: Math.max(bar.h, mainHigh.price), t: bar.t };
      continue;
    }

    // 4) إغلاق جسم تحت القاع الرئيسي → اعتماد LL + LH جديد
    if (bar.c < mainLow.price) {
      if (S.trend === 'up') {
        if (impulsiveDown && fvgDown) {
          setTrend('down', closeT);
          confirmReal('LL', mainLow.price, mainLow.t, closeT);
          events.push({ type: 'BOS', tf, dir: 'down', level: mainLow.price, t: closeT, fvg: true });
          mainHigh = { price: Math.max(bar.h, mainHigh.price), t: bar.t };
          pendingFlip = null; flipExtreme = null; correctionSwing = null;
        } else if (pendingFlip !== 'down') {
          events.push({ type: 'CHoCH', tf, dir: 'down', level: mainLow.price, t: closeT });
          pendingFlip = 'down'; flipExtreme = null; correctionSwing = null;
        }
      } else {
        const lastHighBefore = latestPivotBefore(pivots, pivotPtr, 'high', bar.t);
        setTrend('down', closeT);
        confirmReal('LL', mainLow.price, mainLow.t, closeT);
        if (lastHighBefore) confirmReal('LH', lastHighBefore.price, lastHighBefore.t, closeT);
        events.push({ type: 'BOS', tf, dir: 'down', level: mainLow.price, t: closeT, fvg: impulsiveDown && fvgDown });
        pendingFlip = null; flipExtreme = null; correctionSwing = null;
      }
      mainLow = { price: Math.min(bar.l, mainLow.price), t: bar.t };
      continue;
    }

    // 5) سحب السيولة بالذيل فقط (فلتر الضجيج): ملامسة بالذيل دون إغلاق
    if (S.trend === 'up' && bar.l < mainLow.price) {
      events.push({ type: 'liquidity_sweep', tf, dir: 'down', level: mainLow.price, t: closeT });
    } else if (S.trend === 'down' && bar.h > mainHigh.price) {
      events.push({ type: 'liquidity_sweep', tf, dir: 'up', level: mainHigh.price, t: closeT });
    }
  }

  return { pivots, realPivots, events, trendTimeline };
}

function latestPivotBefore(pivots: Swing[], ptr: number, kind: 'high' | 'low', t: number): Swing | null {
  for (let i = ptr - 1; i >= 0; i--) {
    if (pivots[i].kind === kind && pivots[i].t < t) return pivots[i];
  }
  return null;
}

// ---------- كشف التجميع (الجزء الخامس) ----------
export const CONS_WINDOW_15M = 16;      // 16 × 15د = 4 ساعات
export const CONS_MAX_RANGE_PIPS = 150; // أقصى نطاق عرضي للتجميع

export function detectConsolidations(c15: Candle[]): Consolidation[] {
  const out: Consolidation[] = [];
  let inZone: Consolidation | null = null;
  for (let i = CONS_WINDOW_15M - 1; i < c15.length; i++) {
    const wStart = i - CONS_WINDOW_15M + 1;
    let top = -Infinity, bottom = Infinity;
    for (let j = wStart; j <= i; j++) { top = Math.max(top, c15[j].h); bottom = Math.min(bottom, c15[j].l); }
    const rangePips = (top - bottom) / 0.1;

    if (!inZone) {
      if (rangePips <= CONS_MAX_RANGE_PIPS) {
        inZone = { top, bottom, startT: c15[wStart].t, stillInside: true };
      }
    } else {
      const bar = c15[i];
      if (bar.c > inZone.top) {
        inZone.broken = 'up'; inZone.brokenAt = bar.t + TF_MS['15m'];
        inZone.extensionPips = (bar.c - inZone.top) / 0.1;
        inZone.stillInside = false; inZone.endT = bar.t + TF_MS['15m'];
        out.push(inZone); inZone = null;
      } else if (bar.c < inZone.bottom) {
        inZone.broken = 'down'; inZone.brokenAt = bar.t + TF_MS['15m'];
        inZone.extensionPips = (inZone.bottom - bar.c) / 0.1;
        inZone.stillInside = false; inZone.endT = bar.t + TF_MS['15m'];
        out.push(inZone); inZone = null;
      } else {
        // تحديث الحدود الداخلية (قمم وقيعان داخلية)
        inZone.top = Math.max(inZone.top, bar.h);
        inZone.bottom = Math.min(inZone.bottom, bar.l);
      }
    }
  }
  return out;
}

// ---------- مرساة فيبوناتشي الرئيسية (الاستراتيجية K) ----------
export interface FibAnchor {
  tf: TF;
  dir: 'up' | 'down';
  low: number; high: number;
  anchorLowT: number; anchorHighT: number;
  knownAt: number; // وقت تأكيد الموجة الدافعة (BOS)
  touched: Record<string, boolean>;
}

/**
 * تحديد القاع/القمة الرئيسية وإسقاط فيبوناتشي على فريم كبير.
 * القاع الرئيسي: انطلقت منه موجة كسرت آخر قمة رئيسية بإغلاق صريح (BOS).
 */
export function findFibAnchors(c: Candle[], tf: TF, ratios: number[]): FibAnchor[] {
  const ms = TF_MS[tf];
  const pivots = findPivotsTF(c, tf, 2);
  const anchors: FibAnchor[] = [];
  let ptr = 0;
  let lastMajorHigh: Swing | null = null;
  let lastMajorLow: Swing | null = null;
  let runningLow: Swing | null = null;
  let runningHigh: Swing | null = null;

  for (let i = 0; i < c.length; i++) {
    const bar = c[i];
    const closeT = bar.t + ms;
    while (ptr < pivots.length && pivots[ptr].confirmedAt <= closeT) {
      const p = pivots[ptr++];
      if (p.kind === 'high') { lastMajorHigh = p; runningHigh = p; }
      else { lastMajorLow = p; runningLow = p; }
    }
    if (!lastMajorHigh || !lastMajorLow) continue;
    if (bar.c > lastMajorHigh.price) {
      // موجة دافعة صاعدة من القاع الأخير → مرساة صاعدة
      const lo = runningLow && runningLow.t > lastMajorLow.t ? runningLow : lastMajorLow;
      anchors.push({ tf, dir: 'up', low: lo.price, high: Math.max(bar.h, lastMajorHigh.price), anchorLowT: lo.t, anchorHighT: lastMajorHigh.t, knownAt: closeT, touched: {} });
      lastMajorLow = { ...lastMajorHigh, kind: 'low', price: bar.l } as Swing; // إعادة ضبط تقريبية
      runningHigh = null; runningLow = null;
    } else if (bar.c < lastMajorLow.price) {
      const hi = runningHigh && runningHigh.t > lastMajorHigh.t ? runningHigh : lastMajorHigh;
      anchors.push({ tf, dir: 'down', low: Math.min(bar.l, lastMajorLow.price), high: hi.price, anchorLowT: lastMajorLow.t, anchorHighT: hi.t, knownAt: closeT, touched: {} });
      lastMajorHigh = { ...lastMajorLow, kind: 'high', price: bar.h } as Swing;
      runningHigh = null; runningLow = null;
    }
  }
  void ratios;
  return anchors;
}

export function fibLevel(a: FibAnchor, ratio: number): number {
  return a.dir === 'up' ? a.high - (a.high - a.low) * ratio : a.low + (a.high - a.low) * ratio;
}
