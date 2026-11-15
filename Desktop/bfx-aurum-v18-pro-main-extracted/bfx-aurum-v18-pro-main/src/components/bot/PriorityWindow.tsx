'use client';

// نافذة سلم الأولويات — أربع لوحات سيادة للجلسات (الدليل ص77 حرفياً)
// أسهم [▲][▼] لكل بند + منطق السيادة الرقمية: المرتبة 1 تقمع ما دونها عند تداخل الخطوط
// بروتوكول العزل والقفل التلقائي (ص78 بند 5): أي استراتيجية معطلة من واجهتها
// تُسحب فوراً إلى أسفل القائمة برمز قفل مغلق وعلامة (غير مفعل) ولا تدخل المفاضلة.
import { useBot, STRATEGY_NAMES } from './store';
import { StrategyId, SESSION_AR } from '@/lib/engine/types';
import { SessionKey } from '@/lib/engine/tamsa-params';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, Lock, RefreshCw } from 'lucide-react';
import { useState } from 'react';

const TABS: { key: SessionKey; label: string }[] = [
  { key: 'asia', label: `سلم أولويات جلسة ${SESSION_AR.asia}` },
  { key: 'london', label: `سلم أولويات جلسة ${SESSION_AR.london}` },
  { key: 'londonNY', label: `سلم أولويات جلسة ${SESSION_AR.londonNY}` },
  { key: 'ny', label: `سلم أولويات جلسة ${SESSION_AR.ny} المنفردة` },
];

export function PriorityWindow() {
  const { settings, patchSettings, running, runBacktest } = useBot();
  const [tab, setTab] = useState<SessionKey>('asia');
  const ladder = (settings.priorityLadder?.[tab] ?? []) as StrategyId[];
  const params = (settings.strategyParams ?? {}) as unknown as Record<string, { enabled?: boolean }>;

  // بروتوكول العزل (ص78): المعطلة تُعرض أسفل القائمة مقفلة — عرض مشتق دون المساس بالترتيب المحفوظ
  const active = ladder.filter(s => params[s]?.enabled !== false);
  const disabled = ladder.filter(s => params[s]?.enabled === false);

  const move = (arr: StrategyId[], idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    patchSettings(d => {
      // إعادة بناء السلم الكامل: المفعّلة بترتيبها الجديد ثم المعطلة أسفلها
      const nextActive = [...active];
      [nextActive[idx], nextActive[j]] = [nextActive[j], nextActive[idx]];
      d.priorityLadder[tab] = [...nextActive, ...disabled] as StrategyId[];
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
        <h2 className="text-[15px] font-bold text-[#d9b45c] mb-1">نافذة سلم الأولويات وحل التعارضات (الدليل ص77–79)</h2>
        <p className="text-[11.5px] text-[#8a94a6] leading-relaxed">
          أربع لوحات سيادة منفصلة — واحدة لكل جلسة. البند في المرتبة رقم 1 يلغي فوراً ويقمع تفعيل كافة شروط البنود
          الأدنى عند تداخل خطوط السعر. تعطيل استراتيجية من واجهتها يسحبها تلقائياً إلى أسفل القائمة مقفلة.
        </p>
      </div>

      {/* التبويبات الأربعة */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('rounded-lg px-3.5 py-2 text-[12px] font-bold border transition-colors',
              tab === t.key ? 'bg-[#d9b45c]/15 border-[#d9b45c]/50 text-[#d9b45c]' : 'bg-[#0d1220] border-[#1b2334] text-[#8a94a6] hover:text-[#e9edf4]')}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {active.map((s, idx) => (
          <div key={s} className={cn('rounded-xl border p-3 flex gap-3 items-center',
            idx === 0 ? 'border-[#d9b45c]/40 bg-[#d9b45c]/5' : 'border-[#1b2334] bg-[#0d1220]')}>
            <div className={cn('w-9 h-9 shrink-0 rounded-lg flex items-center justify-center font-black text-[15px] border',
              idx === 0 ? 'bg-[#d9b45c]/20 text-[#d9b45c] border-[#d9b45c]/50'
                : 'bg-[#141a29] text-[#8a94a6] border-[#2a3550]')}>
              {idx + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-[#e9edf4]">
                <span className="text-[#d9b45c] font-black">[{s}]</span> — {STRATEGY_NAMES[s]}
              </div>
              {idx === 0 && <div className="text-[10.5px] text-[#d9b45c]/80 mt-0.5">سيادة مطلقة عند التداخل في هذه الجلسة</div>}
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <button onClick={() => move(active, idx, -1)} disabled={idx === 0} aria-label="رفع الترتيب"
                className="w-8 h-8 rounded-md border border-[#2a3550] flex items-center justify-center text-[#8a94a6] hover:text-[#d9b45c] hover:border-[#d9b45c]/50 disabled:opacity-30">
                <ChevronUp className="w-4 h-4" />
              </button>
              <button onClick={() => move(active, idx, 1)} disabled={idx === active.length - 1} aria-label="خفض الترتيب"
                className="w-8 h-8 rounded-md border border-[#2a3550] flex items-center justify-center text-[#8a94a6] hover:text-[#d9b45c] hover:border-[#d9b45c]/50 disabled:opacity-30">
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}

        {/* البنود المنسحبة تلقائياً أسفل السلم — معطلة من واجهتها (ص78 بند 5: رمز القفل + غير مفعل) */}
        {disabled.length > 0 && (
          <div className="pt-1">
            <div className="text-[10.5px] font-bold text-[#5a6474] tracking-wider px-1 pb-1.5">بنود معطلة — مقفلة أسفل السلم (لا تدخل المفاضلة)</div>
            {disabled.map(s => (
              <div key={s} className="rounded-xl border border-[#1b2334]/50 bg-[#0a0e17] p-3 flex gap-3 items-center opacity-60">
                <div className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center border border-[#2a3550] bg-[#101726] text-[#3d4a63]">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold text-[#5a6474]">
                    <span className="font-black">[{s}]</span> — {STRATEGY_NAMES[s]}
                  </div>
                  <div className="text-[10.5px] text-[#3d4a63] mt-0.5">غير مفعل — أعِد تفعيله من واجهة الاستراتيجيات لتحريكه</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* منطق حل التعارضات — البنود الثلاثة حرفياً */}
      <div className="rounded-xl border border-[#1b2334] bg-[#101726] p-4 space-y-2 text-[11.5px] leading-relaxed">
        <div className="text-[#d9b45c] font-bold text-[12.5px]">بنود المنطق الرياضي لحل التعارضات (ص78–79):</div>
        <div className="text-[#8a94a6]"><span className="text-[#c8d0dd] font-bold">البند الأول:</span> استراتيجيتان بنفس الاتجاه والمسافة أقل من 100 بيب → دمج في منطقة اهتمام موحدة: صفقة واحدة عند خط الأقرب للسعر، والوقف خلف مستوى الأبعد بـ50 بيب، والهدف من الاستراتيجية المنفذة.</div>
        <div className="text-[#8a94a6]"><span className="text-[#c8d0dd] font-bold">البند الثاني:</span> نفس الاتجاه والمسافة ≥100 بيب → سيادة الرتبة الأعلى في سلم الجلسة: تُنفذ الأعلى فور ملامستها ويُحذف أمر الأدنى لهذا اليوم.</div>
        <div className="text-[#8a94a6]"><span className="text-[#c8d0dd] font-bold">البند الثالث:</span> اتجاهان متعاكسان في نفس المنطقة → سيادة الرتبة الأعلى: تُنفذ صفتها فوراً وتُقمع المعاكسة كلياً وتُعتبر لم تكن.</div>
        <div className="text-[#8a94a6]">كل فرصة أُلغيت بحل النزاعات تُعتبر مستهلكة وميتة لهذا النطاق ولا تُفعّل إلا بمستويات جديدة كلياً.</div>
      </div>

      {/* زر تثبيت أولويات الجلسة (ص77 بند 6) */}
      <div className="flex items-center gap-3">
        <button onClick={() => { if (!running) runBacktest(); }} disabled={running}
          className="flex items-center gap-2 rounded-lg bg-[#d9b45c] hover:bg-[#e5c26e] disabled:opacity-60 text-[#0a0e17] font-bold text-[12.5px] px-5 py-2.5">
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
          تثبيت أولويات جلسة {SESSION_AR[tab]} وإعادة الاختبار
        </button>
      </div>
    </div>
  );
}
