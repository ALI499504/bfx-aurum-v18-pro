'use client';

// نافذة المدرب الذكي — تقرير أسبوعي حتمي من الأداء الحقيقي + مقترحات قابلة للتطبيق
// التحليل رقمي صرف من آخر باك تيست حقيقي + إشارات وضع الظل (بلا أي توليد نصي = بلا هلوسة)
import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, RefreshCw, CheckCircle2, AlertTriangle, Lightbulb, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBot } from './store';

interface TrainerPayload {
  ok: boolean;
  error?: string;
  generatedAt: number;
  runAt: string;
  period: { startT: number; endT: number };
  health: {
    profitFactor: number; winRate: number; netPnl: number; totalTrades: number;
    maxDDPct: number; grade: string;
    oos?: { winRate: number; gatePass: boolean; gateEnabled?: boolean; avgR: number };
    avgScore?: number | null;
    sizing?: { mode: string; riskPct: number } | null;
    railHits?: { maxTrades: number; dailyLoss: number; lotClamp: number; concurrent: number } | null;
  };
  report: string[];
  proposals: {
    id: string; title: string; detail: string;
    apply?: { kind: 'session'; strategy: string; session: string } | { kind: 'rule'; key: string; value: number };
  }[];
  shadow?: {
    tracked: number; closed: number; winRate: number; avgPnlPips: number;
    backtestWinRate: number; driftPct: number;
  } | null;
}

function gradeColor(grade: string) {
  if (grade.startsWith('A')) return 'text-[#2ebd85] border-[#2ebd85]/40 bg-[#2ebd85]/10';
  if (grade.startsWith('B')) return 'text-[#d9b45c] border-[#d9b45c]/40 bg-[#d9b45c]/10';
  if (grade.startsWith('C')) return 'text-[#e8a33d] border-[#e8a33d]/40 bg-[#e8a33d]/10';
  return 'text-[#f6465d] border-[#f6465d]/40 bg-[#f6465d]/10';
}

export function TrainerWindow() {
  const { patchSettings, runBacktest, running } = useBot();
  const [data, setData] = useState<TrainerPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/trainer', { cache: 'no-store' });
      const j = await r.json();
      if (r.ok && j.ok) { setData(j as TrainerPayload); setErr(null); }
      else setErr(j.error ?? 'تعذر توليد التقرير');
    } catch {
      setErr('فشل الاتصال بخادم المدرب');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const apply = (p: TrainerPayload['proposals'][number]) => {
    if (!p.apply) return;
    patchSettings(d => {
      if (p.apply!.kind === 'session') {
        const st = p.apply!.strategy as keyof typeof d.sessions;
        const ss = p.apply!.session as keyof (typeof d.sessions)[keyof typeof d.sessions];
        if (d.sessions[st]) d.sessions[st][ss] = false;
      } else {
        const key = p.apply!.key;
        d.globalRules[key] = { ...d.globalRules[key], enabled: true, value: p.apply!.value };
      }
    });
    setApplied(prev => new Set(prev).add(p.id));
    setTimeout(() => { if (!running) runBacktest(); }, 900);
  };

  const h = data?.health;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-[#d9b45c] flex items-center gap-2">
              <GraduationCap className="w-4.5 h-4.5" />
              المدرب الذكي — تقرير الأداء والمقترحات
            </h2>
            <p className="text-[11.5px] text-[#8a94a6] leading-relaxed mt-1">
              تحليل رقمي صرف (بلا أي توليد نصي) من آخر باك تيست حقيقي على شموع MT5 + نتائج وضع الظل الحية.
              كل اقتراح مبنى على أرقام صفقات فعلية — والتطبيق يتم بضغطة زر ثم إعادة اختبار تلقائية.
            </p>
          </div>
          <button onClick={load} disabled={loading}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-[#2a3550] bg-[#101726] hover:border-[#d9b45c]/50 text-[#e9edf4] text-[11px] font-bold px-3 py-2">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            تحديث
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-[#f6465d]/35 bg-[#f6465d]/8 p-4 text-[12px] text-[#f6465d] font-bold">{err}</div>
      )}

      {h && (
        <>
          {/* بطاقة التقييم */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
            <div className={cn('rounded-xl border p-3.5 col-span-2 lg:col-span-2', gradeColor(h.grade))}>
              <div className="text-[9.5px] font-bold opacity-80">التقييم العام للنظام</div>
              <div className="text-[16px] font-black mt-1">{h.grade}</div>
            </div>
            {[
              { l: 'Profit Factor', v: h.profitFactor.toFixed(2), c: h.profitFactor >= 1.3 ? 'text-[#2ebd85]' : h.profitFactor >= 1.1 ? 'text-[#d9b45c]' : 'text-[#f6465d]' },
              { l: 'نسبة النجاح', v: `${h.winRate.toFixed(1)}%`, c: 'text-[#e9edf4]' },
              { l: 'صافي الربح', v: `${h.netPnl >= 0 ? '+' : ''}${h.netPnl.toFixed(0)}$`, c: h.netPnl >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]' },
              { l: 'أقصى تراجع', v: `${h.maxDDPct.toFixed(1)}%`, c: h.maxDDPct <= 20 ? 'text-[#2ebd85]' : h.maxDDPct <= 30 ? 'text-[#d9b45c]' : 'text-[#f6465d]' },
            ].map(x => (
              <div key={x.l} className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-3.5">
                <div className="text-[9.5px] text-[#5a6474] font-bold">{x.l}</div>
                <div className={cn('text-[16px] font-black mt-1 font-mono', x.c)}>{x.v}</div>
              </div>
            ))}
          </div>

          {/* كاشف الانحراف */}
          {data.shadow && (
            <div className={cn('rounded-xl border p-4 flex flex-wrap items-center gap-x-6 gap-y-2',
              data.shadow.driftPct <= -15 ? 'border-[#f6465d]/40 bg-[#f6465d]/8' : 'border-[#2ebd85]/30 bg-[#2ebd85]/5')}>
              <div className="flex items-center gap-2">
                {data.shadow.driftPct <= -15
                  ? <AlertTriangle className="w-4.5 h-4.5 text-[#f6465d]" />
                  : <ShieldCheck className="w-4.5 h-4.5 text-[#2ebd85]" />}
                <span className="text-[13px] font-black text-[#e9edf4]">كاشف الانحراف — الحي مقابل الباك تيست</span>
              </div>
              <div className="text-[11.5px] text-[#8a94a6] font-mono">
                الحي: <b className="text-[#e9edf4]">{data.shadow.winRate}%</b> ({data.shadow.closed} صفقة مغلقة)
                | الباك تيست: <b className="text-[#e9edf4]">{data.shadow.backtestWinRate}%</b>
                | الفرق: <b className={data.shadow.driftPct <= -15 ? 'text-[#f6465d]' : 'text-[#2ebd85]'}>{data.shadow.driftPct > 0 ? '+' : ''}{data.shadow.driftPct} نقطة</b>
              </div>
            </div>
          )}

          {/* التقرير */}
          <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
            <div className="text-[13px] font-bold text-[#d9b45c] mb-2.5">تقرير المدرب</div>
            <div className="space-y-2">
              {data.report.map((line, i) => (
                <div key={i} className="text-[12px] text-[#c9d1e0] leading-relaxed flex gap-2">
                  <span className="text-[#d9b45c] shrink-0 mt-0.5">◆</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
            <div className="mt-2.5 text-[9.5px] text-[#5a6474]">
              الفترة: {new Date(data.period.startT).toISOString().slice(0, 10)} → {new Date(data.period.endT).toISOString().slice(0, 10)} — آخر تشغيل: {new Date(data.runAt).toLocaleString('ar-SY')}
            </div>
          </div>

          {/* المقترحات */}
          {data.proposals.length > 0 && (
            <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
              <div className="text-[13px] font-bold text-[#d9b45c] mb-2.5 flex items-center gap-2">
                <Lightbulb className="w-4 h-4" />
                مقترحات قابلة للتطبيق ({data.proposals.length})
              </div>
              <div className="space-y-2.5">
                {data.proposals.map(p => {
                  const done = applied.has(p.id);
                  return (
                    <div key={p.id} className={cn('rounded-xl border p-3.5',
                      done ? 'border-[#2ebd85]/40 bg-[#2ebd85]/5' : 'border-[#2a3550] bg-[#101726]')}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-bold text-[#e9edf4]">{p.title}</div>
                          <div className="text-[11px] text-[#8a94a6] mt-1 leading-relaxed">{p.detail}</div>
                        </div>
                        {p.apply && !done && (
                          <button onClick={() => apply(p)} disabled={running}
                            className="shrink-0 rounded-lg bg-[#d9b45c] hover:bg-[#e5c26e] disabled:opacity-50 text-[#0a0e17] font-black text-[11px] px-3.5 py-2">
                            تطبيق وإعادة اختبار
                          </button>
                        )}
                        {done && (
                          <span className="shrink-0 flex items-center gap-1 text-[#2ebd85] text-[11px] font-bold">
                            <CheckCircle2 className="w-4 h-4" /> طُبّق
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 text-[10px] text-[#5a6474] leading-relaxed">
                مبدأ الحوكمة: المدرب يقترح ويشرح بالأرقام — أنت من يوافق بالتطبيق. حدود الخطر الصلبة (سقف يومي 5%، سقف صفقات، سقف لوت) مكتوبة في الكود ولا يمكن لأي اقتراح تجاوزها.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
