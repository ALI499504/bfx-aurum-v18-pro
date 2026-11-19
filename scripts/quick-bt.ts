// سكربت باق تيست سريع من لقطة القرص — بدون انتظار الجسر
import * as fs from 'fs';
import * as zlib from 'zlib';
import { loadData, resetEngineCache, runBacktest, EngineData, aggregate, aggregateWeekly, aggregateMonthly } from '../src/lib/engine/backtest';
import { DEFAULT_SETTINGS } from '../src/lib/engine/rules';
import type { Candle } from '../src/lib/engine/types';
import { TF_MS } from '../src/lib/engine/types';

const snapshotPath = './db/mt5-feed-snapshot.json.gz';
const raw = zlib.gunzipSync(fs.readFileSync(snapshotPath)).toString();
const data = JSON.parse(raw);
const tfs = data.tfs;

// بناء EngineData من اللقطة
const rawCandles: Record<string, Candle[]> = {};
const engineTfs = ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const;
for (const tf of engineTfs) {
  const arr = tfs[tf];
  if (arr && arr.length) rawCandles[tf] = arr;
}

// تجميع الفريمات الناقصة
if (!rawCandles['15m']) rawCandles['15m'] = aggregate(rawCandles['5m'], TF_MS['15m']);
if (!rawCandles['30m']) rawCandles['30m'] = aggregate(rawCandles['5m'], TF_MS['30m']);
if (!rawCandles['1h']) rawCandles['1h'] = aggregate(rawCandles['5m'], TF_MS['1h']);
if (!rawCandles['4h']) rawCandles['4h'] = aggregate(rawCandles['5m'], TF_MS['4h']);
if (!rawCandles['1d']) rawCandles['1d'] = aggregate(rawCandles['5m'], TF_MS['1d']);
if (!rawCandles['1w']) rawCandles['1w'] = aggregateWeekly(rawCandles['5m']);
if (!rawCandles['1M']) rawCandles['1M'] = aggregateMonthly(rawCandles['5m']);

const engineData: EngineData = loadData(rawCandles);

console.log('==============================================');
console.log('باقي تيست سريع — من لقطة القرص');
console.log(`شموع 5m: ${rawCandles['5m'].length}`);
console.log('==============================================');
console.log('... جاري الحساب (قد يأخذ دقيقة)...');

const t0 = Date.now();

resetEngineCache();
const result = runBacktest(engineData, DEFAULT_SETTINGS, []);

if (!result) {
  console.log('فشل الباك تيست — لا بيانات كافية');
  process.exit(1);
}

const elapsed = Date.now() - t0;
const stats = result.stats;

console.log('');
console.log('==============================================');
console.log('📊 نتائج الباك تيست (مع التحسينات الجديدة)');
console.log('==============================================');
console.log(`⏱️  زمن الحساب: ${elapsed}ms`);
console.log(`📅 الفترة: من ${new Date(stats.startT).toISOString().slice(0,10)} إلى ${new Date(stats.endT).toISOString().slice(0,10)}`);
console.log('---');
console.log(`📈 إجمالي الصفقات: ${stats.totalTrades}`);
console.log(`✅ رابحة: ${stats.wins}`);
console.log(`❌ خاسرة: stats.losses}`);
console.log(`🎯 نسبة الفوز: ${stats.winRate}%`);
console.log(`💰 ربح صافي: $${stats.netPnl.toFixed(2)}`);
console.log(`📊 عامل الربح (PF): ${stats.profitFactor.toFixed(2)}`);
console.log(`📉 أعلى ركود: ${stats.maxDrawdownPct}%`);
console.log(`📐 متوسط R: ${stats.avgR.toFixed(2)}`);
console.log(`💵 الرصيد النهائي: $${stats.finalBalance.toFixed(2)}`);
console.log('---');
console.log('🏆 ترتيب الاستراتيجيات:');
const ranking = stats.ranking || [];
for (const r of ranking.slice(0, 15)) {
  const sign = r.net >= 0 ? '+' : '';
  console.log(`  ${r.strategy.padEnd(3)} | ${sign}${r.net.toFixed(1)}$ | ${r.trades} صفقة | فوز ${r.winRate.toFixed(1)}%`);
}
console.log('');
console.log('==============================================');
