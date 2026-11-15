// اختبار دورة كتابة/قراءة BigInt في Prisma + SQLite
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: 'file:/home/z/my-project/db/custom.db' } } });
(async () => {
  const BIG = 2621659288n;
  try {
    await db.liveOrder.create({
      data: {
        planId: 'diag-bigint-test', strategy: 'ZZ', dir: 'buy', entry: 1, sl: 0, tp: 0, lot: 0.01,
        kind: 'limit', createdAtMs: Date.now(), expiresAtMs: 0, status: 'sent',
        ticket: BIG, comment: 'diag', updatedAtMs: Date.now(), checkedAtMs: Date.now(),
      },
    });
    const rows = await db.liveOrder.findMany({ where: { planId: 'diag-bigint-test' } });
    console.log('WRITE+READ test row OK | ticket:', rows[0]?.ticket, '| typeof:', typeof rows[0]?.ticket);
    const poison = await db.liveOrder.findMany({ where: { planId: 'H-4024.39-1794427200000' } });
    console.log('POISON ROW READ OK | ticket:', poison[0]?.ticket, '| typeof:', typeof poison[0]?.ticket);
  } catch (e) {
    console.log('FAIL CODE:', e.code, '|', String(e.message).slice(0, 200));
  } finally {
    await db.liveOrder.deleteMany({ where: { planId: 'diag-bigint-test' } }).catch(() => {});
    await db.$disconnect();
  }
  process.exit(0);
})();
