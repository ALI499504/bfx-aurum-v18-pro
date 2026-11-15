'use client';

// السلة المعتمدة — محفظة الظل المستقلة على أساس افتراضي 1000$
// سلة A (TSMOM-30d + Sunrise Ogle) بمعزولها الحرفي من المحاكاة المعتمدة،
// مع الصمامات المعتمدة. الحساب الحقيقي (190$) لا يمس إطلاقاً — قراءة شموع فقط.
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Layers, RefreshCw, ShieldCheck, TrendingUp, TrendingDown, Scale, BadgeCheck, Zap, CircleDollarSign, Timer } from 'lucide-react';

interface Metrics {
  n: number; wr: number; pf: number; net: number;
  dd: number; ddp: number; risk: number; riskp: number;
  minbal: number; streak: number; avgr: number;
}
interface VRow { name: string; window: string; m: Metrics }
interface Trade {
  comp: string; entryT: number; exitT: number; dir: 1 | -1;
  entry: number; exit: number; sl: number; tp: number | null;
  pnl: number; r: number; why: string; heldH: number;
}
interface BasketReport {
  ok: boolean; computedAt: number; candles: number;
  dataFrom: number | null; dataTo: number | null; note: string;
  validation: VRow[];
  live: null | {
    equityNow: number; netNow: number; floatingNow: number; peakEquity: number;
    fuseTrips: { daily: number; weekly: number; equity: number };
    fuseState: { dayBlocked: boolean; weekBlocked: boolean; equityHalted: boolean };
    dayPnlNow: number; weekPnlNow: number;
    metricsAll: Metrics; metrics365: Metrics;
    monthly: { month: string; net: number }[];
    open: { comp: string; dir: 1 | -1; entry: number; sl: number; tp: number | null; sinceT: number; floating: number }[];
    lastTrades: Trade[];
    eqDaily: { t: number; v: number }[];
  };
}

const COMP_AR: Record<string, string> = { TSMOM: 'TSMOM-30d', Ogle: 'Sunrise Ogle', EWMAC: 'EWMAC 32/128', Donchian: 'دونشييان 120/60' };
const WHY_AR: Record<string, string> = { sl: 'وقف', tp: 'هدف', rule: 'قاعدة الخروج', time: 'سقف زمني (قاعدة 4)', eod: 'مفتوحة (نهاية البيانات)' };
const money = (v: number, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}$`;
const dt = (t: number) => new Date(t + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

function EquityCurve({ pts }: { pts: { t: number; v: number }[] }) {
  if (pts.length < 2) return null;
  const vs = pts.map(p => p.v);
  const min = Math.min(...vs, 1000), max = Math.max(...vs, 1000);
  const pad = Math.max(10, (max - min) * 0.08);
  const lo = min - pad, hi = max + pad;
  const W = 640, H = 150;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = vs[vs.length - 1];
  const up = last >= 1000;
  const baseY = y(1000);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[150px]" preserveAspectRatio="none">
      <defs>
        <linearGradient id="bEqFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={up ? '#2ebd85' : '#f6465d'} stopOpacity="0.22" />
          <stop offset="100%" stopColor={up ? '#2ebd85' : '#f6465d'} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <line x1="0" y1={baseY} x2={W} y2={baseY} stroke="#3a4555" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
      <path d={`${path} L${W},${H} L0,${H} Z`} fill="url(#bEqFill)" />
      <path d={path} fill="none" stroke={up ? '#2ebd85' : '#f6465d'} strokeWidth="1.8" />
    </svg>
  );
}

function MonthlyBars({ monthly }: { monthly: { month: string; net: number }[] }) {
  const rows = monthly.slice(-12);
  if (!rows.length) return null;
  const mx = Math.max(...rows.map(r => Math.abs(r.net)), 50);
  return (
    <div className="flex items-end gap-1 h-[92px]">
      {rows.map(r => {
        const h = Math.max(3, (Math.abs(r.net) / mx) * 42);
        return (
          <div key={r.month} className="flex-1 flex flex-col items-center justify-end gap-1 group relative" title={`${r.month}: ${money(r.net)}`}>
            <span className={cn('text-[8.5px] font-mono font-bold', r.net >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{r.net >= 0 ? '+' : ''}{Math.round(r.net)}</span>
            <div className={cn('w-full rounded-t', r.net >= 0 ? 'bg-[#2ebd85]/70' : 'bg-[#f6465d]/70')} style={{ height: `${h}px` }} />
            <span className="text-[8px] text-[#5a6474]">{r.month.slice(2)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function BasketWindow() {
  const [rep, setRep] = useState<BasketReport | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/basket', { cache: 'no-store' });
      if (r.ok) setRep(await r.json());
    } catch { /* ignore */ }
    setBusy(false);
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  if (!rep) {
    return (
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-8 flex items-center justify-center gap-3 text-[#8a94a6] text-[13px]">
        <RefreshCw className="w-4 h-4 animate-spin" /> جارٍ بناء تقرير السلة المعتمدة...
      </div>
    );
  }

  const live = rep.live;
  const v365 = rep.validation.filter(r => r.window === '365يوم');
  const v730 = rep.validation.filter(r => r.window === '730يوم');
  const vFull = rep.validation.filter(r => r.window === 'كامل');

  return (
    <div className="space-y-4">
      {/* ======= بطاقة المحفظة الظلية ======= */}
      <div className="rounded-xl border border-[#d9b45c]/30 bg-gradient-to-l from-[#0d1220] to-[#141a10] p-4">
        <div className="flex flex-wrap items-center gap-2.5 mb-3">
          <div className="w-9 h-9 rounded-lg bg-[#d9b45c]/12 border border-[#d9b45c]/30 flex items-center justify-center">
            <Layers className="w-4.5 h-4.5 text-[#d9b45c]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-bold">السلة المعتمدة — TSMOM-30d + Sunrise Ogle</h2>
              <span className="text-[9px] font-black text-[#0a0e17] bg-[#d9b45c] rounded px-1.5 py-px">محاكاة على أساس 1000$</span>
            </div>
            <p className="text-[10.5px] text-[#8a94a6]">محفظة ظل مستقلة بمعزولها الحرفي من المحاكاة المعتمدة — الحساب الحقيقي دون مساس · شموع الساعة الحية ({rep.candles.toLocaleString('en')} شمعة)</p>
          </div>
          <button onClick={load} disabled={busy}
            className="mr-auto flex items-center gap-2 rounded-lg border border-[#2a3550] hover:border-[#d9b45c]/50 hover:text-[#d9b45c] text-[#8a94a6] text-[11px] font-bold px-3 py-2 transition-colors">
            <RefreshCw className={cn('w-3.5 h-3.5', busy && 'animate-spin')} /> تحديث
          </button>
        </div>

        {!rep.ok || !live ? (
          <p className="text-[12.5px] text-[#e8a33d]">{rep.note}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-3">
              <KPI label="الإيكويتي الافتراضي" value={`${live.equityNow.toFixed(2)}$`} cls={live.equityNow >= 1000 ? 'text-[#2ebd85]' : 'text-[#f6465d]'} sub={`الأساس 1000$ · القمة ${live.peakEquity.toFixed(0)}$`} />
              <KPI label="صافي الربح المحقق" value={money(live.netNow)} cls={live.netNow >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'} sub={`${live.metricsAll.n} صفقة منذ ${rep.dataFrom ? dt(rep.dataFrom).slice(0, 10) : '—'}`} />
              <KPI label="العائم الحالي" value={money(live.floatingNow)} cls={live.floatingNow >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'} sub={`${live.open.length} موقع مفتوح`} />
              <KPI label="يوم دمشق الحالي" value={money(live.dayPnlNow)} cls={live.dayPnlNow >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'} sub={live.fuseState.dayBlocked ? 'الصمام اليومي يمنع دخولاً جديداً' : 'الصمام اليومي ساكت'} />
              <KPI label="الأسبوع الحالي" value={money(live.weekPnlNow)} cls={live.weekPnlNow >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'} sub={live.fuseState.weekBlocked ? 'الصمام الأسبوعي يمنع دخولاً جديداً' : 'الصمام الأسبوعي ساكت'} />
              <KPI label="حاجز الكارثة (500$)" value={live.fuseState.equityHalted ? 'مُثار' : 'سليم'} cls={live.fuseState.equityHalted ? 'text-[#f6465d]' : 'text-[#2ebd85]'} sub={`انقطاعات تاريخية: ${live.fuseTrips.equity}`} />
            </div>

            <div className="rounded-lg border border-[#1b2334] bg-[#0a0e17]/60 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-[#8a94a6]">منحنى إيكويتي المحفظة الافتراضية (بالصمامات المعتمدة)</span>
                <span className={cn('text-[11px] font-mono font-black', live.equityNow >= 1000 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{live.equityNow.toFixed(2)}$</span>
              </div>
              <EquityCurve pts={live.eqDaily} />
            </div>

            {/* المواقع المفتوحة */}
            {live.open.length > 0 && (
              <div className="mt-3 rounded-lg border border-[#1b2334] bg-[#0a0e17]/60 p-3">
                <div className="text-[10px] font-bold text-[#8a94a6] mb-2">المواقع المفتوحة الآن (لوت 0.01)</div>
                <div className="space-y-1.5">
                  {live.open.map((o, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
                      <span className={cn('font-black', o.dir === 1 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{o.dir === 1 ? 'شراء ▲' : 'بيع ▼'}</span>
                      <span className="text-[#e9edf4] font-bold">{COMP_AR[o.comp] ?? o.comp}</span>
                      <span className="font-mono text-[#8a94a6]">دخول {o.entry.toFixed(2)}</span>
                      <span className="font-mono text-[#8a94a6]">وقف {o.sl.toFixed(2)}</span>
                      {o.tp ? <span className="font-mono text-[#8a94a6]">هدف {o.tp.toFixed(2)}</span> : <span className="text-[#8a94a6]">خروج بالقاعدة</span>}
                      <span className={cn('font-mono font-bold mr-auto', o.floating >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{money(o.floating)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {live && (
        <>
          {/* ======= مقاييس التشغيل ======= */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="مقاييس آخر 365 يوماً (بالصمامات)" icon={<Timer className="w-4 h-4" />}>
              <MetricsGrid m={live.metrics365} />
              <p className="text-[10px] text-[#5a6474] mt-2">التوقع الشهري الحقيقي على أساس 1000$ وفق التشغيل الحالي بالصمامات.</p>
            </Card>
            <Card title="الأداء الشهري — آخر 12 شهراً ($)" icon={<CircleDollarSign className="w-4 h-4" />}>
              <MonthlyBars monthly={live.monthly} />
            </Card>
          </div>

          {/* ======= جدول التحقق من الزرع ======= */}
          <Card title="التحقق من الزرع — الوحدة مقابل أرقام الاعتماد" icon={<BadgeCheck className="w-4 h-4" />}>
            <p className="text-[11px] text-[#8a94a6] mb-3 leading-relaxed">
              نفس الشموع الحقيقية، نفس اصطلاحات المحاكاة المعتمدة (لوت 0.01 · سبريد 0.30$/صفقة · إشارة على الإغلاق ودخول على الافتتاح التالي · الوقف أولاً داخل الشمعة).
              الأرقام أدناه يجب أن تطابق ما اعتمدتَه في المحاكاة — وهذا هو إثبات «الزرع الصحيح».
            </p>
            <ValTable title="نافذة آخر 365 يوماً" rows={v365} />
            <ValTable title="نافذة آخر 730 يوماً" rows={v730} />
            {vFull.length > 0 && <ValTable title="كامل التاريخ المتاح (نقية بلا صمامات — مرجع قياس تكلفة الصمامات)" rows={vFull} />}
          </Card>

          {/* ======= الصمامات المعتمدة ======= */}
          <Card title="الصمامات المعتمدة على محفظة الظل" icon={<ShieldCheck className="w-4 h-4" />}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <FuseCard label="الصمام اليومي" value="خسارة ≥ 30$ (3% من 1000$)" action="منع دخول جديد لبقية اليوم السوري — المفتوحة تبقى على وقفها وهدفها" trips={live.fuseTrips.daily} />
              <FuseCard label="الصمام الأسبوعي" value="خسارة ≥ 60$ (6% من 1000$)" action="منع دخول جديد لبقية الأسبوع — المفتوحة تبقى على وقفها وهدفها" trips={live.fuseTrips.weekly} />
              <FuseCard label="حاجز الكارثة" value="إيكويتي دون 500$ (50% من الأساس)" action="منع دخول جديد مع دورة تجريبية كل 30 يوماً — العتبة أبعد من أدنى إيكويتي متحقق (548$)" trips={live.fuseTrips.equity} />
            </div>
          </Card>

          {/* ======= آخر الصفقات ======= */}
          <Card title="آخر صفقات المحفظة الظلية" icon={<Zap className="w-4 h-4" />}>
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-[#8a94a6] text-[10px] border-b border-[#1b2334]">
                    <th className="text-right py-2 px-2 font-bold">المكوّن</th>
                    <th className="text-right py-2 px-2 font-bold">الاتجاه</th>
                    <th className="text-right py-2 px-2 font-bold">دخول</th>
                    <th className="text-right py-2 px-2 font-bold">خروج</th>
                    <th className="text-right py-2 px-2 font-bold">النتيجة</th>
                    <th className="text-right py-2 px-2 font-bold">السبب</th>
                    <th className="text-right py-2 px-2 font-bold">الاحتفاظ</th>
                    <th className="text-right py-2 px-2 font-bold">توقيت دمشق</th>
                  </tr>
                </thead>
                <tbody>
                  {live.lastTrades.map((t, i) => (
                    <tr key={i} className="border-b border-[#131a2a] hover:bg-[#101726]">
                      <td className="py-2 px-2 font-bold text-[#e9edf4]">{COMP_AR[t.comp] ?? t.comp}</td>
                      <td className={cn('py-2 px-2 font-bold', t.dir === 1 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{t.dir === 1 ? 'شراء ▲' : 'بيع ▼'}</td>
                      <td className="py-2 px-2 font-mono">{t.entry.toFixed(2)}</td>
                      <td className="py-2 px-2 font-mono">{t.exit.toFixed(2)}</td>
                      <td className={cn('py-2 px-2 font-mono font-black', t.pnl >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{money(t.pnl)}</td>
                      <td className="py-2 px-2 text-[#8a94a6]">{WHY_AR[t.why] ?? t.why}</td>
                      <td className="py-2 px-2 font-mono text-[#8a94a6]">{t.heldH}س</td>
                      <td className="py-2 px-2 font-mono text-[10px] text-[#8a94a6]" dir="ltr">{dt(t.exitT)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="rounded-xl border border-[#2a3550] bg-[#0d1220]/60 p-3.5 flex items-start gap-3">
            <Scale className="w-4.5 h-4.5 text-[#8a94a6] shrink-0 mt-0.5" />
            <p className="text-[11.5px] text-[#8a94a6] leading-relaxed">
              <b className="text-[#e9edf4]">كيف تقرأ هذه اللوحة:</b> المحفظة الظلية تحاكي السلة المعتمدة على أساس افتراضي 1000$ بشموع حقيقية لحظية،
              لتقارن أداءها بأداء محرك TAMSA الرسمي قبل أي قرار بنقلها للحساب الحقيقي (190$).
              EWMAC ودونشييان تحت المراقبة في جدول التحقق ولا تدخل إيكويتي المحفظة إلا بقرارك.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function KPI({ label, value, cls, sub }: { label: string; value: string; cls?: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-2.5">
      <div className="text-[9.5px] text-[#8a94a6] mb-0.5">{label}</div>
      <div className={cn('font-mono font-black text-[16px] leading-tight', cls ?? 'text-[#e9edf4]')}>{value}</div>
      {sub && <div className="text-[9px] text-[#5a6474] mt-0.5">{sub}</div>}
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
      <div className="flex items-center gap-2 mb-3 text-[#d9b45c]">
        {icon}
        <h3 className="text-[13px] font-bold text-[#e9edf4]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function MetricsGrid({ m }: { m: Metrics }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <MiniStat label="صفقات" value={`${m.n}`} />
      <MiniStat label="نجاح" value={`${m.wr.toFixed(1)}%`} />
      <MiniStat label="PF" value={m.pf >= 99 ? '∞' : m.pf.toFixed(2)} />
      <MiniStat label="صافي" value={money(m.net)} cls={m.net >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'} />
      <MiniStat label="أقصى DD" value={`${m.dd.toFixed(0)}$`} sub={`${m.ddp.toFixed(1)}% من الأساس`} />
      <MiniStat label="توقع/شهر" value={money(m.net / 12)} cls={m.net >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'} sub="على أساس سنة" />
    </div>
  );
}

function MiniStat({ label, value, cls, sub }: { label: string; value: string; cls?: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-2 text-center">
      <div className="text-[9px] text-[#8a94a6]">{label}</div>
      <div className={cn('font-mono font-black text-[13px]', cls ?? 'text-[#e9edf4]')}>{value}</div>
      {sub && <div className="text-[8.5px] text-[#5a6474]">{sub}</div>}
    </div>
  );
}

function ValTable({ title, rows }: { title: string; rows: VRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="mb-3">
      <div className="text-[11px] font-bold text-[#d9b45c] mb-1.5">{title}</div>
      <div className="overflow-x-auto rounded-lg border border-[#1b2334]">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[#8a94a6] text-[9.5px] bg-[#101726] border-b border-[#1b2334]">
              <th className="text-right py-2 px-2.5 font-bold">المكوّن/السلة</th>
              <th className="text-center py-2 px-2 font-bold">صفقات</th>
              <th className="text-center py-2 px-2 font-bold">نجاح%</th>
              <th className="text-center py-2 px-2 font-bold">PF</th>
              <th className="text-center py-2 px-2 font-bold">صافي$</th>
              <th className="text-center py-2 px-2 font-bold">DD$</th>
              <th className="text-center py-2 px-2 font-bold">DD% من 1000$</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={cn('border-b border-[#131a2a]', r.name.includes('سلة A') && 'bg-[#d9b45c]/5')}>
                <td className={cn('py-1.5 px-2.5 font-bold', r.name.includes('سلة A') ? 'text-[#d9b45c]' : 'text-[#e9edf4]')}>{r.name}</td>
                <td className="py-1.5 px-2 text-center font-mono">{r.m.n}</td>
                <td className="py-1.5 px-2 text-center font-mono">{r.m.wr.toFixed(1)}</td>
                <td className="py-1.5 px-2 text-center font-mono">{r.m.pf >= 99 ? '∞' : r.m.pf.toFixed(2)}</td>
                <td className={cn('py-1.5 px-2 text-center font-mono font-bold', r.m.net >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{r.m.net.toFixed(1)}</td>
                <td className="py-1.5 px-2 text-center font-mono text-[#e8a33d]">{r.m.dd.toFixed(0)}</td>
                <td className="py-1.5 px-2 text-center font-mono text-[#e8a33d]">{r.m.ddp.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FuseCard({ label, value, action, trips }: { label: string; value: string; action: string; trips: number }) {
  return (
    <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-black text-[#e9edf4]">{label}</span>
        <span className={cn('text-[9.5px] font-bold rounded px-1.5 py-px', trips > 0 ? 'text-[#e8a33d] bg-[#e8a33d]/10' : 'text-[#2ebd85] bg-[#2ebd85]/10')}>
          {trips > 0 ? `ضرب ${trips} مرة` : 'لم يضرب'}
        </span>
      </div>
      <div className="text-[10.5px] font-mono text-[#d9b45c] mb-1">{value}</div>
      <div className="text-[9.5px] text-[#8a94a6] leading-relaxed">{action}</div>
    </div>
  );
}
