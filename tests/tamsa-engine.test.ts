// اختبار وظيفي لمحرك TAMSA — بيانات مُصنّعة، بلا اعتماد خارجي
// يستخدم bun لتشغيل TypeScript مباشرة.
import { TAMSAEngine } from '../src/lib/engine/tamsa-engine';
import { confirm4Points } from '../src/lib/engine/structure';
import { LightGBMFilter, computeFeatures, SurrogateTrendModel } from '../src/lib/engine/lightgbm-filter';
import { DEFAULT_TAMSA_PARAMS } from '../src/lib/engine/tamsa-params';
import { DEFAULT_SETTINGS } from '../src/lib/engine/rules';
import type { Candle, RealPivot } from '../src/lib/engine/types';

const H = 3600e3;
let fails = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

// ضجيج حتمي صغير — يمنع تساوي القمم المتتالية (شرط المحور الصارم يرفض التساوي)
let seed = 987654321;
const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };

function series(n: number, startPrice: number, drift: number, vol: number, tf = H, t0 = Date.UTC(2025, 0, 2)): Candle[] {
  const out: Candle[] = [];
  const base = (i: number) => startPrice + drift * i + Math.sin(i / 11) * vol * 6 + Math.sin(i / 3.1) * vol * 0.8;
  for (let i = 0; i < n; i++) {
    const o = base(i - 1) + noise() * vol * 0.6;
    const c = base(i) + noise() * vol * 0.6;
    const h = Math.max(o, c) + Math.abs(noise()) * vol * 0.5 + vol * 0.15;
    const l = Math.min(o, c) - Math.abs(noise()) * vol * 0.5 - vol * 0.15;
    out.push({ t: t0 + i * tf, o, h, l, c, v: 1000 + (i % 7) * 120 });
  }
  return out;
}

const upTrend = series(700, 2000, 0.35, 1.4);
const downTrend = series(400, 2600, -0.35, 1.5, H, Date.UTC(2025, 0, 2) + 700 * H);
// ---------- 1) الفلتر: اتجاه صاعد ----------
const filter = new LightGBMFilter({ enabled: true });
const fUp = computeFeatures({ c1h: upTrend, trend1h: 'up', trend4h: 'up', trend1d: 'up' });
const pUp = filter.predict(fUp);
check('LightGBM يقرأ الاتجاه الصاعد', pUp.trend === 'up', `trend=${pUp.trend} conf=${pUp.confidence.toFixed(2)}`);
check('الثقة ضمن 0..1', pUp.confidence > 0 && pUp.confidence <= 1);
check('مجموع الاحتمالات = 1', Math.abs(pUp.probabilities.up + pUp.probabilities.down + pUp.probabilities.range - 1) < 1e-9);

const dBuy = filter.decide(pUp, 'up');
check('الفلتر يسمح بشراء مع اتجاه صاعد', dBuy.allowed || pUp.confidence < filter.threshold, dBuy.reason);
const dSell = filter.decide(pUp, 'down');
check('الفلتر يمنع بيع مع اتجاه صاعد', !dSell.allowed, dSell.reason);

// ---------- 2) الفلتر: اتجاه هابط ----------
const fDn = computeFeatures({ c1h: downTrend, trend1h: 'down', trend4h: 'down', trend1d: 'down' });
const pDn = filter.predict(fDn);
check('LightGBM يقرأ الاتجاه الهابط', pDn.trend === 'down', `trend=${pDn.trend} conf=${pDn.confidence.toFixed(2)}`);
check('لا إذن لشراء في هبوط', !filter.decide(pDn, 'up').allowed);

// ---------- 3) الفلتر المعطّل يمرّر كل شيء ----------
const off = new LightGBMFilter({ enabled: false });
check('الفلتر المعطّل يسمح دائماً', off.decide(off.predict(fUp), 'down').allowed);

// ---------- 4) الأربع نقاط: نمط صاعد صحيح ----------
const tp = (kind: RealPivot['kind'], price: number, i: number, tf = '1h' as const): RealPivot =>
  ({ kind, tf, price, t: i * H, confirmedAt: (i + 2) * H, trendAtConfirm: 'up' });

const upPattern: RealPivot[] = [
  tp('LL', 1900, 10), tp('HH', 2100, 20), tp('HL', 2000, 30), tp('HH', 2200, 40),
];
const fpUp = confirm4Points(upPattern, 'up');
check('4 نقاط: نمط صاعد مؤكد', fpUp.confirmed && fpUp.trend === 'up', fpUp.reason);
check('4 نقاط: جودة كاملة 100%', fpUp.score === 1);
check('4 نقاط: النقطة الرابعة هي HH 2200', fpUp.points?.p4.price === 2200);

const downPattern: RealPivot[] = [
  tp('HH', 2200, 10), tp('LL', 2000, 20), tp('LH', 2100, 30), tp('LL', 1900, 40),
];
const fpDn = confirm4Points(downPattern, 'down');
check('4 نقاط: نمط هابط مؤكد', fpDn.confirmed && fpDn.trend === 'down', fpDn.reason);

// ---------- 5) الأربع نقاط: رفض التتابع الخاطئ ----------
const wrongSeq: RealPivot[] = [
  tp('HH', 2100, 10), tp('LL', 1900, 20), tp('HL', 1950, 30), tp('HH', 2150, 40),
];
const fpWrong = confirm4Points(wrongSeq, 'up');
check('4 نقاط: يرفض التتابع الخاطئ HH→LL→HL→HH', !fpWrong.confirmed, fpWrong.reason);

// ---------- 6) الأربع نقاط: رفض الأسعار غير المتسقة ----------
const badPrices: RealPivot[] = [
  tp('LL', 1900, 10), tp('HH', 2100, 20), tp('HL', 2150, 30), tp('HH', 2200, 40), // HL فوق HH2
];
const fpBad = confirm4Points(badPrices, 'up');
check('4 نقاط: يرفض HL أعلى من HH2', !fpBad.confirmed, `score=${fpBad.score}`);

// ---------- 7) الأربع نقاط: بلا تسلل مستقبلي ----------
const futurePool: RealPivot[] = [tp('LL', 1900, 10), tp('HH', 2100, 20), tp('HL', 2000, 30), tp('HH', 2200, 40)];
const asOfEarly = confirm4Points(futurePool, 'up', { asOf: 25 * H }); // قبل تأكيد P3
check('4 نقاط: asOf يمنع رؤية المستقبل', !asOfEarly.confirmed, asOfEarly.reason);

// ---------- 7ب) الأربع نقاط: تطبيع التكرار (المحرك يعيد إصدار المحور نفسه) ----------
const dupPool: RealPivot[] = [
  tp('LL', 1900, 10),
  tp('HH', 2100, 20), tp('HH', 2100, 20), tp('HH', 2105, 21),  // تكرار ++ HH أعلى
  tp('HL', 2000, 30),
  tp('HH', 2200, 40), tp('HH', 2200, 40),
];
const fpDup = confirm4Points(dupPool, 'up');
check('4 نقاط: التكرار المتتالي لا يكسر النمط', fpDup.confirmed && fpDup.trend === 'up', fpDup.reason);

// ---------- 7ج) الأربع نقاط: الإبطال بكسر بنيوي ----------
const invalidPool: RealPivot[] = [
  tp('LL', 1900, 10), tp('HH', 2100, 20), tp('HL', 2000, 30), tp('HH', 2200, 40),
  tp('LL', 1850, 50), // كسر بنيوي هابط بعد النمط
];
const fpInv = confirm4Points(invalidPool, 'up');
check('4 نقاط: يُبطل بكسر LL بعد النمط الصاعد', !fpInv.confirmed && fpInv.invalidated, fpInv.reason);

// ---------- 7د) الأربع نقاط: النمط يبقى صالحاً مع استمرار الاتجاه ----------
const continuePool: RealPivot[] = [
  tp('LL', 1900, 10), tp('HH', 2100, 20), tp('HL', 2000, 30), tp('HH', 2200, 40),
  tp('HL', 2150, 50), tp('HH', 2300, 60), tp('HL', 2250, 70), tp('HH', 2400, 80),
];
const fpCont = confirm4Points(continuePool, 'up');
check('4 نقاط: يبقى صالحاً بعد 4 محاور لاحقة', fpCont.confirmed && fpCont.trailing === 4, fpCont.reason);
const fpContOld = confirm4Points(continuePool, 'up', { maxTrailing: 2 });
check('4 نقاط: يُسقط عند تجاوز maxTrailing', !fpContOld.confirmed, fpContOld.reason);

// ---------- 8) المحرك: لقطة كاملة ----------
const engine = new TAMSAEngine({ lightGBM: true, fourPoints: true });
const candles = {
  '5m': upTrend, '15m': upTrend, '30m': upTrend,
  '1h': upTrend, '4h': upTrend, '1d': upTrend, '1w': upTrend, '1M': upTrend,
};
const snap = engine.analyze(candles as never, DEFAULT_TAMSA_PARAMS, DEFAULT_SETTINGS as never, {}, undefined);
check('المحرك: ينتج لقطة كاملة', !!snap && typeof snap.summary === 'string');
check('المحرك: يحلل الهيكل', snap.structure.h1.realPivots.length > 0 || snap.structure.h1.pivots.length > 0,
  `pivots=${snap.structure.h1.pivots.length} real=${snap.structure.h1.realPivots.length}`);
check('المحرك: اللوت ثابت 0.01 من الدستور', snap.risk.lot === 0.01, `lot=${snap.risk.lot}`);
check('المحرك: سقف الستوب = 150 بيب (15$)', snap.risk.slCap === 150, `cap=${snap.risk.slCap}`);
check('المحرك: يعرض LightGBM', !!snap.lightGBM, snap.lightGBM ? `${snap.lightGBM.trend} ${snap.lightGBM.confidence.toFixed(2)}` : 'none');
check('المحرك: ملخص غير فارغ', snap.summary.length > 20);
check('المحرك: لقطعة إشارات تاريخية لا تُقترح', snap.proposals.length === 0 || snap.proposals.every(p => snap.at - p.setup.createdAt <= 24 * 3600e3),
  `n=${snap.proposals.length} stale=${snap.diagnostics.blockedByGate['stale'] ?? 0}`);
console.log('   summary:', snap.summary.slice(0, 300));
console.log(`   signals raw=${snap.diagnostics.signalsRaw} passed=${snap.diagnostics.passed} blocked=${JSON.stringify(snap.diagnostics.blockedByGate)}`);

// ---------- 9) لا تغيير في اللوت حتى مع مخاطرة عالية ----------
const riskSmall = engine.riskVerdict({ globalRules: { ...DEFAULT_SETTINGS.globalRules } } as never, { dayPnL: 0, dayTrades: 0 });
const riskLoss = engine.riskVerdict({ globalRules: { ...DEFAULT_SETTINGS.globalRules } } as never, { dayPnL: -60, dayTrades: 3 });
check('القاعدة 7 توقف بعد خسارة 60$', !riskLoss.canOpen, riskLoss.blocks.join(' | '));
check('اللوت لا يتغير عند الخسارة', riskLoss.lot === riskSmall.lot && riskLoss.lot === 0.01, `lot=${riskLoss.lot}`);

const riskProfit = engine.riskVerdict({ globalRules: { ...DEFAULT_SETTINGS.globalRules } } as never, { dayPnL: 250 });
check('القاعدة 8 تحظر بعد ربح 250$', !riskProfit.canOpen, riskProfit.blocks.join(' | '));
check('اللوت لا يتغير عند الربح', riskProfit.lot === 0.01);

// ---------- 10) القاعدة 10: صفقة نشطة ----------
const riskActive = engine.riskVerdict({ globalRules: { ...DEFAULT_SETTINGS.globalRules } } as never, { activeTrade: true });
check('القاعدة 10 تحظر مع صفقة نشطة', !riskActive.canOpen);

// ---------- 11) شدّ الستوب لا يوسّعه ----------
const wideCandles = { ...candles };
const snapWide = engine.analyze(wideCandles as never, DEFAULT_TAMSA_PARAMS, DEFAULT_SETTINGS as never, {});
const allCapped = snapWide.proposals.every(p => p.setup.slPips <= 150 + 1e-9);
check('كل المقترحات ملتزمة بسقف الستوب 150 بيب', allCapped, `n=${snapWide.proposals.length}`);

// ---------- 12) وضع الفلتر off لا يحجب ----------
const e2 = new TAMSAEngine({ lightGBMMode: 'off' });
const snap2 = e2.analyze(candles as never, DEFAULT_TAMSA_PARAMS, DEFAULT_SETTINGS as never, {});
check('وضع off: لا حجب من LightGBM', (snap2.diagnostics.blockedByGate['lightgbm'] ?? 0) === 0);

// ---------- 13) الشموع الفارغة لا تُسقط المحرك ----------
const snapEmpty = engine.analyze({} as never, DEFAULT_TAMSA_PARAMS, DEFAULT_SETTINGS as never, {});
check('شموع فارغة: لا انهيار ولا مقترحات', snapEmpty.proposals.length === 0 && !!snapEmpty.summary);

// ---------- 14) بوابة الأربع نقاط تحجب فعلاً عند التعارض ----------
// نركّب نمطاً صاعداً في h1 بمحاور حقيقية عبر شموع مُصنّعة ثم نختبر الوضع strict
const strictEng = new TAMSAEngine({ fourPoints: true, fourPointsMode: 'strict', fourPointsMaxTrailing: 200 });
const snapStrict = strictEng.analyze(candles as never, DEFAULT_TAMSA_PARAMS, DEFAULT_SETTINGS as never, {});
check('وضع strict: كل المقترحات توافق النمط الصاعد',
  snapStrict.proposals.every(p => p.setup.dir === 'buy') || snapStrict.proposals.length === 0,
  `n=${snapStrict.proposals.length}`);

const vetoEng = new TAMSAEngine({ fourPoints: true, fourPointsMode: 'veto', fourPointsMaxTrailing: 200 });
const snapVeto = vetoEng.analyze(candles as never, DEFAULT_TAMSA_PARAMS, DEFAULT_SETTINGS as never, {});
check('وضع veto: يسمح بالعكس عند غياب نمط معاكس', snapVeto.proposals.length >= snapVeto.blocked.filter(b => b.gate === 'fourpoints').length, 
  `n=${snapVeto.proposals.length} blockedFP=${snapVeto.blocked.filter(b => b.gate === 'fourpoints').length}`);

// ---------- 15) كل مقترح يحمل لوتاً ثابتاً 0.01 وسقف ستوب ----------
const everyLotOk = snapVeto.proposals.every(p => p.lot === 0.01);
check('كل المقترحات: لوت 0.01 ثابت', everyLotOk, `n=${snapVeto.proposals.length}`);
check('كل المقترحات: slPips ضمن السقف', snapVeto.proposals.every(p => p.setup.slPips > 0 && p.setup.slPips <= 150 + 1e-9));
check('كل المقترحات: sl متوافق مع الاتجاه', snapVeto.proposals.every(p =>
  p.setup.dir === 'buy' ? p.setup.sl < p.setup.entry : p.setup.sl > p.setup.entry));
check('كل المقترحات: tp متوافق مع الاتجاه', snapVeto.proposals.every(p =>
  p.setup.dir === 'buy' ? p.setup.tp > p.setup.entry : p.setup.tp < p.setup.entry));

console.log(`\n${fails === 0 ? '🎯 كل الاختبارات نجحت' : `⚠️ ${fails} اختبار فشل`}`);
process.exit(fails === 0 ? 0 : 1);
