// ============================================================
// المدير الآلي للاستراتيجيات — يستبدل التحكم اليدوي نهائياً
// ------------------------------------------------------------
// الفلسفة (أمر المالك): «أوقف وأزل التحكم بالاستراتيجيات يدوياً —
// اضبط كل شيء آلياً». هذا المدير يقرأ نتائج الباك تيست الحقيقية
// (شموع MT5) ويقرر:
//   1) تعطيل استراتيجية خاسرة بثبات (عينة كافية + PF<1 + صافي سالب)
//   2) إعادة تفعيل استراتيجية رابحة إذا سبق تعطيلها
//   3) قتل جلسة خاسرة لاستراتيجية رابحة إجمالاً (بوابات scenarioSessions)
// مع حواجز حماية: عينة أدنى، لا قتل كل جلسات استراتيجية رابحة،
// ولا مساس بالقواعد العليا المجمدة (الدستور).
// القرارات تُطبق مباشرة على إعدادات البوت وتُوثق بأسباب رقمية.
// ============================================================
import { STRATEGY_NAMES, StrategyId, BASKET_IDS } from './types';
import { ALLOWED_SESSIONS, STRATEGY_CASES, SessionKey } from './tamsa-params';
import { Settings } from './rules';

const MIN_TRADES_STRATEGY = 30;   // أقل عينة لقرار تعطيل استراتيجية (خطة التحويل — القاعدة 29: عينة الحكم 30 صفقة)
const MIN_TRADES_SESSION = 8;     // أقل عينة لقرار قتل جلسة (قرار جلسة لا حكم استراتيجية)
const SESSION_KILL_NET = -8;      // خسارة دولار تبرر قتل جلسة (على لوت 0.01)
const PF_DISABLE = 1.0;           // عتبة PF للتعطيل
const PF_REENABLE = 1.15;         // عتبة إعادة التفعيل (PF أعلى لثقة أكبر)

export interface StrategyMetrics {
  strategy: string; trades: number; wins: number; winRate: number;
  pf: number; net: number; expectancy: number;
}

export interface AutoDecision {
  kind: 'disable-strategy' | 'enable-strategy' | 'disable-session' | 'keep' | 'note';
  strategy: string; session?: string; case?: string;
  reason: string;
  metrics: Record<string, number | string>;
}

export interface AutoManagerReport {
  runAt: number;
  mode: string;
  window: { from?: string; to?: string };
  decisions: AutoDecision[];
  finalEnabled: Record<string, boolean>;
  summary: { enabled: number; disabled: number; sessionKills: number; totalTrades: number; netAll: number };
  autoMode: true;
}

interface TradeLite {
  strategy: string; session: string; pnl: number; result: string; dir?: string;
}

/** مقاييس استراتيجية واحدة من قائمة صفقات */
export function metricsOf(trades: TradeLite[], strategy?: string): StrategyMetrics | null {
  const t = strategy ? trades.filter(x => x.strategy === strategy) : trades;
  if (!t.length) return null;
  let grossWin = 0, grossLoss = 0, net = 0, wins = 0;
  for (const x of t) {
    net += x.pnl;
    if (x.pnl >= 0) { grossWin += x.pnl; wins++; }
    else grossLoss += -x.pnl;
  }
  return {
    strategy: strategy ?? 'ALL',
    trades: t.length, wins,
    winRate: (wins / t.length) * 100,
    pf: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0),
    net,
    expectancy: net / t.length,
  };
}

const fmt = (n: number) => Math.round(n * 100) / 100;

/**
 * حساب القرارات من صفقات باك تيست كامل — دالة نقية (لا مساس بقاعدة البيانات).
 * currentDisabled: خريطة حالة التفعيل الحالية (لكشف من يعاد تفعيله).
 */
export function computeAutoDecisions(
  trades: TradeLite[],
  opts: { currentEnabled?: Record<string, boolean>; spreadCostPerTrade?: number; spreadGuardFactor?: number; minSample?: number } = {},
): { decisions: AutoDecision[]; enable: Record<string, boolean>; sessionKills: Record<string, SessionKey[]> } {
  const decisions: AutoDecision[] = [];
  const enable: Record<string, boolean> = {};
  const sessionKills: Record<string, SessionKey[]> = {};
  const minSample = Math.max(1, opts.minSample ?? MIN_TRADES_STRATEGY); // القاعدة 29: عينة الحكم (30 صفقة)
  const spreadCost = opts.spreadCostPerTrade ?? 0.30;                    // القاعدة 17: سبريد 30 سنتاً للصفقة
  const spreadFactor = opts.spreadGuardFactor ?? 1;                     // القاعدة 28: معامل الأمان

  const ids = (Object.keys(STRATEGY_NAMES) as StrategyId[]).filter(s => s !== 'Z');
  const disabledNow = new Set(
    Object.entries(opts.currentEnabled ?? {}).filter(([, v]) => v === false).map(([k]) => k),
  );

  for (const st of ids) {
    // السلة المعتمدة خارج نطاق المدير الآلي حصراً: تعمل في مسارها الظلي المستقل
    // (src/lib/engine/basket.ts) ولا يُمس تفعيلها هنا — لا تعطيل ولا إعادة
    // تفعيل ولا قتل جلسات — ما عدا الأعضاء الذين خرجوا فعلاً من السلة.
    if (BASKET_IDS.includes(st)) {
      decisions.push({
        kind: 'note', strategy: st,
        reason: 'مكوّن السلة المعتمدة — يعمل في مساره الظلي المستقل على أساس 1000$ وخارج نطاق المدير الآلي (لا تعطيل ولا إعادة تفعيل)',
        metrics: { trades: 0 },
      });
      continue;
    }
    const m = metricsOf(trades, st);
    const allowed = ALLOWED_SESSIONS[st as keyof typeof ALLOWED_SESSIONS] ?? [];
    if (!m) {
      decisions.push({
        kind: 'note', strategy: st,
        reason: `لا صفقات في نافذة الاختبار — تبقى مفعلة بانتظار عينة (بوابات الجلسات الافتراضية ${allowed.join('/')})`,
        metrics: { trades: 0 },
      });
      enable[st] = true;
      continue;
    }
    // قرار تعطيل استراتيجية خاسرة بثبات — بعينة الحكم الكاملة فقط (القاعدة 29: 30 صفقة)
    if (m.trades >= minSample && m.pf < PF_DISABLE && m.net < 0) {
      // القاعدة 2 (بوابة السبريد): إذا كان الهامش المتحقق لكل صفقة دون تكلفة السبريد × معامل الأمان
      // فالاستراتيجية لا تبرر تفعيلها أصلاً — يُوثق ذلك في سبب التعطيل
      const spreadTag = m.expectancy < spreadCost * spreadFactor
        ? ` | بوابة السبريد (قاعدة 2): الهامش ${fmt(m.expectancy)}$ لكل صفقة دون السبريد ${fmt(spreadCost)}$ — لا تبرر للتفعيل`
        : '';
      decisions.push({
        kind: 'disable-strategy', strategy: st,
        reason: `عطلة بثبات: ${m.trades} صفقة، نجاح ${fmt(m.winRate)}%، PF ${fmt(m.pf)}، صافي ${fmt(m.net)}$ — تعطيل آلي حتى يتحسن نمطها في اختبار لاحق${spreadTag}`,
        metrics: { trades: m.trades, winRate: Math.round(m.winRate), pf: fmt(m.pf), net: fmt(m.net), expectancy: fmt(m.expectancy) },
      });
      enable[st] = false;
      continue;
    }
    // خاسرة بعينة دون عينة الحكم (30): تبقى مفعلة تحت المراقبة — لا حكم نهائي قبل الـ30 صفقة
    if (m.trades < minSample && m.pf < PF_DISABLE && m.net < 0) {
      decisions.push({
        kind: 'note', strategy: st,
        reason: `خاسرة مؤقتاً (${fmt(m.net)}$ على ${m.trades} صفقة) لكن العينة دون عينة الحكم ${minSample} — تبقى مفعلة تحت المراقبة (القاعدة 29) حتى تكتمل العينة أو يتحسن أداؤها`,
        metrics: { trades: m.trades, winRate: Math.round(m.winRate), pf: fmt(m.pf), net: fmt(m.net), expectancy: fmt(m.expectancy) },
      });
    }
    // قرار إعادة تفعيل رابحة سبق تعطيلها
    if (disabledNow.has(st) && m.pf >= PF_REENABLE && m.net > 0) {
      decisions.push({
        kind: 'enable-strategy', strategy: st,
        reason: `تحسنت وتتجاوز عتبة إعادة التفعيل: PF ${fmt(m.pf)} وصافي ${fmt(m.net)}$ على ${m.trades} صفقة — إعادة تفعيل آلية`,
        metrics: { trades: m.trades, pf: fmt(m.pf), net: fmt(m.net) },
      });
    }
    enable[st] = true;

    // قتل الجلسات الخاسرة داخل استراتيجية رابحة أو محايدة (لا لمعطلة أصلاً)
    if (allowed.length <= 1) continue; // جلسة واحدة حرفية من الدليل — لا قتل
    const bySess = new Map<string, { n: number; net: number; wins: number }>();
    for (const x of trades) {
      if (x.strategy !== st) continue;
      const cur = bySess.get(x.session) ?? { n: 0, net: 0, wins: 0 };
      cur.n++; cur.net += x.pnl; if (x.pnl >= 0) cur.wins++;
      bySess.set(x.session, cur);
    }
    const alive = [...bySess.values()].filter(v => v.net > 0);
    const kills: SessionKey[] = [];
    for (const [sess, v] of bySess) {
      if (!allowed.includes(sess as SessionKey)) continue;
      if (v.n < MIN_TRADES_SESSION) continue;
      if (v.net > SESSION_KILL_NET) continue;
      // حاجز: لا تقتل كل الجلسات — أبقِ الأفضل أو أول جلسة مسموحة
      const survivors = allowed.filter(s => {
        const o = bySess.get(s);
        return !kills.includes(s as SessionKey) && (!o || o.net > SESSION_KILL_NET || o.n < MIN_TRADES_SESSION);
      });
      if (alive.length === 0 && survivors.length <= 1) continue;
      kills.push(sess as SessionKey);
      decisions.push({
        kind: 'disable-session', strategy: st, session: sess,
        reason: `جلسة خاسرة داخل استراتيجية نشطة: ${v.n} صفقة بصافي ${fmt(v.net)}$ — إغلاق بوابة الجلسة آلياً مع بقاء بقية الجلسات`,
        metrics: { trades: v.n, net: fmt(v.net), winRate: Math.round((v.wins / v.n) * 100) },
      });
    }
    if (kills.length) sessionKills[st] = kills;
  }
  return { decisions, enable, sessionKills };
}

/**
 * تطبيق القرارات على شجرة الإعدادات: تفعيل/تعطيل استراتيجيات + قتل بوابات
 * الجلسات على كل بنود الاستراتيجية المعنية (s1 وs2 معاً).
 */
export function applyAutoDecisions(
  settings: Settings,
  decisions: AutoDecision[],
  sessionKills: Record<string, SessionKey[]>,
): Settings {
  const out = structuredClone(settings) as Settings;
  for (const d of decisions) {
    if (d.kind === 'disable-strategy') {
      const node = (out.strategyParams as unknown as Record<string, { enabled?: boolean }> | undefined)?.[d.strategy];
      if (node) node.enabled = false;
    }
    if (d.kind === 'enable-strategy') {
      const node = (out.strategyParams as unknown as Record<string, { enabled?: boolean }> | undefined)?.[d.strategy];
      if (node) node.enabled = true;
    }
  }
  for (const [st, sessions] of Object.entries(sessionKills)) {
    const cases = STRATEGY_CASES[st as keyof typeof STRATEGY_CASES] ?? [];
    for (const cs of cases) {
      const tree = out.scenarioSessions?.[st]?.[cs];
      if (!tree) continue;
      for (const sk of ['s1', 's2'] as const) {
        const node = tree[sk];
        if (!node) continue;
        for (const s of sessions) node[s] = false;
      }
    }
  }
  return out;
}

/** تقرير نهائي جاهز للتخزين */
export function buildReport(
  trades: TradeLite[],
  decisions: AutoDecision[],
  enable: Record<string, boolean>,
  window: { from?: string; to?: string },
  mode: string,
): AutoManagerReport {
  const all = metricsOf(trades);
  const enabledCount = Object.values(enable).filter(Boolean).length;
  const disabledCount = Object.values(enable).filter(v => v === false).length;
  return {
    runAt: Date.now(),
    mode,
    window,
    decisions,
    finalEnabled: enable,
    summary: {
      enabled: enabledCount,
      disabled: disabledCount,
      sessionKills: decisions.filter(d => d.kind === 'disable-session').length,
      totalTrades: all?.trades ?? 0,
      netAll: fmt(all?.net ?? 0),
    },
    autoMode: true,
  };
}
