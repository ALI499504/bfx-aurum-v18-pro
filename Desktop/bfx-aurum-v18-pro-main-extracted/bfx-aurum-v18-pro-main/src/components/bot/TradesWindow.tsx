'use client';

// سجل الصفقات — مصدران: صفقات MT5 الحقيقية من طرفيتك (مفتوحة + سجل منفذ) وصفقات الباك تيست
// اضغط أي صفقة لفتح تقريرها الكامل مع الشارت الحقيقي وتفاصيلها
import { useEffect, useMemo, useState } from 'react';
import { useBot, STRATEGY_NAMES, SESSION_AR } from './store';
import type { Trade } from '@/lib/engine/types';
import { TradeChart } from './TradeChart';
import { cn } from '@/lib/utils';
import { ReceiptText, ChevronRight, ChevronLeft, RefreshCw, RadioTower, FlaskConical } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const PAGE_SIZE = 50;

const RESULT_AR: Record<Trade['result'], string> = {
  tp: 'تحقق الهدف', sl: 'وقف خسارة', time: 'انتهاء الوقت', dayend: 'إغلاق اليوم', news: 'فلتر الأخبار', rule: 'خروج القاعدة',
};
const RESULT_CLS: Record<Trade['result'], string> = {
  tp: 'text-[#2ebd85] border-[#2ebd85]/40 bg-[#2ebd85]/10',
  sl: 'text-[#f6465d] border-[#f6465d]/40 bg-[#f6465d]/10',
  time: 'text-[#8a94a6] border-[#2a3550] bg-[#141a29]',
  dayend: 'text-[#e8a33d] border-[#e8a33d]/40 bg-[#e8a33d]/10',
  news: 'text-[#c9a0e8] border-[#c9a0e8]/40 bg-[#c9a0e8]/10',
  rule: 'text-[#5bb8d4] border-[#5bb8d4]/40 bg-[#5bb8d4]/10',
};

function fmtDT(t: number) {
  return new Date(t + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
}
function fmtDur(ms: number) {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3600e3), m = Math.round((ms % 3600e3) / 60e3);
  if (h >= 24) return `${Math.floor(h / 24)}ي ${h % 24}س`;
  if (h > 0) return `${h}س ${m}د`;
  return `${m}د`;
}
function dirBadge(dir: 'buy' | 'sell') {
  return (
    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border',
      dir === 'buy' ? 'text-[#2ebd85] border-[#2ebd85]/40 bg-[#2ebd85]/10' : 'text-[#f6465d] border-[#f6465d]/40 bg-[#f6465d]/10')}>
      {dir === 'buy' ? 'شراء ▲' : 'بيع ▼'}
    </span>
  );
}

// ---------- أنواع بيانات MT5 الحقيقية ----------
interface Mt5OpenTrade {
  position: number; dir: 'buy' | 'sell'; volume: number;
  openT: number; openPrice: number; currentPrice: number;
  sl: number; tp: number; floating: number; swap: number; comment: string;
}
interface Mt5ClosedTrade {
  position: number; dir: 'buy' | 'sell'; volume: number;
  openT: number; closeT: number; openPrice: number; closePrice: number;
  sl: number; tp: number; profit: number; comment: string; dealsCount: number;
}
interface Mt5Data {
  connected: boolean;
  symbol?: string; broker?: string | null;
  bridgeV?: number | null;
  account?: {
    login?: string; server?: string; company?: string; currency?: string;
    leverage?: number; balance?: number; equity?: number; profit?: number;
    margin?: number; marginFree?: number; marginLevel?: number;
  };
  tick?: { bid: number; ask: number; time: number } | null;
  openTrades?: Mt5OpenTrade[];
  closedTrades?: Mt5ClosedTrade[];
  updatedAt?: number | null;
}

export function TradesWindow() {
  const { trades, stats } = useBot();
  const [src, setSrc] = useState<'mt5' | 'bt'>('mt5');
  const [live, setLive] = useState<Mt5Data | null>(null);
  const [mt5Sel, setMt5Sel] = useState<{ kind: 'open' | 'closed'; t: Mt5OpenTrade | Mt5ClosedTrade } | null>(null);

  // بيانات MT5 الحقيقية — تحديث كل 5 ثوانٍ
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

  const openT_ = live?.openTrades ?? [];
  const closedT = live?.closedTrades ?? [];
  const floating = openT_.reduce((s, t) => s + t.floating, 0);
  const closedNet = closedT.reduce((s, t) => s + t.profit, 0);

  return (
    <div className="space-y-4">
      {/* الرأس + اختيار المصدر */}
      <div className="rounded-xl border border-[#1b2334] bg-gradient-to-l from-[#0d1220] to-[#101726] p-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-lg bg-[#d9b45c]/12 border border-[#d9b45c]/30 flex items-center justify-center">
            <ReceiptText className="w-4 h-4 text-[#d9b45c]" />
          </div>
          <div>
            <h2 className="text-[15px] font-bold">سجل الصفقات</h2>
            <p className="text-[10.5px] text-[#8a94a6]">اضغط على أي صفقة لفتح تقريرها الكامل مع الشارت الحقيقي وتفاصيلها</p>
          </div>
          {/* مفتاح المصدر */}
          <div className="mr-auto flex rounded-lg border border-[#2a3550] bg-[#101726] p-1 gap-1">
            <button onClick={() => setSrc('mt5')}
              className={cn('flex items-center gap-1.5 text-[11.5px] font-bold px-3 py-1.5 rounded-md transition-colors',
                src === 'mt5' ? 'bg-[#2ebd85]/15 text-[#2ebd85] border border-[#2ebd85]/40' : 'text-[#8a94a6] hover:text-[#e9edf4] border border-transparent')}>
              <RadioTower className="w-3.5 h-3.5" />
              MT5 الحقيقية
              <span className={cn('w-1.5 h-1.5 rounded-full', live?.connected ? 'bg-[#2ebd85] animate-pulse' : 'bg-[#f6465d]')} />
            </button>
            <button onClick={() => setSrc('bt')}
              className={cn('flex items-center gap-1.5 text-[11.5px] font-bold px-3 py-1.5 rounded-md transition-colors',
                src === 'bt' ? 'bg-[#d9b45c]/15 text-[#d9b45c] border border-[#d9b45c]/40' : 'text-[#8a94a6] hover:text-[#e9edf4] border border-transparent')}>
              <FlaskConical className="w-3.5 h-3.5" />
              الباك تيست {stats ? `(${stats.totalTrades})` : ''}
            </button>
          </div>
        </div>

        {src === 'mt5' && live?.connected && (
          <div className="flex flex-wrap gap-2 mt-3">
            <Chip label="الرمز" value={live.symbol ?? 'XAUUSD'} />
            <Chip label="الحساب" value={live.account?.login ? `#${live.account.login}` : '—'} />
            <Chip label="صفقات مفتوحة" value={`${openT_.length}`} cls={openT_.length ? 'text-[#d9b45c]' : undefined} />
            <Chip label="ربح عائم" value={`${floating >= 0 ? '+' : ''}${floating.toFixed(2)}$`} cls={floating >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'} />
            <Chip label="صفقات مغلقة" value={`${closedT.length}`} />
            <Chip label="صافي المغلقة" value={`${closedNet >= 0 ? '+' : ''}${closedNet.toFixed(2)}$`} cls={closedNet >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'} />
            <Chip label="المصدر" value="طرفية MT5 — بيانات حقيقية" cls="text-[#8a94a6]" />
          </div>
        )}
        {src === 'bt' && trades.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            <Chip label="الصفقات المعروضة" value={stats && stats.totalTrades > trades.length ? `${trades.length} من ${stats.totalTrades}` : `${trades.length}`} />
            <Chip label="رابحة" value={`${trades.filter(t => t.pnl > 0).length}`} cls="text-[#2ebd85]" />
            <Chip label="خاسرة" value={`${trades.filter(t => t.pnl <= 0).length}`} cls="text-[#f6465d]" />
            <Chip label="الصافي" value={`${trades.reduce((s, t) => s + t.pnl, 0) >= 0 ? '+' : ''}${trades.reduce((s, t) => s + t.pnl, 0).toFixed(2)}$`}
              cls={trades.reduce((s, t) => s + t.pnl, 0) >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]'} />
            {stats && <Chip label="معدل النجاح" value={`${stats.winRate.toFixed(1)}%`} />}
          </div>
        )}
      </div>

      {src === 'mt5'
        ? <Mt5View live={live} openT={openT_} closedT={closedT} onSelect={setMt5Sel} />
        : <BacktestView />}
      {/* تقرير صفقة MT5 الحقيقية */}
      <Dialog open={!!mt5Sel} onOpenChange={o => !o && setMt5Sel(null)}>
        <DialogContent className="max-w-3xl bg-[#0d1220] border-[#1b2334] text-[#e9edf4] p-0 overflow-hidden max-h-[92vh] overflow-y-auto">
          {mt5Sel && (mt5Sel.kind === 'open'
            ? <Mt5Report t={mt5Sel.t as Mt5OpenTrade} open live={live} />
            : <Mt5Report t={mt5Sel.t as Mt5ClosedTrade} live={live} />)}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== عرض صفقات MT5 الحقيقية ====================
function Mt5View({ live, openT, closedT, onSelect }: {
  live: Mt5Data | null;
  openT: Mt5OpenTrade[]; closedT: Mt5ClosedTrade[];
  onSelect: (t: { kind: 'open' | 'closed'; t: Mt5OpenTrade | Mt5ClosedTrade }) => void;
}) {
  if (!live || !live.connected) {
    return (
      <div className="rounded-xl border border-dashed border-[#2a3550] bg-[#0d1220]/60 py-14 flex flex-col items-center gap-3 text-center px-6">
        <RadioTower className="w-10 h-10 text-[#2a3550]" />
        <p className="text-[13.5px] font-bold text-[#d9b45c]">لا يوجد اتصال بطرفية MT5 الآن</p>
        <p className="text-[12px] text-[#8a94a6] max-w-[520px] leading-relaxed">
          هذه الصفحة تعرض صفقاتك الحقيقية فقط من طرفية MetaTrader 5 على جهازك: الصفقات المفتوحة الآن بسعرها اللحظي،
          وسجل الصفقات المنفذة (آخر 60 يوماً) — كل قيمة هنا من وسيطك مباشرة، لا شيء محاكاة.
          شغّل أمر الربط في CMD على الكمبيوتر ليبدأ البث.
        </p>
      </div>
    );
  }

  const now = Date.now();
  // جسر قديم فعلاً؟ (لا يعلن عن إصداره ولا يبث رصيداً) — أما v18+ فقد تفشل قراءة
  // حساب لحظية فقط (الطرفية مشغولة) ويرسل آخر قراءة ناجحة تلقائياً — لا تحذير عندئذٍ
  const legacyBridge = typeof live?.account?.balance !== 'number' && !(live?.bridgeV != null && live.bridgeV >= 18);

  return (
    <>
      {legacyBridge && (
        <div className="rounded-xl border border-[#e8a33d]/40 bg-[#e8a33d]/10 p-3.5 flex items-start gap-3">
          <RadioTower className="w-5 h-5 text-[#e8a33d] shrink-0 mt-0.5" />
          <div>
            <p className="text-[12.5px] font-bold text-[#e8a33d] mb-0.5">الجسر متصل — لكن نسخة أقدم لا تبث صفقاتك ورصيدك الحقيقي</p>
            <p className="text-[11.5px] text-[#8a94a6] leading-relaxed">
              أعد تنفيذ أمر CMD نفسه على جهازك — سيتم تحديث الجسر تلقائياً إلى النسخة v18 التي تبث الصفقات المفتوحة
              وسجل الصفقات المنفذة (60 يوماً) ورصيد الحساب وحقوق الملكية، وتُعرض هنا مباشرة.
            </p>
          </div>
        </div>
      )}
      {/* الصفقات المفتوحة */}
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] overflow-hidden">
        <div className="px-3 py-2 border-b border-[#1b2334] bg-[#101726] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#2ebd85] animate-pulse" />
          <h3 className="text-[12.5px] font-bold">الصفقات المفتوحة الآن — من طرفيتك مباشرة</h3>
          <span className="text-[10px] text-[#8a94a6] mr-auto">الربح العائم يتحدث كل 5 ثوانٍ</span>
        </div>
        {openT.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-[#1b2334] bg-[#101726] hover:bg-[#101726]">
                  {['التذكرة', 'الاتجاه', 'اللوت', 'سعر الفتح', 'السعر الحالي', 'وقف', 'هدف', 'العائم', 'السواب', 'المدة', ''].map(h => (
                    <TableHead key={h} className="text-right text-[10.5px] font-bold text-[#8a94a6] h-9 whitespace-nowrap">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {openT.map(t => (
                  <TableRow key={t.position} onClick={() => onSelect({ kind: 'open', t })}
                    className="border-b border-[#151d2e] cursor-pointer hover:bg-[#131a2b]/80 transition-colors">
                    <TableCell className="font-mono text-[11px] text-[#5a6474] py-2" dir="ltr">{t.position}</TableCell>
                    <TableCell className="py-2">{dirBadge(t.dir)}</TableCell>
                    <TableCell className="font-mono text-[11.5px] text-[#e9edf4] py-2">{t.volume.toFixed(2)}</TableCell>
                    <TableCell className="font-mono text-[11.5px] text-[#d9b45c] py-2">{t.openPrice.toFixed(2)}</TableCell>
                    <TableCell className="font-mono text-[11.5px] text-[#e9edf4] py-2">{t.currentPrice.toFixed(2)}</TableCell>
                    <TableCell className="font-mono text-[11px] text-[#f6465d]/90 py-2">{t.sl > 0 ? t.sl.toFixed(2) : '—'}</TableCell>
                    <TableCell className="font-mono text-[11px] text-[#2ebd85]/90 py-2">{t.tp > 0 ? t.tp.toFixed(2) : '—'}</TableCell>
                    <TableCell className={cn('font-mono font-bold text-[12px] py-2', t.floating >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>
                      {t.floating >= 0 ? '+' : ''}{t.floating.toFixed(2)}$
                    </TableCell>
                    <TableCell className="font-mono text-[10.5px] text-[#8a94a6] py-2">{t.swap ? t.swap.toFixed(2) : '—'}</TableCell>
                    <TableCell className="font-mono text-[10.5px] text-[#8a94a6] py-2">{fmtDur(now - t.openT)}</TableCell>
                    <TableCell className="py-2"><span className="text-[10px] text-[#8a94a6] border border-[#2a3550] rounded px-1.5 py-0.5">تفاصيل</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="px-3 py-6 text-center text-[12px] text-[#8a94a6]">لا صفقات مفتوحة على الذهب الآن</div>
        )}
      </div>

      {/* سجل الصفقات المغلقة */}
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] overflow-hidden">
        <div className="px-3 py-2 border-b border-[#1b2334] bg-[#101726] flex items-center gap-2">
          <h3 className="text-[12.5px] font-bold">سجل الصفقات المغلقة — من سجل طرفيتك (آخر 60 يوماً)</h3>
          <span className="text-[10px] text-[#8a94a6] mr-auto">{closedT.length} صفقة حقيقية</span>
        </div>
        {closedT.length ? (
          <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-[#1b2334] bg-[#101726] hover:bg-[#101726]">
                  {['المركز', 'الاتجاه', 'اللوت', 'الفتح', 'الإغلاق', 'سعر الدخول', 'سعر الخروج', 'وقف', 'هدف', 'الصافي', 'المدة', ''].map(h => (
                    <TableHead key={h} className="text-right text-[10.5px] font-bold text-[#8a94a6] h-9 whitespace-nowrap">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {closedT.slice(0, 300).map(t => (
                  <TableRow key={t.position} onClick={() => onSelect({ kind: 'closed', t })}
                    className="border-b border-[#151d2e] cursor-pointer hover:bg-[#131a2b]/80 transition-colors">
                    <TableCell className="font-mono text-[11px] text-[#5a6474] py-2" dir="ltr">{t.position}</TableCell>
                    <TableCell className="py-2">{dirBadge(t.dir)}</TableCell>
                    <TableCell className="font-mono text-[11.5px] text-[#e9edf4] py-2">{t.volume.toFixed(2)}</TableCell>
                    <TableCell className="font-mono text-[10.5px] text-[#8a94a6] py-2 whitespace-nowrap" dir="ltr">{fmtDT(t.openT)}</TableCell>
                    <TableCell className="font-mono text-[10.5px] text-[#8a94a6] py-2 whitespace-nowrap" dir="ltr">{fmtDT(t.closeT)}</TableCell>
                    <TableCell className="font-mono text-[11.5px] text-[#d9b45c] py-2">{t.openPrice.toFixed(2)}</TableCell>
                    <TableCell className="font-mono text-[11.5px] text-[#e9edf4] py-2">{t.closePrice.toFixed(2)}</TableCell>
                    <TableCell className="font-mono text-[11px] text-[#f6465d]/90 py-2">{t.sl > 0 ? t.sl.toFixed(2) : '—'}</TableCell>
                    <TableCell className="font-mono text-[11px] text-[#2ebd85]/90 py-2">{t.tp > 0 ? t.tp.toFixed(2) : '—'}</TableCell>
                    <TableCell className={cn('font-mono font-bold text-[12px] py-2', t.profit >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>
                      {t.profit >= 0 ? '+' : ''}{t.profit.toFixed(2)}$
                    </TableCell>
                    <TableCell className="font-mono text-[10.5px] text-[#8a94a6] py-2">{fmtDur(t.closeT - t.openT)}</TableCell>
                    <TableCell className="py-2"><span className="text-[10px] text-[#8a94a6] border border-[#2a3550] rounded px-1.5 py-0.5">تفاصيل</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {closedT.length > 300 && (
              <div className="px-3 py-2 text-[10.5px] text-[#8a94a6] border-t border-[#151d2e]">يُعرض أحدث 300 صفقة من {closedT.length}</div>
            )}
          </div>
        ) : (
          <div className="px-3 py-6 text-center text-[12px] text-[#8a94a6]">لا صفقات مغلقة في سجل آخر 60 يوماً على رمز الذهب</div>
        )}
      </div>
    </>
  );
}

// ==================== تقرير صفقة MT5 حقيقية ====================
function Mt5Report({ t, open, live }: { t: Mt5OpenTrade | Mt5ClosedTrade; open?: boolean; live: Mt5Data | null }) {
  const isOpen = !!open;
  const isO = t as Mt5OpenTrade;
  const isC = t as Mt5ClosedTrade;
  const now = Date.now();
  const endT = isOpen ? now : isC.closeT;
  const durH = (endT - t.openT) / 3600e3;
  const tf = durH < 8 ? '5m' : durH < 36 ? '15m' : durH < 150 ? '1h' : '4h';
  const pnl = isOpen ? isO.floating : isC.profit;
  const [chart, setChart] = useState<{ candles: { t: number; o: number; h: number; l: number; c: number }[] } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/chart?tf=${tf}&from=${t.openT}&to=${endT}`);
        if (!r.ok) return;
        const j = await r.json();
        if (alive) setChart(j);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [t, tf, endT]);

  const cur = isOpen ? isO.currentPrice : isC.closePrice;
  const pips = Math.abs(cur - t.openPrice) / 0.1;

  return (
    <div>
      <DialogHeader className="px-5 pt-5 pb-3 border-b border-[#1b2334] bg-gradient-to-l from-[#101726] to-[#0d1220]">
        <DialogTitle className="flex flex-wrap items-center gap-2 text-[15px]">
          <span className="text-[#d9b45c] font-bold">صفقة حقيقية #{t.position}</span>
          {dirBadge(t.dir)}
          <span className="text-[11px] text-[#8a94a6]">{live?.symbol ?? 'XAUUSD'} — {t.volume.toFixed(2)} لوت</span>
          <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border',
            isOpen ? 'text-[#d9b45c] border-[#d9b45c]/40 bg-[#d9b45c]/10' : 'text-[#8a94a6] border-[#2a3550] bg-[#141a29]')}>
            {isOpen ? 'مفتوحة الآن' : 'مغلقة'}
          </span>
          <span className={cn('font-mono font-black text-[16px] mr-auto', pnl >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}$
          </span>
        </DialogTitle>
        <DialogDescription className="text-[10.5px] text-[#8a94a6]">
          {isOpen ? 'فتحت' : 'فُتحت'} {fmtDT(t.openT)} (بتوقيت دمشق) · {isOpen ? 'جارية منذ' : 'أُغلقت بعد'} {fmtDur(endT - t.openT)}
          {' '}· بيانات حقيقية من وسيطك في MetaTrader 5
        </DialogDescription>
      </DialogHeader>

      <div className="p-5 space-y-4">
        {/* البطاقات */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Plan label="سعر الدخول" value={t.openPrice.toFixed(2)} cls="text-[#d9b45c]" />
          <Plan label={isOpen ? 'السعر الحالي' : 'سعر الإغلاق'} value={cur.toFixed(2)} sub={`${pips.toFixed(0)} بيب`} cls="text-[#e9edf4]" />
          <Plan label="وقف الخسارة" value={t.sl > 0 ? t.sl.toFixed(2) : '—'} cls="text-[#f6465d]" />
          <Plan label="الهدف" value={t.tp > 0 ? t.tp.toFixed(2) : '—'} cls="text-[#2ebd85]" />
        </div>

        {/* شارت الصفقة الحقيقي */}
        <div className="rounded-lg border border-[#1b2334] overflow-hidden">
          <div className="px-3 py-1.5 bg-[#101726] border-b border-[#1b2334] text-[10.5px] text-[#8a94a6]">
            الشارت الحقيقي حول فترة الصفقة — فريم {tf} · خطوط: دخول ذهبي / وقف أحمر / هدف أخضر / خروج رمادي
          </div>
          <div className="h-[240px]">
            {chart ? <TradeChart candles={chart.candles} entry={t.openPrice} sl={t.sl} tp={t.tp} dir={t.dir}
                exit={isOpen ? undefined : isC.closePrice} entryT={t.openT} exitT={isOpen ? undefined : isC.closeT} />
              : <div className="w-full h-full flex items-center justify-center text-[#8a94a6] text-xs">جارٍ تحميل شارت الصفقة...</div>}
          </div>
        </div>

        {/* تفاصيل إضافية */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Plan label="حجم اللوت" value={t.volume.toFixed(2)} />
          <Plan label="رقم المركز" value={`#${t.position}`} />
          <Plan label="السواب" value={isOpen ? (isO.swap || 0).toFixed(2) + '$' : 'ضمن الصافي'} />
          <Plan label="المصدر" value="MT5 — حقيقي" cls="text-[#8a94a6]" />
        </div>
        {t.comment && (
          <div className="rounded-lg border border-[#1b2334] bg-[#101726] p-3">
            <div className="text-[10.5px] font-bold text-[#d9b45c] mb-1">تعليق الوسيط</div>
            <p className="text-[12px] text-[#c8cfdb] font-mono" dir="ltr">{t.comment}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== عرض صفقات الباك تيست ====================
function BacktestView() {
  const { trades, stats, runBacktest, running } = useBot();
  const [fResult, setFResult] = useState('all');
  const [fDir, setFDir] = useState('all');
  const [fStrategy, setFStrategy] = useState('all');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Trade | null>(null);

  const filtered = useMemo(() => {
    return [...trades]
      .sort((a, b) => b.exitT - a.exitT)
      .filter(t => (fResult === 'all' || t.result === fResult)
        && (fDir === 'all' || t.dir === fDir)
        && (fStrategy === 'all' || t.strategy === fStrategy));
  }, [trades, fResult, fDir, fStrategy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const pick = (setter: (v: string) => void) => (v: string) => { setter(v); setPage(0); };

  if (!trades.length) {
    return (
      <div className="rounded-xl border border-dashed border-[#2a3550] bg-[#0d1220]/60 py-14 flex flex-col items-center gap-3">
        <FlaskConical className="w-10 h-10 text-[#2a3550]" />
        <p className="text-[13px] text-[#8a94a6]">لا توجد صفقات باك تيست بعد — شغّل محرك الاختبار على بيانات MT5 الحقيقية</p>
        <button onClick={() => { if (!running) runBacktest(); }} disabled={running}
          className="flex items-center gap-2 rounded-lg bg-[#d9b45c] hover:bg-[#e5c26e] disabled:opacity-60 text-[#0a0e17] font-bold text-[12.5px] px-4 py-2 transition-colors">
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
          {running ? 'جارٍ الاختبار...' : 'تشغيل الاختبار الآن'}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={fResult} onChange={pick(setFResult)} width="w-[150px]"
          options={[['all', 'كل النتائج'], ['tp', 'تحقق الهدف'], ['sl', 'وقف خسارة'], ['time', 'انتهاء الوقت'], ['dayend', 'إغلاق اليوم'], ['news', 'فلتر الأخبار']]} />
        <Select value={fDir} onChange={pick(setFDir)} width="w-[110px]"
          options={[['all', 'الكل: الاتجاه'], ['buy', 'شراء'], ['sell', 'بيع']]} />
        <Select value={fStrategy} onChange={pick(setFStrategy)} width="w-[230px]"
          options={[['all', 'كل الاستراتيجيات'], ...(Object.entries(STRATEGY_NAMES) as [string, string][]).map(([k, v]) => [k, `${k} — ${v}`] as [string, string])]} />
        <span className="text-[10.5px] text-[#8a94a6] mr-auto">{filtered.length} صفقة معروضة — على شموع XAUUSD الحقيقية</span>
      </div>

      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-[#1b2334] bg-[#101726] hover:bg-[#101726]">
                {['#', 'الاستراتيجية', 'الاتجاه', 'الجلسة', 'الدخول', 'الخروج', 'سعر الدخول', 'سعر الخروج', 'النتيجة', 'الربح/الخسارة', 'المدة'].map(h => (
                  <TableHead key={h} className="text-right text-[10.5px] font-bold text-[#8a94a6] h-9 whitespace-nowrap">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map(t => (
                <TableRow key={t.id} onClick={() => setSelected(t)}
                  className="border-b border-[#151d2e] cursor-pointer hover:bg-[#131a2b]/80 transition-colors">
                  <TableCell className="font-mono text-[11px] text-[#5a6474] py-2">{t.id}</TableCell>
                  <TableCell className="py-2">
                    <span className="text-[12px] font-bold text-[#d9b45c]">{t.strategy}</span>
                    <span className="block text-[9.5px] text-[#8a94a6] max-w-[170px] truncate">{STRATEGY_NAMES[t.strategy]}</span>
                  </TableCell>
                  <TableCell className="py-2">{dirBadge(t.dir)}</TableCell>
                  <TableCell className="text-[11px] text-[#8a94a6] py-2 whitespace-nowrap">{SESSION_AR[t.session]}</TableCell>
                  <TableCell className="font-mono text-[10.5px] text-[#8a94a6] py-2 whitespace-nowrap" dir="ltr">{fmtDT(t.entryT)}</TableCell>
                  <TableCell className="font-mono text-[10.5px] text-[#8a94a6] py-2 whitespace-nowrap" dir="ltr">{fmtDT(t.exitT)}</TableCell>
                  <TableCell className="font-mono text-[11.5px] text-[#e9edf4] py-2">{t.entry.toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-[11.5px] text-[#e9edf4] py-2">{t.exit.toFixed(2)}</TableCell>
                  <TableCell className="py-2">
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap', RESULT_CLS[t.result])}>{RESULT_AR[t.result]}</span>
                  </TableCell>
                  <TableCell className={cn('font-mono font-bold text-[12px] py-2', t.pnl >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>
                    {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}$
                  </TableCell>
                  <TableCell className="font-mono text-[10.5px] text-[#8a94a6] py-2 whitespace-nowrap">{fmtDur(t.exitT - t.entryT)}</TableCell>
                </TableRow>
              ))}
              {!pageRows.length && (
                <TableRow><TableCell colSpan={11} className="text-center text-[12px] text-[#8a94a6] py-8">لا صفقات مطابقة للفلاتر الحالية</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between px-3 py-2 border-t border-[#1b2334] bg-[#101726]">
          <span className="text-[10.5px] text-[#8a94a6]">صفحة {safePage + 1} من {totalPages}</span>
          <div className="flex gap-1.5">
            <PagerBtn disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><ChevronRight className="w-3.5 h-3.5" /> السابق</PagerBtn>
            <PagerBtn disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>التالي <ChevronLeft className="w-3.5 h-3.5" /></PagerBtn>
          </div>
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={o => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl bg-[#0d1220] border-[#1b2334] text-[#e9edf4] p-0 overflow-hidden max-h-[92vh] overflow-y-auto">
          {selected && <TradeReport t={selected} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TradeReport({ t }: { t: Trade }) {
  const durH = (t.exitT - t.entryT) / 3600e3;
  const tf = durH < 12 ? '15m' : durH < 72 ? '1h' : '4h';
  const [chart, setChart] = useState<{ candles: { t: number; o: number; h: number; l: number; c: number }[] } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/chart?tf=${tf}&from=${t.entryT}&to=${t.exitT}`);
        if (!r.ok) return;
        const j = await r.json();
        if (alive) setChart(j);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [t, tf]);

  const rr = Math.abs(t.tp - t.entry) / Math.max(Math.abs(t.entry - t.sl), 1e-9);

  return (
    <div>
      <DialogHeader className="px-5 pt-5 pb-3 border-b border-[#1b2334] bg-gradient-to-l from-[#101726] to-[#0d1220]">
        <DialogTitle className="flex flex-wrap items-center gap-2 text-[15px]">
          <span className="text-[#d9b45c] font-bold">صفقة باك تيست #{t.id}</span>
          <span className="text-[13px] text-[#e9edf4]">{STRATEGY_NAMES[t.strategy]}</span>
          {dirBadge(t.dir)}
          <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border', RESULT_CLS[t.result])}>{RESULT_AR[t.result]}</span>
          <span className={cn('font-mono font-black text-[16px] mr-auto', t.pnl >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>
            {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}$
          </span>
        </DialogTitle>
        <DialogDescription className="text-[10.5px] text-[#8a94a6]">
          {SESSION_AR[t.session]} · دخول {fmtDT(t.entryT)} · خروج {fmtDT(t.exitT)} · المدة {fmtDur(t.exitT - t.entryT)} (بتوقيت دمشق) · اختبار على شموع MT5 الحقيقية
        </DialogDescription>
      </DialogHeader>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Plan label="سعر الدخول" value={t.entry.toFixed(2)} cls="text-[#d9b45c]" />
          <Plan label="وقف الخسارة" value={t.sl.toFixed(2)} sub={`${t.slPips.toFixed(0)} بيب`} cls="text-[#f6465d]" />
          <Plan label="الهدف" value={t.tp.toFixed(2)} sub={`1:${rr.toFixed(1)}`} cls="text-[#2ebd85]" />
          <Plan label="الخروج الفعلي" value={t.exit.toFixed(2)} sub={`${t.tpPips.toFixed(0)} بيب`} cls="text-[#e9edf4]" />
        </div>

        <div className="rounded-lg border border-[#1b2334] overflow-hidden">
          <div className="px-3 py-1.5 bg-[#101726] border-b border-[#1b2334] text-[10.5px] text-[#8a94a6]">
            الشارت الحقيقي حول فترة الصفقة — فريم {tf} · خطوط: دخول ذهبي / وقف أحمر / هدف أخضر
          </div>
          <div className="h-[240px]">
            {chart ? <TradeChart candles={chart.candles} entry={t.entry} sl={t.sl} tp={t.tp} dir={t.dir} entryT={t.entryT} exitT={t.exitT} exit={t.exit} />
              : <div className="w-full h-full flex items-center justify-center text-[#8a94a6] text-xs">جارٍ تحميل شارت الصفقة...</div>}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Plan label="حجم اللوت" value={`${t.lot}`} />
          <Plan label="الجلسة" value={SESSION_AR[t.session]} />
          <Plan label="رقم الصفقة" value={`#${t.id}`} />
          <Plan label="النتيجة" value={RESULT_AR[t.result]} />
        </div>

        <div className="rounded-lg border border-[#1b2334] bg-[#101726] p-3">
          <div className="text-[10.5px] font-bold text-[#d9b45c] mb-1">سبب الدخول الفني</div>
          <p className="text-[12px] leading-relaxed text-[#c8cfdb]">{t.reason}</p>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-[#1b2334] bg-[#101726] px-3 py-1.5">
      <span className="text-[9.5px] text-[#8a94a6] block leading-none mb-1">{label}</span>
      <span className={cn('font-mono font-bold text-[13px] leading-none', cls ?? 'text-[#e9edf4]')}>{value}</span>
    </div>
  );
}

function Plan({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-[#1b2334] bg-[#101726] px-3 py-2">
      <div className="text-[9.5px] text-[#8a94a6] mb-0.5">{label}</div>
      <div className={cn('font-mono font-bold text-[14px]', cls ?? 'text-[#e9edf4]')}>{value}</div>
      {sub && <div className="text-[9px] text-[#5a6474] mt-0.5">{sub}</div>}
    </div>
  );
}

function Select({ value, onChange, options, width }: {
  value: string; onChange: (v: string) => void; options: [string, string][]; width: string;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className={cn(`${width} text-[11.5px] rounded-lg border border-[#2a3550] bg-[#101726] text-[#e9edf4] px-2.5 py-2 outline-none focus:border-[#d9b45c]/60 cursor-pointer`)}>
      {options.map(([v, l]) => <option key={v} value={v} className="bg-[#101726]">{l}</option>)}
    </select>
  );
}

function PagerBtn({ children, disabled, onClick }: { children: React.ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex items-center gap-0.5 text-[11px] font-semibold rounded-md border border-[#2a3550] px-2.5 py-1 text-[#c8cfdb] hover:border-[#d9b45c]/50 hover:text-[#d9b45c] disabled:opacity-40 disabled:pointer-events-none transition-colors">
      {children}
    </button>
  );
}
