// فحص حالة إصلاحات خطة التحويل في الإعدادات المحفوظة (قاعدة البيانات)
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const row = await db.botSettings.findUnique({ where: { key: 'main' } });
  if (!row) { console.error('NO_SETTINGS_ROW'); process.exit(1); }
  const s = JSON.parse(row.json) as {
    globalRules?: Record<string, { enabled?: boolean; value?: number }>;
    strategyParams?: Record<string, Record<string, Record<string, unknown>>>;
  };

  console.log('=== البوابات (globalRules) ===');
  for (const k of ['gate_daily_trend', 'gate_er_quiet', 'gate_spread_guard', 'gate_min_sample', 'gate_ladder', 'gate_side_pf', 'gate_decay90', 'sizing_quality', '__erIncludeG']) {
    const v = s.globalRules?.[k];
    console.log(`${k}: ${v ? JSON.stringify(v) : 'غائب'}`);
  }
  console.log('=== قيم الدخول المُصلحة (strategyParams) ===');
  const g = (st: string, path: string[]): unknown => {
    let cur: unknown = s.strategyParams?.[st];
    for (const p of path) cur = (cur as Record<string, unknown>)?.[p];
    return cur;
  };
  console.log(`A.entryPips = ${g('A', ['entryPips'])} (المطلوب 0)`);
  console.log(`B.entryPips = ${g('B', ['entryPips'])} (المطلوب 0)`);
  console.log(`G.revEntryPips = ${g('G', ['revEntryPips'])} (المطلوب 0)`);
  console.log(`N.exec.revEntryPips = ${g('N', ['exec', 'revEntryPips'])} (المطلوب 0)`);
  console.log(`P.entryPips = ${g('P', ['entryPips'])} (المطلوب 0)`);
  console.log(`J.exec.entryPips = ${g('J', ['exec', 'entryPips'])} (المطلوب 0)`);
  console.log(`V.entryZ = ${g('V', ['entryZ'])} (المطلوب 2.5)`);
  console.log('updatedAt:', row.updatedAt.toISOString());
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
