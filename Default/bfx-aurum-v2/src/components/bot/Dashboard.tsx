'use client';

// لوحة القيادة — شاشة واحدة كالواجهة القديمة:
// شارت MT5 الأساسي أعلى + شريط القرار + شارت التنبؤ الهيكلي أسفل + اللوحة الجانبية
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBot } from './store';
import { GoldChart } from './GoldChart';
import { ForecastChart } from './ForecastChart';
import { Mt5Badge } from './Mt5Badge';
import { GuardianPanel } from './GuardianPanel';
import { VisitorsPanel } from './VisitorsPanel';
import { SESSION_AR, SessionId } from '@/lib/engine/types';
import { cn } from '@/lib/utils';
import { CandlestickChart, LineChart } from 'lucide-react';

const TFS = ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];

function syriaHour(t: number) { return ((t + 3 * 3600e3) % 86400e3) / 3600e3; }
function sessionOf(t: number): SessionId | null {
  const h = syriaHour(t);
  const wd = new Date(t + 3 * 3600e3).getUTCDay();
  if (wd === 6) return null;
  if (h < 1) return null;
  if (h < 10) return 'asia';
  if (h < 15) return 'london';
  if (h < 19) return 'londonNY';
  if (h < 23) return 'ny';
  return null;
}
const SESSION_COLORS: Record<SessionId, string> = {
  asia: '#3d7dd8', london: '#d8a53d', londonNY: '#c2483d', ny: '#3dbd7d',
};

interface FCandle { t: number; o: number; h: number; l: number; c: number }
interface ForecastData {
  tf: string; horizon: number; lastClose: number; lastT: number; atr: number;
  pUp: number[];
  band: { t: number; upper: number; lower: number }[];
  projected: FCandle[];
  decision: { dir: 'up' | 'down'; confidence: number; pUpOverall: number; expHigh: number; expLow: number };
  drivers: { label: string; detail: string; score: number; weight: number }[];
  structure: {
    trend: string;
    lastRealHigh?: { kind: string; price: number };
    lastRealLow?: { kind: string; price: number };
    lastEvent?: { type: string; dir: string; level: number };
  };
  settingsApplied?: { emaEnabled: boolean; emaFast: number; emaSlow: number };
  context: FCandle[];
}

function dirAr(d?: string) {
  if (d === 'up') return 'صاعد ▲';
  if (d === 'down') return 'هابط ▼';
  return 'عرضي ◆';
}
function dirCls(d?: string) {
  return d === 'up' ? 'text-[#2ebd85]' : d === 'down' ? 'text-[#f6465d]' : 'text-[#8a94a6]';
}

/** لوحة انتظار البيانات الحقيقية — تظهر حين لا يكون جسر MT5 متصلاً */
function WaitReal({ title }: { title: string }) {
  return (
    <div className="w-full h-full min-h-[250px] flex flex-col items-center justify-center gap-3 text-center px-6">
      <div className="w-11 h-11 rounded-xl border border-[#d9b45c]/35 bg-[#d9b45c]/10 flex items-center justify-center">
        <CandlestickChart className="w-5 h-5 text-[#d9b45c] animate-pulse" />
      </div>
      <div>
        <div className="text-[13.5px] font-bold text-[#d9b45c]">{title} — بانتظار البيانات الحقيقية</div>
        <div className="text-[11.5px] text-[#8a94a6] mt-1 max-w-[460px] leading-relaxed">
          هذا الشارت يعرض شموع XAUUSD الحقيقية فقط من طرفية MetaTrader 5 على جهازك — لا محاكاة ولا بيانات وهمية.
          شغّل أمر الربط في طرفية CMD على الكمبيوتر وبمجرد اتصال الجسر ستظهر الشموع تلقائياً.
        </div>
      </div>
      <details className="mt-1 max-w-[480px] text-right">
        <summary className="text-[11px] text-[#d9b45c] cursor-pointer hover:text-[#e8c66f] transition-colors">
          ظهر لك خطأ «sandbox is inactive»؟ اضغط للحل
        </summary>
        <div className="mt-2 text-[10.5px] text-[#c3cbd9] bg-[#0a0e17] border border-[#1b2334] rounded-lg p-3 leading-relaxed text-right space-y-1.5">
          <p><b className="text-[#d9b45c]">السبب:</b> قناة API الداخلية بين مكتبة MetaTrader5 والطرفية انقطعت.</p>
          <p><b className="text-[#2ebd85]">الحل خطوة بخطوة:</b></p>
          <ol className="list-decimal list-inside space-y-1 text-[#c3cbd9]">
            <li>أغلق طرفية MetaTrader 5 كلياً (من علامة X أو Ctrl+Q)</li>
            <li>أعد فتحها وسجّل الدخول (حتى حساب تجريبي Demo يكفي)</li>
            <li>فعّل زر <b className="text-[#2ebd85]">Algo Trading</b> الأخضر في شريط الأدوات العلوي</li>
            <li>أعد تشغيل أمر الجسر في CMD — الآن يعود البث تلقائياً</li>
          </ol>
          <p className="text-[#8a94a6] mt-2 pt-1.5 border-t border-[#1b2334]">
            الجسر المُحدّث (v20+) يعيد الاتصال تلقائياً عند هذا الخطأ دون انهيار —
            لكن أحياناً الطرفية نفسها تحتاج إعادة فتح يدوية.
          </p>
        </div>
      </details>
    </div>
  );
}

export function Dashboard() {
  const { trades, settings } = useBot();
  const [tf, setTf] = useState('15m');
  const [reloadKey, setReloadKey] = useState(0);
  const [mt5Live, setMt5Live] = useState(false);
  const [chartData, setChartData] = useState<{
    candles: FCandle[];
    emaFast: { t: number; v: number | null }[];
    emaSlow: { t: number; v: number | null }[];
  } | null>(null);
  const [fc, setFc] = useState<ForecastData | null>(null);
  // الشمعة الحية اللحظية من بث MT5 — تحدّث آخر شمعة في الشارتين بلا إعادة تحميل
  const [liveCandle, setLiveCandle] = useState<{ t: number; o: number; h: number; l: number; c: number } | null>(null);
  const tfRef = useRef('15m');
  const prevLiveTRef = useRef(0);

  useEffect(() => {
    tfRef.current = tf;
    prevLiveTRef.current = 0;
    setLiveCandle(null);
    // إشعار خفيف للوحة الزوار بالفريم المعروض — لا يؤثر على أي منطق
    window.dispatchEvent(new CustomEvent('bfx:tf', { detail: tf }));
  }, [tf]);

  // نبضة السعر اللحظية كل 700ms — آخر شمعة لكل فريم مدموجة مع تيك البث الحي
  // (نفس خط Bid في شارت ميتاتريدر) فتتحرك الشمعة الجارية وخط السعر لحظياً
  useEffect(() => {
    let alive = true;
    let wasOn = false;
    const poll = async () => {
      try {
        const r = await fetch('/api/mt5/tick', { cache: 'no-store' });
        if (!r.ok || !alive) return;
        const j = await r.json();
        const on = !!j.connected;
        setMt5Live(prev => (prev === on ? prev : on));
        const lc = (j.last?.[tfRef.current] ?? null) as { t: number; o: number; h: number; l: number; c: number } | null;
        setLiveCandle(on && lc ? lc : null);
        if (on && lc) {
          // فُتحت شمعة جديدة على الفريم المعروض → تحديث كامل للشارت والتنبؤ
          if (prevLiveTRef.current && lc.t > prevLiveTRef.current) setReloadKey(k => k + 1);
          prevLiveTRef.current = lc.t;
        }
        if (on && !wasOn) setReloadKey(k => k + 1); // انقطاع → اتصال: إعادة تحميل فورية
        wasOn = on;
      } catch { /* ignore */ }
    };
    poll();
    // إيقاف النبض أثناء إخفاء التبويب — نوافذ بالخلفية لا تُحمّل الخادم
    const id = setInterval(() => { if (!document.hidden) poll(); }, 700);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/chart?tf=${tf}&limit=350`);
        if (!r.ok) return;
        const j = await r.json();
        if (alive) setChartData(j);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [tf, reloadKey]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/forecast?tf=${tf}`);
        if (!r.ok) return;
        const j = await r.json();
        if (alive) setFc(j);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [tf, reloadKey]);

  // شرائح الجلسات للأعلى (مؤشر توقيت الجلسات)
  const sessionStrip = useMemo(() => {
    if (!chartData) return [];
    const out: { from: number; to: number; s: SessionId }[] = [];
    let cur: SessionId | null = null;
    let from = 0;
    for (const c of chartData.candles) {
      const s = sessionOf(c.t);
      if (s !== cur) {
        if (cur) out.push({ from, to: c.t, s: cur });
        cur = s; from = c.t;
      }
    }
    if (cur) out.push({ from, to: chartData.candles[chartData.candles.length - 1].t + 1, s: cur });
    return out;
  }, [chartData]);

  // المستويات المرجعية على الشارت الأساسي — من هيكل الفريم المعروض
  const levels = useMemo(() => {
    const arr: { price: number; title: string; color: string }[] = [];
    if (fc?.structure.lastRealHigh) arr.push({ price: fc.structure.lastRealHigh.price, title: fc.structure.lastRealHigh.kind, color: '#f6465d' });
    if (fc?.structure.lastRealLow) arr.push({ price: fc.structure.lastRealLow.price, title: fc.structure.lastRealLow.kind, color: '#2ebd85' });
    return arr;
  }, [fc]);

  const pUp = fc?.decision.pUpOverall ?? 0.5;
  const conf = fc?.decision.confidence ?? 0;
  const dir = fc?.decision.dir;
  const trend = fc?.structure.trend;

  return (
    <div className="h-full flex flex-col gap-2 p-2 lg:p-3 overflow-y-auto lg:overflow-hidden min-h-0">

      {/* ============ الشارت الأساسي MT5 (أعلى) ============ */}
      <section className="rounded-xl border border-[#1b2334] bg-[#0d1220] overflow-hidden flex flex-col min-h-[360px] lg:min-h-0 lg:flex-[1.12] shrink-0 lg:shrink">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[#1b2334] shrink-0 bg-gradient-to-l from-[#101726] to-[#0d1220]">
          <CandlestickChart className="w-4 h-4 text-[#d9b45c]" />
          <span className="text-[13px] font-bold text-[#d9b45c]">XAUUSD</span>
          <span className="text-[11px] text-[#8a94a6]">الشارت الأساسي — شموع MT5</span>
          <Mt5Badge />
          <div className="flex gap-1 mr-auto">
            {TFS.map(f => (
              <button key={f} onClick={() => setTf(f)}
                className={cn('px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors',
                  tf === f ? 'bg-[#d9b45c] text-[#0a0e17] border-[#d9b45c]' : 'border-[#2a3550] text-[#8a94a6] hover:text-[#e9edf4]')}>
                {f}
              </button>
            ))}
          </div>
        </div>
        {/* شريط مؤشر الجلسات */}
        {settings.indicators.sessionTiming && (
          <div className="h-5 flex border-b border-[#1b2334] bg-[#0a0e17] shrink-0">
            {sessionStrip.map((seg, i) => (
              <div key={i} className="flex items-center justify-center text-[9px] font-bold text-white/80"
                style={{ flexGrow: Math.max(1, seg.to - seg.from), backgroundColor: `${SESSION_COLORS[seg.s]}33`, borderRight: `1px solid ${SESSION_COLORS[seg.s]}66` }}>
                {SESSION_AR[seg.s]}
              </div>
            ))}
            {!sessionStrip.length && <div className="flex-1" />}
          </div>
        )}
        <div className="flex-1 min-h-[250px] lg:min-h-0">
          {chartData ? (
            <GoldChart
              tfLabel={tf}
              candles={chartData.candles}
              emaFast={chartData.emaFast}
              emaSlow={chartData.emaSlow}
              trades={trades.map(t => ({ entryT: t.entryT, dir: t.dir, strategy: t.strategy, pnl: t.pnl }))}
              showEma={settings.indicators.ema}
              levels={levels}
              liveCandle={liveCandle}
            />
          ) : (
            <WaitReal title="الشارت الأساسي MT5" />
          )}
        </div>
      </section>

      {/* ============ شريط القرار (بين الشارتين) ============ */}
      <section className="shrink-0 rounded-xl border border-[#1b2334] bg-[#0d1220] px-3 py-2 flex flex-wrap items-center gap-x-5 gap-y-2">
        {/* مزيج القرار */}
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-[#8a94a6]">مزيج القرار:</span>
          <span className={cn('text-[13px] font-bold', dirCls(dir))}>{dirAr(dir === 'up' ? 'up' : dir === 'down' ? 'down' : undefined)}</span>
          <span className="text-[11px] font-mono text-[#e9edf4] bg-[#141a29] border border-[#2a3550] rounded px-1.5 py-0.5">{conf}%</span>
        </div>
        {/* شريط الاحتمال */}
        <div className="flex items-center gap-2 flex-1 min-w-[170px] max-w-[340px]">
          <div className="flex-1 h-2.5 rounded-full overflow-hidden bg-[#f6465d]/60 flex">
            <div className="h-full bg-[#2ebd85]" style={{ width: `${(pUp * 100).toFixed(1)}%` }} />
          </div>
          <span className="text-[10px] font-mono text-[#8a94a6] shrink-0">{(pUp * 100).toFixed(0)}/{(100 - pUp * 100).toFixed(0)}</span>
        </div>
        {/* محركات المزيج */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {fc?.drivers.map(d => (
            <span key={d.label} title={d.detail}
              className={cn('text-[10px] px-1.5 py-0.5 rounded border',
                d.score > 0.08 ? 'text-[#2ebd85] border-[#2ebd85]/40 bg-[#2ebd85]/10'
                  : d.score < -0.08 ? 'text-[#f6465d] border-[#f6465d]/40 bg-[#f6465d]/10'
                    : 'text-[#8a94a6] border-[#2a3550] bg-[#141a29]')}>
              {d.label} {d.score > 0.08 ? '▲' : d.score < -0.08 ? '▼' : '◆'}
            </span>
          ))}
          {!fc && <span className="text-[10.5px] text-[#8a94a6]">جارٍ حساب مزيج القرار...</span>}
        </div>
        {/* الهيكل */}
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-[#8a94a6]">اتجاه الفريم: <b className={dirCls(trend)}>{dirAr(trend)}</b></span>
          {fc?.structure.lastEvent && (
            <span className="text-[#8a94a6]">
              آخر حدث: <b className={fc.structure.lastEvent.dir === 'up' ? 'text-[#2ebd85]' : 'text-[#e8a33d]'}>
                {fc.structure.lastEvent.type === 'BOS' ? 'BOS' : fc.structure.lastEvent.type === 'CHoCH' ? 'CHoCH' : 'سحب سيولة'}
                {' '}{fc.structure.lastEvent.dir === 'up' ? '▲' : '▼'}
              </b>{' '}
              <span className="font-mono text-[#e9edf4]">{fc.structure.lastEvent.level.toFixed(2)}</span>
            </span>
          )}
        </div>
      </section>

      {/* ============ شارت التنبؤ (أسفل) ============ */}
      <section className="rounded-xl border border-[#1b2334] bg-[#0d1220] overflow-hidden flex flex-col min-h-[400px] lg:min-h-0 lg:flex-1 shrink-0 lg:shrink">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[#1b2334] shrink-0 bg-gradient-to-l from-[#101726] to-[#0d1220]">
          <LineChart className="w-4 h-4 text-[#d9b45c]" />
          <span className="text-[13px] font-bold text-[#d9b45c]">التنبؤ الهيكلي</span>
          <span className="text-[11px] text-[#8a94a6]">
            {fc ? `شموع مستقبلية متوقعة حتمية — فريم ${tf} — مزيج: الهيكل${fc.settingsApplied?.emaEnabled ? ` + EMA ${fc.settingsApplied.emaFast}/${fc.settingsApplied.emaSlow}` : ''} + الزخم — مُلتزم بإعداداتك` : 'جارٍ الحساب...'}
          </span>
          {fc && (
            <span className="text-[10.5px] font-mono text-[#8a94a6] mr-auto">
              النطاق المتوقع: <b className="text-[#2ebd85]">{fc.decision.expLow.toFixed(2)}</b> ~ <b className="text-[#f6465d]">{fc.decision.expHigh.toFixed(2)}</b>
            </span>
          )}
        </div>
        <div className="flex-1 min-h-[260px] lg:min-h-0">
          {fc ? (
            <ForecastChart context={fc.context} band={fc.band} projected={fc.projected} liveCandle={liveCandle} />
          ) : (
            <WaitReal title="التنبؤ الهيكلي" />
          )}
        </div>
        {/* شريط احتمال كل شمعة من الأفق */}
        {fc && (
          <div className="shrink-0 border-t border-[#1b2334] bg-[#0a0e17] px-2 py-1.5">
            <div className="flex items-end gap-1 h-9">
              {fc.pUp.map((p, i) => {
                const up = p >= 0.5;
                const h = 14 + Math.abs(p - 0.5) * 2 * 86;
                return (
                  <div key={i} className="flex-1 h-full flex flex-col items-center justify-end gap-0.5 min-w-0"
                    title={`الشمعة ${i + 1}: ${(p * 100).toFixed(0)}% صعود`}>
                    <div className="w-full rounded-sm" style={{ height: `${h}%`, backgroundColor: up ? 'rgba(46,189,133,0.75)' : 'rgba(246,70,93,0.75)' }} />
                    <span className="text-[8px] text-[#5a6474] font-mono leading-none shrink-0">{i + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ============ الوكيل الحارس + الأجهزة المتصلة (أزرار عائمة — لا تؤثر على أي شيء) ============ */}
      <GuardianPanel />
      <VisitorsPanel />
    </div>
  );
}
