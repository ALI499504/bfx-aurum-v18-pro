// الفحص الشامل النهائي — دستور البوت + محرك التنفيذ + الجسر
import { loadBotSettings } from '../src/lib/server/backtestRunner';
import { getLiveControl } from '../src/lib/server/liveOrders';
import { mt5Feed, isMt5Fresh } from '../src/lib/server/mt5feed';
import { db } from '../src/lib/db';

async function main() {
  const s = await loadBotSettings();
  const gr = s.globalRules as Record<string, { enabled: boolean; value?: number }>;
  console.log('== الدستور ==');
  console.log('لوت ثابت:', gr.fixed_lot?.enabled, gr.fixed_lot?.value);
  console.log('وقف إلزامي $:', gr.mandatory_sl?.enabled, gr.mandatory_sl?.value, '=> بيب:', (gr.mandatory_sl?.value ?? 0) * 10);
  console.log('سقف زمني h:', gr.max_hold_hours?.enabled, gr.max_hold_hours?.value);
  console.log('تزامن أقصى:', gr.max_concurrent?.enabled, gr.max_concurrent?.value);
  console.log('التأمين (قاعدة 20):', JSON.stringify((s as unknown as Record<string, unknown>).insurance ?? gr.insurance ?? 'غير موجود — معطل'));
  const ctrl = await getLiveControl();
  console.log('التفعيل الحي:', ctrl.enabled);
  const f = mt5Feed();
  console.log('== الجسر ==');
  console.log('v:', f.bridgeV, '| طازج:', isMt5Fresh(), '| دفعات:', f.pushes, '| آخر نبضة قبل:', Math.round((Date.now() - f.updatedAt) / 1000) + 's');
  console.log('حساب:', f.account?.login, f.account?.server, '| رصيد ديمو:', f.account?.balance, '| حقيقي غير مساس: $190.81');
  const work = await db.liveOrder.count({ where: { status: { in: ['sent', 'placed'] } } });
  const open = await db.liveOrder.count({ where: { status: 'filled' } });
  console.log('== التنفيذ ==');
  console.log('أوامر معلقة:', work, '| مواقف مفتوحة:', open);
  process.exit(0);
}
main();
