import { NextResponse } from 'next/server';
import { getMt5Status } from '@/lib/server/mt5feed';

export const dynamic = 'force-dynamic';

// كاش قصير (نصف ثانية): الجسر يسحب status كل ~2s والواجهة كل 8s —
// كل الطلبات ضمن النافذة نفسها تأخذ نفس الحمولة بلا إعادة حساب.
let statusCache: { t: number; payload: ReturnType<typeof getMt5Status> } | null = null;

/** حالة اتصال MT5 — تُستخدم في شارة الواجهة */
export async function GET() {
  const t = Date.now();
  if (statusCache && t - statusCache.t < 500) {
    return NextResponse.json(statusCache.payload);
  }
  const payload = getMt5Status();
  statusCache = { t, payload };
  return NextResponse.json(payload);
}
