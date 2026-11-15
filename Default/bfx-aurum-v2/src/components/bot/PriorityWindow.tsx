'use client';

// نافذة سلم الأولويات — إعادة الترتيب الديناميكية لحل التعارضات
import { useBot, PRIORITY_ITEMS } from './store';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';

export function PriorityWindow() {
  const { settings, patchSettings, running, runBacktest } = useBot();
  const items = settings.priority;

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    patchSettings(d => {
      const arr = [...d.priority];
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      d.priority = arr;
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
        <h2 className="text-[15px] font-bold text-[#d9b45c] mb-1">لوحة سلم الأولويات وحل النزاعات السعرية</h2>
        <p className="text-[11.5px] text-[#8a94a6] leading-relaxed">
          البند المتواجد في المرتبة رقم 1 يُطبَّق أولاً ويلغي شروط البنود التي تقع أسفله عند التداخل.
          استخدم الأسهم [▲][▼] لإعادة ترتيب أولوية التنفيذ في عقل البوت.
        </p>
      </div>

      <div className="space-y-3">
        {items.map((key, idx) => {
          const item = PRIORITY_ITEMS[key];
          if (!item) return null;
          return (
            <div key={key} className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4 flex gap-3 items-start">
              <div className={cn('w-9 h-9 shrink-0 rounded-lg flex items-center justify-center font-black text-[15px] border',
                idx === 0 ? 'bg-[#d9b45c]/20 text-[#d9b45c] border-[#d9b45c]/50'
                  : idx === 1 ? 'bg-[#e8a33d]/15 text-[#e8a33d] border-[#e8a33d]/40'
                    : 'bg-[#141a29] text-[#8a94a6] border-[#2a3550]')}>
                {idx + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-bold text-[#e9edf4] mb-1">{item.title}</div>
                <div className="text-[11.5px] text-[#8a94a6] leading-relaxed">{item.desc}</div>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="رفع الترتيب"
                  className="w-8 h-8 rounded-md border border-[#2a3550] flex items-center justify-center text-[#8a94a6] hover:text-[#d9b45c] hover:border-[#d9b45c]/50 disabled:opacity-30">
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button onClick={() => move(idx, 1)} disabled={idx === items.length - 1} aria-label="خفض الترتيب"
                  className="w-8 h-8 rounded-md border border-[#2a3550] flex items-center justify-center text-[#8a94a6] hover:text-[#d9b45c] hover:border-[#d9b45c]/50 disabled:opacity-30">
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-[#1b2334] bg-[#101726] p-4">
        <div className="text-[12px] text-[#8a94a6] leading-relaxed">
          <span className="text-[#d9b45c] font-bold">السلم الزمني للأفضلية (ضمن بروتوكول الصفقة النشطة الواحدة):</span>{' '}
          (1) D و K و F و H ← (2) C و E و J ← (3) A و B و G و I و O ← (4) L و M و N.
          عند تساوي المستوى تُقدَّم المؤكدة بفيبوناتشي أو كسر هيكلي، ثم الأقرب للسعر.
        </div>
      </div>

      <button onClick={() => { if (!running) runBacktest(); }} disabled={running}
        className="flex items-center gap-2 rounded-lg bg-[#d9b45c] hover:bg-[#e5c26e] disabled:opacity-60 text-[#0a0e17] font-bold text-[12.5px] px-5 py-2.5">
        {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
        {running ? 'جارٍ إعادة الاختبار...' : 'حفظ وإعادة تشغيل الباك تيست'}
      </button>
    </div>
  );
}
