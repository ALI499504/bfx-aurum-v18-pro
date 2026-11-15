// ============================================================
// قناة التنفيذ الحي — نقطة الاتصال بين عقل القرار والجسر على MT5
// ------------------------------------------------------------
// GET  (الجسر كل ~4 ثوانٍ): حمولة الأوامر المسموحة دستورياً
//      { open: خطط دخول, close: إغلاقات إجبارية, cancelAllPending }
// POST (الجسر كل دورة): تقارير التنفيذ + التعويض الذاتي من حالة MT5
// المصادقة: ترويسة x-bfx-token (نفس توكن الجسر المعتمد)
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { getLiveOrdersPayload, applyBridgeReports, applyReconcile, type BridgeReport, type BridgeReconcile } from '@/lib/server/liveOrders';

export const dynamic = 'force-dynamic';

const TOKEN = process.env.MT5_TOKEN ?? 'bfx-aurum-mt5-v1';

export async function GET(req: NextRequest) {
  if (req.headers.get('x-bfx-token') !== TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const payload = await getLiveOrdersPayload();
  return NextResponse.json({ ok: true, ...payload });
}

export async function POST(req: NextRequest) {
  if (req.headers.get('x-bfx-token') !== TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as { reports?: BridgeReport[]; reconcile?: BridgeReconcile } | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }
  if (Array.isArray(body.reports) && body.reports.length) {
    await applyBridgeReports(body.reports.slice(0, 50));
  }
  if (body.reconcile && typeof body.reconcile === 'object') {
    await applyReconcile(body.reconcile);
  }
  return NextResponse.json({ ok: true, serverTime: Date.now() });
}
