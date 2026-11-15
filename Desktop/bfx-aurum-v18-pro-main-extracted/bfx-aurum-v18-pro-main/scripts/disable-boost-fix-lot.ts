// ============================================================
// قرار المالك: اللوت الثابت 0.01 إلزامي بلا استثناء
// 1) تعطيل القاعدة 33 (sizing_quality — لوت ×2 للسلة) في إعدادات الحي
// 2) التحقق من التزام كل مسارات التنفيذ بلوت 0.01
// 3) التأكد من سقف الاحتفاظ 48 ساعة (قرار «لا أكثر من يومين أو ثلاثة»)
// ============================================================
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const row = await db.botSettings.findUnique({ where: { key: 'main' } });
if (!row) {
  console.error('لا توجد إعدادات محفوظة (main) — لن يُعدَّل شيء');
  process.exit(1);
}
const j = JSON.parse(row.json) as { globalRules: Record<string, { enabled: boolean; value: number }> };
const before = JSON.stringify(j.globalRules.sizing_quality);

// 1) تعطيل تضخيم الجودة — الالتزام الصارم بلوت 0.01
j.globalRules.sizing_quality = { enabled: false, value: 1 };

// 2) قفل اللوت الثابت 0.01 (تحصين إضافي على القيمة المحفوظة نفسها)
j.globalRules.fixed_lot = { enabled: true, value: 0.01 };

// 3) سقف الاحتفاظ الزمني 48 ساعة — «لا أريدها أكثر من يومين أو ثلاثة أيام»
j.globalRules.max_hold_hours = { enabled: true, value: 48 };

await db.botSettings.update({
  where: { key: 'main' },
  data: { json: JSON.stringify(j) },
});

console.log('sizing_quality  :', before, '→', JSON.stringify(j.globalRules.sizing_quality));
console.log('fixed_lot       :', JSON.stringify(j.globalRules.fixed_lot));
console.log('max_hold_hours  :', JSON.stringify(j.globalRules.max_hold_hours));

// 4) تحقق نهائي — قراءة بعد الحفظ
const row2 = await db.botSettings.findUnique({ where: { key: 'main' } });
const g = JSON.parse(row2!.json).globalRules;
const ok =
  g.sizing_quality?.enabled === false &&
  g.fixed_lot?.enabled === true && Math.abs((g.fixed_lot?.value ?? 0) - 0.01) < 1e-9 &&
  g.max_hold_hours?.enabled === true && (g.max_hold_hours?.value ?? 0) === 48;
console.log(ok ? '[OK] الإعدادات المحفوظة مطابقة لقرار المالك' : '[FAIL] عدم تطابق — أعد الفحص');
await db.$disconnect();
