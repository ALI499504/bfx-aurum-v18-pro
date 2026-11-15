'use client';

// واجهة الاستراتيجيات — عرض آلي فقط (التحكم اليدوي أُزيل بقرار المالك)
// الشجرة تعرض الحالة الآلية لكل استراتيجية وبنودها ومعاملاتها المعتمدة
// من الضبط الذاتي (Walk-Forward) وقرارات المدير الآلي — لا مفاتيح ولا أسهم.
// الضبط والتعديل يجريان من نافذة «الضبط الذاتي» ومن محادثة المالك مباشرة.
import { useBot, STRATEGY_NAMES } from './store';
import { useEffect, useState } from 'react';
import { StrategyId, AURUM_SERIES_IDS } from '@/lib/engine/types';
import { ALLOWED_SESSIONS, CASE_LABELS, STRATEGY_CASE_LABELS, TamsaCaseKey } from '@/lib/engine/tamsa-params';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronLeft, RefreshCw, Bot, Sparkles } from 'lucide-react';

const STRATS = Object.keys(STRATEGY_NAMES).filter(k => k !== 'Z') as StrategyId[];
const SESSION_AR: Record<string, string> = { asia: 'آسيا', london: 'لندن', londonNY: 'لندن ونيويورك', ny: 'نيويورك' };

const PARAM_LABELS: Record<string, string> = {
  insideBars: 'عدد شموع الحصار المحصورة', smallCandles: 'عدد الشموع الصغيرة قبل الاكتساح',
  minExtPips: 'الحد الأدنى للتجاوز (بيب)', maxExtPips: 'الحد الأقصى للتجاوز (بيب)',
  entryPips: 'الدخول قبل الخط (بيب)', slPips: 'الوقف خلف الخط (بيب)', tpPips: 'الهدف (بيب)',
  realBreakPips: 'قاعدة الاختراق الحقيقي (بيب)', bodyBreakMin: 'كسر الجسم الأدنى (بيب)', bodyBreakMax: 'التجاوز الأقصى (بيب)',
  minLevelBreakPips: 'تجاوز مستوى 4H الصريح (بيب)', internalBreakMin: 'كسر داخلي أدنى (بيب)', internalBreakMax: 'كسر داخلي أقصى (بيب)',
  fibTouch: 'مستوى الدخول الفيبو %', slFlexMaxPips: 'سقف المسافة المرنة للوقف (بيب)', forcedFibLevel: 'مستوى الوقف الإجباري %', rr: 'نسبة الهدف 1:',
  gapMinPips: 'الفجوة الأدنى (بيب)', gapMaxPips: 'الفجوة الأقصى (بيب)', totalMin: 'التجاوز الإجمالي الأدنى (بيب)', totalMax: 'التجاوز الإجمالي الأقصى (بيب)',
  minCandles: 'شموع القاعدة الكلاسيكية', imp1: 'موجة الاندفاع الأولى (شموع)', imp2: 'موجة الاندفاع الثانية (شموع)',
  proximityPct: 'نسبة التقارب %', expansionMinPips: 'شرط الابتعاد الأدنى (بيب)', capMaxPips: 'سقف الابتعاد الأقصى (بيب)',
  absenceHours: 'ساعات غياب السعر', absencePips: 'مسافة الابتعاد (بيب)',
  weeklyOpenPips: 'ابتعاد الافتتاح الأسبوعي (بيب)', dailyOpenPips: 'ابتعاد الافتتاح اليومي (بيب)',
  brkEntryPips: 'دخول الكسر (بيب)', brkSlPips: 'وقف الكسر (بيب)', brkTpPips: 'هدف الكسر (بيب)',
  revEntryPips: 'دخول الارتداد (بيب)', revSlPips: 'وقف الارتداد (بيب)', revTpPips: 'هدف الارتداد (بيب)',
  breakBodyMin: 'كسر جسم 15M (بيب)', breakTotalMin: 'تجاوز أدنى (بيب)', breakTotalMax: 'تجاوز أقصى (بيب)',
  windowHours: 'نافذة الكسر الزمنية (ساعة)',
  breakPips: 'موجة الكسر الصافية (بيب)', conflictPips: 'عتبة تعارض المستويات (بيب)', conflictSlPips: 'وقف التعارض خلف الثاني (بيب)',
  waveMinPips: 'أدنى موجة زخم (بيب)', waveMaxPips: 'أقصى موجة زخم (بيب)',
  sepCandles: 'شموع الفاصل الزمني', headBreakMin: 'كسر الرأس أدنى (بيب)', headBreakMax: 'كسر الرأس أقصى (بيب)',
  dZoneNear: 'مجال D: الجهة القريبة (بيب)', dZoneFar: 'مجال D: الجهة الأبعد (بيب)',
  windowMinMin: 'أقل مدة للعودة (دقيقة)', windowMinMax: 'أقصى مدة للعودة (دقيقة)',
  dTargetMinPips: 'شرط الهدف الفني عند D (بيب)', fixedTpPips: 'الهدف الرقمي الثابت (بيب)',
  approachPips: 'مسافة الاقتراب والإلغاء (بيب)', openDistPips: 'ابتعاد الافتتاح الأدنى (بيب)',
  wickMinPips: 'الطول الأدنى للذيل (بيب)', checkCandles: 'شموع الفحص قبل/بعد', isolationPips: 'مسافة العزل (بيب)', asiaOpenMinPips: 'عتبة الافتتاح الآسيوي (بيب)',
  lookback: 'شموع فحص القمة/القاع', minTotalPips: 'الطول الإجمالي الأدنى (بيب)', bodyMinPct: 'الجسم أدنى %', bodyMaxPct: 'الجسم أقصى %', tailMaxPct: 'الذيل الصغير أقصى %',
  extraLevel: 'المستوى المضاف لآسيا %',
  rangeMinutes: 'طول النطاق الافتتاحي (دقيقة)', atrN: 'فترة ATR للفلتر',
  minRangeAtr: 'أقل عرض نطاق ×ATR', maxRangeAtr: 'أقصى عرض نطاق ×ATR',
  bbK: 'مضاعف البولنجر', kcMult: 'مضاعف كيلتنر ×ATR', minSqueeze: 'أقل انضغاط (شموع)', momN: 'فترة الزخم (شموع)',
  slAtrMult: 'الوقف ×ATR', tpAtrMult: 'الهدف ×ATR', holdBars: 'صلاحية الإشارة (شموع H1)',
  rsiN: 'فترة RSI', lower: 'عتبة الشراء', upper: 'عتبة البيع', trendN: 'فلتر الترند SMA (شموع)',
  n: 'نافذة الحساب (شموع)', entryZ: 'عتبة الدخول |z|', exitZ: 'عتبة الخروج |z|', erN: 'نافذة نسبة الكفاءة', erMax: 'سقف الكفاءة (سوق عرضي)',
  horizonDays: 'أفق الزخم بالأيام (TSMOM)', fast: 'EMA السريع', slow: 'EMA البطيء',
  entryN: 'نافذة قناة الدخول (ساعة)', exitN: 'نافذة قناة الخروج (ساعة)', reassertBars: 'إعادة تأكيد الإشارة (شموع)',
  expHours: 'صلاحية أمر الدخول (ساعة)',
  exec: 'معاملات التنفيذ',
};

interface NumLeaf { path: string[]; value: number; label: string }

const CASES_BY_STRATEGY: Record<string, TamsaCaseKey[]> = {
  A: ['case1', 'case2'], B: ['main'], C: ['case1', 'case2'], D: ['d1', 'd2'],
  E: ['e1', 'e2', 'e3'], F: ['f1', 'f2', 'f3'], G: ['rev', 'brk'], H: ['main'], I: ['main'],
  J: ['bear', 'bull'], K: ['bear', 'bull'], L: ['rev', 'brk'], M: ['rev', 'brk'],
  N: ['rev', 'brk'], O: ['rev', 'brk'], P: ['rev'], Q: ['upper', 'lower'], R: ['r1', 'r2'],
  T: ['main'], U: ['main'], V: ['main'], W: ['main'], X: ['main'], Y: ['main'], AA: ['main'],
};

function collectNums(obj: Record<string, unknown>, prefix: string[]): NumLeaf[] {
  const out: NumLeaf[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'enabled' || k === 'sessions' || k === 'tfs' || k === 'levels' || k === 'horizons') continue;
    const p = [...prefix, k];
    if (typeof v === 'number') out.push({ path: p, value: v, label: PARAM_LABELS[k] ?? k });
    else if (v && typeof v === 'object' && !Array.isArray(v) && !('asia' in (v as object))) {
      out.push(...collectNums(v as Record<string, unknown>, p));
    }
  }
  return out;
}

export function StrategiesWindow() {
  const { settings, running, runBacktest } = useBot();
  const [open, setOpen] = useState<StrategyId | null>(null);
  const [autoReasons, setAutoReasons] = useState<Record<string, { kind: string; reason: string }>>({});

  // قراءة آخر قرارات المدير الآلي — لإظهار السبب بجانب كل استراتيجية
  useEffect(() => {
    fetch('/api/automanager', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (!j?.report?.decisions) return;
        const out: Record<string, { kind: string; reason: string }> = {};
        for (const d of j.report.decisions) {
          if (d.kind === 'disable-strategy' || d.kind === 'enable-strategy' || d.kind === 'disable-session') {
            if (!out[d.strategy]) out[d.strategy] = { kind: d.kind, reason: d.reason };
          }
        }
        setAutoReasons(out);
      })
      .catch(() => { /* بلا تقرير بعد */ });
  }, []);

  const params = (settings.strategyParams ?? {}) as unknown as Record<string, Record<string, unknown>>;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#d9b45c]/30 bg-gradient-to-l from-[#d9b45c]/8 to-transparent p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Bot className="w-4.5 h-4.5 text-[#d9b45c]" />
          <h2 className="text-[15px] font-bold text-[#d9b45c]">الاستراتيجيات — إدارة آلية بالكامل (التحكم اليدوي مُزال)</h2>
        </div>
        <p className="text-[11.5px] text-[#8a94a6] leading-relaxed">
          الحالة هنا تقرأها الآلة: التفعيل/التعطيل وبوابات الجلسات تقررها نتائج الباك تيست الحقيقية (المدير الآلي)،
          والمعاملات الرقمية تضبطها دورة الضبط الذاتي (تدريب ثم تحقق خارج العينة).
          W وX مكوّنا السلة المعتمدة (محاكاة على أساس 1000$)، وY وAA إضافتان بتحقق مزدوج
          (سنة وسنتان)، والمرفوضة بالتحقق معطلة صراحةً وORB حُذف نهائياً.
          لتفعيل دورة ضبط جديدة انتقل إلى نافذة «الضبط الذاتي».
        </p>
      </div>

      <div className="space-y-2">
        {STRATS.map(st => {
          const p = params[st] ?? {};
          const masterOn = p.enabled !== false;
          const isOpen = open === st;
          const allowed = ALLOWED_SESSIONS[st as keyof typeof ALLOWED_SESSIONS] ?? [];
          const cases = CASES_BY_STRATEGY[st] ?? [];
          const isAurum = AURUM_SERIES_IDS.includes(st);
          const reason = autoReasons[st];
          return (
            <div key={st} className={cn('rounded-xl border overflow-hidden', masterOn ? 'border-[#1b2334] bg-[#0d1220]' : 'border-[#f6465d]/30 bg-[#0a0e17]')}>
              <div className="flex items-center gap-3 p-3">
                <button onClick={() => setOpen(isOpen ? null : st)}
                  className="w-8 h-8 shrink-0 rounded-lg bg-[#141a29] border border-[#2a3550] flex items-center justify-center text-[#d9b45c] font-black text-[13px]">
                  {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </button>
                <button onClick={() => setOpen(isOpen ? null : st)} className="min-w-0 flex-1 text-right">
                  <div className="text-[13.5px] font-bold text-[#e9edf4]">
                    <span className="text-[#d9b45c] font-black">[{st}]</span> — {STRATEGY_NAMES[st]}
                    {isAurum && <span className="mr-2 inline-flex items-center gap-1 rounded border border-[#2ebd85]/40 bg-[#2ebd85]/8 px-1.5 py-0.5 text-[9px] font-bold text-[#2ebd85]">Aurum</span>}
                  </div>
                  <div className="text-[10.5px] text-[#8a94a6] mt-0.5">
                    {cases.map(cs => STRATEGY_CASE_LABELS[st]?.[cs] ?? CASE_LABELS[cs] ?? cs).join(' • ') || 'بند وحيد'}
                    {' • جلسات: '}{allowed.map(s => SESSION_AR[s]).join(' / ')}
                  </div>
                </button>
                {/* شارة الحالة الآلية — لا مفتاح يدوي */}
                <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10.5px] font-bold shrink-0',
                  masterOn ? 'text-[#2ebd85] border-[#2ebd85]/40 bg-[#2ebd85]/8' : 'text-[#f6465d] border-[#f6465d]/40 bg-[#f6465d]/8')}>
                  <Bot className="w-3 h-3" />
                  {masterOn ? 'مفعلة آلياً' : 'معطلة آلياً'}
                </span>
              </div>
              {reason && (
                <div className="px-3 pb-2 text-[10.5px] text-[#8a94a6]">
                  <span className="text-[#d9b45c] font-bold">قرار الآلة:</span> {reason.reason}
                </div>
              )}

              {isOpen && (
                <div className="border-t border-[#1b2334] p-3 space-y-3 bg-[#0a0e17]">
                  {cases.map(cs => {
                    const caseCfg = p[cs] as { enabled?: boolean } | undefined;
                    const nums = collectNums((p[cs] ?? {}) as Record<string, unknown>, [cs]).filter(n => n.path[n.path.length - 1] !== 'enabled');
                    return (
                      <div key={cs} className="rounded-lg border border-[#1b2334] bg-[#0d1220] p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="text-[12.5px] font-bold text-[#c8d0dd]">{STRATEGY_CASE_LABELS[st]?.[cs] ?? CASE_LABELS[cs] ?? cs}</div>
                          <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold',
                            caseCfg?.enabled !== false ? 'text-[#2ebd85] border-[#2ebd85]/30' : 'text-[#f6465d] border-[#f6465d]/30')}>
                            {caseCfg?.enabled !== false ? 'الآلة: مفعّل' : 'الآلة: معطّل'}
                          </span>
                        </div>
                        {nums.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {nums.map(n => (
                              <div key={n.path.join('.')} className="flex items-center justify-between gap-2 rounded-md bg-[#101726] border border-[#1b2334] px-2 py-1.5">
                                <span className="text-[10.5px] text-[#8a94a6] truncate">{n.label}</span>
                                <span className="text-[11.5px] font-mono font-bold text-[#e9edf4]">{n.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* بوابات الجلسات لكل سيناريو — حالة قراءتها من قرار الآلة */}
                        {(() => {
                          const sessions = (settings.scenarioSessions as Record<string, Record<string, Record<string, Record<string, boolean>>>>)?.[st]?.[cs];
                          if (!sessions || st === 'R') return null;
                          return (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2">
                              {(['s1', 's2'] as const).map(sc => (
                                <span key={sc} className="inline-flex items-center gap-1.5 text-[10px] text-[#8a94a6]">
                                  {sc === 's1' ? 'س1' : 'س2'}:
                                  {(['asia', 'london', 'londonNY', 'ny'] as const).map(sk => {
                                    const on = !!sessions?.[sc]?.[sk];
                                    const locked = !allowed.includes(sk);
                                    return (
                                      <span key={sk} className={cn('rounded px-1.5 py-0.5 border text-[9.5px]',
                                        locked ? 'border-[#1b2334] text-[#3d4a63]' : on ? 'border-[#2ebd85]/40 text-[#2ebd85] bg-[#2ebd85]/8' : 'border-[#f6465d]/30 text-[#f6465d] bg-[#f6465d]/6')}>
                                        {SESSION_AR[sk]}
                                      </span>
                                    );
                                  })}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}

                  {/* معاملات على مستوى الاستراتيجية */}
                  {(() => {
                    const caseKeys = CASES_BY_STRATEGY[st] ?? [];
                    const topNums = collectNums(p, []).filter(n => typeof n.path[0] === 'string' && !caseKeys.includes(n.path[0] as TamsaCaseKey));
                    if (!topNums.length) return null;
                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {topNums.map(n => (
                          <div key={n.path.join('.')} className="flex items-center justify-between gap-2 rounded-md bg-[#101726] border border-[#1b2334] px-2 py-1.5">
                            <span className="text-[10.5px] text-[#8a94a6] truncate">{n.label}</span>
                            <span className="text-[11.5px] font-mono font-bold text-[#e9edf4]">{Array.isArray(n.value) ? (n.value as number[]).join('/') : n.value}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-[#1b2334] bg-[#101726] p-4 text-[11px] text-[#8a94a6] leading-relaxed">
        <span className="text-[#d9b45c] font-bold">ملاحظات:</span> D وM وO وQ تعمل في جلسة آسيا حصراً حرفياً من الدليل، N في آسيا وأمريكا، P في تداخل لندن ونيويورك ونيويورك.
        بوابات الجلسات المعروضة بجانب كل بند هي الحالة الآلية الحالية (أخضر = مفتوحة، أحمر = أغلقها المدير بالأداء).
      </div>

      <button onClick={() => { if (!running) runBacktest(); }} disabled={running}
        className="flex items-center gap-2 rounded-lg bg-[#d9b45c] hover:bg-[#e5c26e] disabled:opacity-60 text-[#0a0e17] font-bold text-[12.5px] px-5 py-2.5">
        {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {running ? 'جارٍ إعادة الاختبار وفق آخر قرار آلي...' : 'إعادة اختبار وفق آخر حالة آلية'}
      </button>
    </div>
  );
}
