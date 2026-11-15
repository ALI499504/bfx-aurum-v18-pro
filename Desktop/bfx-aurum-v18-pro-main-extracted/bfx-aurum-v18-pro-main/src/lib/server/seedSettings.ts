import { db } from '@/lib/db';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// بذرة الإعدادات: ملف db/settings-seed.json مُخبز في صورة Docker يحمل آخر
// حالة معتمدة (الضبط خارج العينة + تعطيلات الميتة). الحاوية الجديدة تبدأ
// بقاعدة SQLite فارغة — أول قراءة إعدادات تزرع البذرة مرة واحدة ثم تتابع
// من قاعدة البيانات كالمعتاد. يجعل كل إعادة نشر/إعادة تشغيل شافية ذاتياً.
const SEED_PATH = join(process.cwd(), 'db', 'settings-seed.json');

export function settingsSeedRaw(): string | null {
  try {
    if (!existsSync(SEED_PATH)) return null;
    const raw = readFileSync(SEED_PATH, 'utf8');
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (!j || typeof j !== 'object' || !j.strategyParams) return null;
    return raw;
  } catch {
    return null;
  }
}

/** يضمن وجود صف الإعدادات في القاعدة — يزرع البذرة إن كان المخزن فارغاً */
export async function ensureSettingsSeeded(): Promise<void> {
  try {
    const row = await db.botSettings.findUnique({ where: { key: 'main' } });
    if (row) return;
    const raw = settingsSeedRaw();
    if (!raw) return;
    await db.botSettings.upsert({
      where: { key: 'main' },
      create: { key: 'main', json: raw },
      update: { json: raw },
    });
  } catch {
    /* بلا بذرة — الافتراضيات */
  }
}
