// ============================================================
// نشر حزمة بقية إصلاحات خطة التحويل (تقرير التشريح PDF — الفصل الخامس والسادس)
// القرار مبني على محاكاة A/B كاملة (scripts/pdf_fixes_ab.ts) وفق سلّم الترقية:
//   1) إعادة تفعيل I — رابح التقرير #4 (+912$ PF 1.25 على النافذة الكاملة)
//      (عطّله المدير الآلي بنافذة 90 يوماً: PF 0.94 — يبقى الحاكم اليومي له)
//   2) تخفيف عتبات الصامتين D وQ للتجربة الظلية (الفصل الخامس من التقرير)
//      D أنتجت أول عينة: 8 صفقات +47.6$ PF 5.25 — تحت عينة الحكم 30 (قاعدة 29)
//   3) U تبقى معطلة — رفضتها بوابة السبريد (قاعدة 2): هامش −0.01$/صفقة
// التشغيل: bun scripts/deploy_pdf_fixes.ts
// ============================================================
import { db } from '../src/lib/db';

async function main() {
  const row = await db.botSettings.findUnique({ where: { key: 'main' } });
  if (!row) { console.error('لا توجد إعدادات (key=main)'); process.exit(1); }
  const s = JSON.parse(row.json) as {
    strategyParams?: Record<string, Record<string, unknown>>;
  };
  const sp = s.strategyParams ?? {};

  const before = {
    I_enabled: (sp.I as { enabled?: boolean } | undefined)?.enabled,
    D: { gapMinPips: sp.D?.gapMinPips, bodyBreakMin: sp.D?.bodyBreakMin, totalMin: sp.D?.totalMin },
    Q: { wickMinPips: sp.Q?.wickMinPips, asiaOpenMinPips: sp.Q?.asiaOpenMinPips, isolationPips: sp.Q?.isolationPips },
    U_enabled: (sp.U as { enabled?: boolean } | undefined)?.enabled,
  };

  // 1) إعادة تفعيل I (رابح التقرير — الفصل الثالث #4)
  (sp.I as { enabled?: boolean }).enabled = true;

  // 1-ب) تعطيل U صراحةً — قاعدة السبريد (قاعدة 2): هامشها −0.01$/صفقة دون السبريد 0.30$
  // وقرار المدير الآلي اليوم (PF 1.00 على النافذة الكاملة = صفر حافة)
  (sp.U as { enabled?: boolean }).enabled = false;

  // 2) التجربة الظلية للصامتين D وQ (الفصل الخامس: «تُخفَّض عتبات D وQ قليلاً»)
  sp.D = { ...(sp.D ?? {}), gapMinPips: 8, bodyBreakMin: 40, totalMin: 80 };
  sp.Q = { ...(sp.Q ?? {}), wickMinPips: 60, asiaOpenMinPips: 150, isolationPips: 100 };

  s.strategyParams = sp;
  await db.botSettings.update({ where: { key: 'main' }, data: { json: JSON.stringify(s) } });

  // تحقق مطبوع
  const chk = JSON.parse((await db.botSettings.findUnique({ where: { key: 'main' } }))!.json) as typeof s;
  const after = {
    I_enabled: (chk.strategyParams?.I as { enabled?: boolean } | undefined)?.enabled,
    D: chk.strategyParams?.D,
    Q: chk.strategyParams?.Q,
    U_enabled: (chk.strategyParams?.U as { enabled?: boolean } | undefined)?.enabled,
  };
  console.log('قبل:', JSON.stringify(before));
  console.log('بعد:', JSON.stringify(after, null, 1));
  console.log('✓ نُشرت حزمة بقية الإصلاحات: I مفعلة، D/Q مخففة للتجربة الظلية، U تبقى معطلة (قاعدة السبريد)');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
