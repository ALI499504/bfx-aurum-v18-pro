// تشخيص I: جلسات + أرباع سنوية + اختبار قتل الجلسة الخاسرة (سلّم الترقية)
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';
import type { Settings } from '../src/lib/engine/rules';

const base = await loadBotSettings();
const realNews = await loadRealNews();

const clone = (): Settings => structuredClone(base) as Settings;
const setEnabled = (s: Settings, code: string, on: boolean) => {
  const node = (s.strategyParams as Record<string, { enabled?: boolean } | undefined> | undefined)?.[code];
  if (node) node.enabled = on;
};

const r = runBacktestCached(null, (() => { const s = clone(); setEnabled(s, 'I', true); return s; })(), realNews);
if (!r.ok) throw new Error(r.reason);
const trades = r.trades as { strategy: string; session: string; pnl: number; entryT: number }[];
const iT = trades.filter(t => t.strategy === 'I');
console.log(`I: ${iT.length} صفقة، صافي ${iT.reduce((s, t) => s + t.pnl, 0).toFixed(2)}$`);

console.log('\n--- I حسب الجلسة ---');
const bySess = new Map<string, { n: number; net: number; wins: number; gw: number; gl: number }>();
for (const t of iT) {
  const a = bySess.get(t.session) ?? { n: 0, net: 0, wins: 0, gw: 0, gl: 0 };
  a.n++; a.net += t.pnl;
  if (t.pnl > 0) { a.wins++; a.gw += t.pnl; } else a.gl += -t.pnl;
  bySess.set(t.session, a);
}
for (const [s, a] of [...bySess.entries()].sort((x, y) => y[1].net - x[1].net)) {
  const pf = a.gl > 0 ? (a.gw / a.gl).toFixed(2) : '99';
  console.log(`${s.padEnd(10)} | ${String(a.n).padStart(5)} | ${a.net.toFixed(2).padStart(9)}$ | نجاح ${((a.wins / a.n) * 100).toFixed(1)}% | PF ${pf}`);
}

console.log('\n--- I حسب الربع (آخر 4 أرباع) ---');
const byQ = new Map<string, { n: number; net: number }>();
for (const t of iT) {
  const d = new Date(t.entryT);
  const q = `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  const a = byQ.get(q) ?? { n: 0, net: 0 };
  a.n++; a.net += t.pnl;
  byQ.set(q, a);
}
for (const [q, a] of [...byQ.entries()].sort()) console.log(`${q} | ${String(a.n).padStart(5)} | ${a.net.toFixed(2).padStart(9)}$`);

// اختبار: قتل أسوأ جلسة/جلساتين لـ I (مع D المخففة كما في السيناريو الرابح)
const worst = [...bySess.entries()].sort((x, y) => x[1].net - y[1].net).slice(0, 1).map(([s]) => s);
console.log(`\n--- سيناريو: تعطيل جلسة I الأسوأ: ${worst.join(',')} + D/Q المخففة ---`);
const s4 = clone();
setEnabled(s4, 'I', true);
const sp = s4.strategyParams as Record<string, Record<string, unknown>>;
sp.D.gapMinPips = 8; sp.D.bodyBreakMin = 40; sp.D.totalMin = 80;
sp.Q.wickMinPips = 60; sp.Q.asiaOpenMinPips = 150; sp.Q.isolationPips = 100;
for (const cs of ['main', 's1', 's2', 'waveMin', 'waveMax', 'c1', 'c2'] as string[]) {
  const node = (sp.I as Record<string, unknown>)[cs];
  if (node && typeof node === 'object') {
    const t2 = node as Record<string, { asia?: boolean; london?: boolean; londonNY?: boolean; ny?: boolean }>;
    for (const sk of ['s1', 's2']) {
      const g = (t2 as Record<string, unknown>)[sk] as Record<string, boolean> | undefined;
      if (g) for (const w of worst) g[w] = false;
    }
  }
}
// إسقاط الجلسة القاتلة على بوابة scenarioSessions أيضاً إن وُجدت
const ss = (s4 as unknown as { scenarioSessions?: Record<string, Record<string, Record<string, Record<string, Record<string, boolean>>>>> }).scenarioSessions;
if (ss?.I) {
  for (const cs of Object.keys(ss.I)) {
    for (const sk of ['s1', 's2']) {
      const g = ss.I[cs]?.[sk];
      if (g) for (const w of worst) g[w] = false;
    }
  }
}
const r4 = runBacktestCached(null, s4, realNews);
if (!r4.ok) throw new Error(r4.reason);
const st4 = r4.stats;
const t4 = r4.trades as { strategy: string; pnl: number }[];
const i4 = t4.filter(t => t.strategy === 'I');
console.log(`S4: ${st4.totalTrades} صفقة | صافي ${st4.netPnl.toFixed(2)}$ | PF ${st4.profitFactor.toFixed(3)} | نجاح ${st4.winRate.toFixed(1)}% | DD ${st4.maxDrawdownPct.toFixed(1)}%`);
console.log(`I بعد القتل: ${i4.length} صفقة، صافي ${i4.reduce((s, t) => s + t.pnl, 0).toFixed(2)}$`);
