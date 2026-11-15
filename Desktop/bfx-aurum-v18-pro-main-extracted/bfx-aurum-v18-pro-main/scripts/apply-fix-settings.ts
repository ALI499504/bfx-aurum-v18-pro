// ============================================================
// تطبيق إصلاحات خطة التحويل على الإعدادات المحفوظة (قاعدة البيانات)
// — قيم الدخول عند الاختبار المباشر + تثبيت مفاتيح البوابات 26–30
// التشغيل: bun scripts/apply-fix-settings.ts
// ============================================================
import { db } from '../src/lib/db';

const ENTRY_FIXES: Record<string, Record<string, number>> = {
  A: { entryPips: 0 },           // الدخول عند إعادة اختبار الخط (لا قبله)
  B: { entryPips: 0 },           // الدخول عند اختبار الخط الثاني
  G: { revEntryPips: 0 },        // انتظر اختبار الرقم لا مجرد اقترابه
  N: {},                         // عبر exec.revEntryPips
  P: { entryPips: 0 },           // حارس لا مطارد
};

const GATES: Record<string, { enabled: boolean; value: number }> = {
  gate_daily_trend: { enabled: true, value: 0 },   // القاعدة 26: اتجاه TSMOM اليومي للعائلة العكسية
  gate_er_quiet: { enabled: true, value: 30 },     // القاعدة 27: هدوء كوفمان C/G/H/O
  gate_spread_guard: { enabled: false, value: 1 }, // القاعدة 28: الاحتجاز وقت التشغيل مرفوض بالمحاكاة — التنفيذ في المدير الآلي
  gate_min_sample: { enabled: true, value: 30 },   // القاعدة 29: عينة الحكم
  gate_ladder: { enabled: true, value: 0 },        // القاعدة 30: سلّم الترقية والتراجع
};

async function main() {
  const row = await db.botSettings.findUnique({ where: { key: 'main' } });
  if (!row) { console.error('لا توجد إعدادات محفوظة (key=main)'); process.exit(1); }
  const s = JSON.parse(row.json) as {
    globalRules?: Record<string, unknown>;
    strategyParams?: Record<string, Record<string, unknown>>;
  };

  s.strategyParams = s.strategyParams ?? {};
  // إصلاحات الدخول (الفصل السادس من التقرير)
  const setDeep = (st: string, path: string[], v: number) => {
    const node = (s.strategyParams?.[st] ?? {}) as Record<string, unknown>;
    let cur: Record<string, unknown> = node;
    for (let i = 0; i < path.length - 1; i++) {
      cur[path[i]] = (cur[path[i]] as Record<string, unknown>) ?? {};
      cur = cur[path[i]] as Record<string, unknown>;
    }
    cur[path[path.length - 1]] = v;
    s.strategyParams![st] = node;
  };
  for (const [st, fixes] of Object.entries(ENTRY_FIXES)) {
    for (const [k, v] of Object.entries(fixes)) setDeep(st, [k], v);
  }
  setDeep('N', ['exec', 'revEntryPips'], 0);
  setDeep('J', ['exec', 'entryPips'], 0);

  // تثبيت مفاتيح البوابات في الإعدادات المحفوظة
  s.globalRules = { ...(s.globalRules ?? {}), ...GATES };

  await db.botSettings.update({ where: { key: 'main' }, data: { json: JSON.stringify(s) } });
  console.log('✓ طُبقت إصلاحات الدخول: A/B/G/N(exec)/P/J → 0');
  console.log('✓ ثُبتت البوابات: 26 اتجاه اليومي، 27 هدوء ER، 28 سبريد (وقت التشغيل معطل — التنفيذ بالمدير الآلي)، 29 عينة 30، 30 سلّم الترقية');
  // طباعة تأكيدية
  const chk = JSON.stringify({ A: s.strategyParams.A?.entryPips, B: s.strategyParams.B?.entryPips, G: s.strategyParams.G?.revEntryPips, N: (s.strategyParams.N?.exec as Record<string, unknown>)?.revEntryPips, P: s.strategyParams.P?.entryPips, J: ((s.strategyParams.J?.exec as Record<string, unknown>) ?? {}).entryPips });
  console.log('تأكيد القيم:', chk);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
