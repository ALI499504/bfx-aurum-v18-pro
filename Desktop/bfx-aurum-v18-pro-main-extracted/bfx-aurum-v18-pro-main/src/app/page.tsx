'use client';

// BFX AURUM v18 — بوت الذهب XAUUSD وفق دليل هندسة الهيكل الفني
import { useEffect } from 'react';
import { useBot } from '@/components/bot/store';
import { TopBar } from '@/components/bot/TopBar';
import { Sidebar } from '@/components/bot/Sidebar';
import { Dashboard } from '@/components/bot/Dashboard';
import { TradesWindow } from '@/components/bot/TradesWindow';
import { AccountWindow } from '@/components/bot/AccountWindow';
import { BacktestWindow } from '@/components/bot/BacktestWindow';
import { BasketWindow } from '@/components/bot/BasketWindow';
import { LiveSignalsWindow } from '@/components/bot/LiveSignalsWindow';
import { SessionsWindow } from '@/components/bot/SessionsWindow';
import { PriorityWindow } from '@/components/bot/PriorityWindow';
import { GlobalRulesWindow } from '@/components/bot/GlobalRulesWindow';
import { IndicatorsWindow } from '@/components/bot/IndicatorsWindow';
import { StrategiesWindow } from '@/components/bot/StrategiesWindow';
import { AutoTuneWindow } from '@/components/bot/AutoTuneWindow';
import { TrainerWindow } from '@/components/bot/TrainerWindow';
import { ManualLevelsWindow } from '@/components/bot/ManualLevelsWindow';
import { JarvisCore } from '@/components/bot/JarvisCore';
import { VisitorsPanel } from '@/components/bot/VisitorsPanel';
import { TradeSound } from '@/components/bot/TradeSound';
import { JARVIS_SECTION_CLOSED } from '@/lib/jarvis-flag';

export default function Home() {
  const { tab, loadSettings, loadLastRun, startSync, loaded } = useBot();

  // قسم «جارفس — القلب النابض» مغلق بقرار المالك: أي تاب «jarvis» متبقٍ يُحوّل
  // إلى لوحة القيادة — الدخول والاستخدام يبقيان شغالين بشكل طبيعي
  const activeTab = JARVIS_SECTION_CLOSED && tab === 'jarvis' ? 'dashboard' : tab;

  useEffect(() => {
    loadSettings();
    loadLastRun();
    // حلقة المزامنة اللحظية: أي إجراء من أي مستخدم (إعدادات/باك تيست) يظهر عند الجميع تلقائياً
    startSync();
  }, [loadSettings, loadLastRun, startSync]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0a0e17]">
      {/* التنبيه الصوتي لدخول الصفقات — حارس صامت عام يعمل على كل التبويبات */}
      <TradeSound />

      {/* لوحة الزوار الصغيرة — عائمة، لا تؤثر على التخطيط */}
      <VisitorsPanel />

      {/* الشريط العلوي الرسمي */}
      <TopBar />

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* الشاشة الجانبية (يمين في RTL) */}
        <Sidebar />

        {!loaded ? (
          <main className="flex-1 min-w-0 min-h-0 flex items-center justify-center text-[#8a94a6] text-sm">
            جارٍ تهيئة البوت...
          </main>
        ) : activeTab === 'jarvis' ? (
          // جارفس — القلب النابض: طبقة كاملة بملء الشاشة (fixed inset-0) — تتحكم في تخطيطها بنفسها
          <JarvisCore />
        ) : activeTab === 'dashboard' ? (
          // شاشة الشارت الواحدة: شارت علوي + تنبؤ أسفل + شريط قرار — بعرض كامل كالتيرمنال
          <main className="flex-1 min-w-0 min-h-0">
            <Dashboard />
          </main>
        ) : (
          <main className="flex-1 overflow-y-auto min-w-0 min-h-0">
            <div className="max-w-[1400px] mx-auto p-4 lg:p-6">
              {activeTab === 'trades' && <TradesWindow />}
              {activeTab === 'autotune' && <AutoTuneWindow />}
              {activeTab === 'signals' && <LiveSignalsWindow />}
              {activeTab === 'account' && <AccountWindow />}
              {activeTab === 'backtest' && <BacktestWindow />}
              {activeTab === 'basket' && <BasketWindow />}
              {activeTab === 'strategies' && <StrategiesWindow />}
              {activeTab === 'sessions' && <SessionsWindow />}
              {activeTab === 'priority' && <PriorityWindow />}
              {activeTab === 'rules' && <GlobalRulesWindow />}
              {activeTab === 'indicators' && <IndicatorsWindow />}
              {activeTab === 'trainer' && <TrainerWindow />}
              {activeTab === 'levels' && <ManualLevelsWindow />}
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
