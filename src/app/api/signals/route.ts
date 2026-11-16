import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEngineData, getDataStatus } from '@/lib/server/data';
import { runBacktest, marketStateNow } from '@/lib/engine/backtest';
import { loadBotSettings, loadRealNews } from '@/lib/server/backtestRunner';
import { currentSession, syriaHour, syriaDayNum, SYRIA_OFFSET_MS } from '@/lib/engine/sessions';
import { STRATEGY_NAMES, BASKET_IDS } from '@/lib/engine/types';
import { getAiSupervision, aiSupervisionReady } from '@/lib/server/aiSupervisor';
import { mt5Feed } from '@/lib/server/mt5feed';
import { computeAutoDecisions, applyAutoDecisions, buildReport } from '@/lib/engine/autoManager';
import { publishEngineLog, BLOCK_REASON_LABELS } from '@/lib/engine/constitution';
import { pushAlert } from '@/lib/server/alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * الإشارات الحية — نفس كاشفات الاستراتيجيات ومحرك القواعد يعملان على شموع MT5 الحقيقية
 * ويرجعان الأوامر المعلقة النشطة "الآن" وفق إعداداتك المحفوظة + طبقة وضع الظل:
 * - بوابة السبريد الحي: قياس (Ask-Bid) من تيك MT5 ورفض الدخول عند انتفاخه
 * - حالة السوق اللحظية: ATR اليومي % ونطاق 6 ساعات
 * - درجة جودة كل إشارة (نفس بوابة الجودة في الباك تيست)
 * - Shadow Mode: كل إشارة تُسجَّل في قاعدة البيانات وتُتتبع فعلياً (نُفذت؟ هدف أم وقف؟)
 *   — أساس كاشف الانحراف بين أداء الحي وأداء الباك تيست
 * الحساب الثقيل مخزّن مؤقتاً: يُعاد فقط عند إغلاق شمعة 5m جديدة.
 */
// كاش عالمي يصمد أمام HMR: الإرجاع فوري دائماً (نتيجة آخر شمعة 5m) والتحديث
// الثقيل يجري في الخلفية مرة واحدة (single-flight) — لا تجميد لحلقة الأحداث
// كما كان يحدث سابقاً عندما كان كل طلب يعيد تشغيل الباك تيست الكامل بشكل متزامن.
const gSig = globalThis as unknown as { __bfxSigCache?: { key: number; payload: unknown; busy: Promise<void> | null } };
const sigCache = gSig.__bfxSigCache ?? (gSig.__bfxSigCache = { key: -1, payload: null as unknown, busy: null as Promise<void> | null });

export async function GET() {
  const data = getEngineData();
  if (!data) {
    const st = getDataStatus();
    return NextResponse.json({
      ok: false,
      error: st.connected
        ? 'البيانات الحقيقية الواردة من MT5 غير مكتملة بعد — اترك الجسر يعمل ثم أعد المحاولة'
        : 'لا يوجد بث حي من MT5 — شغّل أمر الربط على جهازك لتعمل الإشارات الحية',
    }, { status: 503 });
  }

  const c5 = data.c5;
  const key = c5[c5.length - 1].t * 1000 + c5.length;
  const cached = sigCache.payload as { ai?: { available?: boolean } } | null;
  if (cached && sigCache.key === key) {
    // حمولة الإرجاع الفوري — وإن كان المشرف الذكي قد وصل للتو ولم تُدرَج نتيجته بعد:
    // إعادة حساب خلفية واحدة فورية (كاش المحرك دافئ — سريعة) لتظهر ملاحظاته في الطلب التالي
    if (cached.ai?.available === false && aiSupervisionReady() && !sigCache.busy) {
      sigCache.busy = compute().catch(() => { /* تبقى النتيجة القديمة معروضة */ }).finally(() => { sigCache.busy = null; });
    }
    return NextResponse.json(sigCache.payload as object);
  }

  async function compute(): Promise<void> {
    const data = getEngineData();
    if (!data) return;
    const c5 = data.c5;
    const key = c5[c5.length - 1].t * 1000 + c5.length;

    const settings = await loadBotSettings();
  const realNews = await loadRealNews();
  const result = runBacktest(data, settings, Date.now(), realNews);

  // ---- نشر سجل قرارات الوكيل + ملخص الجلسة (صيغة المواصفة الإلزامية) ----
  // «عدد الإشارات، عدد الإلغاءات وأسبابها، عدد الصفقات المنفذة، والنتيجة بوحدة R»
  publishEngineLog(result.decisionLog, {
    publishedAt: Date.now(),
    syriaDay: new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10),
    signals: result.stats.signalsCount,
    cancellations: result.stats.fillsBlocked,
    cancellationsByReason: Object.entries(result.stats.blocked)
      .map(([k, count]) => ({ reason: BLOCK_REASON_LABELS[k] ?? k, count }))
      .sort((a, b) => b.count - a.count),
    executedTrades: result.stats.totalTrades,
    resultR: result.stats.totalR,
    avgR: result.stats.avgR,
    winRate: result.stats.winRate,
    window: `الفترة الكاملة للبيانات الحقيقية (${new Date(result.stats.startT + 3 * 3600e3).toISOString().slice(0, 10)} ← ${new Date(result.stats.endT + 3 * 3600e3).toISOString().slice(0, 10)})`,
  });

  // ---- المدير الآلي الذاتي — وضع الاستشارة افتراضياً (تثبيت أرقام الباك تيست) ----
  // الجذر الثاني لتقلّب الأرباح تلقائياً (7000→2000): هذا المسار كان يعيد كتابة
  // الإعدادات المحفوظة يومياً (تعطيل/تفعيل استراتيجيات + قتل جلسات + دورة تجريبية
  // كل 45 يوماً) صامتاً بلا موافقة، فتتغير نتيجة الباك تيست التي يراها المالك من
  // دون سبب ظاهر. من الآن:
  // • التقييم يجري مرة كل يوم سوري كما كان، لكن القرارات تُوثَّق في تقرير
  //   المدير الآلي (نفس مفتاح /api/automanager) وتُبلَّغ تنبيهاً فقط —
  //   ولا تُكتب على الإعدادات المحفوظة إطلاقاً افتراضياً.
  // • التطبيق الفعلي يتطلب موافقة صريحة: متغير البيئة AUTO_MANAGER_APPLY=1
  //   (على Render) أو state.applyEnabled=true المحفوظ من زر التفعيل.
  // • الإعدادات لا تتغير → الباك تيست لا يتغير → الأرقام ثابتة طوال اليوم.
  try {
    const stateRow = await db.botSettings.findUnique({ where: { key: 'autoManager' } });
    const state = stateRow
      ? (JSON.parse(stateRow.json) as { lastRunDay?: string; disabledAt?: Record<string, number>; probationSince?: Record<string, number>; applyEnabled?: boolean })
      : { lastRunDay: '', disabledAt: {}, probationSince: {} };
    const disabledAt: Record<string, number> = state.disabledAt ?? {};
    const probationSince: Record<string, number> = state.probationSince ?? {};
    state.disabledAt = disabledAt;
    state.probationSince = probationSince;
    const applyEnabled = process.env.AUTO_MANAGER_APPLY === '1' || state.applyEnabled === true;
    const todayKey = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    if (state.lastRunDay !== todayKey) {
      const currentEnabled: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(settings.strategyParams as unknown as Record<string, { enabled?: boolean }>)) {
        currentEnabled[k] = v?.enabled !== false;
      }
      const nowMs = Date.now();
      const PROBATION_MS = 45 * 86400e3;
      const WINDOW_MS = 90 * 86400e3;
      const allTrades = result.trades as unknown as { strategy: string; session: string; pnl: number; result: string; entryT?: number }[];

      // 1) الدورة التجريبية (تطبيق فقط): إعادة تشغيل المعطلة التي مضى على تعطيلها 45 يوماً
      // (مكوّنات السلة المعتمدة W/X/Y/AA مستثناة حصراً — مسارها الظلي المستقل
      //  لا يديره المدير الآلي ولا يعاد تفعيلها في المحرك الحي مهما مرّ الوقت)
      const probationNotes: string[] = [];
      if (applyEnabled) {
        for (const [st, ts] of Object.entries(disabledAt)) {
          if (BASKET_IDS.includes(st as never)) continue;
          if (!currentEnabled[st] && nowMs - ts >= PROBATION_MS) {
            const node = (settings.strategyParams as unknown as Record<string, { enabled?: boolean }> | undefined)?.[st];
            if (node) node.enabled = true;
            probationSince[st] = nowMs;
            delete disabledAt[st];
            probationNotes.push(st);
          }
        }
      }

      // 2) التقييم على النافذة الحديثة — المعطلة تُستثنى، والمحتومة التجريبية تُقيَّم على صفقات ما بعد إعادتها فقط
      const evaluate = allTrades.filter(t => {
        const et = t.entryT ?? 0;
        if (et < nowMs - WINDOW_MS) return false;
        const stt = t.strategy;
        if (!currentEnabled[stt] && !probationSince[stt]) return false;
        if (probationSince[stt] && et < probationSince[stt]) return false;
        return true;
      });
      const { decisions, enable, sessionKills } = computeAutoDecisions(evaluate, { currentEnabled });
      const toDisable = decisions.filter(d => d.kind === 'disable-strategy');
      const toEnable = decisions.filter(d => d.kind === 'enable-strategy');

      if (applyEnabled) {
        const merged = applyAutoDecisions(settings, [...toDisable, ...toEnable], sessionKills);
        for (const d of toDisable) { disabledAt[d.strategy] = nowMs; delete probationSince[d.strategy]; }
        // من نجحت دورته التجريبية بعينة كافية يخرج من الحالة التجريبية
        for (const d of toEnable) delete probationSince[d.strategy];
        await db.botSettings.upsert({
          where: { key: 'main' },
          create: { key: 'main', json: JSON.stringify({ ...settings }) },
          update: { json: JSON.stringify({ ...merged }) },
        });
      }

      // توثيق يومي موحّد: تقرير القرارات في نفس مفتاح /api/automanager (وضع الاستشارة يوثّق فقط)
      const report = buildReport(evaluate, [...toDisable, ...toEnable], enable, {
        from: result.stats.startT ? new Date(result.stats.startT).toISOString() : undefined,
        to: result.stats.endT ? new Date(result.stats.endT).toISOString() : undefined,
      }, applyEnabled ? 'self-auto' : 'advisory-frozen');
      state.lastRunDay = todayKey;
      await db.botSettings.upsert({
        where: { key: 'autoManager' },
        create: { key: 'autoManager', json: JSON.stringify({ ...state, report }) },
        update: { key: 'autoManager', json: JSON.stringify({ ...state, report }) },
      });
      if (toDisable.length || toEnable.length || probationNotes.length || Object.keys(sessionKills).length) {
        pushAlert('auto', applyEnabled ? 'قرار المدير الآلي الذاتي' : 'اقتراح المدير الآلي (معلّق — بحاجة موافقتك)',
          `تعطيل: ${toDisable.map(d => d.strategy).join('، ') || 'لا شيء'}\nتفعيل: ${toEnable.map(d => d.strategy).join('، ') || 'لا شيء'}\nدورة تجريبية: ${probationNotes.join('، ') || 'لا شيء'}\nقتل جلسات: ${Object.keys(sessionKills).length}\nالتقييم على نافذة 90 يوماً${applyEnabled ? '' : '\n(وضع التثبيت: الإعدادات لم تُمس — فعّل التطبيق من AUTO_MANAGER_APPLY=1 إن أردت التنفيذ التلقائي)'}`,
          `auto:${todayKey}`);
      }
    }
  } catch { /* القرار الذاتي لا يعطل الإشارات أبداً */ }

  // ---- السبريد الحي + بوابة السبريد ----
  const feed = mt5Feed();
  const tick = feed.tick;
  const spreadCents = tick && Number.isFinite(tick.bid) && Number.isFinite(tick.ask)
    ? Math.round((tick.ask - tick.bid) * 100 * 10) / 10
    : null;
  // القاعدة 17: سبريد ثابت للتصفية — لا بوابة سبريد حي في القواعد العليا الـ21
  const spreadLimit: number | null = null;
  const spreadBlocked = spreadLimit !== null && spreadCents !== null && spreadCents > spreadLimit;

  // ---- الوقف الزمني الإلزامي (القاعدة 4): مراقبة صفقات MT5 المفتوحة فعلياً ----
  // لا صفقة تبقى مفتوحة أكثر من السقف (72 ساعة = ثلاثة أيام افتراضياً — قرار المالك). الجسر يرسل المواقف الحقيقية
  // مع وقت الفتح — أي موقف تجاوز السقف يولّد تنبيهاً فورياً (لوحة + تليجرام) بمفتاح
  // منع تكرار يومي لكل تذكرة: تذكير يومي حتى الإغلاق الفعلي — إفاذ مضمون لا صداقة فيه.
  const r4TS = settings.globalRules.max_hold_hours;
  const timeStopHours = r4TS?.enabled && r4TS.value && r4TS.value > 0 ? Math.round(r4TS.value) : 72;
  const timeStopCapMs = timeStopHours * 3600e3;
  const timeStopViolations: { ticket: number; dir: string; ageH: number; profit: number; priceOpen: number }[] = [];
  for (const p of feed.positions) {
    const ageMs = Date.now() - p.t;
    if (!Number.isFinite(ageMs) || ageMs < timeStopCapMs) continue;
    const ageH = Math.round((ageMs / 3600e3) * 10) / 10;
    timeStopViolations.push({ ticket: p.ticket, dir: p.dir, ageH, profit: Math.round(p.profit * 100) / 100, priceOpen: p.priceOpen });
    pushAlert('fuse', `⏰ الوقف الزمني (القاعدة 4): أغلق الصفقة #${p.ticket} فوراً`,
      `الصفقة ${p.dir === 'buy' ? 'شراء ▲' : 'بيع ▼'} من ${p.priceOpen.toFixed(2)} مفتوحة منذ ${ageH} ساعة — تجاوزت السقف ${timeStopHours} ساعة (${timeStopHours <= 48 ? 'يومان' : 'ثلاثة أيام'}).
الربح الحالي: ${p.profit >= 0 ? '+' : ''}${p.profit.toFixed(2)}$ | الوقف ${p.sl > 0 ? p.sl.toFixed(2) : '—'} | الهدف ${p.tp > 0 ? p.tp.toFixed(2) : '—'}
القرار إلزامي حسب الدستور: الإغلاق الآن لا تمديد — تجاوز السقف ممنوع مهما كان الربح العائم.`,
      `timestop:${p.ticket}:${new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10)}`);
  }

  // ---- حالة السوق اللحظية (ATR + نطاق 6 ساعات) ----
  const nowT = c5[c5.length - 1].t + 300e3;
  const mkt = marketStateNow(data, nowT);
  const chop = settings.globalRules.chop_filter;
  const chopBlocked = chop?.enabled && mkt.rng6hPips !== null && mkt.rng6hPips < (chop.value ?? 60);

  // ---- قابلية التنفيذ اللحظي لكل إشارة (بوابات القواعد العليا الـ21 حصراً) ----
  const pending = result.finalPending.map(p => {
    const sc = 0; // لا بوابة جودة في الدليل — الحقل للتوافق مع الواجهة
    const sessNowS = result.sessionNow;
    const canFillNow = p.strategy === 'Z' ? true : !!sessNowS;
    return { ...p, score: sc, qualityPass: true, canFillNow };
  });

  // ---- تنبيه ضربات صمامات المخاطر (يومي/أسبوعي/إيكويتي) في نافذة الحساب الأخيرة ----
  const ft = result.stats.fuseTrips;
  if (ft && (ft.daily > 0 || ft.weekly > 0 || ft.equity > 0)) {
    pushAlert('fuse', 'ضرب صمام حماية',
      `الصمام اليومي: ${ft.daily} | الأسبوعي: ${ft.weekly} | حماية الإيكويتي: ${ft.equity}\n(عدد مرات الضرب ضمن نافذة البيانات المحسوبة — القيم من الإعدادات الحية)`,
      `fuse:${new Date().toISOString().slice(0, 10)}`);
  }

  // ---- تنبيهات حية: كل إشارة جديدة جاهزة للتنفيذ تُدفع للسجل وتليجرام ----
  for (const p of pending) {
    const noTp = (p as { tpPips?: number }).tpPips === 0;
    pushAlert(
      'signal',
      `إشارة ${p.strategy} ${p.dir === 'buy' ? 'شراء ▲' : 'بيع ▼'}`,
      `${STRATEGY_NAMES[p.strategy as keyof typeof STRATEGY_NAMES] ?? p.strategy}\nالدخول ${p.entry.toFixed(2)} | الوقف ${p.sl.toFixed(2)}${noTp ? ' | بلا هدف ثابت (خروج بالقاعدة)' : ` | الهدف ${p.tp.toFixed(2)}`}\nالجلسة: ${p.session}`,
      `sig:${p.strategy}-${p.entry.toFixed(2)}-${p.createdAt}`,
    );
  }

  // ---- وضع الظل Shadow Mode: تسجيل + تتبع فعلي ----
  let shadow: Record<string, number> | null = null;
  try {
    const now = Date.now();
    // 1) تسجيل الإشارات الجديدة (بدون تكرار)
    for (const p of result.finalPending) {
      const k = `${p.strategy}-${p.entry.toFixed(2)}-${p.createdAt}`;
      await db.liveSignal.upsert({
        where: { key: k },
        create: {
          key: k, createdAtMs: Math.round(p.createdAt), strategy: p.strategy, dir: p.dir,
          entry: p.entry, sl: p.sl, tp: p.tp, session: p.session, reason: p.reason,
          expiresAtMs: Math.round(p.expiresAt),
          score: pending.find(x => x.createdAt === p.createdAt && x.strategy === p.strategy)?.score ?? 0,
        },
        update: {},
      });
    }
    // 2) تتبع غير المحسوم (آخر 60 إشارة خلال 45 يوماً)
    const tracked = await db.liveSignal.findMany({
      where: {
        createdAtMs: { gte: now - 45 * 86400e3 },
        OR: [{ status: 'pending' }, { status: 'filled', outcome: 'open' }],
      },
      orderBy: { createdAtMs: 'desc' },
      take: 60,
    });
    // فهرس أول شمعة >= زمن معين (بحث ثنائي)
    const idxAt = (t: number): number => {
      let i = 0, lo = 0, hi = c5.length - 1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (c5[mid].t >= t) { i = mid; hi = mid - 1; } else lo = mid + 1; }
      return i;
    };
    for (const s of tracked) {
      const ptr = idxAt(s.createdAtMs);
      if (s.status === 'pending') {
        // هل لمس السعر الدخول؟ (أمر limit)
        let filledIdx = -1;
        for (let i = ptr; i < c5.length; i++) {
          const b = c5[i];
          if (b.t >= s.expiresAtMs) break;
          const touch = s.dir === 'buy' ? b.l <= s.entry : b.h >= s.entry;
          if (touch) { filledIdx = i; break; }
        }
        if (filledIdx >= 0) {
          await db.liveSignal.update({
            where: { id: s.id },
            data: { status: 'filled', filledAtMs: c5[filledIdx].t, outcome: 'open', checkedAtMs: now },
          });
          s.status = 'filled'; s.filledAtMs = c5[filledIdx].t; s.outcome = 'open';
          pushAlert('shadow', `تنفيذ إشارة ${s.strategy} ${s.dir === 'buy' ? 'شراء' : 'بيع'}`,
            `لمس السعر الدخول ${s.entry.toFixed(2)} — الصفقة مفتوحة الآن في وضع الظل\nالوقف ${s.sl.toFixed(2)} | الهدف ${s.tp > 0 ? s.tp.toFixed(2) : 'بالقاعدة'}`,
            `fill:${s.id}`);
        } else if (now > s.expiresAtMs) {
          await db.liveSignal.update({
            where: { id: s.id },
            data: { status: 'expired', outcome: null, checkedAtMs: now },
          });
          s.status = 'expired';
          continue;
        } else continue;
      }
      // صفقة مفتوحة (filled + outcome open): تتبع الوقف/الهدف
      if (s.status === 'filled' && s.outcome === 'open' && s.filledAtMs) {
        const i2 = idxAt(s.filledAtMs);
        let done: 'tp' | 'sl' | null = null;
        for (let i = i2; i < c5.length; i++) {
          const b = c5[i];
          if (s.dir === 'buy') {
            if (b.l <= s.sl) { done = 'sl'; break; } // الوقف أولاً تحفظاً
            if (b.h >= s.tp) { done = 'tp'; break; }
          } else {
            if (b.h >= s.sl) { done = 'sl'; break; }
            if (b.l <= s.tp) { done = 'tp'; break; }
          }
        }
        if (done) {
          // سبريد القاعدة المجمّدة: القيمة الأكبر بين الفعلي و0.30$ — تُخصم من الربح الصافي
          const spreadCostPips = Math.max(spreadCents ?? 30, 30) / 10;
          const pnlPips = (done === 'tp'
            ? Math.abs(s.tp - s.entry) / 0.1
            : -Math.abs(s.entry - s.sl) / 0.1) - spreadCostPips;
          await db.liveSignal.update({
            where: { id: s.id },
            data: { outcome: done, closedAtMs: now, pnlPips, checkedAtMs: now },
          });
          s.outcome = done;
          pushAlert('shadow', `إغلاق ${s.strategy} ${done === 'tp' ? 'على الهدف ✅' : done === 'sl' ? 'على الوقف ❌' : 'زمنياً'}`,
            `${s.dir === 'buy' ? 'شراء' : 'بيع'} من ${s.entry.toFixed(2)} — النتيجة ${pnlPips >= 0 ? '+' : ''}${pnlPips.toFixed(1)} بيب`,
            `out:${s.id}`);
        } else if (now > Math.min(s.expiresAtMs + 24 * 3600e3, s.filledAtMs + timeStopCapMs)) {
          // الإغلاق الزمني الإجباري — القاعدة 4: لا صفقة ظل تتجاوز سقف الاحتفاظ أبداً
          // (السقف من لحظة التنفيذ لا من لحظة الإشارة). السعر: إغلاق آخر شمعة 5m ما زالت
          // ضمن السقف — نفس منطق المحرك بالحرف، فلا انزلاق عبر فجوة يوم أو عطلة.
          const timeCapAt = Math.min(s.expiresAtMs + 24 * 3600e3, s.filledAtMs + timeStopCapMs);
          let closeIdx = c5.length - 1;
          while (closeIdx > 0 && c5[closeIdx].t > timeCapAt) closeIdx--;
          const last = c5[closeIdx];
          const pnlPips = (s.dir === 'buy' ? last.c - s.entry : s.entry - last.c) / 0.1 - Math.max(spreadCents ?? 30, 30) / 10;
          await db.liveSignal.update({
            where: { id: s.id },
            data: { outcome: 'time', closedAtMs: now, pnlPips, checkedAtMs: now },
          });
          s.outcome = 'time';
          pushAlert('shadow', `إغلاق زمني إجباري ${s.strategy} (القاعدة 4 — سقف ${timeStopHours} ساعة)`,
            `${s.dir === 'buy' ? 'شراء' : 'بيع'} من ${s.entry.toFixed(2)} — النتيجة ${pnlPips >= 0 ? '+' : ''}${pnlPips.toFixed(1)} بيب
الصفقة بلغت سقف الاحتفاظ ${timeStopHours} ساعة — الإغلاق إجباري وفق الدستور لا مهما كانت النتيجة.`,
            `timeclose:${s.id}`);
        }
      }
    }
    // 3) إحصاءات الظل (آخر 30 يوماً)
    const recent = await db.liveSignal.findMany({
      where: { createdAtMs: { gte: now - 30 * 86400e3 } },
      take: 500,
    });
    const closed = recent.filter(x => (x.outcome === 'tp' || x.outcome === 'sl' || x.outcome === 'time') && x.pnlPips !== null);
    const wins = closed.filter(x => (x.pnlPips ?? 0) > 0).length;
    shadow = {
      total: recent.length,
      pending: recent.filter(x => x.status === 'pending').length,
      filled: recent.filter(x => x.status === 'filled').length,
      expired: recent.filter(x => x.status === 'expired').length,
      closed: closed.length,
      tp: recent.filter(x => x.outcome === 'tp').length,
      sl: recent.filter(x => x.outcome === 'sl').length,
      winRate: closed.length ? Math.round(wins / closed.length * 1000) / 10 : 0,
      avgPnlPips: closed.length ? Math.round(closed.reduce((a, x) => a + (x.pnlPips ?? 0), 0) / closed.length * 10) / 10 : 0,
    };
  } catch { /* وضع الظل لا يعطل الإشارات */ }

  // ---- المشرف الذكي (هجين): ترتيب أولويات الإشارات الجاهزة + ملاحظات تنظيمية ----
  // بلا أي تغيير في قواعد الاستراتيجيات: لا تعديل دخول/وقف/هدف، لا شروط انتظار إضافية.
  // عند تعذر النموذج يكمل المحرك المحلي إدارة التنفيذ وحده (ai.available=false).
  const nowMs = Date.now();
  let tradesToday = 0;
  try {
    const dayStartUtc = syriaDayNum(nowMs) * 86400e3 - SYRIA_OFFSET_MS;
    tradesToday = await db.liveSignal.count({ where: { status: 'filled', filledAtMs: { gte: dayStartUtc } } });
  } catch { /* العدّاد لا يعطل الإشارات */ }
  const dailyTarget = settings.globalRules.min_daily_trades_kpi?.enabled
    ? Math.max(1, settings.globalRules.min_daily_trades_kpi.value ?? 10) : 10;
  const aiByKey = new Map<string, { priority: number; action: string; note: string }>();
  let aiMeta: { available: boolean; marketNote?: string; sessionNote?: string; dailyNote?: string; generatedAt?: number; latencyMs?: number } = { available: false };
  try {
    const aiInput = {
      candleKey: key,
      session: result.sessionNow,
      syriaHour: syriaHour(nowMs),
      market: {
        trend1h: result.finalStructure.trend1h,
        trend4h: result.finalStructure.trend4h,
        atrPct: mkt.atrPct,
        rng6hPips: mkt.rng6hPips,
        spreadCents,
        spreadBlocked,
        chopBlocked: !!chopBlocked,
      },
      daily: { tradesToday, target: dailyTarget, remaining: Math.max(0, dailyTarget - tradesToday) },
      shadow: shadow ? { closed: shadow.closed, winRate: shadow.winRate, avgPnlPips: shadow.avgPnlPips } : null,
      // حصرية القاعدة: المشرف الذكي يستقبل إشارات الأرقام المستديرة (E) فقط —
      // أي شيء آخر يُتجاهل ولا يُرسل إليه أصلاً (بطلب المالك الصريح)
      signals: pending.filter(p => p.strategy === 'E').map(p => ({
        key: `${p.strategy}-${p.entry.toFixed(2)}-${p.createdAt}`,
        strategy: p.strategy,
        name: STRATEGY_NAMES[p.strategy as keyof typeof STRATEGY_NAMES] ?? p.strategy,
        dir: p.dir as 'buy' | 'sell',
        entry: Math.round(p.entry * 100) / 100,
        sl: Math.round(p.sl * 100) / 100,
        tp: Math.round(p.tp * 100) / 100,
        slDollars: Math.round(Math.abs(p.entry - p.sl) * 10) / 10,
        tpDollars: Math.round(Math.abs(p.tp - p.entry) * 10) / 10,
        score: Math.round(p.score ?? 0),
        canFillNow: p.canFillNow === true,
        session: p.session,
        expiresInH: Math.max(0, (p.expiresAt - nowMs) / 3600e3),
      })),
    };
    const ai = getAiSupervision(aiInput);
    for (const d of ai?.decisions ?? []) aiByKey.set(d.key, { priority: d.priority, action: d.action, note: d.note });
    aiMeta = ai ? {
      available: true, marketNote: ai.marketNote, sessionNote: ai.sessionNote, dailyNote: ai.dailyNote,
      generatedAt: ai.generatedAt, latencyMs: ai.latencyMs,
    } : { available: false };
  } catch { /* تعذر المشرف الذكي — المحرك المحلي يكمل وحده */ }
  const pendingAi = pending.map(p => {
    const d = aiByKey.get(`${p.strategy}-${p.entry.toFixed(2)}-${p.createdAt}`);
    return d ? { ...p, aiPriority: d.priority, aiAction: d.action, aiNote: d.note } : p;
  });

  const payload = {
    ok: true,
    serverTime: Date.now(),
    dataEndT: c5[c5.length - 1].t,
    session: currentSession(Date.now()),
    syriaHour: syriaHour(Date.now()),
    ema: { enabled: settings.indicators.ema, dir: result.emaDirNow },
    trend1h: result.finalStructure.trend1h,
    trend4h: result.finalStructure.trend4h,
    market: {
      atrPct: mkt.atrPct !== null ? Math.round(mkt.atrPct * 100) / 100 : null,
      rng6hPips: mkt.rng6hPips !== null ? Math.round(mkt.rng6hPips) : null,
      spreadCents,
      spreadLimit,
      spreadBlocked,
      chopBlocked: !!chopBlocked,
    },
    pending: pendingAi,
    ai: aiMeta,
    daily: { tradesToday, target: dailyTarget, remaining: Math.max(0, dailyTarget - tradesToday) },
    timeStop: { hours: timeStopHours, violations: timeStopViolations },
    shadow,
  };
    sigCache.payload = payload;
    sigCache.key = key;
  }

  if (sigCache.payload) {
    // stale-while-revalidate: النتيجة الأخيرة فوراً + إعادة حساب خلفية واحدة فقط
    if (!sigCache.busy) {
      sigCache.busy = compute().catch(() => { /* تبقى النتيجة القديمة معروضة */ }).finally(() => { sigCache.busy = null; });
    }
    return NextResponse.json(sigCache.payload as object);
  }

  // باردة (بعد إعادة تشغيل الخادم): حساب أول مرة — النافذة محدودة فيستغرق ثوانٍ لا دقائق
  await compute();
  if (sigCache.payload) return NextResponse.json(sigCache.payload as object);
  return NextResponse.json({ ok: false, error: 'تعذر بناء الإشارات الآن — أعد المحاولة بعد لحظات' }, { status: 503 });
}
