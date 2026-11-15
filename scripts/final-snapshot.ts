import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const rows = await db.liveOrder.findMany({ orderBy: { id: 'desc' }, take: 5 });
  for (const r of rows) {
    const any = r as any;
    console.log(JSON.stringify({
      st: r.strategy, dir: r.dir, status: r.status, ticket: r.ticket,
      entry: r.entry, sl: r.sl, tp: r.tp, lot: r.lot, kind: r.kind, magic: r.magic,
      slDist: Math.abs(r.entry - r.sl).toFixed(2) + '$',
      checkedAgo_s: any.checkedAtMs ? Math.round((Date.now() - any.checkedAtMs) / 1000) : null,
      expires_in_h: r.expiresAtMs ? +((r.expiresAtMs - Date.now()) / 3600000).toFixed(1) : null,
    }));
  }
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
