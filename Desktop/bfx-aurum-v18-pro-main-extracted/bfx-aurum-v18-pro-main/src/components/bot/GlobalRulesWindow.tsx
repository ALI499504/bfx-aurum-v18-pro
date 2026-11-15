'use client';

// نافذة القواعد العليا — 21 قاعدة حرفياً من ملف XAU-TAMSA7.pdf (ص80–83)
// كل قاعدة: زر تفعيل/إيقاف ثنائي + أسهم تعديل للقيم الرقمية (وفق أمر الواجهة)
import { useBot } from './store';
import { Switch } from './SessionsWindow';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GLOBAL_RULES_META } from '@/lib/engine/rules';

// القيم الرقمية القابلة للتعديل لكل قاعدة (وفق أسهم التعديل في الدليل)
const VALUE_SPEC: Record<string, { label: string; step: number; min?: number; max?: number; fixed?: string }> = {
  symbol_lock: { label: 'XAUUSD', step: 1, fixed: 'XAUUSD' },
  fixed_lot: { label: 'لوت', step: 0.01, min: 0.01, max: 1 },
  min_hold_min: { label: 'دقيقة', step: 1, min: 1, max: 60 },
  max_hold_hours: { label: 'ساعة', step: 1, min: 1, max: 96 },
  max_daily_trades: { label: 'صفقة', step: 1, min: 1, max: 200 },
  min_daily_trades: { label: 'صفقة', step: 1, min: 1, max: 50 },
  daily_loss_stop: { label: 'دولار', step: 1, min: 1, max: 1000 },
  daily_profit_stop: { label: 'دولار', step: 1, min: 1, max: 1000 },
  fixed_base: { label: 'دولار', step: 1, min: 1, max: 100000 },
  news_filter: { label: 'دقيقة قبل الخبر', step: 1, min: 1, max: 120 },
  news_after_min: { label: 'دقيقة بعد الخبر', step: 1, min: 1, max: 240 },
  market_open_filter: { label: 'دقيقة', step: 1, min: 1, max: 240 },
  market_close_filter: { label: 'دقيقة', step: 1, min: 1, max: 240 },
  fixed_spread: { label: 'سنت', step: 1, min: 1, max: 100 },
  slippage: { label: 'بيب (±)', step: 1, min: 1, max: 100 },
  ghost_entry: { label: 'بيب اقتراب', step: 5, min: 5, max: 200 },
  ghost_run_pips: { label: 'بيب انطلاق', step: 5, min: 5, max: 500 },
  break_even: { label: 'مفتاح كلي', step: 1, fixed: 'الحالتان' },
  be_case1: { label: 'بيب → وقف عند الدخول', step: 5, min: 5, max: 200 },
  be_case2: { label: 'بيب → حجز ربح', step: 5, min: 10, max: 400 },
  be_lock_pips: { label: 'بيب محجوزة', step: 5, min: 5, max: 200 },
};

export function GlobalRulesWindow() {
  const { settings, patchSettings, running, runBacktest } = useBot();

  const setRule = (key: string, patch: { enabled?: boolean; value?: number }) => {
    patchSettings(d => {
      d.globalRules[key] = { ...(d.globalRules[key] ?? { enabled: false }), ...patch };
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
        <h2 className="text-[15px] font-bold text-[#d9b45c] mb-1">نافذة القواعد العليا — 21 قاعدة (الدليل ص80–83)</h2>
        <p className="text-[11.5px] text-[#8a94a6] leading-relaxed">
          عند تفعيل زر أي قاعدة تكتسب أولوية تنفيذ قصوى وتُطبق كقيد صارم مسبق: إذا خالفت الصفقة شرطاً واحداً من القواعد المفعلة
          تُلغى وتُحظر فوراً حتى لو توافقت مع استراتيجية أو مؤشر — الأولوية المطلقة للامتثال للقواعد المفعلة هنا.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {GLOBAL_RULES_META.map((r) => {
          const rule = settings.globalRules[r.key] ?? { enabled: false, value: 0 };
          const spec = VALUE_SPEC[r.key];
          const isOn = rule.enabled;
          return (
            <div key={r.key} className={cn('rounded-xl border p-3.5', isOn ? 'border-[#d9b45c]/30 bg-[#d9b45c]/5' : 'border-[#1b2334] bg-[#0d1220]')}>
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 shrink-0 rounded-md bg-[#141a29] text-[#8a94a6] text-[10.5px] font-bold flex items-center justify-center border border-[#2a3550] mt-0.5">{r.n}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold text-[#e9edf4] leading-snug">{r.title}</div>
                  <div className="text-[10.5px] text-[#8a94a6] mt-0.5 leading-relaxed">{r.desc}</div>
                </div>
                <Switch on={isOn} onChange={v => setRule(r.key, { enabled: v })} />
              </div>
              {spec && (
                <div className="mt-2.5 mr-9 flex items-center gap-2 flex-wrap">
                  {spec.fixed ? (
                    <span className="text-[12px] font-mono font-bold text-[#d9b45c] px-2 py-1 rounded-md bg-[#141a29] border border-[#2a3550]">{spec.fixed}</span>
                  ) : (
                    <>
                      <Stepper value={typeof rule.value === 'number' ? rule.value : 0} step={spec.step} min={spec.min} max={spec.max}
                        onChange={v => setRule(r.key, { value: v })} />
                      <span className="text-[11px] text-[#8a94a6]">{spec.label}</span>
                    </>
                  )}
                </div>
              )}
              {/* الحالات الفرعية لقاعدة التأمين (20) */}
              {r.key === 'break_even' && isOn && (
                <div className="mt-2 mr-9 space-y-1.5 rounded-lg bg-[#101726] border border-[#1b2334] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[#c8d0dd]">الحالة الأولى: التأمين الصفري المباشر</span>
                    <div className="flex items-center gap-2">
                      <Stepper value={settings.globalRules.be_case1?.value ?? 50} step={5} min={5} max={200}
                        onChange={v => setRule('be_case1', { value: v })} />
                      <Switch on={!!settings.globalRules.be_case1?.enabled} onChange={v => setRule('be_case1', { enabled: v })} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[#c8d0dd]">الحالة الثانية: التأمين الربحي المتقدم</span>
                    <div className="flex items-center gap-2">
                      <Stepper value={settings.globalRules.be_case2?.value ?? 100} step={5} min={10} max={400}
                        onChange={v => setRule('be_case2', { value: v })} />
                      <Switch on={!!settings.globalRules.be_case2?.enabled} onChange={v => setRule('be_case2', { enabled: v })} />
                      <span className="text-[10px] text-[#8a94a6]">حجز</span>
                      <Stepper value={settings.globalRules.be_lock_pips?.value ?? 50} step={5} min={5} max={200}
                        onChange={v => setRule('be_lock_pips', { value: v })} />
                    </div>
                  </div>
                </div>
              )}
              {/* القاعدة 21: التسلسل الهرمي ثابت */}
              {r.key === 'hierarchy' && (
                <div className="mt-2 mr-9 rounded-lg bg-[#101726] border border-[#1b2334] p-2.5 text-[10.5px] text-[#8a94a6] leading-relaxed">
                  المستوى الأول: القواعد العليا (سيادة مطلقة) ← المستوى الثاني: سلم أولويات الجلسة النشطة ← المستوى الثالث: قواعد كل استراتيجية الداخلية. ولا تنفيذ نهائي إلا بالامتثال الكامل.
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={() => { if (!running) runBacktest(); }} disabled={running}
        className="flex items-center gap-2 rounded-lg bg-[#d9b45c] hover:bg-[#e5c26e] disabled:opacity-60 text-[#0a0e17] font-bold text-[12.5px] px-5 py-2.5">
        {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
        {running ? 'جارٍ إعادة الاختبار وفق القواعد الجديدة...' : 'حفظ وإعادة تشغيل الباك تيست'}
      </button>
    </div>
  );
}

export function Stepper({ value, step, min, max, onChange }: {
  value: number; step: number; min?: number; max?: number; onChange: (v: number) => void;
}) {
  const dec = () => { const v = Math.max(min ?? -Infinity, +(value - step).toFixed(2)); if (v !== value) onChange(v); };
  const inc = () => { const v = Math.min(max ?? Infinity, +(value + step).toFixed(2)); if (v !== value) onChange(v); };
  return (
    <div className="flex items-center border border-[#2a3550] rounded-lg overflow-hidden bg-[#101726]">
      <button onClick={dec} aria-label="خفض القيمة" className="w-8 h-8 flex items-center justify-center text-[#8a94a6] hover:text-[#d9b45c] hover:bg-[#141a29] text-[15px]">▾</button>
      <span className="min-w-[56px] text-center font-mono font-bold text-[13px] text-[#e9edf4] py-1">{value}</span>
      <button onClick={inc} aria-label="رفع القيمة" className="w-8 h-8 flex items-center justify-center text-[#8a94a6] hover:text-[#d9b45c] hover:bg-[#141a29] text-[15px]">▴</button>
    </div>
  );
}
