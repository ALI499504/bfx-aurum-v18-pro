// ============================================================
// تثبيت القرار النهائي للمالك في إعدادات الحي:
// لوت ثابت 0.01 صارم (بلا تضخيم) + سقف احتفاظ 72 ساعة
// ============================================================
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const row = await db.botSettings.findUnique({ where: { key: 'main' } });
if (!row) { console.error('لا إعدادات'); process.exit(1); }
const j = JSON.parse(row.json);
j.globalRules.fixed_lot = { enabled: true, value: 0.01 };
j.globalRules.sizing_quality = { enabled: false, value: 1 };
j.globalRules.max_hold_hours = { enabled: true, value: 72 };
await db.botSettings.update({ where: { key: 'main' }, data: { json: JSON.stringify(j) } });
const g = JSON.parse((await db.botSettings.findUnique({ where: { key: 'main' } }))!.json).globalRules;
console.log('fixed_lot      =', JSON.stringify(g.fixed_lot));
console.log('sizing_quality =', JSON.stringify(g.sizing_quality));
console.log('max_hold_hours =', JSON.stringify(g.max_hold_hours));
await db.$disconnect();
