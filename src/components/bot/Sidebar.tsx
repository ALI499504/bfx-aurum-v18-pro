'use client';

// الشاشة الجانبية — نافذة التنقل وحالة المحرك
import { useBot } from './store';
import { JARVIS_SECTION_CLOSED } from '@/lib/jarvis-flag';
import { cn } from '@/lib/utils';
import { Activity, BarChart3, Crosshair, Gauge, GraduationCap, Layers, LayoutDashboard, LineChart, ListOrdered, Radar, ReceiptText, RefreshCw, ShieldCheck, Sparkles, Wallet } from 'lucide-react';

// تبويبات نظام TAMSA الكامل — وفق ملف XAU-TAMSA7.pdf
const TABS = [
  { id: 'dashboard', label: 'لوحة القيادة', sub: 'الشارت الحقيقي MT5 كامل الشاشة', icon: LayoutDashboard },
  { id: 'autotune', label: 'الضبط الذاتي', sub: 'بحث شبكي + مدير آلي بالأداء', icon: Sparkles },
  { id: 'strategies', label: 'الاستراتيجيات A–W', sub: 'الشجرة الآلية (بلا تحكم يدوي)', icon: Radar },
  { id: 'signals', label: 'الإشارات الحية', sub: 'دخول فوري لحظة اكتمال الشروط', icon: Crosshair },
  { id: 'trainer', label: 'المدرب الذكي', sub: 'تقرير أداء + مقترحات بالأرقام', icon: GraduationCap },
  { id: 'levels', label: 'المستويات اليدوية', sub: 'تعليماتك المباشرة للبوت', icon: Activity },
  { id: 'trades', label: 'سجل الصفقات', sub: 'كل صفقة بتقرير وشارت', icon: ReceiptText },
  { id: 'account', label: 'حسابي', sub: 'الرصيد ومنحنى النمو', icon: Wallet },
  { id: 'backtest', label: 'الباك تيست والتقارير', sub: 'اختبار على شموع MT5 الحقيقية', icon: BarChart3 },
  { id: 'basket', label: 'السلة المعتمدة', sub: 'محفظة الظل على أساس 1000$', icon: Layers },
  { id: 'sessions', label: 'جدولة الجلسات', sub: 'بوابات آلية بالأداء المقاس', icon: LineChart },
  { id: 'priority', label: 'سلم الأولويات', sub: '4 لوحات جلسات + حل النزاعات', icon: ListOrdered },
  { id: 'rules', label: 'القواعد العليا', sub: 'إدارة المخاطر الحاكمة (21 قاعدة)', icon: ShieldCheck },
  { id: 'indicators', label: 'المؤشرات الفنية', sub: 'الجلسات + EMA 20/90', icon: Gauge },
];

// قسم «جارفس — القلب النابض» مغلق بقرار المالك — التبويب يختفي من القائمة
// وتنابق بقية أقسام البوت تعمل بشكل طبيعي (إعادة الفتح: jarvis-flag.ts)
const VISIBLE_TABS = JARVIS_SECTION_CLOSED ? TABS.filter(t => t.id !== 'jarvis') : TABS;

export function Sidebar() {
  const { tab, setTab, stats, running, runBacktest, dirty, saving } = useBot();

  const trend = stats?.finalStructure?.trend1h;

  return (
    <aside className="w-full lg:w-[264px] shrink-0 border-l border-[#1b2334] bg-[#0c111d] flex flex-col lg:h-full max-h-[45vh] lg:max-h-none overflow-y-auto">
      {/* التنقل */}
      <nav className="p-2.5 flex-1">
        <div className="text-[9px] font-bold text-[#5a6474] tracking-wider px-2 pt-1 pb-2">التنقل</div>
        {VISIBLE_TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'relative w-full text-right flex items-start gap-3 rounded-lg px-3 py-2.5 mb-0.5 transition-colors border',
                active
                  ? 'bg-gradient-to-l from-[#d9b45c]/14 to-[#d9b45c]/4 border-[#d9b45c]/35'
                  : 'border-transparent hover:bg-[#141a29]'
              )}
            >
              {active && <span className="absolute inset-y-2 right-0 w-[2.5px] rounded-full bg-[#d9b45c]" />}
              <Icon className={cn('mt-0.5 shrink-0', active ? 'text-[#d9b45c]' : 'text-[#8a94a6]')} size={17} />
              <span className="min-w-0">
                <span className={cn('block text-[12.5px] font-bold', active ? 'text-[#d9b45c]' : 'text-[#e9edf4]')}>{t.label}</span>
                <span className="block text-[10px] text-[#8a94a6] truncate mt-px">{t.sub}</span>
              </span>
            </button>
          );
        })}
      </nav>

      {/* حالة المحرك */}
      <div className="p-3 border-t border-[#1b2334] space-y-2 bg-[#0d1220]">
        <div className="text-[9px] font-bold text-[#5a6474] tracking-wider px-1">حالة المحرك</div>
        <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[10.5px]">
            <span className="text-[#8a94a6]">اتجاه 1H</span>
            <span className={cn('font-bold', trend === 'up' ? 'text-[#2ebd85]' : trend === 'down' ? 'text-[#f6465d]' : 'text-[#8a94a6]')}>
              {trend === 'up' ? 'صاعد ▲' : trend === 'down' ? 'هابط ▼' : 'عرضي ◆'}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10.5px]">
            <span className="text-[#8a94a6]">اتجاه 4H</span>
            <span className={cn('font-bold',
              stats?.finalStructure?.trend4h === 'up' ? 'text-[#2ebd85]' : stats?.finalStructure?.trend4h === 'down' ? 'text-[#f6465d]' : 'text-[#8a94a6]')}>
              {stats?.finalStructure?.trend4h === 'up' ? 'صاعد ▲' : stats?.finalStructure?.trend4h === 'down' ? 'هابط ▼' : 'عرضي ◆'}
            </span>
          </div>
          {stats && (
            <div className="flex items-center justify-between text-[10.5px]">
              <span className="text-[#8a94a6]">صافي الباك تيست</span>
              <span className={cn('font-mono font-bold', stats.netPnl >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>
                {stats.netPnl >= 0 ? '+' : ''}{stats.netPnl.toFixed(2)}$
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => { if (!running) runBacktest(); }}
          disabled={running}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-l from-[#e8c66f] to-[#d9b45c] hover:from-[#f0d283] hover:to-[#e5c26e] disabled:opacity-60 text-[#0a0e17] font-black text-[12px] py-2.5 shadow-[0_2px_12px_rgba(217,180,92,0.25)] transition-all"
        >
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Gauge className="w-4 h-4" />}
          {running ? 'جارٍ إعادة الاختبار...' : 'تحديث وإعادة الاختبار'}
        </button>
        <div className="text-center text-[9.5px] text-[#5a6474]">
          {dirty ? 'هناك تعديلات غير محفوظة...' : saving ? 'جارٍ الحفظ...' : 'الإعدادات محفوظة تلقائياً'}
        </div>
      </div>
    </aside>
  );
}
