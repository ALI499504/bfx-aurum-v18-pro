import { NextRequest, NextResponse } from 'next/server';
import { ingestMt5 } from '@/lib/server/mt5feed';

export const dynamic = 'force-dynamic';

const TOKEN = process.env.MT5_TOKEN ?? 'bfx-aurum-mt5-v1';

/** استقبال الشموع الحية من جسر MT5 على جهاز المستخدم */
export async function POST(req: NextRequest) {
  if (req.headers.get('x-bfx-token') !== TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }
  const { stored, counts } = ingestMt5(body as Parameters<typeof ingestMt5>[0]);
  return NextResponse.json({ ok: true, stored, counts, serverTime: Date.now() });
}
