// ============================================================
// مفتاح التفعيل الحي — قرار المالك وحده
// POST { enabled: true|false, note?: string }
//   true  → عقل القرار يبدأ إصدار أوامر حية إلى MT5 عبر الجسر
//   false → لا أوامر جديدة + سحب المعلق + السقف الزمني يبقى إلزامياً
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { getLiveControl, saveLiveControl, getLiveOrdersPayload } from '@/lib/server/liveOrders';
import { pushAlert } from '@/lib/server/alerts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const control = await getLiveControl();
  return NextResponse.json({ ok: true, ...control });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { enabled?: boolean; note?: string } | null;
  if (!body || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'الصيغة: { enabled: boolean }' }, { status: 400 });
  }
  const prev = await getLiveControl();
  const next = {
    enabled: body.enabled,
    enabledAt: body.enabled ? Date.now() : prev.enabledAt,
    disabledAt: body.enabled ? prev.disabledAt : Date.now(),
    note: body.note ?? prev.note,
  };
  await saveLiveControl(next);
  pushAlert('system', body.enabled ? 'التنفيذ الحي مفعّل — القرار يعمل على MT5 مباشرة' : 'التنفيذ الحي موقوف — لا أوامر جديدة',
    body.enabled
      ? 'عقل القرار يصدر الآن أوامر حية عبر الجسر: لوت 0.01 ثابت | وقف ≤15$ | لا تأمين | سقف 72 ساعة | سقف تزامن 4'
      : 'سحب الأوامر المعلقة من الطرفية — المواقف المفتوحة تبقى محكومة بوقفها وهدفها والسقف الزمني',
    `livectl:${body.enabled ? 'on' : 'off'}:${Math.floor(Date.now() / 3600e3)}`);
  const payload = await getLiveOrdersPayload();
  return NextResponse.json({ ok: true, control: next, state: payload.state });
}
