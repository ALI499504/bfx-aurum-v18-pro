import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ============================================================
// تنبيهات تيليجرام — ضبط القناة التي تُدفع إليها إشعارات البوت.
// التخزين في نفس جدول الإعدادات (مفتاح alerts) بلا جداول جديدة،
// والتوكن لا يُعاد إرساله للواجهة إطلاقاً (يُعلن فقط أنه مضبوط).
// ============================================================

const KEY = 'alerts';

interface AlertsConfig { botToken?: string; chatId?: string }

async function readConfig(): Promise<AlertsConfig> {
  try {
    const row = await db.botSettings.findUnique({ where: { key: KEY } });
    return row ? (JSON.parse(row.json) as AlertsConfig) : {};
  } catch {
    return {};
  }
}

export async function GET() {
  const cfg = await readConfig();
  return NextResponse.json({
    ok: true,
    alerts: [],
    telegram: {
      configured: Boolean(cfg.botToken && cfg.chatId),
      chatId: cfg.chatId ?? null,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as AlertsConfig | null;
  const botToken = typeof body?.botToken === 'string' ? body.botToken.trim() : '';
  const chatId = typeof body?.chatId === 'string' ? body.chatId.trim() : '';
  if (!botToken || !chatId) {
    return NextResponse.json({ ok: false, error: 'توكن البوت ورقم المحادثة مطلوبان' }, { status: 400 });
  }
  const json = JSON.stringify({ botToken, chatId });
  await db.botSettings.upsert({ where: { key: KEY }, create: { key: KEY, json }, update: { json } });
  return NextResponse.json({ ok: true, telegram: { configured: true, chatId } });
}

export async function DELETE() {
  const json = JSON.stringify({});
  await db.botSettings.upsert({ where: { key: KEY }, create: { key: KEY, json }, update: { json } });
  return NextResponse.json({ ok: true, telegram: { configured: false, chatId: null } });
}
