import { NextRequest } from 'next/server';
import { synthesizeStream, hasCached, ttsCachePath, TTS_VOICE, TTS_RATE } from '@/lib/server/jarvis/voice';
import { isAuthed, lockedResponse } from '@/lib/server/jarvis/auth';
import fs from 'node:fs';
import { JARVIS_SECTION_CLOSED } from '@/lib/jarvis-flag';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const MAX_CHARS = 600;

// ============================================================
// جارفس — نقطة الصوت (GET للبث المباشر + POST للتوافق)
// مسار الكاش: الملف جاهز → استجابة كاملة فورية.
// مسار البث: أول إطارات MP3 تتدفق للمتصفح خلال ~ثانية والنطق
// يبدأ فوراً أثناء استمرار التوليد — لا انتظار للملف الكامل.
// ============================================================

async function handle(req: NextRequest, body: unknown) {
  // القسم مغلق بقرار المالك — لا توليد صوت إطلاقاً (إعادة الفتح: src/lib/jarvis-flag.ts)
  if (JARVIS_SECTION_CLOSED) {
    return Response.json({ ok: false, closed: true, error: 'قسم جارفس — القلب النابض مغلق حالياً. البوت يعمل بشكل طبيعي.' }, { status: 503 });
  }
  if (!isAuthed(req)) return lockedResponse(); // الصوت جزء من الخدمة المقفولة
  const q = req.nextUrl.searchParams.get('text') ?? '';
  const b = (body as { text?: string } | null)?.text ?? '';
  const text = String(q || b).trim().slice(0, MAX_CHARS);
  if (!text) return Response.json({ ok: false, error: 'النص مطلوب' }, { status: 400 });

  const headers: Record<string, string> = {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'public, max-age=604800',
    'X-Voice': TTS_VOICE,
  };

  // 1) الكاش الساخن — جملة مولّدة سابقاً = فورية تماماً
  if (hasCached(text)) {
    const buf = fs.readFileSync(ttsCachePath(text));
    return new Response(new Uint8Array(buf), {
      headers: { ...headers, 'Content-Length': String(buf.length) },
    });
  }

  // 2) البث التدريجي أثناء التوليد
  try {
    const stream = await synthesizeStream(text);
    return new Response(stream, { headers });
  } catch (e) {
    return Response.json({ ok: false, error: String(e).slice(0, 160) }, { status: 503 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req, null);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  return handle(req, body);
}
