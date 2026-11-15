'use client';

// ============================================================
// نافذة جارفس — الوكيل المنفذ الناطق
// تحدثه بالعربية (نصاً أو صوتاً من المايك) وينفذ حرفياً:
// كل خطوة تظهر لحظتها في شريط النشاط، ونتيجة كل أمر تُنطق
// بصوت ليلى اللبنانية الفصيحة (ar-LB-LaylaNeural).
//
// محرك النطق (إصلاح التقطيع والتأخير):
// - النطق عبر <audio> ببث مباشر من الخادم — يبدأ فور وصول
//   أول إطارات MP3 بدل انتظار الملف كاملاً.
// - الرد يُقسَّم جُملاً قصيرة، وكل الجُمل تُحمَّل مسبقاً بالتوازي،
//   والتشغيل متصل جملة بعد جملة — صفر فجوات ولا تقطيع.
// - أمر جديد = إسكات فوري للسابق ثم رد جديد.
// - ردّ شفهي فوري «حاضر يا سيدي» من كاش مُسخَّن عند الإقلاع.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Mic, MicOff, Send, Volume2, VolumeX, User, CheckCircle2, XCircle, Loader2, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Step { label: string; detail: string; ok: boolean; ms?: number }
interface Msg {
  role: 'user' | 'jarvis';
  text: string;
  steps: Step[];
  runMs?: number;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

// تقسيم الرد إلى جُمل قصيرة — الفاصلة العشرية داخل الأرقام لا تكسر الجملة
// (القاعدة: نقط/علامة + مسافة بعدها = نهاية جملة، أما 4028.34 فبلا مسافة)
function splitSentences(text: string): string[] {
  const norm = text.replace(/\s+/g, ' ').trim();
  if (!norm) return [];
  const rough = norm.split(/(?<=[.؟!؛])\s+/).map(s => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const s of rough) {
    if (s.length <= 180) { out.push(s); continue; }
    let cur = '';
    for (const seg of s.split(/(?<=،)\s*/)) {
      const merged = cur ? `${cur}، ${seg}` : seg;
      if (merged.length <= 180) { cur = merged; continue; }
      if (cur) out.push(cur);
      cur = seg.length > 180 ? seg.slice(0, 180) : seg;
    }
    if (cur) out.push(cur);
  }
  return out.slice(0, 8);
}

export function JarvisWindow() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);

  const queueRef = useRef<HTMLAudioElement[]>([]);
  const currentRef = useRef<HTMLAudioElement | null>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // ---------- التاريخ السابق ----------
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/jarvis', { cache: 'no-store' });
        const j = await r.json();
        const hist = (j.history ?? []) as { t: number; text: string; reply: string; steps: { label: string; ok: boolean; detail: string }[] }[];
        const restored: Msg[] = [];
        for (const h of hist.slice().reverse()) {
          restored.push({ role: 'user', text: h.text, steps: [] });
          restored.push({ role: 'jarvis', text: h.reply, steps: h.steps ?? [] });
        }
        setMsgs(restored);
      } catch { /* أول تشغيل */ }
      setHistoryLoading(false);
    })();
  }, []);

  // ---------- دعم المايك (تعرف كلام المتصفح — العربية الفصحى) ----------
  useEffect(() => {
    const w = window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike; SpeechRecognition?: new () => SpeechRecognitionLike };
    setMicSupported(!!(w.webkitSpeechRecognition || w.SpeechRecognition));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  // ---------- محرك النطق: طابور جُمل بتحميل مسبق — صفر فجوات ----------
  const stopSpeech = useCallback(() => {
    for (const a of queueRef.current.splice(0)) {
      a.onended = null; a.onerror = null; a.pause(); a.removeAttribute('src'); a.load();
    }
    const cur = currentRef.current;
    currentRef.current = null;
    if (cur) { cur.onended = null; cur.onerror = null; cur.pause(); cur.removeAttribute('src'); cur.load(); }
    setSpeaking(false);
  }, []);

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
      playNext();
    };
    next.onended = advance;
    next.onerror = advance;
    void next.play().catch(advance);
  }, []);

  const speak = useCallback((text: string) => {
    if (!voiceOn || !text.trim()) return;
    const parts = splitSentences(text);
    if (!parts.length) return;
    // كل الجُمل تُنشأ فوراً وتُحمَّل بالتوازي — عند انتهاء جملة التالية جاهزة 100%
    const items = parts.map(t => {
      const a = new Audio(`/api/jarvis/tts?text=${encodeURIComponent(t)}`);
      a.preload = 'auto';
      return a;
    });
    queueRef.current.push(...items);
    if (!currentRef.current) playNext();
  }, [voiceOn, playNext]);

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    stopSpeech(); // أمر جديد = إسكات فوري للنطق السابق
    setMsgs(m => [...m, { role: 'user', text, steps: [] }, { role: 'jarvis', text: '', steps: [] }]);
    // ردّ شفهي فوري من الكاش المُسخَّن عند الإقلاع — جارفس يجيب قبل حتى أن ينتهي التخطيط
    speak(text.includes('؟') ? 'لحظات يا سيدي.' : 'حاضر يا سيدي.');

    try {
      const r = await fetch('/api/jarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.body) throw new Error('no stream');

      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      const apply = (fn: (last: Msg) => Msg) => {
        setMsgs(m => {
          const out = m.slice();
          const i = out.length - 1;
          out[i] = fn(out[i]);
          return out;
        });
      };

      // البث المباشر: كل سطر NDJSON خطوة تُعرض فور وصولها
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { t: string; label?: string; detail?: string; ok?: boolean; ms?: number; reply?: string; say?: string; message?: string };
          if (ev.t === 'step') {
            apply(m => ({ ...m, steps: [...m.steps, { label: ev.label ?? '', detail: ev.detail ?? '', ok: ev.ok ?? true, ms: ev.ms }] }));
          } else if (ev.t === 'reply') {
            apply(m => ({ ...m, text: ev.reply ?? '' }));
            if (ev.say) speak(ev.say); // يُضاف للطابور بعد الرد الشفهي الفوري مباشرة
          } else if (ev.t === 'error') {
            apply(m => ({ ...m, text: ev.message ?? 'حدث خطأ' }));
            if (ev.message) speak(ev.message);
          }
        }
      }
      setBusy(false);
    } catch {
      setMsgs(m => {
        const out = m.slice();
        out[out.length - 1] = { role: 'jarvis', text: 'انقطع الاتصال بالخادم أثناء التنفيذ — أعد الأمر يا سيدي.', steps: [] };
        return out;
      });
      speak('انقطع الاتصال بالخادم أثناء التنفيذ، أعد الأمر يا سيدي.');
      setBusy(false);
    }
  }, [busy, speak, stopSpeech]);

  const toggleMic = useCallback(() => {
    if (listening) { recogRef.current?.stop(); return; }
    const w = window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike; SpeechRecognition?: new () => SpeechRecognitionLike };
    const Rec = w.webkitSpeechRecognition || w.SpeechRecognition;
    if (!Rec) return;
    const rec = new Rec();
    recogRef.current = rec;
    rec.lang = 'ar-SA';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const t = e.results?.[0]?.[0]?.transcript ?? '';
      if (t) void send(t);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  }, [listening, send]);

  return (
    <div className="space-y-4">
      {/* رأس النافذة */}
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10">
            <div className={cn('absolute inset-0 rounded-full border-2 animate-pulse',
              speaking ? 'border-[#d9b45c]' : busy ? 'border-[#e8c66f]/60' : 'border-[#d9b45c]/40')} />
            <div className="absolute inset-1.5 rounded-full bg-[#d9b45c]/15 flex items-center justify-center">
              <Bot className={cn('w-5 h-5 text-[#d9b45c]', speaking && 'animate-bounce')} />
            </div>
            <span className="absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 rounded-full bg-[#2ebd85] border border-[#0d1220]" />
          </div>
          <div>
            <h2 className="text-[15px] font-bold text-[#d9b45c]">جارفس — وكيل التنفيذ الحي</h2>
            <p className="text-[11px] text-[#8a94a6]">
              نفّذ أي أمر: استراتيجيات، جلسات، قواعد، مستويات، باك تيست — وكل خطوة تُعرض وتُنطق بصوت حامد
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* موجات النطق + زر الإسكات الفوري */}
          {speaking && (
            <>
              <div className="flex items-end gap-0.5 h-5" aria-label="جارفس يتحدث الآن">
                {[0.5, 0.9, 0.65, 1, 0.75, 0.95].map((h, i) => (
                  <span key={i} className="w-1 rounded-sm bg-[#d9b45c] animate-pulse" style={{ height: `${h * 100}%`, animationDelay: `${i * 90}ms` }} />
                ))}
              </div>
              <button
                onClick={stopSpeech}
                title="إسكات جارفس فوراً"
                className="h-9 px-3 rounded-lg border border-[#f6465d]/50 bg-[#f6465d]/10 text-[#f6465d] text-[12px] font-bold flex items-center gap-1.5 hover:bg-[#f6465d]/20 transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
                إيقاف النطق
              </button>
            </>
          )}
          <button
            onClick={() => { setVoiceOn(v => { if (v) stopSpeech(); return !v; }); }}
            className={cn('h-9 px-3 rounded-lg border text-[12px] font-bold flex items-center gap-1.5 transition-colors',
              voiceOn ? 'border-[#d9b45c]/50 bg-[#d9b45c]/10 text-[#d9b45c]' : 'border-[#1b2334] bg-[#0a0e17] text-[#8a94a6]')}
          >
            {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            {voiceOn ? 'الصوت مفعّل' : 'الصوت صامت'}
          </button>
        </div>
      </div>

      {/* المحادثة */}
      <div className="rounded-xl border border-[#1b2334] bg-[#0a0e17] p-4">
        <div className="max-h-[52vh] min-h-[300px] overflow-y-auto space-y-4 pl-1 custom-scrollbar">
          {historyLoading && (
            <div className="flex items-center gap-2 text-[12px] text-[#8a94a6]">
              <Loader2 className="w-4 h-4 animate-spin" /> يجري استرجاع ذاكرة المحادثات…
            </div>
          )}
          {!historyLoading && msgs.length === 0 && (
            <div className="text-center py-10 space-y-2">
              <Bot className="w-8 h-8 text-[#d9b45c]/60 mx-auto" />
              <p className="text-[13px] font-bold text-[#d9b45c]">أنا جارفس — في انتظار أوامرك يا سيدي</p>
              <p className="text-[11.5px] text-[#8a94a6] max-w-[420px] mx-auto leading-relaxed">
                قل لي مثلاً: «كم سعر الذهب الآن؟» أو «فعّل جلسة لندن للاستراتيجية E» أو
                «اجعل حد الخسارة اليومي 80$» أو «شغّل باك تيست» أو «أضف مستوى شراء عند 4020 بوقف 12$»
              </p>
            </div>
          )}

          {msgs.map((m, i) => (
            m.role === 'user' ? (
              <div key={i} className="flex justify-start gap-2">
                <div className="max-w-[75%] rounded-xl rounded-tr-sm border border-[#d9b45c]/30 bg-[#d9b45c]/10 px-3 py-2 text-[13px] text-[#e8e4d8] leading-relaxed">
                  {m.text}
                </div>
                <div className="w-7 h-7 shrink-0 rounded-full bg-[#1b2334] flex items-center justify-center mt-0.5">
                  <User className="w-3.5 h-3.5 text-[#8a94a6]" />
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-end gap-2">
                <div className="w-7 h-7 shrink-0 rounded-full bg-[#d9b45c]/15 border border-[#d9b45c]/40 flex items-center justify-center mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-[#d9b45c]" />
                </div>
                <div className="max-w-[78%] space-y-2">
                  {/* شريط النشاط — كل خطوة لحظتها */}
                  {m.steps.length > 0 && (
                    <div className="rounded-lg border border-[#1b2334] bg-[#0d1220] p-2.5 space-y-1.5">
                      {m.steps.map((s, k) => (
                        <div key={k} className="flex items-start gap-2 text-[11.5px]">
                          {busy && i === msgs.length - 1 && k === m.steps.length - 1
                            ? <Loader2 className="w-3.5 h-3.5 mt-0.5 text-[#e8c66f] animate-spin shrink-0" />
                            : s.ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-[#2ebd85] shrink-0" />
                              : <XCircle className="w-3.5 h-3.5 mt-0.5 text-[#f6465d] shrink-0" />}
                          <div className="min-w-0">
                            <span className="font-bold text-[#c3cbd9]">{s.label}</span>
                            {s.ms !== undefined && s.ms > 0 && <span className="text-[#5a6474] font-mono text-[10px] mr-1.5">{s.ms}ms</span>}
                            <div className="text-[#8a94a6] break-words leading-relaxed">{s.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.text && (
                    <div className={cn('rounded-xl rounded-tl-sm border px-3 py-2 text-[13px] text-[#e8e4d8] leading-relaxed whitespace-pre-wrap transition-colors',
                      speaking && i === msgs.length - 1 ? 'border-[#d9b45c]/60' : 'border-[#1b2334] bg-[#0d1220]')}>
                      {m.text}
                      {m.runMs !== undefined && <span className="block text-[10px] text-[#5a6474] font-mono mt-1">نفّذ في {(m.runMs / 1000).toFixed(1)} ثانية</span>}
                    </div>
                  )}
                  {busy && i === msgs.length - 1 && !m.steps.length && (
                    <div className="flex items-center gap-2 text-[12px] text-[#8a94a6]">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#d9b45c]" /> جارفس يفكر وينفذ…
                    </div>
                  )}
                </div>
              </div>
            )
          ))}
          <div ref={endRef} />
        </div>

        {/* الإدخال */}
        <div className="mt-3 flex items-center gap-2 border-t border-[#1b2334] pt-3">
          <button
            onClick={toggleMic}
            disabled={busy || !micSupported}
            title={micSupported ? (listening ? 'إيقاف الاستماع' : 'تحدث بالعربية') : 'المايك غير مدعوم في هذا المتصفح — استخدم Firefox/Chrome الحديث'}
            className={cn('w-10 h-10 shrink-0 rounded-lg border flex items-center justify-center transition-colors',
              listening ? 'border-[#f6465d] bg-[#f6465d]/15 text-[#f6465d] animate-pulse'
                : 'border-[#1b2334] bg-[#0d1220] text-[#8a94a6] hover:text-[#d9b45c] hover:border-[#d9b45c]/40',
              (!micSupported || busy) && 'opacity-40 cursor-not-allowed')}
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void send(input); }}
            placeholder={listening ? 'أستمع إليك يا سيدي…' : 'اكتب أمرك بالعربية — جارفس ينفذ حرفياً'}
            disabled={busy}
            className="flex-1 h-10 rounded-lg bg-[#0d1220] border border-[#1b2334] px-3 text-[13px] text-[#e8e4d8] placeholder:text-[#5a6474] outline-none focus:border-[#d9b45c]/50 disabled:opacity-50"
          />
          <button
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            className="h-10 px-4 shrink-0 rounded-lg bg-[#d9b45c]/15 border border-[#d9b45c]/50 text-[#d9b45c] text-[13px] font-bold flex items-center gap-1.5 hover:bg-[#d9b45c]/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            تنفيذ
          </button>
        </div>
      </div>
    </div>
  );
}
