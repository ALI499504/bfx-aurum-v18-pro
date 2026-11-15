// اختبار A/B على شموع MT5 الحقيقية (لقطة الجسر من القرص)
// 1) تحليل شرائح: درجة الجودة × الربحية، نطاق 6 ساعات × الربحية
// 2) مقارنة سيناريوهات الفلاتر لاختيار الافتراضيات المثلى
import { PrismaClient } from '@prisma/client';
import { loadData, runBacktest, EngineData } from '../src/lib/engine/backtest';
import { DEFAULT_SETTINGS, Settings } from '../src/lib/engine/rules';
import { mt5Feed } from '../src/lib/server/mt5feed';
import type { Candle } from '../src/lib/engine/types';

const db = new PrismaClient();
const PIP = 0.1;
function fmt(n: number) { return (Math.round(n * 100) / 100).toString(); }

async function loadSettings(): Promise<Settings> {
  const row = await (db as any).botSettings.findUnique({ where: { key: 'main' } });
  if (!row) return DEFAULT_SETTINGS as unknown as Settings;
  const saved = JSON.parse(row.json);
  return {
    ...DEFAULT_SETTINGS, ...saved,
    globalRules: { ...DEFAULT_SETTINGS.globalRules, ...(saved.globalRules ?? {}) },
    sessions: { ...DEFAULT_SETTINGS.sessions, ...(saved.sessions ?? {}) },
    indicators: { ...DEFAULT_SETTINGS.indicators, ...(saved.indicators ?? {}) },
    manualLevels: { ...DEFAULT_SETTINGS.manualLevels, ...(saved.manualLevels ?? {}) },
    priority: saved.priority?.length === 3 ? saved.priority : DEFAULT_SETTINGS.priority,
  } as unknown as Settings;
}

function buildData(): EngineData | null {
  const s = mt5Feed();
  const raw: Record<string, Candle[]> = {};
  for (const tf of ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']) {
    const arr = s.tfs[tf];
    if (arr && arr.length) raw[tf] = arr as Candle[];
  }
  if (!raw['5m'] || raw['5m'].length < 250) return null;
  return loadData(raw);
}

function variant(base: Settings, patch: { chop?: boolean; chopV?: number; gate?: boolean; gateV?: number; risk?: boolean; wfOff?: boolean }): Settings {
  const s = JSON.parse(JSON.stringify(base));
  if (patch.chop !== undefined) s.globalRules.chop_filter = { enabled: patch.chop, value: patch.chopV ?? 60 };
  if (patch.gate !== undefined) s.globalRules.quality_gate = { enabled: patch.gate, value: patch.gateV ?? 56 };
  if (patch.risk !== undefined) s.globalRules.risk_sizing = { enabled: patch.risk, value: 1.0 };
  return s as Settings;
}

function brief(label: string, r: ReturnType<typeof runBacktest>) {
  const st = r.stats;
  console.log(
    `${label.padEnd(30)} | صفقات=${String(st.totalTrades).padStart(4)} | WR=${fmt(st.winRate).padStart(5)}% | صافي=${fmt(st.netPnl).padStart(8)}$ | PF=${fmt(st.profitFactor).padStart(5)} | DD=${fmt(st.maxDrawdownPct).padStart(6)}% | OOS=${fmt(st.oos.winRate).padStart(5)}%`
  );
  return st;
}

// نطاق 6 ساعات (بيب) عند لحظة الدخول — من شموع 1h
function rng6hAt(c1h: Candle[], t: number): number | null {
  let idx = -1, lo = 0, hi = c1h.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (c1h[mid].t + 3600e3 <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx < 5) return null;
  let h = -Infinity, l = Infinity;
  for (let j = idx - 5; j <= idx; j++) { h = Math.max(h, c1h[j].h); l = Math.min(l, c1h[j].l); }
  return (h - l) / PIP;
}

async function main() {
  const data = buildData();
  if (!data) { console.log('لا توجد بيانات حقيقية كافية في لقطة الجسر'); return; }
  const c5 = (data as any).c5;
  const c1h = (data as any).c1h;
  console.log(`الفترة: ${new Date(c5[0].t).toISOString().slice(0, 10)} → ${new Date(c5[c5.length - 1].t).toISOString().slice(0, 10)} | شموع 5m: ${c5.length}`);

  const base = await loadSettings();

  // ===== 1) الخط الأساسي مع تسجيل درجات كل صفقة =====
  console.log('\n== الخط الأساسي (كل الفلاتر الجديدة مطفأة) ==');
  const baseRun = runBacktest(data, variant(base, { chop: false, gate: false, risk: false }));
  brief('خط الأساس', baseRun);

  console.log('\n== شرائح درجة الجودة × الربحية (خط الأساس) ==');
  const bands: [number, number][] = [[40, 55.9], [55.9, 58.9], [58.9, 63.9], [63.9, 68.9], [68.9, 100]];
  for (const [a, b] of bands) {
    const ts = baseRun.trades.filter(t => (t.score ?? 0) >= a && (t.score ?? 0) < b);
    if (!ts.length) continue;
    const net = ts.reduce((x, t) => x + t.pnl, 0);
    const w = ts.filter(t => t.pnl > 0).length;
    console.log(`  score ${a}-${b}: n=${ts.length} wr=${fmt(w / ts.length * 100)}% net=${fmt(net)}$ avg=${fmt(net / ts.length)}$`);
  }

  console.log('\n== شرائح نطاق 6 ساعات (بيب) × الربحية ==');
  const rb: [number, number][] = [[0, 200], [200, 350], [350, 500], [500, 800], [800, 1e9]];
  for (const [a, b] of rb) {
    const ts = baseRun.trades.filter(t => { const r = rng6hAt(c1h, t.entryT); return r !== null && r >= a && r < b; });
    if (!ts.length) continue;
    const net = ts.reduce((x, t) => x + t.pnl, 0);
    const w = ts.filter(t => t.pnl > 0).length;
    console.log(`  rng6h ${a}-${b === 1e9 ? '∞' : b}: n=${ts.length} wr=${fmt(w / ts.length * 100)}% net=${fmt(net)}$ avg=${fmt(net / ts.length)}$`);
  }

  console.log('\n== شرائح ATR اليومي % × الربحية ==');
  const atrD: number[] = [];
  { const d = data.c1d;
    for (let i = 0; i < d.length; i++) {
      if (i < 14) { atrD.push(NaN); continue; }
      let s2 = 0;
      for (let j = i - 13; j <= i; j++) {
        const pc = j > 0 ? d[j - 1].c : d[j].o;
        s2 += Math.max(d[j].h - d[j].l, Math.abs(d[j].h - pc), Math.abs(d[j].l - pc));
      }
      atrD.push(s2 / 14 / d[i].c * 100);
    }
  }
  const atrAt = (t: number): number | null => {
    let idx = -1, lo = 0, hi = data.c1d.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (data.c1d[mid].t + 86400e3 <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    return idx >= 0 ? atrD[idx] : null;
  };
  const ab: [number, number][] = [[0, 1.2], [1.2, 1.8], [1.8, 2.5], [2.5, 3.5], [3.5, 100]];
  for (const [a, b] of ab) {
    const ts = baseRun.trades.filter(t => { const r = atrAt(t.entryT); return r !== null && r >= a && r < b; });
    if (!ts.length) continue;
    const net = ts.reduce((x, t) => x + t.pnl, 0);
    const w = ts.filter(t => t.pnl > 0).length;
    console.log(`  ATR% ${a}-${b}: n=${ts.length} wr=${fmt(w / ts.length * 100)}% net=${fmt(net)}$ avg=${fmt(net / ts.length)}$`);
  }

  // ===== 2) سيناريوهات =====
  console.log('\n== السيناريوهات ==');
  brief('chop فقط 60', runBacktest(data, variant(base, { chop: true, chopV: 60, gate: false, risk: false })));
  brief('chop فقط 150', runBacktest(data, variant(base, { chop: true, chopV: 150, gate: false, risk: false })));
  brief('chop فقط 250', runBacktest(data, variant(base, { chop: true, chopV: 250, gate: false, risk: false })));
  brief('chop فقط 350', runBacktest(data, variant(base, { chop: true, chopV: 350, gate: false, risk: false })));
  brief('gate فقط 52', runBacktest(data, variant(base, { chop: false, gate: true, gateV: 52, risk: false })));
  brief('gate فقط 56', runBacktest(data, variant(base, { chop: false, gate: true, gateV: 56, risk: false })));
  brief('gate فقط 60', runBacktest(data, variant(base, { chop: false, gate: true, gateV: 60, risk: false })));
  brief('gate فقط 64', runBacktest(data, variant(base, { chop: false, gate: true, gateV: 64, risk: false })));
  brief('risk فقط 1%', runBacktest(data, variant(base, { chop: false, gate: false, risk: true })));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
