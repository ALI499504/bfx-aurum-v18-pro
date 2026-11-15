import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEngineData, getDataStatus } from '@/lib/server/data';
import { runBacktest, marketStateNow } from '@/lib/engine/backtest';
import { setupScore } from '@/lib/engine/rules';
import { loadBotSettings, loadRealNews } from '@/lib/server/backtestRunner';
import { currentSession, syriaHour, syriaDayNum, SYRIA_OFFSET_MS } from '@/lib/engine/sessions';
import { STRATEGY_NAMES } from '@/lib/engine/types';
import { getAiSupervision, aiSupervisionReady } from '@/lib/server/aiSupervisor';
import { mt5Feed } from '@/lib/server/mt5feed';
import { publishEngineLog, BLOCK_REASON_LABELS } from '@/lib/engine/constitution';

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

  // ---- السبريد الحي + بوابة السبريد ----
  const feed = mt5Feed();
  const tick = feed.tick;
  const spreadCents = tick && Number.isFinite(tick.bid) && Number.isFinite(tick.ask)
    ? Math.round((tick.ask - tick.bid) * 100 * 10) / 10
    : null;
  const spreadGate = settings.globalRules.spread_gate;
  const spreadLimit = spreadGate?.enabled ? (spreadGate.value ?? 45) : null;
  const spreadBlocked = spreadLimit !== null && spreadCents !== null && spreadCents > spreadLimit;

  // ---- حالة السوق اللحظية (ATR + نطاق 6 ساعات) ----
  const nowT = c5[c5.length - 1].t + 300e3;
  const mkt = marketStateNow(data, nowT);
  const chop = settings.globalRules.chop_filter;
  const chopBlocked = chop?.enabled && mkt.rng6hPips !== null && mkt.rng6hPips < (chop.value ?? 60);

    // درجة بنيوية للعرض فقط — بوابة الجودة أُزالت نهائياً بأمر المالك (كانت تمنع دخولات أمرت بها المواصفة)
    const pending = result.finalPending.map(p => {
      const sc = setupScore({
        id: 0, strategy: p.strategy as never, dir: p.dir,
        entry: p.entry, slPips: Math.abs(p.entry - p.sl) / 0.1, sl: p.sl, tp: p.tp,
        createdAt: p.createdAt, expiresAt: p.expiresAt, session: p.session as never,
        reason: p.reason, refLevel: p.entry, fibConfirmed: p.fibConfirmed,
        strategyRank: ({ Z: 0, D: 1, K: 1, F: 1, H: 1, C: 2, E: 2, J: 2, A: 3, B: 3, G: 3, I: 3, O: 3, L: 4, M: 4, N: 4 } as Record<string, number>)[p.strategy] ?? 3,
      }, null);
      // قابلة للتنفيذ الآن؟ = الجلسة الحالية مفعّلة للاستراتيجية في جدولة الجلسات
      //   (قانون صارم — الجدولة المصدر الوحيد ولا تُتجاوز بشيء سوى الأوامر اليدوية Z)
      // — استراتيجية E: الجلسات الأربع مفعّلة لها = قابلة للتنفيذ طوال فتح السوق؛
      //   توقيتها تحكمه قيودها المجمدة حصراً (02:00-04:00، 23:00-00:00، الأخبار، إغلاق 00:00)
      //   — أُزيل حجبها في فجوة ما بين الجلسات (00:00-01:00 سوريا) وبوابة الجودة.
      const scfgS = settings.sessions[p.strategy as keyof typeof settings.sessions];
      const sessNowS = result.sessionNow;
      const sessOk = p.strategy === 'E' ? true
        : p.strategy === 'Z' ? true
        : (['L', 'M', 'N'].includes(p.strategy)) ? (sessNowS === 'asia' && !!scfgS?.asia)
        : !!(scfgS && sessNowS && scfgS[sessNowS]);
      const canFillNow = sessOk;
      return { ...p, score: sc, canFillNow };
    });

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
        } else if (now > s.expiresAtMs + 24 * 3600e3) {
          // تجاوز الصلاحية بلا هدف/وقف → إغلاق زمني بسعر آخر إغلاق (صافي بعد سبريد أكبر بين الفعلي و0.30$)
          const last = c5[c5.length - 1];
          const pnlPips = (s.dir === 'buy' ? last.c - s.entry : s.entry - last.c) / 0.1 - Math.max(spreadCents ?? 30, 30) / 10;
          await db.liveSignal.update({
            where: { id: s.id },
            data: { outcome: 'time', closedAtMs: now, pnlPips, checkedAtMs: now },
          });
          s.outcome = 'time';
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
