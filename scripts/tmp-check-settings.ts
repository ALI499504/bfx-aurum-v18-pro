import { loadBotSettings } from '../src/lib/server/backtestRunner';
const s = await loadBotSettings();
console.log('max_hold_hours:', JSON.stringify(s.globalRules.max_hold_hours));
console.log('sizing_quality:', JSON.stringify(s.globalRules.sizing_quality));
console.log('gate_side_pf:', JSON.stringify(s.globalRules.gate_side_pf));
console.log('gate_decay90:', JSON.stringify(s.globalRules.gate_decay90));
