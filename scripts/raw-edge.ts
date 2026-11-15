// ============================================================
// قياس الحافة الخام — نسبة نجاح 1:1 بلا تأمين (TP=SL=10$)
// + تفكيك النجاح حسب نوع التأكيد (سحب سيولة مقابل BOS) والفريم والجلسة
// التشغيل: bun scripts/raw-edge.ts
// ============================================================
import { mt5Feed } from '../src/lib/server/mt5feed';
import { loadData, resetEngineCache, runBacktest } from '../src/lib/engine/backtest';
import type { EngineData } from '../src/lib/engine/backtest';
import { SMC_CFG } from '../src/lib/engine/smc';
import { DISCIPLINE } from '../src/lib/engine/discipline';
import type { Settings } from '../src/lib/engine/rules';

const settings: Settings = { lot: 0.01, spreadCents: 30 };

let data: EngineData | null = null;
function getData(): EngineData {
  if (data) return data;
  const s = mt5Feed();
  const raw: Record<string, unknown> = {};
  for (const tf of ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']) raw[tf] = s.tfs[tf];
  resetEngineCache();
  data = loadData(raw);
  return data;
}

const S = SMC_CFG as unknown as Record<string, unknown>;
const D = DISCIPLINE as unknown as Record<string, number>;

function report(name: string) {
  resetEngineCache();
  const r = runBacktest(getData(), settings, Date.now());
  const st = r.stats;
  const tr = r.trades;
  const by = (pred: (t: typeof tr[number]) => boolean) => {
    const arr = tr.filter(pred);
    const w = arr.filter(t => t.pnl > 0).length;
    return `${arr.length} صفقة، نجاح ${arr.length ? (w / arr.length * 100).toFixed(1) : '0'}%`;
  };
  console.log(`\n== ${name} ==`);
  console.log(`إجمالي: ${by(() => true)} — صافي ${st.netPnl.toFixed(1)}$ — PF ${st.profitFactor.toFixed(2)} — ≥10/يوم: ${st.discipline.summary.minTradesDays} — أعلى/يوم ${st.daily.reduce((a, d) => Math.max(a, d.trades), 0)}`);
  console.log(`  سحب سيولة (sweep): ${by(t => t.confirmationType === 'sweep')}`);
  console.log(`  كسر هيكل (BOS):    ${by(t => t.confirmationType === 'BOS')}`);
  console.log(`  تأكيد M15: ${by(t => t.confirmTf === 'M15')} — تأكيد M5: ${by(t => t.confirmTf === 'M5')}`);
  console.log(`  لندن: ${by(t => t.session === 'london' || t.session === 'londonNY')} — نيويورك: ${by(t => t.session === 'ny')}`);
  const dist: Record<string, number> = {};
  for (const t of tr) dist[t.result] = (dist[t.result] ?? 0) + 1;
  console.log(`  الخروج:`, JSON.stringify(dist));
}

// N1: خام 1:1 — بلا تأمين، بوابات صارمة
D.SL_FIX_USD = 10; D.TP_FIX_USD = 10; D.INSURE_USD = 9999;
report('N1 خام 1:1 — بوابات صارمة (أقرب + نوافذ قديمة S5 C24 TS24)');

// N2: خام 1:1 — بلا بوابة الأقرب + نوافذ متصلة
(S.NEAREST_GATE as boolean) = false;
(SMC_CFG as unknown as { KZ_LDN: [number, number] }).KZ_LDN = [6, 14];
(SMC_CFG as unknown as { KZ_NY: [number, number] }).KZ_NY = [13, 21.5];
report('N2 خام 1:1 — بلا أقرب + نوافذ 06:00-21:30');

// N3: + DISP 0.7 + score 4 + TS12 + C12 (أقصى تكرار)
D.TIME_STOP_BARS = 12;
(S.COOLDOWN as number) = 12;
(S.DISP as number) = 0.7;
(S.SCORE_MIN as number) = 4;
report('N3 خام 1:1 — أقصى تكرار (DISP0.7 S4 TS12 C12)');

// N4: N3 + تأكيد سحب السيولة فقط (بلا BOS) — محاكاة عبر فلترة… نعيد مع النتائج مفصولة أعلاه
