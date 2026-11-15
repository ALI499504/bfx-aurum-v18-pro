// مقارنة تجريبية: صفقات micro_mgmt مقابل research_final لنفس التكوين
// التكوين: ldn | close | disp 0.6 | s5 | tight | both-confirm | جزئي 50% @0.5R + BE | w0.5
import { readFileSync } from 'fs';

// أعد استخدام micro عبر استيراد ديناميكي غير ممكن (سكربت تنفيذي) —
// لذلك: نشغل كلا السكربتين بوضع تفريغ الصفقات وقارن المخرجات هنا.
// هذا الملف يفترض أن كل سكربت كتب قائمة entryT إلى ملف نصي.
import { existsSync, readFileSync as rf } from 'fs';
const a = existsSync('/tmp/micro_trades.json') ? JSON.parse(rf('/tmp/micro_trades.json', 'utf8')) : [];
const b = existsSync('/tmp/final_trades.json') ? JSON.parse(rf('/tmp/final_trades.json', 'utf8')) : [];
console.log(`micro: ${a.length} صفقة | final: ${b.length} صفقة`);
const key = (x: { entryT: number; entry: number }) => `${x.entryT}:${x.entry.toFixed(2)}`;
const ka = new Map(a.map((x: any) => [key(x), x]));
const kb = new Map(b.map((x: any) => [key(x), x]));
let onlyA = 0, onlyB = 0, both = 0, diffOutcome = 0;
for (const [k, xa] of ka) {
  const xb = kb.get(k);
  if (!xb) { onlyA++; continue; }
  both++;
  if (Math.abs(xa.pnl - xb.pnl) > 0.01) diffOutcome++;
}
for (const k of kb.keys()) if (!ka.has(k)) onlyB++;
console.log(`مشتركة: ${both} | فقط micro: ${onlyA} | فقط final: ${onlyB} | نتيجة مختلفة: ${diffOutcome}`);
const sa = a.reduce((s: number, x: any) => s + x.pnl, 0);
const sb = b.reduce((s: number, x: any) => s + x.pnl, 0);
const wa = a.filter((x: any) => x.pnl > 0).length;
const wb = b.filter((x: any) => x.pnl > 0).length;
console.log(`micro: WR ${(wa / a.length * 100).toFixed(1)}% net ${sa.toFixed(0)}$ | final: WR ${(wb / b.length * 100).toFixed(1)}% net ${sb.toFixed(0)}$`);
// أول 5 اختلافات
let shown = 0;
for (const [k, xa] of ka) {
  const xb = kb.get(k);
  if (xb && Math.abs(xa.pnl - xb.pnl) > 0.01 && shown < 5) {
    console.log('DIFF', k, 'micro:', JSON.stringify(xa), 'final:', JSON.stringify(xb));
    shown++;
  }
}
