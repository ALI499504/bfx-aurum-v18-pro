import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const rows = await p.liveOrder.findMany({ orderBy: { createdAtMs: 'desc' }, take: 10 });
console.log('LIVE ORDERS:', rows.length);
for (const r of rows) {
  console.log(JSON.stringify({
    plan: r.planId, strat: r.strategy, dir: r.dir, entry: r.entry, sl: r.sl, tp: r.tp, lot: r.lot,
    status: r.status, ticket: r.ticket, fill: r.fillPrice, pnl: r.pnl, close: r.closeReason,
    created: new Date(r.createdAtMs).toISOString().slice(5,16), updated: new Date(r.updatedAtMs).toISOString().slice(5,16),
  }));
}
await p.$disconnect();
