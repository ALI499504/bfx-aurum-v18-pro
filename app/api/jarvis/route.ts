import { NextRequest } from 'next/server';
import { agentTurn, hardenFinal, type TurnMemory } from '@/lib/server/jarvis/brain';
import { isAuthed, lockedResponse } from '@/lib/server/jarvis/auth';
import fs from 'node:fs';
import path from 'node:path';
import { JARVIS_SECTION_CLOSED } from '@/lib/jarvis-flag';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ============================================================
// جارفس — واجهة التنفيذ: بث مباشر NDJSON لكل خطوة لحظتها
// العقل الوكيل الحقيقي (عقل المساعد داخل جارفس):
//   دورة تفكير-تنفيذ متكررة حتى الإجابة النهائية الكاملة:
//   يقرر الأدوات ← ينفذها ← يشاهد النتائج الحقيقية ← يقرر مجدداً
//   — والإجابة النهائية تُبنى من النتائج الفعلية بأرقام حقيقية.
// {t:'step', label, detail, ok, ms} مع كل أداة تكتمل
// {t:'say', text} سرد شفهي لما يبدأ تنفيذه
// {t:'reply', reply, say, runMs} الإجابة النهائية
// {t:'error', message} عند عطل
// كل محادثة تُحفظ في db/jarvis-history.json (آخر 80 حواراً)
// ============================================================

const HIST_PATH = path.join(process.cwd(), 'db', 'jarvis-history.json');
const MAX_HIST = 80;

interface HistEntry { t: number; text: string; reply: string; steps: { label: string; ok: boolean; detail: string }[]; data?: unknown }

// القسم مغلق بقرار المالك — رد موحّد مهما كانت الجلسة صالحة (البوت نفسه يعمل طبيعياً)
function closedResponse() {
  return Response.json(
    { ok: false, closed: true, error: 'قسم جارفس — القلب النابض مغلق حالياً. البوت يعمل بشكل طبيعي.' },
    { status: 503 },
  );
}

function loadHistory(): HistEntry[] {
  try { return JSON.parse(fs.readFileSync(HIST_PATH, 'utf8')) as HistEntry[]; } catch { return []; }
}

function saveHistory(entries: HistEntry[]) {
  try {
    fs.mkdirSync(path.dirname(HIST_PATH), { recursive: true });
    const tmp = HIST_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entries.slice(-MAX_HIST)));
    fs.renameSync(tmp, HIST_PATH);
  } catch { /* الحفظ اختياري */ }
}

export { GET, POST } from './tools/route'
  if (JARVIS_SECTION_CLOSED) return closedResponse();
  if (!isAuthed(req)) return lockedResponse(); // خدمة مقفولة — لا تاريخ بلا جلسة
  const hist = loadHistory().slice(-40).reverse();
  return Response.json({ ok: true, history: hist });
}

export async function POST(req: NextRequest) {
  if (JARVIS_SECTION_CLOSED) return closedResponse();
  if (!isAuthed(req)) return lockedResponse(); // بواب القفل — لا تنفيذ بلا جلسة صالحة
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 600) : '';
  if (!text) return Response.json({ ok: false, error: 'نص الأمر مطلوب' }, { status: 400 });

  const started = Date.now();
  const steps: { label: string; ok: boolean; detail: string }[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + "\n")); } catch { /* أُغلق البث */ }
      };

      try {
        send({ t: 'step', label: 'استلام الأمر', detail: text, ok: true, ms: 0 });
        steps.push({ label: 'استلام الأمر', ok: true, detail: text });

        // ذاكرة المحادثة — آخر 4 حوارات (8 أدوار) لفهم ضمائر السياق
        const memory: TurnMemory[] = loadHistory().slice(-4).flatMap(h => [
          { role: 'user' as const, text: h.text },
          { role: 'jarvis' as const, text: h.reply.slice(0, 200) },
        ]);

        // العقل الوكيل: دورات تفكير-تنفيذ حتى الإجابة الكاملة
        let out;
        try {
          out = await agentTurn(text, memory, {
            onStep: s => {
              send({ t: 'step', label: s.label, detail: s.detail, ok: s.ok, ms: s.ms });
              steps.push({ label: s.label, ok: s.ok, detail: s.detail });
            },
            onSay: t => send({ t: 'say', text: t }),
          });
        } catch (e) {
          const msg = 'تعذر تشغيل عقل جارفس — أعد المحاولة بعد لحظات';
          send({ t: 'error', message: msg });
          steps.push({ label: 'العقل', ok: false, detail: String(e).slice(0, 120) });
          saveHistory([...loadHistory(), { t: started, text, reply: msg, steps }]);
          controller.close();
          return;
        }

        const runMs = Date.now() - started;
        // خط الدفاع الأخير: لا يصل للسيد أبداً رد فيه أي «سأخبرك/سأدرس» —
        // لو تسرب يُستبدل حتمياً بخلاصة النتائج المنفذة فعلاً
        const hardened = hardenFinal({ reply: out.reply, say: out.say }, steps, out.data);
        // data: نتائج الأدوات الغنية (بطاقة الباك تيست مثلاً) — تعرض على الشاشة، والرد يُنطق كاملاً
        send({ t: 'reply', reply: hardened.reply, say: hardened.say, runMs, data: hardened.data ?? null });
        steps.push({ label: 'الرد', ok: true, detail: hardened.say.slice(0, 80) });

        saveHistory([...loadHistory(), { t: started, text, reply: hardened.reply, steps, data: hardened.data ?? undefined }]);
        send({ t: 'done', runMs, turns: out.turns });
      } catch (e) {
        send({ t: 'error', message: String(e).slice(0, 200) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
