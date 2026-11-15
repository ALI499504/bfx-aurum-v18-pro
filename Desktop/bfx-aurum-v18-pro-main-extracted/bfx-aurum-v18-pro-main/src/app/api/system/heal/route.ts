import { NextResponse } from 'next/server';
import { guardian } from '@/lib/monitor/guardian';

export const dynamic = 'force-dynamic';

/**
 * دورة فحص وإصلاح فورية — يعيد الوكيل فحص كل النظام مع تفعيل
 * كل إجراءات الإصلاح التلقائي (قاعدة البيانات، اللقطة، الإعدادات، الأخبار...)
 * ويعيد التقرير الكامل بعد انتهاء الدورة.
 */
export async function POST() {
  try {
    guardian.start();
    const rep = await guardian.runHeal();
    return NextResponse.json(rep);
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
