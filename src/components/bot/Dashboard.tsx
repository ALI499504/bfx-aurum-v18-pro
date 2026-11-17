'use client';

// لوحة القيادة — الشارت الحقيقي MT5 وحده بكامل الشاشة مع الشاشة الجانبية:
// رأس بأزرار الفريمات بنمط MT5 + الشارت يملأ كل المساحة (طبق الأصل: بلا أي شرائط دخيلة)
// + شريط قرار سفلي بأسلوب شريط حالة MT5 (بلا شارت توقعات — أُزيل بقرار المالك)
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBot } from './store';
import { GoldChart, MT5_SCHEMES, MT5_SCHEME_ORDER, loadScheme, saveScheme, type Mt5SchemeId } from './GoldChart';
import { Mt5Badge } from './Mt5Badge';
import { GuardianPanel } from './GuardianPanel';
import { VisitorsPanel } from './VisitorsPanel';
import { AlertsPanel } from './AlertsPanel';
import { cn } from '@/lib/utils';

const TFS = ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];
// تسمية MT5 الرسمية لأزرار الفريمات
const MT5_TF: Record<string, string> = {
  '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D1', '1w': 'W1', '1M': 'MN',
};

interface FCandle { t: number; o: number; h: number; l: number; c: number }
/** مستوى صفقة حية — معلق أو مفتوح (من محرك التنفيذ المصحح ذاتياً) */
interface LiveLevel {
  kind: 'position' | 'pending';
  ticket: string;
  dir: 'buy' | 'sell';
  strategy: string;
  entry: number; sl: number; tp: number;
  t: number;
}
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
  return d === 'up' ? 'text-[#00c000]' : d === 'down' ? 'text-[#d40000]' : 'text-[#8a94a6]';
}

/** لوحة انتظار البيانات الحقيقية — تظهر حين لا يكون جسر MT5 متصلاً */
function WaitReal({ title }: { title: string }) {
  return (
    <div className="w-full h-full min-h-[250px] flex flex-col items-center justify-center gap-3 text-center px-6">
      <div className="w-11 h-11 rounded-xl border border-[#d9b45c]/35 bg-[#d9b45c]/10 flex items-center justify-center">
        <svg className="w-5 h-5 text-[#d9b45c] animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5v14M15 5v14M9 8h2M9 16h2M15 8h2M15 16h2M4 9v6M20 9v6M4 12h16" /></svg>
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
  const { trades } = useBot();
  const [tf, setTf] = useState('15m');
  // مخطط ألوان MT5 الرسمي — محفوظ محلياً، الافتراضي «Green on Black» (مخطط الطرفية المصنعي)
  const [scheme, setScheme] = useState<Mt5SchemeId>('green');
  useEffect(() => { setScheme(loadScheme()); }, []);
  const onScheme = (id: Mt5SchemeId) => { setScheme(id); saveScheme(id); };
  const [reloadKey, setReloadKey] = useState(0);
  const [mt5Live, setMt5Live] = useState(false);
  const [chartData, setChartData] = useState<{
    candles: FCandle[];
    emaFast: { t: number; v: number | null }[];
    emaSlow: { t: number; v: number | null }[];
  } | null>(null);
  const [fc, setFc] = useState<ForecastData | null>(null);
  // حالة تحميل الشارت: عند تبديل الفريم نُفرغ البيانات القديمة فوراً ونُظهر
  // مؤشر تحميل — بدل إبقاء شارت الفريم السابق معروضاً ثم القفز للجديد (كان يبدو «تأخراً»)
  const [chartLoading, setChartLoading] = useState(true);
  // الشمعة الحية اللحظية من بث MT5 — تحدّث آخر شمعة في الشارت بلا إعادة تحميل
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
          // فُتحت شمعة جديدة على الفريم المعروض → تحديث كامل للشارت
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
    const ac = new AbortController();
    // تبديل الفريم = بيانات الفريم السابق لم تعد صالحة → نُفرغها فوراً
    // حتى لا يُعرض شارت فريم آخر تحت اسم الفريم الجديد
    setChartData(null);
    setChartLoading(true);
    (async () => {
      try {
        const r = await fetch(`/api/chart?tf=${tf}&limit=350`, { cache: 'no-store', signal: ac.signal });
        if (!r.ok) { if (alive) setChartLoading(false); return; }
        const j = await r.json();
        if (alive) { setChartData(j); setChartLoading(false); }
      } catch { if (alive) setChartLoading(false); }
    })();
    return () => { alive = false; ac.abort(); };
  }, [tf, reloadKey]);

  // تحليل الهيكل (يغذي شريط القرار السفلي والمستويات على الشارت)
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

  // المستويات الحية للصفقات (معلقة/مفتوحة) — خطوط الدخول/الوقف/الهدف كالميتاتريدر
  const [liveLevels, setLiveLevels] = useState<LiveLevel[]>([]);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/mt5/account', { cache: 'no-store' });
        if (!r.ok || !alive) return;
        const j = await r.json();
        if (alive) setLiveLevels(Array.isArray(j.liveLevels) ? j.liveLevels : []);
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(() => { if (!document.hidden) poll(); }, 4000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // المستويات على الشارت — هيكل الفريم المعروض + مستويات الصفقات الحية
  // (نمط MT5 الحرفي: دخول أزرق متقطع بعنوان «sell 0.01 XAUUSD.m»، وقف أحمر «sl»، هدف أخضر «tp»)
  const levels = useMemo(() => {
    const arr: { price: number; title: string; color: string; t?: number }[] = [];
    if (fc?.structure.lastRealHigh) arr.push({ price: fc.structure.lastRealHigh.price, title: fc.structure.lastRealHigh.kind, color: '#7a7a7a' });
    if (fc?.structure.lastRealLow) arr.push({ price: fc.structure.lastRealLow.price, title: fc.structure.lastRealLow.kind, color: '#7a7a7a' });
    for (const l of liveLevels) {
      const dirEn = l.dir === 'buy' ? 'buy' : 'sell';
      const name = `${dirEn} 0.01 XAUUSD.m [${l.strategy}]`;
      const tag = l.kind === 'position' ? name : `${name} معلقة`;
      arr.push({ price: l.entry, title: tag, color: '#4e86e0', t: l.t });
      if (l.sl > 0) arr.push({ price: l.sl, title: `sl ${l.sl.toFixed(2)} [${l.strategy}]`, color: '#ff2d2d', t: l.t });
      if (l.tp > 0) arr.push({ price: l.tp, title: `tp ${l.tp.toFixed(2)} [${l.strategy}]`, color: '#00e70b', t: l.t });
    }
    return arr;
  }, [fc, liveLevels]);

  const pUp = fc?.decision.pUpOverall ?? 0.5;
  const conf = fc?.decision.confidence ?? 0;
  const dir = fc?.decision.dir;
  const trend = fc?.structure.trend;

  return (
    <div className="h-full flex flex-col gap-2 p-2 lg:p-3 min-h-0">

      {/* ============ الشارت الحقيقي MT5 — يملأ كامل المساحة المتاحة ============ */}
      <section className={cn(
        'flex-1 min-h-0 flex flex-col rounded-xl border overflow-hidden',
        mt5Live ? 'border-[#333333] bg-[#000000]' : 'border-[#1b2334] bg-[#0d1220]'
      )}>
        {/* رأس MT5: الرمز + شارة الاتصال + أزرار الفريمات + منتقي المخططات الرسمية بنمط الميتاتريدر */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-[#333333] shrink-0 bg-[#0a0a0a]">
          <span className="text-[13.5px] font-bold text-[#c8c8c8]" style={{ fontFamily: 'Tahoma, sans-serif' }}>XAUUSD.m</span>
          <Mt5Badge />
          <div className="flex gap-0.5 mr-auto" dir="ltr">
            {TFS.map(f => (
              <button key={f} onClick={() => setTf(f)}
                className={cn('px-2 py-1 rounded text-[11px] font-bold border transition-colors',
                  tf === f
                    ? 'bg-[#1c1c1c] text-[#f5f5f5] border-[#555555] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                    : 'bg-transparent border-transparent text-[#8a8a8a] hover:text-[#e5e5e5] hover:bg-[#161616]')}
                style={{ fontFamily: 'Tahoma, sans-serif' }}>
                {MT5_TF[f]}
              </button>
            ))}
          </div>
          {/* منتقي مخططات MT5 الرسمية — نفس قائمة Scheme في نافذة Properties بالطرفية */}
          <label className="flex items-center gap-1.5 shrink-0" title="مخطط ألوان ميتاتريدر 5 الرسمي — نفس قائمة Scheme في نافذة الخصائص بالطرفية">
            <span className="text-[10px] text-[#8a8a8a]" style={{ fontFamily: 'Tahoma, sans-serif' }}>Scheme</span>
            <select value={scheme} onChange={e => onScheme(e.target.value as Mt5SchemeId)} dir="ltr"
              className="bg-[#1c1c1c] text-[#e5e5e5] border border-[#555555] rounded text-[10.5px] font-bold px-1.5 py-1 outline-none cursor-pointer hover:border-[#6a6a6a] focus:border-[#8a8a8a] transition-colors"
              style={{ fontFamily: 'Tahoma, sans-serif' }}>
              {MT5_SCHEME_ORDER.map(id => (
                <option key={id} value={id} className="bg-[#1c1c1c] text-[#e5e5e5]">{MT5_SCHEMES[id].name}</option>
              ))}
            </select>
          </label>
        </div>
        {/* الشارت يملأ كل ما تبقى من الشاشة */}
        <div className="flex-1 min-h-[300px]">
          {chartLoading && !chartData ? (
            <div className="w-full h-full min-h-[300px] flex flex-col items-center justify-center gap-3">
              <div className="w-9 h-9 rounded-full border-2 border-[#d9b45c]/25 border-t-[#d9b45c] animate-spin" />
              <div className="text-[12px] text-[#8a94a6]">جارٍ تحميل شموع {tf}…</div>
            </div>
          ) : chartData ? (
            <GoldChart
              tfLabel={tf}
              candles={chartData.candles}
              emaFast={chartData.emaFast}
              emaSlow={chartData.emaSlow}
              trades={[
                // أسهم دخول الصفقات الحية المفتوحة الآن (فورية من محرك التنفيذ)
                ...liveLevels.filter(l => l.kind === 'position').map(l => ({ entryT: l.t, dir: l.dir, strategy: l.strategy, pnl: 0 })),
                ...trades.map(t => ({ entryT: t.entryT, dir: t.dir, strategy: t.strategy, pnl: t.pnl })),
              ]}
              showEma={false}
              levels={levels}
              liveCandle={liveCandle}
              scheme={scheme}
            />
          ) : (
            <WaitReal title="الشارت الحقيقي MT5" />
          )}
        </div>
        {/* شريط القرار السفلي — بأسلوب شريط حالة MT5 */}
        <div className="shrink-0 border-t border-[#333333] bg-[#0a0a0a] px-3 py-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] text-[#8a8a8a]">مزيج القرار:</span>
            <span className={cn('text-[12px] font-bold', dirCls(dir))}>{dirAr(dir === 'up' ? 'up' : dir === 'down' ? 'down' : undefined)}</span>
            <span className="text-[10.5px] font-mono text-[#e5e5e5] bg-[#1c1c1c] border border-[#3a3a3a] rounded px-1.5 py-px">{conf}%</span>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-[150px] max-w-[300px]">
            <div className="flex-1 h-2 rounded-full overflow-hidden bg-[#d40000]/50 flex">
              <div className="h-full bg-[#00c000]" style={{ width: `${(pUp * 100).toFixed(1)}%` }} />
            </div>
            <span className="text-[9.5px] font-mono text-[#8a8a8a] shrink-0">{(pUp * 100).toFixed(0)}/{(100 - pUp * 100).toFixed(0)}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {fc?.drivers.map(d => (
              <span key={d.label} title={d.detail}
                className={cn('text-[9.5px] px-1.5 py-0.5 rounded border',
                  d.score > 0.08 ? 'text-[#00c000] border-[#00c000]/40 bg-[#00c000]/10'
                    : d.score < -0.08 ? 'text-[#d40000] border-[#d40000]/40 bg-[#d40000]/10'
                      : 'text-[#8a8a8a] border-[#3a3a3a] bg-[#1c1c1c]')}>
                {d.label} {d.score > 0.08 ? '▲' : d.score < -0.08 ? '▼' : '◆'}
              </span>
            ))}
            {!fc && <span className="text-[10px] text-[#8a8a8a]">جارٍ حساب مزيج القرار...</span>}
          </div>
          <div className="flex items-center gap-3 text-[10.5px]">
            <span className="text-[#8a8a8a]">اتجاه الفريم: <b className={dirCls(trend)}>{dirAr(trend)}</b></span>
            {fc?.structure.lastEvent && (
              <span className="text-[#8a8a8a]">
                آخر حدث: <b className={fc.structure.lastEvent.dir === 'up' ? 'text-[#00c000]' : 'text-[#e8a33d]'}>
                  {fc.structure.lastEvent.type === 'BOS' ? 'BOS' : fc.structure.lastEvent.type === 'CHoCH' ? 'CHoCH' : 'سحب سيولة'}
                  {' '}{fc.structure.lastEvent.dir === 'up' ? '▲' : '▼'}
                </b>{' '}
                <span className="font-mono text-[#e5e5e5]">{fc.structure.lastEvent.level.toFixed(2)}</span>
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ============ الوكيل الحارس + التنبيهات + الأجهزة المتصلة (أزرار عائمة) ============ */}
      <GuardianPanel />
      <AlertsPanel />
      <VisitorsPanel />
    </div>
  );
}
