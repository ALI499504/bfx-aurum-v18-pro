'use client';

// ============================================================
// شاشة قفل خدمة جارفس — لا دخول بلا الرمز السري
// نفس هوية الواجهة: ذهبي على داكن، إطار HUD، اهتزاز عند الخطأ.
// ============================================================
import { useState, type FormEvent } from 'react';
import { KeyRound, Loader2, ShieldCheck, Fingerprint } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function JarvisLock({ onUnlock, checking }: { onUnlock: () => void; checking?: boolean }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/jarvis/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        onUnlock();
        return;
      }
      setErr(j?.error || 'الرمز السري غير صحيح');
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setCode('');
    } catch {
      setErr('تعذر الاتصال بالخادم — أعد المحاولة');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div dir="rtl" className="fixed inset-0 z-50 flex items-center justify-center bg-[#05070d] overflow-hidden">
      {/* خلفية مطابقة لهوية النواة */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(217,180,92,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(217,180,92,.05) 1px, transparent 1px)',
          backgroundSize: '46px 46px',
          maskImage: 'radial-gradient(ellipse 85% 75% at 50% 42%, black 30%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse 85% 75% at 50% 42%, black 30%, transparent 78%)',
        }} />
      <div className="hud-scanline" />
      <style>{`
        @keyframes hud-scan { 0% { top: -12%; } 100% { top: 112%; } }
        .hud-scanline { position: absolute; left: 0; right: 0; height: 110px; pointer-events: none;
          background: linear-gradient(to bottom, transparent, rgba(217,180,92,.06), transparent);
          animation: hud-scan 7.5s linear infinite; }
        @keyframes lock-shake { 0%,100% { transform: translateX(0); } 20%,60% { transform: translateX(-9px); } 40%,80% { transform: translateX(9px); } }
        @keyframes lock-glow { 0%,100% { opacity:.55; transform: scale(1); } 50% { opacity:1; transform: scale(1.06); } }
      `}</style>
      <div className="absolute top-2 right-2 w-12 h-12 border-t-2 border-r-2 border-[#d9b45c]/50 pointer-events-none" />
      <div className="absolute top-2 left-2 w-12 h-12 border-t-2 border-l-2 border-[#d9b45c]/50 pointer-events-none" />
      <div className="absolute bottom-2 right-2 w-12 h-12 border-b-2 border-r-2 border-[#d9b45c]/50 pointer-events-none" />
      <div className="absolute bottom-2 left-2 w-12 h-12 border-b-2 border-l-2 border-[#d9b45c]/50 pointer-events-none" />

      <div className={cn('relative z-10 w-[min(400px,92vw)] rounded-2xl border border-[#d9b45c]/30 bg-[#0a0e17]/90 backdrop-blur-md p-7 shadow-[0_0_60px_rgba(217,180,92,.08)]',
        shake && 'lock-shake')}
        style={shake ? { animation: 'lock-shake .45s ease-in-out 1' } : undefined}>
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl border border-[#d9b45c]/40 bg-[#d9b45c]/8 flex items-center justify-center mb-4"
            style={{ animation: 'lock-glow 2.6s ease-in-out infinite' }}>
            {checking
              ? <Loader2 className="w-7 h-7 text-[#d9b45c] animate-spin" />
              : <KeyRound className="w-7 h-7 text-[#d9b45c]" />}
          </div>
          <div className="text-[10.5px] font-mono tracking-[.3em] text-[#8a94a6] mb-1.5">BFX AURUM // SECURE ACCESS</div>
          <h1 className="text-[19px] font-black text-[#f3dc9a]">خدمة جارفس مقفولة</h1>
          <p className="text-[12px] text-[#8a94a6] mt-1.5 leading-relaxed">
            أدخل الرمز السري لفتح النواة التنفيذية والصوت والتحكم بالبوت كله.
          </p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <div className="relative">
            <Fingerprint className="absolute right-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 w-[18px] h-[18px] text-[#5a6474] pointer-events-none" />
            <input
              type="password"
              inputMode="text"
              autoComplete="off"
              autoFocus
              value={code}
              onChange={e => { setCode(e.target.value); setErr(''); }}
              placeholder="الرمز السري…"
              dir="ltr"
              className="w-full h-12 rounded-xl border border-[#1b2334] bg-[#070a12] pr-11 pl-4 text-[15px] font-mono tracking-[.25em] text-[#f3dc9a] placeholder:text-[#5a6474] placeholder:tracking-normal placeholder:font-sans focus:outline-none focus:border-[#d9b45c]/60 focus:ring-2 focus:ring-[#d9b45c]/15 transition-all text-center"
            />
          </div>
          {err && (
            <div className="text-[12px] font-bold text-[#f6465d] text-center bg-[#f6465d]/8 border border-[#f6465d]/25 rounded-lg px-3 py-2">
              {err}
            </div>
          )}
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className={cn('w-full h-12 rounded-xl font-black text-[14.5px] flex items-center justify-center gap-2 transition-all',
              code.trim()
                ? 'bg-gradient-to-l from-[#d9b45c] to-[#e8c66f] text-[#0a0e17] hover:brightness-110 active:scale-[.99] shadow-[0_4px_22px_rgba(217,180,92,.25)]'
                : 'bg-[#1b2334] text-[#5a6474] cursor-not-allowed')}
          >
            {busy ? <Loader2 className="w-4.5 h-4.5 w-[18px] h-[18px] animate-spin" /> : <ShieldCheck className="w-[18px] h-[18px]" />}
            {busy ? 'جارٍ التحقق…' : 'فتح الخدمة'}
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-[#1b2334] flex items-center justify-center gap-2 text-[10.5px] font-mono text-[#5a6474]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#2ebd85] inline-block" />
          جلسة موقّعة HMAC — صلاحية 30 يوماً بعد الفتح
        </div>
      </div>
    </div>
  );
}
