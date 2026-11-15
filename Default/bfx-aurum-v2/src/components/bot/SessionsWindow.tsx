'use client';

// نافذة جدولة الجلسات — توزيع الاستراتيجيات على الجلسات الأربع
// أضيفت بناءً على طلب المستخدم: زر «نفّذه فقط» (وضع حصري) يجعل الاستراتيجية الوحيدة المنفَّذة
import { useBot, STRATEGY_NAMES } from './store';
import { STRATEGY_RANK, StrategyId } from '@/lib/engine/types';
import { SESSION_AR } from '@/lib/engine/types';
import { cn } from '@/lib/utils';
import { Lock, RefreshCw, Crown, AlertTriangle } from 'lucide-react';

const SESSIONS: { id: keyof ReturnType<typeof sessionKeys>; label: string }[] = [
  { id: 'asia', label: SESSION_AR.asia },
  { id: 'london', label: SESSION_AR.london },
  { id: 'londonNY', label: SESSION_AR.londonNY },
  { id: 'ny', label: SESSION_AR.ny },
];
function sessionKeys() { return { asia: 1, london: 1, londonNY: 1, ny: 1 }; }

const ASIA_ONLY: StrategyId[] = ['L', 'M', 'N'];
const SESSION_IDS = ['asia', 'london', 'londonNY', 'ny'] as const;

export function SessionsWindow() {
  const { settings, patchSettings, running, runBacktest, saving, dirty, saveError } = useBot();
  const strategies = Object.keys(STRATEGY_NAMES) as StrategyId[];

  const toggle = (s: StrategyId, sess: string, val: boolean) => {
    patchSettings(d => {
      d.sessions[s][sess as 'asia'] = val;
    });
  };

  const toggleAll = (s: StrategyId, val: boolean) => {
    patchSettings(d => {
      if (ASIA_ONLY.includes(s)) {
        // L/M/N حصرية آسيا: المفتاح الوحيد الفعّال هو آسيا
        d.sessions[s].asia = val;
      } else {
        for (const sess of SESSION_IDS) d.sessions[s][sess] = val;
      }
    });
  };

  // الوضع الحصري: هذه الاستراتيجية وحدها تُنفَّذ (وفق جلساتها المسموحة) وتُطفأ كل البقية
  const makeExclusive = (s: StrategyId) => {
    patchSettings(d => {
      for (const k of Object.keys(d.sessions) as StrategyId[]) {
        if (k === 'Z') continue; // المستويات اليدوية أوامر مباشرة — خارج الجدولة
        if (k === s) {
          for (const sess of SESSION_IDS) {
            d.sessions[k][sess] = ASIA_ONLY.includes(k) ? sess === 'asia' : true;
          }
        } else {
          for (const sess of SESSION_IDS) d.sessions[k][sess] = false;
        }
      }
    });
  };

  // ملخص حيّ لما هو مفعّل فعلاً — حتى لا يحدث سوء فهم مجدداً
  const enabled = strategies
    .filter(s => s !== 'Z' && SESSIONS.some(x => settings.sessions[s][x.id as 'asia']))
    .map(s => ({
      s,
      sessions: SESSIONS.filter(x => settings.sessions[s][x.id as 'asia']).map(x => x.id),
    }));
  const exclusive = enabled.length === 1 ? enabled[0] : null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
        <h2 className="text-[15px] font-bold text-[#d9b45c] mb-1">نافذة جدولة الجلسات وتوزيع استراتيجيات التداول</h2>
        <p className="text-[11.5px] text-[#8a94a6] leading-relaxed">
          فعّل أو عطّل كل استراتيجية داخل كل جلسة زمنية (بتوقيت سوريا): آسيا 01:00-10:00، لندن 10:00-15:00، لندن ونيويورك 15:00-19:00، نيويورك 19:00-23:00.
          الاستراتيجيات L و M و N حصرية لجلسة آسيا ومحظورة برمجياً خارجها.
          للسماح باستراتيجية <span className="text-[#d9b45c] font-bold">وحدها فقط</span> اضغط زر «نفّذه فقط» في صفّها — سيُطفأ كل غيره تلقائياً.
          بعد التعديل اضغط &quot;حفظ وإعادة تشغيل الباك تيست&quot; لإعادة الحساب وفق المعطيات الجديدة.
        </p>
      </div>

      {/* ملخص حيّ: ما سيُنفَّذ فعلاً وفق الجدولة المخزّنة */}
      <div className={cn('rounded-xl border p-3.5',
        exclusive ? 'border-[#2ebd85]/40 bg-[#2ebd85]/5' : enabled.length === 0 ? 'border-[#f6465d]/40 bg-[#f6465d]/5' : 'border-[#e8a33d]/40 bg-[#e8a33d]/5')}>
        {exclusive ? (
          <div className="flex items-center gap-2 text-[12.5px]">
            <Crown className="w-4 h-4 text-[#2ebd85] shrink-0" />
            <span className="text-[#2ebd85] font-bold">وضع حصري: {STRATEGY_NAMES[exclusive.s]} ({exclusive.s}) فقط</span>
            <span className="text-[#8a94a6]">— في: {exclusive.sessions.map(x => SESSION_AR[x]).join('، ')}</span>
          </div>
        ) : enabled.length === 0 ? (
          <div className="flex items-center gap-2 text-[12.5px]">
            <AlertTriangle className="w-4 h-4 text-[#f6465d] shrink-0" />
            <span className="text-[#f6465d] font-bold">لا توجد أي استراتيجية مفعّلة — لن تُنفَّذ أي صفقة نهائياً</span>
          </div>
        ) : (
          <div className="text-[12.5px] leading-relaxed">
            <span className="text-[#e8a33d] font-bold">تنبيه — {enabled.length} استراتيجيات مسموحة حالياً (البوت سيتداول بها كلها): </span>
            <span className="text-[#8a94a6]">
              {enabled.map(e => `${e.s} (${e.sessions.length === 4 ? 'كل الجلسات' : e.sessions.map(x => SESSION_AR[x as keyof typeof SESSION_AR]).join('، ')})`).join(' • ')}
            </span>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-[#101726] text-[#8a94a6]">
                <th className="text-right font-semibold px-3 py-2.5 w-[38%]">الاستراتيجية</th>
                {SESSIONS.map(s => <th key={s.id} className="text-center font-semibold px-2 py-2.5">{s.label}</th>)}
                <th className="text-center font-semibold px-2 py-2.5">الكل</th>
                <th className="text-center font-semibold px-2 py-2.5 text-[#d9b45c]">نفّذه فقط</th>
                <th className="text-center font-semibold px-2 py-2.5">الرتبة</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map(st => {
                const asiaOnly = ASIA_ONLY.includes(st);
                const cfg = settings.sessions[st];
                const anyOn = SESSIONS.some(s => cfg[s.id as 'asia']);
                const isManual = st === 'Z';
                return (
                  <tr key={st} className={cn('border-t border-[#141a29] hover:bg-[#101726]/60', exclusive?.s === st && 'bg-[#2ebd85]/5')}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 shrink-0 rounded-md bg-[#d9b45c]/15 text-[#d9b45c] font-black text-[11px] flex items-center justify-center border border-[#d9b45c]/30">{st}</span>
                        <span className="text-[#e9edf4]">{STRATEGY_NAMES[st]}</span>
                        {asiaOnly && <span title="آسيا حصراً"><Lock className="w-3 h-3 text-[#e8a33d]" /></span>}
                      </div>
                    </td>
                    {SESSIONS.map(s => (
                      <td key={s.id} className="text-center px-2 py-2">
                        {isManual ? (
                          <span className="text-[10px] text-[#5a6474]">مباشر</span>
                        ) : asiaOnly && s.id !== 'asia' ? (
                          <span className="text-[10px] text-[#5a6474]">محظور</span>
                        ) : (
                          <Switch on={cfg[s.id as 'asia']} onChange={v => toggle(st, s.id, v)} />
                        )}
                      </td>
                    ))}
                    <td className="text-center px-2 py-2">
                      {isManual ? (
                        <span className="text-[10px] text-[#5a6474]">—</span>
                      ) : (
                        <button onClick={() => toggleAll(st, !anyOn)}
                          className="text-[10.5px] px-2 py-1 rounded-md border border-[#2a3550] text-[#8a94a6] hover:text-[#d9b45c] hover:border-[#d9b45c]/50">
                          {anyOn ? 'تعطيل الكل' : 'تفعيل الكل'}
                        </button>
                      )}
                    </td>
                    <td className="text-center px-2 py-2">
                      {isManual ? (
                        <span className="text-[10px] text-[#5a6474] leading-tight inline-block w-24">أوامرك المباشرة تتجاوز الجدولة</span>
                      ) : (
                        <button onClick={() => makeExclusive(st)}
                          title={`إطفاء كل الاستراتيجيات وتشغيل ${st} وحدها`}
                          className={cn('inline-flex items-center gap-1 text-[10.5px] px-2 py-1 rounded-md border',
                            exclusive?.s === st
                              ? 'border-[#2ebd85]/60 bg-[#2ebd85]/15 text-[#2ebd85]'
                              : 'border-[#d9b45c]/40 text-[#d9b45c] hover:bg-[#d9b45c]/10')}>
                          <Crown className="w-3 h-3" />
                          {exclusive?.s === st ? 'هي الحصرية' : 'نفّذه فقط'}
                        </button>
                      )}
                    </td>
                    <td className="text-center px-2 py-2">
                      <span className="text-[10.5px] font-mono text-[#8a94a6]">{STRATEGY_RANK[st]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => { if (!running) runBacktest(); }} disabled={running}
          className="flex items-center gap-2 rounded-lg bg-[#d9b45c] hover:bg-[#e5c26e] disabled:opacity-60 text-[#0a0e17] font-bold text-[12.5px] px-5 py-2.5">
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
          {running ? 'جارٍ إعادة الاختبار وفق الجدولة الجديدة...' : 'حفظ وإعادة تشغيل الباك تيست'}
        </button>
        {saveError ? (
          <span className="text-[11.5px] text-[#f6465d] font-bold">⚠ فشل حفظ الإعدادات: {saveError} — الإعدادات الحالية غير محفوظة</span>
        ) : saving ? (
          <span className="text-[11.5px] text-[#d9b45c]">جارٍ حفظ الإعدادات...</span>
        ) : dirty ? (
          <span className="text-[11.5px] text-[#e8a33d]">تغييرات غير محفوظة بعد — سيتم الحفظ تلقائياً</span>
        ) : (
          <span className="text-[11.5px] text-[#2ebd85]">✓ الإعدادات محفوظة</span>
        )}
      </div>
    </div>
  );
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn('relative w-10 h-5.5 rounded-full transition-colors shrink-0 border',
        on ? 'bg-[#2ebd85]/30 border-[#2ebd85]/60' : 'bg-[#141a29] border-[#2a3550]')}
      style={{ height: 22, width: 40 }}
    >
      <span className={cn('absolute top-[2px] w-4 h-4 rounded-full transition-all',
        on ? 'right-[2px] bg-[#2ebd85]' : 'right-[19px] bg-[#5a6474]')} />
    </button>
  );
}
