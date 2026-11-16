// ============================================================
// اختبار استقرار الباك تيست — يثبت أن الأرقام لا تتغير تلقائياً
// ------------------------------------------------------------
// يشغّل المسار الإنتاجي الكامل (الجسر → المخزن → كاش اللقطات →
// المحرك) مرتين في عمليتين منفصلتين، ويطبع بصمة النتيجة (sha256)
// — تطابق البصمتين بين التشغيلين = النتيجة حتمية تماماً.
// التشغيل: cd bfx-work && DATABASE_URL="file:./db/custom.db" bun scripts/verify-backtest-stability.ts
// ============================================================
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ingestMt5, mt5Feed } from '../src/lib/server/mt5feed';
import { runBacktestCached, resolveWindow } from '../src/lib/server/backtestCache';
import { loadBotSettings } from '../src/lib/server/backtestRunner';

const SNAP = 'db/mt5-feed-snapshot.json.gz';

async function main(): Promise<void> {
  // 1) إدخال لقطة الشموع الحقيقية عبر نفس مسار الجسر الإنتاجي
  const raw = gunzipSync(readFileSync(SNAP));
  const snap = JSON.parse(raw.toString('utf8')) as { tfs: Record<string, unknown[]>; symbol?: string; broker?: string; bridgeV?: number };
  const res = ingestMt5({ tfs: snap.tfs, symbol: snap.symbol, broker: snap.broker, v: snap.bridgeV ?? 21 });
  const feed = mt5Feed();
  const c5 = feed.tfs['5m'] ?? [];
  console.log(`[feed] دفعات مقبولة: stored=${res.stored} — شموع 5m: ${c5.length}`);
  console.log(`[feed] المدى: ${new Date(c5[0].t).toISOString()} ← ${new Date(c5[c5.length - 1].t).toISOString()}`);

  // 2) الإعدادات من البذرة المعتمدة (نفس ما يحدث على Render بعد إعادة النشر)
  const settings = await loadBotSettings();
  const enabled = Object.entries(settings.strategyParams as Record<string, { enabled?: boolean }>)
    .filter(([, v]) => v?.enabled !== false).map(([k]) => k).sort().join(',');
  console.log(`[settings] الاستراتيجيات المفعلة: ${enabled}`);

  // 3) النافذة المثبتة — يجب أن تكون ثابتة ولا تشمل اليوم الجاري
  const w = resolveWindow(null);
  if (!w) { console.error('فشل تحديد النافذة'); process.exit(1); }
  console.log(`[window] كل التاريخ: ${new Date(w.reportFrom).toISOString()} ← ${new Date(w.reportTo).toISOString()} (دائم=${w.permanent})`);

  // 4) الباك تيست الكامل — نفس النداء الإنتاجي (بلا أخبار: كما في التسخين)
  const r1 = runBacktestCached(null, settings, []);
  if (!r1.ok) { console.error(`فشل: ${r1.reason}`); process.exit(1); }
  const s = r1.stats;
  console.log('--- نتيجة «كل التاريخ» (النافذة المثبتة) ---');
  console.log(`صافي الربح: ${s.netPnl.toFixed(2)}$ | الصفقات: ${s.totalTrades} | النجاح: ${s.winRate.toFixed(1)}% | PF: ${s.profitFactor.toFixed(2)} | أقصى تراجع: ${s.maxDrawdownPct.toFixed(1)}%`);
  console.log(`نافذة الإحصاء الفعلية: ${new Date(s.startT).toISOString()} ← ${new Date(s.endT).toISOString()}`);
  console.log(`مدة التنفيذ: ${r1.ms}ms (بنى اللقطة=${r1.built})`);

  // 5) باك تيست سنة منتهية (2025) — يجب أن يكون دائماً ولمرة واحدة
  const r2 = runBacktestCached(2025, settings, []);
  if (!r2.ok) { console.error(`فشل 2025: ${r2.reason}`); process.exit(1); }
  const s2 = r2.stats;
  console.log('--- نتيجة 2025 (سنة منتهية) ---');
  console.log(`صافي الربح: ${s2.netPnl.toFixed(2)}$ | الصفقات: ${s2.totalTrades} | PF: ${s2.profitFactor.toFixed(2)}`);

  // 6) إعادة تشغيل فورية (كاش اللقطة) — يجب تطابق الأرقام حرفياً
  const r3 = runBacktestCached(null, settings, []);
  if (!r3.ok) { console.error('فشل إعادة التشغيل'); process.exit(1); }
  const sigOf = (x: { stats: Record<string, unknown>; trades: { id: number; strategy: string; entryT: number; exitT: number; entry: number; exit: number; pnl: number }[] }): string =>
    createHash('sha256').update(JSON.stringify({
      n: x.stats.netPnl, t: x.stats.totalTrades, wr: x.stats.winRate, pf: x.stats.profitFactor,
      dd: x.stats.maxDrawdownPct, r: x.stats.totalR,
      tr: x.trades.map(t => [t.id, t.strategy, t.entryT, t.exitT, t.entry, t.exit, t.pnl]),
    })).digest('hex').slice(0, 16);
  const sig1 = sigOf(r1 as never), sig3 = sigOf(r3 as never);
  console.log(`[determinism] تشغيل1=${sig1} إعادة=${sig3} → ${sig1 === sig3 ? 'متطابقان ✓' : 'مختلفان ✗ فشل!'}`);
  if (sig1 !== sig3) process.exit(2);

  // 7) بصمة العملية لل مقارنة بين التشغيلات المنفصلة
  console.log(`[signature] ${sig1}`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
