// اختبار حتمية التنبؤ — يتحقق أن نفس الشموع + نفس الإعدادات
// تُنتج نفس الشموع المتوقعة دائماً (لا RNG). ويتحقق أن
// تعطيل indicators.ema يُلغي تأثير EMA من مزيج القرار.
import { buildForecast } from '../src/lib/engine/forecast';
import { DEFAULT_SETTINGS, Settings } from '../src/lib/engine/rules';
import type { Candle, TF } from '../src/lib/engine/types';

function makeCandles(n: number, base: number, atr: number, seed: number): Candle[] {
  // سلسلة شبه واقعية: اتجاه + ضوضاء بسيطة حتمية (لا Math.random)
  const out: Candle[] = [];
  let c = base;
  let t = 1700000000000;
  const tfMs = 5 * 60_000;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin((i + seed) / 13) * atr * 0.4;
    const noise = ((i * 9301 + seed * 49297) % 233280) / 233280 - 0.5;
    const o = c;
    const c2 = +(o + drift + noise * atr * 0.8).toFixed(2);
    const h = +Math.max(o, c2, o + atr * 0.3).toFixed(2);
    const l = +Math.min(o, c2, o - atr * 0.3).toFixed(2);
    out.push({ t, o, h, l, c: c2, v: 100 });
    c = c2; t += tfMs;
  }
  return out;
}

const XAU = 2650;
const ATR = 2.5;
const candles = makeCandles(200, XAU, ATR, 7);

const emaOn: Settings = {
  ...DEFAULT_SETTINGS,
  indicators: { sessionTiming: true, ema: true, emaFast: 20, emaSlow: 90 },
} as Settings;

const emaOff: Settings = {
  ...DEFAULT_SETTINGS,
  indicators: { sessionTiming: true, ema: false, emaFast: 20, emaSlow: 90 },
} as Settings;

const customEma: Settings = {
  ...DEFAULT_SETTINGS,
  indicators: { sessionTiming: true, ema: true, emaFast: 9, emaSlow: 50 },
} as Settings;

console.log('=== اختبار 1: حتمية (نفس المدخلات = نفس المخرجات) ===');
const r1 = buildForecast(candles, '15m' as TF, emaOn);
const r2 = buildForecast(candles, '15m' as TF, emaOn);
const same = JSON.stringify(r1.projected) === JSON.stringify(r2.projected);
console.log('نفس الشموع المتوقعة في تشغيلين:', same ? '✅ نعم (حتمي)' : '❌ لا (عشوائي!)');
console.log('عدد الشموع المتوقعة:', r1.projected.length);
console.log('الإعدادات المُطبّقة:', r1.settingsApplied);

console.log('\n=== اختبار 2: صحة OHLC لكل شمعة متوقعة ===');
let allValid = true;
let allInBand = true;
for (let i = 0; i < r1.projected.length; i++) {
  const c = r1.projected[i];
  const valid = c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c) && c.h >= c.l;
  const inBand = c.h <= r1.band[i].upper + 0.001 && c.l >= r1.band[i].lower - 0.001;
  if (!valid) { allValid = false; console.log(`❌ شمعة ${i+1} OHLC غير صالح:`, c); }
  if (!inBand) { allInBand = false; console.log(`❌ شمعة ${i+1} تخرج من النطاق:`, c, r1.band[i]); }
}
console.log('كل الشموع صحيحة OHLC:', allValid ? '✅' : '❌');
console.log('كل الشموع داخل نطاق الثقة:', allInBand ? '✅' : '❌');

console.log('\n=== عينة من الشموع المتوقعة ===');
console.log('أول 3:');
r1.projected.slice(0, 3).forEach((c, i) => console.log(`  [${i+1}] t=${c.t} o=${c.o} h=${c.h} l=${c.l} c=${c.c}`));
console.log('آخر 2:');
r1.projected.slice(-2).forEach((c, i) => console.log(`  [${11+i}] t=${c.t} o=${c.o} h=${c.h} l=${c.l} c=${c.c}`));

console.log('\n=== اختبار 3: تعطيل EMA يُلغي محرك EMA من المزيج ===');
const rOff = buildForecast(candles, '15m' as TF, emaOff);
const rOn = buildForecast(candles, '15m' as TF, emaOn);
console.log('مع EMA مفعّل — drivers:', rOn.drivers.map(d => `${d.label}(${d.weight})`).join(' + '));
console.log('مع EMA معطّل — drivers:', rOff.drivers.map(d => `${d.label}(${d.weight})`).join(' + '));
console.log('EMA في drivers عند التعطيل:', rOff.drivers.some(d => d.label.startsWith('EMA')) ? '❌ نعم (خطأ)' : '✅ لا (صحيح)');

console.log('\n=== اختبار 4: تخصيص فترات EMA يُستخدم فعلاً ===');
const rCustom = buildForecast(candles, '15m' as TF, customEma);
console.log('الإعدادات المُطبّقة:', rCustom.settingsApplied);
console.log('label الـ EMA في drivers:', rCustom.drivers.find(d => d.label.startsWith('EMA'))?.label);

console.log('\n=== اختبار 5: لا يوجد Math.random في الكود ===');
const fs = await import('fs');
const src = fs.readFileSync('./src/lib/engine/forecast.ts', 'utf8');
const hasRandom = /Math\.random|mulberry|\brng\b\s*\(/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
console.log('يحتوي RNG خارج التعليقات:', hasRandom ? '❌ نعم' : '✅ لا');

console.log('\n=== قرار التنبؤ النهائي ===');
console.log('الاتجاه:', r1.decision.dir, '| الثقة:', r1.decision.confidence + '%');
console.log('pUpOverall:', r1.decision.pUpOverall);
console.log('النطاق المتوقع:', r1.decision.expLow, '~', r1.decision.expHigh);
