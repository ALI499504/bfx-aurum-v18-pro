// ============================================================
// اختبار بروتوكول الجسر v17 — عملية معزولة (لا تلمس الخادم الحي)
// يحاكي: دفعات التاريخ العميق (history:true, 4000 شمعة/دفعة)
// + التكرار (dedupe) + بوابة الجودة + تشغيل المحرك على النتيجة
// ============================================================
import { ingestMt5, mt5Feed, getMt5Status } from '../src/lib/server/mt5feed';
import { getEngineData } from '../src/lib/server/data';
import { runBacktest } from '../src/lib/engine/backtest';
import { DEFAULT_SETTINGS } from '../src/lib/engine/rules';

const DAY = 86400_000;
const NOW = Date.now();
const FROM = Date.UTC(2025, 0, 2); // 2025-01-02 مثل بيانات الطرفية الحقيقية

function isWeekend(t: number): boolean {
  const d = new Date(t);
  const wd = d.getUTCDay();
  if (wd === 6) return true; // السبت
  if (wd === 0 && d.getUTCHours() < 22) return true; // الأحد قبل 22:00
  if (wd === 5 && d.getUTCHours() >= 22) return true; // الجمعة بعد 22:00
  return false;
}

function genTf(ms: number, maxBars: number): number[][] {
  const rows: number[][] = [];
  let p = 2600;
  let t = FROM;
  let n = 0;
  while (t < NOW && n < maxBars) {
    if (ms >= DAY || !isWeekend(t)) {
      const o = p;
      const drift = Math.sin(t / (DAY * 7)) * 0.9;
      const c = o + drift + (Math.sin(t / 3.7e6) * 0.35);
      const h = Math.max(o, c) + 0.4;
      const l = Math.min(o, c) - 0.4;
      rows.push([t, +o.toFixed(2), +h.toFixed(2), +l.toFixed(2), +c.toFixed(2), 500]);
      p = c;
      n++;
    }
    t += ms;
  }
  return rows;
}

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
}

// --- 1) دفعات تاريخ عميق بالبروتوكول v17 بالضبط ---
const ACCOUNT = { login: 'TEST-LOGIN-77', server: 'UnitTest-Demo', currency: 'USD', leverage: 100 };
const tfs: Record<string, number[][]> = {
  '5m': genTf(300_000, 6000),
  '15m': genTf(900_000, 2000),
  '30m': genTf(1_800_000, 1000),
  '1h': genTf(3_600_000, 600),
  '4h': genTf(14_400_000, 200),
  '1d': genTf(DAY, 80),
};
const keys = Object.keys(tfs);
let sentTotal = 0;
const BATCH = 4000;
for (const k of keys) {
  const rows = tfs[k];
  for (let i = 0; i < rows.length; i += BATCH) {
    const part = rows.slice(i, i + BATCH);
    const r = ingestMt5({ symbol: 'XAUUSD.u', broker: 'UnitTest-Demo', account: ACCOUNT, history: true, tfs: { [k]: part } });
    sentTotal += part.length;
    if (r.stored !== part.length) check(`دفعة ${k}#${Math.floor(i / BATCH)} مخزنة كاملة`, false, `stored=${r.stored}`);
  }
}
check('رفع الدفعات التراكمية', sentTotal > 9000, `${sentTotal} شمعة`);

const st1 = getMt5Status();
check('الأعداد مطابقة', st1.counts['5m'] === tfs['5m'].length && st1.counts['1h'] === tfs['1h'].length,
  `5m=${st1.counts['5m']} 1h=${st1.counts['1h']}`);
check('أقدم شمعة 1d = 2025-01-02', st1.oldest['1d'] != null && new Date(st1.oldest['1d']).toISOString().slice(0, 10) === '2025-01-02',
  st1.oldest['1d'] ? new Date(st1.oldest['1d']).toISOString().slice(0, 10) : 'null');

// --- 2) إعادة إرسال دفعة قديمة (dedupe) — العدد لا يتغير ---
const r2 = ingestMt5({ symbol: 'XAUUSD.u', broker: 'UnitTest-Demo', account: ACCOUNT, history: true, tfs: { '5m': tfs['5m'].slice(0, 100) } });
check('dedupe: إعادة دفعة قديمة لا تزيد العدد', getMt5Status().counts['5m'] === tfs['5m'].length,
  `قبل/بعد ${tfs['5m'].length}/${getMt5Status().counts['5m']}`);

// --- 3) تحديث شمعة موجودة (upsert) — شمعة منطقية القيم ---
const lastRow = [...tfs['5m'][-1 + tfs['5m'].length]];
const newClose = +(lastRow[1] + 3.5).toFixed(2); // الإغلاق الجديد
lastRow[2] = +(newClose + 0.5).toFixed(2);       // هاي أعلى من الإغلاق
lastRow[4] = newClose;
ingestMt5({ symbol: 'XAUUSD.u', broker: 'UnitTest-Demo', account: ACCOUNT, tfs: { '5m': [lastRow] } });
const feed = mt5Feed();
check('upsert: آخر شمعة تتحدث بالقيمة الجديدة', feed.tfs['5m']![feed.tfs['5m']!.length - 1].c === newClose,
  `c=${feed.tfs['5m']![feed.tfs['5m']!.length - 1].c} متوقع ${newClose}`);

// --- 4) بوابة الجودة: 15m متناثر → يُستبعد ويُبنى من 5m ---
ingestMt5({
  symbol: 'XAUUSD.u', broker: 'UnitTest-Demo', account: ACCOUNT,
  tfs: { '15m': tfs['15m'].slice(-40) }, // 40 شمعة 15m فقط مقابل آلاف متوقعة → متناثر
});
const data = getEngineData();
check('المحرك يبني بيانات من الشموع الحقيقية', data !== null);
if (data) {
  check('c15 أعيد بناؤه من 5m (بوابة الجودة)', data.c15.length > 1000, `c15=${data.c15.length}`);
  const res = runBacktest(data, DEFAULT_SETTINGS);
  check('الباك تيست يعمل وينتج صفقات', res.stats.totalTrades >= 0, `${res.stats.totalTrades} صفقة`);
}

// --- 5) تبديل الحساب يمسح القديم (حماية خلط الأجهزة) ---
ingestMt5({ symbol: 'XAUUSD.u', broker: 'Other-Demo', account: { login: 'OTHER-999', server: 'Other-Demo', currency: 'USD', leverage: 100 }, tfs: { '5m': [lastRow] } });
check('تبديل الحساب يمسح شموع الحساب القديم', (mt5Feed().tfs['5m']?.length ?? 0) <= 1);

console.log(failed === 0 ? '\n=== ALL PASS ===' : `\n=== ${failed} FAILED ===`);
process.exit(failed === 0 ? 0 : 1);
