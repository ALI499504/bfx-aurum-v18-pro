// ============================================================
// تثبيت البوابات التكيفية الثلاث (قواعد 31/32/33) في الإعدادات المحفوظة
// — الاحتجاز الاتجاهي + بوابة الانحسار الزمني 90 يوماً + تحجيم الجودة
// التشغيل: bun scripts/apply-adaptive-settings.ts
// ============================================================
import { db } from '../src/lib/db';

const GATES: Record<string, { enabled: boolean; value: number }> = {
  gate_side_pf:   { enabled: true, value: 90 },  // القاعدة 31: طرف PF تراكمي < 0.90 بعينة ≥ 30 (أو < 0.50 بـ ≥ 12) → احتجاز صفقة/يوم
  gate_decay90:   { enabled: true, value: 100 }, // القاعدة 32: PF نافذة 90 يوماً < 1.00 بعينة ≥ 50 → احتجاز صفقة/يوم
  sizing_quality: { enabled: true, value: 2 },   // القاعدة 33: لوت ×2 للسلة السبعة عند PF نافذة ≥ 1.15 بعينة ≥ 10
};

async function main() {
  const row = await db.botSettings.findUnique({ where: { key: 'main' } });
  if (!row) { console.error('لا توجد إعدادات محفوظة (key=main)'); process.exit(1); }
  const s = JSON.parse(row.json) as { globalRules?: Record<string, unknown> };

  s.globalRules = { ...(s.globalRules ?? {}), ...GATES };
  await db.botSettings.update({ where: { key: 'main' }, data: { json: JSON.stringify(s) } });
  console.log('✓ ثُبتت البوابات التكيفية في قاعدة البيانات:');
  for (const [k, v] of Object.entries(GATES)) console.log(`  ${k} = ${JSON.stringify(v)}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
