// تشخيص: عزل خطأ Prisma في جدول LiveOrder
process.env.DATABASE_URL = 'file:/home/z/my-project/db/custom.db';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
try {
  const rows = await db.liveOrder.findMany({
    where: { status: { in: ['sent', 'placed'] } },
    orderBy: { createdAtMs: 'desc' },
    take: 200,
  });
  console.log('OK liveOrder.findMany rows:', rows.length);
} catch (e: unknown) {
  const err = e as { message?: string; code?: string; meta?: unknown };
  console.log('CODE:', err.code);
  console.log('MESSAGE FULL:');
  console.log(err.message);
  console.log('META:', JSON.stringify(err.meta));
}
// جرد الجداول والأعمدة الفعلية في SQLite
const tables = await db.$queryRawUnsafe<{ name: string }[]>(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
);
console.log('TABLES:', tables.map(t => t.name).join(', '));
try {
  const cols = await db.$queryRawUnsafe<{ name: string }[]>(
    "PRAGMA table_info(LiveOrder)",
  );
  console.log('LiveOrder COLUMNS:', cols.map(c => c.name).join(', '));
} catch (e) {
  console.log('LiveOrder table missing!');
}
await db.$disconnect();
process.exit(0);
