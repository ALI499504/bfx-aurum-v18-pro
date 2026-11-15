// تشخيص قمع التصفية: توزيع المناطق حسب الفريم وعناصر القوة ومراحل السلسلة
import fs from 'fs';
import { WickTipEngine, WICKTIP_CFG, ZONE_TF_AR } from '../src/lib/engine/wicktip';
import { Candle, TF_MS } from '../src/lib/engine/types';

const snap = JSON.parse(fs.readFileSync('/home/z/my-project/db/mt5-feed-snapshot.json', 'utf8')) as Record<string, unknown>;
const tfsJ = (snap.tfs ?? {}) as Record<string, unknown>;
const get = (tf: string): Candle[] =>
  ((tfsJ[tf] ?? []) as unknown[][]).map(r => { const [T, O, H, L, C, V] = r as number[]; return { t: Math.round(T), o: O, h: H, l: L, c: C, v: Math.round(V || 0) }; });

const c1M = get('1M'), c1w = get('1w'), c1d = get('1d'), c15 = get('15m'), c5 = get('5m');

// محرك مستقل نبنيه وندفعه حتى النهاية ثم نفحص كل المناطق (حتى المُبطلة)
const eng = new WickTipEngine(c1M, c1w, c1d, c15, c5);
const lastT = c5[c5.length - 1].t + TF_MS['5m'];
for (const bar of c5) eng.advance(bar.t + TF_MS['5m']);
void lastT;

const zones = eng.zones;
console.log(`إجمالي المناطق المُراقبة: ${zones.length}`);
const by = (tf: string) => zones.filter(z => z.tf === tf);
for (const tf of ['1M', '1w', '1d'] as const) {
  const zs = by(tf);
  const alive = zs.filter(z => z.state !== 'INVALIDATED');
  console.log(`\n${ZONE_TF_AR[tf]}: ${zs.length} منطقة (${alive.length} حية الآن)`);
  for (const z of zs.slice(-6)) {
    const bits = [
      z.roundNumber ? 'رقم' : null, z.confirmedPivot ? 'مؤكد' : null, z.bigWick ? 'ذيل كبير' : null,
      `هيكلي=${z.structuralScore}`,
    ].filter(Boolean).join('، ');
    console.log(`  #${z.id} ${z.side === 'upper' ? 'علوي' : 'سفلي'} نطاق ${z.zoneBottom.toFixed(1)}–${z.zoneTop.toFixed(1)} ATR=${z.atr.toFixed(1)} ${z.state} ${bits} رفض=${z.rejections}`);
  }
}
// شموع مؤهلة لذيل ≥1×ATR لكنها رُفضت (الذيلان معاً أو الجسم قصير) — عيّنة تشخيصية
let bothWicks = 0, shortBody = 0, formed = 0;
const atrState = { atr: 0, atrInit: 0, prevC: null as number | null };
const stepAtr = (c: Candle) => {
  const tr = atrState.prevC === null ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - atrState.prevC), Math.abs(c.l - atrState.prevC));
  atrState.prevC = c.c;
  if (atrState.atrInit < 14) { atrState.atrInit++; atrState.atr += (tr - atrState.atr) / atrState.atrInit; }
  else atrState.atr = (atrState.atr * 13 + tr) / 14;
  return atrState.atrInit >= 14 ? atrState.atr : null;
};
for (const c of c1d) {
  const atr = stepAtr(c);
  if (atr === null) continue;
  const wU = c.h - Math.max(c.o, c.c), wL = Math.min(c.o, c.c) - c.l;
  if (wU >= atr && wL >= atr) bothWicks++;
  else if (wU >= atr || wL >= atr) {
    formed++;
    if (Math.abs(c.h - c.l) < 0.2 * atr) shortBody++;
  }
}
console.log(`\nاليومي: شموع بذيل مؤهل=${formed}، منها مرفوضة (الذيلان معاً)=${bothWicks}`);
console.log(`الثوابت: MIN_WICK=${WICKTIP_CFG.MIN_WICK_ATR_MULT} SCORE_MIN=${WICKTIP_CFG.SCORE_MIN} MAX_DIST=${WICKTIP_CFG.MAX_DIST_ATR_MULT}`);
