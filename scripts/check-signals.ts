import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const rows = await db.liveSignal.findMany({ orderBy: { id: 'desc' }, take: 12 });
  console.log('آخر قرارات عقل القرار (LiveSignal):', rows.length);
  for (const r of rows) {
    const any = r as any;
    console.log(new Date(any.createdAtMs || any.createdAt || Date.now()).toISOString().slice(5,16),
      '|', r.strategy ?? '-', '|', r.dir ?? '-', '|', any.action ?? '', '|', (r.reason ?? any.reason ?? '').slice(0,80));
  }
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
