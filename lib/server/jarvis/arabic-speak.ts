// ============================================================
// جارفس — مُطبّع الكلام العربي الفصيح (server-only)
// مستوحى من مشاريع Arabic TTS Front-End على GitHub (tafqit /
// arabic-tts-frontend): أي نص يمر عبر هنا يصبح «كلاماً» سليماً
// قبل توليد الصوت، فينطق حامد كل حرف ورقم بشكل صحيح تماماً:
//   4073.25$  → «أربعة آلاف وثلاثة وسبعون فاصلة خمسة وعشرون دولاراً»
//   XAUUSD    → «الذهب»        MT5   → «ميتاتريدر»
//   EMA20     → «المتوسط الأسي عشرون»   PF → «معامل الربح»
//   +12%      → «زائد اثنا عشر بالمئة»
// التفقيط هنا كامل: آلاف، ملايين، كسور، أرقام سالبة، وأرقام شرقية.
// ============================================================

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر',
  'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];
const DIGITS = ['صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];

/** تفقيط رقم صحيح موجب (حتى 999 مليون) — عربي فصيح سليم */
function intToWords(n: number): string {
  if (!Number.isFinite(n)) return '';
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'صفر';
  const parts: string[] = [];

  const millions = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;
  if (millions) {
    if (millions === 1) parts.push('مليون');
    else if (millions === 2) parts.push('مليونان');
    else if (millions <= 10) parts.push(`${under1000(millions)} ملايين`);
    else parts.push(`${under1000(millions)} مليوناً`);
  }
  if (rest) {
    const thousands = Math.floor(rest / 1000);
    const rem = rest % 1000;
    if (thousands) {
      if (thousands === 1) parts.push('ألف');
      else if (thousands === 2) parts.push('ألفان');
      else if (thousands <= 10) parts.push(`${under1000(thousands)} آلاف`);
      else parts.push(`${under1000(thousands)} ألفاً`);
    }
    if (rem) parts.push(under1000(rem));
  }
  return parts.join(' و');
}

function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(ONES[r]);
    else {
      const o = r % 10, t = Math.floor(r / 10);
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(' و');
}

/** تفقيط كامل: صحيح أو عشري أو سالب — الفاصلة العشرية تُقرأ بدقة دون إسقاط أصفار */
export function numberToArabicWords(raw: string | number): string {
  let s = String(raw).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).trim();
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d*\.?\d+$/.test(s)) return String(raw); // ليس رقماً نقيّاً — أعد كما هو

  const [intPart, decPart] = s.split('.');
  let out = intToWords(Number(intPart || '0'));
  if (decPart) {
    // الأصفار السابقة تُنطق حرفياً كي لا يُسقط التمييز: .05 → «فاصلة صفر خمسة»
    if (decPart.length > 1 && decPart.startsWith('0')) {
      out += ' فاصلة ' + decPart.split('').map(d => DIGITS[Number(d)]).join(' ');
    } else {
      out += ' فاصلة ' + intToWords(Number(decPart));
    }
  }
  return (neg ? 'ناقص ' : '') + out;
}

// ---------- قاموس المصطلحات: كل حرف لاتيني أو رمز يصبح عربياً واضحاً ----------
type TermRepl = string | ((m: string, ...g: string[]) => string);
const TERM_REPLACEMENTS: [RegExp, TermRepl][] = [
  [/XAU\s*\/?\s*USD/gi, 'الذهب'],
  [/XAU/gi, 'الذهب'],
  [/MT\s*5/gi, 'ميتاتريدر'],
  [/EMA\s*(\d+)/gi, (_m, d) => `المتوسط الأسي ${numberToArabicWords(d)}`],
  [/EMA/gi, 'المتوسط الأسي'],
  [/\bPF\b/g, 'معامل الربح'],
  [/\bSL\b/g, 'وقف الخسارة'],
  [/\bTP\b/g, 'الهدف الجني'],
  [/\bATR\b/g, 'متوسط المدى'],
  [/\bBFX\s*AURUM\b/gi, 'بوت أوروم'],
  [/\bBFX\b/g, 'ب إف إكس'],
  [/\bAURUM\b/gi, 'أوروم'],
  [/\bnews\b/gi, 'الأخبار'],
  [/(\d+)\s*m\b/g, (_m, d) => `${numberToArabicWords(d)} دقيقة`],
  [/(\d+)\s*h\b/g, (_m, d) => `${numberToArabicWords(d)} ساعة`],
];

/** التنظيف الشامل للنص المكتوب ليصبح كلاماً فصيحاً منطوقاً بدقة */
export function normalizeForSpeech(input: string): string {
  if (!input) return '';
  let t = input;

  // 1) أرقام شرقية → غربية
  t = t.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

  // 2) الأوقات 09:30 → «الساعة تسعة وثلاثون دقيقة»
  t = t.replace(/(\d{1,2}):(\d{2})/g, (_m, h: string, m: string) => {
    const mm = Number(m);
    const head = Number(h) === 0 ? 'صفر' : intToWords(Number(h));
    const tail = mm === 0 ? 'تامة تماماً' : `${intToWords(mm)} دقيقة`;
    return `الساعة ${head} و${tail}`;
  });

  // 3) الأرقام الموقّعة (+/-) قبل الرموز — الأدق قبل تفكيك الرموز
  t = t.replace(/([+-])\s*(\d+(?:\.\d+)?)/g, (_m, sign: string, num: string) =>
    ` ${sign === '+' ? 'زائد' : 'ناقص'} ${numberToArabicWords(num)} `);

  // 4) قاموس المصطلحات اللاتينية (قبل التفقيط العام كي تصاد المصطلحات المدمجة بالأرقام مثل MT5 وEMA20)
  for (const [re, rep] of TERM_REPLACEMENTS) {
    t = typeof rep === 'function' ? t.replace(re, rep) : t.replace(re, rep);
  }

  // 5) الأرقام المتبقية (مع النسب والعشور) → كلمات
  t = t.replace(/\d+(?:\.\d+)?/g, m => ` ${numberToArabicWords(m)} `);

  // 6) الرموز المنطوقة
  t = t.replace(/\$/g, ' دولار')
    .replace(/%/g, ' بالمئة')
    .replace(/&/g, ' و ')
    .replace(/@/g, ' عند ')
    .replace(/=/g, ' يساوي ')
    .replace(/\//g, ' على ')
    .replace(/\s*:\s*/g, '، ');
  t = t.replace(/[#*_`~\[\]{}()<>|"'«»\\\-—–…·•]/g, ' ')
    .replace(/\s*؛\s*/g, '، ')
    .replace(/\s*،\s*(?=[،])/g, ' ');

  // 7) رموز صامتة تُحذف (ماركداون وأقواس وغيرها)
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([،.؟!])/g, '$1').trim();
  return t;
}
