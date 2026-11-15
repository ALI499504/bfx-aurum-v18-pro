import { NextRequest, NextResponse } from 'next/server';
import { getAlerts, setTelegramCfg, getTelegramCfg } from '@/lib/server/alerts';

export const dynamic = 'force-dynamic';

/** سجل التنبيهات الحي — آخر الأحداث الجوهرية للبوت */
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 50);
  const tg = await getTelegramCfg().catch(() => ({ configured: false, chatId: null }));
  return NextResponse.json({
    ok: true,
    alerts: getAlerts(Number.isFinite(limit) ? limit : 50),
    telegram: tg,
  });
}

/** ضبط تليجرام: {"botToken": "...", "chatId": "..."} — بعد ذلك كل التنبيهات تُدفع فوراً */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const botToken = typeof body?.botToken === 'string' ? body.botToken.trim() : '';
  const chatId = typeof body?.chatId === 'string' ? body.chatId.trim() : '';
  if (!botToken || !chatId) {
    return NextResponse.json({ ok: false, error: 'botToken وchatId مطلوبان' }, { status: 400 });
  }
  // لا نُخرج التوكن أبداً في الرد — تخزين صامت
  if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
    return NextResponse.json({ ok: false, error: 'صيغة التوكن غير صحيحة (متوقع 123456:ABC-...)' }, { status: 400 });
  }
  await setTelegramCfg(botToken, chatId);
  return NextResponse.json({ ok: true, configured: true, chatId });
}
