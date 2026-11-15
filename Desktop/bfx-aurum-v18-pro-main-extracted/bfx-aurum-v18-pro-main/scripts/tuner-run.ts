// ============================================================
// الضابط الذاتي — عملية مستقلة عن خادم الويب (bun scripts/tuner-run.ts)
// ------------------------------------------------------------
// سبب الفصل: ضغط الذاكرة على خادم dev أثناء 200+ تشغيل باك تيست
// كان يسقط الخادم ويضيع المهمة. هذه العملية تكتب:
//   - التقدم لحظياً في db/tuner-progress.json (يقرؤه /api/tuner)
//   - التقرير النهائي في BotSettings['tunerReport']
//   - المعاملات المعتمدة في BotSettings['main']
// نفس منطق البحث الشبكي Walk-Forward: تدريب 2025-06→2026-05،
// تحقق خارجي 2026-06→الآن، لا اعتماد إلا لما نجح خارج العينة.
// ============================================================
import { writeFileSync } from 'fs';
import { withBacktestEngine, type BacktestWindow } from '../src/lib/server/backtestCache';
import { runBacktest } from '../src/lib/engine/backtest';
import { DEFAULT_SETTINGS, buildScenarioSessions, defaultLadders, Settings } from '../src/lib/engine/rules';
import { STRATEGY_NAMES } from '../src/lib/engine/types';
import { DEFAULT_TAMSA_PARAMS, type TamsaParams } from '../src/lib/engine/tamsa-params';
import { mt5Feed } from '../src/lib/server/mt5feed';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PROGRESS_PATH = 'db/tuner-progress.json';

export interface ParamAxis { paths: string[]; values: number[] }
export interface TunerMetrics { trades: number; winRate: number; pf: number; net: number; expectancy: number }
export interface TunerStrategyResult {
  strategy: string; name: string;
  train: TunerMetrics | null; oosBaseline: TunerMetrics | null; oosTuned: TunerMetrics | null;
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

// ---------- شبكات الضبط (مطابقة لنسخة الخادم) ----------
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
// التحقق الخارجي ثابت أيضاً — بياناته المجمدة تكفي للقرار ويمنع إعادة البناء المكلفة
const OOS_W: BacktestWindow = {
  fromT: Date.UTC(2026, 5, 1) - 180 * 86400e3,
  toT: Date.UTC(2026, 10, 9, 23, 59, 59),
  reportFrom: Date.UTC(2026, 5, 1),
  reportTo: Date.UTC(2026, 10, 9, 23, 59, 59),
  permanent: true,
};

// ---------- حالة التقدم ----------
interface Progress {
  running: boolean; pid: number; startedAt: number; finishedAt: number | null;
  stage: string; done: number; total: number; log: string[]; error: string | null;
  reportSaved: boolean;
}
const progress: Progress = {
  running: true, pid: process.pid, startedAt: Date.now(), finishedAt: null,
  stage: 'تهيئة', done: 0, total: 0, log: [], error: null, reportSaved: false,
};
function saveProgress() {
  try { writeFileSync(PROGRESS_PATH, JSON.stringify(progress)); } catch { /* تجاهل */ }
}

// ---------- أدوات ----------
const yield_ = () => new Promise<void>(r => setTimeout(r, 5));

function setParam(params: TamsaParams, st: string, path: string, value: number) {
  const parts = path.split('.');
  let node: Record<string, unknown> = (params as unknown as Record<string, Record<string, unknown>>)[st];
  for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] as unknown as Record<string, unknown>;
  node[parts[parts.length - 1]] = value;
}

function metricsOf(trades: { strategy: string; pnl: number }[], st?: string): TunerMetrics | null {
  const t = st ? trades.filter(x => x.strategy === st) : trades;
  if (!t.length) return null;
  let gw = 0, gl = 0, net = 0, wins = 0;
  for (const x of t) { net += x.pnl; if (x.pnl >= 0) { gw += x.pnl; wins++; } else gl += -x.pnl; }
  return { trades: t.length, winRate: (wins / t.length) * 100, pf: gl > 0 ? gw / gl : (gw > 0 ? 99 : 0), net, expectancy: net / t.length };
}

const fmt = (n: number) => Math.round(n * 100) / 100;
const mLine = (m: TunerMetrics | null) => m ? `${m.trades} صفقة | نجاح ${Math.round(m.winRate)}% | PF ${fmt(m.pf)} | صافي ${fmt(m.net)}$` : 'لا صفقات';
const score = (m: TunerMetrics) => m.expectancy * Math.min(1, m.trades / 15);

function factorySettings(): Settings {
  const s = structuredClone(DEFAULT_SETTINGS) as Settings;
  s.scenarioSessions = buildScenarioSessions();
  return s;
}

function runWindow(w: BacktestWindow, settings: Settings) {
  return withBacktestEngine(w, data => runBacktest(data, settings, Date.now(), [], { fromT: w.reportFrom, toT: w.reportTo }));
}

// ---------- الحلقة الرئيسية ----------
async function main() {
  const t0 = Date.now();
  saveProgress();
  try {
    // بيانات: أوقف التحميل التدريجي — اللقطة كاملة على القرص
    mt5Feed();
    const harness = factorySettings();
    const ids = Object.keys(TUNER_GRID);

    progress.stage = 'خط الأساس على نافذة التدريب';
    const r0 = runWindow(TRAIN_W, harness);
    if (!r0.ok) throw new Error(r0.reason);
    const trainTrades = r0.result.trades as { strategy: string; pnl: number }[];
    progress.total = ids.reduce((s, st) => s + TUNER_GRID[st][0].values.length * TUNER_GRID[st][1].values.length + 1, 0) + ids.length + 2;
    progress.done++;
    progress.log.push(`خط أساس التدريب (${Math.round((Date.now() - t0) / 1000)}s): النظام كله ${mLine(metricsOf(trainTrades))}`);
    saveProgress();

    const results: TunerStrategyResult[] = [];
    const applied: TunerReport['applied'] = [];

    for (const st of ids) {
      const stage0 = Date.now();
      progress.stage = `ضبط ${st} — ${STRATEGY_NAMES[st as keyof typeof STRATEGY_NAMES]}`;
      const axes = TUNER_GRID[st];
      const baseM = metricsOf(trainTrades, st);
      if (!baseM || baseM.trades < 8) {
        results.push({
          strategy: st, name: STRATEGY_NAMES[st as keyof typeof STRATEGY_NAMES],
          train: baseM, oosBaseline: null, oosTuned: null,
          decision: baseM && baseM.trades > 0 ? 'low-sample' : 'no-trades',
          note: baseM ? `عينة تدريب صغيرة (${baseM.trades}) — بلا بحث شبكي` : 'لا صفقات في التدريب',
        });
        progress.done += axes[0].values.length * axes[1].values.length + 1;
        progress.log.push(`${st}: تخطي الضبط — ${mLine(baseM)}`);
        saveProgress();
        await yield_();
        continue;
      }
      const combos: { values: number[]; label: string }[] = [];
      for (const a of axes[0].values) for (const b of axes[1].values) {
        combos.push({ values: [a, b], label: `${axes[0].paths.join('+')}=${a} · ${axes[1].paths.join('+')}=${b}` });
      }
      const baseScore = baseM.pf >= 1.02 ? score(baseM) : -Infinity;
      let best: { values: number[]; label: string; m: TunerMetrics; s: number } | null = null;
      for (const c of combos) {
        const s2 = structuredClone(harness) as Settings;
        for (let k = 0; k < axes.length; k++) for (const p of axes[k].paths) setParam(s2.strategyParams, st, p, c.values[k]);
        const r = runWindow(TRAIN_W, s2);
        progress.done++;
        if (r.ok) {
          const m = metricsOf(r.result.trades as { strategy: string; pnl: number }[], st);
          if (m && m.trades >= 6 && m.pf >= 1.02) {
            const sc = score(m);
            if (!best || sc > best.s) best = { values: c.values, label: c.label, m, s: sc };
          }
        }
        saveProgress();
        await yield_();
      }
      const candidate = !!(best && best.s > baseScore);
      const res: TunerStrategyResult = {
        strategy: st, name: STRATEGY_NAMES[st as keyof typeof STRATEGY_NAMES],
        train: baseM, oosBaseline: null, oosTuned: null, decision: 'kept',
        note: candidate ? `مرشح: ${best!.label} — تدريب ${mLine(best!.m)}` : 'الافتراضي هو الأفضل في التدريب',
        bestCombo: candidate ? { label: best!.label, values: best!.values, score: fmt(best!.s) } : undefined,
      };
      if (candidate) {
        const s2 = structuredClone(harness) as Settings;
        for (let k = 0; k < axes.length; k++) for (const p of axes[k].paths) setParam(s2.strategyParams, st, p, best!.values[k]);
        const r = runWindow(OOS_W, s2);
        progress.done++;
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
      progress.log.push(`${st}: ${res.decision === 'tuned' ? '✅ ضُبط' : res.decision === 'rejected-oos' ? '⚠️ رُفض خارجياً' : '↔ بقي افتراضياً'} — ${res.note} (${Math.round((Date.now() - stage0) / 1000)}s)`);
      saveProgress();
      await yield_();
    }

    // OOS خط أساس (مصنع) ثم النظام النهائي بمعاملات الضبط
    progress.stage = 'التحقق الخارجي للنظام الكامل';
    const oosBase = runWindow(OOS_W, harness);
    progress.done++;
    if (oosBase.ok) {
      const tt = oosBase.result.trades as { strategy: string; pnl: number }[];
      for (const r of results) r.oosBaseline = metricsOf(tt, r.strategy);
    }
    await yield_();

    progress.stage = 'تطبيق المعاملات المعتمدة';
    // الإعدادات النهائية: مصانع الجلسات + كل الاستراتيجيات مفعلة + معاملات الضبط المعتمدة
    const row = await prisma.botSettings.findUnique({ where: { key: 'main' } });
    const saved = row ? JSON.parse(row.json) as Record<string, unknown> : {};
    const finalSettings = { ...(structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>), ...saved } as unknown as Settings;
    finalSettings.scenarioSessions = buildScenarioSessions();
    finalSettings.priorityLadder = defaultLadders(); // سلم المصنع A–W — الجديد برتبة حقيقية لا 99
    for (const st of Object.keys(finalSettings.strategyParams as unknown as Record<string, unknown>)) {
      (finalSettings.strategyParams as unknown as Record<string, { enabled?: boolean }>)[st].enabled = true;
    }
    for (const a of applied) {
      for (let k = 0; k < a.paths.length; k++) setParam(finalSettings.strategyParams, a.strategy, a.paths[k], a.values[k]);
    }
    const oosFinal = runWindow(OOS_W, finalSettings);
    progress.done++;

    const merged = { ...(structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>), ...(finalSettings as unknown as Record<string, unknown>) };
    await prisma.botSettings.upsert({
      where: { key: 'main' },
      create: { key: 'main', json: JSON.stringify(merged) },
      update: { json: JSON.stringify(merged) },
    });

    const sysMetrics = (r: typeof oosBase.result | null) => r ? {
      trades: r.stats.totalTrades, winRate: fmt(r.stats.winRate), pf: fmt(r.stats.profitFactor),
      net: fmt(r.stats.netPnl), dd: fmt(r.stats.maxDrawdownPct),
    } : null;

    const report: TunerReport = {
      startedAt: progress.startedAt, finishedAt: Date.now(),
      train: { from: new Date(TRAIN_W.reportFrom).toISOString(), to: new Date(TRAIN_W.reportTo).toISOString() },
      oos: { from: new Date(OOS_W.reportFrom).toISOString(), to: new Date(OOS_W.reportTo).toISOString() },
      runs: progress.done,
      applied,
      results,
      systemBefore: sysMetrics(oosBase.ok ? oosBase.result : null),
      systemAfterOos: sysMetrics(oosFinal.ok ? oosFinal.result : null),
    };
    await prisma.botSettings.upsert({
      where: { key: 'tunerReport' },
      create: { key: 'tunerReport', json: JSON.stringify({ report }) },
      update: { json: JSON.stringify({ report }) },
    });
    progress.reportSaved = true;
    progress.log.push(`انتهى الضبط في ${Math.round((Date.now() - t0) / 1000)}s: ${applied.length} استراتيجية اعتُمدت خارج العينة من ${ids.length} — OOS النظام بعد الضبط: ${mLine(metricsOf(oosFinal.ok ? (oosFinal.result.trades as { strategy: string; pnl: number }[]) : [], undefined))}`);
    progress.stage = 'مكتمل';
  } catch (e) {
    progress.error = String(e instanceof Error ? e.message : e).slice(0, 400);
    progress.log.push(`فشل: ${progress.error}`);
    console.error(progress.error);
  } finally {
    progress.running = false;
    progress.finishedAt = Date.now();
    saveProgress();
    await prisma.$disconnect();
  }
}

main();
