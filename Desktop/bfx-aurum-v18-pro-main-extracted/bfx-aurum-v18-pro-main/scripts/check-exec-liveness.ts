import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const r1 = await db.liveOrder.findFirst({ where: { status: 'placed' }, orderBy: { updatedAtMs: 'desc' } });
  console.log('T0 placed-order updatedAtMs:', r1?.updatedAtMs, 'checkedAtMs:', (r1 as any)?.checkedAtMs, 'now:', Date.now());
  await new Promise(res => setTimeout(res, 12000));
  const r2 = await db.liveOrder.findFirst({ where: { status: 'placed' }, orderBy: { updatedAtMs: 'desc' } });
  console.log('T1 (+12s) placed-order updatedAtMs:', r2?.updatedAtMs, 'checkedAtMs:', (r2 as any)?.checkedAtMs, 'now:', Date.now());
  const advancing = (r2?.updatedAtMs ?? 0) > (r1?.updatedAtMs ?? 0);
  console.log(advancing ? '>>> خيط التنفيذ في الجسر حي ويبلّغ reconcile الآن فعلاً' : '>>> لا تحديث جديد خلال 12 ثانية — خيط التنفيذ متوقف!');
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
