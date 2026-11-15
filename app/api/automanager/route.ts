import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ============================================================
// المدير الآلي — قرارات تفعيل/تعطيل مبنية على أداء آخر باك تيست.
// نفس أسلوب النسخة المنشورة: لا حكم نهائي على عيّنة أصغر من 30 صفقة،
// فالأصغر يبقى مفعّلاً «تحت المراقبة» ويُعلَّل القرار بالأرقام.
// ============================================================

const KEY = 'automanager';
const MIN_SAMPLE = 30;

interface Trade {
  strategy: string; pnl: number; result: string;
}

interface StratMetrics { trades: number; winRate: number; pf: number; net: number; expectancy: number }

interface Decision {
  kind: 'note' | 'disable' | 'enable';
  strategy: string;
  reason: string;
  metrics: StratMetrics;
}

function metricsOf(trades: Trade[]): StratMetrics {
  const n = trades.length;
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const net = trades.reduce((a, t) => a + t.pnl, 0);
  return {
    trades: n,
    winRate: n ? +(100 * wins.length / n).toFixed(2) : 0,
    pf: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : grossWin > 0 ? 99 : 0,
    net: +net.toFixed(2),
    expectancy: n ? +(net / n).toFixed(2) : 0,
  };
}

async function loadLatestRun() {
  const run = await db.backtestRun.findFirst({ orderBy: { runAt: 'desc' } });
  if (!run) return null;
  const trades = JSON.parse(run.tradesJson) as Trade[];
  return { run, trades };
}

async function buildReport() {
  const latest = await loadLatestRun();
  if (!latest) return null;
  const { run, trades } = latest;

  const settingsRow = await db.botSettings.findUnique({ where: { key: 'main' } });
  const saved = settingsRow ? (JSON.parse(settingsRow.json) as Record<string, unknown>) : {};
  const sessions = (saved.sessions ?? {}) as Record<string, Record<string, boolean>>;

  const byStrategy = new Map<string, Trade[]>();
  for (const t of trades) {
    const list = byStrategy.get(t.strategy) ?? [];
    list.push(t);
    byStrategy.set(t.strategy, list);
  }

  const decisions: Decision[] = [];
  const finalEnabled: Record<string, boolean> = {};
  let enabled = 0;
  let disabled = 0;

  for (const [strategy, list] of [...byStrategy.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const m = metricsOf(list);
    const currentlyOn = Object.values(sessions[strategy] ?? {}).some(Boolean);
    let on = currentlyOn;

    if (m.trades < MIN_SAMPLE) {
      decisions.push({
        kind: 'note', strategy, metrics: m,
        reason: `عيّنة صغيرة (${m.trades} صفقة) — تبقى ${currentlyOn ? 'مفعّلة تحت المراقبة' : 'معطّلة'} حتى تكتمل ${MIN_SAMPLE} صفقة قبل أي حكم نهائي`,
      });
    } else if (m.pf < 1) {
      on = false;
      decisions.push({
        kind: 'disable', strategy, metrics: m,
        reason: `خاسرة على عيّنة كافية (${m.trades} صفقة · PF ${m.pf} · صافي ${m.net}$) — تُعطَّل آلياً حتى تتعافى`,
      });
    } else if (m.pf >= 1.15) {
      on = true;
      decisions.push({
        kind: 'enable', strategy, metrics: m,
        reason: `رابحة بثبات (${m.trades} صفقة · PF ${m.pf} · صافي ${m.net}$) — تبقى مفعّلة`,
      });
    } else {
      decisions.push({
        kind: 'note', strategy, metrics: m,
        reason: `أداء محايد (PF ${m.pf} على ${m.trades} صفقة) — لا تغيير`,
      });
    }

    finalEnabled[strategy] = on;
    if (on) enabled++; else disabled++;
  }

  const times = trades.map(t => (t as Trade & { entryT?: number }).entryT).filter((t): t is number => Number.isFinite(t));
  const report = {
    runAt: run.runAt.getTime(),
    mode: 'auto-decide',
    window: {
      from: times.length ? new Date(Math.min(...times)).toISOString() : run.runAt.toISOString(),
      to: times.length ? new Date(Math.max(...times)).toISOString() : run.runAt.toISOString(),
    },
    decisions,
    finalEnabled,
    summary: {
      enabled,
      disabled,
      sessionKills: 0,
      totalTrades: trades.length,
      netAll: +trades.reduce((a, t) => a + t.pnl, 0).toFixed(2),
    },
  };
  return report;
}

export async function GET() {
  const row = await db.botSettings.findUnique({ where: { key: KEY } });
  if (!row) return NextResponse.json({ exists: false, report: null, autoMode: false, updatedAt: null });
  const stored = JSON.parse(row.json) as { report: unknown; autoMode?: boolean };
  return NextResponse.json({
    exists: true,
    report: stored.report,
    autoMode: stored.autoMode ?? true,
    updatedAt: new Date(row.updatedAt).toISOString(),
  });
}

export async function POST() {
  const report = await buildReport();
  if (!report) {
    return NextResponse.json({ error: 'لا يوجد باك تيست محفوظ — شغّل الباك تيست أولاً ليبني المدير قراراته على أرقام حقيقية' }, { status: 409 });
  }
  const json = JSON.stringify({ report, autoMode: true });
  const row = await db.botSettings.upsert({ where: { key: KEY }, create: { key: KEY, json }, update: { json } });
  return NextResponse.json({ ok: true, report, updatedAt: new Date(row.updatedAt).toISOString() });
}
