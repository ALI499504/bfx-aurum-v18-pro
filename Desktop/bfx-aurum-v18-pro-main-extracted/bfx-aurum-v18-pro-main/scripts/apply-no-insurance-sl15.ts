// ============================================================
// تطبيق قرار المالك 2026-11-12 على الإعدادات المحفوظة (قاعدة البيانات):
//   1) إلغاء التأمين: القاعدة 20 (break_even + be_case1 + be_case2 + be_lock_pips) → معطلة
//   2) سقف مسافة الوقف: القاعدة 12 (mandatory_sl) = 15$ كحد أقصى
// كل ما عدا ذلك يبقى كما هو (لوت 0.01، سقف 72 ساعة، البوابات 31/32...)
// ============================================================
import { loadBotSettings } from '../src/lib/server/backtestRunner';

const s = await loadBotSettings();
const gr = s.globalRules as Record<string, { enabled: boolean; value?: number }>;

gr.break_even = { enabled: false, value: 50 };
gr.be_case1 = { enabled: false, value: 50 };
gr.be_case2 = { enabled: false, value: 100 };
gr.be_lock_pips = { enabled: false, value: 50 };
gr.mandatory_sl = { enabled: true, value: 15 };

// لوت ثابت 0.01 وسقف 72 ساعة — تثبيت دفاعي (كما اعتُمد سابقاً)
gr.fixed_lot = { enabled: true, value: 0.01 };
gr.max_hold_hours = { enabled: true, value: 72 };
gr.sizing_quality = { enabled: false, value: 1 }; // لا تضخيم لوت — دستور اللوت الثابت

const { db } = await import('@/lib/db');
await db.botSettings.upsert({
  where: { key: 'main' },
  create: { key: 'main', json: JSON.stringify(s) },
  update: { json: JSON.stringify(s) },
});
console.log('[apply] تم حفظ الإعدادات: التأمين مُلغى | سقف الستوب 15$ | اللوت 0.01 | السقف الزمني 72 ساعة');

// تحقق بالقراءة من قاعدة البيانات مباشرة
const chk = await db.botSettings.findUnique({ where: { key: 'main' } });
const j = JSON.parse(chk!.json) as { globalRules: Record<string, { enabled: boolean; value?: number }> };
for (const k of ['break_even', 'be_case1', 'be_case2', 'be_lock_pips', 'mandatory_sl', 'fixed_lot', 'max_hold_hours', 'sizing_quality']) {
  console.log('  ', k.padEnd(14), JSON.stringify(j.globalRules[k]));
}
process.exit(0);
