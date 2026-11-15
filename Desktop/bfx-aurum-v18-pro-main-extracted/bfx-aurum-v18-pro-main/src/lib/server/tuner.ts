// ============================================================
// الضابط الذاتي للاستراتيجيات — بحث شبكي مع تحقق خارجي (Walk-Forward)
// ------------------------------------------------------------
// مهمته (أمر المالك): «اضبط كل الاستراتيجيات لتكون ناجحة» —
//   1) نافذة تدريب: 2025-06-01 → 2026-05-31 (12 شهراً من شموع MT5 الحقيقية)
//   2) لكل استراتيجية: شبكة قيم لمعاملي الوقف والهدف (وأحياناً معامل
//      فني إضافي) تُقيّم كلها على نافذة التدريب.
//   3) أفضل تركيبة تُختبر على نافذة تحقق خارجية لم تُلمس: 2026-06-01 → الآن
//      — لا تُعتمد إلا إذا نجحت خارج العينة (PF≥1 وصافي موجب).
//   4) تطبيق المعاملات المعتمدة على إعدادات البوت + تقرير موثق.
// بلا تسلل مستقبلي: كل قيمة تُقيَّم بمعرفة زمنية كاملة داخل نافذتها.
// ============================================================
import { withBacktestEngine, type BacktestWindow } from './backtestCache';
import { loadBotSettings, loadRealNews, type RealNewsEvent } from './backtestRunner';
import { runBacktest } from '@/lib/engine/backtest';
import { DEFAULT_SETTINGS, buildScenarioSessions, Settings } from '@/lib/engine/rules';
import { STRATEGY_NAMES } from '@/lib/engine/types';
import type { TamsaParams } from '@/lib/engine/tamsa-params';

export interface ParamAxis { paths: string[]; values: number[] }
export interface ParamCombo { axes: [number, number]; label: string }

export interface TunerMetrics { trades: number; winRate: number; pf: number; net: number; expectancy: number }
export interface TunerStrategyResult {
  strategy: string;
  name: string;
  train: TunerMetrics | null;
  oosBaseline: TunerMetrics | null;
  oosTuned: TunerMetrics | null;
  bestCombo?: { label: string; values: number[]; score: number };
  decision: 'tuned' | 'kept' | 'low-sample' | 'rejected-oos' | 'no-trades';
  note?: string;
}
export interface TunerReport {
  startedAt: number; finishedAt: number;
  train: { from: string; to: string };
  oos: { from: string; to: string };
  runs: number;
  applied: { strategy: string; paths: string[]; values: number[] }[];
  results: TunerStrategyResult[];
  systemBefore: { trades: number; winRate: number; pf: number; net: number; dd: number } | null;
  systemAfterOos: { trades: number; winRate: number; pf: number; net: number; dd: number } | null;
}

// ---------- شبكات الضبط لكل استراتيجية ----------
export const TUNER_GRID: Record<string, ParamAxis[]> = {
  A: [{ paths: ['slPips'], values: [60, 80, 100] }, { paths: ['tpPips'], values: [120, 150, 200] }],
  B: [{ paths: ['slPips'], values: [80, 100, 130] }, { paths: ['tpPips'], values: [150, 200, 250] }],
  C: [{ paths: ['rr'], values: [1.5, 2.0, 2.5] }, { paths: ['fibTouch'], values: [50, 61.8] }],
  D: [{ paths: ['slPips'], values: [60, 80, 100] }, { paths: ['tpPips'], values: [120, 150, 200] }],
  E: [{ paths: ['slPips'], values: [40, 50, 70] }, { paths: ['tpPips'], values: [100, 150, 200] }],
  F: [{ paths: ['exec.slPips'], values: [40, 50, 60] }, { paths: ['exec.tpPips'], values: [80, 100, 120] }],
  G: [{ paths: ['revSlPips'], values: [30, 40, 50] }, { paths: ['revTpPips'], values: [120, 150, 200] }],
  H: [{ paths: ['slPips'], values: [50, 70, 90] }, { paths: ['tpPips'], values: [120, 150, 200] }],
  I: [{ paths: ['slPips'], values: [25, 30, 40] }, { paths: ['tpPips'], values: [80, 100, 130] }],
  J: [{ paths: ['exec.slPips'], values: [50, 70, 90] }, { paths: ['exec.fixedTpPips'], values: [120, 150, 200] }],
  K: [{ paths: ['exec.slPips'], values: [25, 30, 40] }, { paths: ['exec.fixedTpPips'], values: [80, 100, 130] }],
  L: [{ paths: ['exec.revSlPips'], values: [30, 40, 50] }, { paths: ['exec.revTpPips'], values: [120, 150, 200] }],
  M: [{ paths: ['exec.revSlPips'], values: [30, 40, 50] }, { paths: ['exec.revTpPips'], values: [120, 150, 200] }],
  N: [{ paths: ['exec.revSlPips'], values: [40, 60, 80] }, { paths: ['exec.revTpPips'], values: [120, 150, 200] }],
  O: [{ paths: ['exec.revSlPips'], values: [30, 40, 50] }, { paths: ['exec.revTpPips'], values: [80, 100, 130] }],
  P: [{ paths: ['slPips'], values: [40, 50, 60] }, { paths: ['tpPips'], values: [120, 150, 200] }],
  Q: [{ paths: ['slPips'], values: [30, 40, 50] }, { paths: ['tpPips'], values: [120, 150, 200] }],
  R: [{ paths: ['r1.slPips', 'r2.slPips'], values: [50, 70, 90] }, { paths: ['r1.tpPips', 'r2.tpPips'], values: [150, 200, 250] }],
  S: [{ paths: ['london.slPips', 'ny.slPips'], values: [60, 80, 100] }, { paths: ['london.tpPips', 'ny.tpPips'], values: [120, 150, 200] }],
  T: [{ paths: ['slAtrMult'], values: [1.0, 1.5, 2.0] }, { paths: ['tpAtrMult'], values: [2.5, 3.0, 4.0] }],
  U: [{ paths: ['slPips'], values: [30, 40, 50] }, { paths: ['tpPips'], values: [60, 80, 100] }],
  V: [{ paths: ['slPips'], values: [40, 60, 80] }, { paths: ['tpPips'], values: [60, 90, 120] }],
  W: [{ paths: ['slAtrMult'], values: [1.5, 2.0, 2.5] }, { paths: ['tpAtrMult'], values: [3.0, 4.0, 5.0] }],
};

const TRAIN_W: BacktestWindow = {
  fromT: Date.UTC(2025, 5, 1) - 180 * 86400e3,
  toT: Date.UTC(2026, 4, 31, 23, 59, 59),
  reportFrom: Date.UTC(2025, 5, 1),
  reportTo: Date.UTC(2026, 4, 31, 23, 59, 59),
  permanent: true,
};
const OOS_W: BacktestWindow = {
  fromT: Date.UTC(2026, 5, 1) - 180 * 86400e3,
  toT: Date.now(),
  reportFrom: Date.UTC(2026, 5, 1),
  reportTo: Date.now(),
  permanent: false,
};

// ---------- حالة المهمة (مؤشرات التقدم) ----------
export interface TunerJobState {
  running: boolean; startedAt: number | null; finishedAt: number | null;
  stage: string; done: number; total: number; log: string[];
  report: TunerReport | null; error: string | null;
}
const g = globalThis as unknown as { __tunerJob?: TunerJobState };
const job = (): TunerJobState =>
  g.__tunerJob ?? (g.__tunerJob = { running: false, startedAt: null, finishedAt: null, stage: '—', done: 0, total: 0, log: [], report: null, error: null });

export function getTunerJob(): TunerJobState { return job(); }

export function startTuner(): { ok: boolean; error?: string } {
  const j = job();
  if (j.running) return { ok: false, error: 'الضبط يعمل حالياً — انتظر انتهاء المهمة' };
  j.running = true; j.startedAt = Date.now(); j.finishedAt = null;
  j.stage = 'تهيئة'; j.done = 0; j.total = 0; j.log = []; j.report = null; j.error = null;
  tunerLoop().catch(e => {
    j.running = false; j.finishedAt = Date.now();
    j.error = String(e instanceof Error ? e.message : e).slice(0, 300);
    j.log.push(`فشل: ${j.error}`);
  });
  return { ok: true };
}

// ---------- أدوات ----------
const yield_ = () => new Promise<void>(r => setImmediate(r));

function setParam(params: TamsaParams, st: string, path: string, value: number) {
  const parts = path.split('.');
  let node: Record<string, unknown> = (params as unknown as Record<string, Record<string, unknown>>)[st];
  for (let i = 0; i < parts.length - 1; i++) {
    node = node[parts[i]] as unknown as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

function metricsOf(trades: { strategy: string; pnl: number }[], st?: string): TunerMetrics | null {
  const t = st ? trades.filter(x => x.strategy === st) : trades;
  if (!t.length) return null;
  let gw = 0, gl = 0, net = 0, wins = 0;
  for (const x of t) { net += x.pnl; if (x.pnl >= 0) { gw += x.pnl; wins++; } else gl += -x.pnl; }
  return {
    trades: t.length, winRate: (wins / t.length) * 100,
    pf: gl > 0 ? gw / gl : (gw > 0 ? 99 : 0), net, expectancy: net / t.length,
  };
}

const fmt = (n: number) => Math.round(n * 100) / 100;
const mLine = (m: TunerMetrics | null) => m ? `${m.trades} صفقة | نجاح ${Math.round(m.winRate)}% | PF ${fmt(m.pf)} | صافي ${fmt(m.net)}$` : 'لا صفقات';

function cloneSettings(s: Settings): Settings { return structuredClone(s) as Settings; }

/** إعدادات المصنع: كل الاستراتيجيات مفعلة وكل الجلسات مفتوحة — قياس عادل للجميع */
function factorySettings(): Settings {
  const s = structuredClone(DEFAULT_SETTINGS) as Settings;
  s.scenarioSessions = buildScenarioSessions();
  return s;
}

function runWindow(w: BacktestWindow, settings: Settings, news: RealNewsEvent[]) {
  return withBacktestEngine(w, data => runBacktest(data, settings, Date.now(), news, { fromT: w.reportFrom, toT: w.reportTo }));
}

/** درجة التركيبة: التوقع لكل صفقة مرجّحة بعينة محدودة */
function score(m: TunerMetrics): number {
  const sample = Math.min(1, m.trades / 15);
  return m.expectancy * sample;
}

// ---------- الحلقة الرئيسية ----------
async function tunerLoop() {
  const j = job();
  try {
    const news = await loadRealNews();
    const harness = factorySettings();
    const ids = Object.keys(TUNER_GRID);

    j.stage = 'خط الأساس على نافذة التدريب';
    const t0 = Date.now();
    const baseTrain = runWindow(TRAIN_W, harness, news);
    if (!baseTrain.ok) throw new Error(baseTrain.reason);
    const trainTrades = baseTrain.result.trades as { strategy: string; pnl: number }[];
    j.total = ids.reduce((s, st) => s + (TUNER_GRID[st][0].values.length * TUNER_GRID[st][1].values.length) + 1, 0) + ids.length + 2;
    j.done++;
    j.log.push(`خط أساس التدريب (${Math.round((Date.now() - t0) / 1000)}s): النظام كله ${mLine(metricsOf(trainTrades))}`);
    await yield_();

    const results: TunerStrategyResult[] = [];
    const applied: TunerReport['applied'] = [];

    for (const st of ids) {
      const stage0 = Date.now();
      j.stage = `ضبط ${st} — ${STRATEGY_NAMES[st as keyof typeof STRATEGY_NAMES]}`;
      const axes = TUNER_GRID[st];
      const combos: { values: number[]; label: string }[] = [];
      for (const a of axes[0].values) for (const b of axes[1].values) {
        combos.push({ values: [a, b], label: `${axes[0].paths.join('+')}=${a} · ${axes[1].paths.join('+')}=${b}` });
      }
      const baseM = metricsOf(trainTrades, st);
      if (!baseM || baseM.trades < 8) {
        results.push({
          strategy: st, name: STRATEGY_NAMES[st as keyof typeof STRATEGY_NAMES],
          train: baseM, oosBaseline: null, oosTuned: null,
          decision: baseM && baseM.trades > 0 ? 'low-sample' : 'no-trades',
          note: baseM ? `عينة تدريب صغيرة (${baseM.trades}) — بلا بحث شبكي` : 'لا صفقات في التدريب',
        });
        j.done += combos.length + 1;
        j.log.push(`${st}: تخطي الضبط — ${mLine(baseM)}`);
        await yield_();
        continue;
      }
      const baseScore = baseM.pf >= 1.02 ? score(baseM) : -Infinity;
      let best: { values: number[]; label: string; m: TunerMetrics; s: number } | null = null;
      for (const c of combos) {
        const s2 = cloneSettings(harness);
        for (let k = 0; k < axes.length; k++) {
          for (const p of axes[k].paths) setParam(s2.strategyParams, st, p, c.values[k]);
        }
        const r = runWindow(TRAIN_W, s2, news);
        j.done++;
        if (r.ok) {
          const m = metricsOf(r.result.trades as { strategy: string; pnl: number }[], st);
          if (m && m.trades >= 6 && m.pf >= 1.02) {
            const sc = score(m);
            if (!best || sc > best.s) best = { values: c.values, label: c.label, m, s: sc };
          }
        }
        await yield_();
      }
      const candidate = best && best.s > baseScore;
      const res: TunerStrategyResult = {
        strategy: st, name: STRATEGY_NAMES[st as keyof typeof STRATEGY_NAMES],
        train: baseM, oosBaseline: null, oosTuned: null,
        decision: candidate ? 'kept' : 'kept',
        note: candidate ? `مرشح: ${best!.label} — تدريب ${mLine(best!.m)}` : 'الافتراضي هو الأفضل في التدريب',
        bestCombo: candidate ? { label: best!.label, values: best!.values, score: fmt(best!.s) } : undefined,
      };
      if (candidate) res.decision = 'kept';
      // التحقق الخارجي: المرشح فقط يحتاج تشغيل OOS خاص
      if (candidate) {
        const s2 = cloneSettings(harness);
        for (let k = 0; k < axes.length; k++) {
          for (const p of axes[k].paths) setParam(s2.strategyParams, st, p, best!.values[k]);
        }
        const r = runWindow(OOS_W, s2, news);
        j.done++;
        if (r.ok) {
          const oos = metricsOf(r.result.trades as { strategy: string; pnl: number }[], st);
          res.oosTuned = oos;
          if (oos && oos.pf >= 1.0 && oos.net > 0) {
            res.decision = 'tuned';
            applied.push({ strategy: st, paths: [...axes[0].paths, ...axes[1].paths], values: [...best!.values] });
            res.note = `معتمد خارج العينة: ${best!.label} — OOS ${mLine(oos)}`;
          } else {
            res.decision = 'rejected-oos';
            res.note = `فشل خارج العينة (OOS ${mLine(oos)}) — تبقى القيم الافتراضية`;
          }
        }
      }
      results.push(res);
      j.log.push(`${st}: ${res.decision === 'tuned' ? '✅ ضُبط' : res.decision === 'rejected-oos' ? '⚠️ رُفض خارجياً' : '↔ بقي افتراضياً'} — ${res.note} (${Math.round((Date.now() - stage0) / 1000)}s)`);
      await yield_();
    }

    // OOS خط أساس للنظام (بمعاملات المصنع) + OOS النهائي (بالمعاملات المعتمدة)
    j.stage = 'التحقق الخارجي للنظام الكامل';
    const oosBase = runWindow(OOS_W, harness, news);
    j.done++;
    if (oosBase.ok) {
      const tt = oosBase.result.trades as { strategy: string; pnl: number }[];
      for (const r of results) r.oosBaseline = metricsOf(tt, r.strategy);
    }
    await yield_();

    // تطبيق المعاملات المعتمدة على إعدادات البوت المحفوظة
    j.stage = 'تطبيق المعاملات المعتمدة';
    const saved = await loadBotSettings();
    const finalSettings = cloneSettings(saved);
    finalSettings.scenarioSessions = buildScenarioSessions(); // مصانع الجلسات — المدير الآلي يتولى القرارات
    for (const st of Object.keys(finalSettings.strategyParams as unknown as Record<string, unknown>)) {
      (finalSettings.strategyParams as unknown as Record<string, { enabled?: boolean }>)[st].enabled = true;
    }
    for (const a of applied) {
      for (let k = 0; k < a.paths.length; k++) setParam(finalSettings.strategyParams, a.strategy, a.paths[k], a.values[k]);
    }
    const oosFinal = runWindow(OOS_W, finalSettings, news);
    j.done++;

    // حفظ الإعدادات المطبقة
    const { db } = await import('@/lib/db');
    const merged = { ...(DEFAULT_SETTINGS as unknown as Record<string, unknown>), ...(finalSettings as unknown as Record<string, unknown>) };
    await db.botSettings.upsert({
      where: { key: 'main' },
      create: { key: 'main', json: JSON.stringify(merged) },
      update: { json: JSON.stringify(merged) },
    });

    const sysMetrics = (r: ReturnType<typeof runBacktest> | null) => r ? {
      trades: r.stats.totalTrades, winRate: fmt(r.stats.winRate), pf: fmt(r.stats.profitFactor),
      net: fmt(r.stats.netPnl), dd: fmt(r.stats.maxDrawdownPct),
    } : null;

    const report: TunerReport = {
      startedAt: j.startedAt!, finishedAt: Date.now(),
      train: { from: new Date(TRAIN_W.reportFrom).toISOString(), to: new Date(TRAIN_W.reportTo).toISOString() },
      oos: { from: new Date(OOS_W.reportFrom).toISOString(), to: new Date(OOS_W.reportTo).toISOString() },
      runs: j.done,
      applied,
      results,
      systemBefore: sysMetrics(baseTrain.ok ? baseTrain.result : null),
      systemAfterOos: sysMetrics(oosFinal.ok ? oosFinal.result : null),
    };
    j.report = report;
    await db.botSettings.upsert({
      where: { key: 'tunerReport' },
      create: { key: 'tunerReport', json: JSON.stringify({ report }) },
      update: { json: JSON.stringify({ report }) },
    });
    j.log.push(`انتهى الضبط: ${applied.length} استراتيجية معتمدة خارج العينة من ${ids.length} — النظام خارج العينة بعد الضبط: ${mLine(metricsOf(oosFinal.ok ? (oosFinal.result.trades as { strategy: string; pnl: number }[]) : [], undefined))}`);
    j.stage = 'مكتمل';
  } finally {
    j.running = false;
    j.finishedAt = Date.now();
  }
}
