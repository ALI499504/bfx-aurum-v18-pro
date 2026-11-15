'use client';
// ============================================================
// بطاقة تقرير الباك تيست داخل كونسول جارفس
// تُغذّى من نتائج الأداة الحقيقية (شموع XAUUSD من MT5) عبر حقل
// data.backtest في حدث الرد — أرقام فعلية بلا أي تزيين: الإحصاءات،
// منحنى رأس المال، أداء الشهور، ترتيب الاستراتيجيات، وآخر الصفقات.
// ============================================================
import { useMemo } from 'react';
import { FlaskConical, TrendingUp, TrendingDown, Layers, Activity, BarChart3 } from 'lucide-react';

interface BtTrade {
  strategy?: string; dir?: string; entry?: number; exit?: number;
  result?: string; pnl?: number; entryT?: number; exitT?: number; lot?: number;
}
interface BtStats {
  totalTrades?: number; wins?: number; losses?: number; winRate?: number;
  netPnl?: number; finalBalance?: number; baseBalance?: number;
  profitFactor?: number; maxDrawdownPct?: number; runMs?: number;
  startT?: number; endT?: number;
  monthly?: { month: string; net: number; pct: number }[];
  ranking?: { strategy: string; net: number; winRate: number; trades: number }[];
  equity?: { t: number; v: number }[];
}
export interface BacktestData {
  year?: number | null;
  period?: { from: string; to: string } | null;
  stats?: BtStats;
  trades?: BtTrade[];
  coverage?: { symbol?: string; from?: string; to?: string } | null;
}

const RESULT_AR: Record<string, string> = {
  tp: 'هدف', sl: 'وقف', time: 'زمن', dayend: 'إغلاق يوم', news: 'أخبار',
};
const RESULT_CLS: Record<string, string> = {
  tp: 'text-[#2ebd85] border-[#2ebd85]/40 bg-[#2ebd85]/10',
  sl: 'text-[#f6465d] border-[#f6465d]/40 bg-[#f6465d]/10',
  time: 'text-[#8a94a6] border-[#1b2334] bg-[#0a0e17]',
  dayend: 'text-[#8a94a6] border-[#1b2334] bg-[#0a0e17]',
  news: 'text-[#d9b45c] border-[#d9b45c]/40 bg-[#d9b45c]/10',
};
const fmtD = (t?: number) => (t ? new Date(t).toLocaleDateString('ar', { day: '2-digit', month: '2-digit' }) : '');

export default function BacktestCard({ data }: { data: BacktestData }) {
  const s = data.stats ?? {};
  const eq = s.equity ?? [];
  const monthly = s.monthly ?? [];
  const ranking = (s.ranking ?? []).filter(r => r.trades > 0);
  const trades = (data.trades ?? []).slice(-6).reverse();
  const net = s.netPnl ?? 0;
  const positive = net >= 0;

  // هندسة منحنى رأس المال — SVG صغير داخل البطاقة
  const eqPath = useMemo(() => {
    if (eq.length < 2) return null;
    const W = 560, H = 90;
    const vs = eq.map(p => p.v);
    const min = Math.min(...vs), max = Math.max(...vs);
    const span = max - min || 1;
    const pts = eq.map((p, i) => ({
      x: (i / (eq.length - 1)) * W,
      y: H - 6 - ((p.v - min) / span) * (H - 16),
    }));
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return { line, area: `${line} L${W},${H} L0,${H} Z`, min, max, W, H };
  }, [eq]);

  const maxAbsMonth = Math.max(1, ...monthly.map(m => Math.abs(m.net)));

  const chip = (label: string, value: string, cls = 'text-[#f3dc9a]') => (
    <div className="rounded-lg border border-[#1b2334] bg-[#0a0e17] px-3 py-2 text-center min-w-[86px] flex-1">
      <div className="text-[9.5px] font-mono tracking-wider text-[#8a94a6]">{label}</div>
      <div className={`text-[15px] font-black font-mono tabular-nums leading-tight mt-0.5 ${cls}`}>{value}</div>
    </div>
  );

  return (
    <div className="rounded-xl border border-[#d9b45c]/35 bg-gradient-to-b from-[#0c1120] to-[#070a12] overflow-hidden">
      {/* الترويسة */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[#d9b45c]/20 bg-[#d9b45c]/5 flex-wrap">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-[#d9b45c]" />
          <div>
            <div className="text-[12.5px] font-black text-[#d9b45c]">
              باك تيست {data.year ? `سنة ${data.year}` : 'كل التاريخ المتوفر'} — شموع XAUUSD الحقيقية
            </div>
            <div className="text-[10px] font-mono text-[#8a94a6]">
              {data.coverage?.symbol ?? 'XAUUSD'} · MT5
              {data.period ? ` · ${data.period.from.slice(0, 10)} → ${data.period.to.slice(0, 10)}` : ''}
              {s.runMs ? ` · حُسب في ${(s.runMs / 1000).toFixed(2)}ث` : ''}
            </div>
          </div>
        </div>
        <div className={`text-[11px] font-black font-mono px-2.5 py-1 rounded border ${positive ? 'text-[#2ebd85] border-[#2ebd85]/40 bg-[#2ebd85]/10' : 'text-[#f6465d] border-[#f6465d]/40 bg-[#f6465d]/10'}`}>
          {positive ? '+' : ''}{net.toFixed(1)}$ صافي
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* الإحصاءات الأساسية */}
        <div className="flex flex-wrap gap-2">
          {chip('الصفقات', String(s.totalTrades ?? 0))}
          {chip('النجاح', `${(s.winRate ?? 0).toFixed(1)}%`, (s.winRate ?? 0) >= 50 ? 'text-[#2ebd85]' : 'text-[#f3dc9a]')}
          {chip('معامل الربح PF', (s.profitFactor ?? 0).toFixed(2), (s.profitFactor ?? 0) >= 1 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}
          {chip('أقصى تراجع', `${(s.maxDrawdownPct ?? 0).toFixed(1)}%`, 'text-[#f6465d]')}
          {chip('الرصيد', `${(s.baseBalance ?? 0).toFixed(0)}$ → ${(s.finalBalance ?? 0).toFixed(1)}$`)}
        </div>

        {/* منحنى رأس المال */}
        {eqPath && (
          <div className="rounded-lg border border-[#1b2334] bg-[#0a0e17] p-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Activity className="w-3.5 h-3.5 text-[#d9b45c]" />
              <span className="text-[10.5px] font-bold text-[#8a94a6]">منحنى رأس المال (كل إغلاق صفقة)</span>
            </div>
            <svg viewBox={`0 0 ${eqPath.W} ${eqPath.H}`} className="w-full h-[90px] direction-ltr" preserveAspectRatio="none">
              <defs>
                <linearGradient id="bt-eq-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={positive ? '#2ebd85' : '#f6465d'} stopOpacity="0.35" />
                  <stop offset="100%" stopColor={positive ? '#2ebd85' : '#f6465d'} stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <path d={eqPath.area} fill="url(#bt-eq-fill)" />
              <path d={eqPath.line} fill="none" stroke={positive ? '#2ebd85' : '#f6465d'} strokeWidth="1.6" />
            </svg>
            <div className="flex justify-between text-[9.5px] font-mono text-[#8a94a6] direction-ltr">
              <span>{eqPath.min.toFixed(0)}$</span>
              <span>{eqPath.max.toFixed(0)}$</span>
            </div>
          </div>
        )}

        {/* أداء الشهور + ترتيب الاستراتيجيات */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {monthly.length > 0 && (
            <div className="rounded-lg border border-[#1b2334] bg-[#0a0e17] p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-[#d9b45c]" />
                <span className="text-[10.5px] font-bold text-[#8a94a6]">الصافي الشهري ($)</span>
              </div>
              <div className="space-y-1 max-h-[132px] overflow-y-auto custom-scrollbar">
                {monthly.map(m => (
                  <div key={m.month} className="flex items-center gap-2">
                    <span className="text-[9.5px] font-mono text-[#8a94a6] w-11 shrink-0">{m.month}</span>
                    <div className="flex-1 h-[9px] rounded bg-[#131a2a] overflow-hidden">
                      <div
                        className={`h-full rounded ${m.net >= 0 ? 'bg-[#2ebd85]' : 'bg-[#f6465d]'}`}
                        style={{ width: `${Math.min(100, (Math.abs(m.net) / maxAbsMonth) * 100)}%` }}
                      />
                    </div>
                    <span className={`text-[9.5px] font-mono tabular-nums w-14 text-end ${m.net >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'}`}>
                      {m.net >= 0 ? '+' : ''}{m.net.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {ranking.length > 0 && (
            <div className="rounded-lg border border-[#1b2334] bg-[#0a0e17] p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Layers className="w-3.5 h-3.5 text-[#d9b45c]" />
                <span className="text-[10.5px] font-bold text-[#8a94a6]">ترتيب الاستراتيجيات بالصافي</span>
              </div>
              <div className="space-y-1">
                {ranking.slice(0, 5).map((r, i) => (
                  <div key={r.strategy} className="flex items-center gap-2 text-[10.5px]">
                    <span className={`w-5 h-5 rounded grid place-items-center font-black text-[10px] ${i === 0 ? 'bg-[#d9b45c] text-[#070a12]' : 'bg-[#131a2a] text-[#8a94a6]'}`}>{r.strategy}</span>
                    <span className="flex-1 font-mono tabular-nums text-[#e8e4d8]">{r.trades} صفقة · نجاح {r.winRate.toFixed(0)}%</span>
                    <span className={`font-mono tabular-nums font-bold ${r.net >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'}`}>
                      {r.net >= 0 ? '+' : ''}{r.net.toFixed(1)}$
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* آخر الصفقات */}
        {trades.length > 0 && (
          <div className="rounded-lg border border-[#1b2334] bg-[#0a0e17] p-2.5">
            <div className="text-[10.5px] font-bold text-[#8a94a6] mb-1.5">آخر الصفقات المنفذة في المحاكاة</div>
            <div className="space-y-1">
              {trades.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-[10.5px] font-mono">
                  {t.dir === 'buy'
                    ? <TrendingUp className="w-3.5 h-3.5 text-[#2ebd85] shrink-0" />
                    : <TrendingDown className="w-3.5 h-3.5 text-[#f6465d] shrink-0" />}
                  <span className="text-[#d9b45c] font-bold w-4">{t.strategy}</span>
                  <span className="text-[#8a94a6]">{t.dir === 'buy' ? 'شراء' : 'بيع'}</span>
                  <span className="text-[#e8e4d8] tabular-nums">{(t.entry ?? 0).toFixed(2)} → {(t.exit ?? 0).toFixed(2)}</span>
                  <span className="text-[#8a94a6] text-[9.5px]">{fmtD(t.entryT)}</span>
                  <span className="flex-1" />
                  <span className={`text-[9.5px] px-1.5 py-0.5 rounded border ${RESULT_CLS[t.result ?? 'time'] ?? RESULT_CLS.time}`}>
                    {RESULT_AR[t.result ?? ''] ?? t.result}
                  </span>
                  <span className={`tabular-nums font-bold w-14 text-end ${(t.pnl ?? 0) >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'}`}>
                    {(t.pnl ?? 0) >= 0 ? '+' : ''}{(t.pnl ?? 0).toFixed(2)}$
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
