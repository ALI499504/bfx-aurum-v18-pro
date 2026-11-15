'use client';

// مخزن حالة البوت — الإعدادات ونتائج الباك تيست
// الحفظ الآن بتصحيحات جزئية (JSON Patch): نرسل فقط الفروق عن آخر نسخة محمّلة من الخادم
// — لا يمكن لتاب مفتوح قديم أن يمسح إعدادات عدّلها مصدر آخر أثناء غيابه (سبب انعكاس
// الإعدادات المتكرر: الكائن الكامل القديم كان يُكتب فوق الجديد بأي تفاعل متأخر)
//
// مزامنة لحظية متعددة المستخدمين: كل متصفح مفتوح يستطلع الخادم كل 4 ثوانٍ —
// أي تغيير إعدادات أو باك تيست من أي مستخدم يُطبَّق تلقائياً على الجميع دون تحديث الصفحة.
import { create } from 'zustand';
import { JARVIS_SECTION_CLOSED } from '@/lib/jarvis-flag';
import { STRATEGY_NAMES, StrategyId, SESSION_AR, SessionId } from '@/lib/engine/types';
import { DEFAULT_SETTINGS } from '@/lib/engine/rules';
import type { Trade } from '@/lib/engine/types';

export type Settings = typeof DEFAULT_SETTINGS;

export interface BacktestStats {
  startT: number; endT: number;
  totalTrades: number; wins: number; losses: number; winRate: number;
  netPnl: number; finalBalance: number; baseBalance: number;
  profitFactor: number; maxDrawdown: number; maxDrawdownPct: number;
  oos: { trades: number; winRate: number; avgR: number; gatePass: boolean; gateEnabled: boolean; threshold: number; minTrades: number };
  dailyKpi: { daysTraded: number; daysWith2Plus: number; pct: number; excludedStopDays: number; target: number };
  weekly: { weekStart: number; net: number; pct: number }[];
  monthly: { month: string; net: number; pct: number }[];
  matrix: Record<string, Record<string, { net: number; wins: number; losses: number; trades: number; winRate: number }>>;
  strategyTotals: Record<string, { net: number; trades: number; wins: number; losses: number; winRate: number; weeklyAvgPct: number; monthlyAvgPct: number; bestSession: string | null; worstSession: string | null }>;
  ranking: { strategy: string; net: number; winRate: number; trades: number }[];
  emaEnabled: boolean; emaState: string;
  spreadCents: number; lot: number; tpRatio: number;
  generatedAt: number;
  signalsCount: number; fillsBlocked: number;
  /** توزيع أسباب حظر التنفيذ — شفافية كاملة */
  blocked?: Record<string, number>;
  /** ضربات الحوكمة الصلبة */
  railHits?: { maxTrades: number; dailyLoss: number; lotClamp: number; concurrent: number };
  /** نمط تحديد الحجم */
  sizing?: { mode: 'fixed' | 'risk'; riskPct: number };
  /** متوسط درجة الجودة للصفقات المنفذة */
  avgScore?: number;
  /** منحنى الرصيد الكامل من المحرك (مصغّر) — دقيق حتى مع اقتصار العرض على آخر 3000 صفقة */
  equity?: { t: number; v: number }[];
  finalStructure?: {
    trend1h: string; trend4h: string;
    lastRealHigh?: { kind: string; price: number; t: number };
    lastRealLow?: { kind: string; price: number; t: number };
    lastEvents: { type: string; dir: string; level: number; t: number }[];
  };
  runMs?: number;
}

export interface PatchOp { op: 'replace' | 'add'; path: string; value: unknown }

/** فرق عميق مبسط لمصفوفة JSON Patch — الكائنات تُفحص مفتاحاً مفتاحاً، والمصفوفات والقيم تُستبدل كاملة */
function diffSettings(base: unknown, next: unknown, path = ''): PatchOp[] {
  const ops: PatchOp[] = [];
  if (base === next) return ops;
  const bothObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  if (bothObj(base) && bothObj(next)) {
    for (const k of Object.keys(next)) {
      ops.push(...diffSettings(base[k], next[k], `${path}/${encodeURIComponent(k)}`));
    }
    return ops;
  }
  if (JSON.stringify(base) !== JSON.stringify(next)) {
    ops.push({ op: 'replace', path: path || '/', value: next });
  }
  return ops;
}

interface BotState {
  settings: Settings;
  baseRef: Settings;
  loaded: boolean;
  saving: boolean;
  dirty: boolean;
  saveError: string | null;
  tab: string;
  trades: Trade[];
  stats: BacktestStats | null;
  running: boolean;
  runError: string | null;
  /** معرّف نتيجة الباك تيست المعروضة — للكشف عن نتائج جديدة من مستخدمين آخرين */
  runId: string | null;
  /** وقت تشغيل النتيجة المعروضة (ISO) */
  runAt: string | null;
  /** آخر نجاح مزامنة مع الخادم (ms) — مؤشر "مزامنة مباشرة" */
  lastSyncAt: number | null;
  /** إشعار عابر: تغيير من مستخدم آخر طُبّق تلقائياً */
  syncFlash: string | null;
  setTab: (t: string) => void;
  loadSettings: () => Promise<void>;
  patchSettings: (fn: (s: Settings) => void) => void;
  saveSettings: () => Promise<void>;
  runBacktest: () => Promise<void>;
  loadLastRun: () => Promise<void>;
  /** تشغيل حلقة المزامنة اللحظية (مرة واحدة لكل صفحة) */
  startSync: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

// --- حالة المزامنة اللحظية (خارج المخزن — لا تستهلك إعادة رسم) ---
let syncTimer: ReturnType<typeof setInterval> | null = null;
/** بصمة updatedAt للإعدادات كما رأيناها آخر مرة من الخادم */
let lastSrvUpd: string | null = null;
let flashTimer: ReturnType<typeof setTimeout> | null = null;
/** صحيح أثناء طلب POST باك تيست من هذا المتصفح — لكي لا يُغشّر استطلاع الخلفية نتيجتنا */
let ownRunInFlight = false;

export const useBot = create<BotState>((set, get) => ({
  settings: DEFAULT_SETTINGS as unknown as Settings,
  baseRef: DEFAULT_SETTINGS as unknown as Settings,
  loaded: false,
  saving: false,
  dirty: false,
  saveError: null,
  // قسم «جارفس — القلب النابض» مغلق بقرار المالك — البوت يفتح على لوحة القيادة مباشرة
  tab: JARVIS_SECTION_CLOSED ? 'dashboard' : 'jarvis',
  trades: [],
  stats: null,
  running: false,
  runError: null,
  runId: null,
  runAt: null,
  lastSyncAt: null,
  syncFlash: null,

  setTab: (t) => set({ tab: t }),

  loadSettings: async () => {
    try {
      const r = await fetch('/api/settings', { cache: 'no-store' });
      const j = await r.json();
      const s = j.settings as Settings;
      if (j.updatedAt) lastSrvUpd = j.updatedAt as string;
      set({ settings: s, baseRef: structuredClone(s), loaded: true, lastSyncAt: Date.now() });
    } catch {
      set({ loaded: true });
    }
  },

  patchSettings: (fn) => {
    const s = structuredClone(get().settings);
    fn(s);
    set({ settings: s, dirty: true });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { get().saveSettings(); }, 600);
  },

  saveSettings: async () => {
    set({ saving: true });
    try {
      // تصحيحات جزئية فقط: الفروق عن آخر نسخة خادم — تفاعل تاب قديم لا يمسح ما لم يغيّره
      const patches = diffSettings(get().baseRef, get().settings);
      if (!patches.length) { set({ dirty: false, saving: false }); return; }
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patches }),
      });
      if (!r.ok) throw new Error('رفض الخادم الحفظ');
      try {
        const j = await r.json();
        if (j?.updatedAt) lastSrvUpd = j.updatedAt as string;
      } catch { /* تجاهل — بصمة الخادم ستُلتقط في الاستطلاع التالي */ }
      set({ baseRef: structuredClone(get().settings), dirty: false, saving: false, saveError: null });
    } catch (e) {
      // لا نبتلع فشل الحفظ — المستخدم يجب أن يعرف أن جدولته لم تُخزَّن
      set({ saving: false, saveError: e instanceof Error ? e.message : 'فشل الحفظ' });
    }
  },

  runBacktest: async () => {
    set({ running: true, runError: null });
    ownRunInFlight = true;
    try {
      await get().saveSettings();
      const r = await fetch('/api/backtest', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'فشل التشغيل');
      // نتيجتنا صارت محفوظة على الخادم — ستظهر تلقائياً عند بقية المستخدمين
      set({ trades: j.trades ?? [], stats: j.stats, running: false, runId: j.id ?? null, runAt: j.runAt ?? null, lastSyncAt: Date.now() });
    } catch (e) {
      set({ running: false, runError: e instanceof Error ? e.message : 'خطأ غير معروف' });
    } finally {
      ownRunInFlight = false;
    }
  },

  loadLastRun: async () => {
    try {
      const r = await fetch('/api/backtest', { cache: 'no-store' });
      const j = await r.json();
      if (j.exists) set({ trades: j.trades ?? [], stats: j.stats, runId: j.id ?? null, runAt: j.runAt ?? null, lastSyncAt: Date.now() });
    } catch { /* ignore */ }
  },

  startSync: () => {
    // حلقة واحدة لكل صفحة — استطلاع كل 4 ثوانٍ: إعدادات + آخر نتيجة باك تيست
    if (syncTimer) return;
    const flash = (msg: string) => {
      set({ syncFlash: msg });
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => set({ syncFlash: null }), 9000);
    };
    syncTimer = setInterval(async () => {
      const st = get();
      // (أ) مزامنة الإعدادات — لا نطأع تعديلات محلية غير محفوظة أو حفظاً جارياً
      try {
        const r = await fetch('/api/settings', { cache: 'no-store' });
        const j = await r.json();
        const upd = (j?.updatedAt as string | undefined) ?? null;
        if (upd) {
          const changed = lastSrvUpd !== null && upd !== lastSrvUpd;
          lastSrvUpd = upd;
          if (changed && !st.dirty && !st.saving) {
            set({ settings: j.settings as Settings, baseRef: structuredClone(j.settings), lastSyncAt: Date.now() });
            flash('تم تحديث الإعدادات من مستخدم آخر — طُبّقت عندك تلقائياً');
          }
        }
      } catch { /* الخادم غير متاح — نحاول لاحقاً */ }
      // (ب) مزامنة آخر نتيجة باك تيست — أي تشغيل من أي مستخدم يظهر عند الجميع
      // استطلاع خفيف (بصمة فقط) — التنزيل الكامل فقط عند تغيّر النتيجة فعلاً
      try {
        if (ownRunInFlight) return;
        const r2 = await fetch('/api/backtest?meta=1', { cache: 'no-store' });
        const j2 = await r2.json();
        if (j2?.exists && j2.id) {
          const cur = get().runId;
          if (cur === null) {
            // أول ملاحظة بعد الفتح — تبنّى صامت لآخر نتيجة محفوظة
            await get().loadLastRun();
          } else if (j2.id !== cur) {
            await get().loadLastRun();
            flash('نتيجة باك تيست جديدة شغّلها مستخدم آخر — عُرضت عندك تلقائياً');
          }
        }
      } catch { /* ignore */ }
    }, 4000);
  },
}));

export { STRATEGY_NAMES, SESSION_AR };
export type { StrategyId, SessionId };
