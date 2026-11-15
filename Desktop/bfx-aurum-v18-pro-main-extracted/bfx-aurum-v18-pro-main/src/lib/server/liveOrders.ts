// ============================================================
// عقل التنفيذ الحي — الدماغ الدستوري للتعامل المباشر مع MT5
// ------------------------------------------------------------
// المعمارية الاحترافية المعتمدة:
//   • هذا الملف = مصدر الحقيقة الواحد: كل قاعدة عليا تُفحص هنا قبل
//     إصدار أي أمر، والجسر (mt5-bridge.py v21) منفّذ أعمى مقيّد.
//   • الأوامر المعلقة تُنشر كأوامر LIMIT حقيقية في MT5 مع الوقف
//     والهدف مرفقين، وأوامر السلة المتحققة تنفذ ماركت (كما تحققت).
//   • الرفض المقصود: كل ما لا يمر بوابات الدستور لا يصل إلى MT5 أبداً.
//   • التعويض الذاتي (reconcile): الجسر يرسل حالته الفعلية كل دورة
//     (أوامر معلقة + مواقف) والموقع يصحح سجل LiveOrder منها — فلا
//     انفصام بين ما يظنه الموقع وما يفعله MT5 حتى بعد أي إعادة تشغيل.
// ------------------------------------------------------------
// قرارات المالك المطبقة حرفياً:
//   • اللوت الثابت 0.01 بلا أي استثناء (قاعدة 2 + قرار 2026-11-11)
//   • الستوب 15$ حداً أقصى (قاعدة 12 — قرار 2026-11-12)
//   • التأمين مُلغى كلياً (قاعدة 20 معطلة — قرار 2026-11-12): لا يوجد
//     أي أمر تحريك وقف — الوقف يوضع مرة واحدة عند الدخول ولا يُمس.
//   • السقف الزمني 72 ساعة (قاعدة 4): أي موقف تجاوزه → أمر إغلاق فوري
//     حتى لو كان التفعيل الحي معطلاً — القاعدة مطلقة لا إجازة فيها.
// ============================================================
import { db } from '@/lib/db';
import { mt5Feed, isMt5Fresh } from './mt5feed';
import { loadBotSettings, loadRealNews } from './backtestRunner';
import { runBacktestCached } from './backtestCache';
import { basketExitSignals } from '@/lib/engine/backtest';
import { getEngineData } from './data';
import { BASKET_IDS, STRATEGY_NAMES } from '@/lib/engine/types';
import { pushAlert } from './alerts';
import { syriaDayNum, SYRIA_OFFSET_MS } from '@/lib/engine/sessions';
import type { Setup } from '@/lib/engine/types';

export const MAGIC_BASE = 771000;
const ORDERS_TTL_MS = 6_000; // كاش حمولة الأوامر — الجسر يستفسر كل ~4 ثوانٍ

// ---------- مفتاح التفعيل الحي (قرار المالك) ----------
export interface LiveControl {
  enabled: boolean;
  enabledAt?: number;
  disabledAt?: number;
  note?: string;
}

export async function getLiveControl(): Promise<LiveControl> {
  try {
    const row = await db.botSettings.findUnique({ where: { key: 'liveControl' } });
    if (row) return JSON.parse(row.json) as LiveControl;
  } catch { /* الافتراضي */ }
  return { enabled: false };
}

export async function saveLiveControl(next: LiveControl): Promise<LiveControl> {
  await db.botSettings.upsert({
    where: { key: 'liveControl' },
    create: { key: 'liveControl', json: JSON.stringify(next) },
    update: { json: JSON.stringify(next) },
  });
  return next;
}

// ---------- بصمة الخطة في تعليق MT5 (≤31 حرفاً — مفتاح المطابقة) ----------
function planFingerprint(planId: string): string {
  let h = 0;
  for (let i = 0; i < planId.length; i++) h = ((h * 31) + planId.charCodeAt(i)) >>> 0;
  return (h % 0xffffffff).toString(16).padStart(8, '0');
}

export function mt5Comment(strategy: string, planId: string): string {
  return `TAMSA-${strategy}-${planFingerprint(planId)}`;
}

function magicFor(strategy: string): number {
  let h = 0;
  for (const c of strategy) h = ((h * 131) + c.charCodeAt(0)) >>> 0;
  return MAGIC_BASE + (h % 900);
}

// ---------- أنواع قناة الأوامر ----------
export interface LivePlan {
  planId: string;
  strategy: string;
  name: string;
  dir: 'buy' | 'sell';
  entry: number;
  sl: number;
  tp: number;
  lot: number;
  kind: 'limit' | 'market';
  expiresAtMs: number;
  magic: number;
  comment: string;
  reason: string;
}

export interface LiveCloseCmd { ticket: number; reason: 'timestop' | 'daystop' | 'rule'; ageH?: number; profit?: number; why?: string }

export type ExitRuleMap = Record<'W' | 'X' | 'Y' | 'AA', { exitBuy: boolean; exitSell: boolean }>;

const NO_EXIT: ExitRuleMap = {
  W: { exitBuy: false, exitSell: false }, X: { exitBuy: false, exitSell: false },
  Y: { exitBuy: false, exitSell: false }, AA: { exitBuy: false, exitSell: false },
};

export interface LiveOrdersPayload {
  enabled: boolean;
  serverTime: number;
  feedFresh: boolean;
  symbol: string | null;
  account: { login?: string; server?: string; balance?: number; equity?: number } | null;
  config: { lot: number; slCapDollars: number; maxConcurrent: number; timeStopHours: number; dailyLossStop: number | null; dailyProfitStop: number | null };
  state: { session: string | null; openCount: number; openByStrategy: Record<string, number>; workingOrders: number; dayPnlClosed: number; floatingPnl: number; pendingPlans: number; canceledPending: boolean };
  exitRules: ExitRuleMap;
  open: LivePlan[];
  close: LiveCloseCmd[];
  cancelAllPending: boolean;
  note?: string;
}

// ---------- حساب اليوم السوري الحالي ----------
function syriaDayStartMs(now: number): number {
  return syriaDayNum(now) * 86400e3 - SYRIA_OFFSET_MS;
}

// ---------- العقل: بناء حمولة الأوامر ----------
export async function buildLiveOrdersPayload(): Promise<LiveOrdersPayload> {
  const control = await getLiveControl();
  const settings = await loadBotSettings();
  const gr = settings.globalRules as Record<string, { enabled: boolean; value?: number }>;
  const feed = mt5Feed();
  const fresh = isMt5Fresh();
  const now = Date.now();

  const lot = gr.fixed_lot?.enabled ? (gr.fixed_lot.value ?? 0.01) : 0.01;
  const slCapDollars = gr.mandatory_sl?.enabled && (gr.mandatory_sl.value ?? 0) > 0 ? (gr.mandatory_sl.value ?? 0) : 0;
  const maxConcurrent = gr.max_concurrent?.enabled ? (gr.max_concurrent.value ?? 4) : 4;
  const timeStopHours = gr.max_hold_hours?.enabled ? Math.round(gr.max_hold_hours.value ?? 72) : 0;
  const lossStop = gr.daily_loss_stop?.enabled ? (gr.daily_loss_stop.value ?? 50) : null;
  const profitStop = gr.daily_profit_stop?.enabled ? (gr.daily_profit_stop.value ?? 200) : null;

  const positions = feed.positions ?? [];
  const deals = feed.deals ?? [];
  const openCount = positions.length;
  const floatingPnl = positions.reduce((a, p) => a + (Number.isFinite(p.profit) ? p.profit : 0) + (Number.isFinite(p.swap) ? p.swap : 0), 0);

  // ---- خروج القاعدة للسلة المتحققة (W/X/Y/AA) — نفس exit_fn بالمحاكاة على شمعة الساعة المغلقة ----
  const engineData = getEngineData();
  const exitRules: ExitRuleMap = engineData ? basketExitSignals(engineData, settings) : { ...NO_EXIT };

  // ربط المواقف المفتوحة بالاستراتيجيات (التعليق TAMSA-<حرف> أو الماجيك)
  const openByStrategy: Record<string, number> = {};
  let tamsaOpen = 0;
  for (const p of positions) {
    const m = (p.comment ?? '').match(/TAMSA-([A-Z]{1,2})-/);
    const st = m ? m[1] : '?';
    openByStrategy[st] = (openByStrategy[st] ?? 0) + 1;
    if (!BASKET_IDS.includes(st as never)) tamsaOpen++;
  }

  // خسارة/ربح اليوم المغلق من سجل الصفقات الحقيقي (deals خروج اليوم السوري)
  let dayPnlClosed = 0;
  const dayStart = syriaDayStartMs(now);
  for (const d of deals) {
    if (d.entry !== 'out') continue;
    if (!Number.isFinite(d.t) || d.t < dayStart) continue;
    dayPnlClosed += (d.profit ?? 0) + (d.swap ?? 0) + (d.commission ?? 0);
  }
  const equityPnl = dayPnlClosed + floatingPnl;

  // ---- القاعدة 4: السقف الزمني المطلق — يعمل حتى مع تعطيل التفعيل الحي ----
  const close: LiveCloseCmd[] = [];
  for (const p of positions) {
    const ageMs = now - p.t;
    if (timeStopHours > 0 && Number.isFinite(ageMs) && ageMs >= timeStopHours * 3600e3) {
      close.push({ ticket: p.ticket, reason: 'timestop', ageH: Math.round(ageMs / 3600e3 * 10) / 10, profit: Math.round(p.profit * 100) / 100 });
    }
  }

  // ---- القاعدتان 7 و8: إيقاف اليوم (المغلق + العائم) ----
  let dayStopClose = false;
  if (lossStop !== null && equityPnl <= -lossStop) dayStopClose = true;
  if (profitStop !== null && equityPnl >= profitStop) dayStopClose = true;
  if (dayStopClose) {
    for (const p of positions) {
      if (!close.some(c => c.ticket === p.ticket)) close.push({ ticket: p.ticket, reason: 'daystop' });
    }
    pushAlert('fuse', `إيقاف اليوم (القاعدتان 7 و8): ${equityPnl <= 0 ? 'خسارة' : 'ربح'} اليوم ${equityPnl.toFixed(2)}$ — إغلاق الكل ومنع الجديد`,
      `المغلق اليوم: ${dayPnlClosed.toFixed(2)}$ | العائم: ${floatingPnl.toFixed(2)}$ | الحد: ${lossStop ?? '—'}$ / ${profitStop ?? '—'}$`,
      `daystop:${new Date(now + 3 * 3600e3).toISOString().slice(0, 10)}`);
  }

  // ---- تعطيل التفعيل الحي: لا جديد، وسحب كل المعلق، والسقف الزمني يبقى محكوماً ----
  const workingRows = await db.liveOrder.findMany({
    where: { status: { in: ['sent', 'placed'] } },
    orderBy: { createdAtMs: 'desc' },
    take: 200,
  });
  if (!control.enabled) {
    if (workingRows.length) {
      pushAlert('live', 'إيقاف حي: سحب كل الأوامر المعلقة', `${workingRows.length} أمراً معلقاً سيُلغى من الطرفية — المواقف المفتوحة تبقى محكومة بوقفها وهدفها والسقف الزمني`, 'liveoff:pendings');
    }
    return {
      enabled: false, serverTime: now, feedFresh: fresh,
      symbol: feed.symbol, account: feed.account ? { login: feed.account.login, server: feed.account.server, balance: feed.account.balance, equity: feed.account.equity } : null,
      config: { lot, slCapDollars, maxConcurrent, timeStopHours, dailyLossStop: lossStop, dailyProfitStop: profitStop },
      state: { session: null, openCount, openByStrategy, workingOrders: workingRows.length, dayPnlClosed: Math.round(dayPnlClosed * 100) / 100, floatingPnl: Math.round(floatingPnl * 100) / 100, pendingPlans: 0, canceledPending: true },
      exitRules,
      open: [], close, cancelAllPending: workingRows.length > 0,
      note: 'التنفيذ الحي معطل — لا أوامر جديدة؛ السقف الزمني (القاعدة 4) يبقى إلزامياً',
    };
  }

  // ---- بوابات التفعيل: بث حي طازج وإلا لا تداول ----
  if (!fresh || !feed.tick) {
    return {
      enabled: true, serverTime: now, feedFresh: fresh,
      symbol: feed.symbol, account: feed.account ? { login: feed.account.login, server: feed.account.server, balance: feed.account.balance, equity: feed.account.equity } : null,
      config: { lot, slCapDollars, maxConcurrent, timeStopHours, dailyLossStop: lossStop, dailyProfitStop: profitStop },
      state: { session: null, openCount, openByStrategy, workingOrders: workingRows.length, dayPnlClosed: Math.round(dayPnlClosed * 100) / 100, floatingPnl: Math.round(floatingPnl * 100) / 100, pendingPlans: 0, canceledPending: false },
      exitRules,
      open: [], close, cancelAllPending: false,
      note: 'بث MT5 غير طازج (أكثر من دقيقتين) — توقّف إصدار الأوامر حتى عودة البث',
    };
  }
  if (dayStopClose) {
    return {
      enabled: true, serverTime: now, feedFresh: fresh,
      symbol: feed.symbol, account: feed.account ? { login: feed.account.login, server: feed.account.server, balance: feed.account.balance, equity: feed.account.equity } : null,
      config: { lot, slCapDollars, maxConcurrent, timeStopHours, dailyLossStop: lossStop, dailyProfitStop: profitStop },
      state: { session: null, openCount, openByStrategy, workingOrders: workingRows.length, dayPnlClosed: Math.round(dayPnlClosed * 100) / 100, floatingPnl: Math.round(floatingPnl * 100) / 100, pendingPlans: 0, canceledPending: false },
      exitRules,
      open: [], close, cancelAllPending: true,
      note: 'إيقاف اليوم مفعل — لا أوامر جديدة لبقية اليوم السوري',
    };
  }

  // ---- تشغيل المحرك على الشموع الحقيقية (كاش دافئ) ----
  const realNews = await loadRealNews();
  const r = runBacktestCached(null, settings, realNews);
  if (!r.ok) {
    return {
      enabled: true, serverTime: now, feedFresh: fresh,
      symbol: feed.symbol, account: feed.account ? { login: feed.account.login, server: feed.account.server, balance: feed.account.balance, equity: feed.account.equity } : null,
      config: { lot, slCapDollars, maxConcurrent, timeStopHours, dailyLossStop: lossStop, dailyProfitStop: profitStop },
      state: { session: null, openCount, openByStrategy, workingOrders: workingRows.length, dayPnlClosed: Math.round(dayPnlClosed * 100) / 100, floatingPnl: Math.round(floatingPnl * 100) / 100, pendingPlans: 0, canceledPending: false },
      exitRules,
      open: [], close, cancelAllPending: false,
      note: `تعذر تشغيل المحرك الآن: ${r.reason.slice(0, 80)}`,
    };
  }

  const sessionNow = r.sessionNow;

  // ---- أوامر إغلاق القاعدة: صفقة سلة مفتوحة وقاعدة خروجها انعكست ضد اتجاهها ----
  for (const p of positions) {
    const m = (p.comment ?? '').match(/TAMSA-([A-Z]{1,2})-/);
    if (!m) continue;
    const ex = (exitRules as Record<string, { exitBuy: boolean; exitSell: boolean }> | undefined)?.[m[1]];
    if (!ex) continue;
    const shouldExit = p.dir === 'buy' ? ex.exitBuy : ex.exitSell;
    if (shouldExit && !close.some(c => c.ticket === p.ticket)) {
      close.push({ ticket: p.ticket, reason: 'rule', profit: Math.round(p.profit * 100) / 100, why: `انعكاس قاعدة خروج ${m[1]}` });
    }
  }
  const ladder = sessionNow ? (settings.priorityLadder?.[sessionNow] ?? []) : [];
  const rankOf = (st: string): number => {
    const i = ladder.indexOf(st as never);
    return i >= 0 ? i : 999;
  };

  // ---- الخطط المحجوزة سابقاً: كل planId أُصدر من قبل لا يُعاد إصداره ----
  const dispatched = new Set<string>();
  for (const row of workingRows) dispatched.add(row.planId);
  const closedRows = await db.liveOrder.findMany({
    where: { status: { in: ['filled', 'closed'] } },
    select: { planId: true },
    take: 500,
  });
  for (const row of closedRows) dispatched.add(row.planId);

  // ---- الفحص الدستوري لكل إشارة معلقة (نفس بوابات الباك تيست بالحرف) ----
  const open: LivePlan[] = [];
  const seenStrat = new Set<string>();
  // المعلق بالاستراتيجية: أمر معلق حقيقي في MT5 يمنع خطة جديدة لنفس الاستراتيجية
  // (تطابق كود التعليق «مفتوحة أو معلقة» والقاعدة 10: عائلة TAMSA صفقة واحدة نشطة)
  const pendingByStrategy: Record<string, number> = {};
  for (const row of workingRows) pendingByStrategy[row.strategy] = (pendingByStrategy[row.strategy] ?? 0) + 1;
  let tamsaPlanned = tamsaOpen > 0 ? 1 : 0; // القاعدة 10: عائلة TAMSA صفقة نشطة واحدة — إن فُتحت لا جديد إطلاقاً
  let slotsUsed = openCount + workingRows.length; // المواقف + المعلق العام: كل ما قد يصبح موقفاً
  const blocked: { st: string; why: string }[] = [];

  const candidates = (r.finalPending as (Setup & { tpPips: number })[])
    .filter(p => p.expiresAt > now)
    .filter(p => !dispatched.has(`${p.strategy}-${p.entry.toFixed(2)}-${p.createdAt}`))
    .sort((a, b) => rankOf(a.strategy) - rankOf(b.strategy) || a.createdAt - b.createdAt);

  for (const p of candidates) {
    const planId = `${p.strategy}-${p.entry.toFixed(2)}-${p.createdAt}`;
    const isBasket = BASKET_IDS.includes(p.strategy as never);

    // جلسة الآن ضمن جلسات البند المسموحة (بوابة الجلسات لحظة الإصدار)
    const allowed = (p.allowedSessions ?? [p.session]) as unknown as string[];
    if (sessionNow && allowed.length && !allowed.includes(sessionNow)) { blocked.push({ st: p.strategy, why: 'خارج جلساته' }); continue; }

    // لا تكرار لنفس الاستراتيجية (مفتوحة أو معلقة في الطرفية أو مخطط في هذه الدورة)
    if (openByStrategy[p.strategy] || pendingByStrategy[p.strategy] || seenStrat.has(p.strategy)) { blocked.push({ st: p.strategy, why: 'صفقة/أمر لنفس الاستراتيجية قائم' }); continue; }

    // القاعدة 10: عائلة TAMSA صفقة واحدة نشطة — السلة توازي مكوناتها
    if (!isBasket && tamsaPlanned > 0) { blocked.push({ st: p.strategy, why: 'عائلة TAMSA مشغولة (قاعدة 10)' }); continue; }

    // القاعدة 25: سقف التزامن الكلي — المواقف + المعلق لا يتجاوز 4 أبداً
    if (slotsUsed >= maxConcurrent) { blocked.push({ st: p.strategy, why: 'سقف التزامن ممتلئ (قاعدة 25)' }); break; }

    // القاعدة 12: السقف الزمني للوقف — الدفاع الأخير قبل النشر (السقف مطبق أصلاً عند التوليد)
    const dist = Math.abs(p.entry - p.sl);
    if (slCapDollars > 0 && dist > slCapDollars + 0.001) { blocked.push({ st: p.strategy, why: `وقف أوسع من السقف ${dist.toFixed(2)}$` }); continue; }

    const plan: LivePlan = {
      planId,
      strategy: p.strategy,
      name: STRATEGY_NAMES[p.strategy as keyof typeof STRATEGY_NAMES] ?? p.strategy,
      dir: p.dir,
      entry: Math.round(p.entry * 100) / 100,
      sl: Math.round(p.sl * 100) / 100,
      tp: p.tpPips > 0 ? Math.round(p.tp * 100) / 100 : 0, // صفر = بلا هدف ثابت في MT5 — الخروج بقاعدة الاستراتيجية (كما تحققت السلة)
      lot,
      kind: p.market ? 'market' : 'limit',
      expiresAtMs: Math.round(p.expiresAt),
      magic: magicFor(p.strategy),
      comment: mt5Comment(p.strategy, planId),
      reason: p.reason,
    };
    open.push(plan);
    seenStrat.add(p.strategy);
    slotsUsed++;
    if (!isBasket) tamsaPlanned++;
    if (!isBasket) break; // عائلة TAMSA: أمر واحد فقط (أعلى رتبة) — إن مُلئ فلا جديد
  }

  // ---- تسجيل الخطط المصدرة فوراً (sent) — الجسر سيرد بplaced/filled/failed ----
  for (const plan of open) {
    await db.liveOrder.upsert({
      where: { planId: plan.planId },
      create: {
        planId: plan.planId, strategy: plan.strategy, dir: plan.dir,
        entry: plan.entry, sl: plan.sl, tp: plan.tp, lot: plan.lot, kind: plan.kind,
        createdAtMs: Math.round(now), expiresAtMs: plan.expiresAtMs,
        status: 'sent', comment: plan.comment, magic: plan.magic,
        updatedAtMs: Math.round(now), checkedAtMs: Math.round(now),
      },
      update: { updatedAtMs: Math.round(now) },
    });
  }

  // ---- انتهاء صلاحية المعلق القديم: يُسحب من الطرفية ويُعلّم منتهياً ----
  for (const row of workingRows) {
    if (row.expiresAtMs && row.expiresAtMs <= now) {
      await db.liveOrder.update({ where: { id: row.id }, data: { status: 'expired', closedAtMs: Math.round(now), updatedAtMs: Math.round(now) } });
    } else if (row.status === 'sent' && !row.ticket && now - row.createdAtMs > 5 * 60e3) {
      // أُصدر قبل 5 دقائق ولم يرد منه رد من الجسر (سقف طبيعي 4 ثوانٍ) — سجل ميت يُخلى
      // كي لا يحجز خانة تزامن للأبد (شفاء ذاتي — الدرس الإنتاجي)
      await db.liveOrder.update({ where: { id: row.id }, data: { status: 'expired', closedAtMs: Math.round(now), updatedAtMs: Math.round(now), error: 'بلا رد من الجسر خلال 5 دقائق' } });
    }
  }

  if (open.length) {
    pushAlert('live', `أوامر حية جديدة إلى MT5: ${open.map(o => o.strategy).join('، ')}`,
      open.map(o => `${o.strategy} ${o.dir === 'buy' ? 'شراء' : 'بيع'} ${o.kind === 'market' ? 'ماركت' : 'معلق'} @ ${o.entry.toFixed(2)} | وقف ${o.sl.toFixed(2)} | هدف ${o.tp > 0 ? o.tp.toFixed(2) : 'بالقاعدة'} | ${o.lot} لوت`).join('\n'),
      `liveopen:${open.map(o => o.planId).join('|').slice(0, 80)}`);
  }

  return {
    enabled: true, serverTime: now, feedFresh: fresh,
    symbol: feed.symbol, account: feed.account ? { login: feed.account.login, server: feed.account.server, balance: feed.account.balance, equity: feed.account.equity } : null,
    config: { lot, slCapDollars, maxConcurrent, timeStopHours, dailyLossStop: lossStop, dailyProfitStop: profitStop },
      state: {
      session: sessionNow, openCount, openByStrategy,
      workingOrders: workingRows.length,
      dayPnlClosed: Math.round(dayPnlClosed * 100) / 100,
      floatingPnl: Math.round(floatingPnl * 100) / 100,
      pendingPlans: open.length, canceledPending: false,
    },
    exitRules,
    open, close, cancelAllPending: false,
  };
}

// ---------- كاش الحمولة (الجسر يستفسر كل ~4 ثوانٍ) ----------
const gOrd = globalThis as unknown as { __bfxOrdersCache?: { t: number; busy: Promise<LiveOrdersPayload> | null; payload: LiveOrdersPayload | null } };
const ordCache = gOrd.__bfxOrdersCache ?? (gOrd.__bfxOrdersCache = { t: 0, busy: null, payload: null });

export async function getLiveOrdersPayload(): Promise<LiveOrdersPayload> {
  const now = Date.now();
  if (ordCache.payload && now - ordCache.t < ORDERS_TTL_MS) return ordCache.payload;
  if (!ordCache.busy) {
    ordCache.busy = buildLiveOrdersPayload()
      .then(p => { ordCache.payload = p; ordCache.t = Date.now(); return p; })
      .catch(e => {
        // أي خلل لا يوقف القناة — حمولة آمنة بلا أوامر جديدة والسقف الزمني يعمل
        const safe: LiveOrdersPayload = {
          enabled: false, serverTime: Date.now(), feedFresh: false, symbol: null, account: null,
          config: { lot: 0.01, slCapDollars: 15, maxConcurrent: 4, timeStopHours: 72, dailyLossStop: null, dailyProfitStop: null },
          state: { session: null, openCount: 0, openByStrategy: {}, workingOrders: 0, dayPnlClosed: 0, floatingPnl: 0, pendingPlans: 0, canceledPending: false },
          exitRules: { ...NO_EXIT },
          open: [], close: [], cancelAllPending: false,
          note: `خلل عابر في عقل القرار — لا أوامر هذه الدورة: ${String(e).slice(0, 80)}`,
        };
        return safe;
      })
      .finally(() => { ordCache.busy = null; });
  }
  return ordCache.busy;
}

// ---------- تقارير الجسر: نتائج التنفيذ + التعويض الذاتي ----------
export interface BridgeReport {
  planId?: string;
  ticket?: number;
  action: 'placed' | 'filled' | 'canceled' | 'failed' | 'closed' | 'converted_market';
  price?: number;
  error?: string;
}

export interface BridgeReconcile {
  orders?: { ticket: number; magic?: number; comment?: string; state?: number; price?: number; sl?: number; tp?: number }[];
  positions?: { ticket: number; magic?: number; comment?: string; dir?: string; priceOpen?: number; profit?: number; t?: number }[];
}

export async function applyBridgeReports(reports: BridgeReport[]): Promise<void> {
  const now = Date.now();
  for (const rep of reports) {
    try {
      if (rep.action === 'placed' && rep.planId && rep.ticket) {
        await db.liveOrder.updateMany({
          where: { planId: rep.planId, status: { in: ['sent', 'placed'] } },
          data: { status: 'placed', ticket: String(Math.round(rep.ticket)), updatedAtMs: Math.round(now) },
        });
      } else if (rep.action === 'converted_market' && rep.planId && rep.ticket) {
        // المستوى لمس مسبقاً — حوّله ماركت: يعد بسجله مباشرة كصفقة مفتوحة
        await db.liveOrder.updateMany({
          where: { planId: rep.planId, status: { in: ['sent', 'placed'] } },
          data: { status: 'filled', ticket: String(Math.round(rep.ticket)), fillPrice: rep.price ?? null, updatedAtMs: Math.round(now) },
        });
        pushAlert('live', 'تنفيذ ماركت فوري (المستوى لمس قبل التسجيل)', `الخطة ${rep.planId} نُفذت ماركت عند ${rep.price?.toFixed(2) ?? '—'}`, `cvm:${rep.planId}`);
      } else if (rep.action === 'filled' && rep.planId) {
        await db.liveOrder.updateMany({
          where: { planId: rep.planId, status: { in: ['sent', 'placed'] } },
          data: { status: 'filled', ticket: rep.ticket ? String(Math.round(rep.ticket)) : undefined, fillPrice: rep.price ?? null, updatedAtMs: Math.round(now) },
        });
        const row = await db.liveOrder.findUnique({ where: { planId: rep.planId } });
        if (row) pushAlert('live', `تنفيذ حي: ${row.strategy} ${row.dir === 'buy' ? 'شراء' : 'بيع'}`,
          `دخول ${row.fillPrice?.toFixed(2) ?? '—'} | وقف ${row.sl.toFixed(2)} | هدف ${row.tp > 0 ? row.tp.toFixed(2) : 'بالقاعدة'} | تذكرة ${row.ticket ?? '—'}\nالوقف ثابت لا يتحرك (التأمين ملغى بقرار المالك)`, `lfill:${rep.planId}`);
      } else if (rep.action === 'canceled' && rep.planId) {
        await db.liveOrder.updateMany({
          where: { planId: rep.planId, status: { in: ['sent', 'placed'] } },
          data: { status: 'canceled', closedAtMs: Math.round(now), updatedAtMs: Math.round(now) },
        });
      } else if (rep.action === 'closed' && rep.ticket) {
        await db.liveOrder.updateMany({
          where: { ticket: String(Math.round(rep.ticket)), status: 'filled' },
          data: { status: 'closed', closedAtMs: Math.round(now), updatedAtMs: Math.round(now) },
        });
      } else if (rep.action === 'failed' && rep.planId) {
        // يُحذف السجل ليُعاد التقييم في الدورة التالية ضمن نفس بوابات الدستور
        await db.liveOrder.deleteMany({ where: { planId: rep.planId, status: { in: ['sent', 'placed'] } } });
        pushAlert('live', 'فشل أمر حي — سيعاد التقييم', `${rep.planId}: ${rep.error ?? 'خطأ غير معروف'}`, `lfail:${rep.planId}`);
      }
    } catch { /* تقرير واحد لا يعطل البقية */ }
  }
}

/** التعويض الذاتي: تصحيح السجل من حالة MT5 الفعلية — يشتغل كل دورة جسر */
export async function applyReconcile(rc: BridgeReconcile): Promise<void> {
  const now = Date.now();
  try {
    const tracked = await db.liveOrder.findMany({
      where: { status: { in: ['sent', 'placed', 'filled'] } },
      orderBy: { updatedAtMs: 'desc' },
      take: 200,
    });
    // تذاكر MT5 تتجاوز نطاق Int32 — تُخزّن في القاعدة كنص، ومفاتيح المطابقة أرقام من الجسر
    const posByTicket = new Map<number, NonNullable<BridgeReconcile['positions']>[number]>();
    for (const p of rc.positions ?? []) posByTicket.set(Math.round(p.ticket), p);
    const ordByTicket = new Map<number, NonNullable<BridgeReconcile['orders']>[number]>();
    for (const o of rc.orders ?? []) ordByTicket.set(Math.round(o.ticket), o);

    // 1) أوامر معلقة في MT5 ليس لها سجل → أعاد تشغيل الخادم/الجسر: استعادة الارتباط بالتعليق
    for (const [ticket, o] of ordByTicket) {
      const known = tracked.find(t => t.ticket != null && Number(t.ticket) === ticket);
      // وقف/هدف الأمر الفعلي: من تقرير الجسر أولاً، وإلا من خطة الأصل بنفس التعليق
      // (الأوامر المستوردة ذاتياً بعد إعادة تشغيل الخادم تسجل بلا وقف — والحماية موجودة فعلًا لدى الوسيط)
      let origin = tracked.find(x => x.id !== known?.id && x.comment && x.comment === o.comment && ((x.sl ?? 0) > 0 || (x.tp ?? 0) > 0));
      if (!origin && o.comment) {
        // خطة الأصل قد تكون منتهية (expired) — لا قيد حالة: نبحث في كل السجلات عدا السجل المعروف نفسه
        origin = (await db.liveOrder.findFirst({
          where: { comment: o.comment, id: { not: known?.id ?? '' }, OR: [{ sl: { gt: 0 } }, { tp: { gt: 0 } }] },
          orderBy: { createdAtMs: 'desc' },
        })) ?? undefined;
      }
      const effSl = (o.sl ?? 0) > 0 ? (o.sl as number) : (origin?.sl ?? 0);
      const effTp = (o.tp ?? 0) > 0 ? (o.tp as number) : (origin?.tp ?? 0);
      if (known) {
        const patch: Partial<{ sl: number; tp: number; dir: string }> = {};
        if ((known.sl ?? 0) <= 0 && effSl > 0) patch.sl = effSl;
        if ((known.tp ?? 0) <= 0 && effTp > 0) patch.tp = effTp;
        // اتجاه الأمر المستورد ذاتياً تخميني — خطة الأصل بنفس التعليق هي المرجع
        if (origin && known.planId.startsWith('ext-') && origin.dir !== known.dir) patch.dir = origin.dir;
        if (Object.keys(patch).length) {
          await db.liveOrder.update({ where: { id: known.id }, data: { ...patch, updatedAtMs: Math.round(now) } });
        }
        continue;
      }
      const m = (o.comment ?? '').match(/TAMSA-([A-Z]{1,2})-([0-9a-f]{8})/);
      if (!m) continue; // أمر يدوي من المالك — لا نلمسه
      const candidate = tracked.find(t => t.comment === o.comment && (t.status === 'sent' || t.status === 'placed'));
      if (candidate) {
        await db.liveOrder.update({ where: { id: candidate.id }, data: { status: 'placed', ticket: String(ticket), sl: candidate.sl > 0 ? candidate.sl : effSl, tp: candidate.tp > 0 ? candidate.tp : effTp, updatedAtMs: Math.round(now) } });
        continue;
      }
      // سجل ضاع تماماً: أنشئ سجلاً خارجياً بلا خطة (تعليق يحمل الاستراتيجية والحماية الفعلية)
      await db.liveOrder.create({
        data: {
          planId: `ext-${ticket}`, strategy: m[1], dir: origin?.dir === 'sell' ? 'sell' : 'buy', entry: o.price ?? 0, sl: effSl, tp: effTp,
          lot: 0.01, kind: 'limit', createdAtMs: Math.round(now), expiresAtMs: 0,
          status: 'placed', ticket: String(ticket), comment: o.comment ?? null, magic: o.magic ?? null,
          updatedAtMs: Math.round(now), checkedAtMs: Math.round(now),
        },
      }).catch(() => { /* المفتاح موجود مسبقاً */ });
    }

    // 2) المعلق المرسل وُجد في MT5 → placed؛ اختفى → canceled
    for (const t of tracked) {
      if (t.status === 'sent' || t.status === 'placed') {
        const inMt5 = t.ticket ? ordByTicket.has(Number(t.ticket)) : false;
        if (t.ticket && inMt5) {
          await db.liveOrder.update({ where: { id: t.id }, data: { status: 'placed', updatedAtMs: Math.round(now), checkedAtMs: Math.round(now) } });
        } else if (t.ticket && !inMt5 && t.status === 'placed') {
          // اختفى من MT5: إما مُلغي يدوياً أو نُفذ — نفحص المواقف بالتعليق/الماجيك
          const posHit = [...posByTicket.values()].find(p => (p.comment ?? '') === (t.comment ?? '') || (p.magic && t.magic && p.magic === t.magic));
          if (posHit) {
            await db.liveOrder.update({ where: { id: t.id }, data: { status: 'filled', ticket: String(Math.round(posHit.ticket)), fillPrice: posHit.priceOpen ?? null, updatedAtMs: Math.round(now), checkedAtMs: Math.round(now) } });
            pushAlert('live', `تنفيذ حي: ${t.strategy} ${t.dir === 'buy' ? 'شراء' : 'بيع'}`,
              `دخول ${(posHit.priceOpen ?? 0).toFixed(2)} | وقف ${t.sl.toFixed(2)} | تذكرة ${posHit.ticket}\nالوقف ثابت لا يتحرك (التأمين ملغى بقرار المالك)`, `lfill:${t.planId}`);
          } else {
            await db.liveOrder.update({ where: { id: t.id }, data: { status: 'canceled', closedAtMs: Math.round(now), updatedAtMs: Math.round(now), checkedAtMs: Math.round(now) } });
          }
        }
      }

      // 3) المفتوح لم يعد بين المواقف → أُغلق: النتيجة من سجل deals الحقيقي
      if (t.status === 'filled' && t.ticket && !posByTicket.has(Number(t.ticket))) {
        const deals = mt5Feed().deals ?? [];
        const out = deals.filter(d => d.entry === 'out' && Math.round(d.position) === Number(t.ticket)).sort((a, b) => b.t - a.t)[0];
        const rawComment = (out?.comment ?? '').toLowerCase();
        const reason = rawComment.includes('[sl') || rawComment.includes('sl ') ? 'sl'
          : rawComment.includes('[tp') || rawComment.includes('tp ') ? 'tp'
          : 'manual';
        await db.liveOrder.update({
          where: { id: t.id },
          data: {
            status: 'closed', closedAtMs: Math.round(out?.t ?? now),
            pnl: out ? (out.profit ?? 0) + (out.swap ?? 0) + (out.commission ?? 0) : null,
            closeReason: reason, updatedAtMs: Math.round(now), checkedAtMs: Math.round(now),
          },
        });
        if (out) {
          const pnl = (out.profit ?? 0) + (out.swap ?? 0) + (out.commission ?? 0);
          pushAlert('live', `إغلاق حي: ${t.strategy} ${reason === 'tp' ? 'على الهدف' : reason === 'sl' ? 'على الوقف' : 'إغلاق'}`,
            `${t.dir === 'buy' ? 'شراء' : 'بيع'} — النتيجة ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}$ | تذكرة ${t.ticket}`, `lclose:${t.planId}`);
        }
      }
    }
  } catch { /* التعويض الذاتي لا يعطل القناة */ }
}
