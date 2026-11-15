import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const rows = await db.liveOrder.findMany({ orderBy: { id: 'desc' }, take: 10 });
  console.log('total live orders (آخر 10):', rows.length);
  for (const r of rows) {
    console.log(JSON.stringify({
      id: r.id, planId: r.planId?.slice(0,20), st: r.strategy, dir: r.dir, kind: r.kind,
      entry: r.entry, sl: r.sl, tp: r.tp, lot: r.lot,
      status: r.status, ticket: r.ticket, error: r.error ? r.error.slice(0,60) : null,
      createdAtMs: r.createdAtMs, updatedAtMs: r.updatedAtMs,
      age_min: r.createdAtMs ? Math.round((Date.now()-r.createdAtMs)/60000) : null,
    }));
  }
  const alerts = await db.alert.findMany({ orderBy: { id: 'desc' }, take: 8 });
  console.log('--- آخر تنبيهات النظام ---');
  for (const a of alerts) console.log(new Date(a.createdAtMs||Date.now()).toISOString().slice(5,16), '|', (a as any).level, '|', (a.title || a.message || '').slice(0,110).replace(/\n/g,' / '));
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
