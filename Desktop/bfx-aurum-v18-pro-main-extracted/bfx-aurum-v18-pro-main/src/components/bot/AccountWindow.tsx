'use client';

// حسابي — الحساب الحقيقي من طرفية MT5 (رصيد/حقوق ملكية/هامش) + التقييم التاريخي على شموع حقيقية
import { useEffect, useMemo, useState } from 'react';
import { useBot } from './store';
import { EquityChart } from './EquityChart';
import { cn } from '@/lib/utils';
import { Wallet, RefreshCw, ShieldCheck, Target, CalendarDays, TrendingUp, RadioTower } from 'lucide-react';

interface LiveAccount {
  connected: boolean;
  symbol?: string; broker?: string | null;
  bridgeV?: number | null;
  account?: {
    login?: string; server?: string; company?: string; currency?: string; leverage?: number;
    balance?: number; equity?: number; margin?: number; marginFree?: number;
    marginLevel?: number; profit?: number;
  };
  openTrades?: { floating: number }[];
  closedTrades?: { profit: number }[];
  updatedAt?: number | null;
}

export function AccountWindow() {
  const { stats, trades, runBacktest, running } = useBot();
  const [live, setLive] = useState<LiveAccount | null>(null);

  // الحساب الحقيقي من طرفية MT5 — تحديث كل 5 ثوانٍ
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/mt5/account', { cache: 'no-store' });
        if (!r.ok || !alive) return;
        const j = await r.json();
        if (alive) setLive(j);
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // منحنى الأسهم من المحرك (كامل ومصغّر) — وإن لم يتوفر يُبنى من الصفقات المعروضة
  const equity = useMemo(() => {
    if (stats?.equity?.length) return stats.equity;
    if (!trades.length) return [];
    const base = stats?.baseBalance ?? 1000;
    const sorted = [...trades].sort((a, b) => a.exitT - b.exitT);
    const pts: { t: number; v: number }[] = [{ t: sorted[0].entryT - 3600e3, v: base }];
    let bal = base;
    for (const t of sorted) { bal += t.pnl; pts.push({ t: t.exitT, v: bal }); }
    return pts;
  }, [trades, stats]);

  const acc = live?.account;
  const cur = acc?.currency ?? 'USD';
  const openCount = live?.openTrades?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* ======== الحساب الحقيقي من MT5 ======== */}
      {live?.connected && acc && typeof acc.balance === 'number' ? (
        <div className="rounded-xl border border-[#2ebd85]/30 bg-gradient-to-l from-[#0d1220] to-[#0f1a17] p-4">
          <div className="flex flex-wrap items-center gap-2.5 mb-3">
            <div className="w-9 h-9 rounded-lg bg-[#2ebd85]/12 border border-[#2ebd85]/30 flex items-center justify-center">
              <RadioTower className="w-4.5 h-4.5 text-[#2ebd85]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-bold">حسابك الحقيقي في MetaTrader 5</h2>
                <span className="text-[9px] font-black text-[#0a0e17] bg-[#2ebd85] rounded px-1.5 py-px">مباشر — حقيقي 100%</span>
              </div>
              <p className="text-[10.5px] text-[#8a94a6]">
                {acc.company || live.broker || 'وسيط MT5'} · حساب {acc.login} · سيرفر {acc.server} · رافعة 1:{acc.leverage}
              </p>
            </div>
            <div className="mr-auto text-left">
              <div className="text-[9.5px] text-[#8a94a6]">حقوق الملكية (Equity)</div>
              <div className={cn('font-mono font-black text-[22px] leading-tight',
                (acc.equity ?? 0) >= (acc.balance ?? 0) ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>
                {(acc.equity ?? 0).toFixed(2)}<span className="text-[12px] text-[#8a94a6]"> {cur}</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Stat icon={<Wallet className="w-3.5 h-3.5" />} label="الرصيد الحقيقي" value={`${(acc.balance ?? 0).toFixed(2)} ${cur}`} />
            <Stat icon={<TrendingUp className="w-3.5 h-3.5" />} label="الربح العائم" value={`${(acc.profit ?? 0) >= 0 ? '+' : ''}${(acc.profit ?? 0).toFixed(2)} ${cur}`}
              cls={(acc.profit ?? 0) >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'} sub={`${openCount} صفقة مفتوحة`} />
            <Stat label="الهامش المستخدم" value={`${(acc.margin ?? 0).toFixed(2)} ${cur}`} />
            <Stat label="الهامش الحر" value={`${(acc.marginFree ?? 0).toFixed(2)} ${cur}`} />
            <Stat label="مستوى الهامش" value={acc.marginLevel ? `${acc.marginLevel.toFixed(1)}%` : '—'}
              cls={acc.marginLevel && acc.marginLevel < 200 ? 'text-[#e8a33d]' : 'text-[#e9edf4]'} />
            <Stat label="صفقات مغلقة (60ي)" value={`${live.closedTrades?.length ?? 0}`}
              sub={`صافي ${(live.closedTrades ?? []).reduce((s, t) => s + t.profit, 0).toFixed(2)}$`} />
          </div>
        </div>
      ) : live?.connected ? (
        <div className="rounded-xl border border-[#e8a33d]/40 bg-[#e8a33d]/10 p-4 flex items-start gap-3">
          <RadioTower className="w-5 h-5 text-[#e8a33d] shrink-0 mt-0.5" />
          <div>
            <p className="text-[12.5px] font-bold text-[#e8a33d] mb-1">
              {(live.bridgeV ?? 0) >= 18
                ? 'الجسر v18 متصل ويدفع شموعك الحقيقية — بطاقة الحساب تظهر خلال لحظات'
                : 'الجسر متصل — لكن نسخة أقدم لا تبث بيانات الحساب والصفقات'}
            </p>
            <p className="text-[12px] text-[#8a94a6] leading-relaxed">
              {(live.bridgeV ?? 0) >= 18
                ? 'قراءة الحساب مؤجلة لحظياً لأن الطرفية مشغولة بتحميل التاريخ العميق — الجسر يرسل تلقائياً آخر قراءة ناجحة (حقيقية 100%) وستعود البطاقة كاملة فور انفراج الطرفية. لا تدخل مطلوب منك.'
                : 'أعد تنفيذ أمر CMD نفسه على جهازك (نفس الأمر السابق تماماً) — سيحمّل تلقائياً الجسر المحدّث v18 الذي يبث رصيدك الحقيقي وحقوق الملكية والهامش وصفقاتك المفتوحة وسجل صفقاتك المنفذة، وتظهر هنا فوراً.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[#2a3550] bg-[#0d1220]/60 p-4 flex items-center gap-3">
          <RadioTower className="w-5 h-5 text-[#2a3550] shrink-0" />
          <p className="text-[12px] text-[#8a94a6] leading-relaxed">
            بطاقة الحساب الحقيقي (الرصيد وحقوق الملكية والهامش) تظهر تلقائياً عند تشغيل جسر MT5 على جهازك —
            البطاقة تعرض أرقام وسيطك مباشرة دون أي محاكاة.
          </p>
        </div>
      )}

      {/* ======== التقييم التاريخي (باك تيست على شموع حقيقية) ======== */}
      <div className="flex items-center gap-2 pt-1">
        <span className="text-[10px] font-bold text-[#5a6474] tracking-wider">التقييم التاريخي للبوت على شموع XAUUSD الحقيقية</span>
        <span className="flex-1 h-px bg-[#1b2334]" />
      </div>

      {!stats ? (
        <div className="rounded-xl border border-dashed border-[#2a3550] bg-[#0d1220]/60 py-16 flex flex-col items-center gap-3">
          <Wallet className="w-10 h-10 text-[#2a3550]" />
          <p className="text-[13px] text-[#8a94a6]">لا يوجد تقييم بعد — شغّل محرك الاختبار على بيانات MT5 الحقيقية لبناء منحنى الحساب</p>
          <button onClick={() => { if (!running) runBacktest(); }} disabled={running}
            className="flex items-center gap-2 rounded-lg bg-[#d9b45c] hover:bg-[#e5c26e] disabled:opacity-60 text-[#0a0e17] font-bold text-[12.5px] px-4 py-2 transition-colors">
            {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
            {running ? 'جارٍ الاختبار...' : 'تشغيل الاختبار الآن'}
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-[#1b2334] bg-gradient-to-l from-[#0d1220] to-[#101726] p-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-[#d9b45c]/12 border border-[#d9b45c]/30 flex items-center justify-center">
                <Wallet className="w-4.5 h-4.5 text-[#d9b45c]" />
              </div>
              <div>
                <h2 className="text-[15px] font-bold">حساب التقييم — باك تيست حقيقي</h2>
                <p className="text-[10.5px] text-[#8a94a6]">
                  اختبار على شموع XAUUSD الحقيقية القادمة من طرفيتك من {new Date(stats.startT).toISOString().slice(0, 10)} إلى {new Date(stats.endT).toISOString().slice(0, 10)}
                </p>
              </div>
              <span className={cn('mr-auto font-mono font-black text-[22px]', stats.netPnl >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>
                {stats.netPnl >= 0 ? '+' : ''}{stats.netPnl.toFixed(2)}$
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat icon={<Wallet className="w-3.5 h-3.5" />} label="الرصيد الابتدائي" value={`${stats.baseBalance.toFixed(2)}$`} />
            <Stat icon={<TrendingUp className="w-3.5 h-3.5" />} label="الرصيد النهائي" value={`${stats.finalBalance.toFixed(2)}$`} cls={stats.netPnl >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'} />
            <Stat icon={<TrendingUp className="w-3.5 h-3.5" />} label="نمو الحساب" value={`${((stats.finalBalance - stats.baseBalance) / stats.baseBalance * 100) >= 0 ? '+' : ''}${((stats.finalBalance - stats.baseBalance) / stats.baseBalance * 100).toFixed(1)}%`} cls={stats.netPnl >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'} />
            <Stat icon={<ShieldCheck className="w-3.5 h-3.5" />} label="أقصى تراجع" value={`${stats.maxDrawdown.toFixed(2)}$ (${stats.maxDrawdownPct.toFixed(1)}%)`} cls="text-[#e8a33d]" />
            <Stat label="عدد الصفقات" value={`${stats.totalTrades}`} />
            <Stat label="معدل النجاح" value={`${stats.winRate.toFixed(1)}%`} sub={`${stats.wins}ر / ${stats.losses}خ`} />
            <Stat label="عامل الربح" value={stats.profitFactor.toFixed(2)} />
            <Stat label="اللوت / السبريد" value={`${stats.lot} / ${stats.spreadCents}¢`} />
          </div>

          {/* منحنى النمو */}
          <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#1b2334] bg-[#101726] flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#d9b45c]" />
              <h3 className="text-[13px] font-bold">منحنى نمو الحساب</h3>
              <span className="text-[10px] text-[#8a94a6] mr-auto">الخط الرمادي المتقطع = الرصيد الابتدائي</span>
            </div>
            <div className="h-[300px]">
              {equity.length > 1
                ? <EquityChart points={equity} base={stats.baseBalance} />
                : <div className="w-full h-full flex items-center justify-center text-[#8a94a6] text-sm">لا توجد بيانات كافية للرسم</div>}
            </div>
            {stats.totalTrades > trades.length && (
              <div className="px-4 py-2 border-t border-[#1b2334] text-[10px] text-[#5a6474]">
                منحنى النمو مبني على كل الصفقات ({stats.totalTrades}) — قائمة العرض تعرض آخر {trades.length} صفقة فقط
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* الأداء الشهري */}
            <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#1b2334] bg-[#101726] flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-[#d9b45c]" />
                <h3 className="text-[13px] font-bold">الأداء الشهري</h3>
              </div>
              <div className="p-3 space-y-1.5 max-h-[280px] overflow-y-auto">
                {stats.monthly.map(m => (
                  <MonthRow key={m.month} month={m.month} net={m.net} pct={m.pct} />
                ))}
              </div>
            </div>

            {/* بوابة الجودة + أفضل/أسوأ */}
            <div className="space-y-4">
              <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck className="w-4 h-4 text-[#d9b45c]" />
                  <h3 className="text-[13px] font-bold">بوابة الجودة (خارج العينة OOS)</h3>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <span className={cn('text-[11px] font-bold px-2 py-1 rounded-md border',
                    !stats.oos.gateEnabled ? 'text-[#8a94a6] border-[#2a3550] bg-[#141a29]'
                      : stats.oos.gatePass ? 'text-[#2ebd85] border-[#2ebd85]/40 bg-[#2ebd85]/10' : 'text-[#f6465d] border-[#f6465d]/40 bg-[#f6465d]/10')}>
                    {!stats.oos.gateEnabled ? 'البوابة معطلة (من إعداداتك)' : stats.oos.gatePass ? 'ناجح ✓' : 'راسب ✗'}
                  </span>
                  <span className="text-[11px] text-[#8a94a6]">
                    {stats.oos.trades} صفقة خارج العينة · متوسط R = {stats.oos.avgR.toFixed(2)}{stats.oos.gateEnabled ? ` (العتبة ${stats.oos.threshold})` : ' — الأرقام للعرض فقط'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-[#d9b45c]" />
                  <span className="text-[11px] text-[#8a94a6]">
                    أيام فيها صفقتان أو أكثر: {stats.dailyKpi.pct}% (المستهدف {stats.dailyKpi.target}% — مستثنى توقف يومي: {stats.dailyKpi.excludedStopDays})
                  </span>
                </div>
              </div>

              {trades.length > 0 && (() => {
                const best = [...trades].sort((a, b) => b.pnl - a.pnl)[0];
                const worst = [...trades].sort((a, b) => a.pnl - b.pnl)[0];
                return (
                  <div className="grid grid-cols-2 gap-3">
                    <BestWorst title="أفضل صفقة" pnl={best.pnl} id={best.id} cls="text-[#2ebd85]" />
                    <BestWorst title="أسوأ صفقة" pnl={worst.pnl} id={worst.id} cls="text-[#f6465d]" />
                  </div>
                );
              })()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MonthRow({ month, net, pct }: { month: string; net: number; pct: number }) {
  const pos = net >= 0;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#1b2334] bg-[#101726] px-3 py-2">
      <span className="text-[11.5px] font-mono text-[#c8cfdb] w-[70px]" dir="ltr">{month}</span>
      <div className="flex-1 h-2 rounded-full bg-[#f6465d]/25 overflow-hidden flex">
        <div className="h-full bg-[#2ebd85]" style={{ width: `${Math.min(100, Math.max(0, (pct / 20) * 100))}%` }} />
      </div>
      <span className={cn('font-mono font-bold text-[12px] w-[80px] text-left', pos ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>
        {pos ? '+' : ''}{net.toFixed(2)}$
      </span>
      <span className={cn('font-mono text-[10px] w-[52px] text-left', pos ? 'text-[#2ebd85]/80' : 'text-[#f6465d]/80')}>
        {pos ? '+' : ''}{pct.toFixed(1)}%
      </span>
    </div>
  );
}

function BestWorst({ title, pnl, id, cls }: { title: string; pnl: number; id: number; cls: string }) {
  return (
    <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-3.5">
      <div className="text-[10.5px] text-[#8a94a6] mb-1">{title}</div>
      <div className={cn('font-mono font-black text-[17px]', cls)}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}$</div>
      <div className="text-[9.5px] text-[#5a6474] mt-0.5">صفقة #{id}</div>
    </div>
  );
}

function Stat({ icon, label, value, sub, cls }: {
  icon?: React.ReactNode; label: string; value: string; sub?: string; cls?: string;
}) {
  return (
    <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-3.5">
      <div className="flex items-center gap-1.5 text-[#8a94a6] mb-1.5">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <div className={cn('font-mono font-bold text-[15px]', cls ?? 'text-[#e9edf4]')}>{value}</div>
      {sub && <div className="text-[9.5px] text-[#5a6474] mt-0.5">{sub}</div>}
    </div>
  );
}
