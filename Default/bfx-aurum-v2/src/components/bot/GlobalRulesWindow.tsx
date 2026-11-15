'use client';

// نافذة القواعد العليا — القواعد الحاكمة مع مفاتيح التفعيل وأسهم الأرقام
import { useBot } from './store';
import { Switch } from './SessionsWindow';
import { RefreshCw, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RuleDef {
  key: string;
  label: string;
  desc?: string;
  valueLabel?: string;
  step?: number;
  min?: number;
  max?: number;
  fixed?: boolean; // قيمة غير قابلة للتعديل
  structural?: boolean; // ضمانة بنيوية في الكود — تعمل دائماً ولا يمكن تعطيلها
}

const RULES: RuleDef[] = [
  { key: 'symbol_lock', label: 'رمز الأصل المعتمد', desc: 'التداول على زوج XAUUSD حصراً — مضمون بنيوياً: خط البيانات الوحيد هو بث XAUUSD من طرفية MT5، لا يوجد أي مصدر آخر', valueLabel: 'XAUUSD', fixed: true, structural: true },
  { key: 'fixed_lot', label: 'حجم العقد واللوت الثابت', desc: 'التزام بلوت ثابت 0.01 في كل صفقة دون أي تغيير — الحجم الديناميكي أُزيل نهائياً (لا تغيير للوت: القاعدة 4)', valueLabel: 'لوت', step: 0.01, min: 0.01, max: 1 },
  { key: 'min_hold_min', label: 'الحد الأدنى لوقت الاحتفاظ', desc: 'لا إغلاق قسري (زمني أو أخبار) قبل مرور المدة — الوقف والهدف ينفذان في أي وقت دائماً', valueLabel: 'دقيقة', step: 1, min: 1, max: 60 },
  { key: 'max_hold_hours', label: 'الحد الأقصى لوقت الاحتفاظ', desc: 'إغلاق تلقائي بسعر السوق فور بلوغ المدة', valueLabel: 'ساعة', step: 1, min: 1, max: 24 },
  { key: 'max_daily_trades', label: 'الحد الأقصى لعدد الصفقات اليومية', desc: 'توقف تام عن فتح صفقات جديدة بعد بلوغ العدد — السقف الصلب المكتوب في الكود 30 صفقة/يوم: أي قيمة أعلى تُضبط تلقائياً إلى 30 (الهدف المعتمد 10 صفقات/يوم)', valueLabel: 'صفقة', step: 1, min: 1, max: 30 },
  { key: 'min_daily_trades_kpi', label: 'هدف الالتزام اليومي للصفقات', desc: 'مؤشر التزام لا يُفرض: نسبة الأيام التي بلغت هدف الصفقات اليومي الذي حددته (يستثني أيام التوقف)', valueLabel: 'صفقة', step: 1, min: 1, max: 10 },
  { key: 'daily_loss_stop', label: 'حد الخسارة اليومي الصارم', desc: 'إيقاف كامل عند بلوغ الخسارة (تُحسب من الـ Equity مع العائمة) — الحد الفعلي = الأصغر بين قيمتك والسقف الصلب 15% من الرصيد الأساسي (150$ عند 1000$)', valueLabel: '$', step: 5, min: 5, max: 500 },
  { key: 'daily_profit_stop', label: 'المستهدف الربحي اليومي', desc: 'إغلاق المنصة وحظر التداول الانتقامي عند تحقيق الربح', valueLabel: '$', step: 5, min: 5, max: 500 },
  { key: 'no_martingale', label: 'حظر المارتنجال والمضاعفات', desc: 'مضمون بنيوياً في الكود: اللوت ثابت أو محسوب من نسبة مخاطرة ثابتة — لا يوجد أي منطق مضاعفة بعد الخسارة، يعمل دائماً ولا يمكن تعطيله', structural: true },
  { key: 'single_trade', label: 'بروتوكول الصفقة النشطة الواحدة', desc: 'عند تفعيله: لا صفقة جديدة حتى إغلاق الحالية — عند تعطيله: تُسمح صفقات متوازية حتى الحد الأقصى للصفقات المفتوحة المتوازية' },
  { key: 'no_stacking_hedge', label: 'حظر الاستاكنج والتبريد والهيدج', desc: 'قيمة القاعدة = أقصى عدد صفقات متزامنة لنفس الاستراتيجية (مثال 3 = حتى 3 صفقات E معاً) — وفتح اتجاه معاكس محظور دائماً أثناء وجود صفقات مفتوحة (يُفحص لحظة التنفيذ). القيمة 0 = صفقة واحدة لكل استراتيجية كالسلوك الصارم القديم' },
  { key: 'mandatory_sl', label: 'إلزامية وقف الخسارة الفني', desc: 'مضمون بنيوياً في الكود: كل صفقة تولد بوقف محسوب قبل الدخول ولا يُحرّك ضد اتجاه الصفقة أبداً — لا يوجد أي مسار صفقة بلا وقف', structural: true },
  { key: 'sl_floor', label: 'حدود الوقف — الحد الأدنى', desc: 'إذا كان الوقف الفني أقل من هذه القيمة يُرفع إليها قبل الدخول', valueLabel: '$', step: 1, min: 1, max: 50 },
  { key: 'sl_cap', label: 'حدود الوقف — الحد الأقصى', desc: 'استراتيجية الأرقام المستديرة (E): إذا تجاوزت مسافة الوقف 15$ تُلغى الصفقة حرفياً وفق المواصفة المجمدة (لا تُضيّق)', valueLabel: '$', step: 1, min: 5, max: 100 },
  { key: 'max_concurrent', label: 'الحد الأقصى للصفقات المفتوحة المتوازية', desc: 'يعمل عند تعطيل بروتوكول الصفقة الواحدة — عدد الصفقات المفتوحة في نفس الوقت (السقف الصلب 8)', valueLabel: 'صفقة', step: 1, min: 1, max: 8 },
  // حُذفت نهائياً بأمر المالك («احذف وأزل كل ما يتعارض مع القواعد والاستراتيجيات»):
  // regime_filter و chop_filter و quality_gate و risk_sizing و spread_gate —
  // كلها شروط مضافة خارج المواصفة المجمدة كانت تمنع دخولات أمرت بها (القاعدة 1 و2).
  // ومجمّدة مطفأة في الدستور (FROZEN_FIELDS) فلا يمكن إعادة تفعيلها من أي واجهة.
  { key: 'tp_ratio', label: 'نسبة الهدف من الوقف', desc: 'الهدف بين 1:2 و1:3 — مفعّل دائماً (لا يمكن تعطيله)، يمكنك فقط تعديل النسبة. يحترمها المحرك في حساب هدف كل صفقة (settings.tpRatio)', valueLabel: '×', step: 1, min: 2, max: 3, structural: true },
  { key: 'scalp_type', label: 'نوع الصفقة: سكالب', desc: 'من 5 دقائق إلى 8 ساعات — مطبق دائماً عبر الحد الأدنى للاحتفاظ والحد الأقصى للاحتفاظ', fixed: true, valueLabel: 'سكالب', structural: true },
  { key: 'syria_day', label: 'يوم التداول بتوقيت سوريا', desc: 'من 00:00 إلى 00:00 — لا دخول بين 23:00 و00:00 وإغلاق كل الصفقات عند 00:00', fixed: true, valueLabel: 'UTC+3', structural: true },
  { key: 'fixed_base', label: 'الرصيد الأساسي للنسب المئوية', desc: 'حساب النسب يومياً/أسبوعياً/شهرياً على هذا الرصيد الثابت وليس الرصيد اللحظي', valueLabel: '$', step: 100, min: 100, max: 100000 },
  { key: 'winrate_gate', label: 'بوابة النشر (Win Rate)', desc: 'لا إعداد حي إلا بتحقيق نسبة نجاح كافية على العينة الخارجية بعد السبريد مع 100 صفقة+ ومتوسط R موجب', valueLabel: '%', step: 5, min: 50, max: 95 },
  { key: 'news_filter', label: 'فلتر الأخبار الاقتصادية القوية', desc: 'تقويم ForexFactory الحقيقي عالي التأثير (يُسحب تلقائياً كل 6 ساعات) — بلا أي مواعيد تقريبية أو مولّدة، وإن فشل السحب يتوقف الفلتر بدل استخدام مواعيد غير حقيقية', valueLabel: '' },
  { key: 'news_before_min', label: 'حظر ما قبل الخبر', desc: 'منع فتح صفقات قبل صدور الخبر بهذه المدة', valueLabel: 'دقيقة', step: 5, min: 5, max: 120 },
  { key: 'news_after_min', label: 'حظر ما بعد الخبر', desc: 'استمرار الحظر بعد صدور الخبر بهذه المدة', valueLabel: 'دقيقة', step: 5, min: 5, max: 240 },
  { key: 'news_close_min', label: 'إغلاق الصفقات قبل الخبر', desc: 'إغلاق أي صفقة مفتوحة بسعر السوق قبل الخبر بهذه المدة', valueLabel: 'دقيقة', step: 5, min: 5, max: 60 },
  { key: 'market_open_filter', label: 'فلتر افتتاح السوق الأسبوعي', desc: 'منع الدخول خلال أول هذه الدقائق من افتتاح الأسبوع (الأحد 01:00 سوريا — أول جلسة بعد الإغلاق الأسبوعي)', valueLabel: 'دقيقة', step: 15, min: 15, max: 240 },
  { key: 'market_close_filter', label: 'فلتر إغلاق السوق', desc: 'منع الدخول خلال آخر هذه الدقائق قبل إغلاق السوق (23:00)', valueLabel: 'دقيقة', step: 15, min: 15, max: 120 },
  { key: 'fixed_spread', label: 'احتساب السبريد الثابت', desc: 'سبريد قاطع في كل الباك تيست والاختبارات لتصفية النتائج', valueLabel: 'سنت', step: 5, min: 10, max: 100 },
  { key: 'mtf_analysis', label: 'التحليل متعدد الأطر الزمنية', desc: 'مضمون بنيوياً في الكود: الهيكل يجري دائماً على 1س/4س والاستراتيجيات على الأطر الأدنى — جزء من جوهر المحرك ولا يمكن تعطيله', structural: true },
];

export function GlobalRulesWindow() {
  const { settings, patchSettings, running, runBacktest } = useBot();

  const setRule = (key: string, patch: { enabled?: boolean; value?: number }) => {
    patchSettings(d => {
      d.globalRules[key] = { ...d.globalRules[key], ...patch };
    });
  };

  const setTpRatio = (v: number) => patchSettings(d => { d.tpRatio = v; });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
        <h2 className="text-[15px] font-bold text-[#d9b45c] mb-1">نافذة القواعد العليا وشروط إدارة التداول</h2>
        <p className="text-[11.5px] text-[#8a94a6] leading-relaxed">
          أي قاعدة مفعّلة تكتسب أولوية تنفيذ قصوى وتُطبق كقيد صارم: إذا خالفت الصفقة شرطاً واحداً من القواعد المفعلة
          تُلغى وتُحظر فوراً حتى لو توافقت مع استراتيجية أو مؤشر. الأولوية المطلقة للتقييد بالقواعد المفعلة.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {RULES.map((r, i) => {
          const rule = settings.globalRules[r.key] ?? { enabled: false };
          const isTp = r.key === 'tp_ratio';
          const val = isTp ? settings.tpRatio : rule.value;
          const isOn = r.structural ? true : rule.enabled;
          return (
            <div key={r.key} className={cn('rounded-xl border p-3.5', isOn ? 'border-[#d9b45c]/30 bg-[#d9b45c]/5' : 'border-[#1b2334] bg-[#0d1220]')}>
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 shrink-0 rounded-md bg-[#141a29] text-[#8a94a6] text-[10.5px] font-bold flex items-center justify-center border border-[#2a3550] mt-0.5">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold text-[#e9edf4] leading-snug">{r.label}</div>
                  {r.desc && <div className="text-[10.5px] text-[#8a94a6] mt-0.5 leading-relaxed">{r.desc}</div>}
                </div>
                {r.structural ? (
                  <span title="ضمانة بنيوية في الكود — تعمل دائماً ولا يمكن تعطيلها"
                    className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-[#d9b45c] border border-[#d9b45c]/40 bg-[#d9b45c]/10 rounded-md px-2 py-1">
                    <Lock className="w-3 h-3" />
                    دائمة
                  </span>
                ) : (
                  <Switch on={rule.enabled} onChange={v => setRule(r.key, { enabled: v })} />
                )}
              </div>
              {r.valueLabel !== undefined && (
                <div className="mt-2.5 mr-9 flex items-center gap-2">
                  {r.fixed ? (
                    <span className="text-[12px] font-mono font-bold text-[#d9b45c] px-2 py-1 rounded-md bg-[#141a29] border border-[#2a3550]">
                      {r.key === 'symbol_lock' ? 'XAUUSD' : r.key === 'scalp_type' ? '5د - 8س' : r.key === 'syria_day' ? '00:00 - 00:00' : (r.valueLabel ?? '')}
                    </span>
                  ) : (
                    <>
                      <Stepper
                        value={typeof val === 'number' ? val : 0}
                        step={r.step ?? 1}
                        min={r.min}
                        max={r.max}
                        onChange={v => isTp ? setTpRatio(v) : setRule(r.key, { value: v })}
                      />
                      <span className="text-[11px] text-[#8a94a6]">{r.valueLabel}</span>
                    </>
                  )}
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
      <span className="min-w-[64px] text-center font-mono font-bold text-[13px] text-[#e9edf4] py-1">{value}</span>
      <button onClick={inc} aria-label="رفع القيمة" className="w-8 h-8 flex items-center justify-center text-[#8a94a6] hover:text-[#d9b45c] hover:bg-[#141a29] text-[15px]">▴</button>
    </div>
  );
}
