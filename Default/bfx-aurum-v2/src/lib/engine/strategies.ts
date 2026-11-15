// ============================================================
// كاشفات الاستراتيجيات A - O وفق الدليل البرمجي
// كل كاشف ينتج أحداث إشارة (SignalEvent) مع knownAt
// (لحظة اكتمال الشروط — بلا تسلل مستقبلي)
// ============================================================
import { Candle, Consolidation, Dir, SessionId, Setup, StrategyId, Swing, TF, TF_MS, pips } from './types';
import { STRATEGY_RANK } from './types';
import { atr, hasFVG, isImpulsive } from './indicators';
import { FibAnchor, fibLevel, findFibAnchors, findPivotsTF } from './structure';
import { syriaDayNum, syriaHour } from './sessions';

export interface SignalEvent {
  strategy: StrategyId;
  dir: 'buy' | 'sell';
  entry: number;        // سعر أمر الدخول المعلق
  slPips: number;       // الوقف بالبيب (قبل حدود 10-15$)
  refLevel: number;
  knownAt: number;      // وقت إتاحة الإشارة
  reason: string;
  fibConfirmed?: boolean;
  market?: boolean;     // تنفيذ فوري بسعر السوق (كل الاستراتيجيات — الدخول المباشر بطلب المستخدم)
  setup?: 'A' | 'B';    // تسمية المواصفة: A = الرفض، B = الكسر وإعادة الاختبار (استراتيجية E)
  slAnchor?: number;    // وقف مطلق مثبت بالقاعدة (E: قمة/قاع شمعة التأكيد ±1$) — لا يُعدّل بحدود عامة
  ttlHours?: number;    // مدة صلاحية الأمر المعلق
}

export interface DetectorsInput {
  c5: Candle[]; c15: Candle[]; c30: Candle[]; c1h: Candle[]; c4h: Candle[]; c1d: Candle[]; c1w: Candle[]; c1M: Candle[];
  cons15: Consolidation[];
  fibD: FibAnchor[]; fib4h: FibAnchor[]; fibW: FibAnchor[];
  trend1h: { t: number; trend: Dir }[];
  trend4h: { t: number; trend: Dir }[];
}

const trendAt = (tl: { t: number; trend: Dir }[], t: number): Dir => {
  let d: Dir = 'range';
  for (const p of tl) { if (p.t <= t) d = p.trend; else break; }
  return d;
};

/** أدنى/أعلى مسافة اقتراب من المستوى لإطلاق إشارة إعادة الاختبار */
const TRIG = 100 / 10; // 100 بيب افتراضياً ($10)

// ------------------------------------------------------------
// A: إعادة اختبار كسر التجميع (50-400 بيب) — حرفياً وفق الدليل:
// دخول قبل خط النطاق بـ30 بيب + وقف 80 بيب خلف الخط (أي 110 بيب من سعر الدخول)
// ------------------------------------------------------------
export function detectA(inp: DetectorsInput): SignalEvent[] {
  const out: SignalEvent[] = [];
  for (const z of inp.cons15) {
    if (!z.broken || z.extensionPips === undefined || z.brokenAt === undefined) continue;
    if (z.extensionPips < 50 || z.extensionPips > 400) continue; // خارج نطاق الامتداد → إلغاء
    const up = z.broken === 'up';
    const entry = up ? z.top + pips(30) : z.bottom - pips(30);
    const slPips = 110; // 30 (قبل الخط) + 80 (خلف الخط) وفق الدليل
    out.push({
      strategy: 'A', dir: up ? 'buy' : 'sell', entry, slPips,
      refLevel: up ? z.top : z.bottom, knownAt: z.brokenAt,
      reason: `كسر تجميع (4 ساعات+) بامتداد ${Math.round(z.extensionPips)} بيب — دخول فوري بسعر السوق لحظة اكتمال شروط الاستراتيجية، وقف 110 بيب من سعر الدخول الفعلي`,
      ttlHours: 24,
    });
  }
  return out;
}

// ------------------------------------------------------------
// B: التلاعب والاختراق الثاني (اختراق كاذب)
// ------------------------------------------------------------
export function detectB(inp: DetectorsInput, preTrend: Map<number, Dir>): SignalEvent[] {
  const out: SignalEvent[] = [];
  const zones = inp.cons15.filter(z => z.broken && z.brokenAt);
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (!z.broken || !z.brokenAt) continue;
    // بحث عن اختراق مقابل من الجهة المقابلة خلال 48 ساعة من الكسر الأول
    let second: { dir: 'up' | 'down'; t: number; ext: number } | null = null;
    const windowEnd = z.brokenAt + 48 * 3600e3;
    for (const bar of inp.c15) {
      if (bar.t + TF_MS['15m'] <= z.brokenAt!) continue;
      if (bar.t > windowEnd) break;
      if (z.broken === 'up' && bar.c < z.bottom) { second = { dir: 'down', t: bar.t + TF_MS['15m'], ext: (z.bottom - bar.c) / 0.1 }; break; }
      if (z.broken === 'down' && bar.c > z.top) { second = { dir: 'up', t: bar.t + TF_MS['15m'], ext: (bar.c - z.top) / 0.1 }; break; }
    }
    if (!second || second.ext < 50) continue;
    // الشرط الحاسم: الاختراق الثاني باتجاه الترند السابق للتجميع
    const pre = preTrend.get(z.startT) ?? 'range';
    if (pre === 'range') continue;
    const dirMatch = (pre === 'up' && second.dir === 'up') || (pre === 'down' && second.dir === 'down');
    if (!dirMatch) continue;
    const sell = second.dir === 'down';
    const entry = sell ? z.bottom - pips(30) : z.top + pips(30);
    out.push({
      strategy: 'B', dir: sell ? 'sell' : 'buy', entry, slPips: 100,
      refLevel: sell ? z.bottom : z.top, knownAt: second.t,
      reason: `اختراق كاذب ثم اختراق ثانٍ مقابل (${Math.round(second.ext)} بيب) متوافق مع الترند السابق للتجميع — دخول فوري بسعر السوق لحظة الإشارة، وقف 100 بيب من سعر الدخول الفعلي`,
      ttlHours: 24,
    });
  }
  return out;
}

// ------------------------------------------------------------
// C: الأوردر بلوك المؤسسي (سحب سيولة + FVG + BOS + توافق 4H)
// ------------------------------------------------------------
export function detectC(inp: DetectorsInput): SignalEvent[] {
  const out: SignalEvent[] = [];
  for (const tf of ['15m', '1h'] as TF[]) {
    const c = tf === '15m' ? inp.c15 : inp.c1h;
    const ms = TF_MS[tf];
    const pivots = findPivotsTF(c, tf, 2);
    const a = atr(c, 14);
    let ptr = 0;
    const window: typeof pivots = []; // نافذة منزلقة لآخر 40 شمعة
    for (let i = 3; i < c.length - 14; i++) {
      const barT = c[i].t;
      while (ptr < pivots.length && pivots[ptr].confirmedAt <= barT + ms) window.push(pivots[ptr++]);
      while (window.length && window[0].t < barT - 40 * ms) window.shift();
      const bar = c[i];
      const recentLows = window.filter(p => p.kind === 'low');
      const sweptLow = recentLows.find(p => bar.l < p.price && bar.c > p.price);
      const recentHighs = window.filter(p => p.kind === 'high');
      const sweptHigh = recentHighs.find(p => bar.h > p.price && bar.c < p.price);
      if (!sweptLow && !sweptHigh) continue;
      const bullish = !!sweptLow;
      // الشريطة 2: انفجار سعري مع فجوة FVG بين الشمعة الأولى والثالثة
      const c1 = bar, c2 = c[i + 1], c3 = c[i + 2];
      if (!c2 || !c3) continue;
      const impulsive = isImpulsive(bullish ? c3 : c3, a[i + 1]) || isImpulsive(c2, a[i + 1]);
      if (!impulsive || !hasFVG(c1, c2, c3, bullish ? 'up' : 'down')) continue;
      // نطاق الأوردر بلوك: آخر شمعة معاكسة قبل الانفجار (دمج إن كانت صغيرة)
      let obLow = Math.min(bar.l, bar.o, bar.c), obHigh = Math.max(bar.h, bar.o, bar.c);
      if ((obHigh - obLow) < 0.5 * a[i] && i > 0) {
        obLow = Math.min(obLow, c[i - 1].l); obHigh = Math.max(obHigh, c[i - 1].h);
      }
      // الشريطة 3: كسر هيكلي بإغلاق على نفس الفريم (أو 1h عند التحليل على 15m)
      const refHigh = recentHighs.filter(p => p.t < bar.t).slice(-1)[0];
      const refLow = recentLows.filter(p => p.t < bar.t).slice(-1)[0];
      let bosT: number | null = null;
      for (let j = i + 3; j < Math.min(i + 15, c.length); j++) {
        if (bullish && refHigh && c[j].c > refHigh.price) { bosT = c[j].t + ms; break; }
        if (!bullish && refLow && c[j].c < refLow.price) { bosT = c[j].t + ms; break; }
      }
      if (!bosT) continue;
      // الشريطة 4: التوافق مع ترند 4 ساعات
      const t4 = trendAt(inp.trend4h, bosT);
      if (bullish && t4 !== 'up') continue;
      if (!bullish && t4 !== 'down') continue;
      const mid = (obLow + obHigh) / 2;
      const entry = bullish ? mid - pips(30) : mid + pips(30);
      out.push({
        strategy: 'C', dir: bullish ? 'buy' : 'sell', entry, slPips: 150,
        refLevel: mid, knownAt: bosT, fibConfirmed: true,
        reason: `أوردر بلوك مؤسسي ${bullish ? 'صاعد' : 'هابط'} على ${tf}: سحب سيولة + فجوة امبالانس FVG + كسر هيكلي بإغلاق + توافق ترند 4H — دخول فوري بسعر السوق لحظة اكتمال الشروط، وقف 150 بيب من سعر الدخول الفعلي`,
        ttlHours: 48,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------
// D: ذيول الشموع الكبرى (شهرية وأسبوعية) + الكسر وإعادة الاختبار
// ------------------------------------------------------------
export function detectD(inp: DetectorsInput): SignalEvent[] {
  const out: SignalEvent[] = [];
  const c15 = inp.c15, ms15 = TF_MS['15m'];

  const handleLevel = (level: number, validFrom: number, label: string) => {
    // 1) صفقة عكسية: السعر أعلى المستوى وينخفض نحوه → شراء قبل الملامسة بـ30 بيب
    let armed = false;
    for (const bar of c15) {
      const t = bar.t + ms15;
      if (t <= validFrom) continue;
      const dist = (bar.c - level) / 0.1;
      // كسر بإغلاق 15د يتجاوز الخط بـ100 بيب أو أكثر → إعادة اختبار مع اتجاه الكسر
      if (bar.c < level - pips(100)) {
        out.push({
          strategy: 'D', dir: 'sell', entry: level - pips(30), slPips: 80, refLevel: level, knownAt: t,
          reason: `كسر ${label} بإغلاق 15 دقيقة يتجاوز الخط بـ100 بيب+ — دخول فوري بيع بسعر السوق، وقف 80 بيب من سعر الدخول الفعلي`,
          ttlHours: 48,
        });
        break;
      }
      if (bar.c > level - pips(100) && bar.c < level + pips(100)) {
        // لمس المنطقة الحرجية: إنهاء مراقبة الارتداد العكسي
        if (armed && dist <= 0) break;
        armed = dist > 0 && dist <= TRIG;
        if (armed) {
          out.push({
            strategy: 'D', dir: 'buy', entry: level + pips(30), slPips: 80, refLevel: level, knownAt: t,
            reason: `اقتراب هابط من ذيل ${label} — دخول فوري شراء عكسي بسعر السوق، وقف 80 بيب من سعر الدخول الفعلي`,
            ttlHours: 48,
          });
          break;
        }
      }
    }
    // 2) الحالة الصاعدة: السعر أسفل المستوى ويصعد نحوه → بيع قبل الملامسة بـ30 بيب
    armed = false;
    for (const bar of c15) {
      const t = bar.t + ms15;
      if (t <= validFrom) continue;
      if (bar.c > level + pips(100)) {
        out.push({
          strategy: 'D', dir: 'buy', entry: level + pips(30), slPips: 80, refLevel: level, knownAt: t,
          reason: `كسر صاعد لـ${label} بإغلاق 15 دقيقة +100 بيب — دخول فوري شراء بسعر السوق، وقف 80 بيب من سعر الدخول الفعلي`,
          ttlHours: 48,
        });
        break;
      }
      const dist = (level - bar.c) / 0.1;
      if (dist > 0 && dist <= TRIG) {
        if (!armed) {
          armed = true;
          out.push({
            strategy: 'D', dir: 'sell', entry: level - pips(30), slPips: 80, refLevel: level, knownAt: t,
            reason: `اقتراب صاعد من ذيل ${label} — دخول فوري بيع عكسي بسعر السوق، وقف 80 بيب من سعر الدخول الفعلي`,
            ttlHours: 48,
          });
          break;
        }
      }
    }
  };

  // الذيل الأعلى والأدنى لآخر شمعة أسبوعية مغلقة
  for (let w = 1; w < inp.c1w.length; w++) {
    const wk = inp.c1w[w - 1];
    const validFrom = inp.c1w[w].t; // بداية الأسبوع الحالي = إغلاق السابق
    handleLevel(wk.h, validFrom, `ذيل قمة الأسبوع ${new Date(wk.t).toISOString().slice(0, 10)}`);
    handleLevel(wk.l, validFrom, `ذيل قاع الأسبوع ${new Date(wk.t).toISOString().slice(0, 10)}`);
  }
  // الشهرية
  for (let m = 1; m < inp.c1M.length; m++) {
    const mo = inp.c1M[m - 1];
    const validFrom = inp.c1M[m].t;
    handleLevel(mo.h, validFrom, `ذيل قمة الشهر ${new Date(mo.t).toISOString().slice(0, 7)}`);
    handleLevel(mo.l, validFrom, `ذيل قاع الشهر ${new Date(mo.t).toISOString().slice(0, 7)}`);
  }
  return out;
}

// ------------------------------------------------------------
// E: الأرقام المئوية النفسية (ارتداد + كسر وإعادة اختبار)
// ------------------------------------------------------------
export function roundNumbers(min: number, max: number): number[] {
  const out: number[] = [];
  // حرفياً وفق الدليل: «مستويات تنتهي بأصفار كاملة في الذهب (مثل: 4000، 4100، 4200، 4300)»
  // → كل 100$. (التكثيف السابق 5$/10$ كان تعديلاً لهدف 20 صفقة/يوم ألغاه المستخدم)
  const start = Math.ceil(min / 100) * 100;
  for (let v = start; v <= max; v += 100) out.push(v);
  return out;
}

export function detectE(inp: DetectorsInput): SignalEvent[] {
  const out: SignalEvent[] = [];
  const c5 = inp.c5, c15 = inp.c15;
  const ms5 = TF_MS['5m'], ms15 = TF_MS['15m'];
  if (c5.length < 50 || c15.length < 20) return out;
  // المستويات الرئيسية: كل 100$ حرفياً (4000، 3900، 2100...) — الأرقام الفرعية (كل 50$) لا تُتداول
  // النطاق = أدنى قاع وأعلى قمة في كامل النافذة (وليس طرفي الشريحتين):
  // في السوق الهابط قاع أول شمعة أعلى من قمة الأخيرة وكان يُفرغ المستويات صامتة — أُصلح بمسح كامل
  let winLo = Infinity, winHi = -Infinity;
  for (const b of c5) { if (b.l < winLo) winLo = b.l; if (b.h > winHi) winHi = b.h; }
  const levels = roundNumbers(winLo, winHi);
  // قيم القاعدة المجمّدة (حرفياً — لا تعديل):
  const ZONE = 3;        // منطقة التفاعل: 3$ حول الرقم
  const CONFIRM = 2;     // تأكيد الرفض: إغلاق 5م بـ2$ على الأقل عبر الرقم
  const BREAK_MIN = 10;  // الكسر: إغلاق 15م بـ10$ على الأقل في اتجاه الكسر
  const SL_PAD = 1;      // الوقف: 1$ خلف قمة/قاع شمعة التأكيد
  const WINDOW_H = 4;    // نافذة انتظار إعادة الاختبار: 4 ساعات

  for (const level of levels) {
    // ---- حالة الرقم ----
    let rejSide: 'up' | 'down' | null = null;   // جلسة رفض نشطة: up=لمس من الأسفل صعوداً (بيع عكسي)، down=هبوط من الأعلى (شراء عكسي)
    let breakDir: 'up' | 'down' | null = null;  // إعداد كسر نشط بانتظار إعادة الاختبار
    let breakT = 0;                             // لحظة إغلاق شمعة الكسر (15م)
    let prev15 = (c15[0].c - level);            // إغلاق 15م السابق بالدولار (لكشف عبور عتبة ±10$)
    let j = 0;                                  // مؤشر شموع 15م

    const resetBreak = () => { breakDir = null; breakT = 0; };

    for (let i = 0; i < c5.length; i++) {
      const b = c5[i];
      const nowT = b.t + ms5; // لحظة إغلاق شمعة 5م الحالية
      const close = b.c, hi = b.h, lo = b.l;

      // ---- 1) إغلاقات 15م المكتملة حتى الآن: كشف الكسر ----
      while (j < c15.length && c15[j].t + ms15 <= nowT) {
        const q = c15[j];
        const over = q.c - level; // بالدولار
        if (breakDir === null) {
          if (over >= BREAK_MIN && prev15 < BREAK_MIN) {
            breakDir = 'up'; breakT = q.t + ms15; // كسر صاعد: إغلاق 15م بـ10$+ فوق الرقم
          } else if (over <= -BREAK_MIN && prev15 > -BREAK_MIN) {
            breakDir = 'down'; breakT = q.t + ms15; // كسر هابط
          }
        }
        prev15 = over; j++;
      }

      // ---- 2) إعداد الكسر وإعادة الاختبار (أولوية على الرفض لنفس الرقم) ----
      if (breakDir !== null) {
        // إلغاء حرفي: أغلق السعر عبر الرقم (داخل الرقم) قبل إعادة الاختبار
        if ((breakDir === 'up' && close < level) || (breakDir === 'down' && close > level)) { resetBreak(); continue; }
        // انتهاء نافذة الانتظار: 4 ساعات من إغلاق شمعة الكسر → يُلغى الإعداد
        if (nowT - breakT > WINDOW_H * 3600e3) { resetBreak(); continue; }
        // إعادة الاختبار: عاد السعر للمنطقة (±3$ حول الرقم) وشمعة 5م أكدت اتجاه الكسر
        const touchedZone = breakDir === 'up' ? lo <= level + ZONE : hi >= level - ZONE;
        const confirmed = breakDir === 'up' ? close > b.o : close < b.o;
        if (touchedZone && confirmed) {
          const anchor = breakDir === 'up' ? lo - SL_PAD : hi + SL_PAD; // وقف: 1$ خلف قاع/قمة شمعة التأكيد
          out.push({
            strategy: 'E', setup: 'B', dir: breakDir === 'up' ? 'buy' : 'sell', entry: close,
            slPips: Math.abs(close - anchor) / 0.1, slAnchor: anchor,
            refLevel: level, knownAt: nowT,
            reason: `كسر الرقم المستدير ${level} بإغلاق 15م بـ${BREAK_MIN}$+ في اتجاه الكسر ثم عاد السعر للمنطقة (±${ZONE}$) وشمعة 5م أكدت الاتجاه عند ${close.toFixed(2)} — دخول بسعر السوق عند إغلاق شمعة التأكيد، وقف 1$ خلف ${breakDir === 'up' ? 'قاع' : 'قمة'} شمعة التأكيد (${anchor.toFixed(2)}) يُرفع إلى 10$ إن قلّ وتُلغى الصفقة فوق 15$، الهدف 2×مسافة الوقف`,
            ttlHours: 1,
          });
          resetBreak();
        }
        continue; // أثناء وجود إعداد كسر نشط لا تُفتح جلسة رفض لنفس الرقم
      }

      // ---- 3) إعداد الرفض (Rejection) ----
      // انسحاب الجلسة: اخترق الرقم بأكثر من 3$ (تجاوز المنطقة) أو أغلق أبعد من المنطقة
      if (rejSide === 'up' && (hi > level + ZONE || close > level + ZONE)) rejSide = null;
      else if (rejSide === 'down' && (lo < level - ZONE || close < level - ZONE)) rejSide = null;
      // لمس جديد: شمعة تلمس الرقم أو تخترقه بحد أقصى 3$
      if (rejSide === null) {
        if (hi >= level && hi <= level + ZONE) rejSide = 'up';
        else if (lo <= level && lo >= level - ZONE) rejSide = 'down';
      }
      // تأكيد الرفض: شمعة 5م تغلق عبر الرقم بـ2$ على الأقل (عكس اتجاه اللمس)
      if (rejSide === 'up' && close <= level - CONFIRM) {
        const anchor = hi + SL_PAD; // وقف: 1$ فوق أعلى نقطة في شمعة التأكيد
        out.push({
          strategy: 'E', setup: 'A', dir: 'sell', entry: close,
          slPips: Math.abs(close - anchor) / 0.1, slAnchor: anchor,
          refLevel: level, knownAt: nowT,
          reason: `رفض الرقم المستدير ${level}: السعر صعد للمنطقة (±${ZONE}$) ولمس الرقم أو اخترقه بحد أقصى ${ZONE}$ ثم شمعة 5م أغلقت تحت الرقم بـ${CONFIRM}$+ عند ${close.toFixed(2)} — بيع بسعر السوق عند إغلاق شمعة التأكيد، وقف 1$ فوق أعلى نقطة في الشمعة (${anchor.toFixed(2)}) يُرفع إلى 10$ إن قلّ وتُلغى الصفقة فوق 15$، الهدف 2×مسافة الوقف`,
          ttlHours: 1,
        });
        rejSide = null; // انتهت جلسة الرفض — لمسة جديدة تبدأ جلسة جديدة
      } else if (rejSide === 'down' && close >= level + CONFIRM) {
        const anchor = lo - SL_PAD; // وقف: 1$ تحت أدنى نقطة في شمعة التأكيد
        out.push({
          strategy: 'E', setup: 'A', dir: 'buy', entry: close,
          slPips: Math.abs(close - anchor) / 0.1, slAnchor: anchor,
          refLevel: level, knownAt: nowT,
          reason: `رفض الرقم المستدير ${level}: السعر نزل للمنطقة (±${ZONE}$) ولمس الرقم أو اخترقه بحد أقصى ${ZONE}$ ثم شمعة 5م أغلقت فوق الرقم بـ${CONFIRM}$+ عند ${close.toFixed(2)} — شراء بسعر السوق عند إغلاق شمعة التأكيد، وقف 1$ تحت أدنى نقطة في الشمعة (${anchor.toFixed(2)}) يُرفع إلى 10$ إن قلّ وتُلغى الصفقة فوق 15$، الهدف 2×مسافة الوقف`,
          ttlHours: 1,
        });
        rejSide = null;
      }
    }
  }
  return out.sort((a, b) => a.knownAt - b.knownAt);
}

// ------------------------------------------------------------
// F: تبادل الأدوار 1H/4H (كسر قاع/قمة بأكثر من 200 بيب)
// ------------------------------------------------------------
export function detectF(inp: DetectorsInput): SignalEvent[] {
  const out: SignalEvent[] = [];
  for (const ev of inp.trend1h.length ? structureBreaks(inp) : []) {
    const sell = ev.dir === 'down';
    const entry = sell ? ev.level - pips(30) : ev.level + pips(30);
    out.push({
      strategy: 'F', dir: sell ? 'sell' : 'buy', entry, slPips: 100,
      refLevel: ev.level, knownAt: ev.knownAt,
      reason: `كسر ${sell ? 'قاع' : 'قمة'} سابق بقوة (+${Math.round(ev.breakPips)} بيب) على ${ev.tf} — تحول لمستوى ${sell ? 'مقاومة' : 'دعم'} (تبادل أدوار)، دخول فوري بسعر السوق مع الترند، وقف 100 بيب من سعر الدخول الفعلي`,
      ttlHours: 72,
    });
  }
  return out;
}

interface BreakEv { dir: 'up' | 'down'; level: number; knownAt: number; breakPips: number; tf: TF }
function structureBreaks(inp: DetectorsInput): BreakEv[] {
  const out: BreakEv[] = [];
  // حرفياً وفق الدليل: تبادل الأدوار على فريمي الساعة والأربع ساعات (1H و 4H)
  for (const tf of ['1h', '4h'] as TF[]) {
    const c = tf === '1h' ? inp.c1h : inp.c4h;
    const ms = TF_MS[tf];
    const pivots = findPivotsTF(c, tf, 2);
    let ptr = 0;
    let lastLow: Swing | null = null;
    let lastHigh: Swing | null = null;
    for (let i = 0; i < c.length; i++) {
      while (ptr < pivots.length && pivots[ptr].confirmedAt <= c[i].t + ms) {
        const p = pivots[ptr++];
        if (p.kind === 'low') lastLow = p; else lastHigh = p;
      }
      const bar = c[i];
      if (lastLow && bar.c < lastLow.price - pips(200)) {
        out.push({ dir: 'down', level: lastLow.price, knownAt: bar.t + ms, breakPips: (lastLow.price - bar.c) / 0.1, tf });
      }
      if (lastHigh && bar.c > lastHigh.price + pips(200)) {
        out.push({ dir: 'up', level: lastHigh.price, knownAt: bar.t + ms, breakPips: (bar.c - lastHigh.price) / 0.1, tf });
      }
    }
  }
  // إبقاء أول كسر فقط لكل مستوى (إعادة اختبار واحدة)
  const seen = new Set<string>();
  return out.filter(e => {
    const key = `${e.dir}:${Math.round(e.level)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

// ------------------------------------------------------------
// G: تبادل الأدوار والزخم 5M/15M (موجة 200-400 بيب)
// ------------------------------------------------------------
export function detectG(inp: DetectorsInput): SignalEvent[] {
  const out: SignalEvent[] = [];
  for (const tf of ['5m', '15m'] as TF[]) {
    const c = tf === '5m' ? inp.c5 : inp.c15;
    const ms = TF_MS[tf];
    const pivots = findPivotsTF(c, tf, 2);
    const a = atr(c, 14);
    let ptr = 0;
    let lastLow: Swing | null = null;
    let lastHigh: Swing | null = null;
    for (let i = 2; i < c.length; i++) {
      while (ptr < pivots.length && pivots[ptr].confirmedAt <= c[i].t + ms) {
        const p = pivots[ptr++];
        if (p.kind === 'low') lastLow = p; else lastHigh = p;
      }
      const bar = c[i];
      const pl = lastLow;
      if (pl && bar.c < pl.price && isImpulsive(bar, a[i])) {
        // تتبع أدنى نقطة قبل الارتداد
        let ext = bar.l, extT = bar.t + ms;
        let j = i + 1;
        for (; j < Math.min(i + 40, c.length); j++) {
          if (c[j].l < ext) { ext = c[j].l; extT = c[j].t + ms; }
          if (c[j].c > pl.price) break; // بدأ الارتداد
        }
        const wavePips = (pl.price - ext) / 0.1;
        if (wavePips > 200 && wavePips <= 400) {
          // انتظار اقتراب إعادة الاختبار من الأسفل
          for (let k2 = j; k2 < Math.min(j + 60, c.length); k2++) {
            const dist = (pl.price - c[k2].c) / 0.1;
            if (c[k2].c >= pl.price) break; // اختبار فاشل
            if (dist > 0 && dist <= 60) {
              out.push({
                strategy: 'G', dir: 'sell', entry: pl.price - pips(20), slPips: 50, refLevel: pl.price, knownAt: c[k2].t + ms,
                reason: `كسر زخمي لقاع حقيقي على ${tf} بموجة ${Math.round(wavePips)} بيب (200-400) — دخول فوري بيع بسعر السوق لحظة اكتمال الإشارة، وقف 50 بيب من سعر الدخول الفعلي`,
                ttlHours: 12,
              });
              break;
            }
          }
        }
      }
      const ph = lastHigh;
      if (ph && bar.c > ph.price && isImpulsive(bar, a[i])) {
        let ext = bar.h;
        let j = i + 1;
        for (; j < Math.min(i + 40, c.length); j++) {
          if (c[j].h > ext) { ext = c[j].h; }
          if (c[j].c < ph.price) break;
        }
        const wavePips = (ext - ph.price) / 0.1;
        if (wavePips > 200 && wavePips <= 400) {
          for (let k2 = j; k2 < Math.min(j + 60, c.length); k2++) {
            const dist = (c[k2].c - ph.price) / 0.1;
            if (c[k2].c <= ph.price) break;
            if (dist > 0 && dist <= 60) {
              out.push({
                strategy: 'G', dir: 'buy', entry: ph.price + pips(20), slPips: 50, refLevel: ph.price, knownAt: c[k2].t + ms,
                reason: `كسر زخمي لقمة حقيقية على ${tf} بموجة ${Math.round(wavePips)} بيب (200-400) — دخول فوري شراء بسعر السوق لحظة اكتمال الإشارة، وقف 50 بيب من سعر الدخول الفعلي`,
                ttlHours: 12,
              });
              break;
            }
          }
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------
// H + I: نموذج الكويزومودو (1H/4H للكبير، 15M للمصغر)
// ------------------------------------------------------------
export function detectQM(inp: DetectorsInput): SignalEvent[] {
  const out: SignalEvent[] = [];
  const run = (tf: TF, strat: StrategyId, entryOff: number, slP: number) => {
    const c = tf === '5m' ? inp.c5 : tf === '15m' ? inp.c15 : tf === '4h' ? inp.c4h : inp.c1h;
    const ms = TF_MS[tf];
    const pivots = findPivotsTF(c, tf, 2);
    const lowerT = (x: number): number => {
      // أول فهرس شمعة وقتها >= x
      let lo = 0, hi = c.length - 1, res = c.length;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (c[mid].t >= x) { res = mid; hi = mid - 1; } else lo = mid + 1; }
      return res;
    };
    // bearish QM: H1 < P1 < H2 (H2 > H1) ثم إغلاق < P1 → بيع عند H1
    for (let i = 0; i < pivots.length - 3; i++) {
      const a1 = pivots[i], a2 = pivots[i + 1], a3 = pivots[i + 2];
      if (!(a1.kind === 'high' && a2.kind === 'low' && a3.kind === 'high')) continue;
      if (a3.price <= a1.price) continue;
      const start = lowerT(Math.max(a3.t, a3.confirmedAt - ms));
      const limit = a3.confirmedAt + 10 * ms;
      let knownAt: number | null = null;
      for (let j = start; j < c.length; j++) {
        if (c[j].t + ms > limit) break;
        if (c[j].t + ms > a3.confirmedAt && c[j].c < a2.price) { knownAt = c[j].t + ms; break; }
      }
      if (knownAt === null) continue;
      out.push({
        strategy: strat, dir: 'sell', entry: a1.price - pips(entryOff), slPips: slP,
        refLevel: a1.price, knownAt,
        reason: `كويزومودو بيعي على ${tf}: قمة أولى (كتف أيسر) + قمة أعلى HH ثم كسر القاع المؤقت بإغلاق (CHoCH) — دخول فوري بيع بسعر السوق، وقف ${slP} بيب من سعر الدخول الفعلي`,
        ttlHours: 48,
      });
    }
    // bullish QM: L1 > H1 > L2 (L2 < L1) ثم إغلاق > H1 → شراء عند L1
    for (let i = 0; i < pivots.length - 3; i++) {
      const a1 = pivots[i], a2 = pivots[i + 1], a3 = pivots[i + 2];
      if (!(a1.kind === 'low' && a2.kind === 'high' && a3.kind === 'low')) continue;
      if (a3.price >= a1.price) continue;
      const start2 = lowerT(Math.max(a3.t, a3.confirmedAt - ms));
      const limit2 = a3.confirmedAt + 10 * ms;
      let knownAt2: number | null = null;
      for (let j = start2; j < c.length; j++) {
        if (c[j].t + ms > limit2) break;
        if (c[j].t + ms > a3.confirmedAt && c[j].c > a2.price) { knownAt2 = c[j].t + ms; break; }
      }
      if (knownAt2 === null) continue;
      out.push({
        strategy: strat, dir: 'buy', entry: a1.price + pips(entryOff), slPips: slP,
        refLevel: a1.price, knownAt: knownAt2,
        reason: `كويزومودو شرائي على ${tf}: قاع أول (كتف أيسر) + قاع أدنى LL ثم كسر القمة المؤقتة بإغلاق (CHoCH) — دخول فوري شراء بسعر السوق، وقف ${slP} بيب من سعر الدخول الفعلي`,
        ttlHours: 48,
      });
    }
  };
  run('4h', 'H', 30, 80);
  run('1h', 'H', 30, 80);
  run('15m', 'I', 20, 50);
  return out.sort((x, y) => x.knownAt - y.knownAt);
}

// ------------------------------------------------------------
// J: مناطق العرض والطلب (3+ شموع قاعدة متلاصقة الأجسام)
// ------------------------------------------------------------
export function detectJ(inp: DetectorsInput): SignalEvent[] {
  const out: SignalEvent[] = [];
  for (const tf of ['15m', '1h'] as TF[]) {
    const c = tf === '15m' ? inp.c15 : inp.c1h;
    const ms = TF_MS[tf];
    const a = atr(c, 14);
    let i = 0;
    while (i < c.length - 6) {
      // قاعدة: ثلاث شموع على الأقل متلاصقة الأجسام (أجسام صغيرة)
      let run = 0;
      let j = i;
      while (j < c.length && Math.abs(c[j].c - c[j].o) <= 0.35 * a[j]) { run++; j++; }
      if (run >= 3) {
        const base = c.slice(i, j);
        const zLow = Math.min(...base.map(x => x.l));
        const zHigh = Math.max(...base.map(x => x.h));
        const after = c[j];
        const after2 = c[j + 1];
        const move = after2 ? Math.max(after.h, after2.h) - zHigh : after.h - zHigh;
        const moveDn = after2 ? zLow - Math.min(after.l, after2.l) : zLow - after.l;
        const expl = isImpulsive(after, a[j]) || (after2 && isImpulsive(after2, a[j + 1]));
        if (expl) {
          const knownAt = (after2 && isImpulsive(after2, a[j + 1]) ? after2.t : after.t) + ms;
          if (move > 1.2 * a[j] && (after.c - zHigh) / 0.1 <= 300) {
            // منطقة طلب → شراء عند أول إعادة اختبار قبل حد المنطقة بـ20 بيب
            for (let k2 = j; k2 < Math.min(j + 80, c.length); k2++) {
              if (c[k2].l <= zHigh + pips(20)) {
                out.push({
                  strategy: 'J', dir: 'buy', entry: zHigh + pips(20), slPips: 70, refLevel: zHigh, knownAt: c[k2].t + ms,
                  reason: `منطقة طلب مؤسسية على ${tf} (قاعدة ${run} شموع متلاصقة + انفجار صاعد) — دخول فوري شراء بسعر السوق لحظة أول اختبار للمنطقة، وقف 70 بيب من سعر الدخول الفعلي`,
                  ttlHours: 72,
                });
                break;
              }
              if (c[k2].c < zLow - pips(60)) break;
            }
          } else if (moveDn > 1.2 * a[j] && (zLow - after.c) / 0.1 <= 300) {
            for (let k2 = j; k2 < Math.min(j + 80, c.length); k2++) {
              if (c[k2].h >= zLow - pips(20)) {
                out.push({
                  strategy: 'J', dir: 'sell', entry: zLow - pips(20), slPips: 70, refLevel: zLow, knownAt: c[k2].t + ms,
                  reason: `منطقة عرض مؤسسية على ${tf} (قاعدة ${run} شموع متلاصقة + انفجار هابط) — دخول فوري بيع بسعر السوق لحظة أول اختبار للمنطقة، وقف 70 بيب من سعر الدخول الفعلي`,
                  ttlHours: 72,
                });
                break;
              }
              if (c[k2].c > zHigh + pips(60)) break;
            }
          }
        }
        i = j + 1;
      } else i++;
    }
  }
  return out.sort((x, y) => x.knownAt - y.knownAt);
}

// ------------------------------------------------------------
// K + L: فيبوناتشي (38.2/50/61.8 و+23.6 لآسيا)
// ------------------------------------------------------------
export function detectFib(inp: DetectorsInput): SignalEvent[] {
  const out: SignalEvent[] = [];
  const c15 = inp.c15, ms15 = TF_MS['15m'];
  const groups: { anchors: FibAnchor[]; ratios: number[]; strat: StrategyId; asiaOnly: boolean }[] = [
    { anchors: inp.fibD, ratios: [0.382, 0.5, 0.618], strat: 'K', asiaOnly: false },
    { anchors: inp.fib4h, ratios: [0.382, 0.5, 0.618], strat: 'K', asiaOnly: false },
    { anchors: inp.fibW, ratios: [0.382, 0.5, 0.618], strat: 'K', asiaOnly: false },
    { anchors: inp.fibD, ratios: [0.236, 0.382, 0.5, 0.618], strat: 'L', asiaOnly: true },
    { anchors: inp.fib4h, ratios: [0.236, 0.382, 0.5, 0.618], strat: 'L', asiaOnly: true },
    { anchors: inp.fibW, ratios: [0.236, 0.382, 0.5, 0.618], strat: 'L', asiaOnly: true },
  ];
  for (const g of groups) {
    for (const anc of g.anchors) {
      for (const r of g.ratios) {
        const level = fibLevel(anc, r);
        const key = `${r}`;
        const up = anc.dir === 'up';
        // 1) ارتداد عند المستوى دون ملامسة سابقة → مع الترند العام
        let touched = false, emitted = false;
        for (const bar of c15) {
          const t = bar.t + ms15;
          if (t <= anc.knownAt) continue;
          if (g.asiaOnly) { const h = syriaHour(t); if (!(h >= 1 && h < 10)) continue; }
          if (bar.l <= level && bar.h >= level) touched = true;
          const dist = (bar.c - level) / 0.1;
          if (!touched && !emitted && dist > 0 && dist <= TRIG && (up ? bar.c > level : bar.c < level)) {
            emitted = true;
            out.push({
              strategy: g.strat, dir: up ? 'buy' : 'sell', entry: up ? level + pips(30) : level - pips(30), slPips: 80,
              refLevel: level, knownAt: t, fibConfirmed: true,
              reason: `اقتراب السعر من فيبو ${(r * 100).toFixed(1)}% لموجة ${up ? 'صاعدة' : 'هابطة'} على ${anc.tf} دون ملامسة سابقة — دخول فوري مع الترند بسعر السوق، وقف 80 بيب من سعر الدخول الفعلي${g.asiaOnly ? ' (خلال جلسة آسيا فقط)' : ''}`,
              ttlHours: 72,
            });
          }
          // 2) كسر المستوى وإعادة الاختبار (إغلاق 15د عبر المستوى)
          const over = (up ? level - bar.c : bar.c - level) / 0.1; // العمق خلف المستوى
          if (!emitted && over >= 20) {
            const buy = !up; // كسر فيبو صاعد لأسفل → الكسر هابط
            out.push({
              strategy: g.strat, dir: buy ? 'buy' : 'sell', entry: buy ? level + pips(30) : level - pips(30), slPips: 80,
              refLevel: level, knownAt: t, fibConfirmed: over >= 100,
              reason: `كسر مستوى فيبو ${(r * 100).toFixed(1)}% على ${anc.tf} بإغلاق 15د${over >= 100 ? ' (اختراق قوي +100 بيب)' : ''} — دخول فوري مع اتجاه الكسر بسعر السوق، وقف 80 بيب من سعر الدخول الفعلي`,
              ttlHours: 72,
            });
            break;
          }
          if (touched && emitted) break;
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------
// M: سحب سيولة قمة/قاع أمريكا (آسيا فقط)
// ------------------------------------------------------------
export function detectM(inp: DetectorsInput, usLevels: { asiaOpenT: number; high: number; low: number }[]): SignalEvent[] {
  const out: SignalEvent[] = [];
  const c5 = inp.c5, ms5 = TF_MS['5m'];
  for (const u of usLevels) {
    for (const lvl of [{ price: u.high, sell: true }, { price: u.low, sell: false }]) {
      // حرفياً وفق الدليل: عند افتتاح آسيا يكون المستوى أبعد من السعر بمسافة تتجاوز 250 بيب،
      // ثم تتحرك آسيا باتجاهه ← أمر عكسي قبل الملامسة بـ20 بيب، وقف 60 بيب بعد المستوى (80 من الدخول)
      let armed = false;
      let distAtArm = 0;
      let emitted = false;
      for (const bar of c5) {
        const t = bar.t + ms5;
        if (t <= u.asiaOpenT) continue;
        const h = syriaHour(t);
        if (!(h >= 1 && h < 10)) { if (t > u.asiaOpenT + 9 * 3600e3) break; continue; }
        const dist = lvl.sell ? (lvl.price - bar.c) / 0.1 : (bar.c - lvl.price) / 0.1;
        if (dist <= 0) break; // لمس المستوى دون إشارة
        if (!armed) {
          if (dist > 250) { armed = true; distAtArm = dist; } // شرط الابتعاد >250 بيب
          continue;
        }
        if (!emitted && dist < distAtArm) { // آسيا تتحرك فعلاً باتجاه المستهدف
          emitted = true;
          out.push({
            strategy: 'M', dir: lvl.sell ? 'sell' : 'buy', entry: lvl.sell ? lvl.price - pips(20) : lvl.price + pips(20), slPips: 80,
            refLevel: lvl.price, knownAt: t,
            reason: `تحرك آسيا نحو ${lvl.sell ? 'قمة' : 'قاع'} جلسة أمريكا السابقة (${lvl.price.toFixed(2)}) من مسافة >250 بيب (سحب سيولة) — دخول فوري عكسي بسعر السوق، وقف 80 بيب من سعر الدخول الفعلي`,
            ttlHours: 9,
          });
          break;
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------
// N: سحب سيولة ذيول الشموع الكبيرة ≥100 بيب (آسيا فقط)
// ------------------------------------------------------------
export function detectN(inp: DetectorsInput): SignalEvent[] {
  const out: SignalEvent[] = [];
  const c5 = inp.c5, ms5 = TF_MS['5m'];
  const wicks: { tf: TF; upper: boolean; start: number; tip: number; t: number }[] = [];
  for (const tf of ['1h', '4h'] as TF[]) {
    const c = tf === '1h' ? inp.c1h : inp.c4h;
    const ms = TF_MS[tf];
    for (let i = 0; i < c.length; i++) {
      const bar = c[i];
      const bodyTop = Math.max(bar.o, bar.c), bodyBot = Math.min(bar.o, bar.c);
      const upper = bar.h - bodyTop, lower = bodyBot - bar.l;
      if (upper >= pips(100)) wicks.push({ tf, upper: true, start: bodyTop, tip: bar.h, t: bar.t + ms });
      if (lower >= pips(100)) wicks.push({ tf, upper: false, start: bodyBot, tip: bar.l, t: bar.t + ms });
    }
  }
  wicks.sort((a, b) => a.t - b.t);
  for (const w of wicks) {
    // شرط عدم إعادة الاختبار: السعر لم يدخل نطاق الذيل قبل الإشارة
    let retested = false;
    let emitted = false;
    for (const bar of c5) {
      const t = bar.t + ms5;
      if (t <= w.t) continue;
      const h = syriaHour(t);
      if (!(h >= 1 && h < 10)) { if (t > w.t + 72 * 3600e3) break; continue; }
      if (w.upper && bar.h >= w.start) { retested = true; break; }
      if (!w.upper && bar.l <= w.start) { retested = true; break; }
      const dist = w.upper ? (w.start - bar.c) / 0.1 : (bar.c - w.start) / 0.1;
      if (dist > 0 && dist <= 80 && !emitted) {
        emitted = true;
        // وقف الدليل: 40 بيب بعد نهاية طرف الذيل — أي طول الذيل + 60 بيب من الدخول
        // (الدخول قبل بداية الذيل بـ20 بيب)
        const wickPips = Math.abs(w.tip - w.start) / 0.1;
        out.push({
          strategy: 'N', dir: w.upper ? 'sell' : 'buy', entry: w.upper ? w.start - pips(20) : w.start + pips(20), slPips: wickPips + 60,
          refLevel: w.start, knownAt: t,
          reason: `ذيل ${w.upper ? 'علوي' : 'سفلي'} بطول ${Math.round(wickPips)} بيب على شمعة ${w.tf} لم يُختبر بعد — دخول فوري عكسي بسعر السوق، وقف ${Math.round(wickPips + 60)} بيب من سعر الدخول الفعلي (خلال آسيا)`,
          ttlHours: 9,
        });
        break;
      }
      if (t > w.t + 72 * 3600e3) break;
    }
  }
  return out.sort((a, b) => a.knownAt - b.knownAt);
}

// ------------------------------------------------------------
// O: شمعة بيبا الانعكاسية الخضراء في القيعان
// ------------------------------------------------------------
export function detectO(inp: DetectorsInput): SignalEvent[] {
  const out: SignalEvent[] = [];
  for (const tf of ['5m', '15m', '30m', '1h'] as TF[]) {
    const c = tf === '5m' ? inp.c5 : tf === '15m' ? inp.c15 : tf === '30m' ? inp.c30 : inp.c1h;
    const ms = TF_MS[tf];
    for (let i = 30; i < c.length; i++) {
      const bar = c[i];
      const range = bar.h - bar.l;
      if (range <= pips(100)) continue; // الحجم أكبر من 100 بيب
      if (bar.c <= bar.o) continue;     // خضراء صاعدة حصراً
      const body = bar.c - bar.o;
      const bodyPct = body / range;
      const upperPct = (bar.h - bar.c) / range;
      const lowerPct = (Math.min(bar.o, bar.c) - bar.l) / range;
      if (bodyPct < 0.2 || bodyPct > 0.4) continue;   // الجسم 20-40%
      if (upperPct <= 0.6) continue;                   // الذيل العلوي النسبة الأكبر
      if (lowerPct > 0.05) continue;                   // الذيل السفلي ≤5%
      // في القيعان: أدنى قاع ضمن آخر 30 شمعة
      let minLow = Infinity;
      for (let j = i - 30; j < i; j++) minLow = Math.min(minLow, c[j].l);
      if (bar.l > minLow) continue;
      const bodyBottom = bar.o;
      // وقف الدليل: 70 بيب أسفل جسم الشمعة الأخضر — الجسم + 70 من سعر الدخول (الإغلاق)
      const bodyPips = (bar.c - bar.o) / 0.1;
      out.push({
        strategy: 'O', dir: 'buy', entry: bar.c, slPips: bodyPips + 70, refLevel: bodyBottom, knownAt: bar.t + ms, market: true,
        reason: `شمعة بيبا انعكاسية خضراء على ${tf} في القيعان (جسم ${Math.round(bodyPct * 100)}%، ذيل علوي ${Math.round(upperPct * 100)}%، حجم >100 بيب) — شراء فوري عند الإغلاق، وقف 70 بيب أسفل جسم الشمعة الأخضر (${Math.round(bodyPips + 70)} بيب من الدخول)`,
      });
    }
  }
  return out.sort((a, b) => a.knownAt - b.knownAt);
}

// ------------------------------------------------------------
// تجميع الكاشفات — حصرية القاعدة بطلب المستخدم الصريح:
// «اجعل النموذج ينفذ هذه القاعدة فقط ويتجاهل أي شيء غيرها»
// المحرك يولّد إشارات قاعدة الأرقام المستديرة (E) حصراً —
// أي إشارة من أي استراتيجية أخرى لا تولد أصلاً (لا تُعرض ولا تُنفَّذ).
// ------------------------------------------------------------
export function runAllDetectors(inp: DetectorsInput, _preTrendMap: Map<number, Dir>, _usLevels: { asiaOpenT: number; high: number; low: number }[]): SignalEvent[] {
  const all: SignalEvent[] = [
    ...detectE(inp),
  ];
  return all.sort((a, b) => a.knownAt - b.knownAt);
}

/** تحويل إشارة إلى أمر معلق مع تطبيق نسبة الهدف */
export function signalToSetup(s: SignalEvent, id: number, session: SessionId, tpRatio: number): Setup {
  // وقف مطلق مثبت بالقاعدة (E) — يُعرض ويُطبق كما هو دون حدود عامة
  const slPrice = s.slAnchor ?? (s.dir === 'buy' ? s.entry - pips(s.slPips) : s.entry + pips(s.slPips));
  return {
    id, strategy: s.strategy, dir: s.dir,
    entry: s.entry,
    slPips: s.slPips,
    sl: slPrice,
    tp: s.dir === 'buy' ? s.entry + pips(s.slPips) * tpRatio : s.entry - pips(s.slPips) * tpRatio,
    createdAt: s.knownAt,
    ...(s.setup ? { setup: s.setup } : {}),
    ...(s.slAnchor !== undefined ? { slAnchor: s.slAnchor } : {}),
    // الصلاحية ذات معنى للأوامر المنتظرة فقط (سعة/بوابة حجبتها) — الفوري ينفذ فور وصوله
    expiresAt: s.knownAt + (s.ttlHours ?? 24) * 3600e3,
    session, reason: s.reason,
    refLevel: s.refLevel,
    fibConfirmed: s.fibConfirmed,
    // الدخول الفوري لكل الاستراتيجيات (طلب المستخدم الصريح): كل إشارة تنفَّذ مباشرة
    // بسعر فتح أول شمعة بعد اكتمال شروطها — بلا انتظار ملامسة أمر limit
    market: true,
    strategyRank: STRATEGY_RANK[s.strategy],
  };
}
