// فحص تشخيصي: كم منطقة مرشحة (شرط الفتيل) لكل فريم، وكم منها رُفضت بوابة score>=5، وتفصيل مكونات النقاط
import { loadData } from '../src/lib/engine/backtest';
import type { Candle } from '../src/lib/engine/types';
import { WickTipEngine, WICKTIP_CFG, AGE_PTS, ZoneTf } from '../src/lib/engine/wicktip';

const snap = JSON.parse(await Bun.file('db/mt5-feed-snapshot.json').text());
const toC = (rows: unknown[][]): Candle[] => rows.map(r => ({ t: r[0] as number, o: r[1] as number, h: r[2] as number, l: r[3] as number, c: r[4] as number, v: r[5] as number }));

// نشتق المناطق يدوياً بنفس منطق المحرك لكن مع عدّاد تشخيصي — عبر وراثة بسيطة:
const raw: Record<string, Candle[]> = {};
for (const tf of ['5m', '15m', '1d', '1w', '1M'] as const) raw[tf] = toC(snap.tfs[tf]);

// نستخدم المحرك الحقيقي لكن نعدّ المناطق النهائية حسب الفريم والحالة
const eng = new WickTipEngine(raw['1M'], raw['1w'], raw['1d'], raw['15m'], raw['5m']);
// نمرر كل التاريخ
eng.advance(Number.MAX_SAFE_INTEGER);

const byTf: Record<string, { total: number; fresh: number; touched: number; inv: number; avgStruct: number }> = {};
for (const z of eng.zones) {
  const k = z.tf as string;
  byTf[k] ??= { total: 0, fresh: 0, touched: 0, inv: 0, avgStruct: 0 };
  const b = byTf[k];
  b.total++;
  if (z.state === 'INVALIDATED') b.inv++;
  else if (z.state === 'FRESH') b.fresh++; else b.touched++;
  b.avgStruct += z.structuralScore;
}
console.log('===== المناطق المقبولة (score>=5 عند التكوين) لكل فريم — كل التاريخ =====');
for (const [k, b] of Object.entries(byTf)) {
  console.log(`${k}: مقبولة=${b.total} (FRESH=${b.fresh}, TOUCHED=${b.touched}, INVALIDATED=${b.inv}) متوسط structural=${(b.avgStruct / b.total).toFixed(1)}`);
}

// مكونات النقاط لكل منطقة مقبولة
console.log('\n===== عينة مناطق مقبولة (الأحدث 12) =====');
for (const z of eng.zones.slice(-12)) {
  const live = eng.liveScore(z);
  console.log(`#${z.id} ${z.tf} ${z.side} tip=${z.tip.toFixed(2)} zone=${z.zoneBottom.toFixed(2)}-${z.zoneTop.toFixed(2)} ATR=${z.atr.toFixed(2)} struct=${z.structuralScore} (نفسي=${z.roundNumber ? 2 : 0} مؤكد=${z.confirmedPivot ? 2 : 0} ذيل كبير=${z.bigWick ? 1 : 0} عمر=${AGE_PTS[z.tf as ZoneTf]}) live=${live} state=${z.state}`);
}
console.log('\ncounters:', JSON.stringify(eng.counters));
