// ============================================================
// استكمال مرحلة التطبيق النهائي للضابط (فشلت بسبب فقد .env أثناء التشغيل)
// يعيد: بناء الإعدادات النهائية + تشغيل قبل/بعد على نافذة التحقق الخارجي
//       + حفظ main و tunerReport في قاعدة البيانات
// القرارات مستخرجة حرفياً من سجل تقدم الضابط (تشغيل 2026-11-15)
// التشغيل: bun scripts/apply-tuner-results.ts
// ============================================================
import { withBacktestEngine, type BacktestWindow } from '../src/lib/server/backtestCache';
import { runBacktest } from '../src/lib/engine/backtest';
import { DEFAULT_SETTINGS, buildScenarioSessions, defaultLadders, Settings } from '../src/lib/engine/rules';
import { STRATEGY_NAMES } from '../src/lib/engine/types';
import type { TamsaParams } from '../src/lib/engine/tamsa-params';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DAY = 86400e3;
const now = Date.now();

// نافذة التحقق الخارجي — مطابقة لتعريف tuner-run.ts
const OOS_W: BacktestWindow = {
  fromT: Date.UTC(2026, 5, 1) - 180 * DAY,
  toT: now,
  reportFrom: Date.UTC(2026, 5, 1),
  reportTo: now,
  permanent: false,
};

function factorySettings(): Settings {
  const s = structuredClone(DEFAULT_SETTINGS) as Settings;
  s.scenarioSessions = buildScenarioSessions();
  return s;
}

function setParam(params: TamsaParams, st: string, path: string, value: number) {
  const parts = path.split('.');
  let cur = params[st] as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function runWindow(w: BacktestWindow, settings: Settings) {
  return withBacktestEngine(w, data => runBacktest(data, settings, Date.now(), [], { fromT: w.reportFrom, toT: w.reportTo }));
}

// ---------- القرارات المعتمدة من سجل تقدم الضابط ----------
const APPLIED: { strategy: string; paths: string[]; values: number[] }[] = [
  { strategy: 'A', paths: ['slPips', 'tpPips'], values: [100, 120] },
  { strategy: 'E', paths: ['slPips', 'tpPips'], values: [50, 200] },
  { strategy: 'F', paths: ['exec.slPips', 'exec.tpPips'], values: [60, 120] },
  { strategy: 'H', paths: ['slPips', 'tpPips'], values: [90, 200] },
  { strategy: 'L', paths: ['exec.revSlPips', 'exec.revTpPips'], values: [30, 120] },
  { strategy: 'M', paths: ['exec.revSlPips', 'exec.revTpPips'], values: [50, 200] },
  { strategy: 'N', paths: ['exec.revSlPips', 'exec.revTpPips'], values: [80, 200] },
];

const fmt = (n: number) => Math.round(n * 100) / 100;
const sysMetrics = (r: { stats: { totalTrades: number; winRate: number; profitFactor: number; netPnl: number; maxDrawdownPct: number } } | null) => r ? {
  trades: r.stats.totalTrades, winRate: fmt(r.stats.winRate), pf: fmt(r.stats.profitFactor),
  net: fmt(r.stats.netPnl), dd: fmt(r.stats.maxDrawdownPct),
} : null;

async function main() {
  console.log('=== قبل: خط أساس المصنع على التحقق الخارجي (2026-06-01 → اليوم) ===');
  const before = runWindow(OOS_W, factorySettings());
  if (!before.ok) { console.error('✗ فشل الباك تيست:', before.reason); process.exit(1); }
  const mBefore = sysMetrics(before.result);
  console.log(`  صفقات: ${mBefore!.trades} | نجاح: ${mBefore!.winRate}% | PF: ${mBefore!.pf} | صافي: ${mBefore!.net}$ | أقصى تراجع: ${mBefore!.dd}%`);

  // ---------- الإعدادات النهائية — مطابقة لمنطق tuner-run.ts ----------
  const row = await prisma.botSettings.findUnique({ where: { key: 'main' } });
  const saved = row ? JSON.parse(row.json) as Record<string, unknown> : {};
  console.log(`\nالإعدادات المخزنة محلياً: ${Object.keys(saved).length ? 'موجودة' : 'لا شيء (مصنع نقي)'}`);
  const finalSettings = { ...(structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>), ...saved } as unknown as Settings;
  finalSettings.scenarioSessions = buildScenarioSessions();
  finalSettings.priorityLadder = defaultLadders();
  for (const st of Object.keys(finalSettings.strategyParams as unknown as Record<string, unknown>)) {
    (finalSettings.strategyParams as unknown as Record<string, { enabled?: boolean }>)[st].enabled = true;
  }
  for (const a of APPLIED) {
    for (let k = 0; k < a.paths.length; k++) setParam(finalSettings.strategyParams, a.strategy, a.paths[k], a.values[k]);
  }

  console.log('\n=== بعد: النظام الكامل بمعاملات الضبط المعتمدة على نفس النافذة ===');
  const after = runWindow(OOS_W, finalSettings);
  if (!after.ok) { console.error('✗ فشل الباك تيست:', after.reason); process.exit(1); }
  const mAfter = sysMetrics(after.result);
  console.log(`  صفقات: ${mAfter!.trades} | نجاح: ${mAfter!.winRate}% | PF: ${mAfter!.pf} | صافي: ${mAfter!.net}$ | أقصى تراجع: ${mAfter!.dd}%`);

  console.log('\n=== جدول قبل/بعد (التحقق الخارجي) ===');
  console.log(`  الصافي: ${mBefore!.net}$ ← ${mAfter!.net}$ (${mAfter!.net - mBefore!.net >= 0 ? '+' : ''}${fmt(mAfter!.net - mBefore!.net)}$)`);
  console.log(`  PF: ${mBefore!.pf} ← ${mAfter!.pf}`);
  console.log(`  النجاح: ${mBefore!.winRate}% ← ${mAfter!.winRate}%`);
  console.log(`  أقصى تراجع: ${mBefore!.dd}% ← ${mAfter!.dd}%`);

  // ---------- الحفظ ----------
  const merged = { ...(structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>), ...(finalSettings as unknown as Record<string, unknown>) };
  await prisma.botSettings.upsert({ where: { key: 'main' }, create: { key: 'main', json: JSON.stringify(merged) }, update: { json: JSON.stringify(merged) } });

  const report = {
    startedAt: now, finishedAt: Date.now(),
    train: { from: '2025-06-01T00:00:00.000Z', to: '2026-05-31T23:59:59.000Z' },
    oos: { from: '2026-06-01T00:00:00.000Z', to: new Date(now).toISOString() },
    runs: 252,
    applied: APPLIED,
    restoredFromLog: true,
    restoredNote: 'أُكملت مرحلة التطبيق والتحقق من سجل تقدم الضابط بعد فقد .env أثناء التشغيل الأصلي — كل القرارات حرفية من السجل',
    decisions: {
      tuned: ['A', 'E', 'F', 'H', 'L', 'M', 'N'],
      keptDefault: ['K'],
      rejectedOos: ['I'],
      noTradesTrain: ['B', 'C', 'D', 'G', 'J', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'],
    },
    oosTunedLog: {
      A: { trades: 5, winRate: 80, pf: 4.54, net: 36.5, params: 'slPips=100 · tpPips=120' },
      E: { trades: 254, winRate: 57, pf: 1.85, net: 1319.92, params: 'slPips=50 · tpPips=200' },
      F: { trades: 53, winRate: 47, pf: 1.0, net: 1.08, params: 'exec.slPips=60 · exec.tpPips=120' },
      H: { trades: 35, winRate: 49, pf: 1.51, net: 113.5, params: 'slPips=90 · tpPips=200' },
      I_rejected: { trades: 144, winRate: 19, pf: 0.63, net: -207.19 },
      L: { trades: 7, winRate: 71, pf: 2.85, net: 39.9, params: 'exec.revSlPips=30 · exec.revTpPips=120' },
      M: { trades: 5, winRate: 60, pf: 3.07, net: 36.5, params: 'exec.revSlPips=50 · exec.revTpPips=200' },
      N: { trades: 19, winRate: 37, pf: 1.21, net: 23.3, params: 'exec.revSlPips=80 · exec.revTpPips=200' },
    },
    systemBefore: mBefore,
    systemAfterOos: mAfter,
  };
  await prisma.botSettings.upsert({ where: { key: 'tunerReport' }, create: { key: 'tunerReport', json: JSON.stringify({ report }) }, update: { json: JSON.stringify({ report }) } });
  console.log('\n✓ حُفظت الإعدادات النهائية في BotSettings[main] والتقرير في BotSettings[tunerReport]');

  // ملف جانبي للتقرير — يبقى حتى لو فُقدت قاعدة البيانات
  const fs = await import('fs');
  fs.writeFileSync('/home/z/my-project/download/tuner-report.json', JSON.stringify({ report }, null, 2));
  console.log('✓ نسخة التقرير في download/tuner-report.json');
}

main().finally(() => prisma.$disconnect());
