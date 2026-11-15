'use client';

// شارة حالة اتصال MT5 — تُظهر «MT5 مباشر» عندما يبث جسر ميتاتريدر البيانات
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface Mt5Status {
  connected: boolean;
  symbol: string;
  broker: string | null;
  ageMs: number | null;
}

export function Mt5Badge() {
  const [s, setS] = useState<Mt5Status | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/mt5/status', { cache: 'no-store' });
        if (r.ok && alive) setS(await r.json());
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const on = !!s?.connected;
  const age = s?.ageMs != null ? Math.round(s.ageMs / 1000) : null;

  return (
    <span
      title={on
        ? `متصل بـ MetaTrader 5 — ${s?.broker ?? 'وسيطك'} — آخر تحديث قبل ${age ?? 0} ثانية`
        : 'لا يوجد بث حي من طرفية MetaTrader 5 — لا توجد أي بيانات محاكاة، شغّل أمر الربط على جهازك'}
      className={cn(
        'flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-md border shrink-0 transition-colors',
        on ? 'border-[#2ebd85]/40 bg-[#2ebd85]/10 text-[#2ebd85]' : 'border-[#2a3550] bg-[#141a29] text-[#8a94a6]',
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', on ? 'bg-[#2ebd85] live-dot' : 'bg-[#5a6474]')} />
      {on ? `MT5 مباشر — ${s?.symbol ?? 'XAUUSD'}` : 'بانتظار البث الحي'}
    </span>
  );
}
