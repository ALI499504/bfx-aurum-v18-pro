import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ============================================================
// الضبط الذاتي (البحث الشبكي) — حالة التقرير المحفوظ.
// محرك هذه النسخة المُستعادة لا يملك بحثاً شبكياً مدمجاً: معاملات
// الاستراتيجيات مجمّدة في المواصفة (constitution)، فلا يوجد ما يُبحث
// فيه دون كسر القاعدة 7. لذلك يُعاد التقرير المحفوظ فقط، ويُرفض بدء
// بحث جديد برسالة صريحة بدل رقم مُختلق — تقرير النسخة المنشورة محفوظ
// في الأرشيف المرجعي (api/tuning/tuner.json).
// ============================================================

const KEY = 'tuner';

export async function GET() {
  const row = await db.botSettings.findUnique({ where: { key: KEY } });
  if (!row) {
    return NextResponse.json({
      running: false,
      stage: 'لا يوجد تشغيل محفوظ',
      done: 0,
      total: 0,
      log: [],
      error: null,
      report: null,
    });
  }
  const stored = JSON.parse(row.json) as Record<string, unknown>;
  return NextResponse.json({ running: false, error: null, log: [], ...stored });
}

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        'البحث الشبكي غير موجود في محرك هذه النسخة: معاملات الاستراتيجيات مجمّدة في المواصفة. ' +
        'استخدم الباك تيست لقياس أي تعديل، أو راجع تقرير الضبط المحفوظ في الأرشيف المرجعي.',
    },
    { status: 501 },
  );
}
