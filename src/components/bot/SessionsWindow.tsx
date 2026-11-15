'use client';

// نافذة جدولة الجلسات — عرض آلي فقط
// بوابات الجلسات (استراتيجية × بند × سيناريو × جلسة) تديرها الآلة من نتائج
// الباك تيست الحقيقية: الجلسة الخاسرة بثبات تُغلق تلقائياً والمتحسنة تُفتح.
// (التحكم اليدوي أُزيل بقرار المالك — الضبط من نافذة «الضبط الذاتي»)
import { useBot, STRATEGY_NAMES } from './store';
import { StrategyId, SESSION_AR } from '@/lib/engine/types';
import { ALLOWED_SESSIONS } from '@/lib/engine/tamsa-params';
import { cn } from '@/lib/utils';
import { Lock, RefreshCw, Bot } from 'lucide-react';

const SESSION_IDS = ['asia', 'london', 'londonNY', 'ny'] as const;
type SessKey = (typeof SESSION_IDS)[number];

export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch" aria-checked={on} disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
      className={cn('relative w-10 h-5.5 shrink-0 rounded-full transition-colors border',
        disabled && 'opacity-40 cursor-not-allowed',
        on ? 'bg-[#d9b45c]/85 border-[#d9b45c]' : 'bg-[#1b2334] border-[#2a3550]')}
      style={{ height: 22 }}
    >
      <span className={cn('absolute top-[1px] w-[18px] h-[18px] rounded-full bg-[#e9edf4] transition-all shadow',
        on ? 'right-[1px]' : 'right-[20px]')} />
    </button>
  );
}

export function SessionsWindow() {
  const { settings, running, runBacktest } = useBot();
  const strategies = Object.keys(STRATEGY_NAMES).filter(k => k !== 'Z') as StrategyId[];

  /** هل الجلسة مفتوحة للاستراتيجية؟ (أي بند × أي سيناريو) */
  const isOn = (s: StrategyId, sess: SessKey): boolean => {
    const cases = settings.scenarioSessions?.[s] ?? {};
    return Object.values(cases).some(sc =>
      (sc?.s1?.[sess] ?? false) || (sc?.s2?.[sess] ?? false));
  };
  const lockInfo = (s: StrategyId, sess: SessKey): boolean => {
    const allowed = ALLOWED_SESSIONS[s as keyof typeof ALLOWED_SESSIONS] ?? [];
    return !allowed.includes(sess);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#d9b45c]/30 bg-gradient-to-l from-[#d9b45c]/8 to-transparent p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Bot className="w-4.5 h-4.5 text-[#d9b45c]" />
          <h2 className="text-[15px] font-bold text-[#d9b45c]">جدولة الجلسات — إدارة آلية بالأداء المقاس</h2>
        </div>
        <p className="text-[11.5px] text-[#8a94a6] leading-relaxed">
          البوابات الخضراء جلسات رابحة أو مسموحة حرفياً من الدليل، والحمراء جلسات أغلقها المدير الآلي بعد قياس خسارتها بثبات
          (عينة كافية + صافي سالب)، والقفل الرمادي حصرية الدليل الحرفية (مثلاً فيبو آسيا M وذيول آسيا Q في آسيا فقط).
          لإعادة التقييم: شغّل المدير الآلي من نافذة «الضبط الذاتي».
        </p>
      </div>

      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] overflow-hidden">
        <div className="grid grid-cols-[1fr_repeat(4,72px)] gap-px bg-[#1b2334] text-[11px] font-bold">
          <div className="bg-[#101726] px-3 py-2.5 text-[#8a94a6]">الاستراتيجية</div>
          {SESSION_IDS.map(sess => (
            <div key={sess} className="bg-[#101726] px-1 py-2.5 text-center text-[#c8d0dd]">{SESSION_AR[sess]}</div>
          ))}
        </div>
        {strategies.map(s => (
          <div key={s} className="grid grid-cols-[1fr_repeat(4,72px)] gap-px bg-[#1b2334] items-center">
            <div className="bg-[#0d1220] px-3 py-2">
              <span className="inline-flex items-center gap-2">
                <span className="w-6 h-6 shrink-0 rounded-md bg-[#141a29] text-[#d9b45c] text-[11px] font-black flex items-center justify-center border border-[#2a3550]">{s}</span>
                <span className="text-[12px] font-bold text-[#e9edf4] leading-tight">{STRATEGY_NAMES[s]}</span>
              </span>
            </div>
            {SESSION_IDS.map(sess => {
              const locked = lockInfo(s, sess);
              const on = isOn(s, sess);
              return (
                <div key={sess} className="bg-[#0d1220] py-2 flex items-center justify-center">
                  {locked ? (
                    <Lock className="w-3.5 h-3.5 text-[#3d4a63]" />
                  ) : (
                    <span className={cn('rounded-md border px-2.5 py-1 text-[10px] font-bold',
                      on ? 'text-[#2ebd85] border-[#2ebd85]/40 bg-[#2ebd85]/8' : 'text-[#f6465d] border-[#f6465d]/40 bg-[#f6465d]/8')}>
                      {on ? 'مفتوحة' : 'أغلقها الآلي'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => { if (!running) runBacktest(); }} disabled={running}
          className="flex items-center gap-2 rounded-lg bg-[#d9b45c] hover:bg-[#e5c26e] disabled:opacity-60 text-[#0a0e17] font-bold text-[12.5px] px-5 py-2.5">
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
          {running ? 'جارٍ إعادة الاختبار...' : 'إعادة اختبار وفق آخر حالة آلية'}
        </button>
        <span className="text-[10.5px] text-[#5a6474]">الحالة تُحدّث تلقائياً بعد كل تشغيل للمدير الآلي</span>
      </div>
    </div>
  );
}
