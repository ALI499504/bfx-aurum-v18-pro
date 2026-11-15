'use client';

// نافذة المؤشرات الفنية والفلترة الديناميكية
import { useBot } from './store';
import { Switch } from './SessionsWindow';
import { Stepper } from './GlobalRulesWindow';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export function IndicatorsWindow() {
  const { settings, patchSettings, running, runBacktest, stats } = useBot();
  const ind = settings.indicators;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
        <h2 className="text-[15px] font-bold text-[#d9b45c] mb-1">بروتوكول نافذة المؤشرات الفنية والفلترة الديناميكية</h2>
        <p className="text-[11.5px] text-[#8a94a6] leading-relaxed">
          تُعرض المؤشرات كتعداد مرقم، وبجانب كل مؤشر زر تفعيل/إيقاف منفصل لحقنه أو سحبه من التحليل اللحظي.
        </p>
      </div>

      {/* المؤشر الأول: توقيت الجلسات */}
      <div className={cn('rounded-xl border p-4', ind.sessionTiming ? 'border-[#d9b45c]/30 bg-[#d9b45c]/5' : 'border-[#1b2334] bg-[#0d1220]')}>
        <div className="flex items-start gap-3">
          <span className="w-6 h-6 shrink-0 rounded-md bg-[#141a29] text-[#8a94a6] text-[10.5px] font-bold flex items-center justify-center border border-[#2a3550]">1</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-bold">مؤشر توقيت الجلسات والفلاتر الديناميكية (Session Timing)</div>
            <div className="text-[11px] text-[#8a94a6] leading-relaxed mt-1">
              يرصد التوقيت بالدقيقة ويرسم مستطيلات الجلسات الأربع على الشارت (آسيا، لندن، لندن ونيويورك، نيويورك).
              عند بدء جلسة آسيا تُفعّل الشروط الحسابية للاستراتيجيات الحصرية L وM وN، وعند انتهائها تُجمّد تلقائياً.
              كما يتحقق من توافق الاستراتيجيات العامة (A-J وO) مع الجلسات المفعلة في نافذة الجدولة،
              ويسجل قمة وقاع جلسة أمريكا السابقة عند افتتاح آسيا لتمريرهما للاستراتيجية M (بشرط تجاوز 250 بيب).
            </div>
          </div>
          <Switch on={ind.sessionTiming} onChange={v => patchSettings(d => { d.indicators.sessionTiming = v; })} />
        </div>
        <div className="mr-9 mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10.5px]">
          {[
            { l: 'آسيا', t: '01:00 - 10:00', c: '#3d7dd8' },
            { l: 'لندن', t: '10:00 - 15:00', c: '#d8a53d' },
            { l: 'لندن ونيويورك', t: '15:00 - 19:00', c: '#c2483d' },
            { l: 'نيويورك', t: '19:00 - 23:00', c: '#3dbd7d' },
          ].map(s => (
            <div key={s.l} className="rounded-lg border border-[#1b2334] px-2.5 py-2" style={{ backgroundColor: `${s.c}14` }}>
              <div className="font-bold" style={{ color: s.c }}>{s.l}</div>
              <div className="font-mono text-[#8a94a6]">{s.t} (سوريا)</div>
            </div>
          ))}
        </div>
      </div>

      {/* المؤشر الثاني: EMA */}
      <div className={cn('rounded-xl border p-4', ind.ema ? 'border-[#d9b45c]/30 bg-[#d9b45c]/5' : 'border-[#1b2334] bg-[#0d1220]')}>
        <div className="flex items-start gap-3">
          <span className="w-6 h-6 shrink-0 rounded-md bg-[#141a29] text-[#8a94a6] text-[10.5px] font-bold flex items-center justify-center border border-[#2a3550]">2</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-bold">مؤشر متوسطات الحركة الأسيّة (EMA على 1H و4H)</div>
            <div className="text-[11px] text-[#8a94a6] leading-relaxed mt-1">
              خط سريع وبطيء. التقاطع ذهبي صاعد يقلب فلتر الاتجاه إلى صاعد، وتقاطع هابط يقلبه إلى هابط.
              عند تشابك الخطين دون انفراج يُصنّف السوق تجميعاً ويتعطل حكم المتوسطات.
              عند التفعيل يكتسب المؤشر حكماً قاطعاً: تُحظر كل صفقة تعاكس اتجاه آخر تقاطع معتمد مهما بلغت دقة الاستراتيجية.
            </div>
          </div>
          <Switch on={ind.ema} onChange={v => patchSettings(d => { d.indicators.ema = v; })} />
        </div>
        <div className="mr-9 mt-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-[#8a94a6]">الخط السريع:</span>
            <Stepper value={ind.emaFast} step={1} min={5} max={100} onChange={v => patchSettings(d => { d.indicators.emaFast = v; })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-[#8a94a6]">الخط البطيء:</span>
            <Stepper value={ind.emaSlow} step={5} min={10} max={400} onChange={v => patchSettings(d => { d.indicators.emaSlow = v; })} />
          </div>
          {ind.ema && (
            <div className={cn('text-[11.5px] px-3 py-1.5 rounded-lg border',
              stats?.emaState === 'up' ? 'border-[#2ebd85]/40 text-[#2ebd85] bg-[#2ebd85]/10'
                : stats?.emaState === 'down' ? 'border-[#f6465d]/40 text-[#f6465d] bg-[#f6465d]/10'
                  : 'border-[#e8a33d]/40 text-[#e8a33d] bg-[#e8a33d]/10')}>
              الحالة الحالية: {stats?.emaState === 'up' ? 'صاعد (شراء فقط)' : stats?.emaState === 'down' ? 'هابط (بيع فقط)' : 'عرضي/تشابك (لا حكم)'}
            </div>
          )}
        </div>
        <div className="mr-9 mt-2 text-[10.5px] text-[#5a6474]">ملاحظة: المؤشر معطل افتراضياً في الاختبار الأول (وفق الدليل).</div>
      </div>

      <button onClick={() => { if (!running) runBacktest(); }} disabled={running}
        className="flex items-center gap-2 rounded-lg bg-[#d9b45c] hover:bg-[#e5c26e] disabled:opacity-60 text-[#0a0e17] font-bold text-[12.5px] px-5 py-2.5">
        {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
        {running ? 'جارٍ إعادة الاختبار...' : 'حفظ وإعادة تشغيل الباك تيست'}
      </button>
    </div>
  );
}
