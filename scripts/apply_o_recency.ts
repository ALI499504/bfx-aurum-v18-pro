// تطبيق إصلاح O (حداثة المستوى: آخر 20 جلسة)
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const row = await db.botSettings.findUnique({ where: { key: 'main' } });
  if (!row) { console.error('NO_SETTINGS'); process.exit(1); }
  const s = JSON.parse(row.json);

  if (!s.strategyParams?.O) { console.error('NO_O_PARAMS'); process.exit(1); }
  s.strategyParams.O.recencyDays = 20;
  console.log('O.recencyDays =', s.strategyParams.O.recencyDays);
  console.log('F.phase1Continuation =', s.strategyParams.F?.phase1Continuation);

  await db.botSettings.update({
    where: { key: 'main' },
    data: { json: JSON.stringify(s), updatedAt: new Date() },
  });
  console.log('SAVED at', new Date().toISOString());
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
