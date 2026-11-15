// تخزين كلمات الاسترجاع الثلاث في قاعدة البيانات الفعلية (جدول BotSettings)
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const payload = {
  keywords: ['AURUM-771', 'DOSTOR-XAU', 'BRIDGE-V21'],
  legacyKeywords: ['أوروم', 'جسر771', 'فريمات190'],
  instruction: 'إذا كتب المستخدم هذه الكلمات في أي محادثة جديدة: اقرأ /home/z/my-project/SESSION-CONTEXT.md كاملاً أولاً ثم واصل المشروع من قسم "ما يُكمل لاحقاً" بلا أسئلة تمهيدية.',
  storedAt: new Date().toISOString(),
};

async function main() {
  const row = await prisma.botSettings.upsert({
    where: { key: 'session-restore-keywords' },
    update: { json: JSON.stringify(payload, null, 2), updatedAt: new Date() },
    create: { key: 'session-restore-keywords', json: JSON.stringify(payload, null, 2) },
  });
  console.log('SAVED:', row.key, 'at', row.updatedAt.toISOString());
  const check = await prisma.botSettings.findUnique({ where: { key: 'session-restore-keywords' } });
  console.log('VERIFY:', check ? check.json.slice(0, 200) : 'MISSING');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
