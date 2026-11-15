// زرع سقف الاحتفاظ الزمني (قاعدة 4): تفعيل بسقف 48 ساعة — قرار المالك
// خروج وقائي صارم: لا صفقة تبقى مفتوحة أكثر من 48 ساعة (بما فيها عبور العطلة)
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const CAP = 48;

async function main() {
  const row = await db.botSettings.findUnique({ where: { key: 'main' } });
  if (!row) { console.error('NO_SETTINGS_ROW'); process.exit(1); }
  const s = JSON.parse(row.json) as {
    globalRules?: Record<string, { enabled?: boolean; value?: number }>;
  };
  s.globalRules = s.globalRules ?? {};
  const before = s.globalRules.max_hold_hours;
  s.globalRules.max_hold_hours = { enabled: true, value: CAP };
  await db.botSettings.update({
    where: { key: 'main' },
    data: { json: JSON.stringify(s), updatedAt: new Date() },
  });
  console.log(`قاعدة 4 قبل: ${JSON.stringify(before)}`);
  console.log(`قاعدة 4 بعد: ${JSON.stringify(s.globalRules.max_hold_hours)}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
