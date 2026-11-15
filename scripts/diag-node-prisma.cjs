// اختبار Prisma عبر Node مباشرة (عزل bun عن المعادلة)
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: 'file:/home/z/my-project/db/custom.db' } } });
db.liveOrder.findMany({ where: { status: { in: ['sent', 'placed'] } }, orderBy: { createdAtMs: 'desc' }, take: 200 })
  .then(rows => {
    console.log('NODE OK rows:', rows.length);
    for (const r of rows) console.log('ticket:', r.ticket, '| typeof:', typeof r.ticket);
    process.exit(0);
  })
  .catch(e => {
    console.log('NODE FAIL CODE:', e.code);
    console.log(String(e.message).slice(0, 300));
    process.exit(1);
  });
