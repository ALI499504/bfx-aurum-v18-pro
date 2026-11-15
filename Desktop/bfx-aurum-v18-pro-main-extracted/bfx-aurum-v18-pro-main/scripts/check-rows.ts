import { db } from '../src/lib/db';

async function main() {
  const rows = await db.liveOrder.findMany({ orderBy: { id: 'asc' } });
  for (const r of rows) {
    console.log(JSON.stringify({
      planId: r.planId, strategy: r.strategy, dir: r.dir, status: r.status,
      entry: r.entry, sl: r.sl, tp: r.tp, ticket: r.ticket,
      created: new Date(r.createdAtMs).toISOString(), expires: new Date(r.expiresAtMs).toISOString(),
      ageH: ((Date.now() - r.createdAtMs) / 3600e3).toFixed(1),
    }));
  }
  console.log('total:', rows.length);
}
main();
