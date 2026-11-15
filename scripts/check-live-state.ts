// فحص شامل لحالة محرك التنفيذ الحي
import { getLiveOrdersPayload } from '../src/lib/server/liveOrders';
import { mt5Feed } from '../src/lib/server/mt5feed';

async function main() {
  const p = await getLiveOrdersPayload();
  console.log('== LIVE ENGINE ==');
  console.log('enabled:', p.enabled, '| feedFresh:', p.feedFresh);
  console.log('config:', JSON.stringify(p.config));
  const st = p as unknown as Record<string, unknown>;
  for (const k of ['open', 'close', 'workingOrders', 'recent', 'rows']) {
    if (st[k] !== undefined) console.log(k + ':', JSON.stringify(st[k]).slice(0, 800));
  }
  const f = mt5Feed();
  console.log('bridge orders:', JSON.stringify(f.orders ?? f.workingOrders ?? null)?.slice(0, 600));
}
main();
