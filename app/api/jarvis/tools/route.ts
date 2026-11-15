import { NextRequest } from 'next/server';
import { toolsCatalog, TOOLS } from '@/lib/server/jarvis/tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  const catalog = toolsCatalog();
  const toolIds = Object.keys(TOOLS);
  return Response.json({
    ok: true,
    tools: toolIds,
    catalog,
    count: toolIds.length,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const strategies = Array.isArray(body?.strategies) ? body.strategies.map(String) : [];
  const sessions = typeof body?.sessions === 'string' ? body.sessions : 'all';
  const enabled = body?.enabled !== false;

  const catalog = toolsCatalog();
  const selected = strategies.filter((s) => TOOLS[s as keyof typeof TOOLS]);

  // تنفيذ منطقي بسيط — يمكن استبداله بتنفيذ حقيقي داخل الـ engine.
  // هنا نرجع حالة التفعيل ونوع الأداة المطلوبة.
  if (strategies.length === 0) {
    return Response.json({
      ok: false,
      error: 'يجب تحديد استراتيجية على الأقل',
    }, { status: 400 });
  }

  // نخزن حالة الإعداد مؤقتاً في الـ response (يمكن ربطها بقاعدة البيانات لاحقاً)
  const result = {
    ok: true,
    enabled,
    sessions,
    selected,
    catalog: catalog.slice(0, 5), // عرض مختصر من الكاتالوج
  };

  return Response.json(result);
}
