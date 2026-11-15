'use client';

// نافذة الإشارات الحية — نفس كاشفات ومحرك الباك تيست يعمل على شموع MT5 الحقيقية
// ويعرض الأوامر المنتظرة الآن (ما حجبته سعة/بوابة — فكل الإشارات تنفَّذ فورياً)، تُحدّث مع كل شمعة 5m جديدة.
import { useCallback, useEffect, useState } from 'react';
import { Radar, RefreshCw, BrainCircuit, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STRATEGY_NAMES } from '@/lib/engine/types';

interface PendingSetup {
  strategy: string;
  dir: 'buy' | 'sell';
  entry: number; sl: number; tp: number;
  session: string;
  reason: string;
  expiresAt: number; createdAt: number;
  fibConfirmed?: boolean;
  score?: number;
  qualityPass?: boolean;
  canFillNow?: boolean;
  aiPriority?: number;
  aiAction?: 'execute' | 'monitor';
  aiNote?: string;
}

interface SignalsPayload {
  ok: boolean;
  serverTime: number;
  dataEndT: number;
  session: string | null;
  syriaHour: number;
  ema: { enabled: boolean; dir: string };
  trend1h: string;
  trend4h: string;
  market?: {
    atrPct: number | null;
    rng6hPips: number | null;
    spreadCents: number | null;
    spreadLimit: number | null;
    spreadBlocked: boolean;
    chopBlocked: boolean;
  };
  pending: PendingSetup[];
  ai?: {
    available: boolean;
    marketNote?: string;
    sessionNote?: string;
    dailyNote?: string;
    generatedAt?: number;
    latencyMs?: number;
  } | null;
  daily?: { tradesToday: number; target: number; remaining: number };
  timeStop?: {
    hours: number;
    violations: { ticket: number; dir: string; ageH: number; profit: number; priceOpen: number }[];
  };
  shadow?: {
    total: number; pending: number; filled: number; expired: number; closed: number;
    tp: number; sl: number; winRate: number; avgPnlPips: number;
  } | null;
  error?: string;
}

const SESSION_AR: Record<string, string> = {
  asia: 'آسيا', london: 'لندن', londonNY: 'لندن ونيويورك', ny: 'نيويورك',
};

function trendLabel(d: string) {
  return d === 'up' ? 'صاعد ▲' : d === 'down' ? 'هابط ▼' : 'عرضي ◆';
}
function trendColor(d: string) {
  return d === 'up' ? 'text-[#2ebd85]' : d === 'down' ? 'text-[#f6465d]' : 'text-[#8a94a6]';
}

export function LiveSignalsWindow() {
  const [data, setData] = useState<SignalsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/signals', { cache: 'no-store' });
      const j = await r.json();
      if (r.ok && j.ok) {
        setData(j as SignalsPayload);
        setErr(null);
        setUpdatedAt(Date.now());
      } else {
        setErr(j.error ?? 'تعذر جلب الإشارات');
      }
    } catch {
      setErr('فشل الاتصال بخادم الإشارات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000); // كل 30 ثانية — الحساب نفسه يتجدد مع كل شمعة 5m
    return () => clearInterval(id);
  }, [load]);

  const pending = [...(data?.pending ?? [])].sort((a, b) => {
    const pa = a.aiPriority ?? -1, pb = b.aiPriority ?? -1;
    if (pa !== pb) return pb - pa; // أولوية المشرف الذكي أولاً
    return (b.score ?? 0) - (a.score ?? 0);
  });
  const ai = data?.ai ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-[#d9b45c] flex items-center gap-2">
              <Radar className="w-4.5 h-4.5" />
              الإشارات الحية — أوامر منتظرة الآن
            </h2>
            <p className="text-[11.5px] text-[#8a94a6] leading-relaxed mt-1">
              نفس كاشفات الاستراتيجيات ومحرك القواعد الخاص بالباك تيست يعملان لحظياً على شموع MT5 الحقيقية
              وفق إعداداتك المحفوظة. يتجدد الحساب تلقائياً مع كل شمعة 5 دقائق جديدة.
              <span className="text-[#d9b45c]/80"> التنفيذ حالياً يدوي عبر منصتك — الجسر يستقبل البيانات ولا يرسل أوامر.</span>
            </p>
          </div>
          <button onClick={load} disabled={loading}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-[#2a3550] bg-[#101726] hover:border-[#d9b45c]/50 text-[#e9edf4] text-[11px] font-bold px-3 py-2">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            تحديث
          </button>
        </div>

        {/* الوقف الزمني الإلزامي (القاعدة 4) — سقف الاحتفاظ والصفقات المتجاوزة */}
        {data?.timeStop && (
          <div className={cn('mt-3 rounded-lg border p-3',
            data.timeStop.violations.length
              ? 'border-[#f6465d]/60 bg-[#f6465d]/10'
              : 'border-[#1b2334] bg-[#101726]')}>
            {data.timeStop.violations.length ? (
              <>
                <div className="text-[12.5px] font-bold text-[#f6465d] flex items-center gap-1.5">
                  <Timer className="w-4 h-4" />
                  ⏰ صفقات تجاوزت سقف الاحتفاظ {data.timeStop.hours} ساعة — الإغلاق إجباري فوراً (القاعدة 4)
                </div>
                <div className="mt-2 space-y-1.5">
                  {data.timeStop.violations.map(v => (
                    <div key={v.ticket} className="flex items-center justify-between gap-2 rounded-md bg-[#0d1220] border border-[#f6465d]/30 px-2.5 py-1.5 text-[11.5px]">
                      <span className="text-[#e9edf4] font-bold">#{v.ticket} {v.dir === 'buy' ? 'شراء ▲' : 'بيع ▼'} من {v.priceOpen.toFixed(2)}</span>
                      <span className="text-[#f6465d] font-bold">عمرها {v.ageH} ساعة</span>
                      <span className={cn('font-bold', v.profit >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>
                        {v.profit >= 0 ? '+' : ''}{v.profit.toFixed(2)}$
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 text-[10.5px] text-[#8a94a6]">التنبيه يتكرر يومياً حتى الإغلاق الفعلي — لا تمديد تحت أي ظرف (دستور القاعدة 4)</div>
              </>
            ) : (
              <div className="text-[11.5px] text-[#8a94a6] flex items-center gap-1.5">
                <Timer className="w-3.5 h-3.5" />
                الوقف الزمني مفعّل: كل صفقة تُغلق إجبارياً بعد <span className="text-[#d9b45c] font-bold">{data.timeStop.hours} ساعة (يومان)</span> من فتحها — لا صفقة تبقى مفتوحة أكثر من يومين أبداً
              </div>
            )}
          </div>
        )}

        {/* شريط الحالة */}
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-2.5">
            <div className="text-[9.5px] text-[#5a6474] font-bold">الجلسة الحالية</div>
            <div className={cn('text-[12.5px] font-bold mt-0.5', data?.session ? 'text-[#2ebd85]' : 'text-[#8a94a6]')}>
              {data?.session ? (SESSION_AR[data.session] ?? data.session) : 'خارج الجلسات'}
            </div>
          </div>
          <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-2.5">
            <div className="text-[9.5px] text-[#5a6474] font-bold">فلتر EMA</div>
            <div className={cn('text-[12.5px] font-bold mt-0.5', data?.ema.enabled ? trendColor(data.ema.dir) : 'text-[#8a94a6]')}>
              {data?.ema.enabled ? trendLabel(data.ema.dir) : 'مطفأ'}
            </div>
          </div>
          <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-2.5">
            <div className="text-[9.5px] text-[#5a6474] font-bold">هيكل 1H</div>
            <div className={cn('text-[12.5px] font-bold mt-0.5', trendColor(data?.trend1h ?? ''))}>
              {data ? trendLabel(data.trend1h) : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-2.5">
            <div className="text-[9.5px] text-[#5a6474] font-bold">هيكل 4H</div>
            <div className={cn('text-[12.5px] font-bold mt-0.5', trendColor(data?.trend4h ?? ''))}>
              {data ? trendLabel(data.trend4h) : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-2.5">
            <div className="text-[9.5px] text-[#5a6474] font-bold">السبريد الحي</div>
            <div className={cn('text-[12.5px] font-bold mt-0.5 font-mono',
              data?.market?.spreadBlocked ? 'text-[#f6465d]' : 'text-[#2ebd85]')}>
              {data?.market?.spreadCents != null ? `${data.market.spreadCents}¢${data.market.spreadBlocked ? ' ⛔' : ' ✓'}` : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-2.5">
            <div className="text-[9.5px] text-[#5a6474] font-bold">ATR اليومي</div>
            <div className="text-[12.5px] font-bold mt-0.5 font-mono text-[#e9edf4]">
              {data?.market?.atrPct != null ? `${data.market.atrPct}%` : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-[#101726] border border-[#1b2334] p-2.5">
            <div className="text-[9.5px] text-[#5a6474] font-bold">نطاق 6 ساعات</div>
            <div className="text-[12.5px] font-bold mt-0.5 font-mono text-[#e9edf4]">
              {data?.market?.rng6hPips != null ? `${data.market.rng6hPips} بيب` : '—'}
            </div>
          </div>
        </div>

        {/* تنبيهات البوابات الحية */}
        {data?.market?.spreadBlocked && (
          <div className="mt-2.5 rounded-lg border border-[#f6465d]/40 bg-[#f6465d]/8 px-3 py-2 text-[11px] text-[#f6465d] font-bold">
            ⛔ بوابة السبريد الحي: السبريد الآن {data.market.spreadCents}¢ فوق الحد ({data.market.spreadLimit}¢) — لا تفتح صفقات جديدة حتى ينضغط السبريد
          </div>
        )}

        {/* المشرف الذكي — طبقة الإشراف الهجينة */}
        <div className="mt-3 rounded-xl border border-[#d9b45c]/30 bg-gradient-to-l from-[#d9b45c]/8 via-[#0a0e17]/40 to-transparent p-3.5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-8 h-8 shrink-0 rounded-lg bg-[#d9b45c]/15 border border-[#d9b45c]/40 flex items-center justify-center">
                <BrainCircuit className="w-4.5 h-4.5 text-[#d9b45c]" />
              </span>
              <div>
                <div className="text-[13px] font-black text-[#d9b45c]">المشرف الذكي — إشراف احترافي على التنفيذ</div>
                <div className="text-[9.5px] text-[#8a94a6] mt-0.5">
                  نموذج ذكاء اصطناعي يرتّب أولويات الإشارات وينظّم التوقيت — بلا أي تعديل على قواعد الاستراتيجيات (الدخول/الوقف/الهدف كما هي، والتنفيذ فوري بعد اكتمال الشروط بلا انتظار)
                </div>
              </div>
            </div>
            {data?.daily && (
              <div className="text-center shrink-0 rounded-lg border border-[#1b2334] bg-[#101726] px-3 py-1.5">
                <div className="text-[9px] text-[#5a6474] font-bold">صفقات اليوم</div>
                <div className={cn('text-[14px] font-black font-mono',
                  data.daily.tradesToday >= data.daily.target ? 'text-[#2ebd85]' : 'text-[#e9edf4]')}>
                  {data.daily.tradesToday}<span className="text-[#5a6474] text-[11px]">/{data.daily.target}</span>
                </div>
              </div>
            )}
          </div>
          {ai?.available ? (
            <div className="mt-2.5 space-y-1.5">
              {ai.marketNote && (
                <div className="text-[11px] text-[#e9edf4] leading-relaxed">
                  <span className="text-[#d9b45c] font-bold">السوق: </span>{ai.marketNote}
                </div>
              )}
              {ai.sessionNote && (
                <div className="text-[11px] text-[#e9edf4] leading-relaxed">
                  <span className="text-[#d9b45c] font-bold">الجلسة: </span>{ai.sessionNote}
                </div>
              )}
              {ai.dailyNote && (
                <div className="text-[11px] text-[#e9edf4] leading-relaxed">
                  <span className="text-[#d9b45c] font-bold">الحد اليومي: </span>{ai.dailyNote}
                </div>
              )}
              {ai.generatedAt && (
                <div className="text-[9px] text-[#5a6474] pt-0.5">
                  آخر إشراف: {new Date(ai.generatedAt).toLocaleTimeString('ar-SY')}{ai.latencyMs ? ` — زمن التحليل ${(ai.latencyMs / 1000).toFixed(1)} ثانية` : ''}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2.5 text-[10.5px] text-[#8a94a6] leading-relaxed">
              يجري نموذج الذكاء الاصطناعي تحليله الأول الآن — وعنده تعذر الاتصال يدير المحرك المحلي الحتمي التنفيذ كاملاً بنفس القواعد دون أي توقف.
            </div>
          )}
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-[#f6465d]/35 bg-[#f6465d]/8 p-4 text-[12px] text-[#f6465d] font-bold">
          {err}
        </div>
      )}

      {!err && !data && !loading && (
        <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-6 text-center text-[12px] text-[#8a94a6]">
          بانتظار أول حساب للإشارات...
        </div>
      )}

      {data && (
        pending.length ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {pending.map((p, i) => {
              const expiresInH = Math.max(0, (p.expiresAt - (data.serverTime)) / 3600e3);
              return (
                <div key={`${p.strategy}-${p.createdAt}-${i}`}
                  className={cn('rounded-xl border p-3.5',
                    p.dir === 'buy' ? 'border-[#2ebd85]/30 bg-[#2ebd85]/5' : 'border-[#f6465d]/30 bg-[#f6465d]/5')}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-7 h-7 shrink-0 rounded-md bg-[#d9b45c]/15 text-[#d9b45c] font-black text-[12px] flex items-center justify-center border border-[#d9b45c]/30">
                        {p.strategy}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] font-bold text-[#e9edf4] truncate flex items-center gap-1.5">
                          {STRATEGY_NAMES[p.strategy as keyof typeof STRATEGY_NAMES] ?? 'استراتيجية'}
                          {p.score != null && (
                            <span className={cn('text-[9px] font-mono px-1 py-px rounded border shrink-0',
                              p.qualityPass === false ? 'text-[#f6465d] border-[#f6465d]/40 bg-[#f6465d]/10'
                                : p.score >= 70 ? 'text-[#2ebd85] border-[#2ebd85]/40 bg-[#2ebd85]/10'
                                  : 'text-[#d9b45c] border-[#d9b45c]/40 bg-[#d9b45c]/10')}>
                              جودة {p.score}
                            </span>
                          )}
                        </div>
                        <div className="text-[9.5px] text-[#8a94a6] flex items-center gap-1.5 flex-wrap">
                          <span>{SESSION_AR[p.session] ?? p.session}</span>
                          {p.fibConfirmed && <span>• مؤكدة بفيبو/كسر</span>}
                          {p.canFillNow === true && (
                            <span className="text-[8.5px] font-black text-[#2ebd85] border border-[#2ebd85]/40 bg-[#2ebd85]/10 rounded px-1.5 py-px">قابلة للتنفيذ الآن</span>
                          )}
                          {p.canFillNow === false && (
                            <span className="text-[8.5px] font-bold text-[#e8a33d] border border-[#e8a33d]/35 bg-[#e8a33d]/10 rounded px-1.5 py-px">
                              بانتظار جلسة مفعّلة للاستراتيجية — لن تُنفّذ خارجها
                            </span>
                          )}
                          {p.aiPriority != null && (
                            <span className={cn('text-[8.5px] font-black rounded px-1.5 py-px border',
                              p.aiPriority >= 8 ? 'text-[#2ebd85] border-[#2ebd85]/45 bg-[#2ebd85]/10'
                                : p.aiPriority >= 5 ? 'text-[#d9b45c] border-[#d9b45c]/45 bg-[#d9b45c]/10'
                                  : 'text-[#8a94a6] border-[#8a94a6]/40 bg-[#8a94a6]/10')}>
                              أولوية المشرف {p.aiPriority}/10
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className={cn('text-[11px] font-black px-2 py-1 rounded-md border shrink-0',
                      p.dir === 'buy' ? 'text-[#2ebd85] border-[#2ebd85]/40 bg-[#2ebd85]/10' : 'text-[#f6465d] border-[#f6465d]/40 bg-[#f6465d]/10')}>
                      {p.dir === 'buy' ? 'شراء BUY' : 'بيع SELL'}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-[#0a0e17]/70 border border-[#1b2334] p-2 text-center">
                      <div className="text-[9px] text-[#5a6474] font-bold">سعر الإشارة المرجعي</div>
                      <div className="text-[13px] font-mono font-black text-[#d9b45c] mt-0.5">{p.entry.toFixed(2)}</div>
                    </div>
                    <div className="rounded-lg bg-[#0a0e17]/70 border border-[#1b2334] p-2 text-center">
                      <div className="text-[9px] text-[#5a6474] font-bold">وقف الخسارة</div>
                      <div className="text-[13px] font-mono font-black text-[#f6465d] mt-0.5">{p.sl.toFixed(2)}</div>
                    </div>
                    <div className="rounded-lg bg-[#0a0e17]/70 border border-[#1b2334] p-2 text-center">
                      <div className="text-[9px] text-[#5a6474] font-bold">الهدف</div>
                      <div className="text-[13px] font-mono font-black text-[#2ebd85] mt-0.5">
                        {(p as { tpPips?: number }).tpPips === 0 ? 'بالقاعدة' : p.tp.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 text-[10.5px] text-[#8a94a6] leading-relaxed line-clamp-2">{p.reason}</div>
                  {p.aiNote && (
                    <div className="mt-1.5 rounded-lg border border-[#d9b45c]/25 bg-[#d9b45c]/6 px-2.5 py-1.5 text-[10px] text-[#d9b45c] leading-relaxed">
                      <span className="font-black">🧠 المشرف الذكي: </span>{p.aiNote}
                    </div>
                  )}
                  <div className="mt-1.5 flex items-center justify-between text-[9.5px] text-[#5a6474]">
                    <span>الصلاحية المتبقية: ~{expiresInH < 1 ? `${Math.round(expiresInH * 60)} دقيقة` : `${expiresInH.toFixed(1)} ساعة`}</span>
                    {p.strategy === 'Z' && <span className="text-[#d9b45c] font-bold">مستوى يدوي منك</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-8 text-center">
            <div className="text-[13px] font-bold text-[#e9edf4]">لا توجد أوامر منتظرة الآن</div>
            <div className="text-[11px] text-[#8a94a6] mt-1.5 leading-relaxed max-w-[520px] mx-auto">
              كل الاستراتيجيات تُنفَّذ فورياً لحظة اكتمال شروطها (دخول مباشر بسعر السوق دون انتظار) —
              فلا تبقى أوامر منتظرة إلا ما حجبته بوابة من إعداداتك (سعة الصفقات، الحد اليومي، الأخبار، الجلسة).
              تأكد أن الجلسة الحالية مفعّلة للاستراتيجيات التي تريدها.
            </div>
          </div>
        )
      )}

      {/* وضع الظل — تتبع حقيقي لنتائج الإشارات */}
      {data?.shadow && data.shadow.total > 0 && (
        <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-[13px] font-bold text-[#d9b45c]">وضع الظل — تتبع نتائج الإشارات الحية (آخر 30 يوماً)</div>
            <div className="text-[9.5px] text-[#5a6474]">كل إشارة تُسجَّل وتُتتبع فعلياً على الشموع الحقيقية — أساس قياس تطابق الحي مع الباك تيست</div>
          </div>
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              { l: 'إشارات مسجلة', v: data.shadow.total, c: 'text-[#e9edf4]' },
              { l: 'نُفذت (لمست الدخول)', v: data.shadow.filled, c: 'text-[#e9edf4]' },
              { l: 'ضربت الهدف', v: data.shadow.tp, c: 'text-[#2ebd85]' },
              { l: 'ضربت الوقف', v: data.shadow.sl, c: 'text-[#f6465d]' },
              { l: 'نجاح المغلقة', v: `${data.shadow.winRate}%`, c: data.shadow.winRate >= 40 ? 'text-[#2ebd85]' : 'text-[#d9b45c]' },
              { l: 'متوسط الربح (بيب)', v: `${data.shadow.avgPnlPips > 0 ? '+' : ''}${data.shadow.avgPnlPips}`, c: data.shadow.avgPnlPips >= 0 ? 'text-[#2ebd85]' : 'text-[#f6465d]' },
            ].map(x => (
              <div key={x.l} className="rounded-lg bg-[#101726] border border-[#1b2334] p-2.5 text-center">
                <div className="text-[9px] text-[#5a6474] font-bold">{x.l}</div>
                <div className={cn('text-[14px] font-black mt-0.5 font-mono', x.c)}>{x.v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {updatedAt > 0 && (
        <div className="text-center text-[9.5px] text-[#5a6474]">
          آخر تحديث: {new Date(updatedAt).toLocaleTimeString('ar-SY')} — التحديث التلقائي كل 30 ثانية
        </div>
      )}
    </div>
  );
}
