'use client';

// لوحة الاختبار التاريخي والتقارير — Backtest & Analytics Dashboard
import { useMemo, useState } from 'react';
import { useBot } from './store';
import { BLOCK_REASONS_AR } from '@/lib/engine/rules';
import { STRATEGY_NAMES, SESSION_AR } from '@/lib/engine/types';
import { StrategyId, Trade, SessionId } from '@/lib/engine/types';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle2, Download, Info, RefreshCw, ShieldOff } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const SESSIONS: SessionId[] = ['asia', 'london', 'londonNY', 'ny'];

function fmtTime(t: number): string {
  return new Intl.DateTimeFormat('ar-SY', {
    timeZone: 'Asia/Damascus', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(t));
}
function fmtWeek(t: number): string {
  return new Intl.DateTimeFormat('ar-SY', { timeZone: 'Asia/Damascus', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(t));
}

export function BacktestWindow() {
  const { stats, trades, running, runError, runBacktest, settings, runAt } = useBot();
  const [detail, setDetail] = useState<Trade | null>(null);
  const [tab, setTab] = useState<'log' | 'reports' | 'breakdown'>('log');
  const [filterStrategy, setFilterStrategy] = useState<string>('all');

  const filtered = useMemo(() => {
    const arr = filterStrategy === 'all' ? trades : trades.filter(t => t.strategy === filterStrategy);
    return [...arr].reverse();
  }, [trades, filterStrategy]);

  const exportCsv = () => {
    const rows = [['#', 'الاستراتيجية', 'الاتجاه', 'الجلسة', 'الدخول', 'الخروج', 'سعر الدخول', 'سعر الخروج', 'الوقف', 'الهدف', 'النتيجة', 'PnL$']];
    for (const t of trades) {
      rows.push([String(t.id), t.strategy, t.dir === 'buy' ? 'شراء' : 'بيع', SESSION_AR[t.session],
        fmtTime(t.entryT), fmtTime(t.exitT), t.entry.toFixed(2), t.exit.toFixed(2), t.sl.toFixed(2), t.tp.toFixed(2),
        t.result, t.pnl.toFixed(2)]);
    }
    const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'bfx-backtest-trades.csv';
    a.click();
  };

  return (
    <div className="space-y-4">
      {/* الترويسة وزر التحديث */}
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-[#d9b45c]">لوحة الاختبار التاريخي والتقارير</h2>
            <p className="text-[11px] text-[#8a94a6] mt-0.5">
              اختبار على شموع XAUUSD الحقيقية من طرفية MT5 على جهازك • سبريد ثابت {settings.globalRules.fixed_spread.value} سنت • لوت {settings.globalRules.fixed_lot.value} • أهداف لكل استراتيجية حرفياً من الدليل • النسب على رصيد ثابت {settings.globalRules.fixed_base.value}$
              {stats ? ` • الفترة: ${new Date(stats.startT).toISOString().slice(0, 10)} ← ${new Date(stats.endT).toISOString().slice(0, 10)}` : ''}
            </p>
            <p className="text-[10.5px] text-[#5a6474] mt-1">
              المزامنة مفعّلة: نتيجة الباك تيست المشتركة تظهر عند كل المستخدمين تلقائياً
              {runAt ? ` • آخر تشغيل: ${fmtTime(new Date(runAt).getTime())}` : ''}
            </p>
          </div>
          <button onClick={() => { if (!running) runBacktest(); }} disabled={running}
            className="flex items-center gap-2 rounded-lg bg-[#d9b45c] hover:bg-[#e5c26e] disabled:opacity-60 text-[#0a0e17] font-bold text-[12.5px] px-5 py-2.5">
            {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {running ? 'جارٍ إعادة الاختبار على البيانات الحقيقية...' : 'تحديث وإعادة الاختبار (Refresh)'}
          </button>
        </div>
        {runError && (
          <div className="mt-3 rounded-lg border border-[#f6465d]/40 bg-[#f6465d]/10 text-[#f6465d] text-[12px] px-3 py-2">{runError}</div>
        )}
      </div>

      {!stats && !running && (
        <div className="rounded-xl border border-[#1b2334] bg-[#101726] p-8 text-center text-[#8a94a6] text-[13px]">
          اضغط &quot;تحديث وإعادة الاختبار&quot; لتشغيل محرك الباك تيست على شموع XAUUSD الحقيقية من طرفيتك وعرض سجل الصفقات والتقارير.
          (يعمل فقط عند اتصال جسر MT5)
        </div>
      )}

      {running && (
        <div className="rounded-xl border border-[#d9b45c]/40 bg-[#d9b45c]/10 p-8 text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-[#d9b45c] mx-auto mb-3" />
          <div className="text-[13px] text-[#d9b45c] font-bold">جارٍ تشغيل الباك تيست كاملاً على الشموع الحقيقية من طرفيتك...</div>
          <div className="text-[11px] text-[#8a94a6] mt-1">تحليل الهيكل السوقي + كشف الاستراتيجيات A-O + محاكاة الصفقات على بيانات حقيقية — قد يستغرق نصف دقيقة</div>
        </div>
      )}

      {stats && !running && (
        <>
          {/* البطاقات الإحصائية */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <Stat label="صافي الربح/الخسارة" value={`${stats.netPnl >= 0 ? '+' : ''}${stats.netPnl.toFixed(2)}$`} cls={stats.netPnl >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'} />
            <Stat label="معدل النجاح" value={`${stats.winRate.toFixed(1)}%`} />
            <Stat label="الصفقات" value={`${stats.totalTrades}`} sub={`${stats.wins} رابحة / ${stats.losses} خاسرة`} />
            <Stat label="عامل الربح" value={stats.profitFactor.toFixed(2)} />
            <Stat label="أقصى تراجع" value={`${stats.maxDrawdown.toFixed(1)}$`} sub={`${stats.maxDrawdownPct.toFixed(1)}% من الرصيد`} />
            <Stat label="الرصيد النهائي" value={`${stats.finalBalance.toFixed(2)}$`} sub={`أساس ${stats.baseBalance}$`} />
            <Stat label="الإشارات المكتشفة" value={`${stats.signalsCount}`} sub={`حُجبت ${stats.fillsBlocked} محاولة تنفيذ بالقواعد`} />
          </div>

          {/* الحوكمة والشفافية — الحجم + درجة الجودة + الحوكمة الصلبة + أسباب الحظر */}
          <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px]">
              <span className="font-bold text-[#d9b45c]">الحوكمة والشفافية:</span>
              {stats.sizing && (
                <span className="text-[#8a94a6]">نمط الحجم: <b className="text-[#e9edf4]">{stats.sizing.mode === 'risk' ? `ديناميكي (مخاطرة ${stats.sizing.riskPct}% من الرصيد)` : 'لوت ثابت'}</b></span>
              )}
              {stats.avgScore != null && (
                <span className="text-[#8a94a6]">متوسط درجة الجودة: <b className="text-[#d9b45c] font-mono">{stats.avgScore}</b></span>
              )}
              {stats.railHits && (
                <span className="text-[#8a94a6]">الحوكمة الصلبة: سقف اليوم <b className="text-[#e9edf4] font-mono">{stats.railHits.dailyLoss}</b> مرة • سقف الصفقات <b className="text-[#e9edf4] font-mono">{stats.railHits.maxTrades}</b> • سقف اللوت <b className="text-[#e9edf4] font-mono">{stats.railHits.lotClamp}</b></span>
              )}
            </div>
            {stats.blocked && Object.keys(stats.blocked).length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {Object.entries(stats.blocked).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => (
                  <span key={k} className="text-[10px] px-2 py-1 rounded-md border border-[#2a3550] bg-[#101726] text-[#8a94a6]">
                    {BLOCK_REASONS_AR[k] ?? k}: <b className="text-[#e9edf4] font-mono">{v}</b>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* بوابة النشر + مؤشر الصفقات اليومية */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className={cn('rounded-xl border p-4', !stats.oos.gateEnabled ? 'border-[#2a3550] bg-[#101726]' : stats.oos.gatePass ? 'border-[#2ebd85]/40 bg-[#2ebd85]/5' : 'border-[#e8a33d]/40 bg-[#e8a33d]/5')}>
              <div className="flex items-center gap-2 mb-2">
                {!stats.oos.gateEnabled ? <ShieldOff className="w-4 h-4 text-[#8a94a6]" /> : stats.oos.gatePass ? <CheckCircle2 className="w-4 h-4 text-[#2ebd85]" /> : <AlertTriangle className="w-4 h-4 text-[#e8a33d]" />}
                <span className="text-[13px] font-bold">بوابة النشر — العينة الخارجية (آخر 30% من الفترة)</span>
                {!stats.oos.gateEnabled && <span className="text-[10px] text-[#8a94a6] border border-[#2a3550] rounded px-1.5 py-0.5">معطلة من إعداداتك</span>}
              </div>
              <div className="grid grid-cols-3 gap-2 text-[12px]">
                <GateCell label={`نجاح ≥ ${stats.oos.threshold}%`} value={`${stats.oos.winRate.toFixed(1)}%`} ok={stats.oos.winRate >= stats.oos.threshold} />
                <GateCell label={`صفقات ≥ ${stats.oos.minTrades}`} value={`${stats.oos.trades}`} ok={stats.oos.trades >= stats.oos.minTrades} />
                <GateCell label="متوسط R موجب" value={stats.oos.avgR.toFixed(2)} ok={stats.oos.avgR > 0} />
              </div>
              <div className="mt-2 text-[11px] text-[#8a94a6]">
                {!stats.oos.gateEnabled
                  ? 'بوابة النشر معطلة في القواعد العليا — الأرقام أعلاه للعرض والدراسة فقط بلا حكم نشر.'
                  : stats.oos.gatePass ? 'النتيجة: مطابق — يمكن النشر للتداول الحقيقي (القواعد تُجمَّد قبل الاختبار)' : 'النتيجة: غير مطابق — لا يُعتمد أي إعداد للتداول الحقيقي (القواعد تُجمَّد قبل الاختبار)'}
              </div>
            </div>
            <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Info className="w-4 h-4 text-[#d9b45c]" />
                <span className="text-[13px] font-bold">مؤشر الصفقات اليومية المتوقعة</span>
              </div>
              <div className="text-[12px] text-[#e9edf4]">
                {stats.dailyKpi.daysWith2Plus} من {stats.dailyKpi.daysTraded} يوم تداول بلغت صفقتين أو أكثر
                <span className="font-mono font-bold text-[#d9b45c]"> = {stats.dailyKpi.pct.toFixed(1)}%</span>
              </div>
              <div className="text-[11px] text-[#8a94a6] mt-1">
                (مؤشر فقط لا يُفرض في التنفيذ — مستثنى أيام التوقف بقاعدة الإيقاف: {stats.dailyKpi.excludedStopDays} يوم)
              </div>
            </div>
          </div>

          {/* التبويبات */}
          <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] overflow-hidden">
            <div className="flex border-b border-[#1b2334]">
              {([
                ['log', `سجل الصفقات (${stats.totalTrades})`],
                ['reports', 'التقارير الدورية'],
                ['breakdown', 'تفكيك الاستراتيجيات × الجلسات'],
              ] as const).map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)}
                  className={cn('px-4 py-2.5 text-[12.5px] font-semibold border-b-2 transition-colors',
                    tab === id ? 'border-[#d9b45c] text-[#d9b45c] bg-[#d9b45c]/5' : 'border-transparent text-[#8a94a6] hover:text-[#e9edf4]')}>
                  {label}
                </button>
              ))}
            </div>

            {/* سجل الصفقات */}
            {tab === 'log' && (
              <div>
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[#141a29]">
                  <select value={filterStrategy} onChange={e => setFilterStrategy(e.target.value)}
                    className="bg-[#101726] border border-[#2a3550] rounded-md text-[12px] px-2 py-1.5 text-[#e9edf4]">
                    <option value="all">كل الاستراتيجيات</option>
                    {(Object.keys(STRATEGY_NAMES) as StrategyId[]).map(s => <option key={s} value={s}>{s} — {STRATEGY_NAMES[s]}</option>)}
                  </select>
                  <button onClick={exportCsv} className="flex items-center gap-1.5 text-[11.5px] px-3 py-1.5 rounded-md border border-[#2a3550] text-[#8a94a6] hover:text-[#d9b45c] hover:border-[#d9b45c]/50 mr-auto">
                    <Download className="w-3.5 h-3.5" /> تصدير CSV
                  </button>
                </div>
                <div className="max-h-[480px] overflow-y-auto">
                  <table className="w-full text-[11.5px]">
                    <thead className="sticky top-0 bg-[#101726] text-[#8a94a6]">
                      <tr>
                        <th className="text-right px-3 py-2 font-semibold">#</th>
                        <th className="text-right px-2 py-2 font-semibold">الاستراتيجية</th>
                        <th className="text-center px-2 py-2 font-semibold">النوع</th>
                        <th className="text-center px-2 py-2 font-semibold">الجلسة</th>
                        <th className="text-center px-2 py-2 font-semibold">الدخول</th>
                        <th className="text-center px-2 py-2 font-semibold">الخروج</th>
                        <th className="text-center px-2 py-2 font-semibold">النتيجة</th>
                        <th className="text-center px-2 py-2 font-semibold">P/L ($)</th>
                        <th className="text-center px-2 py-2 font-semibold">تفاصيل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, 500).map(t => (
                        <tr key={t.id} className="border-t border-[#141a29] hover:bg-[#101726]/70">
                          <td className="px-3 py-1.5 text-[#5a6474] font-mono">{t.id}</td>
                          <td className="px-2 py-1.5">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-5 h-5 rounded bg-[#d9b45c]/15 text-[#d9b45c] font-black text-[10px] flex items-center justify-center">{t.strategy}</span>
                              <span className="text-[#e9edf4]">{STRATEGY_NAMES[t.strategy]}</span>
                            </span>
                          </td>
                          <td className={cn('text-center px-2 py-1.5 font-bold', t.dir === 'buy' ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{t.dir === 'buy' ? 'شراء' : 'بيع'}</td>
                          <td className="text-center px-2 py-1.5 text-[#8a94a6]">{SESSION_AR[t.session]}</td>
                          <td className="text-center px-2 py-1.5 font-mono text-[10.5px] text-[#8a94a6]" dir="ltr">{fmtTime(t.entryT)}</td>
                          <td className="text-center px-2 py-1.5 font-mono text-[10.5px] text-[#8a94a6]" dir="ltr">{fmtTime(t.exitT)}</td>
                          <td className="text-center px-2 py-1.5">
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded border',
                              t.result === 'tp' ? 'border-[#2ebd85]/40 text-[#2ebd85] bg-[#2ebd85]/10'
                                : t.result === 'sl' ? 'border-[#f6465d]/40 text-[#f6465d] bg-[#f6465d]/10'
                                  : 'border-[#e8a33d]/40 text-[#e8a33d] bg-[#e8a33d]/10')}>
                              {t.result === 'tp' ? 'هدف' : t.result === 'sl' ? 'وقف' : t.result === 'news' ? 'خبر' : t.result === 'dayend' ? 'نهاية يوم' : 'زمن'}
                            </span>
                          </td>
                          <td className={cn('text-center px-2 py-1.5 font-mono font-bold', t.pnl >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}</td>
                          <td className="text-center px-2 py-1.5">
                            <button onClick={() => setDetail(t)} className="text-[10.5px] px-2 py-1 rounded border border-[#2a3550] text-[#8a94a6] hover:text-[#d9b45c] hover:border-[#d9b45c]/50">🔍</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filtered.length > 500 && <div className="px-3 py-2 text-[11px] text-[#8a94a6] border-t border-[#141a29]">يُعرض أول 500 صفقة من {filtered.length} — صدّر CSV للقائمة الكاملة</div>}
              </div>
            )}

            {/* التقارير الدورية */}
            {tab === 'reports' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
                <div className="p-3 lg:border-l border-[#1b2334]">
                  <div className="text-[12.5px] font-bold text-[#d9b45c] mb-2">التقرير الأسبوعي التراكمي (٪ من 1000$ ثابتة)</div>
                  <div className="max-h-[420px] overflow-y-auto">
                    <table className="w-full text-[11.5px]">
                      <thead className="sticky top-0 bg-[#101726] text-[#8a94a6]"><tr>
                        <th className="text-right px-2 py-1.5">الأسبوع</th>
                        <th className="text-center px-2 py-1.5">الصافي ($)</th>
                        <th className="text-center px-2 py-1.5">النسبة (×100)</th>
                      </tr></thead>
                      <tbody>
                        {stats.weekly.map(w => (
                          <tr key={w.weekStart} className="border-t border-[#141a29]">
                            <td className="px-2 py-1.5 text-[#8a94a6]" dir="ltr">{fmtWeek(w.weekStart)}</td>
                            <td className={cn('text-center px-2 py-1.5 font-mono', w.net >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{w.net >= 0 ? '+' : ''}{w.net.toFixed(2)}</td>
                            <td className={cn('text-center px-2 py-1.5 font-mono font-bold', w.pct >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{w.pct >= 0 ? '+' : ''}{w.pct.toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="p-3 border-t lg:border-t-0 border-[#1b2334]">
                  <div className="text-[12.5px] font-bold text-[#d9b45c] mb-2">التقرير الشهري التراكمي (٪ من 1000$ ثابتة)</div>
                  <div className="max-h-[420px] overflow-y-auto">
                    <table className="w-full text-[11.5px]">
                      <thead className="sticky top-0 bg-[#101726] text-[#8a94a6]"><tr>
                        <th className="text-right px-2 py-1.5">الشهر</th>
                        <th className="text-center px-2 py-1.5">الصافي ($)</th>
                        <th className="text-center px-2 py-1.5">النسبة (×100)</th>
                      </tr></thead>
                      <tbody>
                        {stats.monthly.map(m => (
                          <tr key={m.month} className="border-t border-[#141a29]">
                            <td className="px-2 py-1.5 text-[#8a94a6]" dir="ltr">{m.month}</td>
                            <td className={cn('text-center px-2 py-1.5 font-mono', m.net >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{m.net >= 0 ? '+' : ''}{m.net.toFixed(2)}</td>
                            <td className={cn('text-center px-2 py-1.5 font-mono font-bold', m.pct >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{m.pct >= 0 ? '+' : ''}{m.pct.toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* تفكيك الاستراتيجيات */}
            {tab === 'breakdown' && (
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-[#101726] text-[#8a94a6]">
                      <tr>
                        <th className="text-right px-3 py-2 font-semibold sticky right-0 bg-[#101726]">الاستراتيجية</th>
                        {SESSIONS.map(s => <th key={s} className="text-center px-2 py-2 font-semibold" colSpan={2}>{SESSION_AR[s]}</th>)}
                        <th className="text-center px-2 py-2 font-semibold">الإجمالي</th>
                        <th className="text-center px-2 py-2 font-semibold">أسبوعي% متوسط</th>
                        <th className="text-center px-2 py-2 font-semibold">شهري% متوسط</th>
                        <th className="text-center px-2 py-2 font-semibold">أفضل جلسة</th>
                        <th className="text-center px-2 py-2 font-semibold">أضعف جلسة</th>
                      </tr>
                      <tr className="text-[9.5px]">
                        <th className="text-right px-3 py-1 sticky right-0 bg-[#101726]"></th>
                        {SESSIONS.map(s => <><th key={s + 'n'} className="px-1">صافي$ (ن%)</th><th key={s + 'w'} className="px-1">ر/خ</th></>)}
                        <th className="px-1">صافي$ (ن%)</th>
                        <th colSpan={4}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(STRATEGY_NAMES) as StrategyId[]).map(st => {
                        const tot = stats.strategyTotals[st];
                        return (
                          <tr key={st} className="border-t border-[#141a29]">
                            <td className="px-3 py-1.5 sticky right-0 bg-[#0d1220]">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="w-5 h-5 rounded bg-[#d9b45c]/15 text-[#d9b45c] font-black text-[10px] flex items-center justify-center">{st}</span>
                                <span className="text-[#e9edf4] text-[10.5px]">{STRATEGY_NAMES[st]}</span>
                              </span>
                            </td>
                            {SESSIONS.map(s => {
                              const m = stats.matrix[st]?.[s];
                              return (
                                <>

                                  <td key={s + 'n2'} className="text-center px-1 py-1.5 font-mono">
                                    {m && m.trades ? (
                                      <span className={cn(m.net >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{m.net.toFixed(0)} <span className="text-[9px] text-[#8a94a6]">({m.winRate.toFixed(0)}%)</span></span>
                                    ) : <span className="text-[#2a3550]">—</span>}
                                  </td>
                                  <td key={s + 'w2'} className="text-center px-1 py-1.5 text-[#8a94a6] text-[10px]">{m && m.trades ? `${m.wins}/${m.losses}` : '—'}</td>
                                </>
                              );
                            })}
                            <td className={cn('text-center px-2 py-1.5 font-mono font-bold', tot.net >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>
                              {tot.net.toFixed(0)} <span className="text-[9px] text-[#8a94a6]">({tot.winRate.toFixed(0)}%)</span>
                            </td>
                            <td className="text-center px-2 py-1.5 font-mono text-[#8a94a6]">{tot.trades ? `${tot.weeklyAvgPct.toFixed(2)}%` : '—'}</td>
                            <td className="text-center px-2 py-1.5 font-mono text-[#8a94a6]">{tot.trades ? `${tot.monthlyAvgPct.toFixed(2)}%` : '—'}</td>
                            <td className="text-center px-2 py-1.5 text-[10.5px] text-[#2ebd85]">{tot.bestSession ?? '—'}</td>
                            <td className="text-center px-2 py-1.5 text-[10.5px] text-[#f6465d]">{tot.worstSession ?? '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="p-3 border-t border-[#1b2334]">
                  <div className="text-[12.5px] font-bold text-[#d9b45c] mb-2">ترتيب الاستراتيجيات من الأنجح إلى الأقل نجاحاً</div>
                  <div className="flex flex-wrap gap-2">
                    {stats.ranking.map((r, i) => (
                      <div key={r.strategy} className="flex items-center gap-2 rounded-lg border border-[#2a3550] bg-[#101726] px-3 py-1.5">
                        <span className="text-[10px] font-bold text-[#8a94a6]">#{i + 1}</span>
                        <span className="w-5 h-5 rounded bg-[#d9b45c]/15 text-[#d9b45c] font-black text-[10px] flex items-center justify-center">{r.strategy}</span>
                        <span className={cn('font-mono font-bold text-[12px]', r.net >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{r.net >= 0 ? '+' : ''}{r.net.toFixed(2)}$</span>
                        <span className="text-[10px] text-[#8a94a6]">ن{r.winRate.toFixed(0)}% • {r.trades} صفقة</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* نافذة تفاصيل الصفقة */}
      <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <DialogContent className="bg-[#0d1220] border-[#2a3550] text-[#e9edf4] max-w-lg" dir="rtl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="text-[#d9b45c] text-[15px]">
                  تفاصيل الصفقة #{detail.id} — {detail.strategy} ({STRATEGY_NAMES[detail.strategy]})
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2.5 text-[12.5px] mt-1">
                <div className="grid grid-cols-2 gap-2">
                  <D k="وقت الدخول (بالدقيقة)" v={fmtTime(detail.entryT)} />
                  <D k="وقت الخروج (بالدقيقة)" v={fmtTime(detail.exitT)} />
                  <D k="النوع" v={detail.dir === 'buy' ? 'شراء' : 'بيع'} cls={detail.dir === 'buy' ? 'text-[#2ebd85]' : 'text-[#f6465d]'} />
                  <D k="الجلسة" v={SESSION_AR[detail.session]} />
                  <D k="سعر الدخول" v={detail.entry.toFixed(2)} />
                  <D k="سعر الخروج" v={detail.exit.toFixed(2)} />
                  <D k="وقف الخسارة" v={`${detail.sl.toFixed(2)} (${detail.slPips} بيب)`} />
                  <D k="الهدف" v={`${detail.tp.toFixed(2)} (${detail.tpPips} بيب)`} />
                  <D k="حجم اللوت" v={`${detail.lot}`} />
                  <D k="النتيجة" v={detail.result === 'tp' ? 'تحقق الهدف' : detail.result === 'sl' ? 'ضرب الوقف' : detail.result === 'news' ? 'إغلاق قبل خبر' : detail.result === 'dayend' ? 'إغلاق نهاية اليوم' : 'إغلاق زمني'} />
                </div>
                <div className={cn('rounded-lg px-3 py-2 font-mono font-bold text-[14px] text-center border',
                  detail.pnl >= 0 ? 'border-[#2ebd85]/40 bg-[#2ebd85]/10 text-[#2ebd85]' : 'border-[#f6465d]/40 bg-[#f6465d]/10 text-[#f6465d]')}>
                  {detail.pnl >= 0 ? '+' : ''}{detail.pnl.toFixed(2)}$ (شاملة اقتطاع السبريد {settings.globalRules.fixed_spread.value} سنت)
                </div>
                <div className="rounded-lg border border-[#2a3550] bg-[#101726] p-3">
                  <div className="text-[11px] font-bold text-[#d9b45c] mb-1">مسبب الدخول الفني (Trigger Reason)</div>
                  <div className="text-[11.5px] text-[#c9d1e0] leading-relaxed">{detail.reason}</div>
                  <div className="text-[10.5px] text-[#8a94a6] mt-1.5">المؤشرات: توافق الهيكل السوقي على الفريمات{settings.indicators.ema ? ` + فلتر EMA (${stats?.emaState === 'up' ? 'صاعد' : stats?.emaState === 'down' ? 'هابط' : 'عرضي'})` : ' (EMA معطل)'}{settings.indicators.sessionTiming ? ' + مؤشر الجلسات' : ''}</div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-3">
      <div className="text-[10.5px] text-[#8a94a6]">{label}</div>
      <div className={cn('text-[17px] font-mono font-bold mt-0.5', cls ?? 'text-[#e9edf4]')}>{value}</div>
      {sub && <div className="text-[9.5px] text-[#5a6474] mt-0.5">{sub}</div>}
    </div>
  );
}

function GateCell({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className={cn('rounded-lg border px-2 py-2 text-center', ok ? 'border-[#2ebd85]/40 bg-[#2ebd85]/10' : 'border-[#f6465d]/40 bg-[#f6465d]/10')}>
      <div className={cn('font-mono font-bold text-[14px]', ok ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{value}</div>
      <div className="text-[9.5px] text-[#8a94a6] mt-0.5">{label}</div>
    </div>
  );
}

function D({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-[#101726] border border-[#1b2334] px-3 py-1.5">
      <span className="text-[#8a94a6] text-[11px]">{k}</span>
      <span className={cn('font-mono font-bold text-[11.5px]', cls ?? 'text-[#e9edf4]')}>{v}</span>
    </div>
  );
}
