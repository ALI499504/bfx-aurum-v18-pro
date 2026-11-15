// فحص الإعدادات المحفوظة فعلياً (قواعد التأمين/الستوب/اللوت/الاحتفاظ)
import { loadBotSettings } from '../src/lib/server/backtestRunner';
const s = await loadBotSettings();
const keys = ['fixed_lot', 'max_hold_hours', 'daily_loss_stop', 'mandatory_sl', 'break_even', 'be_case1', 'be_case2', 'be_lock_pips', 'sizing_quality', 'gate_side_pf', 'gate_decay90', 'fixed_spread', 'max_daily_trades'];
for (const k of keys) console.log(k.padEnd(16), JSON.stringify((s.globalRules as Record<string, unknown>)[k]));
console.log('--- strategyParams slPips (TAMSA) ---');
const sp = s.strategyParams as unknown as Record<string, Record<string, unknown>>;
for (const [k, v] of Object.entries(sp)) {
  const flat = JSON.stringify(v);
  const m = flat.match(/"slPips":([0-9.]+)/g);
  if (m) console.log(k.padEnd(4), m.join(' '));
}
