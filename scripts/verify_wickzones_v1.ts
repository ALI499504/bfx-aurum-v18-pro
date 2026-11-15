// ============================================================
// تدقيق التزام محرك «مناطق الذيل» v1.0 بالمواصفة — على البيانات الحقيقية
// يشغّل الباك تيست ويطبق فحوصات التزام صارمة على كل صفقة منتجة.
// ============================================================
import fs from 'fs';
import { runBacktest, loadData, EngineData } from '../src/lib/engine/backtest';
import { Candle } from '../src/lib/engine/types';
import { WICKTIP_CFG } from '../src/lib/engine/wicktip';

const SNAP = '/home/z/my-project/db/mt5-feed-snapshot.json';

function sanitize(a: unknown): Candle[] {
  const arr = Array.isArray(a) ? a : [];
  const out: Candle[] = [];
  for (const r of arr) {
    if (Array.isArray(r) && r.length >= 5) {
      const [T, O, H, L, C, V] = r as number[];
      if ([T, O, H, L, C].every(Number.isFinite)) {
        out.push({ t: Math.round(T), o: O, h: H, l: L, c: C, v: Number.isFinite(V) ? Math.round(V) : 0 });
      }
    } else if (r && typeof r === 'object') {
      const c = r as Record<string, number>;
      if ([c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)) {
        out.push({ t: Math.round(c.t), o: c.o, h: c.h, l: c.l, c: c.c, v: Math.round(c.v ?? 0) });
      }
    }
  }
  return out;
}

const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8')) as Record<string, unknown>;
const tfsJ = (snap.tfs ?? {}) as Record<string, unknown>;
const files: Record<string, Candle[]> = {};
for (const tf of ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']) {
  const arr = sanitize(tfsJ[tf]);
  if (arr.length) files[tf] = arr;
}
console.log('الفريمات:', Object.entries(files).map(([k, v]) => `${k}=${v.length}`).join(' '));

function buildData(fromT?: number, toT?: number): EngineData {
  // فريمات المناطق بكامل تاريخها دائماً (العمر) — فريمات الإدخال مقصوصة على النافذة
  const raw: Record<string, Candle[]> = {};
  for (const tf of Object.keys(files)) {
    const zoneTf = tf === '1d' || tf === '1w' || tf === '1M';
    raw[tf] = zoneTf ? files[tf] : (fromT != null ? files[tf].filter(c => c.t >= fromT - 180 * 86400e3 && (!toT || c.t <= toT)) : files[tf]);
  }
  return loadData(raw);
}

function audit(label: string, fromT?: number, toT?: number) {
  console.log('\n' + '='.repeat(72));
  console.log(`== ${label}`);
  console.log('='.repeat(72));
  // بناء بيانات منفصلة لكل فترة (الكاش الداخلي وحيد — نستدعي loadData مرة لكل فترة عبر reset)
  const data = buildData(fromT, toT);
  const t0 = Date.now();
  const r = runBacktest(data, { lot: 0.01, spreadCents: 30 }, Date.now(),
    fromT != null ? { fromT, toT } : undefined);
  const ms = Date.now() - t0;
  const s = r.stats;

  console.log(`زمن التنفيذ: ${ms}ms`);
  console.log(`المناطق: تشكّلت ${s.zones.formed} | أُبطلت ${s.zones.dead} | رفض في الأنابيب ${s.zones.strongRejections} | مؤكدات ${s.signalsCount}`);
  console.log(`الصفقات: ${s.totalTrades} | ربح ${s.wins} | خسارة ${s.losses} | WR ${s.winRate.toFixed(1)}% | صافي ${s.netPnl.toFixed(2)}$ | PF ${s.profitFactor.toFixed(2)} | maxDD ${s.maxDrawdownPct.toFixed(1)}%`);
  console.log(`قمع الرفض:`, JSON.stringify(s.blocked));
  console.log('حسب فريم المنطقة:', Object.entries(s.perTf).map(([k, v]) => `${k}: ${v.trades} صفقة WR ${v.winRate.toFixed(0)}% صافي ${v.net.toFixed(2)}$`).join(' | '));

  // ---------- فحوصات الالتزام الصارمة ----------
  const fails: string[] = [];
  for (const t of r.trades) {
    const tag = `#${t.id}`;
    // القاعدة 6: لوج إلزامي كامل
    if (t.zoneId == null) fails.push(`${tag} zone_id مفقود`);
    if (t.score == null) fails.push(`${tag} score مفقود`);
    if (t.distance == null) fails.push(`${tag} distance مفقود`);
    if (!t.confirmationType) fails.push(`${tag} confirmation_type مفقود`);
    if (!Number.isFinite(t.entryT)) fails.push(`${tag} timestamp مفقود`);
    // 4.5: R:R >= 2
    if ((t.rr ?? 0) < WICKTIP_CFG.MIN_RR - 1e-9) fails.push(`${tag} R:R=${t.rr} أقل من ${WICKTIP_CFG.MIN_RR}`);
    // القسم 3.3: المسافة <= 3×ATR(فريم المنطقة) — نستخرج ATR من نص اللوج (stop_ref buffer 0.15×ATR)
    const m = t.reason.match(/stop_ref [\-0-9.]+ \(0\.15×ATR=([0-9.]+)\)/);
    if (m) {
      const atr = parseFloat(m[1]) / WICKTIP_CFG.BUFFER_ATR_MULT;
      const maxD = WICKTIP_CFG.MAX_DIST_ATR_MULT * atr;
      if ((t.distance ?? 0) > maxD + 1e-6) fails.push(`${tag} المسافة ${t.distance} > 3×ATR=${maxD.toFixed(2)}`);
    } else fails.push(`${tag} تعذر استخراج ATR من اللوج`);
    // القسم 5: الوقف خلف رأس الذيل (شراء: وقف تحت السعر / بيع: فوق)
    if (t.dir === 'buy' && !(t.sl < t.entry)) fails.push(`${tag} وقف شراء غير سليم`);
    if (t.dir === 'sell' && !(t.sl > t.entry)) fails.push(`${tag} وقف بيع غير سليم`);
    // الهدف باتجاه الصفقة
    if (t.dir === 'buy' && !(t.tp > t.entry)) fails.push(`${tag} هدف شراء غير سليم`);
    if (t.dir === 'sell' && !(t.tp < t.entry)) fails.push(`${tag} هدف بيع غير سليم`);
    // الوقف الثابت: لا حراك (يُفحص ضمنياً — لا حقول تعديل أصلاً)
  }
  // فحص التزامن: صفقة واحدة كحد أقصى لنفس zone_id في نفس الوقت
  const byZone = new Map<number, { s: number; e: number }[]>();
  for (const t of r.trades) {
    if (t.zoneId == null) continue;
    const arr = byZone.get(t.zoneId) ?? [];
    arr.push({ s: t.entryT, e: t.exitT });
    byZone.set(t.zoneId, arr);
  }
  for (const [zid, arr] of byZone) {
    arr.sort((a, b) => a.s - b.s);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].s < arr[i - 1].e) fails.push(`zone #${zid}: صفقتان متزامنتان (رفض 8)`);
    }
    // Cooldown: 20 شمعة على TF_ENTRY — نفحص التقريبي بالحد الأدنى (100 دقيقة لM5)
    for (let i = 1; i < arr.length; i++) {
      const gap = arr[i].s - arr[i - 1].e;
      if (gap >= 0 && gap < 20 * 300e3 - 1) fails.push(`zone #${zid}: صفقة جديدة بعد فجوة ${(gap / 60000).toFixed(0)} دقيقة < Cooldown`);
    }
  }
  console.log(fails.length ? `❌ مخالفات (${fails.length}): ${fails.slice(0, 12).join(' | ')}` : '✅ كل فحوصات الالتزام صارمة وناجحة على كل الصفقات');

  // عينة صفقات
  for (const t of r.trades.slice(0, 3)) {
    console.log(`\nمثال #${t.id}: ${t.dir} zone#${t.zoneId} score=${t.score} dist=${t.distance} confirm=${t.confirmationType}/${t.confirmTf} entry=${t.entry} sl=${t.sl} tp=${t.tp} rr=1:${t.rr} → ${t.result} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}$`);
    console.log(`  ${t.reason.slice(0, 220)}`);
  }
  return r;
}

const Y = (y: number) => Date.UTC(y, 0, 1);
audit('باك تيست 2025 كامل (على شموع حقيقية)', Y(2025), Y(2026));
audit('باك تيست كامل التاريخ المتاح', undefined, undefined);
