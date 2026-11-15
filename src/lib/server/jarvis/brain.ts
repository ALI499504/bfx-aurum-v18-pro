// ============================================================
// جارفس — العقل الوكيل الحقيقي (server-only)
// «عقل السيد داخل جارفس»: نفس حلقة عمل المساعد الذكي تماماً —
//   1) يقرأ الأمر مع ذاكرة المحادثة الكاملة
//   2) يقرر الأدوات وينفذها (دوران 1)
//   3) يشاهد النتائج الحقيقية فيقرر: أدوات إضافية أو الإجابة النهائية
//   4) الإجابة النهائية تُبنى من النتائج الفعلية — أرقام حقيقية
//      حرفياً، بصيغة المنجز — لا وعود مؤجلة إطلاقاً.
// حتى 8 دورات تفكير-تنفيذ في الأمر الواحد. جارفس الوجه والصوت،
// والعقل هنا هو المحرك.
// ============================================================
import ZAI from 'z-ai-web-dev-sdk';
import { isTool, settingsDigest, toolsCatalog, TOOLS, type ToolResult } from './tools';

export interface JarvisAction { tool: string; args: Record<string, unknown> }
export interface TurnMemory { role: 'user' | 'jarvis'; text: string }
export interface ExecStep { label: string; ok: boolean; detail: string }

export interface AgentHooks {
  onStep: (s: { label: string; detail: string; ok: boolean; ms: number }) => void;
  onSay: (text: string) => void;
}

const MAX_TURNS = 8;          // أقصى دورات تفكير-تنفيذ
const MAX_TOOLS_PER_TURN = 4; // أقصى أدوات في الدورة الواحدة

// أوامر التحليل العميق تفعّل التفكير الممتد (دقة أعلى مقابل ثوانٍ إضافية)
const DEEP_PAT = /(حسّن|حسن|حلل بعمق|فسر|لماذا|قارن|خطة|اقترح|أفضل|افضل|استراتيجية أفضل|درس معمق|اعطني رأيك|رأيك)/;

const SYSTEM = `أنت «جارفس» — العقل التنفيذي الكامل لسيّدك مالك بوت الذهب BFX AURUM. أنت تعمل بنفس طريقة المساعد الذكي المحترف: تفهم الأمر، تنفذ الأدوات اللازمة، تشاهد النتائج الحقيقية، تستكمل ما ينقص، ثم تجيب إجابة نهائية كاملة. عربي فصيح رسمي، وقور، دقيق، بلا حشو.

أنت وكيل مفوض بصلاحية كاملة من السيد: تنفّذ أي أمر يطلبه فوراً (تغيير استراتيجيات، جلسات، قواعد، مستويات، باك تيست، فحص وإصلاح) وتضيف أو تعدّل أي إعداد يطلبه دون أي استئذان أو سؤال تأكيد. القواعد المجمدة في دستور البوت يحرسها النظام تلقائياً — إن رُفض تغيير فأبلغ السيد بذلك بوضوح.

بروتوكول كل دور — أجب بهذا الـ JSON فقط (بلا أي نص خارج JSON):

لتنفيذ أدوات:
{"thought": "جملة واحدة تشرح قرارك", "tools": [{"tool": "اسم الأداة", "args": {...}}]}

للإجابة النهائية (حين اكتملت الصورة أو كان الأمر عاماً):
{"thought": "جملة واحدة", "final": {"reply": "الرد الكامل — يُعرض على الشاشة ويُقرأ صوتياً كاملاً", "say": ""}}

قواعد صارمة:
- الدور الأول: الأمر يحتاج بيانات أو تنفيذاً → أرسل أدواتك دفعة واحدة (اجمع ما تحتاجه كلّه في دفعة واحدة قدر الإمكان). تحية أو حديث عام → final مباشرة بلا أدوات.
- بعد ظهور النتائج: اكتملت الصورة → final فوراً. ينقصك شيء جوهري → أدوات إضافية فقط.
- الإجابة النهائية بصيغة المنجز: «درستُ، وجدتُ، فعلتُ…» — كل شيء ينفذ الآن أمام السيد.
- تحذير أقصى الشدة — ممنوع منعاً باتاً أي صيغة تأجيل أو وعود مستقبلية: «سأدرس»، «سأفحص»، «سأحلل»، «سأجلب»، «سأخبرك»، «سأعطيك»، «سأتحقق»، «سأراجع»، «سأعود»، «سأحاول»، «انتظر»، «بعد قليل»، «لاحقاً» — إن شعرت أنك على وشك كتابة أي منها فهذا يعني أنك لم تنفذ الأدوات بعد: نفّذها في هذا الدور نفسه ثم أجب بالنتيجة. لا يوجد «غداً» ولا «بعد لحظات» — كل شيء ينجز في هذا الدور أمام السيد.
- أنت من يعالج الأعطال بنفسك — يمنع منعاً باتاً قول «يحتاج تدخل فني» أو «مشكلة تقنية» وترك الأمر: عند فشل أداة أعدها مرة واحدة بوسائط مصححة (السنة رقماً لا نصاً) أو استعمل أداة بديلة تحقق الهدف نفسه، وإن فشل نهائياً اذكر السبب الحرفي القصير كما عاد من النظام + ما أنجزته فعلاً من النتائج — الأدوات نفسها تعيد المحاولة ذاتياً قبل أن يصل الفشل إليك.
- طلب باك تيست أو اختبار لسنة محددة → الأداة run_backtest مباشرة بلا أي استئذان: بوسيطة year رقماً (مثال {"year": 2025})، ولمدى سنوات from وto (مثال {"from": 2020, "to": 2023})، ومرّر دائماً hint = نص السيد الحرفي (الأداة تستخرج السنة منه تلقائياً ولو فاتتك، بل ولو كُتبت بأرقام عربية «٢٠٢٥»). وطلب عرض نتائج سابقة → read_backtest. ويمنع خلط حروف لاتينية داخل الكلمات العربية — اكتب «باك تيست» دائماً لا «باك تيest».
- الأرقام في reply تُنسخ حصراً من نتائج الأدوات — لا تخترع رقماً ولا تقرب قيمة. إن فشلت أداة فاذكر الفشل وسببه كما عاد من النتيجة.
- reply منظّم: الخلاصة في أول جملة، ثم تفاصيل بنقاط قصيرة عند الحاجة. إن كانت النتائج تحليلاً للسوق فنسّق: الاتجاه، المستويات، التقلب، الإشارات، الأخبار.
- إن كان بإمكانك الإجابة من نتائج الدورة الحالية فلا تشغّل أدوات مجدداً.
- لا تكرر أداة أعادت نتيجتها. أقصى 4 أدوات في الدور.
- reply هو النص الكامل الذي يُعرض على السيد ويُقرأ صوتياً كاملاً — اكتبه كاملاً منظماً: خلاصة واضحة في أول جملة، ثم التفاصيل بنقاط قصيرة عند الحاجة، ولا تختصر على حساب الوضوح أبداً.
- الأرقام في reply حصراً بأرقام لاتينية (4071.13، 190.81$، -0.43%) — يمنع منعاً باتاً كتابتها كلمات عربية (لا تكتب «أربعة آلاف» ولا «مئة وتسعون») — محرك الصوت يحوّلها تلقائياً لنطق عربي فصيح دقيق، وأي كتابة كلمات تؤدي لنطق خاطئ.
- حقل say اختياري (اتركه فارغاً — الصوت يقرأ reply كاملاً). مثال صيغة أرقام صحيحة في reply: «الذهب الآن 4071.13 دولاراً، رصيدك 190.81 دولاراً». مثال ممنوع: «الذهب الآن أربعة آلاف وسبعين» أو «سأدرس السوق وأخبرك».
- استنتج ضمائر المتابعة («نفذها»، «زوّده»، «الاستراتيجية نفسها») من ذاكرة المحادثة أدناه ونفّذ.

الأدوات المتاحة:
__CATALOG__

حالة النظام الآن (تتحدث كل أمر):
__STATE__

ذاكرة المحادثة الأخيرة (الأحدث في الأسفل):
__MEMORY__`;

interface Msg { role: 'assistant' | 'user'; content: string }

function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```json/gi, '```').split('```').filter(Boolean);
  const candidates = [raw, ...cleaned];
  for (const c of candidates) {
    const start = c.indexOf('{');
    if (start === -1) continue;
    // نجرّب كل نهاية '}' من الأخيرة للأولى — نجد أول بادئة JSON صالحة مهما
    // كانت المخلفات الختامية من النموذج (مثل ]} الزائدة) — إصلاح جذر لتسريب
    // الـ JSON الخام في رد جارفس المكتشف في الفحص الشامل (3/3 محاولات).
    for (let end = c.lastIndexOf('}'); end > start; end = c.lastIndexOf('}', end - 1)) {
      try {
        const j = JSON.parse(c.slice(start, end + 1));
        if (j && typeof j === 'object') return j as Record<string, unknown>;
      } catch { /* نهاية أقرب */ }
    }
  }
  return null;
}

function memoryBlock(memory: TurnMemory[]): string {
  if (!memory.length) return '(بلا سابق — هذه بداية الحديث)';
  return memory.slice(-8).map(m => `${m.role === 'user' ? 'السيد' : 'جارفس'}: ${m.text.slice(0, 160)}`).join('\n');
}

// ---------- شبكة منع التأجيل (حتمية) ----------
// عهدك الصريح للسيد: جارفس مثل المساعد الذكي نفسه — ينفذ الآن
// ويرد بالنتيجة في نفس الدور. أي صيغة مستقبلية مؤجلة تُكتشف هنا
// فتُرفض ويُجبر العقل على التنفيذ الفوري بالأدوات.
const DEFER_PHRASES = [
  'سأدرس', 'سدرس', 'سأفحص', 'سفحص', 'سأحلل', 'سحلل', 'سأجلب', 'سجلب',
  'سأخبرك', 'سخبرك', 'سأعطيك', 'سعطيك', 'سأتحقق', 'ساتحقق', 'سأراجع', 'ساراجع',
  'سأشاهد', 'سأراقب', 'سأحاول', 'ساحاول', 'سأعود', 'سأبلغك', 'سابلغك', 'سأبلّغ',
  'أدرس وأخبرك', 'وأخبرك', 'واخبرك', 'سأدرس السوق', 'وسأخبرك',
  'انتظر قليلا', 'انتظرني', 'بعد قليل', 'بعد لحظات', 'لاحقاً', 'لاحقا',
  'قريباً جدا', 'دعني أفحص', 'دعني أدرس', 'اتركني أفحص', 'سأعالج', 'سعالج',
];

export function isDeferred(text: string): boolean {
  if (!text) return false;
  return DEFER_PHRASES.some(w => text.includes(w));
}

// ---------- قراءة السنة من نص السيد (حتمية) ----------
// المايك قد يعطي «٢٠٢٥» بأرقام عربية-هندية والسيد قد يكتب "2025" —
// نحوّل ونستخرج كي لا تفوت السنة أبداً ولو أغفلها العقل في الوسائط.
const AR_DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
function toLatinDigits(s: string): string { return s.replace(/[٠-٩۰-۹]/g, d => AR_DIGITS[d] ?? d); }

export function extractYear(text: string): number | null {
  const m = toLatinDigits(text).match(/\b(20\d{2})\b/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 2015 && y <= new Date().getFullYear() ? y : null;
}

/** وسائط run_backtest المستنتجة حتمياً من نص السيد — hint دائماً + السنة إن وُجدت */
export function backtestArgsFromText(text: string): Record<string, unknown> {
  const args: Record<string, unknown> = { hint: text };
  const y = extractYear(text);
  if (y !== null) args.year = y;
  return args;
}

// ---------- شبكة الأمان الحتمية ----------
// لو عاد الدور الأول بلا أدوات وبلا رد نهائي بينما الأمر سؤال معلوماتي
// واضح، نحشو الأدوات القرائية الصحيحة إجبارياً — لا مجال لأي تعثر.
export function keywordTools(text: string): string[] {
  const t = text;
  const has = (...ws: string[]) => ws.some(w => t.includes(w));
  if (has('ادرس', 'أدرس', 'حلل', 'أحلل', 'تحليل', 'دراسة', 'وضع السوق', 'وضع الذهب', 'كيف السوق', 'اتجاه')) return ['analyze_market'];
  if (has('صفقات', 'مركز', 'مراكز', 'المفتوحة', 'عائم')) return ['read_positions'];
  if (has('سجل الصفقات', 'الصفقات السابقة', 'المنفذة', 'المغلقة', 'آخر الصفقات', 'اخر الصفقات')) return ['read_trades'];
  if (has('إشارات', 'اشارات', 'إشارة', 'دخول')) return ['read_signals'];
  if (has('أخبار', 'اخبار', 'أحداث', 'تقويم', 'news')) return ['read_news'];
  if (has('إعدادات', 'اعدادات', 'قواعد', 'الجلسات')) return ['read_settings'];
  if (has('باك تيست', 'الباك تيست', 'باك تست', 'باكتست', 'الاختبار التاريخي', 'اختبار تاريخي', 'باك تست')) {
    // نية التشغيل (افعل/شغل/لسنة) → تشغيل حقيقي؛ نية العرض (ماذا أعطى آخر باك) → قراءة المحفوظ
    const runIntent = has('اعمل', 'أعمل', 'شغل', 'شغّل', 'نفذ', 'نفّذ', 'عملي', 'اجر', 'أجر', 'جرب', 'جرّب', 'سنة', 'لسنة', 'لسنه', 'عليها', 'عليه', 'هي');
    return [runIntent ? 'run_backtest' : 'read_backtest'];
  }
  if (has('رصيد', 'الحساب', 'الاتصال', 'mt5', 'MT5', 'ميتاتريدر')) return ['read_status'];
  if (has('سعر', 'الذهب', 'الآن', 'الان')) return ['read_status'];
  return [];
}

async function llmTurn(zai: Awaited<ReturnType<typeof ZAI.create>>, msgs: Msg[], deep: boolean): Promise<string> {
  const completion = await zai.chat.completions.create({
    messages: msgs,
    thinking: { type: deep ? 'enabled' : 'disabled' },
  } as Parameters<typeof zai.chat.completions.create>[0]);
  return completion.choices[0]?.message?.content ?? '';
}

// ---------- النص الذي يُقرأ صوتياً: الرد الكامل منسّفاً من رموز الماركداون ----------
// السيد يريد جارفس يقرأ النص كاملاً كما هو — مثل حديثي المباشر تماماً —
// فلا اقتطاع ولا اختصار: كل ما يُكتب في reply يُنطق بصوت ليلى كاملاً.
function speechFull(reply: string): string {
  return reply
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^[-•*]\s+/gm, '')
    .replace(/\n+/g, '، ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------- سقوط آمن حتمي: خلاصة النتائج كما هي ----------
function deterministicFinal(steps: ExecStep[], reason: string): { reply: string; say: string } {
  const oks = steps.filter(s => s.ok);
  if (oks.length) {
    const reply = `تم يا سيدي.\n${oks.map(s => `• ${s.label}: ${s.detail}`).join('\n')}`;
    return { reply, say: speechFull(reply) };
  }
  return {
    reply: reason === 'tools-failed'
      ? 'تعذر إنجاز الأمر يا سيدي — كل الخطوات فشلت، والتفاصيل أمامك في سجل النشاط.'
      : 'تعذر تجهيز الإجابة الآن يا سيدي — أعد الأمر بعد لحظات.',
    say: 'تعذر إنجاز الأمر، التفاصيل أمامك يا سيدي.',
  };
}

// ============================================================
// الدورة الوكيلية الكاملة — عقل واحد يقود حتى الإجابة النهائية
// ============================================================
export async function agentTurn(text: string, memory: TurnMemory[] = [], hooks?: AgentHooks): Promise<{ reply: string; say: string; steps: ExecStep[]; turns: number; data?: unknown }> {
  const state = await settingsDigest();
  const sys = SYSTEM.replace('__CATALOG__', toolsCatalog()).replace('__STATE__', state).replace('__MEMORY__', memoryBlock(memory));

  // التصنيف الحتمي المسبق: الأوامر المعلوماتية المعروفة تتطلب أدوات حية قبل أي إجابة
  const preKw = keywordTools(text);

  const btYear = extractYear(text); // السنة المستنتجة من نص السيد — تُحقن في كل تصحيح

  const msgs: Msg[] = [
    { role: 'assistant', content: sys },
    ...memory.slice(-8).map<Msg>(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text.slice(0, 300) })),
    {
      role: 'user',
      content: preKw.length
        ? `${text}\n\n(تصنيف النظام الحتمي: هذا الأمر يتطلب بيانات حية — نفّذ الأداة ${preKw.join(' ثم ')}${preKw.includes('run_backtest') ? (btYear !== null ? ` بوسيطة year=${btYear} وhint نص السيد` : ' بوسيطة hint نص السيد الحرفي') : ''} في دورك الأول قبل أي إجابة، ثم أجب final من نتيجتها الفعلية بالأرقام الحية حصراً. الإجابة من الذاكرة مرفوضة.)`
        : text,
    },
  ];

  const steps: ExecStep[] = [];
  let lastData: unknown = null; // بيانات آخر أداة ناجحة — تمر للواجهة (بطاقة الباك تيست مثلاً)
  const deep = DEEP_PAT.test(text);
  const zai = await ZAI.create().catch(() => null);
  if (!zai) {
    const f = deterministicFinal([], 'no-brain');
    return { ...f, steps, turns: 0, data: null };
  }

  let narrated = false;
  let deferCorrections = 0; // حد تصحيح التأجيل — بلا حلقات لا نهائية

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    let raw = '';
    try {
      raw = await llmTurn(zai, msgs, deep);
    } catch (e) {
      console.error('[jarvis-agent] llm failed at turn', turn, String(e).slice(0, 200));
      const f = steps.length ? deterministicFinal(steps, 'llm') : { reply: 'تعذر الاتصال بعقلي الآن يا سيدي — أعد الأمر بعد لحظات.', say: 'تعذر الاتصال بعقلي، أعد الأمر بعد لحظات.' };
      return { ...f, steps, turns: turn, data: lastData };
    }

    let j = extractJson(raw);
    if (!j) {
      // استنقاذ حتمي: نص حر يحمل قرار أدوات فشل استخراجه — نحوّله لأدوات
      // فعلية تُنفذ فوراً بدل تسريب JSON خام للسيد (خلل النموذج لا يعطل التنفيذ)
      const mentions = [...raw.matchAll(/"tool"\s*:\s*"([a-zA-Z_]+)"/g)].map(m => m[1]);
      const rescued = [...new Set(mentions.filter(isTool))];
      if (rescued.length) {
        j = {
          thought: 'قرار مستنقذ من نص خام',
          tools: rescued.map(t => ({ tool: t, args: t === 'run_backtest' ? backtestArgsFromText(text) : {} })),
        };
      }
    }
    if (!j) {
      // نص حر بلا JSON — إن كانت لدينا نتائج فاختم بها
      if (steps.length) { const f = deterministicFinal(steps, 'llm'); return { ...f, steps, turns: turn, data: lastData }; }
      const t = raw.trim().slice(0, 700);
      // شبكة الصرامة على المسار الحر: أمر معلوماتي معروف + بلا أدوات = رفض وإجبار على التنفيذ
      const forcedKw = (turn <= 2 && deferCorrections < 2) ? keywordTools(text) : [];
      if (t && forcedKw.length) {
        deferCorrections++;
        msgs.push({ role: 'assistant', content: raw.slice(0, 400) });
        msgs.push({
          role: 'user',
          content: `ممنوع الرد النصي الحر — السيد طلب: "${text}". نفّذ الأداة ${forcedKw.join(' ثم ')} الآن وأجب بـ JSON صيغة final من نتائجها الحية حصراً.`,
        });
        continue;
      }
      // حصن التسريب: أي نص يشبه JSON لا يصل للسيد أبداً كرد
      if (t && !/^\s*[\[{]/.test(t)) return { reply: t, say: speechFull(t), steps, turns: turn, data: lastData };
      break;
    }

    // ---- رد نهائي؟ ----
    const fin = j.final && typeof j.final === 'object' ? j.final as Record<string, unknown> : null;
    if (fin) {
      const reply = typeof fin.reply === 'string' && fin.reply.trim() ? fin.reply.trim().slice(0, 2400) : '';
      const sayRaw = typeof fin.say === 'string' && fin.say.trim() ? fin.say.trim() : reply.replace(/\n+/g, ' ').slice(0, 200);
      // شبكة منع التأجيل: رد «سأدرس وأخبرك» = رفض صريح وإجبار على التنفيذ الآن
      if (reply && isDeferred(`${reply} ${sayRaw}`) && deferCorrections < 2) {
        deferCorrections++;
        msgs.push({ role: 'assistant', content: raw.slice(0, 400) });
        msgs.push({
          role: 'user',
          content:
            `تنبيه صارم: ردّك «${(reply || sayRaw).slice(0, 120)}» تأجيل ممنوع منعاً باتاً — السيد طلب: "${text}". ` +
            (steps.length
              ? 'لديك نتائج أدوات حقيقية أمامك (انظر أعلاه). أجب الآن final بصيغة المنجز من تلك النتائج بأرقامها الحقيقية — بلا أي «سأ». '
              : `لم تنفذ أي أداة بعد. أرسل في هذا الدور نفسه أدواتك الآن${keywordTools(text).length ? ` (مثل: ${keywordTools(text).join('، ')}${keywordTools(text).includes('run_backtest') && btYear !== null ? ` بوسيطة year=${btYear}` : ''})` : ''} ثم أجب بالنتيجة. `) +
            'لا وجود لـ«سأدرس» أو «سأخبرك» — نفّذ وأجب في نفس الدور.',
        });
        continue; // الدورة التالية = تنفيذ إجباري أو إجابة من النتائج الموجودة
      }
      if (reply) {
        // شبكة الصرامة الحتمية: أمر معلوماتي واضح (سعر/رصيد/باك تيست/صفقات...)
        // أُجيب عنه بلا أي أداة = إجابة من الذاكرة — مرفوض (حتى الدور 2).
        // يجيب بالبيانات الحية دائماً: نفّذ الأداة أولاً ثم أجب من نتيجتها.
        const forcedKw = (turn <= 2 && steps.length === 0) ? keywordTools(text) : [];
        if (forcedKw.length && deferCorrections < 2) {
          deferCorrections++;
          msgs.push({ role: 'assistant', content: raw.slice(0, 400) });
          msgs.push({
            role: 'user',
            content: `تنبيه صارم: أجبت عن «${text}» من الذاكرة دون بيانات حية — ممنوع منعاً باتاً. ` +
              `نفّذ الآن الأداة ${forcedKw.join(' ثم ')} في هذا الدور، ثم أجب final من نتيجتها الفعلية بأرقامها الحية حصراً.`,
          });
          continue;
        }
        return { reply, say: speechFull(reply), steps, turns: turn, data: lastData };
      }
      // رد نهائي فارغ — تابع الدورة
    }

    // ---- أدوات للتنفيذ ----
    const rawTools = Array.isArray(j.tools) ? j.tools : [];
    let actions = rawTools
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as Record<string, unknown>).tool === 'string')
      .map(a => ({ tool: String(a.tool), args: (a.args && typeof a.args === 'object' ? a.args : {}) as Record<string, unknown> }))
      .filter(a => isTool(a.tool))
      .slice(0, MAX_TOOLS_PER_TURN);

    // منع تكرار نفس الأداة في دفعة واحدة — استدعاء واحد يكفي
    const seenTools = new Set<string>();
    actions = actions.filter(a => (seenTools.has(a.tool) ? false : (seenTools.add(a.tool), true)));

    // شبكة الأمان: دور أول بلا قرار واضح + أمر معلوماتي واضح = حشو الأدوات إجبارياً
    if (!actions.length && turn === 1 && !fin && preKw.length) {
      actions = preKw.map(t => ({ tool: t, args: t === 'run_backtest' ? backtestArgsFromText(text) : {} as Record<string, unknown> }));
      hooks?.onSay('حاضر يا سيدي، أجلب البيانات الآن.');
      narrated = true;
    }

    if (!actions.length) {
      // لا أدوات ولا رد نهائي صالح — ختم بما لدينا
      if (steps.length) { const f = deterministicFinal(steps, 'llm'); return { ...f, steps, turns: turn, data: lastData }; }
      const chit = typeof j.thought === 'string' && j.thought.trim() ? j.thought.trim().slice(0, 300) : 'حاضر يا سيدي، أنا في خدمتك.';
      return { reply: chit, say: speechFull(chit), steps, turns: turn, data: lastData };
    }

    // السرد الحي مرة واحدة: جارفس يعلن ما سينفذه
    if (!narrated) {
      const n = actions.length;
      hooks?.onSay(n === 1 ? 'حاضر، أنفّذ الأمر الآن.' : `خطتُ خطة من ${n} خطوات، أبدأ التنفيذ الآن.`);
      narrated = true;
    }

    // تنفيذ الأدوات وثبوت النتائج في السياق
    const resultLines: string[] = [];
    for (const a of actions) {
      const tool: { run: (args: Record<string, unknown>) => Promise<ToolResult> } | undefined = TOOLS[a.tool];
      const t0 = Date.now();
      let res: ToolResult;
      try {
        res = await tool.run(a.args ?? {});
      } catch (e) {
        res = { ok: false, label: a.tool, detail: `فشل التنفيذ: ${String(e).slice(0, 120)}` };
      }
      hooks?.onStep({ label: res.label, detail: res.detail, ok: res.ok, ms: Date.now() - t0 });
      steps.push({ label: res.label, ok: res.ok, detail: res.detail });
      if (res.ok && res.data !== undefined && res.data !== null) lastData = res.data;
      resultLines.push(`${res.ok ? 'نجح' : 'فشل'} | ${res.label}: ${res.detail}`);
    }

    msgs.push({ role: 'assistant', content: raw.slice(0, 600) });
    msgs.push({ role: 'user', content: `نتائج التنفيذ الحقيقية الآن:\n${resultLines.map((r, i) => `${i + 1}) ${r}`).join('\n')}\n\nأكمل: إن اكتملت الصورة أرسل final بالأرقام الحقيقية، وإن ينقصك شيء أرسل أدوات إضافية.` });
  }

  // استُنفدت الدورات — ختم حتمي بالنتائج
  const f = deterministicFinal(steps, steps.length ? 'tools-failed' : 'no-brain');
  return { ...f, steps, turns: MAX_TURNS, data: lastData };
}

// ---------- صقل الرد الأخير (يستدعيه مسار الواجهة كخط دفاع أخير) ----------
// لو تسرب أي شكل تأجيل إلى الرد النهائي رغم كل الشبكات، يستبدله
// حتمياً بخلاصة النتائج المنفذة — لا يصل للسيد أي «سأخبرك» أبداً.
export function hardenFinal(out: { reply: string; say: string }, steps: ExecStep[], data?: unknown): { reply: string; say: string; data?: unknown } {
  // حصن تسريب الـ JSON: أي رد يشبه قرار أدوات/تفكير خام لا يصل للسيد أبداً —
  // يستبدل حتمياً بخلاصة النتائج المنفذة
  if (out.reply && /^\s*\{/.test(out.reply) && /"tool"|"final"|"thought"/.test(out.reply)) {
    return { ...deterministicFinal(steps.filter(s => s.ok && s.label !== 'استلام الأمر'), 'leak'), data };
  }
  if (!isDeferred(`${out.reply} ${out.say}`)) return { ...out, data };
  const oks = steps.filter(s => s.ok && s.label !== 'استلام الأمر');
  if (oks.length) return { ...deterministicFinal(oks, 'deferred'), data };
  return {
    reply: 'الأمر قيد التنفيذ الفوري الآن يا سيدي — إن لم تظهر النتيجة خلال لحظات فأعد الأمر وسأنفذه أمامك كاملاً بالنتيجة.',
    say: 'الأمر قيد التنفيذ الفوري الآن يا سيدي.',
    data,
  };
}
