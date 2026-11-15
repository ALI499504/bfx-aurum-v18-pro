'use client';

// لوحة التنبيهات الحية — سجل أحداث البوت الآلي + ضبط تليجرام
// كل حدث جوهري (إشارة/تنفيذ ظل/قرار آلي/صمام) يظهر هنا فوراً ويُدفع لتليجرام عند الضبط.
// عائمة بأسلوب زر FAB: جرس صغير ثابت أسفل اليسار — لا تأخذ أي مساحة من الشارت الكامل.
import { useEffect, useRef, useState } from 'react';
import { Bell, Send, ShieldCheck, ShieldOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Alert {
  id: number; t: number; syria: string;
  kind: 'signal' | 'shadow' | 'auto' | 'fuse' | 'live' | 'system';
  title: string; body: string; delivered: string;
}

const KIND_STYLE: Record<Alert['kind'], { label: string; cls: string }> = {
  live: { label: 'حي', cls: 'text-[#d9b45c] border-[#d9b45c]/45 bg-[#d9b45c]/10' },
  signal: { label: 'إشارة', cls: 'text-[#2ebd85] border-[#2ebd85]/40 bg-[#2ebd85]/8' },
  shadow: { label: 'تنفيذ', cls: 'text-[#5bb8d4] border-[#5bb8d4]/40 bg-[#5bb8d4]/8' },
  auto: { label: 'آلي', cls: 'text-[#d9b45c] border-[#d9b45c]/40 bg-[#d9b45c]/8' },
  fuse: { label: 'صمام', cls: 'text-[#f6465d] border-[#f6465d]/40 bg-[#f6465d]/8' },
  system: { label: 'نظام', cls: 'text-[#8a94a6] border-[#2a3550] bg-[#141a29]' },
};

export function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);
  const [tg, setTg] = useState<{ configured: boolean; chatId: string | null }>({ configured: false, chatId: null });
  const [token, setToken] = useState('');
  const [chat, setChat] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [openCfg, setOpenCfg] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const load = () => {
      fetch('/api/alerts?limit=40', { cache: 'no-store' })
        .then(r => r.json())
        .then(j => {
          if (j?.alerts) setAlerts(j.alerts);
          if (j?.telegram) setTg(j.telegram);
        })
        .catch(() => { /* صمت */ });
    };
    load();
    timer.current = setInterval(load, 8000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const saveTg = async () => {
    setSaving(true); setMsg(null);
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: token, chatId: chat }),
      });
      const j = await res.json();
      if (j.ok) {
        setTg({ configured: true, chatId: chat });
        setToken(''); setChat('');
        setMsg('تم الضبط — كل التنبيهات ستُدفع فوراً إلى تليجرام');
      } else setMsg(j.error ?? 'فشل الضبط');
    } catch { setMsg('تعذر الاتصال'); }
    setSaving(false);
  };

  // اللوحة العائمة: زر جرس ثابت أسفل اليسار (فوق لوحة الزوار) — اللوحة تنفتح فوق الشارت بلا أن تحجز منه مساحة
  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        title="التنبيهات الحية — سجل أحداث البوت"
        className="fixed bottom-16 left-3 z-40 w-10 h-10 rounded-full border border-[#d9b45c]/45 bg-[#0d1220]/95 backdrop-blur-sm text-[#d9b45c] hover:bg-[#d9b45c]/15 shadow-[0_4px_18px_rgba(0,0,0,0.5)] flex items-center justify-center transition-colors print:hidden"
      >
        <Bell className="w-4.5 h-4.5" />
        {alerts.length > 0 && alerts[0].kind === 'live' && (
          <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-[#d9b45c] text-[#0a0e17] text-[8.5px] font-black flex items-center justify-center shadow">!</span>
        )}
      </button>
      {!open && <div className="fixed bottom-16 left-14 z-30 pointer-events-none print:hidden">
        {alerts.length > 0 && (
          <div className="max-w-[300px] rounded-lg border border-[#1b2334]/80 bg-[#0a0e17]/85 backdrop-blur-sm px-3 py-1.5 shadow-lg">
            <div className="text-[10.5px] font-bold text-[#e9edf4] truncate">{alerts[0].title}</div>
            <div className="text-[9.5px] text-[#8a94a6] font-mono">{alerts[0].syria}</div>
          </div>
        )}
      </div>}
      {open && (
    <div className="fixed bottom-16 left-3 z-50 w-[380px] max-w-[calc(100vw-24px)] rounded-xl border border-[#1b2334] bg-[#0d1220] shadow-[0_10px_40px_rgba(0,0,0,0.6)] overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-3 border-b border-[#1b2334]">
        <div className="flex items-center gap-2 min-w-0">
          <Bell className="w-4 h-4 text-[#d9b45c] shrink-0" />
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-[#e9edf4]">التنبيهات الحية</div>
            <div className="text-[10px] text-[#8a94a6]">تشغيل ذاتي كامل — إشارات، تنفيذ، قرارات الآلة، الصمامات</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={() => setOpenCfg(o => !o)}
          className={cn('shrink-0 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold transition-colors',
            tg.configured ? 'text-[#2ebd85] border-[#2ebd85]/40 bg-[#2ebd85]/8' : 'text-[#8a94a6] border-[#2a3550] hover:border-[#d9b45c]/40')}>
          {tg.configured ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
          تليجرام: {tg.configured ? 'مربوط' : 'غير مضبوط'}
        </button>
        <button onClick={() => setOpen(false)} title="إغلاق اللوحة"
          className="shrink-0 w-7 h-7 rounded-md border border-[#2a3550] text-[#8a94a6] hover:text-[#e9edf4] hover:border-[#d9b45c]/40 flex items-center justify-center">
          <X className="w-3.5 h-3.5" />
        </button>
        </div>
      </div>

      {openCfg && (
        <div className="p-3 border-b border-[#1b2334] bg-[#0a0e17] space-y-2">
          <div className="text-[10.5px] text-[#8a94a6] leading-relaxed">
            من @BotFather في تليجرام: أنشئ بوتاً وخذ التوكن، ثم أرسل لأي رسالة لبوتك واستخرج chat_id من
            <span className="font-mono text-[#d9b45c]"> api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</span>.
            التوكن يُخزن محلياً في قاعدة البوت ولا يُعرض أبداً بعد الحفظ.
          </div>
          <input value={token} onChange={e => setToken(e.target.value)} placeholder="123456789:AAH..." dir="ltr"
            className="w-full rounded-md bg-[#101726] border border-[#2a3550] px-2.5 py-1.5 text-[11px] font-mono text-[#e9edf4] focus:outline-none focus:border-[#d9b45c]/50" />
          <input value={chat} onChange={e => setChat(e.target.value)} placeholder="chat_id مثال 123456789" dir="ltr"
            className="w-full rounded-md bg-[#101726] border border-[#2a3550] px-2.5 py-1.5 text-[11px] font-mono text-[#e9edf4] focus:outline-none focus:border-[#d9b45c]/50" />
          <button onClick={saveTg} disabled={saving || !token || !chat}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#d9b45c] hover:bg-[#e5c26e] disabled:opacity-50 text-[#0a0e17] font-bold text-[11px] px-3 py-1.5">
            <Send className="w-3.5 h-3.5" /> {saving ? 'جارٍ الحفظ...' : 'حفظ الربط'}
          </button>
          {msg && <div className="text-[10.5px] text-[#c8d0dd]">{msg}</div>}
        </div>
      )}

      <div className="max-h-72 overflow-y-auto divide-y divide-[#131b2c]">
        {alerts.length === 0 && (
          <div className="p-4 text-center text-[11px] text-[#8a94a6]">
            لا تنبيهات بعد — تعمل الحلقة الحية وستظهر الأحداث تلقائياً عند أول إشارة أو قرار آلي.
          </div>
        )}
        {alerts.map(a => {
          const st = KIND_STYLE[a.kind] ?? KIND_STYLE.system;
          return (
            <div key={a.id} className="p-2.5 flex gap-2.5 items-start hover:bg-[#101726]/60 transition-colors">
              <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold mt-0.5', st.cls)}>{st.label}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-[11.5px] font-bold text-[#e9edf4] truncate">{a.title}</div>
                  <div className="text-[9.5px] text-[#8a94a6] shrink-0 font-mono">{a.syria}</div>
                </div>
                <div className="text-[10.5px] text-[#8a94a6] whitespace-pre-line leading-relaxed mt-0.5">{a.body}</div>
              </div>
              {a.delivered === 'telegram' && <span className="text-[9px] text-[#2ebd85] shrink-0 mt-1">TG ✓</span>}
            </div>
          );
        })}
      </div>
    </div>
      )}
    </>
  );
}
