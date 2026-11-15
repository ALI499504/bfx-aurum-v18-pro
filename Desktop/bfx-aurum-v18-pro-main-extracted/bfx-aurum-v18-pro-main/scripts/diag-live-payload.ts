// تشخيص عميق: استدعاء عقل القرار الحي مباشرة وإظهار الخطأ الكامل
process.env.DATABASE_URL = 'file:/home/z/my-project/db/custom.db';
import { getLiveOrdersPayload } from '../src/lib/server/liveOrders';
import { isMt5Fresh, mt5Feed } from '../src/lib/server/mt5feed';

const f = mt5Feed();
console.log('--- FEED STATE ---');
console.log('symbol:', f.symbol, '| bridgeV:', f.bridgeV, '| updatedAt:', f.updatedAt, '| age(s):', f.updatedAt ? Math.round((Date.now() - f.updatedAt) / 1000) : null);
console.log('tfs sizes:', Object.fromEntries(Object.entries(f.tfs).map(([k, v]) => [k, v.length])));
console.log('isMt5Fresh:', isMt5Fresh());
console.log('--- PAYLOAD ---');
try {
  const p = await getLiveOrdersPayload();
  console.log('enabled:', p.enabled, '| feedFresh:', p.feedFresh, '| symbol:', p.symbol);
  console.log('note:', p.note);
  console.log('open plans:', p.open?.length ?? 'n/a', '| close:', p.close?.length ?? 'n/a');
} catch (e) {
  console.log('THROWN:');
  console.log(e);
}
process.exit(0);
