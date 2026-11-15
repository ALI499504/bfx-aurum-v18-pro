// اختبار دقة المُطبعّع العربي الحتمي — يُشغَّل بـ bun scripts/test-arabic-speak.ts
import { numberToArabicWords, normalizeForSpeech } from '../src/lib/server/jarvis/arabic-speak';

const cases = ['4071.13', '190.81', '-0.43', '0.05', '281', '1200', '0.887'];
for (const c of cases) console.log(c, '=>', numberToArabicWords(c));
console.log('---');
console.log(normalizeForSpeech('الذهب الآن 4071.13 دولاراً، رصيدك 190.81$ (-0.43%) و 281 صفقة عبر MT5 وEMA20 وPF 0.887'));
console.log('---');
console.log(normalizeForSpeech('شغّلت الباك تيست: 281 صفقة، معامل الربح 0.887، خسارة 228.1$ في 14.2 ثانية'));
