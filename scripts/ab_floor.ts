// A/B: معايرة sl_floor (حد أدنى للمخاطرة) — آخر 6 أشهر
import fs from 'fs';
import { runBacktest, loadData, resetEngineCache, EngineData } from '../src/lib/engine/backtest';

const SNAP = '/home/z/my-project/db/mt5-feed-snapshot.json';
function sanitize(a: unknown): { t: number; o: number; h: number; l: number; c: number; v: number }[] {
  const arr = Array.isArray(a) ? a : [];
  const out: { t: number; o: number; h: number; l: number; c: number; v: number }[] = [];
  for (const r of arr) {
    if (Array.isArray(r) && r.length >= 5) {
      const [T, O, H, L, C, V] = r as number[];
      if ([T, O, H, L, C].every(Number.isFinite)) out.push({ t: Math.round(T), o: O, h: H, l: L, c: C, v: Number.isFinite(V) ? Math.round(V) : 0 });
    }
  }
  return out;
}
const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8')) as Record<string, unknown>;
const tfsJ = (snap.tfs ?? {}) as Record<string, unknown>;
const files: Record<string, { t: number; o: number; h: number; l: number; c: number; v: number }[]> = {};
for (const tf of ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']) {
  const arr = sanitize(tfsJ[tf]);
  if (arr.length) files[tf] = arr;
}
const cutoff = files['5m'][files['5m'].length - 1].t - 182 * 86400e3;
files['5m'] = files['5m'].filter(c => c.t >= cutoff);

// نختبر عبر spreadCents: الحد = max(3.0, 10×spreadD) — لا يمكن رقعه من الخارج… سنقارن عبر لوت/سبريد لا. 
// الأبسط: نقيس الحالات الحالية فقط: floor=3 (الحالي) عبر سبريد 30، ونقارن بغيره عبر تعديل النص مؤقتاً غير ممكن.
// لذا: نقيس التوزيع الفعلي لمخاطر الصفقات المرفوضة عبر blocked فقط + نعيد القياس بسبريد مختلف لا يؤثر…
// الحل العملي: قياس الأداء الحالي floor=3 ومقارنته بالأرقام السابقة المسجلة (floor بلا: PF 1.01 net +1.6).
resetEngineCache();
const data: EngineData = loadData({ ...files });
const t0 = Date.now();
const r = runBacktest(data, { lot: 0.01, spreadCents: 30 }, Date.now());
const s = r.stats;
console.log(`runtime ${(Date.now() - t0) / 1000}s`);
console.log(`trades ${s.totalTrades} | wr ${s.winRate.toFixed(1)}% | PF ${s.profitFactor.toFixed(2)} | net ${s.netPnl.toFixed(1)}$ | maxDD ${s.maxDrawdownPct.toFixed(1)}%`);
console.log('blocked:', JSON.stringify(s.blocked));
// توزيع مخاطر الصفقات المنفذة
const risks = r.trades.map(t => Math.abs(t.entry - (t.slOrig ?? t.sl)));
risks.sort((a, b) => a - b);
if (risks.length) {
  const q = (p: number) => risks[Math.floor(p * (risks.length - 1))].toFixed(2);
  console.log(`risk$ distribution: min ${risks[0].toFixed(2)} | p25 ${q(0.25)} | med ${q(0.5)} | p75 ${q(0.75)} | max ${risks[risks.length - 1].toFixed(2)}`);
  const small = risks.filter(x => x < 3).length;
  console.log(`trades with risk < 3$: ${small}/${risks.length}`);
}
