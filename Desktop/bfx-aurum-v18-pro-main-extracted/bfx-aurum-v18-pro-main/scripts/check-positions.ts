// فحص مواقف MT5 الحية — يقرأ مخزن التغذية مباشرة
import { mt5Feed } from '../src/lib/server/mt5feed';

const f = mt5Feed();
console.log('positions:', JSON.stringify(f.positions, null, 1).slice(0, 1200));
console.log('deals(last 3):', JSON.stringify(f.deals.slice(-3), null, 1).slice(0, 900));
console.log('tick:', JSON.stringify(f.tick));
