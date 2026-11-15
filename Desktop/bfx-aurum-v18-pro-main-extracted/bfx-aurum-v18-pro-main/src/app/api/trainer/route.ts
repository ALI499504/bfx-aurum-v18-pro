import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { loadBotSettings } from '@/lib/server/backtestRunner';
import { SESSION_AR } from '@/lib/engine/types';
import { BLOCK_REASONS_AR } from '@/lib/engine/rules';

export const dynamic = 'force-dynamic';

/**
 * المدرب الذكي — تحليل حتمي (بلا ذكاء اصطناعي مولد = بلا هلوسة) للأداء الحقيقي:
 * - يقرأ آخر باك تيست حقيقي (شموع MT5) + إشارات وضع الظل من قاعدة البيانات
 * - يكتب تقريراً بالعربية + مقترحات قابلة للتطبيق بضغطة زر
 * - كاشف الانحراف: يقارن نسبة نجاح الحي (وضع الظل) بنسبة الباك تيست — تنبيه مبكر
 */
export async function GET() {
  try {
    const settings = await loadBotSettings();
    const row = await db.backtestRun.findFirst({ orderBy: { runAt: 'desc' } });
    if (!row) {
      return NextResponse.json({ ok: false, error: 'لا يوجد باك تيست محفوظ — شغّل الباك تيست أولاً من لوحة الباك تيست' }, { status: 404 });
    }
    const stats = JSON.parse(row.statsJson);
    const trades = JSON.parse(row.tradesJson) as {
      strategy: string; session: string; dir: string; pnl: number;
      entryT: number; exitT: number; result: string; score?: number; lot: number;
    }[];

    const fmt = (n: number) => Math.round(n * 100) / 100;
    const report: string[] = [];
    const proposals: { id: string; title: string; detail: string; apply?: { kind: 'session'; strategy: string; session: string } | { kind: 'rule'; key: string; value: number } }[] = [];

    // ---- 1) الصحة العامة ----
    const pf = stats.profitFactor as number;
    const dd = stats.maxDrawdownPct as number;
    const grade = pf >= 1.5 && dd <= 20 ? 'A — نظام ناضج' : pf >= 1.3 && dd <= 25 ? 'B — نظام جيد قابل للتحسين' : pf >= 1.1 ? 'C — على الحافة، يحتمي التحسين' : 'D — لا يصلح للتشغيل الحقيقي';
    report.push(`التقييم العام: ${grade} — PF ${fmt(pf)} | نسبة النجاح ${fmt(stats.winRate)}% | صافي ${fmt(stats.netPnl)}$ على ${stats.totalTrades} صفقة | أقصى تراجع ${fmt(dd)}%`);
    report.push(`بوابة الجودة التكيفية: متوسط درجة الصفقات المنفذة ${stats.avgScore ?? '—'} — الاستراتيجيات المثبتة خسارتها تُخنق تلقائياً (تعلم من الحاضر).`);
    if (stats.railHits) {
      const rh = stats.railHits as { maxTrades: number; dailyLoss: number; lotClamp: number; concurrent: number };
      report.push(`الحوكمة الصلبة عملت: سقف الصفقات اليومية ضغط ${rh.maxTrades} مرة، سقف خسارة اليوم ${rh.dailyLoss} مرة، سقف اللوت ${rh.lotClamp} مرة — حدود مكتوبة في الكود لا يمكن تجاوزها.`);
    }

    // ---- 2) اتجاه الأشهر الأخيرة ----
    const months = (stats.monthly ?? []) as { month: string; net: number }[];
    const last4 = months.slice(-4);
    if (last4.length) {
      const neg = last4.filter(m => m.net < 0).length;
      report.push(`آخر ${last4.length} أشهر: ${last4.map(m => `${m.month}: ${m.net >= 0 ? '+' : ''}${fmt(m.net)}$`).join(' | ')}${neg >= 3 ? ' — سلسلة سلبية: خفف الحجم حتى يتحسن النمط' : ''}`);
    }

    // ---- 3) أسوأ الاستراتيجيات + مقترحات ----
    const ranking = (stats.ranking ?? []) as { strategy: string; net: number; winRate: number; trades: number }[];
    const losers = ranking.filter(r => r.net < 0 && r.trades >= 10).slice(-3).reverse();
    for (const l of losers) {
      // أسوأ جلسة لهذه الاستراتيجية من المصفوفة
      const mx = (stats.matrix?.[l.strategy] ?? {}) as Record<string, { net: number; trades: number }>;
      const worstSess = Object.entries(mx).filter(([, v]) => v.trades > 0).sort((a, b) => a[1].net - b[1].net)[0];
      if (worstSess && worstSess[1].net < 0) {
        proposals.push({
          id: `disable-${l.strategy}-${worstSess[0]}`,
          title: `تعطيل استراتيجية ${l.strategy} في جلسة ${SESSION_AR[worstSess[0] as keyof typeof SESSION_AR] ?? worstSess[0]}`,
          detail: `${l.strategy} خسرت ${fmt(l.net)}$ على ${l.trades} صفقة (نجاح ${fmt(l.winRate)}%)، و(${SESSION_AR[worstSess[0] as keyof typeof SESSION_AR] ?? worstSess[0]}) هي أسوأ جلساتها بـ${fmt(worstSess[1].net)}$ من ${worstSess[1].trades} صفقة. بقاء بقية الجلسات كما هي.`,
          apply: { kind: 'session', strategy: l.strategy, session: worstSess[0] },
        });
      } else {
        proposals.push({
          id: `disable-${l.strategy}`,
          title: `مراجعة استراتيجية ${l.strategy}`,
          detail: `${l.strategy} خسرت ${fmt(l.net)}$ على ${l.trades} صفقة (نجاح ${fmt(l.winRate)}%) — راقبها هذا الأسبوع قبل أي تعديل.`,
        });
      }
    }

    // ---- 4) أفضل ما عندك (احمِه) ----
    const winners = ranking.filter(r => r.net > 0).slice(0, 2);
    for (const w of winners) {
      report.push(`قوة النظام: استراتيجية ${w.strategy} ربحت ${fmt(w.net)}$ من ${w.trades} صفقة — لا تغيّر إعداداتها.`);
    }

    // ---- 5) الجلسات ----
    const bySess: Record<string, { n: number; pnl: number }> = {};
    for (const t of trades) {
      bySess[t.session] ??= { n: 0, pnl: 0 };
      bySess[t.session].n++; bySess[t.session].pnl += t.pnl;
    }
    const sessLine = Object.entries(bySess).sort((a, b) => b[1].pnl - a[1].pnl)
      .map(([k, v]) => `${SESSION_AR[k as keyof typeof SESSION_AR] ?? k}: ${v.pnl >= 0 ? '+' : ''}${fmt(v.pnl)}$ (${v.n})`).join(' | ');
    if (sessLine) report.push(`الجلسات (من العينة المحفوظة): ${sessLine}`);

    // ---- 6) شفافية الحظر ----
    if (stats.blocked && typeof stats.blocked === 'object') {
      const top = Object.entries(stats.blocked as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([k, v]) => `${BLOCK_REASONS_AR[k] ?? k}: ${v}`).join(' | ');
      report.push(`أسباب الحظر الأكثر (شفافية كاملة): ${top}`);
    }

    // ---- 7) كاشف الانحراف: وضع الظل مقابل الباك تيست ----
    let shadow: Record<string, number> | null = null;
    try {
      const since = Date.now() - 30 * 86400e3;
      const recent = await db.liveSignal.findMany({ where: { createdAtMs: { gte: since } }, take: 500 });
      const closed = recent.filter(x => (x.outcome === 'tp' || x.outcome === 'sl' || x.outcome === 'time') && x.pnlPips !== null);
      if (closed.length >= 5) {
        const wr = closed.filter(x => (x.pnlPips ?? 0) > 0).length / closed.length * 100;
        const avgP = closed.reduce((a, x) => a + (x.pnlPips ?? 0), 0) / closed.length;
        const btWR = stats.winRate as number;
        const drift = wr - btWR;
        shadow = {
          tracked: recent.length, closed: closed.length,
          winRate: Math.round(wr * 10) / 10,
          avgPnlPips: Math.round(avgP * 10) / 10,
          backtestWinRate: Math.round(btWR * 10) / 10,
          driftPct: Math.round(drift * 10) / 10,
        };
        if (drift <= -15) {
          report.push(`⚠️ كاشف الانحراف: نجاح الحي (وضع الظل) ${Math.round(wr)}% مقابل ${Math.round(btWR)}% في الباك تيست — انحراف ${Math.round(drift)} نقطة. التوصية: نصف حجم الصفقات حتى يعود التطابق.`);
          proposals.push({
            id: 'reduce-risk',
            title: 'خفض نسبة المخاطرة إلى النصف (كاشف الانحراف)',
            detail: `أداء الحي انحرف ${Math.round(drift)} نقطة عن الباك تيست — خفض المخاطرة مؤقتاً إلى ${fmt((settings.globalRules.risk_sizing?.value ?? 1) / 2)}% حماية حتى يستقر التطابق.`,
            apply: { kind: 'rule', key: 'risk_sizing', value: Math.max(0.2, (settings.globalRules.risk_sizing?.value ?? 1) / 2) },
          });
        } else {
          report.push(`كاشف الانحراف: نجاح الحي ${Math.round(wr)}% مقابل ${Math.round(btWR)}% بالباك تيست — التطابق سليم (الفرق ${Math.round(drift)} نقطة ضمن الحدود الطبيعية).`);
        }
      } else {
        report.push('وضع الظل: لا توجد نتائج مغلقة كافية بعد (5+) — اترك البوت يراقب وسيظهر تقييم الحي هنا تلقائياً.');
      }
    } catch { /* تجاهل */ }

    // ---- 8) اقتراحات عامة من الأرقام ----
    if (pf >= 1.3 && dd <= 20) {
      proposals.push({
        id: 'scale-note',
        title: 'النظام جاهز للتفكير بالتوسع',
        detail: `PF ${fmt(pf)} وتراجع ${fmt(dd)}% — زيادة نسبة المخاطرة تدريجياً (0.25% كل شهر) خيار مؤسسي، بشرط بقاء التراجع تحت 20%.`,
      });
    }

    return NextResponse.json({
      ok: true,
      generatedAt: Date.now(),
      runAt: row.runAt,
      period: { startT: stats.startT, endT: stats.endT },
      health: {
        profitFactor: fmt(pf), winRate: fmt(stats.winRate), netPnl: fmt(stats.netPnl),
        totalTrades: stats.totalTrades, maxDDPct: fmt(dd), grade,
        oos: stats.oos, avgScore: stats.avgScore ?? null,
        sizing: stats.sizing ?? null, railHits: stats.railHits ?? null,
      },
      report,
      proposals,
      shadow,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'خطأ غير معروف' }, { status: 500 });
  }
}
