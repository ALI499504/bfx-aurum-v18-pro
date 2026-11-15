// تطبيق إصلاحات إضافية من تقرير تشريح الاستراتيجيات (الفصل السادس)
// 1) F.phase1Continuation = true — قلب كامل: Phase 1 يدخل مع اتجاه اليوم لا عكس الذيل
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const row = await db.botSettings.findUnique({ where: { key: 'main' } });
  if (!row) { console.error('NO_SETTINGS'); process.exit(1); }
  const s = JSON.parse(row.json);

  // تعديل معاملات F
  if (!s.strategyParams?.F) { console.error('NO_F_PARAMS'); process.exit(1); }
  s.strategyParams.F.phase1Continuation = true;
  console.log('F.phase1Continuation =', s.strategyParams.F.phase1Continuation);

  await db.botSettings.update({
    where: { key: 'main' },
    data: { json: JSON.stringify(s), updatedAt: new Date() },
  });
  console.log('SAVED at', new Date().toISOString());
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
