// اختبار مُطبّع النطق العربي — يُشغَّل عبر bun مباشرة
import { normalizeForSpeech, numberToArabicWords } from '../src/lib/server/jarvis/arabic-speak';

const cases: [string, string][] = [
  ['الذهب 4073.25$ (+0.45%)', 'سعر مع رقم عشري ورموز'],
  ['الرصيد 190.81$ على JustMarkets-Demo', 'رصيد الحساب'],
  ['XAUUSD: EMA20 فوق EMA90، PF 0.887', 'مختصرات تداول'],
  ['281 صفقة، -228.1$، تراجع 12.5%', 'أرقام سالبة ونسب'],
  ['دراسة السوق الشاملة (15m) | الجلسة: لندن', 'فريم زمني ورموز'],
  ['المتوسط الأسي 20 فوق 90', 'EMA مكتوبة عربياً'],
  ['MT5 متصل، 3 صفقات مفتوحة', 'ميتاتريدر'],
  ['٠٩:٣٠ أخبار الدولار', 'أرقام شرقية ووقت'],
  ['صافي +12.30$ يومياً', 'زائد وعشري'],
  ['أربعة آلاف وسبعون دولاراً', 'نص عربي سليم يبقى كما هو'],
];

let fails = 0;
for (const [input, label] of cases) {
  const out = normalizeForSpeech(input);
  const ok = out.length > 0 && !/[0-9$%+\-]/.test(out.replace(/فاصلة|BFX|MT/g, ''));
  if (!ok) fails++;
  console.log(`${ok ? '✔' : '⚠'} [${label}]`);
  console.log(`   في: ${input}`);
  console.log(`   فصحى: ${out}`);
}
console.log('\n--- تفقيط مباشر ---');
for (const n of ['0', '7', '15', '20', '99', '100', '190.81', '4073.25', '4073.05', '-228.1', '1000000', '281']) {
  console.log(`${n} → ${numberToArabicWords(n)}`);
}
if (fails > 0) process.exit(1);
