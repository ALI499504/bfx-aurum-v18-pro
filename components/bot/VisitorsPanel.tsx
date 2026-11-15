'use client';

// قائمة الأجهزة المتصلة لحظياً — إضافة لا تؤثر على أي شيء:
// • زر عائم صغير أسفل يسار الشاشة (خارج تدفق الصفحة تماماً)
// • نبضة كل 15 ثانية إلى /api/visitors — ورد النبضة نفسه يرجع القائمة الحية
// • دقة لحظية: عند إغلاق التبويب يُرسل إشعار مغادرة فوري (keepalive/sendBeacon)
//   فيختفي الجهاز من القائمة في نفس اللحظة — لا انتظار ولا مهلة
// • يُعد الجهاز متصلاً فقط إذا وصلت نبضته خلال آخر 65 ثانية ولم يُبلغ بمغادرة
// • القائمة تعرض الأجهزة المتصلة فعلياً الآن فقط — لا زوار قدامى ولا سجل
// • معرّف مجهول في localStorage — لا تُجمع أي بيانات شخصية
import { useCallback, useEffect, useRef, useState } from 'react';
import { Users, Monitor, Smartphone, Clock, LogIn, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBot } from './store';

interface VisitorRec {
  id: string;
  firstSeen: number;
  lastSeen: number;
  since: number;
  sessions: number;
  heartbeats: number;
  ip: string;
  ua: { browser: string; os: string; device: string };
  screen: string;
  viewport: string;
  lang: string;
  tz: string;
  tab: string;
  tf: string;
  referrer: string;
}

interface VisitorsData {
  online: number;
  total: number;
  now: number;
  visitors: VisitorRec[];
}

const HEARTBEAT_MS = 15_000;   // نبضة كل 15 ثانية
const OPEN_POLL_MS = 6_000;    // تحديث القائمة كل 6 ثوانٍ وهي مفتوحة
const ONLINE_MS = 65_000;      // متصل فعلياً = نبضة خلال آخر 65 ثانية

/** أسماء الشاشات بالعربية — تطابق تبويبات الشريط الجانبي */
const TAB_LABEL: Record<string, string> = {
  dashboard: 'لوحة القيادة',
  trades: 'سجل الصفقات',
  signals: 'الإشارات الحية',
  trainer: 'المدرب الذكي',
  levels: 'المستويات اليدوية',
  account: 'حسابي',
  sessions: 'الجلسات',
  priority: 'الأولويات',
  rules: 'القواعد العامة',
  indicators: 'المؤشرات',
  backtest: 'الباك تيست',
};

function myId(): string {
  const KEY = 'bfx_visitor_id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'anon-' + Math.random().toString(36).slice(2, 12);
  }
}

/** مصدر الدخول: hostname من referrer أو فارغ = مباشر */
function referrerSource(): string {
  try {
    if (!document.referrer) return '';
    return new URL(document.referrer).hostname || '';
  } catch { return ''; }
}

/** مدة بالعربية: X ثانية / دقيقة / ساعة — لمدة الاتصال الحالية */
function duration(t: number, now: number): string {
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s} ثانية`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} ${m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتين' : m <= 10 ? 'دقائق' : 'دقيقة'}`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  const hh = h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : `${h} ساعات`;
  return rem > 0 ? `${hh} و${rem} دقيقة` : hh;
}

/** آخر نبضة بالثواني — الدقة اللحظية */
function relTime(t: number, now: number): string {
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 15) return 'الآن لحظياً';
  if (s < 60) return `قبل ${s} ثانية`;
  const m = Math.floor(s / 60);
  if (m < 60) return `قبل ${m} ${m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتين' : 'دقائق'}`;
  const h = Math.floor(m / 60);
  return `قبل ${h} ${h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : 'ساعات'}`;
}

function fmtTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function VisitorsPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<VisitorsData | null>(null);
  const selfIdRef = useRef<string>('');
  // الشاشة المفتوحة حالياً — من مخزن البوت العام، والفريم من حدث لوحة القيادة
  const tab = useBot(s => s.tab);
  const [tf, setTf] = useState('');

  const refreshList = useCallback(async () => {
    try {
      const list = await fetch('/api/visitors', { cache: 'no-store' }).then(x => x.json());
      setData(list);
    } catch { /* ignore — اللوحة لا تؤثر على أي شيء */ }
  }, []);

  /** نبضة حية — رد النبضة يحمل القائمة الحية مباشرة (عدّاد لحظي بلا طلب إضافي) */
  const beat = useCallback(async () => {
    try {
      const id = selfIdRef.current || (selfIdRef.current = myId());
      const payload = {
        id,
        screen: `${screen?.width ?? 0}×${screen?.height ?? 0}`,
        viewport: `${innerWidth}×${innerHeight}`,
        lang: navigator.language || '',
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        tab,
        tf,
        referrer: referrerSource(),
      };
      const res = await fetch('/api/visitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      }).then(x => x.json());
      if (res?.list) setData(res.list);
    } catch { /* ignore */ }
  }, [tab, tf]);

  /** مغادرة فورية عند إغلاق التبويب — الجهاز يختفي من قائمة الآخرين في نفس اللحظة */
  useEffect(() => {
    const onLeave = () => {
      try {
        const id = selfIdRef.current || myId();
        const body = JSON.stringify({ id, leave: true });
        // keepalive يضمن وصول الطلب حتى أثناء تفكيك الصفحة، وsendBeacon احتياط
        fetch('/api/visitors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
          cache: 'no-store',
        }).catch(() => {
          try { navigator.sendBeacon?.('/api/visitors', new Blob([body], { type: 'application/json' })); } catch { /* ignore */ }
        });
      } catch { /* ignore */ }
    };
    window.addEventListener('pagehide', onLeave);
    return () => window.removeEventListener('pagehide', onLeave);
  }, []);

  // نبضة أولى فور الفتح + نبضات دورية + نبضة فورية عند العودة للتبويب أو التركيز
  useEffect(() => {
    selfIdRef.current = myId();
    const vis = () => { if (document.visibilityState === 'visible') beat(); };
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('focus', vis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('focus', vis);
    };
  }, [beat]);

  // اللوحة مفتوحة = تحديث حي أسرع كل 6 ثوانٍ
  useEffect(() => {
    if (!open) return;
    refreshList();
    const id = setInterval(refreshList, OPEN_POLL_MS);
    return () => clearInterval(id);
  }, [open, refreshList]);

  // الفريم الزمني المعروض في لوحة القيادة — حدث خفيف من Dashboard
  useEffect(() => {
    const h = (e: Event) => setTf((e as CustomEvent<string>).detail ?? '');
    window.addEventListener('bfx:tf', h);
    return () => window.removeEventListener('bfx:tf', h);
  }, []);

  const now = data?.now ?? Date.now();
  const onlineVisitors = (data?.visitors ?? []).filter(v => now - v.lastSeen <= ONLINE_MS && !(v as { leftAt?: number }).leftAt);
  const online = data?.online ?? 0;

  return (
    <div className="fixed bottom-3 left-3 z-50 print:hidden">
      {/* اللوحة */}
      {open && (
        <div className="absolute bottom-full mb-2 left-0 w-[340px] max-h-[470px] flex flex-col rounded-xl border border-[#1b2334] bg-[#0d1220] shadow-[0_8px_40px_rgba(0,0,0,0.55)] overflow-hidden">
          {/* رأس اللوحة */}
          <div className="shrink-0 px-3 py-2.5 border-b border-[#1b2334] bg-gradient-to-l from-[#101726] to-[#0d1220] flex items-center gap-2">
            <Users className="w-4 h-4 text-[#d9b45c]" />
            <span className="text-[12.5px] font-bold text-[#d9b45c]">الأجهزة المتصلة الآن</span>
            <div className="mr-auto">
              <span className="text-[10px] font-bold text-[#2ebd85] border border-[#2ebd85]/35 bg-[#2ebd85]/10 rounded px-1.5 py-0.5">
                {online > 0 ? `${online} ${online === 1 ? 'جهاز' : 'أجهزة'}` : 'لا شيء'}
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {/* ====== عنوان القسم الحي ====== */}
            <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 sticky top-0 bg-[#0d1220] z-10 border-b border-[#1b2334]/60">
              <span className="w-2 h-2 rounded-full bg-[#2ebd85] live-dot" />
              <span className="text-[11px] font-black text-[#2ebd85]">متصل فعلياً الآن</span>
              <span className="text-[9.5px] text-[#8a94a6]">— يختفي الجهاز لحظة إغلاق تبويبه</span>
            </div>

            {onlineVisitors.length === 0 ? (
              <div className="px-3 py-5 text-center text-[11px] text-[#8a94a6]">
                لا توجد أجهزة متصلة حالياً — افتح الرابط في متصفح آخر وسيظهر هنا لحظياً
              </div>
            ) : onlineVisitors.map(v => {
              const isSelf = v.id === selfIdRef.current;
              return (
                <div key={v.id} className={cn(
                  'px-3 py-2.5 border-b border-[#1b2334]/60',
                  isSelf && 'bg-[#d9b45c]/[0.05]',
                )}>
                  {/* السطر 1: الجهاز + المتصفح + النظام + أنت */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="w-2 h-2 rounded-full bg-[#2ebd85] live-dot shrink-0" />
                    {v.ua.device === 'هاتف'
                      ? <Smartphone className="w-3 h-3 text-[#8a94a6]" />
                      : <Monitor className="w-3 h-3 text-[#8a94a6]" />}
                    <span className="text-[11.5px] font-bold text-[#e9edf4]">{v.ua.device}</span>
                    <span className="text-[10px] text-[#8a94a6]">· {v.ua.browser} · {v.ua.os}</span>
                    {isSelf && (
                      <span className="text-[8.5px] font-black text-[#0a0e17] bg-gradient-to-l from-[#e8c66f] to-[#d9b45c] rounded px-1 py-px leading-none">أنت</span>
                    )}
                  </div>

                  {/* السطر 2: الشاشة المفتوحة + الفريم */}
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[10px]">
                    <span className="text-[#8a94a6]">يشاهد الآن:</span>
                    <span className="font-bold text-[#d9b45c] border border-[#d9b45c]/30 bg-[#d9b45c]/8 rounded px-1.5 py-px">
                      {TAB_LABEL[v.tab] ?? v.tab ?? '—'}
                    </span>
                    {v.tf && (
                      <span className="font-mono font-bold text-[#3d7dd8] border border-[#3d7dd8]/35 bg-[#3d7dd8]/10 rounded px-1.5 py-px" dir="ltr">
                        {v.tf}
                      </span>
                    )}
                  </div>

                  {/* السطر 3: مدة الاتصال الحالي */}
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#c3cbd9]">
                    <Clock className="w-3 h-3 text-[#8a94a6]" />
                    <span>متصل منذ <b className="text-[#e9edf4]">{duration(v.since || v.lastSeen, now)}</b></span>
                  </div>

                  {/* السطر 4: معلومات تقنية دقيقة (LTR) */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[9px] text-[#8a94a6] font-mono" dir="ltr">
                    <span title="عنوان الشبكة">{v.ip}</span>
                    {v.viewport && <span title="نافذة المتصفح">⊞ {v.viewport}</span>}
                    {v.screen && <span title="دقة الشاشة">🖥 {v.screen}</span>}
                    {v.tz && <span title="المنطقة الزمنية">{v.tz}</span>}
                    {v.lang && <span title="لغة المتصفح">{v.lang}</span>}
                  </div>

                  {/* السطر 5: مصدر الدخول + آخر نبضة (الدقة اللحظية) */}
                  <div className="mt-1 flex items-center justify-between text-[9px]">
                    <span className="flex items-center gap-1 text-[#8a94a6]">
                      <LogIn className="w-2.5 h-2.5" />
                      {v.referrer
                        ? <>جاء من: <b className="text-[#c3cbd9] font-mono" dir="ltr">{v.referrer}</b></>
                        : 'دخول مباشر'}
                    </span>
                    <span className="text-[#2ebd85]" title={`آخر نبضة: ${fmtTime(v.lastSeen)}`}>
                      <Radio className="inline w-2.5 h-2.5 animate-pulse ml-0.5" />
                      نبضة: {relTime(v.lastSeen, now)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* تذييل اللوحة */}
          <div className="shrink-0 px-3 py-1.5 border-t border-[#1b2334] bg-[#0a0e17] text-[8.5px] text-[#5a6474] leading-relaxed">
            عرض لحظي فقط — كل جهاز في القائمة مفتوح فعلاً الآن، ويختفي فور إغلاق تبويبه. نبضة كل 15 ثانية، تتبّع مجهول بدون أي بيانات شخصية.
          </div>
        </div>
      )}

      {/* الزر العائم */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-1.5 rounded-full border shadow-lg px-3 py-1.5 transition-all',
          'bg-[#0d1220]/90 backdrop-blur-sm hover:bg-[#101726]',
          open
            ? 'border-[#d9b45c]/60 shadow-[0_0_16px_rgba(217,180,92,0.25)]'
            : 'border-[#1b2334] hover:border-[#d9b45c]/40',
        )}
        title="الأجهزة المتصلة فعلياً الآن — لحظي"
      >
        <span className="relative flex items-center">
          <Users className={cn('w-4 h-4 transition-colors', open ? 'text-[#d9b45c]' : 'text-[#8a94a6]')} />
          {online > 0 && (
            <span className="absolute -top-1.5 -left-1.5 min-w-[15px] h-[15px] rounded-full bg-[#2ebd85] text-[#0a0e17] text-[8.5px] font-black flex items-center justify-center px-1 shadow">
              {online}
            </span>
          )}
        </span>
        <span className="text-[11px] font-bold text-[#c3cbd9]">
          {online > 0 ? `متصل ${online}` : 'الأجهزة'}
        </span>
      </button>
    </div>
  );
}
