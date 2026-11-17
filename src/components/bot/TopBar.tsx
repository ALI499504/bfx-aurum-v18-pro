'use client';

// الشريط العلوي الرسمي — الهوية + السعر اللحظي + حالة السوق + ساعة دمشق + صوت الدخول + مزامنة المستخدمين
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useBot } from './store';
import { SoundToggle } from './TradeSound';

interface PriceData {
  price: number | null;
  changePct: number | null;
  session: string | null;
  source?: string;
  symbol?: string;
  spread?: number | null;
}

const SESSION_LABEL: Record<string, string> = {
  asia: 'جلسة آسيا', london: 'جلسة لندن', londonNY: 'لندن ونيويورك', ny: 'جلسة نيويورك',
};
const SESSION_DOT: Record<string, string> = {
  asia: '#3d7dd8', london: '#d8a53d', londonNY: '#c2483d', ny: '#3dbd7d',
};

export function TopBar() {
  const [d, setD] = useState<PriceData>({ price: null, changePct: null, session: null });
  const [clock, setClock] = useState('--:--:--');
  const prevPrice = useRef<number | null>(null);
  const [flash, setFlash] = useState<'up' | 'dn' | null>(null);
  // مزامنة المستخدمين — مؤشر + إشعار عابر عند تغيير من مستخدم آخر
  const lastSyncAt = useBot((s) => s.lastSyncAt);
  const syncFlash = useBot((s) => s.syncFlash);

  // السعر والحالة — نبضة لحظية كل ثانية من بث MT5 الحي (نقطة /api/mt5/tick الخفيفة)
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/mt5/tick', { cache: 'no-store' });
        const j = await r.json();
        if (!alive) return;
        setD({ price: j.price, changePct: j.changePct, session: j.session, source: j.source, symbol: j.symbol, spread: j.spread });
        if (prevPrice.current !== null && j.price !== prevPrice.current) {
          setFlash(j.price > prevPrice.current ? 'up' : 'dn');
          setTimeout(() => setFlash(null), 650);
        }
        prevPrice.current = j.price;
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 1000); // نبضة كل ثانية — تيك الجسر يصل كل نصف ثانية
    return () => { alive = false; clearInterval(id); };
  }, []);

  // ساعة دمشق (UTC+3)
  useEffect(() => {
    const tick = () => {
      const t = new Date(Date.now() + 3 * 3600e3);
      setClock(t.toISOString().slice(11, 19));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const up = (d.changePct ?? 0) >= 0;

  return (
    <header className="h-13 shrink-0 z-20 relative border-b border-[#1b2334] bg-gradient-to-l from-[#0b101c] via-[#111827] to-[#0b101c] flex items-center gap-3 sm:gap-4 px-3 sm:px-4">
      {/* الهوية */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#e8c66f] to-[#8a6d2f] flex items-center justify-center shadow-[0_0_18px_rgba(217,180,92,0.25)] ring-1 ring-[#d9b45c]/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/aurum-bull.png" alt="BFX AURUM — ثور الذهب" className="w-7 h-7 select-none pointer-events-none" draggable={false} />
        </div>
        <div className="hidden sm:block min-w-0">
          <div className="font-black text-[14.5px] leading-tight tracking-wide">
            BFX AURUM <span className="text-[#d9b45c]">v18</span>
            <span className="mr-2 text-[9px] font-bold text-[#0a0e17] bg-gradient-to-l from-[#e8c66f] to-[#d9b45c] rounded px-1.5 py-px align-middle">PRO</span>
          </div>
          <div className="text-[9.5px] text-[#8a94a6] leading-tight truncate">تيرمنال الذهب XAUUSD — دليل هندسة الهيكل الفني</div>
        </div>
      </div>

      <div className="hidden md:block w-px h-7 bg-[#1b2334]" />

      {/* السعر اللحظي */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="leading-none">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[#8a94a6] font-bold">{d.source === 'mt5' && d.symbol ? d.symbol : 'XAUUSD'}</span>
            {d.source === 'mt5' && (
              <span className="text-[8.5px] font-black text-[#0a0e17] bg-[#d9b45c] rounded px-1 py-px leading-none">MT5</span>
            )}
            <span
              className="w-1.5 h-1.5 rounded-full bg-[#2ebd85] live-dot"
              title={d.source === 'mt5' ? 'بث مباشر من طرفية MetaTrader 5 على جهازك' : 'بث لحظي — PAXG مرجعي'}
            />
          </div>
          <div className={cn('font-mono font-bold text-[19px] leading-tight tracking-tight transition-colors',
            flash === 'up' ? 'flash-up text-[#2ebd85]' : flash === 'dn' ? 'flash-dn text-[#f6465d]' : 'text-[#f5f7fa]')}>
            {d.price ? d.price.toFixed(2) : '—.—'}
          </div>
        </div>
        {d.changePct !== null && (
          <span className={cn('text-[11px] font-mono font-bold px-1.5 py-0.5 rounded border',
            up ? 'text-[#2ebd85] border-[#2ebd85]/35 bg-[#2ebd85]/10' : 'text-[#f6465d] border-[#f6465d]/35 bg-[#f6465d]/10')}>
            {up ? '▲' : '▼'} {Math.abs(d.changePct).toFixed(2)}%
          </span>
        )}
        <span className="hidden lg:inline text-[9.5px] text-[#5a6474] border border-[#1b2334] rounded px-1.5 py-0.5">
          {d.source === 'mt5' && d.spread ? `سبريد MT5 ${d.spread.toFixed(2)}$` : 'سبريد ثابت 30¢'}
        </span>
      </div>

      {/* الحالة يساراً */}
      <div className="mr-auto flex items-center gap-2 sm:gap-3">
        {/* التنبيه الصوتي لدخول الصفقات */}
        <SoundToggle />
        {/* مزامنة لحظية بين المستخدمين */}
        <div
          className={cn('hidden md:flex items-center gap-1.5 text-[10.5px] font-bold px-2 py-1 rounded-md border',
            lastSyncAt ? 'border-[#2ebd85]/35 bg-[#2ebd85]/8 text-[#2ebd85]' : 'border-[#1b2334] bg-[#0d1220] text-[#8a94a6]')}
          title="كل تغيير إعدادات أو باك تيست من أي مستخدم يظهر عند الجميع تلقائياً خلال ثوانٍ"
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', lastSyncAt ? 'bg-[#2ebd85] live-dot' : 'bg-[#8a94a6]')} />
          مزامنة مباشرة
        </div>
        <div className={cn('hidden sm:flex items-center gap-1.5 text-[10.5px] font-bold px-2 py-1 rounded-md border',
          d.session ? 'border-[#2ebd85]/35 bg-[#2ebd85]/8 text-[#e9edf4]' : 'border-[#f6465d]/35 bg-[#f6465d]/8 text-[#e9edf4]')}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: d.session ? SESSION_DOT[d.session] : '#f6465d' }} />
          {d.session ? SESSION_LABEL[d.session] ?? d.session : 'السوق مغلق'}
        </div>
        <div className="hidden md:flex items-center gap-1.5 text-[10.5px] text-[#8a94a6] border border-[#1b2334] rounded-md px-2 py-1 bg-[#0d1220]">
          <span>دمشق</span>
          <span className="font-mono font-bold text-[#d9b45c]">{clock}</span>
        </div>
      </div>

      {/* إشعار عابر: تغيير من مستخدم آخر طُبّق تلقائياً */}
      {syncFlash && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-[#2ebd85]/45 bg-[#0d1220]/95 shadow-[0_8px_30px_rgba(0,0,0,0.5)] px-4 py-2.5 text-[12.5px] font-bold text-[#2ebd85]">
          <span className="w-2 h-2 rounded-full bg-[#2ebd85] live-dot" />
          {syncFlash}
        </div>
      )}
    </header>
  );
}
