// ============================================================
// كاشفات الاستراتيجيات A–R — حرفياً وفق ملف XAU-TAMSA7.pdf
// كل كاشف يطبق شروط الدليل الرقمية بدقة، وينتج إشارات بمعرفة زمنية
// كاملة (knownAt لحظة اكتمال الشروط — بلا تسلل مستقبلي).
// الأرقام كلها من معاملات الاستراتيجية (قابلة للتعديل بالأسهم في الواجهة).
// ============================================================
import { Candle, Consolidation, Dir, PIP, RealPivot, SessionId, Setup, StrategyId, TF, TF_MS, pips, pipsBetween } from './types';
import { TamsaParams, CaseCfg, SessionKey, HParams, IParams, LParams, MParams, NParams, OParams, ALLOWED_SESSIONS } from './tamsa-params';
import { findFibAnchors, fibLevel, findPivotsTF } from './structure';
import { atr, emaSeries } from './indicators';
import { syriaHour } from './sessions';

export interface SignalEvent {
  strategy: StrategyId;
  case?: string;          // البند الفرعي (case1/rev/brk/...)
  scenario?: 1 | 2;       // 1 = متوافق الترند، 2 = عكسي
  dir: 'buy' | 'sell';
  entry: number;
  slPips: number;
  tpPips: number;
  refLevel: number;
  levelKey: string;       // مفتاح الاستهلاك (قاعدة المرة الواحدة)
  allowedSessions?: SessionId[]; // الجلسات المسموحة للبند — تُفحص لحظة التنفيذ
  knownAt: number;        // لحظة اكتمال الشروط
  reason: string;
  expiresAt?: number;     // صلاحية خاصة (J/K: نافذة الدقائق)
  slAnchor?: number;      // وقف مطلق مثبت بالقاعدة (C: مستوى فيبو)
  market?: boolean;       // أمر سوق: تنفيذ على افتتاح أول شمعة بعد الإشارة (اصطلاح السلة المتحققة)
}

export interface DetectorsInput {
  c5: Candle[]; c15: Candle[]; c30: Candle[]; c1h: Candle[]; c4h: Candle[]; c1d: Candle[]; c1w: Candle[]; c1M: Candle[];
  cons15: Consolidation[];
  trend1h: { t: number; trend: Dir }[];
  trend4h: { t: number; trend: Dir }[];
  trend1d: { t: number; trend: Dir }[];
  real1h: RealPivot[]; // القمم/القيعان الحقيقية المعتمدة من الجزء صفر على الساعة
  real4h: RealPivot[]; // القمم/القيعان الحقيقية المعتمدة من الجزء صفر (للحالات C/H وغيرها)
}

export interface DetectorsCtx {
  params: TamsaParams;
  emaAt: (t: number) => 'up' | 'down' | 'range' | null;   // مؤشر EMA 20/90 على 4H/اليومي (null = معطل)
  /** بوابات البند: مفتاح تفعيل السيناريو نفسه + أزرار الجلسات الأربعة — كلها من يد المستخدم حرفياً */
  sessionsOf: (strategy: StrategyId, cs: string | undefined, scenario: 1 | 2) => { enabled: boolean; asia: boolean; london: boolean; londonNY: boolean; ny: boolean };
  /** مفاتيح بوابتي خطة التحويل (26/27) — الافتراضي مفعّلان عندما غائبان؛ erIncludeG=false للمحاكاة القبلية حصراً */
  regimeGates?: { dailyTrend: boolean; erQuiet: boolean; erIncludeG?: boolean };
}

// ---------- أدوات مشتركة ----------
const trendAt = (tl: { t: number; trend: Dir }[], t: number): Dir => {
  let d: Dir = 'range';
  for (const p of tl) { if (p.t <= t) d = p.trend; else break; }
  return d;
};

const sessionAt = (t: number): SessionKey => {
  const h = syriaHour(t);
  if (h < 10) return 'asia';
  if (h < 15) return 'london';
  if (h < 19) return 'londonNY';
  return 'ny';
};

/** تحديد السيناريو وفق مؤشر EMA (منطق الدليل ص85: المتوافق→س1، العكسي→س2، التشابك→س2 إجبارياً) */
function pickScenario(dir: 'buy' | 'sell', emaDir: 'up' | 'down' | 'range' | null): 1 | 2 {
  if (!emaDir) return 1;             // المؤشر معطل → السيناريو الأول (المتوافق) هو الأصل
  if (emaDir === 'range') return 2;  // منطقة عرضية تجميعية → إجبار السيناريو الثاني
  const aligned = (emaDir === 'up' && dir === 'buy') || (emaDir === 'down' && dir === 'sell');
  return aligned ? 1 : 2;
}

/** بوابة البند باتجاه محدد (السيناريو يعتمد على اتجاه الصفقة لحظة الإشارة) */
function gateDir(ctx: DetectorsCtx, st: StrategyId, cs: string | undefined, cfg: CaseCfg | undefined, dir: 'buy' | 'sell', t: number): { ok: boolean; scenario: 1 | 2 } {
  if (!cfg || !cfg.enabled) return { ok: false, scenario: 1 };
  const sk = sessionAt(t);
  const scenario = pickScenario(dir, ctx.emaAt(t));
  const toggles = ctx.sessionsOf(st, cs, scenario);
  // مفتاح تفعيل السيناريو (زر المستخدم المستقل لكل سيناريو — ص76): معطّل → بند السيناريو كله محظور
  if (toggles.enabled === false) return { ok: false, scenario };
  return { ok: toggles[sk], scenario };
}


/** أول فهرس شمعة فتحها ≥ t (بحث ثنائي — لتضييق كل حلقات المسح) */
function idxFrom(c: Candle[], t: number): number {
  let lo = 0, hi = c.length - 1, i = c.length;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (c[mid].t >= t) { i = mid; hi = mid - 1; } else lo = mid + 1; }
  return i;
}

/** أول محور تأكد عند أو بعد t (بحث ثنائي على قائمة محاور مرتبة) */
function idxFirstPivot(list: { confirmedAt: number }[], t: number): number {
  let lo = 0, hi = list.length - 1, i = list.length;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].confirmedAt >= t) { i = mid; hi = mid - 1; } else lo = mid + 1; }
  return i;
}

// ---------- سجل الاستهلاك (قاعدة المرة الواحدة) ----------
const CONSUMED = new Map<string, Set<string>>();
export function resetTamsaState() { CONSUMED.clear(); GATE_STATS.dailyTrend = {}; GATE_STATS.erQuiet = {}; }
export function consumeLevel(st: StrategyId, key: string) {
  if (!CONSUMED.has(st)) CONSUMED.set(st, new Set());
  CONSUMED.get(st)!.add(key);
}
export function isConsumed(st: StrategyId, key: string): boolean {
  return CONSUMED.get(st)?.has(key) ?? false;
}
function push(out: SignalEvent[], ev: SignalEvent) {
  if (isConsumed(ev.strategy, ev.levelKey)) return;
  out.push(ev);
}

// ============================================================
// بوابة التنظيم المركزية — خطة تحويل الفشل إلى نجاح (تقرير التشريح، الفصل السادس)
// قاعدة 1: لا صفقة للعائلة العكسية ضد اتجاه TSMOM اليومي (30 شمعة يومية مغلقة)
// قاعدة 4: C/G/H/O تعمل في السوق الهادئ فقط — كفاءة كوفمان ER(20) على اليومي < 0.30
// الحساب من الشموع اليومية المغلقة حصراً لحظة الإشارة (بلا تسلل مستقبلي)،
// والجداول تُبنى مرة واحدة لكل لقطة يومية (مفتاح: طول السلسلة اليومية).
// موثق تجريبياً: بوابة H رفعت عامل ربحها من 0.45 إلى 1.13 وDD من 128% إلى 60%.
// ============================================================
const TREND_GATED: ReadonlySet<StrategyId> = new Set(['A', 'B', 'C', 'F', 'G', 'H', 'J', 'N', 'O', 'P']);
const ER_GATED: ReadonlySet<StrategyId> = new Set(['C', 'G', 'H', 'O']);        // خطة التحويل: G انضم للبوابة (الاختبار المؤكد + الهدوء)
const ER_GATED_CORE: ReadonlySet<StrategyId> = new Set(['C', 'H', 'O']);        // النواة الأصلية — للمحاكاة القبلية حصراً
const ER_QUIET_MAX = 0.30;
const TSMOM_DAYS = 30;
const ER_DAYS = 20;
const DAY_MS = 86400e3;

interface RegimeMaps { len: number; trend: Int8Array; er: Float64Array }

// ---------- عدّادات شفافية البوابات (تُدمج في إحصاءات المحرك) ----------
// كل إشارة قُتلت بالبوابة تُسجل لاستراتيجيتها — النافذة تعرضها في «أسباب الحظر»
const GATE_STATS: { dailyTrend: Record<string, number>; erQuiet: Record<string, number> } = { dailyTrend: {}, erQuiet: {} };
export function regimeGateStats(): { dailyTrend: Record<string, number>; erQuiet: Record<string, number> } {
  return GATE_STATS;
}

function buildRegimeMaps(c1d: Candle[]): RegimeMaps {
  const n = c1d.length;
  const trend = new Int8Array(n);
  const er = new Float64Array(n); er.fill(NaN);
  for (let i = 0; i < n; i++) {
    if (i >= TSMOM_DAYS) trend[i] = c1d[i].c > c1d[i - TSMOM_DAYS].c ? 1 : -1;
    if (i >= ER_DAYS) {
      const net = Math.abs(c1d[i].c - c1d[i - ER_DAYS].c);
      let path = 0;
      for (let j = i - ER_DAYS + 1; j <= i; j++) path += Math.abs(c1d[j].c - c1d[j - 1].c);
      if (path > 0) er[i] = net / path;
    }
  }
  return { len: n, trend, er };
}

let REGIME_CACHE: { len: number; maps: RegimeMaps } | null = null;

/** فهرس آخر شمعة يومية مغلقة بالكامل قبل knownAt (بلا تسلل) */
function lastClosedDailyIdx(c1d: Candle[], knownAt: number): number {
  let lo = 0, hi = c1d.length - 1, res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (c1d[mid].t + DAY_MS <= knownAt) { res = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}

// ============================================================
// A: كسر النطاق العرضي لشموع الأربع ساعات (الحالتان)
// ============================================================
export function detectA(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.A;
  if (!P.enabled) return out;
  const c4 = inp.c4h, c5 = inp.c5, ms5 = TF_MS['5m'];
  const avgBody = c4.length > 20 ? c4.slice(-200).reduce((s, c) => s + Math.abs(c.c - c.o), 0) / Math.min(200, c4.length) : 0;
  // تأكيد ATR (خطة التحويل — إصلاح A): الكسر يجب أن يتجاوز نصف متوسط المدى الحقيقي 14×4H
  // ليُعتبر كسراً مؤكداً لا تلميحة — يُدمج مع شرط التجاوز 50–400 بيب الحرفي
  const atr4 = atr(c4, 14);

  const handleRange = (top: number, bottom: number, rangeT: number, cs: 'case1' | 'case2', cfg: CaseCfg, keyBase: string) => {
    // انتظار اكتمال شموع الحصار (الحالة الأولى) ثم كسر 5M بجسم خارج الخط بتجاوز 50–400
    const guardT = rangeT + 4 * TF_MS['4h'] * 4; // نافذة رصد معقولة بعد تشكل النطاق (16 شمعة 4H)
    let broken: 'up' | 'down' | null = null;
    let breakT = 0;
    let pi4 = Math.max(0, idxFrom(c4, rangeT) - 1); // مؤشر آخر شمعة 4H مغلقة (يُحدّث تدرجياً)
    for (const bar of c5) {
      if (bar.t < rangeT + TF_MS['4h']) continue;
      if (bar.t > guardT) break;
      while (pi4 + 1 < c4.length && c4[pi4 + 1].t + TF_MS['4h'] <= bar.t + ms5) pi4++;
      const a4v = atr4[pi4];
      const halfAtrPips = Number.isFinite(a4v) ? (a4v * 0.5) / PIP : 0;
      // التجاوز الإجمالي (جسم أو ذيل) بين 50–400 بيب — الدليل ص196–197/225–226
      // + إغلاق جسم شمعة 5M خارج الخط (شرط الكسر الصريح) + تجاوز ≥ نصف ATR 4H (خطة التحويل)
      const extUp = (bar.h - top) / PIP;
      const extDown = (bottom - bar.l) / PIP;
      if (bar.c > top && extUp >= P.minExtPips && extUp <= P.maxExtPips && extUp >= halfAtrPips) { broken = 'up'; breakT = bar.t + ms5; break; }
      if (bar.c < bottom && extDown >= P.minExtPips && extDown <= P.maxExtPips && extDown >= halfAtrPips) { broken = 'down'; breakT = bar.t + ms5; break; }
      // إبطال: عودة داخل النطاق بعد كسر مؤقت لا تُحسب (الكاشف يرصد أول كسر صريح فقط)
    }
    if (!broken) return;
    const up = broken === 'up';
    const line = up ? top : bottom;
    const key = `${keyBase}:${line.toFixed(2)}:${up ? 'U' : 'D'}`;
    // الدخول عند اقتراب السعر من الخط بـ30 بيب (شراء فوق الخط الهابط نحوه / بيع تحته الصاعد نحوه)
    const entry = up ? line + pips(P.entryPips) : line - pips(P.entryPips);
    const slPips = P.entryPips + P.slPips; // 30 قبل الخط + 80 خلفه
    const g = gateDir(ctx, 'A', cs, cfg, up ? 'buy' : 'sell', breakT);
    if (!g.ok) { consumeLevel('A', key); return; }
    push(out, {
      strategy: 'A', case: cs, scenario: g.scenario, dir: up ? 'buy' : 'sell',
      entry, slPips, tpPips: P.tpPips, refLevel: line, levelKey: key, knownAt: breakT,
      reason: `كسر ${cs === 'case1' ? 'نطاق شموع الحصار' : 'نطاق شمعة الاكتساح'} على 4H باتجاه ${up ? 'صاعد' : 'هابط'} وتجاوز ${Math.round(up ? (c5.find(b => b.t + ms5 === breakT)?.c ?? line - top) * 10 : 0) || ''} — تنفيذ ${P.entryPips > 0 ? `ماركت عند اقتراب الخط بـ${P.entryPips} بيب` : 'ماركت عند إعادة اختبار الخط مباشرة'}، وقف ${P.slPips} بيب خلف الخط، هدف ${P.tpPips}`,
      expiresAt: breakT + 24 * 3600e3,
    });
  };

  // الحالة 1: شمعة كبيرة + 3 شموع محصورة
  for (let i = 0; i + P.insideBars < c4.length; i++) {
    const big = c4[i];
    if (avgBody > 0 && Math.abs(big.c - big.o) < avgBody) continue;
    let inside = true;
    for (let j = 1; j <= P.insideBars; j++) {
      const b = c4[i + j];
      if (b.h > big.h || b.l < big.l) { inside = false; break; }
    }
    if (!inside) continue;
    handleRange(big.h, big.l, big.t, 'case1', P.case1, `A1:${big.t}`);
    i += P.insideBars; // نطاق واحد في كل مرة
  }
  // الحالة 2: 3 شموع صغيرة + شمعة اكتساح تكسح أعلى وأدنى المجمع
  for (let i = 0; i + P.smallCandles < c4.length; i++) {
    const three = c4.slice(i, i + P.smallCandles);
    const big = c4[i + P.smallCandles];
    const hi = Math.max(...three.map(c => c.h)), lo = Math.min(...three.map(c => c.l));
    const avgR = three.reduce((s, c) => s + (c.h - c.l), 0) / three.length;
    if (big.h - big.l < avgR * 1.5) continue;
    if (!(big.h > hi && big.l < lo)) continue;
    handleRange(big.h, big.l, big.t, 'case2', P.case2, `A2:${big.t}`);
    i += P.smallCandles;
  }
  return out;
}

// ============================================================
// B: التلاعب والاختراق الثاني (بعد كسر A — الحالات الأربع كلها)
// ============================================================
export function detectB(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.B;
  if (!P.enabled) return out;
  const c5 = inp.c5, ms5 = TF_MS['5m'];

  const handleFirstBreak = (top: number, bottom: number, firstBreakT: number, firstDir: 'up' | 'down', keyBase: string) => {
    // رصد أقصى تمدد من جهة الكسر الأول — إن بلغ 500 بيب أُلغيت B كلياً
    let maxExt = 0;
    let second: { dir: 'up' | 'down'; t: number; ext: number } | null = null;
    const windowEnd = firstBreakT + 48 * 3600e3;
    for (const bar of c5) {
      if (bar.t + ms5 <= firstBreakT) continue;
      if (bar.t > windowEnd) break;
      if (firstDir === 'up') maxExt = Math.max(maxExt, (bar.h - top) / PIP);
      else maxExt = Math.max(maxExt, (bottom - bar.l) / PIP);
      if (maxExt >= P.realBreakPips) return; // قاعدة الاختراق الحقيقي — لا تلاعب
      // الاختراق الثاني المعاكس: جسم شمعة 5M خارج الطرف الآخر
      if (!second) {
        // الاختراق الثاني المعاكس: جسم شمعة 5M خارج الطرف الآخر — تجاوز 50–400 بيب (الدليل ص284–285)
        if (firstDir === 'up' && bar.c < bottom - pips(P.bodyBreakMin)) {
          const ext = (bottom - bar.c) / PIP;
          if (ext <= P.bodyBreakMax) second = { dir: 'down', t: bar.t + ms5, ext };
        }
        if (firstDir === 'down' && bar.c > top + pips(P.bodyBreakMin)) {
          const ext = (bar.c - top) / PIP;
          if (ext <= P.bodyBreakMax) second = { dir: 'up', t: bar.t + ms5, ext };
        }
      }
    }
    if (!second) return;
    const line = second.dir === 'up' ? top : bottom;
    const key = `B:${keyBase}:${line.toFixed(2)}:${second.dir}`;
    const sell = second.dir === 'down';
    const entry = sell ? line - pips(P.entryPips) : line + pips(P.entryPips);
    const g = gateDir(ctx, 'B', 'main', P.main, sell ? 'sell' : 'buy', second.t);
    if (!g.ok) { consumeLevel('B', key); return; }
    push(out, {
      strategy: 'B', case: 'main', scenario: g.scenario, dir: sell ? 'sell' : 'buy',
      entry, slPips: P.entryPips + P.slPips, tpPips: P.tpPips, refLevel: line, levelKey: key, knownAt: second.t,
      reason: `اختراق أول (${firstDir === 'up' ? 'صاعد' : 'هابط'}) ثم انعكس وكسر الطرف المعاكس بتجاوز ${Math.round(second.ext)} بيب — صفقة التلاعب عند إعادة اختبار الخط الثاني، وقف ${P.slPips} بيب خلفه، هدف ${P.tpPips}`,
      expiresAt: second.t + 24 * 3600e3,
    });
  };

  // رادار B يعمل على كل نطاقات A المكسورة (الحالتان: حصار + اكتساح) بغض النظر عن نتيجة A
  const c4 = inp.c4h;
  const pA = ctx.params.A;
  for (let i = 0; i + 3 < c4.length; i++) {
    const big = c4[i];
    const three = c4.slice(i + 1, i + 4);
    const inside = three.every(b => b.h <= big.h && b.l >= big.l);
    if (inside) { scanB5(c5, big.h, big.l, big.t + TF_MS['4h'], `A1:${big.t}`, handleFirstBreak, pA.minExtPips, pA.maxExtPips); i += 3; }
  }
  // الحالة 2: نطاق شمعة الاكتساح يدخل رادار B كذلك (الدليل ص256–263: «شرط الكسر الصريح الأول المذكور في A بحالتيها»)
  for (let i = 0; i + pA.smallCandles < c4.length; i++) {
    const three = c4.slice(i, i + pA.smallCandles);
    const big = c4[i + pA.smallCandles];
    const hi = Math.max(...three.map(c2 => c2.h)), lo = Math.min(...three.map(c2 => c2.l));
    const avgR = three.reduce((s, c2) => s + (c2.h - c2.l), 0) / three.length;
    if (big.h - big.l < avgR * 1.5) continue;
    if (!(big.h > hi && big.l < lo)) continue;
    scanB5(c5, big.h, big.l, big.t + TF_MS['4h'], `A2:${big.t}`, handleFirstBreak, pA.minExtPips, pA.maxExtPips);
    i += pA.smallCandles;
  }
  return out;
}

function scanB5(c5: Candle[], top: number, bottom: number, fromT: number, keyBase: string, cb: (t: number, b: number, ft: number, d: 'up' | 'down', k: string) => void, minExt: number, maxExt: number) {
  const capT = fromT + 14 * 86400e3;
  for (const bar of c5) {
    if (bar.t < fromT) continue;
    if (bar.t > capT) return;
    // الكسر الأول يجب أن يستوفي شرط A حرفياً: إغلاق خارج الخط + تجاوز إجمالي 50–400 بيب (الدليل ص262–263)
    if (bar.c > top) {
      const ext = (bar.h - top) / PIP;
      if (ext >= minExt && ext <= maxExt) { cb(top, bottom, bar.t + TF_MS['5m'], 'up', keyBase); return; }
    }
    if (bar.c < bottom) {
      const ext = (bottom - bar.l) / PIP;
      if (ext >= minExt && ext <= maxExt) { cb(top, bottom, bar.t + TF_MS['5m'], 'down', keyBase); return; }
    }
  }
}

// ============================================================
// C: سحب سيولة عكس الترند الكبير + اسكالبينج فيبو 61.8% (الدليل ص336–444)
// الحالة 1: ترند هابط (4H+يومي) → سحب فوق آخر قمة حقيقية 4H ≥100 بيب →
//           CHoCH داخلي على 5M (إغلاق تحت قاع داخلي بـ100–500) → فيبو على
//           موجة الـ5M الأخيرة → بيع ماركت عند ارتداد السعر لـ 61.8%
// ============================================================
export function detectC(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.C;
  if (!P.enabled) return out;
  const c5 = inp.c5, ms5 = TF_MS['5m'];

  // سلسلة محاور 5M متناوبة (طيّ المحاور المتكررة باحتفاظ الأقصى)
  const raw5 = findPivotsTF(c5, '5m', 1);
  const series: typeof raw5 = [];
  for (const p of raw5) {
    const last = series[series.length - 1];
    if (last && last.kind === p.kind) {
      if ((p.kind === 'high' && p.price > last.price) || (p.kind === 'low' && p.price < last.price)) series[series.length - 1] = p;
    } else series.push(p);
  }
  // القاع الداخلي: محصور بين قمتين متتاليتين والثانية أعلى (تأكيد ترند صاعد داخلي)
  // القمة الداخلية: محصورة بين قاعين متتاليين والثاني أدنى (تأكيد ترند هابط داخلي)
  const internalLows: typeof raw5 = [];
  const internalHighs: typeof raw5 = [];
  for (let i = 0; i + 2 < series.length; i++) {
    const [x, y, z] = [series[i], series[i + 1], series[i + 2]];
    if (x.kind === 'high' && y.kind === 'low' && z.kind === 'high' && z.price > x.price) internalLows.push(y);
    if (x.kind === 'low' && y.kind === 'high' && z.kind === 'low' && z.price < x.price) internalHighs.push(y);
  }

  const runCase = (cfg: CaseCfg, cs: 'case1' | 'case2', bearish: boolean) => {
    // الخطوة 1: آخر قمة/قاع حقيقية معتمدة على 4H + ترند 4H واليومي معاً
    const reals = inp.real4h.filter(p => bearish ? (p.kind === 'HH' || p.kind === 'LH') : (p.kind === 'HL' || p.kind === 'LL'));
    for (const pv of reals) {
      const key = `C:${cs}:${pv.t}`;
      if (isConsumed('C', key)) continue;
      // الخطوة 2: السحب — الاندفاع فوق القمة/تحت القاع ≥100 بيب
      const pvStart = idxFrom(inp.c4h, pv.confirmedAt);
      let sweep: Candle | null = null;
      for (let bi = pvStart; bi < inp.c4h.length; bi++) {
        const bar = inp.c4h[bi];
        if (bar.t + TF_MS['4h'] <= pv.confirmedAt) continue;
        const reach = bearish ? (bar.h - pv.price) / PIP : (pv.price - bar.l) / PIP;
        if (reach >= P.minLevelBreakPips) { sweep = bar; break; }
        // عودة عميقة بعيدة عن المحور قبل أي سحب → محور قديم
        if ((bearish && bar.h < pv.price - pips(P.internalBreakMax) * 4) || (!bearish && bar.l > pv.price + pips(P.internalBreakMax) * 4)) break;
      }
      if (!sweep) continue;
      const sweepT = sweep.t + TF_MS['4h'];
      // الترند المعتمد لحظة السحب على 4H واليومي معاً (الجزء صفر)
      const tr4 = trendAt(inp.trend4h, sweepT);
      const trD = trendAt(inp.trend1d, sweepT);
      if (bearish ? (tr4 !== 'down' || trD !== 'down') : (tr4 !== 'up' || trD !== 'up')) continue;
      // الخطوة 3: الكسر الداخلي المعاكس على 5M (CHoCH داخلي) بإغلاق 100–500 بيب
      // «ينتقل وعي البوت فوراً لمراقبة فريم الـ5 دقائق وهو في حالة صعود، وينتظر انعكاساً
      //  حاداً يكسر آخر قاع داخلي لحظي متشكل» — آخر قاع داخلي مؤكد يتحدّث لحظياً،
      // وأول إغلاق 5M تحته بـ100–500 بيب هو الـCHoCH (الدليل ص359–364)
      const ivList = bearish ? internalLows : internalHighs;
      let done = false;
      let ptr = idxFirstPivot(ivList, sweepT);
      let latestIv: (typeof ivList)[number] | null = ptr > 0 ? ivList[ptr - 1] : null;
      const radarEnd = sweepT + 3 * 86400e3;
      for (let bi5 = idxFrom(c5, sweepT); bi5 < c5.length; bi5++) {
        const bar = c5[bi5];
        if (bar.t >= radarEnd) break;
        // تحديث «آخر قاع/قمة داخلية لحظية» المتشكلة حتى لحظة الإغلاق الحالية
        while (ptr < ivList.length && ivList[ptr].confirmedAt <= bar.t + ms5) { latestIv = ivList[ptr]; ptr++; }
        if (!latestIv) continue;
        const ext = bearish ? (latestIv.price - bar.c) / PIP : (bar.c - latestIv.price) / PIP;
        const crossed = bearish ? bar.c < latestIv.price - pips(P.internalBreakMin) : bar.c > latestIv.price + pips(P.internalBreakMin);
        if (!crossed || ext > P.internalBreakMax) continue;
        const iv = latestIv;
        // الخطوة 4: فيبو على الموجة الأخيرة لفريم 5M
        // 100% = نقطة بداية الانعكاس (أعلى/أدنى نقطة بعد السحب)، 0% = القاع/القمة الجديدة بعد الكسر
        let fib100 = bearish ? -Infinity : Infinity, fib0 = bearish ? Infinity : -Infinity;
        let waveStartT = sweep.t;
        for (let bj = idxFrom(c5, sweep.t); bj < c5.length; bj++) {
          const b = c5[bj];
          if (b.t + ms5 > bar.t + ms5) break;
          if (bearish) {
            if (b.h > fib100) { fib100 = b.h; waveStartT = b.t; }
          } else {
            if (b.l < fib100) { fib100 = b.l; waveStartT = b.t; }
          }
        }
        for (let bj = idxFrom(c5, waveStartT); bj < c5.length; bj++) {
          const b = c5[bj];
          if (b.t + ms5 > bar.t + ms5) break;
          fib0 = bearish ? Math.min(fib0, b.l) : Math.max(fib0, b.h);
        }
        if (!Number.isFinite(fib100) || !Number.isFinite(fib0) || fib100 === fib0) continue;
        const fibPrice = (r: number) => fib100 + (fib0 - fib100) * (r / 100);
        const entryLevel = fibPrice(P.fibTouch);
        const dist100 = Math.abs(fibPrice(100) - entryLevel) / PIP;
        const slAnchor = dist100 <= P.slFlexMaxPips ? fibPrice(100) : fibPrice(P.forcedFibLevel);
        const slPips = Math.abs(entryLevel - slAnchor) / PIP;
        if (!(slPips > 0)) continue;
        const knownAt = bar.t + ms5;
        const dir: 'buy' | 'sell' = bearish ? 'sell' : 'buy';
        const g = gateDir(ctx, 'C', cs, cfg, dir, knownAt);
        done = true; // موجة واحدة لكل كسر 4H (قاعدة المرة الواحدة)
        if (!g.ok) { consumeLevel('C', key); break; }
        push(out, {
          strategy: 'C', case: cs, scenario: g.scenario, dir,
          entry: entryLevel, slPips, tpPips: slPips * P.rr, refLevel: entryLevel, levelKey: key, knownAt,
          reason: `سحب سيولة عكسي: ${bearish ? 'اندفاع فوق آخر قمة 4H' : 'اندفاع تحت آخر قاع 4H'} (${pv.price.toFixed(2)}) ≥${P.minLevelBreakPips} بيب في ترند ${bearish ? 'هابط' : 'صاعد'} معتمد، ثم CHoCH داخلي 5M (${P.internalBreakMin}–${P.internalBreakMax} بيب) — فيبو على موجة الـ5M الأخيرة: ${bearish ? 'بيع' : 'شراء'} ماركت عند ملامسة ${P.fibTouch}%، وقف ${dist100 <= P.slFlexMaxPips ? 'عند نقطة بداية الانعكاس (100%)' : `عند فيبو ${P.forcedFibLevel}%`} (${Math.round(slPips)} بيب)، هدف 1:${P.rr}`,
          slAnchor, expiresAt: knownAt + 24 * 3600e3,
        });
        break;
      }
    }
  };
  runCase(P.case1, 'case1', true);  // ترند هابط: سحب فوق آخر قمة → بيع
  runCase(P.case2, 'case2', false); // ترند صاعد: سحب تحت آخر قاع → شراء
  return out;
}

// ============================================================
// D: فجوة الافتتاح اليومي (D1 + D2) — جلسة آسيا حصراً
// ============================================================
export function detectD(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.D;
  if (!P.enabled) return out;
  const c5 = inp.c5, ms5 = TF_MS['5m'];

  // تجميع أيام الآسيوية: بداية آسيا = أول شمعة 5M بعد الساعة 01:00 دمشق
  let dayKey = '';
  let prevClose = 0, openT = 0, upper = 0, lower = 0;
  let hitUp = false, hitDn = false, gapClosed = false, d1Break: { dir: 'up' | 'down'; t: number; line: number } | null = null;
  let d1MaxExt = 0, d1Done = false;
  const flushDay = () => {
    dayKey = ''; hitUp = false; hitDn = false; gapClosed = false; d1Break = null; d1MaxExt = 0; d1Done = false;
  };

  for (const bar of c5) {
    const h = syriaHour(bar.t);
    const dnum = Math.floor((bar.t + 3 * 3600e3) / 86400e3);
    const isNewAsiaDay = String(dnum) !== dayKey && h >= 1 && h < 2;
    if (isNewAsiaDay) {
      // فجوة الافتتاح: فرق إغلاق آخر شمعة أمس وافتتاح أول شمعة اليوم (الدليل ص460–461)
      const gapPips = prevClose ? Math.abs(bar.o - prevClose) / PIP : 0;
      if (dayKey && prevClose && gapPips >= P.gapMinPips && gapPips <= P.gapMaxPips) {
        upper = Math.max(prevClose, bar.o); lower = Math.min(prevClose, bar.o);
        openT = bar.t; hitUp = false; hitDn = false; gapClosed = false; d1Break = null; d1MaxExt = 0; d1Done = false;
        dayKey = String(dnum);
      } else {
        flushDay(); dayKey = String(dnum);
      }
      prevClose = bar.o;
      continue;
    }
    if (!dayKey || dayKey !== String(dnum)) { prevClose = bar.c; continue; }
    prevClose = bar.c;
    if (h >= 10) continue; // صلاحية آسيا فقط

    // شرط الإغلاق الكامل للفجوة: السعر يغطي كامل الفراغ (شمعة واحدة تجسره، أو تغطية تدريجية
    // بلمس الحدّين خلال آسيا — «سواء تحقق الفوري بجسم/ذيل شمعة 5M» — الدليل ص465–468)
    if (!gapClosed && upper && lower) {
      if (bar.h >= upper) hitUp = true;
      if (bar.l <= lower) hitDn = true;
      if (hitUp && hitDn) gapClosed = true;
    }
    if (!gapClosed || !upper) continue;

    // D1: كسر صريح بجزء جسم ≥50 + تجاوز إجمالي 100–300
    if (!d1Done) {
      const extUp = (bar.h - upper) / PIP, extDown = (lower - bar.l) / PIP;
      const bodyUp = (bar.c - upper) / PIP, bodyDown = (lower - bar.c) / PIP;
      if (bodyUp >= P.bodyBreakMin && extUp >= P.totalMin && extUp <= P.totalMax) {
        d1Break = { dir: 'up', t: bar.t + ms5, line: upper }; d1Done = true;
      } else if (bodyDown >= P.bodyBreakMin && extDown >= P.totalMin && extDown <= P.totalMax) {
        d1Break = { dir: 'down', t: bar.t + ms5, line: lower }; d1Done = true;
      } else {
        // لا إلغاء مسبق: نافذة 100–300 تُقيَّم على شمعة الكسر نفسها (الدليل ص484–490)
        // ولا قياس تراكمي مختلط بالجهتين قبل تحديد اتجاه الكسر الأول
      }
      if (d1Break) {
        const up = d1Break.dir === 'up';
        const line = d1Break.line;
        const key = `D1:${dnum}:${line.toFixed(2)}`;
        const entry = up ? line + pips(P.entryPips) : line - pips(P.entryPips);
        const slPips = P.entryPips + P.slPips;
        const g = gateDir(ctx, 'D', 'd1', P.d1, up ? 'buy' : 'sell', d1Break.t);
        if (!g.ok) consumeLevel('D', key);
        else push(out, {
          strategy: 'D', case: 'd1', scenario: g.scenario, dir: up ? 'buy' : 'sell',
          entry, slPips, tpPips: P.tpPips, refLevel: line, levelKey: key, knownAt: d1Break.t,
          reason: `فجوة افتتاح يومي (${Math.round(Math.abs(upper - lower) / PIP)} بيب) أُغلقت كاملاً ثم كسر ${up ? 'الحد الأعلى' : 'الحد الأسفل'} بجسم ≥${P.bodyBreakMin} وتجاوز إجمالي ${P.totalMin}–${P.totalMax} — ماركت عند اقتراب الخط بـ${P.entryPips} بيب، وقف ${P.slPips} خلفه، هدف ${P.tpPips}`,
          expiresAt: d1Break.t + Math.max(1, 10 - syriaHour(d1Break.t)) * 3600e3, // نهاية جلسة آسيا
        });
        continue;
      }
    }

    // D2: الكسر المضاد (بعد D1 بأي نتيجة)
    if (d1Done && d1Break) {
      const firstDir = d1Break.dir;
      if (firstDir === 'up') d1MaxExt = Math.max(d1MaxExt, (bar.h - d1Break.line) / PIP);
      else d1MaxExt = Math.max(d1MaxExt, (d1Break.line - bar.l) / PIP);
      if (d1MaxExt >= P.realBreakPips) { d1Break = null; continue; } // قاعدة 500 بيب — إلغاء D2
      const oppLine = firstDir === 'up' ? lower : upper;
      const bodyOpp = firstDir === 'up' ? (lower - bar.c) / PIP : (bar.c - upper) / PIP;
      const extOpp = firstDir === 'up' ? (lower - bar.l) / PIP : (bar.h - upper) / PIP;
      if (bodyOpp >= P.bodyBreakMin && extOpp >= P.totalMin && extOpp <= P.totalMax) {
        const up = firstDir === 'down'; // الكسر الثاني لأعلى → شراء
        const line = oppLine;
        const key = `D2:${dnum}:${line.toFixed(2)}`;
        const entry = up ? line + pips(P.entryPips) : line - pips(P.entryPips);
        const slPips = P.entryPips + P.slPips;
        const g = gateDir(ctx, 'D', 'd2', P.d2, up ? 'buy' : 'sell', bar.t + ms5);
        if (!g.ok) consumeLevel('D', key);
        else push(out, {
          strategy: 'D', case: 'd2', scenario: g.scenario, dir: up ? 'buy' : 'sell',
          entry, slPips, tpPips: P.tpPips, refLevel: line, levelKey: key, knownAt: bar.t + ms5,
          reason: `كسر أول (${firstDir === 'up' ? 'صاعد' : 'هابط'}) ثم انعكس وكسر الطرف المعاكس للفجوة (جسم ≥${P.bodyBreakMin}، تجاوز ${P.totalMin}–${P.totalMax}) — صفقة الكسر المضاد عند إعادة الاختبار، وقف ${P.slPips}، هدف ${P.tpPips}`,
          expiresAt: bar.t + ms5 + Math.max(1, 10 - syriaHour(bar.t)) * 3600e3, // نهاية جلسة آسيا (الدليل ص543)
        });
        d1Break = null; // نهاية دورة اليوم
      }
    }
  }
  return out;
}

// ============================================================
// E: مناطق العرض والطلب المؤسسية (E1 + E2 + E3)
// ============================================================
export function detectE(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.E;
  if (!P.enabled) return out;

  // منطقة واحدة باتجاه واحد: الاقتراب من الحد القريب بـ20 بيب، الوقف 50 خلف الحد البعيد
  // الابتعاد ≥200 بعد التكوين (مع احتساب موجة الاندفاع المكوّنة)، وسقف 500 قبل العودة،
  // وقاعدة المرة الأولى: أول ملامسة بعد التكوين هي فرصة التنفيذ الوحيدة
  const emitZone = (
    zone: { top: number; bottom: number }, zoneT: number, initExt: number,
    tf: TF, cs: 'e1' | 'e2' | 'e3', cfg: CaseCfg, dir: 'buy' | 'sell', source: Candle[],
  ) => {
    const ms = TF_MS[tf];
    let ext = initExt;
    let touched = false;
    const capT = zoneT + 14 * 86400e3; // حد زمني للمسح — لا منطقة تنتظر أبعد من أسبوعين
    for (const bar of source) {
      if (bar.t < zoneT) continue; // المسح بعد إغلاق شمعة التكوين الأخيرة حصراً
      if (bar.t >= capT) break;
      ext = Math.max(ext, (bar.h - zone.top) / PIP, (zone.bottom - bar.l) / PIP);
      if (ext > P.capMaxPips) return; // السقف الأقصى — المنطقة ميتة
      if (bar.l <= zone.top && bar.h >= zone.bottom) { touched = true; break; } // أول ملامسة
    }
    if (!touched || ext < P.expansionMinPips) return;
    const near = dir === 'buy' ? zone.top : zone.bottom;
    const far = dir === 'buy' ? zone.bottom : zone.top;
    const key = `E:${cs}:${tf}:${zoneT}:${dir === 'buy' ? 'D' : 'S'}`;
    const entry = dir === 'buy' ? near + pips(P.entryPips) : near - pips(P.entryPips);
    const slPips = dir === 'buy'
      ? (entry - (far - pips(P.slPips))) / PIP
      : ((far + pips(P.slPips)) - entry) / PIP;
    const g = gateDir(ctx, 'E', cs, cfg, dir, zoneT);
    if (!g.ok) { consumeLevel('E', key); return; }
    push(out, {
      strategy: 'E', case: cs, scenario: g.scenario, dir,
      entry, slPips, tpPips: P.tpPips, refLevel: near, levelKey: key,
      knownAt: zoneT,
      reason: `منطقة ${dir === 'buy' ? 'طلب' : 'عرض'} (${cs === 'e1' ? 'قاعدة كلاسيكية' : cs === 'e2' ? 'RBD/DBR' : 'تلاصق 20%'}) على ${tf} بعد ابتعاد ${Math.round(ext)} بيب — ماركت عند اقتراب حد المنطقة بـ${P.entryPips} بيب، وقف ${P.slPips} خلف المنطقة، هدف ${P.tpPips} (قاعدة المرة الأولى)`,
      expiresAt: zoneT + 48 * 3600e3,
    });
  };

  for (const tf of ['1h', '15m'] as TF[]) {
    const c = tf === '1h' ? inp.c1h : inp.c15;
    const ms = TF_MS[tf];
    // E1: قاعدة كلاسيكية — 3 شموع متلاصقة الأجسام (تقاطع أجسام مشترك) — الدليل ص627–632
    for (let i = 0; i + P.minCandles <= c.length; i++) {
      const three = c.slice(i, i + P.minCandles);
      const bodies = three.map(b => [Math.min(b.o, b.c), Math.max(b.o, b.c)] as const);
      const bTop = Math.min(...bodies.map(b => b[1]));
      const bBot = Math.max(...bodies.map(b => b[0]));
      if (bTop > bBot) { // تقاطع أجسام مشترك فعلي (متلاصقة في نفس النطاق)
        const zoneT = three[three.length - 1].t + ms; // بعد إغلاق شمعة التكوين الأخيرة
        // منطقة العرض: من أعلى ذيل علوي إلى أدنى جسم — بيع
        emitZone({ top: Math.max(...three.map(b => b.h)), bottom: bBot }, zoneT, 0, tf, 'e1', P.e1, 'sell', c);
        // منطقة الطلب: من أدنى ذيل سفلي إلى أعلى جسم — شراء
        emitZone({ top: bTop, bottom: Math.min(...three.map(b => b.l)) }, zoneT, 0, tf, 'e1', P.e1, 'buy', c);
      }
    }
    // E2: RBD (عرض للبيع) / DBR (طلب للشراء) — الدليل ص665–686
    for (let i = 0; i + P.imp1 + 1 + P.imp2 <= c.length; i++) {
      const imp1 = c.slice(i, i + P.imp1);
      const base = c[i + P.imp1];
      const imp2 = c.slice(i + P.imp1 + 1, i + P.imp1 + 1 + P.imp2);
      const avgR = imp1.reduce((s, b) => s + (b.h - b.l), 0) / imp1.length;
      const allRed = (b: Candle) => b.c < b.o && (b.h - b.l) >= avgR * 0.7;
      const allGreen = (b: Candle) => b.c > b.o && (b.h - b.l) >= avgR * 0.7;
      const baseBodyLow = Math.min(base.o, base.c), baseBodyHigh = Math.max(base.o, base.c);
      const zoneT = imp2[imp2.length - 1].t + ms; // بعد إغلاق آخر شمعة اندفاع
      if (imp1.every(allRed) && base.c > base.o && imp2.every(allRed)) {
        // RBD: عرض [أعلى ذيل القاعدة، أدنى جسمها] — بيع حصراً
        const initExt = Math.max(...imp2.map(b => (baseBodyLow - b.l) / PIP));
        emitZone({ top: base.h, bottom: baseBodyLow }, zoneT, initExt, tf, 'e2', P.e2, 'sell', c);
      }
      if (imp1.every(allGreen) && base.c < base.o && imp2.every(allGreen)) {
        // DBR: طلب [أدنى ذيل القاعدة، أعلى جسمها] — شراء حصراً
        const initExt = Math.max(...imp2.map(b => (b.h - baseBodyHigh) / PIP));
        emitZone({ top: baseBodyHigh, bottom: base.l }, zoneT, initExt, tf, 'e2', P.e2, 'buy', c);
      }
      i += P.imp1 + 1 + P.imp2 - 1;
    }
    // E3: تلاصق 20% — تقارب أسعار الإغلاق (لا الأحجام) — الدليل ص700–727
    for (let i = 0; i + 5 <= c.length; i++) {
      const [b1, b2, b3] = [c[i], c[i + 1], c[i + 2]];
      const body = (b: Candle) => Math.abs(b.c - b.o);
      const size1 = body(b1);
      if (size1 <= 0) continue;
      // سعر إغلاق الشمعة الثانية/الثالثة ضمن ±20% من حجم جسم الأولى عن إغلاق الأولى
      const within = (b: Candle) => Math.abs(b.c - b1.c) <= size1 * (P.proximityPct / 100);
      const red = (b: Candle) => b.c < b.o, green = (b: Candle) => b.c > b.o;
      const burst = c.slice(i + 3, i + 5);
      const three = [b1, b2, b3];
      const zoneT = burst[burst.length - 1].t + ms; // بعد إغلاق آخر شمعة انفجار
      const threeTop = Math.max(...three.map(b => Math.max(b.o, b.c)));
      const threeBot = Math.min(...three.map(b => Math.min(b.o, b.c)));
      if (red(b1) && green(b2) && red(b3) && within(b2) && within(b3) && burst.every(green) && body(burst[0]) > size1 && body(burst[1]) > size1) {
        // طلب شرائي: [أدنى ذيل سفلي للثلاث، أعلى جسم] — شراء حصراً
        const initExt = Math.max(...burst.map(b => (b.h - threeTop) / PIP));
        emitZone({ top: threeTop, bottom: Math.min(...three.map(b => b.l)) }, zoneT, initExt, tf, 'e3', P.e3, 'buy', c);
      }
      if (green(b1) && red(b2) && green(b3) && within(b2) && within(b3) && burst.every(red) && body(burst[0]) > size1 && body(burst[1]) > size1) {
        // عرض بيعي: [أعلى ذيل علوي للثلاث، أدنى جسم] — بيع حصراً
        const initExt = Math.max(...burst.map(b => (threeBot - b.l) / PIP));
        emitZone({ top: Math.max(...three.map(b => b.h)), bottom: threeBot }, zoneT, initExt, tf, 'e3', P.e3, 'sell', c);
      }
    }
  }
  return out;
}

// ============================================================
// F: ذيول الشموع الكبرى (F1 شهرية / F2 أسبوعية / F3 يومية) — الدليل ص747–1181
// التسلسل الحرفي لكل مستوى: تأهيل (حسب الحالة) → ارتداد أولى ماركت عند
// اقتراب ≤30 بيب → كسر تتابعي (جسم 15M ≥50 + تجاوز 100–300) → إعادة اختبار
// ============================================================
export function detectF(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.F;
  if (!P.enabled) return out;
  const X = P.exec;
  const c5 = inp.c5, ms5 = TF_MS['5m'];
  const c15 = inp.c15, ms15 = TF_MS['15m'];

  const runLevel = (lv: { line: number; isHigh: boolean; formT: number; mode: 'absence' | 'open' | 'history' }, cs: 'f1' | 'f2' | 'f3', cfg: CaseCfg) => {
    const baseKey = `F:${cs}:${lv.formT}:${lv.isHigh ? 'H' : 'L'}:${lv.line.toFixed(2)}`;
    if (isConsumed('F', baseKey)) return;
    // خطة التحويل — قلب كامل F (تقرير التشريح، الفصل السادس):
    // الذيل إشارة انضمام للموجة لا رفض لها — شراء الذيل السفلي في ترند صاعد فقط،
    // وبيع الذيل العلوي في ترند هابط فقط. الافتراضي (phase1Continuation=false)
    // يحافظ على السلوك الانعكاسي الأصلي؛ true يقلب اتجاه Phase 1 ليتبع اليومي.
    let sell: boolean;
    if (P.phase1Continuation === true) {
      const di = lastClosedDailyIdx(inp.c1d, lv.formT);
      if (di < TSMOM_DAYS) return; // لا اتجاه يومي محسوب بعد → لا صفقة
      const tr = inp.c1d[di].c > inp.c1d[di - TSMOM_DAYS].c ? 1 : -1;
      sell = tr === -1; // صاعد → شراء (sell=false)، هابط → بيع (sell=true) — مع اتجاه اليوم
    } else {
      sell = lv.isHigh; // السلوك الأصلي: عكس الذيل
    }
    const capT = lv.formT + 45 * 86400e3; // حد أداء للمسح (قابل للتعديل من المعاملات)

    // ---- التأهيل ----
    let armT = 0;
    if (lv.mode === 'absence') {
      // F1: 48 ساعة تداول متصلة بلا لمس (تصفير عند أي لمس) + ابتعاد 500 بيب — الدليل ص791–796
      let hours = 0, maxDist = 0;
      for (const bar of inp.c1h) {
        if (bar.t + TF_MS['1h'] <= lv.formT) continue;
        if (bar.t >= capT) break;
        if (bar.h >= lv.line && bar.l <= lv.line) { hours = 0; maxDist = 0; continue; } // لمس → تصفير العدّاد
        hours += 1;
        maxDist = Math.max(maxDist, Math.abs(bar.h - lv.line) / PIP, Math.abs(lv.line - bar.l) / PIP);
        if (hours >= P.absenceHours && maxDist >= P.absencePips) { armT = bar.t + TF_MS['1h']; break; }
      }
    } else if (lv.mode === 'open') {
      // F2/F3 (آخر شمعة): ابتعاد ≥300 بيب عن الخط قبل أي تفعيل — الدليل ص901–905/1050–1055
      let dist = 0;
      for (const bar of c5) {
        if (bar.t + ms5 <= lv.formT) continue;
        if (bar.t >= capT) break;
        if (bar.h >= lv.line && bar.l <= lv.line) { consumeLevel('F', baseKey); return; } // لمس قبل الابتعاد — التفعيل مجمد
        dist = Math.max(dist, Math.abs(bar.h - lv.line) / PIP, Math.abs(lv.line - bar.l) / PIP);
        if (dist >= (cs === 'f2' ? P.weeklyOpenPips : P.dailyOpenPips)) { armT = bar.t + ms5; break; }
      }
    } else {
      armT = lv.formT; // مستودع تاريخي: التأهيل بندمج مع فحص عدم الاختبار أدناه
    }
    if (!armT) return;

    // ---- مرحلة الارتداد الأولى: أول اقتراب ≤30 بيب (بعد التأهيل وبدون اختبار مسبق للمستودعات) ----
    let bounceT = 0;
    for (const bar of c5) {
      if (bar.t + ms5 <= armT) continue;
      if (bar.t >= capT) break;
      if (lv.mode === 'history' && bar.h >= lv.line && bar.l <= lv.line) { consumeLevel('F', baseKey); return; } // مختبر تاريخياً → ميت
      const dist = sell ? (lv.line - bar.h) / PIP : (bar.l - lv.line) / PIP;
      if (dist <= X.entryPips) { bounceT = bar.t + ms5; break; } // لحظة الاقتراب الفعلية
    }
    if (!bounceT) return;
    const revKey = `${baseKey}:rev`;
    const revEntry = sell ? lv.line - pips(X.entryPips) : lv.line + pips(X.entryPips);
    const revSl = X.entryPips + X.slPips;
    const g = gateDir(ctx, 'F', cs, cfg, sell ? 'sell' : 'buy', bounceT);
    if (!g.ok) consumeLevel('F', revKey);
    else push(out, {
      strategy: 'F', case: cs, scenario: g.scenario, dir: sell ? 'sell' : 'buy',
      entry: revEntry, slPips: revSl, tpPips: X.tpPips, refLevel: lv.line, levelKey: revKey, knownAt: bounceT,
      reason: `ارتداد أولى لـ${cs === 'f1' ? 'ذيل شهري' : cs === 'f2' ? 'ذيل أسبوعي' : 'ذيل يومي'} ${lv.isHigh ? 'علوي' : 'سفلي'} (${lv.line.toFixed(2)}) — ماركت قبل الخط بـ${X.entryPips} بيب، وقف ${X.slPips} خلف الخط، هدف ${X.tpPips}`,
      expiresAt: bounceT + 24 * 3600e3,
    });

    // ---- مرحلة الكسر التتابعي: بعد الارتداد مباشرة (بلا شرطي التأهيل) — الدليل ص838–873 ----
    for (const bar of c15) {
      if (bar.t + ms15 <= bounceT) continue;
      if (bar.t >= capT) break;
      const bodyUp = (bar.c - lv.line) / PIP, totalUp = (bar.h - lv.line) / PIP;
      const bodyDown = (lv.line - bar.c) / PIP, totalDown = (lv.line - bar.l) / PIP;
      let up: boolean | null = null;
      if (bodyUp >= X.bodyBreakMin && totalUp >= X.totalMin && totalUp <= X.totalMax) up = true;
      else if (bodyDown >= X.bodyBreakMin && totalDown >= X.totalMin && totalDown <= X.totalMax) up = false;
      if (up === null) continue;
      // كسر صاعد → شراء عند إعادة الاختبار، كسر هابط → بيع (مع اتجاه الكسر)
      const brkKey = `${baseKey}:brk`;
      const brkEntry = up ? lv.line + pips(X.brkEntryPips) : lv.line - pips(X.brkEntryPips);
      const brkSl = X.brkEntryPips + X.brkSlPips;
      const g2 = gateDir(ctx, 'F', cs, cfg, up ? 'buy' : 'sell', bar.t + ms15);
      consumeLevel('F', baseKey); // انتهاء دورة المستوى (ارتداد ثم كسر)
      if (!g2.ok) { consumeLevel('F', brkKey); return; }
      push(out, {
        strategy: 'F', case: cs, scenario: g2.scenario, dir: up ? 'buy' : 'sell',
        entry: brkEntry, slPips: brkSl, tpPips: X.brkTpPips, refLevel: lv.line, levelKey: brkKey, knownAt: bar.t + ms15,
        reason: `كسر ${up ? 'صاعد' : 'هابط'} لـ${cs === 'f1' ? 'ذيل شهري' : cs === 'f2' ? 'ذيل أسبوعي' : 'ذيل يومي'} (${lv.line.toFixed(2)}) بعد الارتداد الأول بإغلاق 15M ≥${X.bodyBreakMin} وتجاوز ${X.totalMin}–${X.totalMax} — ماركت قبل الخط بـ${X.brkEntryPips} بيب، وقف ${X.brkSlPips} خلفه عكس اتجاه الكسر، هدف ${X.brkTpPips}`,
        expiresAt: bar.t + ms15 + 24 * 3600e3,
      });
      return;
    }
  };

  // F1: كل شمعة شهرية مكتملة (تأهيل الغياب 48 ساعة/500 بيب)
  for (const c of inp.c1M.slice(0, -1)) {
    runLevel({ line: c.h, isHigh: true, formT: c.t + TF_MS['1M'], mode: 'absence' }, 'f1', P.f1);
    runLevel({ line: c.l, isHigh: false, formT: c.t + TF_MS['1M'], mode: 'absence' }, 'f1', P.f1);
  }
  // F2: آخر أسبوع (شرط الابتعاد 300 عن الافتتاح) + المستودع الأسبوعي التاريخي غير المختبر
  const weeks = inp.c1w;
  if (weeks.length >= 2) {
    const last = weeks[weeks.length - 1];
    const prev = weeks[weeks.length - 2];
    runLevel({ line: prev.h, isHigh: true, formT: last.t, mode: 'open' }, 'f2', P.f2);
    runLevel({ line: prev.l, isHigh: false, formT: last.t, mode: 'open' }, 'f2', P.f2);
  }
  for (const c of weeks.slice(0, -2)) {
    runLevel({ line: c.h, isHigh: true, formT: c.t + TF_MS['1w'], mode: 'history' }, 'f2', P.f2);
    runLevel({ line: c.l, isHigh: false, formT: c.t + TF_MS['1w'], mode: 'history' }, 'f2', P.f2);
  }
  // F3: آخر يوم (شرط الابتعاد 300) + المستودع اليومي التاريخي غير المختبر
  const days = inp.c1d;
  if (days.length >= 2) {
    const last = days[days.length - 1];
    const prev = days[days.length - 2];
    runLevel({ line: prev.h, isHigh: true, formT: last.t, mode: 'open' }, 'f3', P.f3);
    runLevel({ line: prev.l, isHigh: false, formT: last.t, mode: 'open' }, 'f3', P.f3);
  }
  for (const c of days.slice(0, -2)) {
    runLevel({ line: c.h, isHigh: true, formT: c.t + TF_MS['1d'], mode: 'history' }, 'f3', P.f3);
    runLevel({ line: c.l, isHigh: false, formT: c.t + TF_MS['1d'], mode: 'history' }, 'f3', P.f3);
  }
  return out;
}

// ============================================================
// G: الأرقام المئوية النفسية (3000→6000 كل 100) — ارتداد + كسر
// ============================================================
export function detectG(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.G;
  if (!P.enabled) return out;
  const c1h = inp.c1h, c15 = inp.c15;
  const nums: number[] = [];
  for (let n = 3000; n <= 6000; n += 100) nums.push(n);

  for (const num of nums) {
    const hi = inp.c15.filter(c => c.h > num).length > 0;
    const lo = inp.c15.filter(c => c.l < num).length > 0;
    if (!hi && !lo) continue;
    // شرطا التأهيل: 48 ساعة عمل بدون ملامسة (تصفير عند اللمس) + ابتعاد 500 بيب
    let hours = 0, lastT = 0, maxDist = 0, qualifiedAt = 0;
    for (const bar of c1h) {
      if (bar.l <= num && bar.h >= num) {
        if (!qualifiedAt) { // إعادة ضبط العداد عند الملامسة قبل التأهيل
          hours = 0; maxDist = 0; lastT = bar.t;
        }
        continue;
      }
      if (bar.t <= lastT) continue;
      hours += 1;
      maxDist = Math.max(maxDist, Math.abs(bar.h - num) / PIP, Math.abs(num - bar.l) / PIP);
      if (hours >= P.absenceHours && maxDist >= P.absencePips && !qualifiedAt) { qualifiedAt = bar.t + TF_MS['1h']; }
    }
    if (!qualifiedAt) continue;
    // أول اختبار فعلي للرقم بعد التأهيل (لمسة الرقم نفسها لا مجرد اقترابه) — الاتجاه من جهة السعر (فوق الرقم → شراء / تحته → بيع)
    let appT = 0, appDir: 'buy' | 'sell' = 'buy';
    const appStart = idxFrom(c15, qualifiedAt);
    for (let ai = appStart; ai < c15.length; ai++) {
      const bar = c15[ai];
      const dist = bar.l >= num ? (bar.l - num) / PIP : bar.h <= num ? (num - bar.h) / PIP : 0;
      if (dist <= P.revEntryPips) { appT = bar.t + TF_MS['15m']; appDir = bar.c > num ? 'buy' : 'sell'; break; }
    }
    if (!appT) continue;
    const revKey = `G:rev:${num}`;
    const dir = appDir;
    // الدخول عند اختبار الرقم مباشرة (خطة التحويل): لا تلميحة قبل الرقم — الأمر على الرقم نفسه
    const entry = dir === 'buy' ? num + pips(P.revEntryPips) : num - pips(P.revEntryPips);
    const g = gateDir(ctx, 'G', 'rev', P.rev, dir, appT);
    if (!g.ok) { consumeLevel('G', revKey); }
    else push(out, {
      strategy: 'G', case: 'rev', scenario: g.scenario, dir,
      entry, slPips: P.revEntryPips + P.revSlPips, tpPips: P.revTpPips,
      refLevel: num, levelKey: revKey, knownAt: appT,
      reason: `الرقم النفسي ${num} مؤهل (غياب ${P.absenceHours} ساعة + ابتعاد ${P.absencePips} بيب) واقترب السعر ${dir === 'buy' ? 'من الأعلى' : 'من الأسفل'} — ارتداد ${P.revEntryPips > 0 ? `قبل الرقم بـ${P.revEntryPips} بيب` : 'عند اختبار الرقم مباشرة'}، وقف ${P.revSlPips} خلفه، هدف ${P.revTpPips}`,
      expiresAt: appT + 48 * 3600e3,
    });
    // صفقة الكسر وإعادة الاختبار: جسم 15M ≥30 + تجاوز 100–300 ضمن نافذة الساعات من أول ملامسة
    const firstT = appT;
    const gStart = idxFrom(c15, firstT);
    for (let gi = gStart; gi < c15.length; gi++) {
      const bar = c15[gi];
      if (bar.t + TF_MS['15m'] > firstT + P.windowHours * 3600e3) break; // انتهاء النافذة الزمنية
      const bodyUp = (bar.c - num) / PIP, bodyDown = (num - bar.c) / PIP;
      const totalUp = (bar.h - num) / PIP, totalDown = (num - bar.l) / PIP;
      const brkKey = `G:brk:${num}`;
      if (bodyUp >= P.breakBodyMin && totalUp >= P.breakTotalMin && totalUp <= P.breakTotalMax) {
        const g = gateDir(ctx, 'G', 'brk', P.brk, 'buy', bar.t + TF_MS['15m']);
        if (!g.ok) { consumeLevel('G', brkKey); break; }
        push(out, {
          strategy: 'G', case: 'brk', scenario: g.scenario, dir: 'buy',
          entry: num + pips(P.brkEntryPips), slPips: P.brkEntryPips + P.brkSlPips, tpPips: P.brkTpPips,
          refLevel: num, levelKey: brkKey, knownAt: bar.t + TF_MS['15m'],
          reason: `كسر الرقم ${num} صعوداً بإغلاق 15M ≥${P.breakBodyMin} وتجاوز ${P.breakTotalMin}–${P.breakTotalMax} ضمن نافذة ${P.windowHours} ساعات — شراء عند إعادة الاختبار قبل الخط بـ${P.brkEntryPips} بيب، وقف ${P.brkSlPips}، هدف ${P.brkTpPips}`,
          expiresAt: bar.t + TF_MS['15m'] + 24 * 3600e3,
        });
        break;
      }
      if (bodyDown >= P.breakBodyMin && totalDown >= P.breakTotalMin && totalDown <= P.breakTotalMax) {
        const g = gateDir(ctx, 'G', 'brk', P.brk, 'sell', bar.t + TF_MS['15m']);
        if (!g.ok) { consumeLevel('G', brkKey); break; }
        push(out, {
          strategy: 'G', case: 'brk', scenario: g.scenario, dir: 'sell',
          entry: num - pips(P.brkEntryPips), slPips: P.brkEntryPips + P.brkSlPips, tpPips: P.brkTpPips,
          refLevel: num, levelKey: brkKey, knownAt: bar.t + TF_MS['15m'],
          reason: `كسر الرقم ${num} هبوطاً بإغلاق 15M ≥${P.breakBodyMin} وتجاوز ${P.breakTotalMin}–${P.breakTotalMax} — بيع عند إعادة الاختبار، وقف ${P.brkSlPips}، هدف ${P.brkTpPips}`,
          expiresAt: bar.t + TF_MS['15m'] + 24 * 3600e3,
        });
        break;
      }
    }
  }
  return out;
}

// ============================================================
// H: تبادل الأدوار 1H/4H + I: الزخم 5M/15M
// ============================================================
function detectRoleReversal(inp: DetectorsInput, ctx: DetectorsCtx, st: 'H' | 'I'): SignalEvent[] {
  const out: SignalEvent[] = [];
  const cfgs = st === 'H' ? ctx.params.H : ctx.params.I;
  if (!cfgs.enabled) return out;
  const tfs: TF[] = st === 'H' ? ['1h', '4h'] : ['5m', '15m'];
  const waveMin = st === 'H' ? (cfgs as HParams).breakPips : (cfgs as IParams).waveMinPips;
  const waveMax = st === 'H' ? Infinity : (cfgs as IParams).waveMaxPips;
  const entryPips = cfgs.entryPips;
  const slPips0 = cfgs.slPips;
  const tpPips = cfgs.tpPips;

  for (const tf of tfs) {
    const c = tf === '5m' ? inp.c5 : tf === '15m' ? inp.c15 : tf === '1h' ? inp.c1h : inp.c4h;
    const ms = TF_MS[tf];
    // القمم/القيعان الحقيقية المعتمدة من الجزء صفر (H) — والمحاور الهيكلية للزخم (I)
    const real = st === 'H'
      ? (tf === '1h' ? inp.real1h : inp.real4h).map(p => ({ kind: (p.kind === 'HH' || p.kind === 'LH') ? 'high' : 'low', price: p.price, t: p.t, confirmedAt: p.confirmedAt }))
      : findPivotsTF(c, tf, 2).map(p => ({ kind: p.kind, price: p.price, t: p.t, confirmedAt: p.confirmedAt }));
    const pivots = real as { kind: 'high' | 'low'; price: number; t: number; confirmedAt: number }[];
    for (let pi0 = 0; pi0 < pivots.length; pi0++) {
      const pv = pivots[pi0];
      // الكسر بإغلاق جسم شمعة + موجة صافية ≥200 (I: من 200 إلى 400).
      // قياس الموجة متقدم بلا تسلل مستقبلي: نراقب القمة/القاع الجاري حتى تبلغ
      // الموجة العتبة (200 بيب) أو تتجاوز الحد الأقصى (I: 400 بيب) أو يُلغي الكسر.
      // لحظة التأهيل = إغلاق شمعة بلوغ الموجة العتبة (لا شمعة الكسر الأولى).
      let breakBar: Candle | null = null;
      const capPv = pv.confirmedAt + 14 * 86400e3;
      const pvStart = idxFrom(c, pv.confirmedAt);
      let crossed = false; // هل حدث الكسر الأول (إغلاق عبر الخط)؟
      for (let pi = pvStart; pi < c.length; pi++) {
        const bar = c[pi];
        if (bar.t > capPv) break;
        if (bar.t + ms <= pv.confirmedAt) continue;
        // قياس الموجة الجاري من الخط إلى أقصى/أدنى نقطة وصلها السعر منذ الكسر الأول
        if (pv.kind === 'high') {
          if (!crossed) {
            if (bar.c > pv.price) crossed = true; else continue;
          }
          // أول شمعة تبلغ فيها الموجة العتبة = لحظة التأهيل
          const wave = (bar.h - pv.price) / PIP;
          if (wave >= waveMin && wave <= waveMax) { breakBar = bar; break; }
          if (wave > waveMax) break; // تجاوز الحد الأقصى — لا تأهيل
          // عودة الإغلاق تحت الخط بعد الكسر الأول دون بلوغ الموجة = إلغاء
          if (bar.c < pv.price) break;
        } else {
          if (!crossed) {
            if (bar.c < pv.price) crossed = true; else continue;
          }
          const wave = (pv.price - bar.l) / PIP;
          if (wave >= waveMin && wave <= waveMax) { breakBar = bar; break; }
          if (wave > waveMax) break;
          if (bar.c > pv.price) break;
        }
      }
      if (!breakBar) continue;
      const up = pv.kind === 'high'; // كسر قمة → دعم جديد → شراء عند إعادة الاختبار
      // بروتوكول تعارض المستويات المتقاربة (الدليل ص1368–1383): كسران متقاربان <100 بيب
      // → الدخول على الأقرب لسعر الكسر + الوقف 30 بيب خلف المستوى الأبعد
      let slAnchorPips: number | null = null;
      const HP = cfgs as HParams;
      if (st === 'H' && HP.conflictPips) {
        const next = pivots[pi0 + 1];
        const prev = pivots[pi0 - 1];
        for (const other of [next, prev]) {
          if (!other || other.kind === pv.kind) continue;
          if (Math.abs(other.price - pv.price) / PIP >= HP.conflictPips) continue;
          // المستوى الآخر ضمن <100 بيب: بعد كسره أيضاً؟ نتحقق من كسره في نفس الاتجاه
          const otherBroken = other.kind === 'high'
            ? c.some(b => b.t + ms <= breakBar!.t && b.t + ms > other.confirmedAt && b.c > other.price)
            : c.some(b => b.t + ms <= breakBar!.t && b.t + ms > other.confirmedAt && b.c < other.price);
          if (!otherBroken) continue;
          const breakDist = Math.abs((up ? breakBar.c - pv.price : pv.price - breakBar.c) / PIP);
          const otherBreakBar = c.find(b => b.t + ms > other.confirmedAt && (other.kind === 'high' ? b.c > other.price : b.c < other.price));
          if (!otherBreakBar) continue;
          const otherDist = Math.abs((up ? otherBreakBar.c - other.price : other.price - otherBreakBar.c) / PIP);
          if (otherDist < breakDist) { slAnchorPips = HP.conflictSlPips; } // المستوى الأبعد هو الأساس للوقف
          break;
        }
      }
      const key = `${st}:${tf}:${pv.t}`;
      const entry = up ? pv.price + pips(entryPips) : pv.price - pips(entryPips);
      const slPips = slAnchorPips !== null
        ? Math.abs(entry - (up ? pv.price - pips(slAnchorPips) : pv.price + pips(slAnchorPips))) / PIP
        : entryPips + slPips0;
      const knownAt = breakBar.t + ms;
      const g = gateDir(ctx, st as StrategyId, 'main', cfgs.main, up ? 'buy' : 'sell', knownAt);
      if (!g.ok) { consumeLevel(st as StrategyId, key); continue; }
      push(out, {
        strategy: st as StrategyId, case: 'main', scenario: g.scenario, dir: up ? 'buy' : 'sell',
        entry, slPips, tpPips, refLevel: pv.price, levelKey: key, knownAt,
        reason: `كسر ${st === 'H' ? 'مستوى تبادل أدوار (الجزء صفر)' : 'مستوى زخم'} (${tf}) ${up ? 'صعوداً' : 'هبوطاً'} بموجة صافية ≥${waveMin} بيب — ماركت قبل ملامسة المستوى بـ${entryPips} بيب، وقف ${Math.round(slPips)} بيب ${slAnchorPips !== null ? '(بروتوكول التعارض: 30 خلف المستوى الأبعد)' : `خلفه`}, هدف ${tpPips} (مرة واحدة للمستوى)`,
        expiresAt: knownAt + 48 * 3600e3,
      });
    }
  }
  return out;
}

export function detectH(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] { return detectRoleReversal(inp, ctx, 'H'); }
export function detectI(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] { return detectRoleReversal(inp, ctx, 'I'); }

// ============================================================
// J / K: الرأس والكتفين (كبير 1H/4H — صغير 5M/15M)
// ============================================================
function detectHS(inp: DetectorsInput, ctx: DetectorsCtx, st: 'J' | 'K'): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = st === 'J' ? ctx.params.J : ctx.params.K;
  if (!P.enabled) return out;
  const tfs: TF[] = st === 'J' ? ['1h', '4h'] : ['15m', '5m'];

  const runPattern = (c: Candle[], tf: TF, cfg: CaseCfg, cs: 'bear' | 'bull', bearish: boolean) => {
    const ms = TF_MS[tf];
    const raw = findPivotsTF(c, tf, 2);
    // سلسلة تناوب حقيقية: القمم والقيعان تتبادل — تكرار النوع يُطوى باحتفاظ الأقصى
    const series: typeof raw = [];
    for (const p of raw) {
      const last = series[series.length - 1];
      if (last && last.kind === p.kind) {
        if ((p.kind === 'high' && p.price > last.price) || (p.kind === 'low' && p.price < last.price)) series[series.length - 1] = p;
      } else series.push(p);
    }
    const sep = P.sepCandles * ms;

    for (let i = 0; i + 2 < series.length; i++) {
      // التسلسل الهندسي الحرفي: A (كتف)، B (عنق)، C (رأس) — ثم أول D متوافق بعد C
      const A = series[i];
      const B = series[i + 1];
      const C = series[i + 2];
      if ((A.kind === 'high') !== bearish) continue;
      // شروط الفواصل الزمنية: 3 شموع على الأقل بين النقاط
      if (B.idx - A.idx < P.sepCandles || C.idx - B.idx < P.sepCandles) continue;
      // الرأس يخترق الكتف الأيسر بمسافة 100–400 بيب
      const headBreak = bearish ? (C.price - A.price) / PIP : (A.price - C.price) / PIP;
      if (headBreak < P.headBreakMin || headBreak > P.headBreakMax) continue;
      // D: أول قاع/قمة بعد C — يجب أن يقع داخل مجال B كلياً، وأول مرشح خارجه يُلغي النموذج
      // فوراً («إذا تشكل القاع D خارج حدود هذا النطاق كلياً يُلغى النموذج» — الدليل ص1574–1576)
      let D: typeof raw[number] | null = null;
      for (let j = i + 3; j < series.length; j++) {
        const cand = series[j];
        if (cand.kind !== B.kind) continue;
        if (cand.idx - C.idx < P.sepCandles) continue;
        const dAbove = bearish ? (cand.price - (B.price - pips(P.dZoneFar))) : ((B.price + pips(P.dZoneFar)) - cand.price);
        const dBelow = bearish ? ((B.price + pips(P.dZoneNear)) - cand.price) : (cand.price - (B.price - pips(P.dZoneNear)));
        if (dAbove >= 0 && dBelow >= 0) { D = cand; }
        break; // أول مرشح D يحسم المصير: داخل المجال → اعتماد، خارجه → إلغاء النموذج
      }
      if (!D) continue;
      // الكتف الأيمن E: قمة/قاع معاكس يؤكد بعد ≥3 شموع من D قبل تفعيل العودة (ص1585–1587)
      const E = series.find(s => s.kind !== B.kind && s.idx - D!.idx >= P.sepCandles && s.confirmedAt > D!.confirmedAt);
      if (!E) continue;
      // شرط النضج (خطة التحويل — J فقط): توازن الكتفين — الكتف الأيمن قرب الأيسر ضمن
      // ثلث ارتفاع الرأس، فيُرفض النموذج الملتوي (الكتف الأيمن البعيد عن الكتف الأيسر)
      if (st === 'J') {
        const imbalance = Math.abs(E.price - A.price) / PIP;
        if (imbalance > headBreak / 3) continue;
      }
      // موجة العودة: السعر يعود لمستوى الكتف الأيسر A ضمن نافذة 60–1440 دقيقة من D
      const wStart = D.confirmedAt + P.windowMinMin * 60e3;
      const wEnd = D.confirmedAt + P.windowMinMax * 60e3;
      let knownAt = 0;
      const cStart = idxFrom(c, D.confirmedAt);
      for (let bi = cStart; bi < c.length; bi++) {
        const bar = c[bi];
        const bt = bar.t + ms;
        if (bt < wStart) continue;
        if (bt > wEnd) break;
        const reached = bearish ? bar.h >= A.price - pips(P.exec.entryPips) : bar.l <= A.price + pips(P.exec.entryPips);
        if (reached) { knownAt = bt; break; }
      }
      if (!knownAt) continue;
      const key = `${st}:${tf}:${A.t}`;
      const sell = bearish;
      const entry = sell ? A.price - pips(P.exec.entryPips) : A.price + pips(P.exec.entryPips);
      const slPips = P.exec.entryPips + P.exec.slPips;
      const dTargetDist = Math.abs(entry - D.price) / PIP;
      const tpPips = P.exec.tpUseD && dTargetDist >= P.exec.dTargetMinPips ? dTargetDist : P.exec.fixedTpPips;
      const g = gateDir(ctx, st as StrategyId, cs, cfg, sell ? 'sell' : 'buy', knownAt);
      if (!g.ok) { consumeLevel(st as StrategyId, key); continue; }
      push(out, {
        strategy: st as StrategyId, case: cs, scenario: g.scenario, dir: sell ? 'sell' : 'buy',
        entry, slPips, tpPips, refLevel: A.price, levelKey: key, knownAt,
        reason: `نموذج رأس وكتفين ${bearish ? 'هابط' : 'صاعد مقلوب'} على ${tf}: A=${A.price.toFixed(2)} C=${C.price.toFixed(2)} D=${D.price.toFixed(2)} — ماركت عند عودة السعر لمستوى الكتف الأيسر ${P.exec.entryPips > 0 ? `(قبل الملامسة بـ${P.exec.entryPips} بيب)` : '(عودة مؤكدة عند المستوى — خطة التحويل)'}، وقف ${P.exec.slPips} خلفه، هدف ${P.exec.tpUseD && dTargetDist >= P.exec.dTargetMinPips ? `عند D (${Math.round(dTargetDist)} بيب)` : `ثابت ${P.exec.fixedTpPips}`}`,
        expiresAt: knownAt + 12 * 3600e3,
      });
    }
  };

  for (const tf of tfs) {
    const c = tf === '5m' ? inp.c5 : tf === '15m' ? inp.c15 : tf === '1h' ? inp.c1h : inp.c4h;
    runPattern(c, tf, P.bear, 'bear', true);
    runPattern(c, tf, P.bull, 'bull', false);
  }
  return out;
}
export function detectJ(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] { return detectHS(inp, ctx, 'J'); }
export function detectK(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] { return detectHS(inp, ctx, 'K'); }

// ============================================================
// L: فيبوناتشي متعدد الفريمات — مراسٍ معتمدة بكسر BOS (الجزء صفر + الدليل ص1953–2102)
// M: فيبو جلسة آسيا المعدل — نطاق الجلسة الآسيوية + مستوى 23.6% — آسيا حصراً (ص2103–2215)
// ============================================================
function detectFib(inp: DetectorsInput, ctx: DetectorsCtx, st: 'L' | 'M'): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = st === 'L' ? ctx.params.L : ctx.params.M;
  if (!P.enabled) return out;
  const ms15 = TF_MS['15m'];
  const levels = st === 'L' ? (P as LParams).levels : [(P as MParams).extraLevel, ...P_L_LEVELS];

  const emitLine = (line: number, knownBase: number, waveTxt: string, keyBase: string, tf: TF, cfgRev: CaseCfg, cfgBrk: CaseCfg, capT: number) => {
    const revKey = `${keyBase}:rev:${line.toFixed(2)}`;
    const brkKey0 = `${keyBase}:brk:${line.toFixed(2)}`;
    if (isConsumed(st, revKey) && isConsumed(st, brkKey0)) return;
    let revDone = false, brkDone = false;
    const startIdx = idxFrom(inp.c15, knownBase);
    for (let bi = startIdx; bi < inp.c15.length; bi++) {
      const bar = inp.c15[bi];
      const bt = bar.t + ms15;
      if (bt > capT) break;
      const distPips = Math.abs(bar.c - line) / PIP;
      const bodyUp = (bar.c - line) / PIP, totalUp = (bar.h - line) / PIP;
      const bodyDown = (line - bar.c) / PIP, totalDown = (line - bar.l) / PIP;
      // الارتداد: السعر فوق الخط يهبط نحوه → شراء / تحته يصعد → بيع (الدليل ص2016–2018)
      if (!revDone && distPips <= 20) {
        const dir: 'buy' | 'sell' = bar.c > line ? 'buy' : 'sell';
        const entry = dir === 'buy' ? line + pips(P.exec.revEntryPips) : line - pips(P.exec.revEntryPips);
        const g = gateDir(ctx, st, 'rev', cfgRev, dir, bt);
        revDone = true;
        if (!g.ok) { consumeLevel(st, revKey); }
        else push(out, {
          strategy: st, case: 'rev', scenario: g.scenario, dir,
          entry, slPips: P.exec.revEntryPips + P.exec.revSlPips, tpPips: P.exec.revTpPips, refLevel: line, levelKey: revKey, knownAt: bt,
          reason: `فيبو ${waveTxt} على ${tf} (${line.toFixed(2)}) — ارتداد ماركت قبل الخط بـ${P.exec.revEntryPips} بيب، وقف ${P.exec.revSlPips} خلفه، هدف ${P.exec.revTpPips}`,
          expiresAt: bt + 48 * 3600e3,
        });
      }
      // الكسر: جسم 15M ≥30 + تجاوز 100–300 → إعادة اختبار باتجاه الكسر (ص2051–2089)
      if (!brkDone) {
        const brkUp = bodyUp >= P.exec.breakBodyMin && totalUp >= P.exec.breakTotalMin && totalUp <= P.exec.breakTotalMax;
        const brkDown = bodyDown >= P.exec.breakBodyMin && totalDown >= P.exec.breakTotalMin && totalDown <= P.exec.breakTotalMax;
        if (brkUp || brkDown) {
          const dir: 'buy' | 'sell' = brkUp ? 'buy' : 'sell';
          const entry = dir === 'buy' ? line + pips(P.exec.brkEntryPips) : line - pips(P.exec.brkEntryPips);
          const g = gateDir(ctx, st, 'brk', cfgBrk, dir, bt);
          brkDone = true;
          if (!g.ok) { consumeLevel(st, brkKey0); }
          else push(out, {
            strategy: st, case: 'brk', scenario: g.scenario, dir,
            entry, slPips: P.exec.brkEntryPips + P.exec.brkSlPips, tpPips: P.exec.brkTpPips,
            refLevel: line, levelKey: brkKey0, knownAt: bt,
            reason: `كسر فيبو ${waveTxt} (${tf}) ${brkUp ? 'صعوداً' : 'هبوطاً'} بإغلاق 15M ≥${P.exec.breakBodyMin} وتجاوز ${P.exec.breakTotalMin}–${P.exec.breakTotalMax} — ماركت عند إعادة الاختبار قبل الخط بـ${P.exec.brkEntryPips} بيب، وقف ${P.exec.brkSlPips}، هدف ${P.exec.brkTpPips}`,
            expiresAt: bt + 48 * 3600e3,
          });
        }
      }
      if (revDone && brkDone) break;
    }
  };

  if (st === 'L') {
    // مراسي الموجات الدافعة المعتمدة بكسر الهيكل (BOS) — الجزء صفر حصراً
    for (const tf of ['1d', '4h', '1w'] as TF[]) {
      const c = tf === '1d' ? inp.c1d : tf === '4h' ? inp.c4h : inp.c1w;
      const seen = new Set<string>();
      for (const a of findFibAnchors(c, tf, [])) {
        const waveId = `${a.dir}:${a.anchorLowT}:${a.anchorHighT}`;
        if (seen.has(waveId)) continue;
        seen.add(waveId);
        for (const r of levels) {
          const line = fibLevel(a, r);
          emitLine(line, a.knownAt, `${r}% لموجة ${a.dir === 'up' ? 'صاعدة' : 'هابطة'} معتمدة BOS`, `L:${tf}:${waveId}`, tf, P.rev, P.brk, a.knownAt + 45 * 86400e3);
        }
      }
    }
  } else {
    // M: فيبو جلسة آسيا المعدل (الدليل ص2103–2215) — نفس مراسي L (موجات BOS
    // على اليومي/4H/الأسبوعي) + مستوى 23.6% المضاف + حصر التداول داخل آسيا.
    // بروتوكول عزل آسيا: المستوى المختبر في لندن/تداخل/نيويورك قبل آسيا يُستهلك
    // ولا يُعاد تداوله في آسيا (الدليل ص2167–2178). كذلك مستوى 23.6% المضاف
    // يُحظر فوراً في آسيا إن مُسّ أو اخترق أو مُرّ عبره في أي جلسة سابقة (ص2180–2186).
    // نتابع تقدمياً على 15M: لكل مستوى نحدد إن كان مختبراً قبل آسيا (يُحظر) ثم
    // نطلق الارتداد/الكسر في آسيا وفق القواعد.
    const seen = new Set<string>();
    for (const tf of ['1d', '4h', '1w'] as TF[]) {
      const c = tf === '1d' ? inp.c1d : tf === '4h' ? inp.c4h : inp.c1w;
      for (const a of findFibAnchors(c, tf, [])) {
        const waveId = `${a.dir}:${a.anchorLowT}:${a.anchorHighT}`;
        if (seen.has(waveId)) continue;
        seen.add(waveId);
        for (const r of levels) {
          const line = fibLevel(a, r);
          // نافذة العزل: من تأكيد المرساة حتى نهاية الجلسة الآسيوية الأولى التالية
          // نتابع شموع 15M ونحدد: (أ) اختبر في لندن/تداخل/نيويورك قبل آسيا = مُحظر،
          // (ب) أول اقتراب ≤20 بيب في آسيا = لحظة الارتداد،
          // (ج) كسر بجسم 15M ≥30 + تجاوز 100–300 = لحظة الكسر.
          let preTested = false;        // مختبر قبل آسيا → مُحظر في آسيا
          let revDone = false, brkDone = false;
          let asiaDayKey = '';          // يوم آسيا الحالي (بتوقيت دمشق) — لكل يوم آسيا جديد تصفير
          const startIdx = idxFrom(inp.c15, a.knownAt);
          for (let bi = startIdx; bi < inp.c15.length; bi++) {
            const bar = inp.c15[bi];
            const bt = bar.t + ms15;
            if (bt <= a.knownAt) continue;
            const h = syriaHour(bar.t);
            const dnum = Math.floor((bar.t + 3 * 3600e3) / 86400e3);
            const inAsia = h >= 1 && h < 10;
            // اليوم الآسيوي الجديد: إن كان المستوى مختبراً قبل آسيا يُحظر كلياً في ذلك اليوم
            if (inAsia) {
              const ak = `${dnum}`;
              if (ak !== asiaDayKey) {
                asiaDayKey = ak;
                // بمجرد دخول آسيا: إن كان قد مُسّ قبل ذلك في غير آسيا (لندن/تداخل/نيويورك)
                // نُحجبه لهذا اليوم — يستمر الحظر طوال آسيا (قاعدة العزل الآسيوي)
              }
            } else if (h >= 10) {
              // خارج آسيا (لندن/تداخل/نيويورك): ملامسة الخط تُستهلك المستوى لآسيا التالية
              const touched = bar.l <= line + pips(2) && bar.h >= line - pips(2);
              if (touched) preTested = true;
              continue;
            }
            if (!inAsia) continue;
            if (preTested) break; // مختبر سابقاً → لا تداول في آسيا (الدليل ص2167–2178)
            const distPips = Math.abs(bar.c - line) / PIP;
            const bodyUp = (bar.c - line) / PIP, totalUp = (bar.h - line) / PIP;
            const bodyDown = (line - bar.c) / PIP, totalDown = (line - bar.l) / PIP;
            const expAsia = bt + Math.max(1, 10 - h) * 3600e3;
            const revKey = `M:${tf}:${waveId}:${r}:rev:${asiaDayKey}`;
            const brkKey = `M:${tf}:${waveId}:${r}:brk:${asiaDayKey}`;
            // الارتداد: مرة واحدة لكل مستوى في الجلسة — الاتجاه من جهة السعر
            if (!revDone && distPips <= P.exec.revEntryPips) {
              revDone = true;
              const dir: 'buy' | 'sell' = bar.c > line ? 'buy' : 'sell';
              const entry = dir === 'buy' ? line + pips(P.exec.revEntryPips) : line - pips(P.exec.revEntryPips);
              const g = gateDir(ctx, 'M', 'rev', P.rev, dir, bt);
              if (!g.ok) consumeLevel('M', revKey);
              else push(out, {
                strategy: 'M', case: 'rev', scenario: g.scenario, dir,
                entry, slPips: P.exec.revEntryPips + P.exec.revSlPips, tpPips: P.exec.revTpPips,
                refLevel: line, levelKey: revKey, knownAt: bt,
                reason: `فيبو آسيا ${r}% (${line.toFixed(2)}) لموجة ${a.dir === 'up' ? 'صاعدة' : 'هابطة'} ${tf} معتمدة BOS — ارتداد ماركت قبل الخط بـ${P.exec.revEntryPips} بيب، وقف ${P.exec.revSlPips} خلفه، هدف ${P.exec.revTpPips} (ينتهي بنهاية آسيا)`,
                expiresAt: expAsia,
              });
            }
            // الكسر: جسم 15M ≥30 + تجاوز 100–300 → إعادة اختبار (مرة واحدة)
            if (!brkDone) {
              const brkUp = bodyUp >= P.exec.breakBodyMin && totalUp >= P.exec.breakTotalMin && totalUp <= P.exec.breakTotalMax;
              const brkDown = bodyDown >= P.exec.breakBodyMin && totalDown >= P.exec.breakTotalMin && totalDown <= P.exec.breakTotalMax;
              if (brkUp || brkDown) {
                brkDone = true;
                const dir: 'buy' | 'sell' = brkUp ? 'buy' : 'sell';
                const entry = dir === 'buy' ? line + pips(P.exec.brkEntryPips) : line - pips(P.exec.brkEntryPips);
                const g = gateDir(ctx, 'M', 'brk', P.brk, dir, bt);
                if (!g.ok) consumeLevel('M', brkKey);
                else push(out, {
                  strategy: 'M', case: 'brk', scenario: g.scenario, dir,
                  entry, slPips: P.exec.brkEntryPips + P.exec.brkSlPips, tpPips: P.exec.brkTpPips,
                  refLevel: line, levelKey: brkKey, knownAt: bt,
                  reason: `كسر فيبو آسيا ${r}% (${line.toFixed(2)}) ${brkUp ? 'صعوداً' : 'هبوطاً'} بإغلاق 15M ≥${P.exec.breakBodyMin} وتجاوز ${P.exec.breakTotalMin}–${P.exec.breakTotalMax} — إعادة اختبار قبل الخط بـ${P.exec.brkEntryPips} بيب، وقف ${P.exec.brkSlPips}، هدف ${P.exec.brkTpPips}`,
                  expiresAt: expAsia,
                });
              }
            }
            if (revDone && brkDone) break;
          }
        }
      }
    }
  }
  return out;
}
const P_L_LEVELS = [38.2, 50.0, 61.8];
export function detectL(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] { return detectFib(inp, ctx, 'L'); }
export function detectM(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] { return detectFib(inp, ctx, 'M'); }

// ============================================================
// N: مستويات أمريكا التاريخية (آسيا + أمريكا) — O: آسيا التاريخية (آسيا)
// الدليل ص2216–2495: مستودع قطع الجلسات التاريخية → أول اقتراب ≤150 بيب
// يطلق الارتداد (ماركت قبل الخط بـ20) → إن فشل وكسر الخط (جسم 15M ≥50 +
// تجاوز 100–300) → صفقة استمرارية معاكسة: قاع مكسور → بيع، قمة مكسورة → شراء
// ============================================================
function detectHistoricalLevels(inp: DetectorsInput, ctx: DetectorsCtx, st: 'N' | 'O'): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = st === 'N' ? ctx.params.N : ctx.params.O;
  if (!P.enabled) return out;
  const c5 = inp.c5, ms5 = TF_MS['5m'], ms15 = TF_MS['15m'];
  const exec = P.exec;
  const approachPips = P.approachPips;

  // بناء مستويات القطع التاريخية من شموع 5M — نوع المستوى من القطعة نفسها
  interface HistLevel { line: number; isHigh: boolean; formT: number; kind: 'asia' | 'us' }
  const levels: HistLevel[] = [];
  let segHigh = -Infinity, segLow = Infinity, segKind: 'asia' | 'us' | null = null;
  const closeSeg = (t: number) => {
    if (segKind && segHigh < Infinity) {
      levels.push({ line: segHigh, isHigh: true, formT: t, kind: segKind });
      levels.push({ line: segLow, isHigh: false, formT: t, kind: segKind });
    }
    segHigh = -Infinity; segLow = Infinity;
  };
  for (const bar of c5) {
    const h = syriaHour(bar.t);
    const kind: 'asia' | 'us' | null = h < 10 ? 'asia' : h >= 15 ? 'us' : null;
    if (kind !== segKind) { closeSeg(bar.t); segKind = kind; }
    if (kind) { segHigh = Math.max(segHigh, bar.h); segLow = Math.min(segLow, bar.l); }
  }
  closeSeg(c5[c5.length - 1]?.t ?? Date.now());

  for (const lv of levels) {
    const wantKind: 'asia' | 'us' = st === 'N' ? 'us' : 'asia';
    if (lv.kind !== wantKind) continue;
    const key = `${st}:${lv.formT}:${lv.isHigh ? 'H' : 'L'}:${lv.line.toFixed(2)}`;
    if (isConsumed(st, key)) continue;
    const sell = lv.isHigh;
    // خطة التحويل — حداثة المستوى O: آخر 20 جلسة آسيا فقط (~28 يوماً) بدل 30 يوماً افتراضياً
    // الأثر المتوقع: إما حياة جديدة (مستويات حديثة أنشط) أو إعتزال هادئ (إشارات قديمة بلا جودة)
    const recencyDays = st === 'O' ? ((P as OParams).recencyDays ?? 30) : 30;
    const capQ = lv.formT + recencyDays * 86400e3;
    // أول اقتراب ≤150 بيب بعد التكوين = لحظة السحب الفعلية (لا أقصى نهاية نافذة)
    let knownAt = 0;
    let sessOpen = 0, sessId = '';
    let openOk = true;
    for (const bar of c5) {
      if (bar.t > capQ) break;
      if (bar.t + ms5 <= lv.formT) continue;
      const h = syriaHour(bar.t);
      const sk: 'asia' | 'us' | 'mid' = h < 10 ? 'asia' : h >= 15 ? 'us' : 'mid';
      if (sk !== 'mid') {
        const sid = `${sk}:${Math.floor((bar.t + 3 * 3600e3) / 86400e3)}`;
        if (sid !== sessId) { sessId = sid; sessOpen = bar.o; openOk = true; }
      }
      const dist = Math.min(Math.abs(bar.h - lv.line), Math.abs(lv.line - bar.l)) / PIP;
      // N: شرط ابتعاد الافتتاح 250 بيب (ص2237–2242) — افتتاح الجلسة قريب جداً → لا تفعيل فيها
      if (st === 'N' && Math.abs(sessOpen - lv.line) / PIP < (P as NParams).openDistPips) openOk = false;
      if (dist <= approachPips) {
        if (openOk) knownAt = bar.t + ms5;
        break; // أول اقتراب ينتهي دور المستوى سواء تفعّل أو لا
      }
    }
    if (!knownAt) continue;
    const dir: 'buy' | 'sell' = sell ? 'sell' : 'buy';
    const entry = sell ? lv.line - pips(exec.revEntryPips) : lv.line + pips(exec.revEntryPips);
    const slPips = exec.revEntryPips + exec.revSlPips;
    const g = gateDir(ctx, st, 'rev', P.rev, dir, knownAt);
    if (!g.ok) { consumeLevel(st, key); continue; }
    push(out, {
      strategy: st, case: 'rev', scenario: g.scenario, dir,
      entry, slPips, tpPips: exec.revTpPips, refLevel: lv.line, levelKey: key, knownAt,
      reason: `مستوى ${st === 'N' ? 'أمريكا' : 'آسيا'} التاريخي ${lv.isHigh ? 'قمة' : 'قاع'} (${lv.line.toFixed(2)}) غير المختبر — أول اقتراب ≤${approachPips} بيب: سحب سيولة ${exec.revEntryPips > 0 ? `ماركت قبل الخط بـ${exec.revEntryPips} بيب` : 'ماركت عند اختبار الخط مباشرة'}، وقف ${exec.revSlPips}، هدف ${exec.revTpPips}`,
      expiresAt: knownAt + 24 * 3600e3,
    });
    // الكسر وتبادل الأدوار (بعد فشل الارتداد): 15M جسم ≥50 + تجاوز 100–300
    // الدليل ص2315–2334: قاع مكسور → بيع مستمر، قمة مكسورة → شراء مستمر
    for (const bar of inp.c15) {
      if (bar.t + ms15 <= knownAt) continue;
      const brkUp = sell ? (bar.c - lv.line) / PIP : 0; // قمة: كسر صاعد فوق الخط
      const brkDown = sell ? 0 : (lv.line - bar.c) / PIP; // قاع: كسر هابط تحت الخط
      const totalUp = (bar.h - lv.line) / PIP, totalDown = (lv.line - bar.l) / PIP;
      const upBreak = sell && brkUp >= exec.bodyBreakMin && totalUp >= exec.totalMin && totalUp <= exec.totalMax;
      const downBreak = !sell && brkDown >= exec.bodyBreakMin && totalDown >= exec.totalMin && totalDown <= exec.totalMax;
      if (!upBreak && !downBreak) continue;
      // قمة مكسورة → شراء، قاع مكسور → بيع (استمرارية تبادل الأدوار)
      const brkDir: 'buy' | 'sell' = upBreak ? 'buy' : 'sell';
      const brkEntry = brkDir === 'buy' ? lv.line + pips(exec.brkEntryPips) : lv.line - pips(exec.brkEntryPips);
      const brkKey = `${key}:brk`;
      const g2 = gateDir(ctx, st, 'brk', P.brk, brkDir, bar.t + ms15);
      if (!g2.ok) { consumeLevel(st, brkKey); break; }
      push(out, {
        strategy: st, case: 'brk', scenario: g2.scenario, dir: brkDir,
        entry: brkEntry, slPips: exec.brkEntryPips + exec.brkSlPips, tpPips: exec.brkTpPips,
        refLevel: lv.line, levelKey: brkKey, knownAt: bar.t + ms15,
        reason: `${lv.isHigh ? 'قمة' : 'قاع'} ${st === 'N' ? 'أمريكا' : 'آسيا'} التاريخي انكسر (${brkDir === 'buy' ? 'شراء استمرارية' : 'بيع استمرارية'}) بإغلاق 15M ≥${exec.bodyBreakMin} وتجاوز ${exec.totalMin}–${exec.totalMax} — ماركت قبل الخط المكسور بـ${exec.brkEntryPips} بيب، وقف ${exec.brkSlPips} خلفه، هدف ${exec.brkTpPips}`,
        expiresAt: bar.t + ms15 + 24 * 3600e3,
      });
      break;
    }
  }
  return out;
}
export function detectN(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] { return detectHistoricalLevels(inp, ctx, 'N'); }
export function detectO(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] { return detectHistoricalLevels(inp, ctx, 'O'); }

// ============================================================
// P: احترام أمريكا لمستوياتها (لندن ونيويورك + نيويورك)
// ============================================================
export function detectP(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.P;
  if (!P.enabled) return out;
  const c5 = inp.c5;

  // نفس مستودع أمريكا التاريخية (قمم/قيعان جلسات أمريكا غير المختبرة)
  let segHigh = -Infinity, segLow = Infinity, segStart = 0, inUS = false;
  const levels: { line: number; isHigh: boolean; formT: number }[] = [];
  for (const bar of c5) {
    const h = syriaHour(bar.t);
    const isUS = h >= 15;
    if (isUS !== inUS) {
      if (inUS && segHigh < Infinity) {
        levels.push({ line: segHigh, isHigh: true, formT: bar.t });
        levels.push({ line: segLow, isHigh: false, formT: bar.t });
      }
      segHigh = -Infinity; segLow = Infinity; inUS = isUS;
    }
    if (isUS) { segHigh = Math.max(segHigh, bar.h); segLow = Math.min(segLow, bar.l); }
  }
  for (const lv of levels) {
    const key = `P:${lv.formT}:${lv.isHigh ? 'H' : 'L'}:${lv.line.toFixed(2)}`;
    if (isConsumed('P', key)) continue;
    const sell = lv.isHigh;
    // أول اقتراب ≤150 بيب في جلسة لاحقة لجلسة التكوّن = لحظة الاحترام الفعلية (ص2512–2527)
    let knownAt = 0, killed = false;
    for (const bar of c5) {
      if (bar.t + TF_MS['5m'] <= lv.formT) continue;
      const dist = Math.min(Math.abs(bar.h - lv.line), Math.abs(lv.line - bar.l)) / PIP;
      if (dist <= P.approachPips) { knownAt = bar.t + TF_MS['5m']; break; }
      // اختراق صريح بعيد عن المستوى دون توقف → المستوى مات (لم يحترمه صانع السوق)
      const crossed = sell ? bar.c > lv.line + pips(300) : bar.c < lv.line - pips(300);
      if (crossed) { killed = true; break; }
    }
    if (killed || !knownAt) continue;
    const dir = sell ? 'sell' : 'buy';
    const entry = sell ? lv.line - pips(P.entryPips) : lv.line + pips(P.entryPips);
    const slPips = P.entryPips + P.slPips;
    const g = gateDir(ctx, 'P', 'rev', P.rev, dir, knownAt);
    if (!g.ok) { consumeLevel('P', key); continue; }
    push(out, {
      strategy: 'P', case: 'rev', scenario: g.scenario, dir,
      entry, slPips, tpPips: P.tpPips, refLevel: lv.line, levelKey: key, knownAt,
      reason: `احترام أمريكا لمستواها التاريخي ${lv.isHigh ? 'القممي' : 'القاعي'} (${lv.line.toFixed(2)}) — أول اقتراب ≤${P.approachPips} بيب: ${P.entryPips > 0 ? `ماركت قبل الخط بـ${P.entryPips} بيب` : 'ماركت عند اختبار الخط مباشرة (حارس لا مطارد)'}، وقف ${P.slPips}، هدف ${P.tpPips}`,
      expiresAt: knownAt + 24 * 3600e3,
    });
  }
  return out;
}

// ============================================================
// Q: ذيول آسيا المنفردة الكبيرة (1H/4H) — آسيا حصراً
// ============================================================
export function detectQ(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.Q;
  if (!P.enabled) return out;

  const scan = (c: Candle[], tf: TF) => {
    const ms = TF_MS[tf];
    for (let i = P.checkCandles; i + P.checkCandles < c.length; i++) {
      const bar = c[i];
      const upperWick = bar.h - Math.max(bar.o, bar.c);
      const lowerWick = Math.min(bar.o, bar.c) - bar.l;
      for (const isUpper of [true, false]) {
        const wick = isUpper ? upperWick : lowerWick;
        if (wick / PIP < P.wickMinPips) continue;
        const tip = isUpper ? bar.h : bar.l;
        // شرط الانفراد: الشموع المجاورة (قبل وبعد) بعيدة ≥150 بيب عن طرف الذيل
        let isolated = true;
        for (let j = i - P.checkCandles; j <= i + P.checkCandles; j++) {
          if (j === i || j < 0 || j >= c.length) continue;
          const nb = c[j];
          const dist = isUpper ? (tip - nb.h) / PIP : (nb.l - tip) / PIP;
          if (dist < P.isolationPips) { isolated = false; break; }
        }
        if (!isolated) continue;
        const knownAt = c[i + P.checkCandles].t + ms; // معروف بعد اكتمال شموع الفحص
        // شرط الاختبار المسبق: لم يعد السعر لدخول نطاق الذيل من التكوين حتى الآن (ص2602–2603)
        const wickBase = isUpper ? Math.max(bar.o, bar.c) : Math.min(bar.o, bar.c);
        let pretested = false;
        for (const b of inp.c5) {
          if (b.t + TF_MS['5m'] <= bar.t + TF_MS[tf]) continue;
          if (b.t >= knownAt) break;
          if (isUpper ? b.h >= wickBase : b.l <= wickBase) { pretested = true; break; }
        }
        if (pretested) continue;
        // شرط افتتاح آسيا: السعر عند الافتتاح ≥200 بيب عن طرف الذيل وإلا أُلغي (ص2599–2601)
        let asiaOpen = 0;
        const sIdx = idxFrom(inp.c5, knownAt - 9 * 3600e3);
        for (let si = sIdx; si < inp.c5.length; si++) {
          const hh = syriaHour(inp.c5[si].t);
          if (hh >= 1 && hh < 10) { asiaOpen = inp.c5[si].o; break; }
        }
        if (!asiaOpen || Math.abs(asiaOpen - tip) / PIP < P.asiaOpenMinPips) continue;
        const key = `Q:${tf}:${bar.t}:${isUpper ? 'U' : 'L'}`;
        const dir = isUpper ? 'sell' : 'buy';
        const entry = isUpper ? tip - pips(P.entryPips) : tip + pips(P.entryPips);
        const slPips = P.entryPips + P.slPips;
        const cfg = isUpper ? P.upper : P.lower;
        const g = gateDir(ctx, 'Q', isUpper ? 'upper' : 'lower', cfg, dir, knownAt);
        if (!g.ok) { consumeLevel('Q', key); continue; }
        push(out, {
          strategy: 'Q', case: isUpper ? 'upper' : 'lower', scenario: g.scenario, dir,
          entry, slPips, tpPips: P.tpPips, refLevel: tip, levelKey: key, knownAt,
          reason: `ذيل ${isUpper ? 'علوي' : 'سفلي'} منفرد على ${tf} بطول ${Math.round(wick / PIP)} بيب وعزل ${P.isolationPips} بيب — ماركت قبل طرف الذيل بـ${P.entryPips} بيب، وقف ${P.slPips} بعد نهايته، هدف ${P.tpPips} (ينتهي بنهاية آسيا)`,
          expiresAt: knownAt + Math.max(1, 10 - syriaHour(knownAt)) * 3600e3,
        });
      }
    }
  };
  scan(inp.c1h, '1h');
  scan(inp.c4h, '4h'); // 4H أولوية أعلى عند التداخل (يُحل في سلم الأولويات)
  return out;
}

// ============================================================
// R: شمعة بيبا الانعكاسية (R1 شرائية / R2 بيعية)
// ============================================================
export function detectR(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.R;
  if (!P.enabled) return out;

  const scan = (c: Candle[], tf: TF, beba: typeof P.r1, cs: 'r1' | 'r2', bullish: boolean) => {
    if (!beba.enabled) return;
    const ms = TF_MS[tf];
    for (let i = beba.lookback; i < c.length; i++) {
      const bar = c[i];
      const green = bar.c > bar.o, red = bar.c < bar.o;
      if (bullish && !green) continue;
      if (!bullish && !red) continue;
      const th = (bar.h - bar.l) / PIP;
      if (th < beba.minTotalPips) continue;
      // فلتر الموقع: أدنى قاع / أعلى قمة مقارنة بالشموع الخمس السابقة
      const prev = c.slice(i - beba.lookback, i);
      if (bullish && bar.l > Math.min(...prev.map(b => b.l))) continue;
      if (!bullish && bar.h < Math.max(...prev.map(b => b.h))) continue;
      const body = Math.abs(bar.c - bar.o);
      const bodyPct = (body / (bar.h - bar.l)) * 100;
      if (bodyPct < beba.bodyMinPct || bodyPct > beba.bodyMaxPct) continue;
      // الذيل الصغير (ذيل الرأس): R1 = الذيل السفلي Open−Low ≤5% (الجسم في الأسفل تماماً)
      // R2 = الذيل العلوي High−Open ≤5% (الجسم في الأعلى تماماً) — الدليل ص2719–2721/2766–2771
      const smallTail = bullish ? (bar.o - bar.l) / PIP : (bar.h - bar.o) / PIP;
      if ((smallTail / th) * 100 > beba.tailMaxPct) continue;
      const knownAt = bar.t + ms;
      const key = `R:${cs}:${tf}:${bar.t}`;
      const dir = bullish ? 'buy' : 'sell';
      // فلتر الترند بمؤشر EMA على H4 واليومي (ص2732–2734/2782–2784)
      if (beba.trendFilter) {
        const ema = ctx.emaAt(knownAt);
        if (ema) {
          if (bullish && ema !== 'up') continue;
          if (!bullish && ema !== 'down') continue;
        }
      }
      const entry = bar.c; // تنفيذ ماركت لحظة الإغلاق مباشرة
      const slPips = beba.slPips + (body / PIP); // 70 بيب أسفل/أعلى جسم الشمعة
      const toggles = beba.sessions;
      const sk = sessionAt(knownAt);
      if (!toggles[sk]) { consumeLevel('R', key); continue; }
      push(out, {
        strategy: 'R', case: cs, scenario: bullish ? 1 : 2, dir,
        entry, slPips, tpPips: beba.tpPips, refLevel: bar.c, levelKey: key, knownAt,
        reason: `شمعة بيبا ${bullish ? 'شرائية (مطرقة خضراء مقلوبة)' : 'بيعية (مطرقة حمراء)'} على ${tf}: طول ${Math.round(th)} بيب، جسم ${Math.round(bodyPct)}% — دخول ماركت لحظة الإغلاق، وقف ${beba.slPips} بيب خلف الجسم، هدف ${beba.tpPips}`,
        expiresAt: knownAt + 12 * 3600e3,
      });
    }
  };

  const tfMap: Record<string, Candle[]> = { m5: inp.c5, m15: inp.c15, m30: inp.c30, h1: inp.c1h };
  const tfKey: Record<string, TF> = { m5: '5m', m15: '15m', m30: '30m', h1: '1h' };
  for (const k of Object.keys(tfMap)) {
    if (!P.tfs[k as keyof typeof P.tfs]) continue;
    scan(tfMap[k], tfKey[k], P.r1, 'r1', true);
    scan(tfMap[k], tfKey[k], P.r2, 'r2', false);
  }
  return out;
}

// ============================================================
// سلسلة Aurum (S–W) — منقولة من مستودع zero-was-here/tradingbot
// استراتيجيات محققة بحثياً على الذهب مع تكييفها لنظام الجلسات
// (توقيت دمشق) وآلية الأوامر المعلقة/الوقف والهدف بالبيب.
// ============================================================

// ---------- أدوات محلية للسلسلة ----------
const rsiWilder = (closes: number[], n: number): number[] => {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length < n + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let ag = gain / n, al = loss / n;
  out[n] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (n - 1) + Math.max(0, d)) / n;
    al = (al * (n - 1) + Math.max(0, -d)) / n;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
};

const rollMean = (v: number[], n: number): number[] => {
  const out = new Array<number>(v.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= n) s -= v[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
};

const rollStd = (v: number[], n: number): number[] => {
  const out = new Array<number>(v.length).fill(NaN);
  for (let i = n - 1; i < v.length; i++) {
    let s = 0, s2 = 0;
    for (let j = i - n + 1; j <= i; j++) { s += v[j]; s2 += v[j] * v[j]; }
    const m = s / n;
    out[i] = Math.sqrt(Math.max(0, s2 / n - m * m));
  }
  return out;
};

const rollSma = rollMean;
const rollSumAbsDiff = (v: number[], n: number): number[] => {
  const out = new Array<number>(v.length).fill(NaN);
  for (let i = n; i < v.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += Math.abs(v[j] - v[j - 1]);
    out[i] = s;
  }
  return out;
};

// ============================================================
// T: انفجار ضغط التقلب TTM Squeeze — Aurum VolatilitySqueeze
// بولنجر(20,2) داخل كيلتنر(EMA20 ± 1.5×ATR20) على H1: عند خروج
// البولنجر من الكيلتنر بعد انضغاط ≥6 شموع → دخول باتجاه الزخم.
// ============================================================
export function detectT(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.T;
  if (!P.enabled) return out;
  const c = inp.c1h, ms = TF_MS['1h'];
  if (c.length < Math.max(P.n, P.momN, 60) + P.minSqueeze + 2) return out;
  const closes = c.map(x => x.c);
  const lcs = closes.map(x => Math.log(x));
  const mid = rollMean(closes, P.n);
  const sd = rollStd(closes, P.n);
  const emaArr = (() => {
    const e: number[] = []; const k = 2 / (P.n + 1); let prev = closes[0];
    for (let i = 0; i < closes.length; i++) { prev = i === 0 ? closes[0] : closes[i] * k + prev * (1 - k); e.push(prev); }
    return e;
  })();
  const atrArr = atr(c, P.n);
  const dLc = lcs.map((v, i) => (i > 0 ? v - lcs[i - 1] : 0));
  const vol = rollStd(dLc.slice(1), 120);      // تقلب فروقات اللوغاريتم (نافذة 120)
  for (let i = Math.max(P.n, P.momN, 121); i < c.length; i++) {
    const kc = P.kcMult * (atrArr[i] ?? NaN);
    const on = Number.isFinite(kc) && (mid[i] + P.bbK * sd[i] < emaArr[i] + kc) && (mid[i] - P.bbK * sd[i] > emaArr[i] - kc);
    if (on) continue;
    // الانفجار: كانت مضغوطة (run يحسب الشموع السابقة) — نتحقق عبر إعادة تتبع
    let sq = 0;
    for (let j = i - 1; j >= 0 && (mid[j] + P.bbK * sd[j] < emaArr[j] + P.kcMult * (atrArr[j] ?? NaN)) && (mid[j] - P.bbK * sd[j] > emaArr[j] - P.kcMult * (atrArr[j] ?? NaN)); j--) sq++;
    if (sq < P.minSqueeze) continue;
    const v = vol[i - 1 - 1];   // vol محسوبة على slice(1) — انزياح الفهرس
    if (!Number.isFinite(v) || v <= 0) continue;
    const z = (lcs[i] - lcs[i - P.momN]) / (v * Math.sqrt(P.momN));
    if (!Number.isFinite(z) || z === 0) continue;
    const dir = z > 0 ? 'buy' : 'sell';
    const knownAt = c[i].t + ms;
    const g = gateDir(ctx, 'T', 'main', P.main, dir, knownAt);
    if (!g.ok) continue;
    const a = atrArr[i] ?? 0;
    if (a <= 0) continue;
    push(out, {
      strategy: 'T', case: 'main', scenario: g.scenario, dir,
      entry: closes[i],
      slPips: Math.max(20, Math.round(P.slAtrMult * a / PIP)),
      tpPips: Math.max(30, Math.round(P.tpAtrMult * a / PIP)),
      refLevel: closes[i], levelKey: `T:${c[i].t}`, knownAt,
      reason: `انفجار ضغط التقلب بعد انضغاط ${sq} شمعة H1 — زخم ${P.momN} شمعة z=${z.toFixed(2)} باتجاه ${dir === 'buy' ? 'صاعد' : 'هابط'}، وقف ${P.slAtrMult}×ATR هدف ${P.tpAtrMult}×ATR`,
      expiresAt: knownAt + P.holdBars * 3600e3,
    });
  }
  return out;
}

// ============================================================
// U: ارتداد RSI(2) كونورز — Aurum RSI2
// شراء RSI(2)<10 فوق SMA200 على 15m، بيع RSI(2)>90 تحته،
// ولا إشارة جديدة قبل عودة الإغلاق لـSMA5 (مضاد الحالة).
// ============================================================
export function detectU(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.U;
  if (!P.enabled) return out;
  const c = inp.c15, ms = TF_MS['15m'];
  if (c.length < Math.max(P.trendN, 5 * P.rsiN, 10) + 2) return out;
  const closes = c.map(x => x.c);
  const rsi = rsiWilder(closes, P.rsiN);
  const smaT = rollSma(closes, P.trendN);
  const smaX = rollSma(closes, 5);
  let state = 0; // 0 ساكن، 1 شراء مفتوح، -1 بيع مفتوح
  for (let i = Math.max(P.trendN, 5 * P.rsiN, 10); i < c.length; i++) {
    const cl = closes[i];
    if (state === 1 && Number.isFinite(smaX[i]) && cl < smaX[i]) state = 0;
    else if (state === -1 && Number.isFinite(smaX[i]) && cl > smaX[i]) state = 0;
    if (state !== 0) continue;
    let dir: 'buy' | 'sell' | null = null;
    if (Number.isFinite(smaT[i]) && Number.isFinite(rsi[i])) {
      if (rsi[i] < P.lower && cl > smaT[i]) dir = 'buy';
      else if (rsi[i] > P.upper && cl < smaT[i]) dir = 'sell';
    }
    if (!dir) continue;
    state = dir === 'buy' ? 1 : -1;
    const knownAt = c[i].t + ms;
    const g = gateDir(ctx, 'U', 'main', P.main, dir, knownAt);
    if (!g.ok) continue;
    push(out, {
      strategy: 'U', case: 'main', scenario: g.scenario, dir,
      entry: cl, slPips: P.slPips, tpPips: P.tpPips,
      refLevel: cl, levelKey: `U:${c[i].t}`, knownAt,
      reason: `ارتداد RSI(${P.rsiN})=${rsi[i].toFixed(1)} ${dir === 'buy' ? 'تحت' : 'فوق'} ${dir === 'buy' ? P.lower : P.upper} ${dir === 'buy' ? 'فوق' : 'تحت'} متوسط الترند ${P.trendN}×15m — عودة للمتوسط، وقف ${P.slPips} بيب هدف ${P.tpPips}`,
      expiresAt: knownAt + 45 * 60e3,
    });
  }
  return out;
}

// ============================================================
// V: تلاشي الانحراف الز — Aurum ZScoreFade
// تلاشي |z|>2 للوغاريتم السعر عن متوسطه (48 شمعة H1) فقط عندما
// نسبة كفاءة كوفمان ER<0.3 (سوق غير اتجاهي) على الشمعة السابقة.
// ============================================================
export function detectV(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.V;
  if (!P.enabled) return out;
  const c = inp.c1h, ms = TF_MS['1h'];
  if (c.length < Math.max(P.n, P.erN) + 3) return out;
  const closes = c.map(x => x.c);
  const lcs = closes.map(x => Math.log(x));
  const mean = rollMean(lcs, P.n);
  const sd = rollStd(lcs, P.n);
  const erNum = closes.map((v, i) => (i >= P.erN ? Math.abs(v - closes[i - P.erN]) : NaN));
  const erDen = rollSumAbsDiff(closes, P.erN);
  let state = 0;
  for (let i = Math.max(P.n, P.erN) + 1; i < c.length; i++) {
    const z = (lcs[i] - mean[i]) / sd[i];
    const erPrev = erDen[i - 1] > 0 ? erNum[i - 1] / erDen[i - 1] : NaN;
    const gate = Number.isFinite(erPrev) && erPrev < P.erMax;
    if (state === 1 && (!Number.isFinite(z) || z >= -P.exitZ || !gate)) state = 0;
    else if (state === -1 && (!Number.isFinite(z) || z <= P.exitZ || !gate)) state = 0;
    if (state !== 0 || !gate || !Number.isFinite(z)) continue;
    let dir: 'buy' | 'sell' | null = null;
    // أرضية عتبة خطة التحويل: لا دخول دون |z| = 2.5 حتى لو جاءت المعاملات المخزنة أخف
    const zMin = Math.max(P.entryZ, 2.5);
    if (z < -zMin) dir = 'buy';
    else if (z > zMin) dir = 'sell';
    if (!dir) continue;
    // تأكيد شمعة الرفض (خطة التحويل): التطرف السفلي يُشترى بشمعة مغلقة صاعدة فقط،
    // والتطرف العلوي يُباع بشمعة مغلقة هابطة فقط — بلا شمعة رفض تُنتظر الشمعة التالية
    if (dir === 'buy' ? c[i].c <= c[i].o : c[i].c >= c[i].o) continue;
    state = dir === 'buy' ? 1 : -1;
    const knownAt = c[i].t + ms;
    const g = gateDir(ctx, 'V', 'main', P.main, dir, knownAt);
    if (!g.ok) continue;
    push(out, {
      strategy: 'V', case: 'main', scenario: g.scenario, dir,
      entry: closes[i], slPips: P.slPips, tpPips: P.tpPips,
      refLevel: closes[i], levelKey: `V:${c[i].t}`, knownAt,
      reason: `تلاشي انحراف z=${z.toFixed(2)} (${dir === 'buy' ? 'تحت' : 'فوق'} المتوسط ${P.n}×H1) مع كفاءة كوفمان ${erPrev.toFixed(2)}<${P.erMax} (سوق غير اتجاهي) — عودة للمتوسط، وقف ${P.slPips} بيب هدف ${P.tpPips}`,
      expiresAt: knownAt + 8 * 3600e3,
    });
  }
  return out;
}

// ============================================================
// W: زخم 30 يوماً TSMOM-30d — مكوّن السلة المعتمدة (المتحقق منها على أساس 1000$)
// الزخم = (الإغلاق ÷ إغلاق قبل horizonDays×24 شمعة ساعية) − 1.
// إشارة عند انقلاب اتجاه الزخم فقط (آلة حالة موجب/سالب)، وقف 3×ATR(14)
// ساعي، بلا هدف ثابت (tpPips=0 → الخروج بانعكاس الزخم عبر خروج القاعدة
// في محرك التنفيذ — حرفياً كما في المحاكاة المعتمدة +3167$/سنة PF 3.92).
// لا بوابة ER: التجارب أثبتت أن البوابة أتلف حافة الاتجاه (+2141$ صارت −29$).
// ============================================================
export function detectW(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.W;
  if (!P.enabled) return out;
  const c = inp.c1h, ms = TF_MS['1h'];
  const n = P.horizonDays * 24;
  if (c.length < n + P.atrN * 3) return out;
  const closes = c.map(x => x.c);
  const atrArr = atr(c, P.atrN);
  let last = 0; // اتجاه الزخم السابق (0 = لا شيء)
  for (let i = n; i < c.length; i++) {
    const mom = closes[i] / closes[i - n] - 1.0;
    const want = mom > 0 ? 1 : -1;
    if (want === last) continue;
    last = want;
    const a = atrArr[i];
    if (!Number.isFinite(a) || a <= 0) continue;
    const dir = want === 1 ? 'buy' : 'sell';
    const knownAt = c[i].t + ms;
    const g = gateDir(ctx, 'W', 'main', P.main, dir, knownAt);
    if (!g.ok) continue;
    push(out, {
      strategy: 'W', case: 'main', scenario: g.scenario, dir,
      entry: closes[i],
      slPips: Math.max(30, Math.round(P.slAtrMult * a / PIP)),
      tpPips: 0, // بلا هدف ثابت — الخروج بانعكاس الزخم (خروج القاعدة)
      refLevel: closes[i], levelKey: `W:${c[i].t}`, knownAt,
      market: true, // ماركت على الافتتاح التالي — حرفياً كالمحاكاة المعتمدة
      reason: `انقلاب زخم ${P.horizonDays} يوماً إلى ${dir === 'buy' ? 'صاعد' : 'هابط'} (${(mom * 100).toFixed(2)}%) — TSMOM-30d مكوّن السلة المعتمدة، تنفيذ ماركت على الافتتاح، وقف ${P.slAtrMult}×ATR ساعي، بلا هدف: الربح يجري والخروج بانعكاس الزخم`,
      expiresAt: knownAt + 60 * 60e3,
    });
  }
  return out;
}

// ============================================================
// Y: زخم EWMAC 32/128 — Aurum trend/ewmac (تحقق مزدوج: سنة وسنتان)
// تقاطع EMA 32/128 على الساعة: إشارة عند انقلاب التقاطع، وقف 3×ATR(14)،
// بلا هدف ثابت — الخروج بانعكاس التقاطع (خروج القاعدة في محرك التنفيذ).
// ============================================================
export function detectY(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.Y;
  if (!P.enabled) return out;
  const c = inp.c1h, ms = TF_MS['1h'];
  if (c.length < P.slow * 3) return out;
  const closes = c.map(x => x.c);
  const eF = emaSeries(c, P.fast);
  const eS = emaSeries(c, P.slow);
  const atrArr = atr(c, P.atrN);
  let last = 0;
  for (let i = P.slow * 2; i < c.length; i++) {
    const want = eF[i] > eS[i] ? 1 : -1;
    if (want === last) continue;
    last = want;
    const a = atrArr[i];
    if (!Number.isFinite(a) || a <= 0) continue;
    const dir = want === 1 ? 'buy' : 'sell';
    const knownAt = c[i].t + ms;
    const g = gateDir(ctx, 'Y', 'main', P.main, dir, knownAt);
    if (!g.ok) continue;
    push(out, {
      strategy: 'Y', case: 'main', scenario: g.scenario, dir,
      entry: closes[i],
      slPips: Math.max(30, Math.round(P.slAtrMult * a / PIP)),
      tpPips: 0, // بلا هدف ثابت — الخروج بانعكاس التقاطع (خروج القاعدة)
      refLevel: closes[i], levelKey: `Y:${c[i].t}`, knownAt,
      market: true, // ماركت على الافتتاح التالي — اصطلاح المحاكاة
      reason: `تقاطع EWMAC ${P.fast}/${P.slow} ساعي ${dir === 'buy' ? 'صاعد' : 'هابط'} — تنفيذ ماركت على الافتتاح، وقف ${P.slAtrMult}×ATR، بلا هدف: الخروج بانعكاس التقاطع`,
      expiresAt: knownAt + 60 * 60e3,
    });
  }
  return out;
}

// ============================================================
// AA: اختراق قناة دونشييان 120/60 — Aurum trend/donchian (تحقق مزدوج)
// إغلاق ساعي فوق أعلى قمة 120 شمعة سابقة → شراء (تحت أدنى قاع → بيع)،
// وقف 2×ATR(14)، بلا هدف ثابت — الخروج بكسر القناة المعاكسة 60 شمعة.
// الإشارة عند الاختراق الجديد + إعادة تأكيد كل reassertBars ما دام الشرط قائماً
// (تسمح بإعادة الدخول بعد خروج قاعدة/وقف كما في المحاكاة).
// ============================================================
export function detectAA(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.AA;
  if (!P.enabled) return out;
  const c = inp.c1h, ms = TF_MS['1h'];
  if (c.length < P.entryN + P.atrN * 3) return out;
  const closes = c.map(x => x.c);
  const atrArr = atr(c, P.atrN);
  let lastEmit = -Infinity;
  for (let i = P.entryN; i < c.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - P.entryN; j < i; j++) { hi = Math.max(hi, c[j].h); lo = Math.min(lo, c[j].l); }
    let dir: 'buy' | 'sell' | null = null;
    let fresh = false;
    if (closes[i] > hi) {
      dir = 'buy';
      // اختراق جديد: الإغلاق السابق لم يكن فوق القناة
      // (حماية: عند أول شمعة i=entryN لا توجد قناة سابقة كاملة → ليس جديداً)
      let prevHi = -Infinity;
      if (i >= P.entryN + 1) {
        for (let j = i - 1 - P.entryN; j < i - 1; j++) prevHi = Math.max(prevHi, c[j].h);
        fresh = closes[i - 1] <= prevHi;
      } else {
        fresh = true; // أول اختراق — لا يوجد ماضٍ للمقارنة، يُعد جديداً
      }
    } else if (closes[i] < lo) {
      dir = 'sell';
      let prevLo = Infinity;
      if (i >= P.entryN + 1) {
        for (let j = i - 1 - P.entryN; j < i - 1; j++) prevLo = Math.min(prevLo, c[j].l);
        fresh = closes[i - 1] >= prevLo;
      } else {
        fresh = true;
      }
    }
    if (!dir) continue;
    if (!fresh && i - lastEmit < P.reassertBars) continue;
    const a = atrArr[i];
    if (!Number.isFinite(a) || a <= 0) continue;
    lastEmit = i;
    const knownAt = c[i].t + ms;
    const g = gateDir(ctx, 'AA', 'main', P.main, dir, knownAt);
    if (!g.ok) continue;
    push(out, {
      strategy: 'AA', case: 'main', scenario: g.scenario, dir,
      entry: closes[i],
      slPips: Math.max(30, Math.round(P.slAtrMult * a / PIP)),
      tpPips: 0, // بلا هدف ثابت — الخروج بكسر قناة الخروج (خروج القاعدة)
      refLevel: dir === 'buy' ? hi : lo, levelKey: `AA:${c[i].t}`, knownAt,
      market: true, // ماركت على الافتتاح التالي — اصطلاح المحاكاة
      reason: `اختراق ${fresh ? 'جديد' : 'مستمر'} لدونشييان ${P.entryN} ساعة ${dir === 'buy' ? 'للأعلى' : 'للأسفل'} عند ${closes[i].toFixed(2)} — تنفيذ ماركت على الافتتاح، وقف ${P.slAtrMult}×ATR، بلا هدف: الخروج بكسر القناة المعاكسة ${P.exitN} ساعة`,
      expiresAt: knownAt + 60 * 60e3,
    });
  }
  return out;
}

// ============================================================
// X: بولباك ويندو Sunrise Ogle (ilahuerta-IA — محقق بحثياً على بيانات MT5)
// تراص EMA 14/18/24 على الساعة: ترند صاعد + 1-3 إغلاقات تحت EMA14
// ثم إغلاق كسر فوق قمة آخر شمعتين → شراء (والعكس للبيع).
// وقف 2.5×ATR وهدف 12×ATR — العائد غير المتماثل هو مصدر الحافة
// (payoff 4.27 في المقارنة البحثية). التنفيذ بأمر حد عند إعادة
// اختبار سعر الإغلاق الكاسر خلال نافذة الصلاحية.
// ============================================================

// ============================================================
// Z: انجراف السيولة وإعادة الاستحواذ (Liquidation Sweep & Reclaim — SMC)
// الفكرة البحثية: الشمعة الساعية التي تكسر قاع/قمة محور مؤكد بوشّها فقط
// (صيد الستوبات) ثم تُغلق من جديد خلف المستوى = فشل اختراق واستحواذ،
// وهي من أعلى الحواف إحصائياً في أدبيات SMC (ICT: sweep-and-reclaim).
// الدخول: ماركت على افتتاح الشمعة التالية. الوقف: خلف ذيل السحبة + هامش
// (مقيد بسقف الدستور 15$). الهدف: rr × مسافة الوقف — عائد غير متماثل.
// كل محور يُستهلك مرة واحدة (قاعدة المرة الواحدة عبر levelKey)، والمحور
// الذي كُسر بإغلاق كامل قبل السحبة يُلغى (كان كسراً حقيقياً لا انجرافاً).
// ============================================================
export function detectZ(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.Z;
  if (!P.enabled) return out;
  const c = inp.c1h, ms = TF_MS['1h'];
  if (c.length < P.lookback * 2) return out;
  const ps = P.pivotStrength;
  let lowPiv: { idx: number; t: number; price: number } | null = null;   // آخر قاع مؤكد (سيولة بيعية)
  let highPiv: { idx: number; t: number; price: number } | null = null;  // آخر قمة مؤكدة (سيولة شرائية)
  for (let i = ps; i < c.length; i++) {
    // تأكيد محور جديد عند الشمعة k = i - ps (ps شموع على كل جانب — بلا تسلل مستقبلي)
    const k = i - ps;
    if (k >= ps) {
      let isLow = true, isHigh = true;
      for (let j = k - ps; j <= k + ps; j++) {
        if (j === k) continue;
        if (c[j].l <= c[k].l) isLow = false;
        if (c[j].h >= c[k].h) isHigh = false;
      }
      if (isLow) lowPiv = { idx: k, t: c[k].t, price: c[k].l };
      if (isHigh) highPiv = { idx: k, t: c[k].t, price: c[k].h };
    }
    for (const side of ['buy', 'sell'] as const) {
      const piv = side === 'buy' ? lowPiv : highPiv;
      if (!piv) continue;
      if (i - piv.idx > P.lookback || i - piv.idx < ps + 1) continue;
      const swept = side === 'buy'
        ? c[i].l < piv.price - pips(P.minSweepPips) && c[i].c > piv.price
        : c[i].h > piv.price + pips(P.minSweepPips) && c[i].c < piv.price;
      if (!swept) continue;
      // المستوى لم يُكسر بإغلاق كامل بين تأكيد المحور والسحبة — وإلا فهو كسر لا انجراف
      let intact = true;
      for (let j = piv.idx + ps + 1; j < i; j++) {
        if (side === 'buy' ? c[j].c < piv.price : c[j].c > piv.price) { intact = false; break; }
      }
      if (!intact) continue;
      const entry = c[i].c;
      const knownAt = c[i].t + ms;
      const dir = side;
      const g = gateDir(ctx, 'Z', 'main', P.main, dir, knownAt);
      if (!g.ok) continue;
      const wick = side === 'buy' ? pipsBetween(entry, c[i].l) : pipsBetween(entry, c[i].h);
      const slPips = Math.min(150, Math.max(30, Math.round(wick) + P.slBufPips));
      const tpPips = Math.max(30, Math.round(slPips * P.rr));
      push(out, {
        strategy: 'Z', case: 'main', scenario: g.scenario, dir,
        entry,
        slPips, tpPips,
        refLevel: piv.price, levelKey: `Z:${side}:${piv.t}`, knownAt,
        market: true,
        reason: `انجراف سيولة ${dir === 'buy' ? 'تحت القاع' : 'فوق القمة'} ${piv.price.toFixed(2)} بعمق ≥ ${P.minSweepPips} بيب وإغلاق استحواذ عند ${entry.toFixed(2)} — وقف خلف الذيل ${slPips} بيب، هدف ${P.rr}× الوقف`,
        expiresAt: knownAt + P.expHours * 3600e3,
      });
      if (side === 'buy') lowPiv = null; else highPiv = null; // المحور استُهلك
    }
  }
  return out;
}

export function detectX(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const out: SignalEvent[] = [];
  const P = ctx.params.X;
  if (!P.enabled) return out;
  const c = inp.c1h, ms = TF_MS['1h'];
  if (c.length < P.emaSlow + 10) return out;
  const closes = c.map(x => x.c);
  const eF = emaSeries(c, P.emaFast);
  const eM = emaSeries(c, P.emaMid);
  const eS = emaSeries(c, P.emaSlow);
  const atrArr = atr(c, P.atrN);
  let pullUp = 0, pullDn = 0;
  for (let i = P.emaSlow + 2; i < c.length; i++) {
    const a = atrArr[i];
    if (!Number.isFinite(a) || a <= 0) continue;
    let dir: 'buy' | 'sell' | null = null;
    let pb = 0; // عمق البولباك (للنص التقريري)
    const up = eF[i] > eM[i] && eM[i] > eS[i];
    const dn = eF[i] < eM[i] && eM[i] < eS[i];
    if (up) {
      if (closes[i] < eF[i]) pullUp++;
      else {
        pb = pullUp;
        if (pb >= 1 && pb <= P.pullMax && closes[i] > Math.max(c[i - 1].h, c[i - 2].h)) dir = 'buy';
        pullUp = 0;
      }
      pullDn = 0;
    } else if (dn) {
      if (closes[i] > eF[i]) pullDn++;
      else {
        pb = pullDn;
        if (pb >= 1 && pb <= P.pullMax && closes[i] < Math.min(c[i - 1].l, c[i - 2].l)) dir = 'sell';
        pullDn = 0;
      }
      pullUp = 0;
    } else { pullUp = 0; pullDn = 0; }
    if (!dir) continue;
    const knownAt = c[i].t + ms;
    const g = gateDir(ctx, 'X', 'main', P.main, dir, knownAt);
    if (!g.ok) continue;
    push(out, {
      strategy: 'X', case: 'main', scenario: g.scenario, dir,
      entry: closes[i],
      slPips: Math.max(30, Math.round(P.slAtrMult * a / PIP)),
      tpPips: Math.max(50, Math.round(P.tpAtrMult * a / PIP)),
      refLevel: closes[i], levelKey: `X:${c[i].t}`, knownAt,
      market: true, // ماركت على الافتتاح التالي — حرفياً كالمحاكاة المعتمدة (بلا أمر إعادة اختبار)
      reason: `بولباك Ogle: تراص EMA ${P.emaFast}/${P.emaMid}/${P.emaSlow} ${dir === 'buy' ? 'صاعد' : 'هابط'} + ${pb} شمعة بولباك ثم كسر إغلاقي ${dir === 'buy' ? 'فوق قمتي' : 'تحت قاعي'} آخر شمعتين — تنفيذ ماركت على الافتتاح، وقف ${P.slAtrMult}×ATR هدف ${P.tpAtrMult}×ATR (نسبة غير متماثلة)`,
      expiresAt: knownAt + 60 * 60e3,
    });
  }
  return out;
}

// ============================================================
// المجمّع الكلي — يشغّل كل الكاشفات المفعلة
// ============================================================
export function runAllDetectors(inp: DetectorsInput, ctx: DetectorsCtx): SignalEvent[] {
  const all: SignalEvent[] = [];
  const safe = (fn: () => SignalEvent[], name?: string) => {
    try {
      all.push(...fn());
    } catch (e) {
      // تشخيص: فشل كاشف لا يُسقط النظام لكن يُسجّل دائماً (بلا صمت)
      console.error(`[detector:${name ?? '?'}] فشل الكاشف:`, e instanceof Error ? e.message : e);
    }
  };
  safe(() => detectA(inp, ctx), "A");
  safe(() => detectB(inp, ctx), "B");
  safe(() => detectC(inp, ctx), "C");
  safe(() => detectD(inp, ctx), "D");
  safe(() => detectE(inp, ctx), "E");
  safe(() => detectF(inp, ctx), "F");
  safe(() => detectG(inp, ctx), "G");
  safe(() => detectH(inp, ctx), "H");
  safe(() => detectI(inp, ctx), "I");
  safe(() => detectJ(inp, ctx), "J");
  safe(() => detectK(inp, ctx), "K");
  safe(() => detectL(inp, ctx), "L");
  safe(() => detectM(inp, ctx), "M");
  safe(() => detectN(inp, ctx), "N");
  safe(() => detectO(inp, ctx), "O");
  safe(() => detectP(inp, ctx), "P");
  safe(() => detectQ(inp, ctx), "Q");
  safe(() => detectR(inp, ctx), "R");
  safe(() => detectT(inp, ctx), "T");
  safe(() => detectU(inp, ctx), "U");
  safe(() => detectV(inp, ctx), "V");
  safe(() => detectW(inp, ctx), "W");
  safe(() => detectX(inp, ctx), "X");
  safe(() => detectY(inp, ctx), "Y");
  safe(() => detectAA(inp, ctx), "AA");
  safe(() => detectZ(inp, ctx), "Z");

  // ---- بوابة التنظيم المركزية (خطة التحويل): تصفية العكسية ضد اليومي + حصر C/G/H/O في الهدوء ----
  // مفاتيح التفعيل من القواعد العليا (26 و27) — الافتراضي مفعّلان حفاظاً على خطة التحويل
  const gateTrendOn = ctx.regimeGates?.dailyTrend !== false;
  const gateErOn = ctx.regimeGates?.erQuiet !== false;
  const erSet = ctx.regimeGates?.erIncludeG === false ? ER_GATED_CORE : ER_GATED;
  if (!REGIME_CACHE || REGIME_CACHE.len !== inp.c1d.length) REGIME_CACHE = { len: inp.c1d.length, maps: buildRegimeMaps(inp.c1d) };
  const maps = REGIME_CACHE.maps;
  const keep: SignalEvent[] = [];
  for (const ev of all) {
    const tG = gateTrendOn && TREND_GATED.has(ev.strategy);
    const eG = gateErOn && erSet.has(ev.strategy);
    if (!tG && !eG) { keep.push(ev); continue; }
    const di = lastClosedDailyIdx(inp.c1d, ev.knownAt);
    if (tG && di >= TSMOM_DAYS && maps.trend[di] !== 0) {
      const tr = maps.trend[di];
      if ((tr === 1 && ev.dir !== 'buy') || (tr === -1 && ev.dir !== 'sell')) {
        consumeLevel(ev.strategy, ev.levelKey); // المستوى المرفوض لا يُعاد توليده
        GATE_STATS.dailyTrend[ev.strategy] = (GATE_STATS.dailyTrend[ev.strategy] ?? 0) + 1;
        continue;
      }
      ev.reason += ' | متوافق الاتجاه اليومي';
    }
    if (eG && di >= ER_DAYS && Number.isFinite(maps.er[di]) && maps.er[di] >= ER_QUIET_MAX) {
      consumeLevel(ev.strategy, ev.levelKey);
      GATE_STATS.erQuiet[ev.strategy] = (GATE_STATS.erQuiet[ev.strategy] ?? 0) + 1;
      continue;
    }
    keep.push(ev);
  }
  return keep;
}

/** تحويل إشارة إلى أمر معلق — الأرقام من الإشارة حرفياً (بلا حدود عامة) */
export function signalToSetup(s: SignalEvent, id: number, session: SessionId): Setup {
  const sl = s.dir === 'buy' ? s.entry - pips(s.slPips) : s.entry + pips(s.slPips);
  const tp = s.dir === 'buy' ? s.entry + pips(s.tpPips) : s.entry - pips(s.tpPips);
  return {
    id,
    strategy: s.strategy,
    case: s.case,
    scenario: s.scenario,
    dir: s.dir,
    entry: s.entry,
    slPips: s.slPips,
    tpPips: s.tpPips,
    sl: s.slAnchor ?? sl,
    tp,
    createdAt: s.knownAt,
    expiresAt: s.expiresAt ?? s.knownAt + 24 * 3600e3,
    session,
    reason: s.reason,
    refLevel: s.refLevel,
    levelKey: s.levelKey,
    market: s.market ?? false,
    allowedSessions: (s.allowedSessions ?? ALLOWED_SESSIONS[s.strategy]) as unknown as SessionId[],
  };
}
