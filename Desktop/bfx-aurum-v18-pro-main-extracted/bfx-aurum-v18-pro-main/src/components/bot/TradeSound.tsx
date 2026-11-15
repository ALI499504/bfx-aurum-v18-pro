'use client';

// التنبيه الصوتي بنمط MetaTrader 5 — إعادة توليد رقمية لنغمات MT5 عبر Web Audio API
// (بلا ملفات خارجية): نفس الطابع المعدني السريع لأصوات الميتاتريدر —
//  • رنة الدخول «expert» الصاعدة اللامعة — تُرنّ فور إصدار أمر حي إلى MT5 أو تنفيذ صفقة
//  • رنة الإغلاق الهابطة — تُرنّ عند إغلاق صفقة حية (هدف/وقف/زمن)
//  • نبضتا التنبيه «alert» المتطابقتان — لأحداث الفشل وإعادة التقييم
// + زر كتم محفوظ محلياً + خطاف اختبار window.bfxSoundTest للتأكد من السماعة.
import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';

const LS_KEY = 'bfx-trade-sound';
const SYNC_EVT = 'bfx:sound-state';

/** عناوين أحداث الدخول التي تستحق رنة الدخول (من حلقة التنفيذ الحي) */
const ENTRY_TITLES = ['أوامر حية جديدة', 'تنفيذ حي', 'تنفيذ ماركت فوري'];
/** عنوان حدث الإغلاق الحي */
const CLOSE_TITLE = 'إغلاق حي';
/** عنوان حدث فشل الأمر (يُعاد تقييمه) */
const FAIL_TITLE = 'فشل أمر حي';

let audioCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch { return null; }
}

/**
 * نغمة معدنية بنمط ملفات wav في الميتاتريدر:
 * أساس + توافقيات 2/3/4 (الطابع المعدني المميز) + هجوم شبه فوري وتلاشٍ أُسّي.
 */
function tone(ctx: AudioContext, freq: number, at: number, dur: number, peak: number) {
  const t0 = ctx.currentTime;
  const partials: [number, number][] = [[1, 1], [2, 0.38], [3, 0.14], [4.2, 0.05]];
  for (const [mult, amp] of partials) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq * mult;
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * amp), t0 + at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t0 + at);
    o.stop(t0 + at + dur + 0.05);
  }
}

/** رنة دخول الصفقة — نمط MT5 «expert»: نغمتان صاعدتان سريعتان لامعتان (blip-ding) */
function playEntryChime() {
  const ctx = getCtx();
  if (!ctx) return;
  tone(ctx, 1046.5, 0, 0.16, 0.5);     // C6 — «بلِب»
  tone(ctx, 1568.0, 0.12, 0.30, 0.42); // G6 — «دينغ»
}

/** رنة إغلاق الصفقة — هابطة لتمييزها عن الدخول (ding-dum) */
function playCloseChime() {
  const ctx = getCtx();
  if (!ctx) return;
  tone(ctx, 1318.5, 0, 0.15, 0.42);    // E6
  tone(ctx, 783.99, 0.12, 0.30, 0.36); // G5
}

/** نبضتا تنبيه MT5 «alert» المتطابقتان — أحداث الفشل */
function playAlertBeeps() {
  const ctx = getCtx();
  if (!ctx) return;
  tone(ctx, 880, 0, 0.11, 0.4);
  tone(ctx, 880, 0.16, 0.11, 0.4);
}

export function isSoundOn(): boolean {
  try { return localStorage.getItem(LS_KEY) !== 'off'; } catch { return true; }
}
export function setSoundOn(on: boolean) {
  try { localStorage.setItem(LS_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(SYNC_EVT, { detail: on }));
}

// خطاف اختبار عام — للتحقق من السماعة والنغمات من الكونسول أو من الاختبار الآلي
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).bfxSoundTest = {
    entry: playEntryChime,
    close: playCloseChime,
    alert: playAlertBeeps,
    state: () => audioCtx?.state ?? null,
  };
}

/** الحارس الصامت — يُركّب مرة واحدة في الصفحة ويرصد أحداث دخول/إغلاق الصفقات */
export function TradeSound() {
  const lastIdRef = useRef<number | null>(null);
  const bootedRef = useRef(false);
  const onRef = useRef(isSoundOn());

  // فتح صلاحية الصوت: المتصفح يشترط تفاعل مستخدم واحد قبل تشغيل أي صوت
  useEffect(() => {
    const unlock = () => { getCtx(); };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    const sync = (e: Event) => { onRef.current = (e as CustomEvent<boolean>).detail; };
    window.addEventListener(SYNC_EVT, sync);
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      window.removeEventListener(SYNC_EVT, sync);
    };
  }, []);

  // رصد التنبيهات الحية كل 5 ثوانٍ — أي حدث جديد يرنّ فوراً (رنة واحدة لكل دفعة)
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (document.hidden) return; // تبويب بالخلفية — لا استهلاك ولا رنات مكدسة
      try {
        const r = await fetch('/api/alerts?limit=10', { cache: 'no-store' });
        if (!r.ok || !alive) return;
        const j = await r.json();
        const list: { id: number; kind: string; title: string }[] = j?.alerts ?? [];
        if (!list.length) return;
        const maxId = Math.max(...list.map(a => a.id));
        if (!bootedRef.current) {
          // أول تحميل: استيعاب التاريخ دون رنّ على أحداث قديمة
          bootedRef.current = true;
          lastIdRef.current = maxId;
          return;
        }
        const prev = lastIdRef.current ?? maxId;
        lastIdRef.current = Math.max(prev, maxId);
        if (maxId <= prev || !onRef.current) return;
        const fresh = list.filter(a => a.id > prev);
        // الأولوية: دخول ← إغلاق ← فشل (رنة واحدة لكل دفعة حتى لا تتراكم)
        const entry = fresh.find(a => a.kind === 'live' && ENTRY_TITLES.some(t => a.title.includes(t)));
        if (entry) playEntryChime();
        else if (fresh.some(a => a.kind === 'live' && a.title.includes(CLOSE_TITLE))) playCloseChime();
        else if (fresh.some(a => a.kind === 'live' && a.title.includes(FAIL_TITLE))) playAlertBeeps();
      } catch { /* صمت */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return null;
}

/** زر كتم/تفعيل الصوت — للشريط العلوي، الحالة محفوظة محلياً ومتزامنة عبر النوافذ */
export function SoundToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(isSoundOn());
    const sync = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    window.addEventListener(SYNC_EVT, sync);
    return () => window.removeEventListener(SYNC_EVT, sync);
  }, []);
  return (
    <button
      onClick={() => {
        const next = !on;
        setOn(next);
        setSoundOn(next);
        if (next) playEntryChime(); // عينة فورية من رنة MT5 عند التفعيل للتأكد من السماعة
      }}
      title={on ? 'تنبيه MT5 الصوتي للصفقات: مفعل — اضغط للكتم' : 'التنبيه الصوتي: مكتوم — اضغط للتفعيل'}
      className={cn('flex items-center gap-1.5 text-[10.5px] font-bold px-2 py-1 rounded-md border transition-colors',
        on
          ? 'border-[#d9b45c]/40 bg-[#d9b45c]/8 text-[#d9b45c] hover:bg-[#d9b45c]/15'
          : 'border-[#1b2334] bg-[#0d1220] text-[#8a94a6] hover:text-[#c3cbd9]')}
    >
      {on ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
      <span className="hidden lg:inline">{on ? 'صوت MT5: مفعل' : 'صوت MT5: مكتوم'}</span>
    </button>
  );
}
