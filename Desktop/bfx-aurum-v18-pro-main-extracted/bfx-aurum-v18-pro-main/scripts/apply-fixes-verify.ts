// ============================================================
// سلّم الترقية — الدرجة الأولى: محاكاة كاملة للمحفظة قبل/بعد
// تطبيق إصلاحات خطة تحويل الفشل إلى نجاح (تقرير التشريح، الفصل السادس)
//
// سيناريوهات مفكّكة (كل إصلاح يُقاس منفرداً ثم الحزمة):
//   S0 قبل     : حالة ما بعد بوابتا 26/27 الأصليتين — بلا إصلاحات الدخول، وG خارج بوابة الكفاءة
//   S1 دخول    : الدخول عند الاختبار المباشر (A/B/G/N/P/J = 0) — وحدها
//   S3 كفاءة G : انضمام G إلى بوابة الهدوء ER — وحده
//   S4 النشر   : الحزمة الكاملة المعتمدة (دخول + كفاءة G) — بلا احتجاز وقت تشغيل
//   + معاينة قرارات المدير الآلي (قاعدتا 29 عينة الحكم و2 بوابة السبريد) على صفقات النشر
// ملاحظة: الاحتجاز وقت التشغيل لبوابة السبريد قُيّم منفرداً ورفضت المحاكاة أثره
// (-1,016$ عبر إطلاق إشارات W الخام عند إفلات U من سقف اليوم) — لذلك يُنفَّذ
// القاعدة 2 في المدير الآلي (اختبار ما قبل التفعيل) لا كاحتجاز وقت تشغيل.
// التشغيل: bun scripts/apply-fixes-verify.ts
// ============================================================
import { readFileSync, writeFileSync } from 'fs';
import { runBacktest, loadData, resetEngineCache, EngineData } from '../src/lib/engine/backtest';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';
import { computeAutoDecisions } from '../src/lib/engine/autoManager';
import { Settings } from '../src/lib/engine/rules';
import type { Candle } from '../src/lib/engine/types';
import type { TamsaParams } from '../src/lib/engine/tamsa-params';

const SNAP = '/home/z/my-project/db/mt5-feed-snapshot.json';

function loadSnap(): EngineData {
  const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
  const raw: Record<string, Candle[]> = {};
  for (const [tf, arr] of Object.entries(snap.tfs as Record<string, unknown[]>)) {
    raw[tf] = (arr as unknown[]).map((c) =>
      Array.isArray(c) ? { t: c[0], o: c[1], h: c[2], l: c[3], c: c[4], v: c[5] ?? 0 } : c,
    ) as Candle[];
  }
  resetEngineCache();
  return loadData(raw);
}

/** قيم ما قبل الخطة (تقرير التشريح) — لاستعادة السلوك الأصلي في السيناريو القبلي */
function revertEntryParams(p: TamsaParams): void {
  p.A.entryPips = 30;
  p.B.entryPips = 30;
  p.G.revEntryPips = 40;
  p.N.exec.revEntryPips = 20;
  p.P.entryPips = 20;
  p.J.exec.entryPips = 20;
}

/** قيم ما بعد الخطة — تأكيد صريح (الحماية من أي قيم قديمة في قاعدة الإعدادات) */
function applyEntryFixes(p: TamsaParams): void {
  p.A.entryPips = 0;
  p.B.entryPips = 0;
  p.G.revEntryPips = 0;
  p.N.exec.revEntryPips = 0;
  p.P.entryPips = 0;
  p.J.exec.entryPips = 0;
}

interface Agg { n: number; net: number; wins: number; gw: number; gl: number }

function aggTrades(trades: { strategy: string; pnl: number }[]): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const t of trades) {
    const a = m.get(t.strategy) ?? { n: 0, net: 0, wins: 0, gw: 0, gl: 0 };
    a.n++; a.net += t.pnl;
    if (t.pnl > 0) { a.wins++; a.gw += t.pnl; } else if (t.pnl < 0) a.gl += -t.pnl;
    m.set(t.strategy, a);
  }
  return m;
}

const pfOf = (a: Agg) => (a.gl > 0 ? a.gw / a.gl : a.gw > 0 ? 99 : 0);
const f2 = (n: number) => n.toFixed(2);
const pad = (s: string, w: number) => s.padEnd(w);

async function main() {
  const t0 = Date.now();
  const data = loadSnap();
  const c5 = data.c5;
  console.log(`البيانات: ${c5.length.toLocaleString()} شمعة 5m (${new Date(c5[0].t).toISOString().slice(0, 10)} → ${new Date(c5[c5.length - 1].t).toISOString().slice(0, 10)})`);

  const base = await loadBotSettings();
  const realNews = await loadRealNews();
  console.log(`الإعدادات من قاعدة البيانات + أخبار حقيقية: ${realNews.length} حدث`);

  const mk = (): Settings => structuredClone(base) as Settings;
  const setG = (s: Settings, key: string, enabled: boolean, value = 0) => {
    (s.globalRules as Record<string, unknown>)[key] = { enabled, value };
  };
  const setErIncludeG = (s: Settings, v: boolean) => {
    (s.globalRules as Record<string, unknown>)['__erIncludeG'] = v;
  };

  // S0 قبل: بلا إصلاحات الدخول + G خارج بوابة الكفاءة + بلا احتجاز وقت تشغيل
  const s0 = mk();
  setG(s0, 'gate_spread_guard', false);
  setErIncludeG(s0, false);
  revertEntryParams(s0.strategyParams);

  // S1 إصلاحات الدخول وحدها
  const s1 = mk();
  setG(s1, 'gate_spread_guard', false);
  setErIncludeG(s1, false);
  applyEntryFixes(s1.strategyParams);

  // S3 كفاءة G وحدها
  const s3 = mk();
  setG(s3, 'gate_spread_guard', false);
  setErIncludeG(s3, true);
  revertEntryParams(s3.strategyParams);

  // S4 الحزمة الكاملة المعتمدة (النشر): دخول + كفاءة G — بلا احتجاز وقت تشغيل
  const s4 = mk();
  setG(s4, 'gate_spread_guard', false);
  setErIncludeG(s4, true);
  applyEntryFixes(s4.strategyParams);

  const scenarios: { key: string; label: string; s: Settings }[] = [
    { key: 'S0', label: 'قبل (ما بعد بوابتي 26/27)', s: s0 },
    { key: 'S1', label: 'دخول عند الاختبار (A/B/G/N/P/J)', s: s1 },
    { key: 'S3', label: 'كفاءة G (ER<0.30)', s: s3 },
    { key: 'S4', label: 'النشر: الحزمة المعتمدة', s: s4 },
  ];

  const runs = scenarios.map(({ key, label, s }) => {
    const t = Date.now();
    const r = runBacktest(data, s, Date.now(), realNews.map(n => ({ t: n.t, name: n.name })));
    console.log(`[${key}] ${label}: ${r.stats.totalTrades} صفقة — ${((Date.now() - t) / 1000).toFixed(1)}s`);
    return { key, label, r };
  });

  const aggs = runs.map(x => aggTrades(x.r.trades));
  const ids = [...new Set(runs.flatMap(x => [...aggTrades(x.r.trades).keys()]))].sort();

  console.log('\n=== صافي كل استراتيجية عبر السيناريوهات (USD) ===');
  console.log(['الرمز', ...runs.map(x => x.key)].join(' | '));
  for (const id of ids) {
    console.log([pad(id, 4), ...aggs.map(a => pad(f2(a.get(id)?.net ?? 0), 9))].join(' | '));
  }

  console.log('\n=== الإجمالي ===');
  console.log(`${pad('', 10)} | ${runs.map(x => pad(x.key, 9)).join(' | ')}`);
  console.log(`${pad('صافي', 10)} | ${runs.map(x => pad(f2(x.r.stats.netPnl), 9)).join(' | ')}`);
  console.log(`${pad('صفقات', 10)} | ${runs.map(x => pad(String(x.r.stats.totalTrades), 9)).join(' | ')}`);
  console.log(`${pad('PF', 10)} | ${runs.map(x => pad(x.r.stats.profitFactor.toFixed(2), 9)).join(' | ')}`);
  console.log(`${pad('نجاح%', 10)} | ${runs.map(x => pad(x.r.stats.winRate.toFixed(1), 9)).join(' | ')}`);
  console.log(`${pad('أقصىDD%', 10)} | ${runs.map(x => pad(x.r.stats.maxDrawdownPct.toFixed(1), 9)).join(' | ')}`);
  console.log(`${pad('Δ عن S0', 10)} | ${runs.map((x, i) => pad(i === 0 ? '0.00' : (x.r.stats.netPnl - runs[0].r.stats.netPnl >= 0 ? '+' : '') + f2(x.r.stats.netPnl - runs[0].r.stats.netPnl), 9)).join(' | ')}`);

  const gb = runs[3].r.stats.gateBlockedByStrat;
  if (gb) {
    console.log('\n=== شفافية البوابات في النشر (S4) ===');
    console.log('بوابة الاتجاه اليومي (26):', JSON.stringify(gb.dailyTrend));
    console.log('بوابة الكفاءة (27):', JSON.stringify(gb.erQuiet));
  }

  // ---------- معاينة قرارات المدير الآلي على صفقات النشر (قاعدتا 29 و2) ----------
  const deployTrades = runs[3].r.trades as unknown as { strategy: string; session: string; pnl: number; result: string }[];
  const { decisions } = computeAutoDecisions(deployTrades, {
    spreadCostPerTrade: 0.30,
    spreadGuardFactor: 1,
    minSample: 30,
  });
  console.log('\n=== معاينة المدير الآلي (قاعدة 29 عينة الحكم + قاعدة 2 بوابة السبريد) ===');
  for (const d of decisions.filter(d => d.kind !== 'note' || d.metrics.trades > 0)) {
    console.log(`[${d.kind}] ${d.strategy}: ${d.reason}`);
  }

  // ---------- حفظ النتيجة ----------
  const out = {
    runAt: new Date().toISOString(),
    window: { from: new Date(c5[0].t).toISOString(), to: new Date(c5[c5.length - 1].t).toISOString(), candles5m: c5.length },
    scenarios: runs.map((x, i) => ({
      key: x.key, label: x.label,
      trades: x.r.stats.totalTrades, net: Math.round(x.r.stats.netPnl * 100) / 100,
      pf: Math.round(x.r.stats.profitFactor * 100) / 100, wr: Math.round(x.r.stats.winRate * 10) / 10,
      dd: Math.round(x.r.stats.maxDrawdownPct * 10) / 10,
      deltaVsBefore: i === 0 ? 0 : Math.round((x.r.stats.netPnl - runs[0].r.stats.netPnl) * 100) / 100,
      gateBlockedByStrat: x.r.stats.gateBlockedByStrat ?? null,
    })),
    perStrategy: Object.fromEntries(ids.map(id => [id, runs.map(x => {
      const a = aggTrades(x.r.trades).get(id);
      return a ? { n: a.n, net: Math.round(a.net * 100) / 100, pf: Math.round(pfOf(a) * 100) / 100 } : { n: 0, net: 0, pf: 0 };
    })])),
    autoManagerPreview: decisions.map(d => ({ kind: d.kind, strategy: d.strategy, reason: d.reason })),
  };
  writeFileSync('/home/z/my-project/download/fixes-before-after.json', JSON.stringify(out, null, 2));
  console.log('\nحُفظ التقرير: download/fixes-before-after.json');
  console.log(`إجمالي زمن التحقق: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
