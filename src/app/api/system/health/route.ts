import { NextResponse } from 'next/server';
import { guardian } from '@/lib/monitor/guardian';

export const dynamic = 'force-dynamic';

/**
 * تقرير الوكيل الحارس — آخر دورة مراقبة كاملة
 * (يُقلع الوكيل تلقائياً مع الخادم عبر instrumentation — هذا النداء ضمان إضافي)
 */
export async function GET() {
  try {
    guardian.start();
    return NextResponse.json(guardian.report());
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
