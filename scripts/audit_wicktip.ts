// ============================================================
// فحص التزام محرك «مناطق الذيل» v1.0 بالمواصفة — تشغيل حقيقي على شموع MT5
// يطبع: الإحصاءات + أسباب الرفض + عيّنة صفقات + ATR(M5/M15) الأخير لتقييم بوابة السبريد
// ============================================================
import { loadData, runBacktest, aggregate, aggregateWeekly, aggregateMonthly } from '../src/lib/engine/backtest';
import type { Candle } from '../src/lib/engine/types';
import { WICKTIP_CFG } from '../src/lib/engine/wicktip';

const snap = JSON.parse(await Bun.file('db/mt5-feed-snapshot.json').text());
const toCandles = (rows: unknown[][]): Candle[] =>
  rows.map(r => ({ t: r[0] as number, o: r[1] as number, h: r[2] as number, l: r[3] as number, c: r[4] as number, v: r[5] as number }));

const raw: Record<string, Candle[]> = {};
for (const tf of ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const) {
  const arr = snap.tfs[tf];
  if (arr?.length) raw[tf] = toCandles(arr);
}
console.log('TF counts:', Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.length])));

const data = loadData(raw);
const settings = { lot: 0.01, spreadCents: 30 };

// ---------- باك تيست 2025 (نافذة التقرير: سنة 2025) ----------
const from2025 = Date.UTC(2025, 0, 1);
const to2025 = Date.UTC(2026, 0, 1) - 1;
const r = runBacktest(data, settings, Date.now(), { fromT: from2025, toT: to2025 });

const s = r.stats;
console.log('\n===== باك تيست 2025 (المواصفة الحرفية) =====');
console.log('trades:', s.totalTrades, '| wins:', s.wins, '| losses:', s.losses, '| winRate:', s.winRate.toFixed(1) + '%');
console.log('netPnl:', s.netPnl.toFixed(2), '| PF:', s.profitFactor.toFixed(2), '| maxDD:', s.maxDrawdown.toFixed(2), `(${s.maxDrawdownPct.toFixed(1)}%)`);
console.log('totalR:', s.totalR, '| avgR:', s.avgR);
console.log('zones formed:', s.zones.formed, '| invalidated:', s.zones.dead, '| rejections:', s.zones.strongRejections);
console.log('signals (confirms):', s.signalsCount, '| blocked total:', s.fillsBlocked);
console.log('blocked reasons:', JSON.stringify(s.blocked, null, 2));
console.log('perTf:', JSON.stringify(s.perTf, null, 2));

// ---------- ATR الأخير على M15/M5 لتقييم بوابة السبريد ----------
const atrOf = (arr: Candle[]): number => {
  let atr = 0, init = 0, prevC: number | null = null;
  for (const c of arr) {
    const tr = prevC === null ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - prevC), Math.abs(c.l - prevC));
    prevC = c.c;
    if (init < WICKTIP_CFG.ATR_PERIOD) { init++; atr += (tr - atr) / init; }
    else atr = (atr * (WICKTIP_CFG.ATR_PERIOD - 1) + tr) / WICKTIP_CFG.ATR_PERIOD;
  }
  return atr;
};
const atr15 = atrOf(raw['15m'].slice(-200));
const atr5 = atrOf(raw['5m'].slice(-500));
console.log('\n===== بوابة السبريد (رفض 7) =====');
console.log('spread ثابت بالباك تيست:', (settings.spreadCents / 100).toFixed(2) + '$');
console.log('ATR(M15) الأخير:', atr15.toFixed(2), '→ الحد 0.05×ATR =', (0.05 * atr15).toFixed(3) + '$', settings.spreadCents / 100 > 0.05 * atr15 ? '⛔ أعلى من السبريد' : '✅');
console.log('ATR(M5) الأخير:', atr5.toFixed(2), '→ الحد 0.05×ATR =', (0.05 * atr5).toFixed(3) + '$', settings.spreadCents / 100 > 0.05 * atr5 ? '⛔ أعلى من السبريد' : '✅');

// ---------- عينة صفقات ----------
console.log('\n===== عينة صفقات (آخر 5) =====');
for (const t of r.trades.slice(-5)) {
  console.log(`#${t.id} ${t.dir} entry=${t.entry} sl=${t.sl} tp=${t.tp} rr=${t.rr} zone=${t.zoneTf}#${t.zoneId} score=${t.score} dist=${t.distance} confirm=${t.confirmationType}@${t.confirmTf} result=${t.result} pnl=${t.pnl?.toFixed(2)}`);
}
console.log('\n=== عينة سجل القرارات (آخر 8) ===');
for (const d of r.decisionLog.slice(-8)) console.log(d.line);
