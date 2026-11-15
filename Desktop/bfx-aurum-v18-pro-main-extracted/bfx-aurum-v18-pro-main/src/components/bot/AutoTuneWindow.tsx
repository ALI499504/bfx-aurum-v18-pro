'use client';

// لوحة الضبط الذاتي — قلب الإدارة الآلية
// 1) الضابط (Tuner): بحث شبكي Walk-Forward لمعاملات كل استراتيجية
//    على شموع MT5 الحقيقية — لا تُعتمد قيمة إلا نجحت خارج عينة التدريب.
// 2) المدير الآلي: تعطيل الخاسر بثبات، إعادة تفعيل الرابح، قتل الجلسات
//    الخاسرة — بقرارات مسببة بالأرقام بدل التحكم اليدوي (أُزيل نهائياً).
import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Bot, Sparkles, CheckCircle2, XCircle, MinusCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TunerMetrics { trades: number; winRate: number; pf: number; net: number; expectancy: number }
interface TunerStrategyResult {
  strategy: string; name: string;
  train: TunerMetrics | null; oosBaseline: TunerMetrics | null; oosTuned: TunerMetrics | null;
  bestCombo?: { label: string; values: number[]; score: number };
  decision: 'tuned' | 'kept' | 'low-sample' | 'rejected-oos' | 'no-trades';
  note?: string;
}
interface TunerReport {
  startedAt: number; finishedAt: number;
  train: { from: string; to: string }; oos: { from: string; to: string };
  runs: number;
  applied: { strategy: string; paths: string[]; values: number[] }[];
  results: TunerStrategyResult[];
  systemBefore: { trades: number; winRate: number; pf: number; net: number; dd: number } | null;
  systemAfterOos: { trades: number; winRate: number; pf: number; net: number; dd: number } | null;
}
interface AutoDecision {
  kind: 'disable-strategy' | 'enable-strategy' | 'disable-session' | 'keep' | 'note';
  strategy: string; session?: string; reason: string;
  metrics: Record<string, number | string>;
}
interface AutoReport {
  runAt: number; mode: string;
  decisions: AutoDecision[];
  summary: { enabled: number; disabled: number; sessionKills: number; totalTrades: number; netAll: number };
}

const fmt = (n: number | undefined | null) => (typeof n === 'number' ? Math.round(n * 100) / 100 : '—');
const mLine = (m: TunerMetrics | null) => m ? `${m.trades} صفقة | نجاح ${Math.round(m.winRate)}% | PF ${fmt(m.pf)} | صافي ${fmt(m.net)}$` : '—';

function DecisionBadge({ d }: { d: TunerStrategyResult['decision'] }) {
  const map: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
    'tuned': { label: 'ضُبط واعتُمد خارج العينة', cls: 'text-[#2ebd85] border-[#2ebd85]/40 bg-[#2ebd85]/8', icon: CheckCircle2 },
    'kept': { label: 'الافتراضي أفضل', cls: 'text-[#c8d0dd] border-[#2a3550] bg-[#101726]', icon: MinusCircle },
    'rejected-oos': { label: 'رُفض خارج العينة', cls: 'text-[#f6a646] border-[#f6a646]/40 bg-[#f6a646]/8', icon: XCircle },
    'low-sample': { label: 'عينة صغيرة', cls: 'text-[#8a94a6] border-[#2a3550] bg-[#101726]', icon: AlertTriangle },
    'no-trades': { label: 'لا صفقات', cls: 'text-[#8a94a6] border-[#2a3550] bg-[#101726]', icon: MinusCircle },
  };
  const it = map[d] ?? map['kept'];
  const Icon = it.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-bold', it.cls)}>
      <Icon className="w-3 h-3" /> {it.label}
    </span>
  );
}

export function AutoTuneWindow() {
  const [tuner, setTuner] = useState<{ running?: boolean; stage?: string; done?: number; total?: number; log?: string[]; report?: TunerReport | null; error?: string | null; exists?: boolean }>({});
  const [auto, setAuto] = useState<{ exists?: boolean; report?: AutoReport } | null>(null);
  const [busyTuner, setBusyTuner] = useState(false);
  const [busyAuto, setBusyAuto] = useState(false);
  const [msg, setMsg] = useState('');

  const loadTuner = useCallback(async () => {
    try {
      const r = await fetch('/api/tuner', { cache: 'no-store' });
      setTuner(await r.json());
    } catch { /* تجاهل */ }
  }, []);
  const loadAuto = useCallback(async () => {
    try {
      const r = await fetch('/api/automanager', { cache: 'no-store' });
      setAuto(await r.json());
    } catch { /* تجاهل */ }
  }, []);

  useEffect(() => {
    loadTuner(); loadAuto();
    const iv = setInterval(() => { loadTuner(); }, 3000);
    return () => clearInterval(iv);
  }, [loadTuner, loadAuto]);

  const startTuner = async () => {
    setBusyTuner(true); setMsg('');
    try {
      const r = await fetch('/api/tuner', { method: 'POST' });
      const j = await r.json();
      if (!j.ok) setMsg(j.error ?? 'تعذر البدء');
    } finally { setBusyTuner(false); loadTuner(); }
  };
  const runAuto = async () => {
    setBusyAuto(true); setMsg('');
    try {
      const r = await fetch('/api/automanager', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      if (j.ok) setMsg(`قرار آلي جديد: ${j.summary?.disabled ?? 0} تعطيل · ${j.summary?.enabled ?? 0} تفعيل · ${j.summary?.sessionKills ?? 0} قتل جلسة`);
      else setMsg(j.error ?? 'فشل التشغيل');
      loadAuto();
    } finally { setBusyAuto(false); }
  };

  const rep = tuner.report;
  const running = tuner.running;

  return (
    <div className="space-y-4">
      {/* الترويسة */}
      <div className="rounded-xl border border-[#d9b45c]/30 bg-gradient-to-l from-[#d9b45c]/8 to-transparent p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Sparkles className="w-4.5 h-4.5 text-[#d9b45c]" />
          <h2 className="text-[15px] font-bold text-[#d9b45c]">الضبط الذاتي والإدارة الآلية — بلا تحكم يدوي</h2>
        </div>
        <p className="text-[11.5px] text-[#8a94a6] leading-relaxed">
          كل استراتيجية تُضبط آلياً ببحث شبكي على شموع MT5 الحقيقية (تدريب ثم تحقق خارج العينة — لا تُعتمد قيمة إلا نجحت بعد التدريب)،
          ثم يدير النظام نفسه: تعطيل الخاسر بثبات، إعادة تفعيل المتحسّن، وفتح/إغلاق بوابات الجلسات حسب الأداء المقاس.
          مفاتيح التشغيل اليدوية أُزلت من نافذتي الاستراتيجيات والجلسات بقرار المالك.
        </p>
      </div>

      {/* زرا التشغيل */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={startTuner} disabled={busyTuner || running}
          className="flex items-center gap-2 rounded-lg bg-[#d9b45c] hover:bg-[#e5c26e] disabled:opacity-60 text-[#0a0e17] font-bold text-[12.5px] px-5 py-2.5">
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {running ? `الضبط يعمل — ${tuner.done ?? 0}/${tuner.total ?? 0}` : 'تشغيل الضبط الذاتي (بحث شبكي Walk-Forward)'}
        </button>
        <button onClick={runAuto} disabled={busyAuto}
          className="flex items-center gap-2 rounded-lg border border-[#2a3550] bg-[#141a29] hover:bg-[#1a2233] disabled:opacity-60 text-[#e9edf4] font-bold text-[12.5px] px-5 py-2.5">
          {busyAuto ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
          {busyAuto ? 'جارٍ اتخاذ القرارات...' : 'تشغيل المدير الآلي (تعطيل/تفعيل بالأرقام)'}
        </button>
        {msg && <span className="text-[11px] text-[#f6a646] font-bold">{msg}</span>}
      </div>

      {/* تقدم الضبط الحي */}
      {running && (
        <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12.5px] font-bold text-[#c8d0dd]">{tuner.stage}</span>
            <span className="text-[11px] text-[#8a94a6] font-mono">{tuner.done}/{tuner.total}</span>
          </div>
          <div className="h-2 rounded-full bg-[#101726] overflow-hidden mb-3">
            <div className="h-full bg-gradient-to-l from-[#d9b45c] to-[#e8c66f] transition-all"
              style={{ width: `${tuner.total ? Math.round(((tuner.done ?? 0) / tuner.total) * 100) : 0}%` }} />
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1 font-mono text-[10.5px] text-[#8a94a6]">
            {(tuner.log ?? []).slice(-8).map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}
      {tuner.error && (
        <div className="rounded-xl border border-[#f6465d]/40 bg-[#f6465d]/8 p-3 text-[12px] text-[#f6465d] font-bold">
          فشل الضبط: {tuner.error}
        </div>
      )}

      {/* تقرير الضبط */}
      {rep && (
        <>
          <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h3 className="text-[13.5px] font-bold text-[#d9b45c]">تقرير الضبط الأخير — {rep.applied.length} استراتيجية اعتُمدت خارج العينة</h3>
              <span className="text-[10.5px] text-[#5a6474] font-mono">
                تدريب: {rep.train.from.slice(0, 10)}→{rep.train.to.slice(0, 10)} · تحقق: {rep.oos.from.slice(0, 10)}→{rep.oos.to.slice(0, 10)} · {rep.runs} تشغيل
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-2.5">
                <div className="text-[9.5px] text-[#8a94a6]">النظام خارج العينة قبل الضبط</div>
                <div className="text-[12px] font-bold text-[#e9edf4] mt-0.5">{rep.systemBefore ? `${fmt(rep.systemBefore.net)}$ · PF ${fmt(rep.systemBefore.pf)}` : '—'}</div>
              </div>
              <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-2.5">
                <div className="text-[9.5px] text-[#8a94a6]">النظام خارج العينة بعد الضبط</div>
                <div className={cn('text-[12px] font-bold mt-0.5', (rep.systemAfterOos?.net ?? 0) >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>
                  {rep.systemAfterOos ? `${fmt(rep.systemAfterOos.net)}$ · PF ${fmt(rep.systemAfterOos.pf)}` : '—'}
                </div>
              </div>
              <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-2.5">
                <div className="text-[9.5px] text-[#8a94a6]">نسبة النجاح خارج العينة</div>
                <div className="text-[12px] font-bold text-[#e9edf4] mt-0.5">{rep.systemAfterOos ? `${fmt(rep.systemAfterOos.winRate)}%` : '—'}</div>
              </div>
              <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-2.5">
                <div className="text-[9.5px] text-[#8a94a6]">أقصى تراجع خارج العينة</div>
                <div className="text-[12px] font-bold text-[#e9edf4] mt-0.5">{rep.systemAfterOos ? `${fmt(rep.systemAfterOos.dd)}%` : '—'}</div>
              </div>
            </div>

            <div className="space-y-1.5">
              {rep.results.map(r => (
                <div key={r.strategy} className="rounded-lg border border-[#1b2334] bg-[#101726] px-3 py-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <span className="text-[#d9b45c] font-black text-[12px]">[{r.strategy}]</span>
                      <span className="text-[12px] font-bold text-[#e9edf4]"> {r.name}</span>
                    </div>
                    <DecisionBadge d={r.decision} />
                  </div>
                  <div className="text-[10.5px] text-[#8a94a6] mt-1 leading-relaxed">
                    تدريب: {mLine(r.train)}
                    {r.oosTuned && <> · تحقق بالضبط: {mLine(r.oosTuned)}</>}
                    {r.oosBaseline && r.oosTuned && <> · تحقق قبل الضبط: PF {fmt(r.oosBaseline.pf)} / صافي {fmt(r.oosBaseline.net)}$</>}
                  </div>
                  {r.note && <div className="text-[10.5px] text-[#c8d0dd] mt-0.5">{r.note}</div>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* تقرير المدير الآلي */}
      {auto?.exists && auto.report && (
        <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h3 className="text-[13.5px] font-bold text-[#d9b45c]">قرارات المدير الآلي الأخيرة</h3>
            <span className="text-[10.5px] text-[#5a6474] font-mono">
              {new Date(auto.report.runAt).toLocaleString('ar-EG')} · مفعلة {auto.report.summary.enabled} · معطلة {auto.report.summary.disabled} · قتل جلسات {auto.report.summary.sessionKills}
            </span>
          </div>
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {auto.report.decisions.filter(d => d.kind !== 'keep').map((d, i) => (
              <div key={i} className={cn('rounded-lg border px-3 py-2', d.kind === 'disable-strategy' ? 'border-[#f6465d]/30 bg-[#f6465d]/6' : d.kind === 'enable-strategy' ? 'border-[#2ebd85]/30 bg-[#2ebd85]/6' : d.kind === 'disable-session' ? 'border-[#f6a646]/30 bg-[#f6a646]/6' : 'border-[#1b2334] bg-[#101726]')}>
                <div className="text-[12px] font-bold text-[#e9edf4]">
                  <span className="text-[#d9b45c] font-black">[{d.strategy}]</span>
                  {d.session ? ` — جلسة ${({ asia: 'آسيا', london: 'لندن', londonNY: 'لندن ونيويورك', ny: 'نيويورك' } as Record<string, string>)[d.session] ?? d.session}` : ''}
                  {' — '}{({ 'disable-strategy': 'تعطيل آلي', 'enable-strategy': 'إعادة تفعيل آلية', 'disable-session': 'إغلاق بوابة جلسة', note: 'ملاحظة', keep: 'بقي كما هو' } as Record<string, string>)[d.kind]}
                </div>
                <div className="text-[10.5px] text-[#8a94a6] mt-0.5">{d.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
