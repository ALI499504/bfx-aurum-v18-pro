import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { DEFAULT_SETTINGS, Settings } from '@/lib/engine/rules';
import { enforceFrozenSettings, guardFrozenPatches, guardFrozenSettings, pushRefusal } from '@/lib/engine/constitution';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const row = await db.botSettings.findUnique({ where: { key: 'main' } });
    if (!row) return NextResponse.json({ settings: DEFAULT_SETTINGS });
    const saved = JSON.parse(row.json) as Settings;
    // دمج مع الافتراضيات لتغطية أي مفاتيح ناقصة
    const settings: Settings = enforceFrozenSettings({
      ...DEFAULT_SETTINGS,
      ...saved,
      globalRules: { ...DEFAULT_SETTINGS.globalRules, ...(saved.globalRules ?? {}) },
      sessions: { ...DEFAULT_SETTINGS.sessions, ...(saved.sessions ?? {}) },
      indicators: { ...DEFAULT_SETTINGS.indicators, ...(saved.indicators ?? {}) },
      manualLevels: { ...DEFAULT_SETTINGS.manualLevels, ...(saved.manualLevels ?? {}) },
      priority: saved.priority?.length === 3 ? saved.priority : DEFAULT_SETTINGS.priority,
    });
    // updatedAt = بصمة الإصدار — يستعملها كل متصفح مفتوح لكشف تغييرات المستخدمين الآخرين (مزامنة لحظية)
    return NextResponse.json({ settings, updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null });
  } catch {
    return NextResponse.json({ settings: DEFAULT_SETTINGS, updatedAt: null });
  }
}

/** تطبيق مصفوفة JSON Patch مبسطة (replace/add بمسار /a/b/c) على كائن */
function applyPatches<T extends Record<string, unknown>>(obj: T, patches: { op: string; path: string; value: unknown }[]): T {
  const out = structuredClone(obj) as Record<string, unknown>;
  for (const p of patches) {
    const parts = p.path.split('/').filter(Boolean).map(s => decodeURIComponent(s));
    if (!parts.length) continue;
    let cur: Record<string, unknown> = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {};
      cur = cur[k] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1];
    if (p.op === 'remove') delete cur[last];
    else cur[last] = p.value;
  }
  return out as T;
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  try {
    if (Array.isArray(body?.patches)) {
      // الحفظ الجزئي: تُطبق الفروق فوق المخزَّن حالياً — تاب قديم لا يمسح ما لم يغيّره
      const prev = await db.botSettings.findUnique({ where: { key: 'main' } });
      const current = prev ? (JSON.parse(prev.json) as Record<string, unknown>) : (structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>);
      // حارس الدستور: أي فرق يمس الأرقام المجمدة في المواصفة يُرفض ويُسجّل سبب رفضه (القاعدة 7)
      const { allowedPatches, refused } = guardFrozenPatches(body.patches, current);
      for (const r of refused) pushRefusal('واجهة الإعدادات (فرق)', `${r.path} = ${JSON.stringify(r.attempted)}`, r.reason);
      if (!allowedPatches.length && body.patches.length) {
        return NextResponse.json({ ok: false, refused, error: `رفض كامل (القاعدة 7): كل الفروق تمس أرقاماً مجمدة في المواصفة — ${refused[0]?.reason ?? ''}` }, { status: 403 });
      }
      const merged = applyPatches(current, allowedPatches);
      const row = await db.botSettings.upsert({
        where: { key: 'main' },
        create: { key: 'main', json: JSON.stringify(merged) },
        update: { json: JSON.stringify(merged) },
      });
      return NextResponse.json({ ok: true, merged: true, applied: allowedPatches.length, refused, updatedAt: new Date(row.updatedAt).toISOString() });
    }
    const settings = body?.settings;
    if (!settings) return NextResponse.json({ error: 'settings مطلوبة' }, { status: 400 });
    // حارس الدستور على الحفظ الكامل: الحقول المجمدة تبقى على قيمها المخزّنة
    // وأي محاولة تغييرها تُرفض وتُسجّل (القاعدة 2 + 7) — بقية التعديلات المسموحة تُطبق
    const prevFull = await db.botSettings.findUnique({ where: { key: 'main' } });
    const currentFull = prevFull ? (JSON.parse(prevFull.json) as Record<string, unknown>) : (structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>);
    const { payload, refused: refusedFull } = guardFrozenSettings(settings as Record<string, unknown>, currentFull);
    for (const r of refusedFull) pushRefusal('واجهة الإعدادات (حفظ كامل)', `${r.path} = ${JSON.stringify(r.attempted)}`, r.reason);
    const row = await db.botSettings.upsert({
      where: { key: 'main' },
      create: { key: 'main', json: JSON.stringify(payload) },
      update: { json: JSON.stringify(payload) },
    });
    return NextResponse.json({ ok: true, refused: refusedFull, updatedAt: new Date(row.updatedAt).toISOString() });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
