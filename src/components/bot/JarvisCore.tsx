'use client';

// ============================================================
// جارفس — القلب النابض (HUD سينمائي بملء الشاشة)
// مبني على DNA أحدث مشاريع JARVIS المفتوحة على GitHub:
//   · Debddj/project-jarvis  — مفاعل متعدد الحلقات تتسارع دورته
//     مع الحالة (خامل ← استماع ← تنفيذ)، إقلاع بأعمدة حالة،
//     وميض قيم القياسات لحظة تحديثها، خطوط مسح وشبكة حية.
//   · eadmin2/jarvis_ai + harsh-raj00/my-jarvis — Arc Reactor
//     متوهج بحلقات داخلية دوّارة وطاقة نابضة عند المعالجة.
// ما الجديد في هذه النسخة (بطلب السيد):
//   1. واجهة أكبر: مفاعل 320px، لوحات جانبية 330px، خطوط أكبر.
//   2. كونسول تنفيذ احترافي: الخطوة الحالية كبيرة واضحة + مؤقت
//      حي + شريط زمن لكل خطوة + عداد الخطوات — ترى ماذا يعمل
//      جارفس الآن بالضبط.
//   3. تقرير نتائج منسق: ترويسة أمر + زمن تنفيذ + نص منسق
//      (عناوين/نقاط/أرقام ذهبية بارزة) + شرائح أرقام مستخرجة.
//   4. صوت ليلى اللبنانية (ar-LB-LaylaNeural) — نبرة أنثوية جميلة اللحن دقيقة اللفظ.
// ============================================================
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Mic, MicOff, Send, Volume2, VolumeX, User, CheckCircle2, XCircle,
  Loader2, Maximize2, Minimize2, Radio, Activity, Wallet, Zap,
  TrendingUp, TrendingDown, Ear, EarOff, FileText, History, ChevronUp, ChevronDown,
  LayoutDashboard, Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useJarvisVoice } from '@/hooks/use-jarvis-voice';
import { useBot } from '@/components/bot/store';
import BacktestCard, { type BacktestData } from '@/components/bot/BacktestCard';
import JarvisLock from '@/components/bot/JarvisLock';

interface Step { label: string; detail: string; ok: boolean; ms?: number }
interface Msg { role: 'user' | 'jarvis'; text: string; steps: Step[]; runMs?: number; data?: unknown }
interface LogItem extends Step { sep?: boolean }

type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking';

const CORE_COLOR: Record<CoreState, string> = {
  idle: '#d9b45c',
  listening: '#39c4e8',
  thinking: '#e8a33d',
  speaking: '#f3dc9a',
};
const STATE_AR: Record<CoreState, string> = {
  idle: 'في انتظار أوامرك يا سيدي',
  listening: 'أستمع إليك يا سيدي…',
  thinking: 'أنفّذ أمرك الآن…',
  speaking: 'ألخّص لك النتيجة…',
};
const STATE_EN: Record<CoreState, string> = {
  idle: 'STANDBY', listening: 'LISTENING', thinking: 'EXECUTING', speaking: 'SPEAKING',
};
// سرعات المفاعل حسب الحالة — على طريقة project-jarvis: كلما ازداد العمل ازدادت الحماسة
const REACTOR_SPEED: Record<CoreState, { s1: string; s2: string; s3: string; core: string }> = {
  idle: { s1: '16s', s2: '10s', s3: '26s', core: '2.8s' },
  listening: { s1: '7s', s2: '4.5s', s3: '12s', core: '1.5s' },
  thinking: { s1: '3.6s', s2: '2.2s', s3: '5.5s', core: '0.85s' },
  speaking: { s1: '6s', s2: '3.8s', s3: '9s', core: '1.25s' },
};

// سطور الإقلاع السينمائية — أعمدة حالة على طريقة HUD الأصلي
const BOOT_LINES: { t: string; s: string }[] = [
  { t: 'BFX AURUM // J.A.R.V.I.S CORE v4', s: '' },
  { t: 'تهيئة المفاعل المركزي', s: 'ONLINE' },
  { t: 'بث ميتاتريدر 5 اللحظي', s: 'LIVE' },
  { t: 'العقل التنفيذي وكتالوج الأدوات', s: 'READY' },
  { t: 'الصوت الأنثوي اللبناني — ليلى', s: 'ONLINE' },
  { t: 'شبكة منع التأجيل — كل أمر يُنفَّذ في دوره', s: 'ARMED' },
  { t: 'النظام جاهز — في خدمتك يا سيدي.', s: '' },
];

const QUICK_COMMANDS = [
  'وضع السوق الآن',
  'الصفقات المفتوحة',
  'الحساب والرصيد',
  'اعمل باك تيست لسنة 2025',
  'أخبار الدولار القادمة',
  'فحص النظام الشامل',
];

// ارتفاعات موجات النطق — ثابتة (بلا عشوائية أثناء الرندر)
const WAVE_HEIGHTS = [0.4, 0.75, 0.5, 0.95, 0.65, 1, 0.55, 0.85, 0.45, 0.7, 0.95, 0.5, 0.8, 0.6];

// ---------- هندسة المفاعل (تُحسب مرة واحدة) ----------
const C = 150; // مركز viewBox 300×300
const coilPaths = Array.from({ length: 10 }, (_, i) => {
  const a0 = ((i * 36 - 11) * Math.PI) / 180;
  const a1 = ((i * 36 + 11) * Math.PI) / 180;
  const r0 = 58, r1 = 86;
  const p = (r: number, a: number) => `${(C + r * Math.cos(a)).toFixed(1)},${(C + r * Math.sin(a)).toFixed(1)}`;
  return `M${p(r0, a0)} L${p(r1, a0)} L${p(r1, a1)} L${p(r0, a1)} Z`;
});
const orbitDots = Array.from({ length: 8 }, (_, i) => {
  const a = ((i * 45) * Math.PI) / 180;
  const r = 104;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
});
// تدرجات الزوايا حول المفاعل (على طريقة HUD العسكري)
const degTicks = Array.from({ length: 48 }, (_, i) => {
  const a = ((i * 7.5) * Math.PI) / 180;
  const r1 = 132, r2 = i % 4 === 0 ? 124 : 128;
  return {
    x1: C + r1 * Math.cos(a), y1: C + r1 * Math.sin(a),
    x2: C + r2 * Math.cos(a), y2: C + r2 * Math.sin(a),
    major: i % 4 === 0,
  };
});

interface Telemetry {
  price: number | null;
  changePct: number | null;
  source: string;
  session: string;
  connected: boolean | null;
  balance: number | null;
  equity: number | null;
  signals: number | null;
  strategiesOn: number | null;
}

// ---------- استخراج شرائح الأرقام من الرد (عرض احترافي للنتائج) ----------
function extractChips(text: string): { v: string; u: string }[] {
  const out: { v: string; u: string }[] = [];
  const seen = new Set<string>(); // منع التكرار: كل قيمة تظهر مرة واحدة فقط
  const push = (v: string, u: string) => {
    const k = v.replace(/,/g, '');
    if (!seen.has(k) && v.length <= 12) { seen.add(k); out.push({ v, u }); }
  };
  for (const m of text.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*(?:\$|دولار)/g)) push(m[1], '$');
  for (const m of text.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*(?:%|بالمئة)/g)) push(m[1], '%');
  for (const m of text.matchAll(/(\d+)\s*(صفقة|صفقات|مركز|مراكز|جلسة|جلسات|إشارة|إشارات|استراتيجية|استراتيجيات|قاعدة|قواعد|نقطة|نقاط|ثانية|سنت)/g)) push(m[1], m[2]);
  for (const m of text.matchAll(/(?<![\d.])(\d{3,5}\.\d{2})(?![\d.])/g)) push(m[1], '');
  return out.slice(0, 6);
}

// ---------- تلوين الأرقام داخل النص — بارزة ذهبية ----------
const NUM_RE = /(-?\d[\d,]*(?:\.\d+)?)(\s*(?:\$|%|دولارا?ً?|بالمئة|نقطة|نقاط|صفقة|صفقات|مركز|مراكز|جلسة|جلسات|إشارة|إشارات|استراتيجية|استراتيجيات|قاعدة|قواعد|ثانية|سنتا?ً?)?)?/g;
function richInline(s: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, k = 0;
  for (const m of s.matchAll(NUM_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(s.slice(last, idx));
    out.push(
      <span key={`${keyBase}-n${k++}`} className="font-mono font-bold text-[#f3dc9a] tabular-nums">
        {m[0]}
      </span>
    );
    last = idx + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** عرض النص المنسق: عناوين من **..**، نقاط من «- »، وأرقام بارزة */
function RichText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5">
      {lines.map((raw, i) => {
        const line = raw.trim();
        if (!line) return <div key={i} className="h-1" />;
        // عنوان من markdown: **نص:**
        const heading = line.match(/^\*\*(.+?)\*\*:?$/);
        if (heading) {
          return (
            <div key={i} className="flex items-center gap-2 pt-1.5">
              <span className="w-1.5 h-1.5 rotate-45 bg-[#d9b45c] shrink-0" />
              <span className="text-[14.5px] font-black text-[#d9b45c]">{richInline(heading[1], `h${i}`)}</span>
            </div>
          );
        }
        // نقطة قائمة: - نص
        if (/^[-•*]\s+/.test(line)) {
          return (
            <div key={i} className="flex items-start gap-2 pr-1">
              <span className="text-[#d9b45c] mt-1.5 shrink-0 text-[9px]">◆</span>
              <span className="text-[13.5px] text-[#dfe4ec] leading-[1.9]">{richInline(line.replace(/^[-•*]\s+/, ''), `b${i}`)}</span>
            </div>
          );
        }
        // نص عادي مع بولد داخلي وأرقام بارزة
        const parts = line.split(/\*\*(.+?)\*\*/g);
        return (
          <p key={i} className="text-[13.5px] text-[#e8e4d8] leading-[1.9]">
            {parts.map((p, j) => j % 2 === 1
              ? <b key={j} className="text-[#f3dc9a] font-black">{richInline(p, `p${i}-${j}`)}</b>
              : richInline(p, `p${i}-${j}`))}
          </p>
        );
      })}
    </div>
  );
}

export function JarvisCore() {
  const setTab = useBot(s => s.setTab);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');        // الرد المكتوب حرفاً حرفاً
  const [finalText, setFinalText] = useState(''); // الرد الكامل المراد كتابته
  const [ack, setAck] = useState('');             // الرد الشفهي الفوري «حاضر يا سيدي»
  const [liveSteps, setLiveSteps] = useState<Step[]>([]);
  const [runLog, setRunLog] = useState<LogItem[]>([]);   // سجل تنفيذ تراكمي (بفواصل الأوامر)
  const [lastCmd, setLastCmd] = useState('');
  const [elapsed, setElapsed] = useState(0);      // ثوانٍ منذ بدء التنفيذ — مؤقت حي
  const [burst, setBurst] = useState(false);      // نبضة التفعيل عند استلام الأمر
  const [bootDone, setBootDone] = useState(false);
  const [bootLine, setBootLine] = useState(0);
  const [clock, setClock] = useState('');
  const [isFull, setIsFull] = useState(false);
  const [showHist, setShowHist] = useState(false);
  const [locked, setLocked] = useState<boolean | null>(null); // null = جارٍ فحص الجلسة
  const [tel, setTel] = useState<Telemetry>({
    price: null, changePct: null, source: '—', session: '—',
    connected: null, balance: null, equity: null, signals: null, strategiesOn: null,
  });
  const [spark, setSpark] = useState<number[]>([]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const consoleRef = useRef<HTMLDivElement | null>(null);
  const sparkRef = useRef<number[]>([]);

  // ---------- محرك الصوت المشترك (طابور + مايك + كلمة التنبيه) ----------
  const sendRef = useRef<(t: string) => void>(() => {});
  const voice = useJarvisVoice({
    onWakeCommand: cmd => { if (!busy) sendRef.current(cmd); },
    onWakeOnly: () => setAck('في الخدمة يا سيدي.'),
    onOnceCommand: cmd => sendRef.current(cmd),
    isBusy: () => busy,
  });
  const { speaking, voiceOn, toggleVoice, stopSpeech, speak, micMode, micSupported, interim, toggleMic, enableAlways, listening, alwaysOn } = voice;

  // حالة المفاعل
  const state: CoreState = speaking ? 'speaking' : busy ? 'thinking' : listening ? 'listening' : 'idle';
  const spd = REACTOR_SPEED[state];

  // ---------- الإقلاع السينمائي ----------
  useEffect(() => {
    if (sessionStorage.getItem('jarvis-booted')) { setBootDone(true); return; }
    if (bootLine >= BOOT_LINES.length) {
      const t = setTimeout(() => { sessionStorage.setItem('jarvis-booted', '1'); setBootDone(true); }, 600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setBootLine(l => l + 1), bootLine === 0 ? 380 : 360);
    return () => clearTimeout(t);
  }, [bootLine]);

  // ---------- الساعة الحية ----------
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-GB', { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ---------- مؤقت التنفيذ الحي ----------
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  // ---------- القياسات الحية: السعر + الحساب + الإشارات ----------
  useEffect(() => {
    let alive = true;
    const pullPrice = async () => {
      try {
        const r = await fetch('/api/price', { cache: 'no-store' });
        const j = await r.json();
        if (!alive || typeof j.price !== 'number') return;
        setTel(t => ({ ...t, price: j.price, changePct: j.changePct ?? null, source: j.source === 'mt5' ? 'MT5 حي' : 'احتياطي', session: j.session ?? '—' }));
        const arr = [...sparkRef.current, j.price].slice(-48);
        sparkRef.current = arr;
        setSpark(arr);
      } catch { /* تجاهل */ }
    };
    const pullAccount = async () => {
      try {
        const r = await fetch('/api/mt5/status', { cache: 'no-store' });
        const j = await r.json();
        if (!alive) return;
        setTel(t => ({
          ...t,
          connected: !!j.connected,
          balance: typeof j.account?.balance === 'number' ? j.account.balance : null,
          equity: typeof j.account?.equity === 'number' ? j.account.equity : null,
        }));
      } catch { /* تجاهل */ }
    };
    const pullSignals = async () => {
      try {
        const [sig, st] = await Promise.all([
          fetch('/api/signals', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
          fetch('/api/settings', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        ]);
        if (!alive) return;
        const strategiesOn = st?.settings?.sessions
          ? Object.values(st.settings.sessions as Record<string, Record<string, boolean>>)
            .filter(ses => Object.values(ses).some(Boolean)).length
          : null;
        setTel(t => ({ ...t, signals: Array.isArray(sig?.signals) ? sig.signals.length : null, strategiesOn }));
      } catch { /* تجاهل */ }
    };
    void pullPrice(); void pullAccount(); void pullSignals();
    const i1 = setInterval(pullPrice, 4000);
    const i2 = setInterval(pullAccount, 6000);
    const i3 = setInterval(pullSignals, 15000);
    return () => { alive = false; clearInterval(i1); clearInterval(i2); clearInterval(i3); };
  }, []);

  // ---------- الجسيمات الذهبية العائمة (canvas) ----------
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const resize = () => { cv.width = cv.offsetWidth; cv.height = cv.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);
    const N = 60;
    const ps = Array.from({ length: N }, () => ({
      x: Math.random() * cv.width, y: Math.random() * cv.height,
      r: 0.6 + Math.random() * 1.9, s: 0.08 + Math.random() * 0.35,
      o: 0.15 + Math.random() * 0.5, dx: (Math.random() - 0.5) * 0.15,
    }));
    const loop = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of ps) {
        p.y -= p.s; p.x += p.dx;
        if (p.y < -4) { p.y = cv.height + 4; p.x = Math.random() * cv.width; }
        if (p.x < -4) p.x = cv.width + 4; if (p.x > cv.width + 4) p.x = -4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(217,180,92,${p.o})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  // ---------- حالة قفل الخدمة (الرمز السري) ----------
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/jarvis/auth', { cache: 'no-store' });
        const j = await r.json();
        setLocked(!!j?.locked);
      } catch { setLocked(false); } // فشل الفحص = لا نحبس السيد عتماً
    })();
  }, []);

  const lockService = useCallback(async () => {
    try { await fetch('/api/jarvis/auth', { method: 'DELETE' }); } catch { /* إغلاق محلي */ }
    setLocked(true);
  }, []);

  // ---------- التاريخ السابق — بعد فتح القفل فقط (المسار محمي) ----------
  useEffect(() => {
    if (locked !== false) return;
    (async () => {
      try {
        const r = await fetch('/api/jarvis', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        const hist = (j.history ?? []) as { t: number; text: string; reply: string; steps: { label: string; ok: boolean; detail: string }[]; data?: unknown }[];
        const restored: Msg[] = [];
        for (const h of hist.slice().reverse()) {
          restored.push({ role: 'user', text: h.text, steps: [] });
          restored.push({ role: 'jarvis', text: h.reply, steps: h.steps ?? [], data: h.data });
        }
        setMsgs(restored);
      } catch { /* أول تشغيل */ }
    })();
  }, [locked]);

  // ---------- تأثير الكتابة الحية للرد ----------
  useEffect(() => {
    if (!finalText) { setTyped(''); return; }
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(i + 2, finalText.length);
      setTyped(finalText.slice(0, i));
      if (i >= finalText.length) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [finalText]);

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight, behavior: 'smooth' });
  }, [liveSteps, typed, finalText]);

  // ---------- الشاشة الكاملة ----------
  useEffect(() => {
    const h = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  }, []);

  // ---------- إرسال الأمر: جارفس ينفذ الآن ويرد بالنتيجة في نفس الدور ----------
  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    setLiveSteps([]);
    setFinalText('');
    setTyped('');
    setLastCmd(text);
    setBurst(true);
    setTimeout(() => setBurst(false), 700);
    stopSpeech(); // أمر جديد = إسكات فوري للسابق
    setRunLog(l => [...l, { label: 'أمر جديد من السيد', detail: text, ok: true, sep: true }]);
    setMsgs(m => [...m, { role: 'user', text, steps: [] }, { role: 'jarvis', text: '', steps: [] }]);
    // الرد الشفهي الفوري من الكاش المُسخَّن — يجيب قبل انتهاء التخطيط
    const ackText = text.includes('؟') ? 'لحظات يا سيدي.' : 'حاضر يا سيدي.';
    setAck(ackText.replace(' يا سيدي.', ' يا سيدي —'));
    speak(ackText);

    try {
      const r = await fetch('/api/jarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (r.status === 401) { setLocked(true); setBusy(false); return; } // انقضت الجلسة — أعِد القفل
      if (!r.body) throw new Error('no stream');
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      const applyLast = (fn: (m: Msg) => Msg) => setMsgs(m => {
        const out = m.slice();
        out[out.length - 1] = fn(out[out.length - 1]);
        return out;
      });

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { t: string; label?: string; detail?: string; ok?: boolean; ms?: number; reply?: string; say?: string; message?: string; runMs?: number; data?: unknown };
          if (ev.t === 'step') {
            const s = { label: ev.label ?? '', detail: ev.detail ?? '', ok: ev.ok ?? true, ms: ev.ms };
            applyLast(m => ({ ...m, steps: [...m.steps, s] }));
            setLiveSteps(ls => [...ls, s]);
            setRunLog(l => [...l, s]);
          } else if (ev.t === 'reply') {
            applyLast(m => ({ ...m, text: ev.reply ?? '', runMs: ev.runMs, data: ev.data ?? undefined }));
            setFinalText(ev.reply ?? '');
            if (ev.say) speak(ev.say);
            setAck('');
          } else if (ev.t === 'error') {
            applyLast(m => ({ ...m, text: ev.message ?? 'حدث خطأ' }));
            setFinalText(ev.message ?? 'حدث خطأ');
            if (ev.message) speak(ev.message);
            setAck('');
          }
        }
      }
      setBusy(false);
    } catch {
      const m = 'انقطع الاتصال بالخادم أثناء التنفيذ — أعد الأمر يا سيدي.';
      setMsgs(mm => { const out = mm.slice(); out[out.length - 1] = { role: 'jarvis', text: m, steps: [] }; return out; });
      setFinalText(m);
      speak(m);
      setBusy(false);
      setAck('');
    }
  }, [busy, speak, stopSpeech]);
  useEffect(() => { sendRef.current = (t: string) => void send(t); }, [send]);

  // ---------- منحنى السعر المصغر ----------
  const sparkPath = (() => {
    if (spark.length < 2) return '';
    const min = Math.min(...spark), max = Math.max(...spark);
    const span = max - min || 1;
    return spark.map((v, i) => {
      const x = (i / (spark.length - 1)) * 100;
      const y = 34 - ((v - min) / span) * 32;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  })();
  const up = (tel.changePct ?? 0) >= 0;

  // أقصى زمن خطوة في التشغيل الحالي — لقياس أشرطة الزمن
  const maxMs = Math.max(1, ...liveSteps.map(s => s.ms ?? 0));
  const doneCount = liveSteps.length;

  // الرد الأخير المعروض في التقرير
  const lastJarvis = [...msgs].reverse().find(m => m.role === 'jarvis' && (m.text || m.steps.length));
  const typing = lastJarvis && finalText && typed.length < finalText.length && i_last(lastJarvis, msgs);

  // ==== بوابة القفل: لا واجهة بلا جلسة صالحة (الرمز السري) ====
  if (locked !== false) {
    return <JarvisLock onUnlock={() => setLocked(false)} checking={locked === null} />;
  }

  return (
    <div
      ref={rootRef}
      dir="rtl"
      // طبقة كاملة بملء الشاشة: flex عمودي صارم — الرأس ثابت ثم الجسم المرن
      // ثم مرسى الكتابة في التدفق (ليس absolute أبداً) ⇒ يبقى ظاهراً دائماً
      className="fixed inset-0 z-40 flex flex-col h-[100dvh] overflow-hidden bg-[#05070d] select-none"
      style={{
        '--core': CORE_COLOR[state],
        '--s1': spd.s1, '--s2': spd.s2, '--s3': spd.s3, '--s4': spd.core,
      } as React.CSSProperties}
    >
      <style>{`
        @keyframes hud-spin { to { transform: rotate(360deg); } }
        @keyframes hud-spin-rev { to { transform: rotate(-360deg); } }
        @keyframes hud-breathe { 0%,100% { transform: scale(1); opacity: .9; } 50% { transform: scale(1.12); opacity: 1; } }
        @keyframes hud-core { 0%,100% { transform: scale(1); opacity: .85; } 50% { transform: scale(1.18); opacity: 1; } }
        @keyframes hud-scan { 0% { top: -12%; } 100% { top: 112%; } }
        @keyframes hud-blink { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
        @keyframes hud-bar { 0%,100% { transform: scaleY(.35); } 50% { transform: scaleY(1); } }
        @keyframes hud-flicker { 0%,92%,96%,100% { opacity: 1; } 94% { opacity: .55; } }
        @keyframes hud-flick { 0% { opacity: .35; } 100% { opacity: 1; } }
        @keyframes hud-burst { 0% { transform: scale(.97); } 45% { transform: scale(1.05); } 100% { transform: scale(1); } }
        @keyframes hud-progress { 0% { transform: translateX(110%); } 100% { transform: translateX(-110%); } }
        @keyframes hud-shimmer { 0%,100% { opacity: .45; } 50% { opacity: 1; } }
        .hud-r1 { animation: hud-spin var(--s1) linear infinite; transform-origin: center; }
        .hud-r2 { animation: hud-spin-rev var(--s2) linear infinite; transform-origin: center; }
        .hud-r3 { animation: hud-spin var(--s3) linear infinite; transform-origin: center; }
        .hud-coils { animation: hud-flicker 7s linear infinite; transform-origin: center; }
        .hud-core-pulse { animation: hud-core var(--s4) ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
        .hud-breathe-glow { animation: hud-breathe 3.4s ease-in-out infinite; }
        .hud-burst-on { animation: hud-burst .65s cubic-bezier(.2,.9,.3,1) 1; }
        .hud-scanline { position: absolute; left: 0; right: 0; height: 110px; pointer-events: none;
          background: linear-gradient(to bottom, transparent, rgba(217,180,92,.06), transparent);
          animation: hud-scan 7.5s linear infinite; }
        .hud-prog-inner { animation: hud-progress 1.4s linear infinite; }
        .hud-shimmer { animation: hud-shimmer 1.2s ease-in-out infinite; }
      `}</style>

      {/* ==== طبقات الخلفية ==== */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(217,180,92,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(217,180,92,.05) 1px, transparent 1px)',
          backgroundSize: '46px 46px',
          maskImage: 'radial-gradient(ellipse 85% 75% at 50% 42%, black 30%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse 85% 75% at 50% 42%, black 30%, transparent 78%)',
        }} />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none opacity-80" />
      <div className="absolute inset-0 pointer-events-none opacity-60"
        style={{ background: 'repeating-linear-gradient(to bottom, rgba(255,255,255,.015) 0 1px, transparent 1px 3px)' }} />
      <div className="hud-scanline" />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 90% 80% at 50% 40%, transparent 55%, rgba(2,4,9,.78) 100%)' }} />

      {/* ==== أقواس HUD الزاوية ==== */}
      <div className="absolute top-2 right-2 w-12 h-12 border-t-2 border-r-2 border-[#d9b45c]/50 pointer-events-none" />
      <div className="absolute top-2 left-2 w-12 h-12 border-t-2 border-l-2 border-[#d9b45c]/50 pointer-events-none" />
      <div className="absolute bottom-2 right-2 w-12 h-12 border-b-2 border-r-2 border-[#d9b45c]/50 pointer-events-none" />
      <div className="absolute bottom-2 left-2 w-12 h-12 border-b-2 border-l-2 border-[#d9b45c]/50 pointer-events-none" />

      {/* ==== شريط التقدم العلوي أثناء التنفيذ ==== */}
      {busy && (
        <div className="absolute top-0 left-0 right-0 h-[3px] z-30 overflow-hidden bg-[#d9b45c]/10">
          <div className="hud-prog-inner h-full w-1/3 bg-gradient-to-l from-transparent via-[#f3dc9a] to-transparent" />
        </div>
      )}

      {/* ==== شريط الرأس ==== */}
      <div className="relative z-10 flex items-center justify-between gap-2 px-5 pt-3.5 pb-3 border-b border-[#d9b45c]/15">
        <div className="flex items-center gap-3.5 min-w-0">
          <Zap className="w-5 h-5 text-[#d9b45c] shrink-0" style={{ animation: 'hud-blink 2.2s ease-in-out infinite' }} />
          <div className="min-w-0">
            <div className="text-[15px] font-black tracking-[.18em] text-[#d9b45c]">J.A.R.V.I.S <span className="text-[#5a6474] font-mono text-[10.5px] font-normal">/ BFX AURUM CORE v4</span></div>
            <div className="text-[11px] text-[#8a94a6] font-mono">{clock} <span className={cn('mr-2.5', tel.connected ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>● MT5 {tel.connected === null ? '…' : tel.connected ? 'LIVE' : 'OFF'}</span></div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('dashboard')}
            title="العودة إلى لوحة التحكم الرئيسية"
            className="h-9 px-3 rounded-lg border border-[#1b2334] bg-[#0a0e17] text-[#8a94a6] hover:text-[#d9b45c] hover:border-[#d9b45c]/40 flex items-center gap-1.5 text-[12px] font-bold transition-colors"
          >
            <LayoutDashboard className="w-4 h-4" />
            <span className="hidden sm:inline">لوحة التحكم</span>
          </button>
          <button
            onClick={enableAlways.bind(null, !alwaysOn)}
            title="استماع دائم لكلمة التنبيه «جارفس»"
            className={cn('h-9 px-3 rounded-lg border text-[12px] font-bold flex items-center gap-1.5 transition-colors',
              alwaysOn ? 'border-[#39c4e8]/60 bg-[#39c4e8]/10 text-[#39c4e8]' : 'border-[#1b2334] bg-[#0a0e17] text-[#8a94a6] hover:text-[#d9b45c]')}
          >
            {alwaysOn ? <Ear className="w-4 h-4" /> : <EarOff className="w-4 h-4" />}
            <span className="hidden sm:inline">تنبيه «جارفس»</span>
          </button>
          <button
            onClick={toggleVoice}
            title={voiceOn ? 'كتم الصوت' : 'تشغيل الصوت'}
            className={cn('h-9 px-3 rounded-lg border text-[12px] font-bold flex items-center gap-1.5 transition-colors',
              voiceOn ? 'border-[#d9b45c]/50 bg-[#d9b45c]/10 text-[#d9b45c]' : 'border-[#1b2334] bg-[#0a0e17] text-[#8a94a6]')}
          >
            {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span className="hidden sm:inline">{voiceOn ? 'الصوت' : 'صامت'}</span>
          </button>
          <button
            onClick={toggleFullscreen}
            title="شاشة كاملة"
            className="h-9 px-3 rounded-lg border border-[#1b2334] bg-[#0a0e17] text-[#8a94a6] hover:text-[#d9b45c] flex items-center"
          >
            {isFull ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={lockService}
            title="قفل خدمة جارفس بالرمز السري"
            className="h-9 px-3 rounded-lg border border-[#f6465d]/30 bg-[#f6465d]/5 text-[#f6465d]/90 hover:bg-[#f6465d]/15 hover:border-[#f6465d]/60 flex items-center gap-1.5 text-[12px] font-bold transition-colors"
          >
            <Lock className="w-4 h-4" />
            <span className="hidden sm:inline">قفل</span>
          </button>
        </div>
      </div>

      {/* ==== جسم الـ HUD: لوحات + مفاعل — يملأ المسعة بين الرأس والمرسى بلا أي حسابات يدوية ==== */}
      <div className="relative z-10 flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[300px_1fr_300px] xl:grid-cols-[335px_1fr_335px] gap-3 px-4 pt-3 pb-2">

        {/* — لوحة القياسات الحية (يمين) — */}
        <aside className="hidden lg:flex flex-col gap-3 min-h-0 overflow-y-auto custom-scrollbar pr-0.5">
          <div className="rounded-xl border border-[#d9b45c]/25 bg-[#0a0e17]/80 backdrop-blur-sm p-3.5">
            <div className="flex items-center justify-between text-[10.5px] font-mono text-[#8a94a6] mb-2">
              <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-[#d9b45c]" /> XAUUSD — GOLD SPOT</span>
              <span className={cn('text-[9.5px] px-1.5 py-0.5 rounded border', tel.source === 'MT5 حي' ? 'text-[#2ebd85] border-[#2ebd85]/40' : 'text-[#8a94a6] border-[#1b2334]')}>{tel.source}</span>
            </div>
            {/* وميض السعر لحظة تحديثه — على طريقة diag-value flicker في project-jarvis */}
            <div key={tel.price ?? 'p'} className="text-[34px] font-black text-[#f3dc9a] leading-none font-mono tabular-nums" style={{ animation: 'hud-flick .35s ease-out 1' }}>
              {tel.price !== null ? tel.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className={cn('text-[12px] font-bold px-2 py-0.5 rounded flex items-center gap-1',
                up ? 'text-[#2ebd85] bg-[#2ebd85]/10' : 'text-[#f6465d] bg-[#f6465d]/10')}>
                {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {tel.changePct !== null ? `${up ? '+' : ''}${tel.changePct.toFixed(2)}%` : '—'}
              </span>
              <span className="text-[10.5px] text-[#8a94a6]">الجلسة: <b className="text-[#c3cbd9]">{tel.session}</b></span>
            </div>
            {sparkPath && (
              <svg viewBox="0 0 100 36" className="w-full h-10 mt-2.5" preserveAspectRatio="none">
                <path d={sparkPath} fill="none" stroke="#d9b45c" strokeWidth="1.5" style={{ filter: 'drop-shadow(0 0 4px rgba(217,180,92,.7))' }} />
              </svg>
            )}
          </div>

          <div className="rounded-xl border border-[#d9b45c]/25 bg-[#0a0e17]/80 backdrop-blur-sm p-3.5 space-y-2.5">
            <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-[#8a94a6]"><Wallet className="w-3.5 h-3.5 text-[#d9b45c]" /> ACCOUNT</div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-[#8a94a6]">الرصيد</span>
              <span className="font-mono font-bold text-[15px] text-[#e8e4d8] tabular-nums">{tel.balance !== null ? `${tel.balance.toFixed(2)}$` : '—'}</span>
            </div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-[#8a94a6]">الحقوق</span>
              <span className={cn('font-mono font-bold text-[15px] tabular-nums', tel.equity !== null && tel.balance !== null && tel.equity < tel.balance ? 'text-[#f6465d]' : 'text-[#2ebd85]')}>
                {tel.equity !== null ? `${tel.equity.toFixed(2)}$` : '—'}
              </span>
            </div>
            <div className="h-px bg-[#1b2334]" />
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-[#8a94a6]">فرق الحقوق</span>
              <span className={cn('font-mono font-bold tabular-nums', (tel.equity ?? 0) - (tel.balance ?? 0) < 0 ? 'text-[#f6465d]' : 'text-[#2ebd85]')}>
                {tel.equity !== null && tel.balance !== null ? `${((tel.equity - tel.balance) >= 0 ? '+' : '')}${(tel.equity - tel.balance).toFixed(2)}$` : '—'}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-[#d9b45c]/25 bg-[#0a0e17]/80 backdrop-blur-sm p-3.5 space-y-2.5">
            <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-[#8a94a6]"><Radio className="w-3.5 h-3.5 text-[#d9b45c]" /> STRATEGY GRID</div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-[#8a94a6]">استراتيجيات مفعّلة</span>
              <span className="font-mono font-bold text-[15px] text-[#d9b45c] tabular-nums">{tel.strategiesOn ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-[#8a94a6]">إشارات حية</span>
              <span className="font-mono font-bold text-[15px] text-[#39c4e8] tabular-nums">{tel.signals ?? '—'}</span>
            </div>
            <div className="h-2 rounded-full bg-[#1b2334] overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-l from-[#d9b45c] to-[#e8a33d] transition-all duration-700"
                style={{ width: `${Math.min(100, ((tel.signals ?? 0) * 20) + 30)}%` }} />
            </div>
          </div>
        </aside>

        {/* — المركز: المفاعل + الكونسول — */}
        <section className="flex flex-col min-h-0 min-w-0 overflow-y-auto custom-scrollbar">
          {/* المفاعل */}
          <div className="relative flex flex-col items-center pt-0.5 shrink-0">
            <svg viewBox="0 0 300 300" className={cn('w-[min(300px,34vh)] h-[min(300px,34vh)] xl:w-[min(320px,36vh)] xl:h-[min(320px,36vh)]', burst && 'hud-burst-on')}
              style={{ filter: `drop-shadow(0 0 26px ${CORE_COLOR[state]}55)` }}>
              {/* تدرجات الزوايا الخارجية */}
              <g opacity=".5">
                {degTicks.map((t, i) => (
                  <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
                    stroke={t.major ? CORE_COLOR[state] : '#d9b45c'} strokeWidth={t.major ? 1.6 : 0.8} opacity={t.major ? 0.8 : 0.35} />
                ))}
              </g>
              <circle cx={C} cy={C} r={128} fill="none" stroke="#d9b45c22" strokeWidth="1" />
              <g className="hud-r1">
                <circle cx={C} cy={C} r={118} fill="none" stroke={CORE_COLOR[state]} strokeWidth="2.5" strokeDasharray="2 7" opacity=".75" />
              </g>
              {/* أقواس مقسومة — دوران معاكس */}
              <g className="hud-r2">
                <circle cx={C} cy={C} r={95} fill="none" stroke={CORE_COLOR[state]} strokeWidth="3.5" strokeDasharray="130 66.7" opacity=".9" strokeLinecap="round" />
              </g>
              <g className="hud-r1">
                <circle cx={C} cy={C} r={88} fill="none" stroke={CORE_COLOR[state]} strokeWidth="1.2" strokeDasharray="40 20" opacity=".4" />
              </g>
              {/* نقاط مدارية */}
              <g className="hud-r3">
                {orbitDots.map((d, i) => (
                  <circle key={i} cx={d.x} cy={d.y} r={3.4} fill={CORE_COLOR[state]} opacity={i === 0 ? 1 : 0.55} />
                ))}
              </g>
              {/* الملفات النحاسية (شكل المفاعل الأيقوني) */}
              <g className="hud-coils">
                {coilPaths.map((d, i) => (
                  <path key={i} d={d} fill={`${CORE_COLOR[state]}30`} stroke={CORE_COLOR[state]} strokeWidth="1.4" opacity=".9" />
                ))}
              </g>
              {/* حلقات داخلية */}
              <circle cx={C} cy={C} r={46} fill="none" stroke={CORE_COLOR[state]} strokeWidth="1.6" opacity=".8" />
              <circle cx={C} cy={C} r={38} fill="none" stroke={CORE_COLOR[state]} strokeWidth="0.8" opacity=".45" strokeDasharray="4 4" />
              {/* النواة المتوهجة */}
              <g className="hud-core-pulse">
                <circle cx={C} cy={C} r={30} fill={CORE_COLOR[state]} opacity=".14" />
                <circle cx={C} cy={C} r={22} fill={CORE_COLOR[state]} opacity=".28" />
                <circle cx={C} cy={C} r={15} fill="#fff8e6" />
                <circle cx={C} cy={C} r={15} fill={CORE_COLOR[state]} opacity=".5" />
              </g>
            </svg>

            {/* موجات النطق الحية */}
            <div className="h-7 flex items-end gap-[3px] mt-0.5" aria-label={speaking ? 'جارفس يتحدث' : undefined}>
              {speaking
                ? WAVE_HEIGHTS.map((h, i) => (
                  <span key={i} className="w-[3.5px] rounded-sm origin-bottom"
                    style={{ height: `${h * 100}%`, background: CORE_COLOR.speaking, animation: `hud-bar .8s ease-in-out ${i * 80}ms infinite` }} />
                ))
                : <div className="h-[2px] w-48 rounded-full bg-gradient-to-l from-transparent via-[#d9b45c]/50 to-transparent" />}
            </div>

            <div className="text-center mt-1.5 min-h-[42px]">
              <div className="text-[15px] font-black" style={{ color: CORE_COLOR[state] }}>
                {ack || STATE_AR[state]}
              </div>
              <div className="text-[10px] font-mono tracking-[.34em] text-[#5a6474] mt-1">{STATE_EN[state]}</div>
            </div>
          </div>

          {/* ==== الكونسول المركزي: التنفيذ الحي / التقرير / الانتظار ==== */}
          <div ref={consoleRef} className="flex-1 min-h-[110px] overflow-y-auto rounded-xl border border-[#d9b45c]/20 bg-[#070a12]/85 backdrop-blur-sm p-3.5 space-y-2.5 custom-scrollbar select-text">

            {/* — وضع التنفيذ الحي — */}
            {busy ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[12px] font-mono text-[#d9b45c] tracking-widest">
                    <Loader2 className="w-4 h-4 animate-spin" /> وحدة التنفيذ الحية — EXECUTING
                  </div>
                  <div className="text-[11px] font-mono text-[#8a94a6]">
                    خطوات: <b className="text-[#d9b45c]">{doneCount}</b> · الزمن: <b className="text-[#d9b45c] tabular-nums">{elapsed}ث</b>
                  </div>
                </div>

                {/* الخطوة الحالية — كبيرة وواضحة جداً */}
                {liveSteps.length > 0 ? (
                  <div className="rounded-xl border border-[#e8a33d]/50 bg-[#e8a33d]/8 p-3.5 hud-shimmer">
                    <div className="text-[10px] font-mono text-[#e8a33d] tracking-[.25em] mb-1">الخطوة الجارية رقم {liveSteps.length}</div>
                    <div className="text-[17px] font-black text-[#f3dc9a]">{liveSteps[liveSteps.length - 1].label}</div>
                    <div className="text-[13px] text-[#c3cbd9] mt-1 leading-relaxed break-words">{liveSteps[liveSteps.length - 1].detail.slice(0, 160)}</div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#d9b45c]/30 bg-[#d9b45c]/5 p-4 text-center">
                    <div className="text-[14px] font-bold text-[#d9b45c]">جارفس يفكّر ويخطّط الأدوات…</div>
                    <div className="text-[11.5px] text-[#8a94a6] mt-1">أمرُك: «{lastCmd}»</div>
                  </div>
                )}

                {/* الخطوات المكتملة — شريط زمن لكل خطوة */}
                {liveSteps.length > 1 && (
                  <div className="space-y-1.5">
                    {liveSteps.slice(0, -1).map((s, k) => (
                      <div key={k} className="rounded-lg border border-[#1b2334] bg-[#0a0e17]/70 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 shrink-0 rounded-md border border-[#1b2334] bg-[#0d1220] flex items-center justify-center text-[10px] font-mono text-[#5a6474]">{k + 1}</span>
                          {s.ok ? <CheckCircle2 className="w-4 h-4 text-[#2ebd85] shrink-0" /> : <XCircle className="w-4 h-4 text-[#f6465d] shrink-0" />}
                          <span className="font-bold text-[13px] text-[#c3cbd9]">{s.label}</span>
                          <span className="mr-auto text-[10px] font-mono text-[#5a6474] shrink-0">{s.ms !== undefined && s.ms > 0 ? `${s.ms}ms` : '—'}</span>
                        </div>
                        <div className="text-[11.5px] text-[#8a94a6] pr-8 mt-0.5 break-words">{s.detail.slice(0, 120)}</div>
                        <div className="h-1 rounded-full bg-[#1b2334] mt-1.5 mr-8 overflow-hidden">
                          <div className={cn('h-full rounded-full', s.ok ? 'bg-[#2ebd85]/70' : 'bg-[#f6465d]/70')}
                            style={{ width: `${Math.max(5, Math.min(100, ((s.ms ?? 0) / maxMs) * 100))}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : /* — وضع التقرير بعد انتهاء التنفيذ — */
              lastJarvis?.text ? (
                <div className="space-y-3">
                  {/* ترويسة التقرير */}
                  <div className="flex items-center justify-between gap-2 flex-wrap rounded-lg border border-[#d9b45c]/30 bg-[#d9b45c]/6 px-3.5 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-[#d9b45c] shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[10px] font-mono tracking-[.25em] text-[#8a94a6]">تقرير جارفس — JARVIS REPORT</div>
                        <div className="text-[12.5px] font-bold text-[#d9b45c] truncate max-w-[380px]">أمر: «{lastCmd || lastJarvis.text.slice(0, 40)}»</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {lastJarvis.runMs !== undefined && (
                        <span className="text-[10.5px] font-mono px-2 py-1 rounded border border-[#1b2334] bg-[#0a0e17] text-[#8a94a6]">نفّذ في {(lastJarvis.runMs / 1000).toFixed(1)}ث</span>
                      )}
                      <span className="text-[10.5px] font-mono px-2 py-1 rounded border border-[#2ebd85]/40 bg-[#2ebd85]/10 text-[#2ebd85]">
                        {lastJarvis.steps.length > 0 ? `${lastJarvis.steps.length} خطوات ✓` : 'مباشر ✓'}
                      </span>
                    </div>
                  </div>

                  {/* شرائح الأرقام المستخرجة */}
                  {(() => {
                    const chips = extractChips(lastJarvis.text);
                    if (!chips.length) return null;
                    return (
                      <div className="flex flex-wrap gap-2">
                        {chips.map((c, i) => (
                          <div key={i} className="rounded-lg border border-[#d9b45c]/35 bg-[#0a0e17] px-3 py-1.5 text-center min-w-[74px]">
                            <div className="text-[16px] font-black font-mono text-[#f3dc9a] tabular-nums leading-none">
                              {c.u === '$' ? <><span className="text-[13px] align-top">$</span>{c.v}</> : <>{c.v}<span className="text-[12.5px] text-[#d9b45c]">{c.u}</span></>}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* نص التقرير المنسق */}
                  <div className="rounded-xl border border-[#1b2334] bg-[#0a0e17]/70 px-4 py-3">
                    {typing ? (
                      <p className="text-[13.5px] text-[#e8e4d8] leading-[1.9] whitespace-pre-wrap">
                        {typed}<span className="text-[#d9b45c]" style={{ animation: 'hud-blink .8s steps(1) infinite' }}>▍</span>
                      </p>
                    ) : (
                      <RichText text={lastJarvis.text} />
                    )}
                  </div>

                  {/* بطاقة تقرير الباك تيست — تظهر تلقائياً عند تنفيذ باك تيست */}
                  {(() => {
                    const bt = (lastJarvis.data as { backtest?: BacktestData } | undefined)?.backtest;
                    return bt && bt.stats ? <BacktestCard data={bt} /> : null;
                  })()}
                </div>
              ) : /* — وضع الانتظار — */
              (
                <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-4">
                  <Zap className="w-8 h-8 text-[#d9b45c]/50" />
                  <p className="text-[15px] font-bold text-[#d9b45c]">قل أو اكتب أمرك — أنفّذه الآن أمامك</p>
                  <p className="text-[12px] text-[#8a94a6] max-w-[420px] leading-relaxed">
                    «كم سعر الذهب الآن؟» · «فعّل جلسة لندن للاستراتيجية E» · «اجعل حد الخسارة اليومي 80 دولاراً» · «أضف مستوى شراء عند 4020 بوقف 12»
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 w-full max-w-[520px]">
                    {QUICK_COMMANDS.map(cmd => (
                      <button key={cmd} onClick={() => void send(cmd)}
                        className="h-10 rounded-lg border border-[#d9b45c]/35 bg-[#d9b45c]/8 text-[12px] font-bold text-[#d9b45c] hover:bg-[#d9b45c]/20 transition-colors">
                        {cmd}
                      </button>
                    ))}
                  </div>
                </div>
              )}
          </div>

          {/* ==== درج السجل السابق ==== */}
          {msgs.length > 2 && (
            <div className="shrink-0 rounded-lg border border-[#1b2334] bg-[#070a12]/85 mt-0">
              <button onClick={() => setShowHist(s => !s)}
                className="w-full flex items-center justify-between px-3.5 py-2 text-[11.5px] font-bold text-[#8a94a6] hover:text-[#d9b45c] transition-colors">
                <span className="flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> سجل المحادثات ({Math.floor(msgs.length / 2)})</span>
                {showHist ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
              {showHist && (
                <div className="max-h-[170px] overflow-y-auto custom-scrollbar px-3 pb-2 space-y-1.5">
                  {msgs.slice(0, -2).map((m, i) => m.role === 'user' ? (
                    <div key={i} className="flex items-start gap-2 text-[11px]">
                      <User className="w-3 h-3 mt-0.5 text-[#39c4e8] shrink-0" />
                      <span className="text-[#c3cbd9] font-bold truncate">{m.text}</span>
                    </div>
                  ) : (
                    <div key={i} className="flex items-start gap-2 text-[11px] pr-5">
                      <Zap className="w-3 h-3 mt-0.5 text-[#d9b45c] shrink-0" />
                      <span className="text-[#8a94a6] line-clamp-2">{m.text.replace(/\*\*/g, '').slice(0, 140)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* — وحدة التنفيذ + سلامة النواة (يسار) — */}
        <aside className="hidden lg:flex flex-col gap-3 min-h-0 overflow-y-auto custom-scrollbar pl-0.5">
          <div className="rounded-xl border border-[#d9b45c]/25 bg-[#0a0e17]/80 backdrop-blur-sm p-3.5 flex-1 min-h-[150px] flex flex-col">
            <div className="flex items-center justify-between text-[10.5px] font-mono text-[#8a94a6] mb-2.5">
              <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-[#d9b45c]" /> LIVE EXECUTION LOG</span>
              {busy && <span className="text-[#e8c66f] hud-shimmer">● يعمل الآن</span>}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-2">
              {runLog.length === 0 && (
                <div className="text-[11px] text-[#5a6474] font-mono leading-[2]">
                  &gt; النواة تعمل…<br />
                  &gt; الحارس يقظ — 7 فحوصات/30 ثانية<br />
                  &gt; بث MT5 متصل — ذهب حي<br />
                  &gt; بانتظار أوامرك يا سيدي
                </div>
              )}
              {runLog.slice(-14).map((s, k) => (
                s.sep ? (
                  <div key={k} className="flex items-center gap-2 pt-1">
                    <div className="h-px flex-1 bg-[#d9b45c]/25" />
                    <span className="text-[9px] font-mono text-[#d9b45c]/70 tracking-widest shrink-0">أمر جديد</span>
                    <div className="h-px flex-1 bg-[#d9b45c]/25" />
                  </div>
                ) : (
                  <div key={k} className="rounded-lg border border-[#141b2b] bg-[#080c15] px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5 text-[11.5px]">
                      <span className={cn('font-mono text-[13px] shrink-0', s.ok ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>{s.ok ? '✔' : '✖'}</span>
                      <span className="text-[#c3cbd9] font-bold truncate">{s.label}</span>
                      {s.ms !== undefined && s.ms > 0 && <span className="text-[9px] font-mono text-[#5a6474] shrink-0 mr-auto">{s.ms}ms</span>}
                    </div>
                    <div className="text-[10.5px] text-[#8a94a6] pr-4 break-words leading-relaxed">{s.detail.slice(0, 100)}</div>
                  </div>
                )
              ))}
              {busy && (
                <div className="text-[11px] text-[#e8c66f] font-mono hud-shimmer flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> ينفّذ الآن…
                </div>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-[#d9b45c]/25 bg-[#0a0e17]/80 backdrop-blur-sm p-3.5">
            <div className="text-[10.5px] font-mono text-[#8a94a6] mb-2">CORE INTEGRITY</div>
            <div className="space-y-2">
              <div className="flex justify-between text-[11.5px]"><span className="text-[#8a94a6]">العقل التنفيذي</span><span className="text-[#2ebd85] font-bold">متصل</span></div>
              <div className="flex justify-between text-[11.5px]"><span className="text-[#8a94a6]">الصوت الأنيق</span><span className="text-[#2ebd85] font-bold">ليلى — صوت لبناني ناعم</span></div>
              <div className="flex justify-between text-[11.5px]"><span className="text-[#8a94a6]">شبكة منع التأجيل</span><span className="text-[#2ebd85] font-bold">نشطة</span></div>
              <div className="h-2 rounded-full bg-[#1b2334] overflow-hidden">
                <div className={cn('h-full rounded-full transition-all duration-1000',
                  state === 'idle' ? 'w-2/3 bg-[#d9b45c]/70' : 'w-full bg-gradient-to-l from-[#d9b45c] to-[#f3dc9a] hud-breathe-glow')} />
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* ==== شريط الأوامر السفلية — في التدفق دائماً: مستحيل يخرج من الشاشة ==== */}
      <div className="relative z-20 shrink-0 border-t border-[#d9b45c]/20 bg-[#05070d]/95 backdrop-blur px-4 pt-2 pb-[max(0.625rem,env(safe-area-inset-bottom))] space-y-2">
        <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-0.5 [@media(max-height:640px)]:hidden">
          {QUICK_COMMANDS.map(cmd => (
            <button key={cmd} onClick={() => void send(cmd)} disabled={busy}
              className="shrink-0 h-8 px-3 rounded-md border border-[#d9b45c]/35 bg-[#d9b45c]/8 text-[11.5px] font-bold text-[#d9b45c] hover:bg-[#d9b45c]/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {cmd}
            </button>
          ))}
          {speaking && (
            <button onClick={stopSpeech}
              className="shrink-0 h-8 px-3 rounded-md border border-[#f6465d]/50 bg-[#f6465d]/10 text-[11.5px] font-bold text-[#f6465d] hover:bg-[#f6465d]/20">
              إسكات فوري
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleMic}
            disabled={!micSupported || busy}
            title={micSupported ? (listening ? 'إيقاف الاستماع' : 'تحدث بالعربية') : 'المايك غير مدعوم — استخدم Chrome حديث'}
            className={cn('w-12 h-12 shrink-0 rounded-lg border flex items-center justify-center transition-colors',
              listening ? 'border-[#39c4e8] bg-[#39c4e8]/15 text-[#39c4e8]' : 'border-[#d9b45c]/40 bg-[#0d1220] text-[#8a94a6] hover:text-[#d9b45c]',
              (!micSupported || busy) && 'opacity-40 cursor-not-allowed')}
          >
            {listening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
          <input
            value={listening && interim ? interim : input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void send(input); }}
            placeholder={listening ? 'أستمع إليك يا سيدي… (قل «جارفس» ثم أمرك في الاستماع الدائم)' : 'اكتب أمرك — جارفس ينفّذ الآن ويرد بالنتيجة لحظتها'}
            disabled={busy}
            className="flex-1 h-12 rounded-lg bg-[#0a0e17] border border-[#d9b45c]/30 px-4 text-[14px] text-[#e8e4d8] placeholder:text-[#5a6474] outline-none focus:border-[#d9b45c]/70 transition-colors disabled:opacity-50"
          />
          <button
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            className="h-12 px-5 shrink-0 rounded-lg bg-[#d9b45c]/15 border border-[#d9b45c]/60 text-[#d9b45c] text-[14px] font-black flex items-center gap-2 hover:bg-[#d9b45c]/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            تنفيذ
          </button>
        </div>
      </div>

      {/* ==== شاشة الإقلاع السينمائية — أعمدة حالة على طريقة project-jarvis ==== */}
      {!bootDone && (
        <div className="absolute inset-0 z-50 bg-[#020409] flex flex-col items-center justify-center gap-2 cursor-pointer" onClick={() => { sessionStorage.setItem('jarvis-booted', '1'); setBootDone(true); }}>
          <svg viewBox="0 0 300 300" className="w-48 h-48" style={{ filter: 'drop-shadow(0 0 30px #d9b45c88)' }}>
            <g className="hud-r1"><circle cx={C} cy={C} r={118} fill="none" stroke="#d9b45c" strokeWidth="2.5" strokeDasharray="2 7" /></g>
            <g className="hud-r2"><circle cx={C} cy={C} r={95} fill="none" stroke="#d9b45c" strokeWidth="3" strokeDasharray="130 66.7" strokeLinecap="round" /></g>
            <g className="hud-coils">{coilPaths.map((d, i) => <path key={i} d={d} fill="#d9b45c30" stroke="#d9b45c" strokeWidth="1.4" />)}</g>
            <g className="hud-core-pulse">
              <circle cx={C} cy={C} r={26} fill="#d9b45c" opacity=".2" />
              <circle cx={C} cy={C} r={16} fill="#fff8e6" />
            </g>
          </svg>
          <div className="font-mono text-[12px] text-[#d9b45c] tracking-wider w-[420px] max-w-[86vw] mt-2">
            {BOOT_LINES.slice(0, bootLine + 1).map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-6 py-0.5" style={{ animation: 'hud-flick .35s ease-out both' }}>
                <span>{l.t}</span>
                {l.s && <span className={cn('font-bold text-[11px] shrink-0', l.s === 'LIVE' || l.s === 'ONLINE' || l.s === 'READY' || l.s === 'ARMED' ? 'text-[#2ebd85]' : 'text-[#d9b45c]')} style={{ textShadow: '0 0 8px rgba(46,189,133,.5)' }}>{l.s}</span>}
              </div>
            ))}
          </div>
          <div className="text-[10px] text-[#5a6474] font-mono mt-3 tracking-widest">اضغط للتخطي — SKIP</div>
        </div>
      )}
    </div>
  );
}

// هل هذا الرد هو آخر عنصر في المحادثة (لتحديد مؤثر الكتابة)
function i_last(m: Msg, msgs: Msg[]): boolean {
  return msgs[msgs.length - 1] === m;
}
