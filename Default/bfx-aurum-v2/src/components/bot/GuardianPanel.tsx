'use client';

// لوحة الوكيل الحارس — مراقبة وإصلاح تلقائي على مدار الساعة
// • زر عائم صغير أسفل يمين الشاشة (خارج تدفق الصفحة تماماً — لا يؤثر على أي شيء)
// • يعرض: حالة النظام، فحوصات لحظية (قاعدة البيانات، بثّ MT5، اللقطة،
//   الإعدادات، الأخبار، محرك التنبؤ، الذاكرة) وسجل الإصلاحات التلقائية
// • زر «فحص وإصلاح الآن» يشغّل دورة إصلاح شاملة فوراً
// • الوكيل نفسه يعمل داخل الخادم كل 30 ثانية حتى لو كانت هذه اللوحة مغلقة
import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck, ShieldAlert, Wrench, Database, Radio, Cpu, RefreshCw,
  AlertTriangle, CheckCircle2, XCircle, MinusCircle, Clock, FileJson, Newspaper, Gauge,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CheckResult { id: string; label: string; status: 'ok' | 'warn' | 'fail' | 'skip'; detail: string; ms: number }
interface GuardianEvent { t: number; level: 'info' | 'fix' | 'warn' | 'critical'; action: string; detail: string }
interface GuardianReport {
  status: 'healthy' | 'degraded' | 'healing' | 'critical';
  now: number; startedAt: number; uptimeSec: number;
  cycles: number; heals: number; fixes: number;
  lastCycleMs: number; lastCycleAt: number; nextCycleInSec: number;
  healingNow: boolean;
  checks: CheckResult[]; events: GuardianEvent[];
  mem: { rssMb: number; heapMb: number };
  node: string;
}

const STATUS_CFG: Record<GuardianReport['status'], { label: string; color: string }> = {
  healthy: { label: 'مستقر', color: '#2ebd85' },
  degraded: { label: 'تنبيه', color: '#e8a33d' },
  healing: { label: 'جارٍ الإصلاح', color: '#d9b45c' },
  critical: { label: 'خطر', color: '#f6465d' },
};

const CHECK_ICON: Record<string, typeof Database> = {
  db: Database, feed: Radio, snapshot: FileJson, settings: Wrench,
  news: Newspaper, engine: Cpu, memory: Gauge,
};

const LEVEL_CFG: Record<GuardianEvent['level'], { color: string; icon: typeof CheckCircle2 }> = {
  info: { color: '#8a94a6', icon: MinusCircle },
  fix: { color: '#2ebd85', icon: CheckCircle2 },
  warn: { color: '#e8a33d', icon: AlertTriangle },
  critical: { color: '#f6465d', icon: XCircle },
};

const OPEN_POLL_MS = 10_000;   // تحديث كل 10 ثوانٍ واللوحة مفتوحة
const IDLE_POLL_MS = 30_000;   // نبضة خفيفة كل 30 ثانية وهي مغلقة (للشارة فقط)

function fmtTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function uptime(sec: number): string {
  if (sec < 60) return `${sec} ثانية`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} ${m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتين' : m <= 10 ? 'دقائق' : 'دقيقة'}`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  const hh = h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : `${h} ساعات`;
  return rem > 0 ? `${hh} و${rem} دقيقة` : hh;
}

function rel(t: number, now: number): string {
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 10) return 'الآن';
  if (s < 60) return `قبل ${s} ثانية`;
  const m = Math.floor(s / 60);
  if (m < 60) return `قبل ${m} ${m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتين' : 'دقائق'}`;
  const h = Math.floor(m / 60);
  return `قبل ${h} ${h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : 'ساعات'}`;
}

export function GuardianPanel() {
  const [open, setOpen] = useState(false);
  const [rep, setRep] = useState<GuardianReport | null>(null);
  const [healing, setHealing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch('/api/system/health', { cache: 'no-store' }).then(r => r.json());
      if (j && j.status) setRep(j as GuardianReport);
    } catch { /* اللوحة لا تؤثر على أي شيء */ }
  }, []);

  /** دورة فحص وإصلاح فورية */
  const healNow = useCallback(async () => {
    setHealing(true);
    try {
      const j = await fetch('/api/system/heal', { method: 'POST', cache: 'no-store' }).then(r => r.json());
      if (j && j.status) setRep(j as GuardianReport);
    } catch { /* ignore */ }
    setHealing(false);
  }, []);

  // نبضة خفيفة دائمة + تحديث سريع واللوحة مفتوحة + فحص فوري عند الفتح
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, open ? OPEN_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(id);
  }, [open, refresh]);

  const status = rep?.status ?? 'healthy';
  const cfg = STATUS_CFG[status];
  const active = rep?.checks.filter(c => c.status !== 'skip').length ?? 0;
  const problems = rep?.checks.filter(c => c.status === 'warn' || c.status === 'fail').length ?? 0;

  return (
    <div className="fixed bottom-3 right-3 z-50 print:hidden">
      {/* اللوحة */}
      {open && (
        <div className="absolute bottom-full mb-2 right-0 w-[360px] max-h-[500px] flex flex-col rounded-xl border border-[#1b2334] bg-[#0d1220] shadow-[0_8px_40px_rgba(0,0,0,0.55)] overflow-hidden">
          {/* رأس اللوحة */}
          <div className="shrink-0 px-3 py-2.5 border-b border-[#1b2334] bg-gradient-to-l from-[#101726] to-[#0d1220] flex items-center gap-2">
            {status === 'critical'
              ? <ShieldAlert className="w-4 h-4" style={{ color: cfg.color }} />
              : <ShieldCheck className="w-4 h-4 text-[#d9b45c]" />}
            <span className="text-[12.5px] font-bold text-[#d9b45c]">الوكيل الحارس</span>
            <span className={cn('text-[10px] font-black rounded px-1.5 py-0.5 border',
              status === 'healing' && 'animate-pulse')}
              style={{ color: cfg.color, borderColor: `${cfg.color}55`, backgroundColor: `${cfg.color}14` }}>
              {healing || rep?.healingNow ? 'جارٍ الفحص...' : cfg.label}
            </span>
            <span className="mr-auto text-[9px] text-[#5a6474] font-mono">24/7</span>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {/* إحصاءات سريعة */}
            <div className="grid grid-cols-4 gap-px bg-[#1b2334]/60 border-b border-[#1b2334]">
              {[
                { v: rep ? uptime(rep.uptimeSec) : '—', l: 'أقلع منذ' },
                { v: rep ? String(rep.cycles) : '—', l: 'دورة مراقبة' },
                { v: rep ? String(rep.fixes) : '—', l: 'إصلاح تلقائي', c: '#2ebd85' },
                { v: rep ? `${rep.lastCycleMs}ms` : '—', l: 'آخر فحص' },
              ].map((s, i) => (
                <div key={i} className="bg-[#0d1220] px-2 py-1.5 text-center">
                  <div className="text-[11px] font-black text-[#e9edf4]" style={s.c ? { color: s.c } : undefined}>{s.v}</div>
                  <div className="text-[8.5px] text-[#5a6474]">{s.l}</div>
                </div>
              ))}
            </div>

            {/* الفحوصات اللحظية */}
            <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 sticky top-0 bg-[#0d1220] z-10 border-b border-[#1b2334]/60">
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: cfg.color }} />
              <span className="text-[11px] font-black text-[#c3cbd9]">فحوصات لحظية</span>
              <span className="text-[9.5px] text-[#8a94a6]">
                {active} فحص · دورة كل 30 ثانية · التالي بعد {rep?.nextCycleInSec ?? '—'}ث
              </span>
            </div>

            {(rep?.checks ?? []).map(c => {
              const Icon = CHECK_ICON[c.id] ?? Cpu;
              const col = c.status === 'ok' ? '#2ebd85' : c.status === 'warn' ? '#e8a33d'
                : c.status === 'fail' ? '#f6465d' : '#5a6474';
              return (
                <div key={c.id} className="px-3 py-2 border-b border-[#1b2334]/60">
                  <div className="flex items-center gap-1.5">
                    <Icon className="w-3 h-3 text-[#8a94a6] shrink-0" />
                    <span className="text-[11.5px] font-bold text-[#e9edf4]">{c.label}</span>
                    {c.status === 'ok' && <CheckCircle2 className="w-3 h-3" style={{ color: col }} />}
                    {c.status === 'warn' && <AlertTriangle className="w-3 h-3" style={{ color: col }} />}
                    {c.status === 'fail' && <XCircle className="w-3 h-3" style={{ color: col }} />}
                    {c.status === 'skip' && <MinusCircle className="w-3 h-3" style={{ color: col }} />}
                    <span className="mr-auto text-[8.5px] font-mono text-[#5a6474]">{c.ms}ms</span>
                  </div>
                  <div className="mt-0.5 pr-[18px] text-[10px] leading-relaxed text-[#8a94a6]">{c.detail}</div>
                </div>
              );
            })}
            {!rep && (
              <div className="px-3 py-5 text-center text-[11px] text-[#8a94a6]">
                جارٍ الاتصال بالوكيل الحارس...
              </div>
            )}

            {/* سجل الإصلاح التلقائي */}
            <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 sticky top-0 bg-[#0d1220] z-10 border-b border-[#1b2334]/60">
              <Wrench className="w-3 h-3 text-[#2ebd85]" />
              <span className="text-[11px] font-black text-[#2ebd85]">سجل الإصلاح التلقائي</span>
              <span className="text-[9.5px] text-[#8a94a6]">{rep?.fixes ?? 0} إصلاح منفّذ</span>
            </div>
            {(rep?.events ?? []).length === 0 ? (
              <div className="px-3 py-4 text-center text-[10.5px] text-[#5a6474]">لا أحداث بعد — الوكيل يراقب بصمت</div>
            ) : (
              (rep?.events ?? []).map((e, i) => {
                const lc = LEVEL_CFG[e.level];
                const Icon = lc.icon;
                return (
                  <div key={`${e.t}-${i}`} className="px-3 py-1.5 border-b border-[#1b2334]/40 flex items-start gap-1.5">
                    <Icon className="w-3 h-3 mt-0.5 shrink-0" style={{ color: lc.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10.5px] font-bold" style={{ color: lc.color }}>{e.action}</span>
                        <span className="mr-auto text-[8.5px] font-mono text-[#5a6474] shrink-0" title={fmtTime(e.t)}>
                          <Clock className="inline w-2.5 h-2.5" /> {rel(e.t, rep?.now ?? Date.now())}
                        </span>
                      </div>
                      <div className="text-[9.5px] text-[#8a94a6] leading-relaxed">{e.detail}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* تذييل: زر الفحص والإصلاح الفوري */}
          <div className="shrink-0 px-3 py-2 border-t border-[#1b2334] bg-[#0a0e17] flex items-center gap-2">
            <button
              onClick={healNow}
              disabled={healing}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all border',
                healing
                  ? 'border-[#d9b45c]/40 bg-[#d9b45c]/10 text-[#d9b45c] cursor-wait'
                  : 'border-[#2ebd85]/40 bg-[#2ebd85]/10 text-[#2ebd85] hover:bg-[#2ebd85]/20',
              )}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', healing && 'animate-spin')} />
              {healing ? 'جارٍ الفحص والإصلاح...' : 'فحص وإصلاح الآن'}
            </button>
            <span className="text-[8.5px] text-[#5a6474] leading-tight">
              {problems > 0
                ? <b style={{ color: cfg.color }}>{problems} مشكلة تحتاج انتباهك أعلاه</b>
                : 'الوكيل يراقب ويعالج تلقائياً — لا يمس أي منطق تداول'}
            </span>
          </div>
        </div>
      )}

      {/* الزر العائم */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-1.5 rounded-full border shadow-lg px-3 py-1.5 transition-all',
          'bg-[#0d1220]/90 backdrop-blur-sm hover:bg-[#101726]',
          open ? 'border-[#d9b45c]/60 shadow-[0_0_16px_rgba(217,180,92,0.25)]' : 'border-[#1b2334] hover:border-[#d9b45c]/40',
        )}
        title="الوكيل الحارس — مراقبة وإصلاح تلقائي على مدار الساعة"
      >
        <span className="relative flex items-center">
          {status === 'critical'
            ? <ShieldAlert className="w-4 h-4 animate-pulse" style={{ color: cfg.color }} />
            : <ShieldCheck className={cn('w-4 h-4', open ? 'text-[#d9b45c]' : 'text-[#8a94a6]')} />}
          {problems > 0 && !open && (
            <span className="absolute -top-1.5 -left-1.5 min-w-[15px] h-[15px] rounded-full text-[#0a0e17] text-[8.5px] font-black flex items-center justify-center px-1 shadow"
              style={{ backgroundColor: cfg.color }}>
              {problems}
            </span>
          )}
        </span>
        <span className="text-[11px] font-bold text-[#c3cbd9]">
          الحارس · <b style={{ color: cfg.color }}>{healing ? 'يفحص...' : cfg.label}</b>
        </span>
      </button>
    </div>
  );
}
