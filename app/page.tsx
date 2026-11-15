'use client';

// BFX AURUM v18 — بوت الذهب XAUUSD وفق دليل هندسة الهيكل الفني
import { useEffect } from 'react';
import { useBot } from '@/components/bot/store';
import { TopBar } from '@/components/bot/TopBar';
import { Sidebar } from '@/components/bot/Sidebar';
import { Dashboard } from '@/components/bot/Dashboard';
import { TradesWindow } from '@/components/bot/TradesWindow';
import { AccountWindow } from '@/components/bot/AccountWindow';
import { SessionsWindow } from '@/components/bot/SessionsWindow';
import { PriorityWindow } from '@/components/bot/PriorityWindow';
import { GlobalRulesWindow } from '@/components/bot/GlobalRulesWindow';
import { IndicatorsWindow } from '@/components/bot/IndicatorsWindow';
import { BacktestWindow } from '@/components/bot/BacktestWindow';
import { LiveSignalsWindow } from '@/components/bot/LiveSignalsWindow';
import { ManualLevelsWindow } from '@/components/bot/ManualLevelsWindow';
import { TrainerWindow } from '@/components/bot/TrainerWindow';
import { VisitorsPanel } from '@/components/bot/VisitorsPanel';

export default function Home() {
  const { tab, loadSettings, loadLastRun, startSync, loaded } = useBot();

  useEffect(() => {
    loadSettings();
    loadLastRun();
    // حلقة المزامنة اللحظية: أي إجراء من أي مستخدم (إعدادات/باك تيست) يظهر عند الجميع تلقائياً
    startSync();
  }, [loadSettings, loadLastRun, startSync]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0a0e17]">
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
        ) : tab === 'dashboard' ? (
          // شاشة الشارت الواحدة: شارت علوي + تنبؤ أسفل + شريط قرار — بعرض كامل كالتيرمنال
          <main className="flex-1 min-w-0 min-h-0">
            <Dashboard />
          </main>
        ) : (
          <main className="flex-1 overflow-y-auto min-w-0 min-h-0">
            <div className="max-w-[1400px] mx-auto p-4 lg:p-6">
              {tab === 'trades' && <TradesWindow />}
              {tab === 'signals' && <LiveSignalsWindow />}
              {tab === 'trainer' && <TrainerWindow />}
              {tab === 'levels' && <ManualLevelsWindow />}
              {tab === 'account' && <AccountWindow />}
              {tab === 'sessions' && <SessionsWindow />}
              {tab === 'priority' && <PriorityWindow />}
              {tab === 'rules' && <GlobalRulesWindow />}
              {tab === 'indicators' && <IndicatorsWindow />}
              {tab === 'backtest' && <BacktestWindow />}
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
