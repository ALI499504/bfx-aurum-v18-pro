'use client';

// ============================================================
// محرك صوت جارفس (مشترك) — القلب النابض
// 1) النطق: طابور جُمل بتحميل مسبق متوازٍ وبث مباشر من الخادم
//    (صوت ليلى اللبنانية ar-LB-LaylaNeural) — صفر فجوات بين الجُمل.
// 2) المايك بنمطين:
//    - نقرة واحدة: أمر واحد لكل ضغطة.
//    - استماع دائم: ينصت دائماً وينتظر كلمة التنبيه «جارفس»
//      (أو jarvis) ثم ينفذ ما بعدها — مثل الفيلم تماماً —
//      ويسكت المايك تلقائياً أثناء نطقه كي لا يسمع نفسه.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';

interface SRResult { 0: { transcript: string }; isFinal: boolean }
interface SREvent { results: ArrayLike<SRResult>; resultIndex: number }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type MicMode = 'off' | 'once' | 'always';

// كلمة التنبيه: «جارفس» أو jarvis مع أي تشكيل/تراكيب شائعة
const WAKE_RE = /(?:^|[^\p{L}])+(?:يا\s*)?(?:جارفس|jarvis)[^\p{L}]*/iu;

export interface VoiceEngineOptions {
  /** أمر كامل بعد كلمة التنبيه — يُنادى فقط في وضع الاستماع الدائم */
  onWakeCommand: (cmd: string) => void;
  /** نطق كلمة التنبيه وحدها بلا أمر («جارفس» فقط) */
  onWakeOnly: () => void;
  /** أمر من نمط النقرة الواحدة */
  onOnceCommand: (cmd: string) => void;
  isBusy: () => boolean;
}

export function useJarvisVoice(opts: VoiceEngineOptions) {
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [micMode, setMicMode] = useState<MicMode>('off');
  const [interim, setInterim] = useState('');
  const [micSupported, setMicSupported] = useState(false);

  const queueRef = useRef<HTMLAudioElement[]>([]);
  const currentRef = useRef<HTMLAudioElement | null>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const micModeRef = useRef<MicMode>('off');
  const mutedForSpeechRef = useRef(false);
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  useEffect(() => {
    queueMicrotask(() => {
      const w = window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike; SpeechRecognition?: new () => SpeechRecognitionLike };
      setMicSupported(!!(w.webkitSpeechRecognition || w.SpeechRecognition));
    });
  }, []);

  // ---------- النطق: الطابور ----------
  const drainStop = useCallback(() => {
    for (const a of queueRef.current.splice(0)) {
      a.onended = null; a.onerror = null; a.pause(); a.removeAttribute('src'); a.load();
    }
    const cur = currentRef.current;
    currentRef.current = null;
    if (cur) { cur.onended = null; cur.onerror = null; cur.pause(); cur.removeAttribute('src'); cur.load(); }
    setSpeaking(false);
  }, []);

  const playNextRef = useRef<() => void>(() => {});
  const playNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      currentRef.current = null;
      setSpeaking(false);
      return;
    }
    currentRef.current = next;
    setSpeaking(true);
    const advance = () => {
      next.onended = null; next.onerror = null;
      next.pause(); next.removeAttribute('src'); next.load();
      playNextRef.current();
    };
    next.onended = advance;
    next.onerror = advance;
    void next.play().catch(advance);
  }, []);
  useEffect(() => { playNextRef.current = playNext; });

  const speak = useCallback((text: string) => {
    if (!voiceOn || !text.trim()) return;
    // القراءة الكاملة بلا اقتطاع: تقسيم لجُمل، والجملة الطويلة جداً
    // تُقطَّع عند الفواصل/المسافات كي لا تتجاوز حد النص في الخادم
    const norm = text.replace(/\s+/g, ' ').trim();
    const rough = norm.split(/(?<=[.؟!؛])\s+/).map(s => s.trim()).filter(Boolean);
    const parts: string[] = [];
    for (const seg of rough) {
      if (seg.length <= 280) { parts.push(seg); continue; }
      let cur = '';
      for (const piece of seg.split(/(?<=،)\s*|\s+/)) {
        const merged = cur ? `${cur} ${piece}` : piece;
        if (merged.length <= 240) { cur = merged; continue; }
        if (cur) parts.push(cur);
        cur = piece.length > 240 ? piece.slice(0, 240) : piece;
      }
      if (cur) parts.push(cur);
    }
    const capped = parts.slice(0, 30); // تقارير كاملة — حتى 30 جملة مقروءة
    if (!capped.length) return;
    // المايك يصمت أثناء النطق كي لا يستمع لنفسه
    if (micModeRef.current !== 'off' && recogRef.current) {
      mutedForSpeechRef.current = true;
      try { recogRef.current.stop(); } catch { /* تجاهل */ }
    }
    const items = capped.map(t => {
      const a = new Audio(`/api/jarvis/tts?text=${encodeURIComponent(t)}`);
      a.preload = 'auto';
      return a;
    });
    queueRef.current.push(...items);
    if (!currentRef.current) playNext();
  }, [voiceOn, playNext]);

  const toggleVoice = useCallback(() => {
    setVoiceOn(v => {
      if (v) drainStop();
      return !v;
    });
  }, [drainStop]);

  // استئناف الاستماع الدائم بعد انتهاء النطق
  useEffect(() => {
    if (speaking || micModeRef.current !== 'always') return;
    const id = setTimeout(() => {
      if (micModeRef.current !== 'always') return;
      mutedForSpeechRef.current = false;
      try { recogRef.current?.start(); } catch { /* بدأ مسبقاً */ }
    }, 450);
    return () => clearTimeout(id);
  }, [speaking]);

  // ---------- المايك ----------
  const buildRecognition = useCallback((mode: 'once' | 'always'): SpeechRecognitionLike | null => {
    const w = window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike; SpeechRecognition?: new () => SpeechRecognitionLike };
    const Rec = w.webkitSpeechRecognition || w.SpeechRecognition;
    if (!Rec) return null;
    const rec = new Rec();
    rec.lang = 'ar-SA';
    rec.continuous = mode === 'always';
    rec.interimResults = mode === 'always';

    if (mode === 'once') {
      rec.onresult = e => {
        const t = e.results?.[0]?.[0]?.transcript?.trim() ?? '';
        if (t) optsRef.current.onOnceCommand(t);
      };
      rec.onerror = () => { setMicMode(m => (m === 'once' ? 'off' : m)); };
      rec.onend = () => { setMicMode(m => (m === 'once' ? 'off' : m)); };
    } else {
      rec.onresult = e => {
        // آخر نتيجة نهائية + العرض الحي للنص الجاري
        let finalText = '';
        let partial = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const t = r?.[0]?.transcript ?? '';
          if (r.isFinal) finalText += t; else partial += t;
        }
        setInterim(partial.trim());
        if (!finalText.trim()) return;
        const m = finalText.match(WAKE_RE);
        if (!m) return; // بلا كلمة التنبيه — جارفس لا يتدخل
        const cmd = finalText.replace(WAKE_RE, ' ').replace(/^[^\p{L}\p{N}]+/u, '').trim();
        setInterim('');
        if (cmd.length >= 2) {
          optsRef.current.onWakeCommand(cmd);
        } else {
          optsRef.current.onWakeOnly();
        }
      };
      rec.onerror = ev => {
        if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') setMicMode('off');
      };
      rec.onend = () => {
        setInterim('');
        // إعادة تشغيل تلقائية (المتصفح يقطع الجلسات طويلاً) — إلا إن كنا أوقفناها للنطق
        if (micModeRef.current === 'always' && !mutedForSpeechRef.current) {
          setTimeout(() => {
            if (micModeRef.current === 'always' && !mutedForSpeechRef.current) {
              try { recogRef.current?.start(); } catch { /* تجاهل */ }
            }
          }, 350);
        }
      };
    }
    return rec;
  }, []);

  const setMic = useCallback((mode: MicMode) => {
    try { recogRef.current?.abort(); } catch { /* تجاهل */ }
    recogRef.current = null;
    micModeRef.current = mode;
    mutedForSpeechRef.current = false;
    setInterim('');
    setMicMode(mode);
    if (mode === 'off') return;
    const rec = buildRecognition(mode);
    if (!rec) return;
    recogRef.current = rec;
    try { rec.start(); } catch { /* تجاهل */ }
  }, [buildRecognition]);

  // النقرة على زر المايك: off → once → off ، دائم → off
  const toggleMic = useCallback(() => {
    if (micModeRef.current === 'always') setMic('off');
    else if (micModeRef.current === 'once') setMic('off');
    else setMic('once');
  }, [setMic]);

  const enableAlways = useCallback((on: boolean) => {
    setMic(on ? 'always' : 'off');
  }, [setMic]);

  // تنظيف عند إلغاء التركيب
  useEffect(() => () => { try { recogRef.current?.abort(); } catch { /* تجاهل */ } drainStop(); }, [drainStop]);

  return {
    speaking, voiceOn, toggleVoice, stopSpeech: drainStop, speak,
    micMode, micSupported, interim, toggleMic, enableAlways,
    listening: micMode !== 'off', alwaysOn: micMode === 'always',
  };
}
