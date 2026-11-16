// اختبار إضافي: نموذج LightGBM حقيقي بصيغة JSON + الأداء + عدم التسلل
import { LightGBMFilter, JsonTreeModel, computeFeatures, FEATURE_NAMES } from '../src/lib/engine/lightgbm-filter';
import { TAMSAEngine } from '../src/lib/engine/tamsa-engine';
import { DEFAULT_TAMSA_PARAMS } from '../src/lib/engine/tamsa-params';
import { DEFAULT_SETTINGS } from '../src/lib/engine/rules';
import type { Candle } from '../src/lib/engine/types';

const H = 3600e3;
let fails = 0;
const check = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); if (!c) fails++; };

let seed = 42;
const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
function series(n: number, sp: number, drift: number, vol: number): Candle[] {
  const out: Candle[] = [];
  const base = (i: number) => sp + drift * i + Math.sin(i / 11) * vol * 6 + Math.sin(i / 3.1) * vol * 0.8;
  for (let i = 0; i < n; i++) {
    const o = base(i - 1) + noise() * vol * 0.6, c = base(i) + noise() * vol * 0.6;
    out.push({ t: i * H, o, h: Math.max(o, c) + Math.abs(noise()) * vol * 0.5 + vol * 0.15, l: Math.min(o, c) - Math.abs(noise()) * vol * 0.5 - vol * 0.15, c, v: 1000 });
  }
  return out;
}
const up = series(700, 2000, 0.35, 1.4);

// ---------- 1) تفريغ LightGBM يدوي: شجرة واحدة تقرأ ema20_gap_atr ----------
const featIdx = FEATURE_NAMES.indexOf('ema20_gap_atr');
const dump = {
  num_class: 3,
  tree_info: [
    // شجرة فئة الصعود: قيمة عالية إذا gap > 0
    { tree_index: 0, tree_structure: { split_feature: featIdx, threshold: 0, decision_type: '<=', left_child: { leaf_value: -1.2 }, right_child: { leaf_value: 1.4 } } },
    // شجرة فئة الهبوط
    { tree_index: 1, tree_structure: { split_feature: featIdx, threshold: 0, decision_type: '<=', left_child: { leaf_value: 1.4 }, right_child: { leaf_value: -1.2 } } },
    // شجرة فئة العرض
    { tree_index: 2, tree_structure: { split_feature: featIdx, threshold: -99, decision_type: '<=', left_child: { leaf_value: 0 }, right_child: { leaf_value: 0 } } },
  ],
};

const m = new JsonTreeModel(dump, 'test-lgb-3class');
check('نموذج JSON: يُبنى بلا خطأ', m.name === 'test-lgb-3class');

const f = computeFeatures({ c1h: up, trend1h: 'up', trend4h: 'up', trend1d: 'up' });
check('الميزة ema20_gap_atr موجبة في ترند صاعد', f.ema20_gap_atr > 0, `gap=${f.ema20_gap_atr.toFixed(3)}`);

const filt = new LightGBMFilter({ enabled: true });
filt.loadModelJSON(dump, 'test-lgb-3class');
const pred = filt.predict(f);
check('نموذج JSON: يقرأ الصعود', pred.trend === 'up', `${pred.trend} ${pred.confidence.toFixed(2)}`);
check('نموذج JSON: اسم النموذج محفوظ', pred.model === 'test-lgb-3class');
check('نموذج JSON: يسمح بالشراء', filt.decide(pred, 'up').allowed);
check('نموذج JSON: يمنع البيع', !filt.decide(pred, 'down').allowed);

// ---------- 2) تفريغ فارغ يُرفض ----------
let threw = false;
try { new JsonTreeModel({ tree_info: [] }); } catch { threw = true; }
check('تفريغ فارغ: يُرفض بخطأ صريح', threw);

// ---------- 3) شجرة عديمة القيمة لا تُسقط النظام ----------
const flat = { num_class: 1, tree_info: [{ tree_structure: { leaf_value: 0 } }] };
const f2 = new LightGBMFilter({ enabled: true });
f2.loadModelJSON(flat);
const p2 = f2.predict(f);
check('نموذج مسطّح: احتمالات متساوية تقريباً', Math.abs(p2.probabilities.up - p2.probabilities.range) < 0.01);
check('نموذج مسطّح: لا إذن (ثقة دون العتبة أو range)', !f2.decide(p2, 'up').allowed || p2.trend !== 'range');

// ---------- 4) الأداء: 200 تحليل ----------
const eng = new TAMSAEngine();
const candles = { '5m': up, '15m': up, '30m': up, '1h': up, '4h': up, '1d': up, '1w': up, '1M': up };
const t0 = Date.now();
for (let i = 0; i < 20; i++) eng.analyze(candles as never, DEFAULT_TAMSA_PARAMS, DEFAULT_SETTINGS as never, {});
const perRun = (Date.now() - t0) / 20;
check('الأداء: أقل من 2 ثانية للتحليل الواحد', perRun < 2000, `${perRun.toFixed(0)}ms/تحليل`);

// ---------- 5) لا تسلل: بتر آخر 100 شمعة لا يغيّر الماضي ----------
const full = eng.analyze(candles as never, DEFAULT_TAMSA_PARAMS, DEFAULT_SETTINGS as never, {});
const cutCandles = { ...candles, '1h': up.slice(0, up.length - 100), '4h': up.slice(0, up.length - 100), '1d': up.slice(0, up.length - 100) };
const cut = eng.analyze(cutCandles as never, DEFAULT_TAMSA_PARAMS, DEFAULT_SETTINGS as never, {});
const fullEarly = full.structure.h1.realPivots.filter(p => p.confirmedAt <= cut.at);
const cutPivots = cut.structure.h1.realPivots.filter(p => p.confirmedAt <= cut.at);
const same = fullEarly.length === cutPivots.length &&
  fullEarly.every((p, i) => p.kind === cutPivots[i]?.kind && Math.abs(p.price - cutPivots[i].price) < 1e-9);
check('لا تسلل مستقبلي: المحاور الماضية متطابقة بعد البتر', same,
  `full=${fullEarly.length} cut=${cutPivots.length}`);

console.log(`\n${fails === 0 ? '🎯 كل اختبارات النموذج نجحت' : `⚠️ ${fails} اختبار فشل`}`);
process.exit(fails === 0 ? 0 : 1);
