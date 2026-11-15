import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { DEFAULT_SETTINGS, Settings } from '@/lib/engine/rules';
import { enforceFrozenSettings, guardFrozenPatches, guardFrozenSettings, pushRefusal } from '@/lib/engine/constitution';
import { ensureSettingsSeeded } from '@/lib/server/seedSettings';

export const dynamic = 'force-dynamic';

/** دمج عميق: الأوراق الناقصة تُأخذ من الافتراضي — شجرة الاستراتيجيات تتوسع دون فقدان تعديلات المستخدم */
function mergeDeep(base: unknown, saved: unknown): Record<string, unknown> {
  const b = (base ?? {}) as Record<string, unknown>;
  const s = (saved ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = structuredClone(b);
  for (const k of Object.keys(s)) {
    const bv = b[k], svv = s[k];
    if (bv && typeof bv === 'object' && !Array.isArray(bv) && svv && typeof svv === 'object' && !Array.isArray(svv)) {
      out[k] = mergeDeep(bv, svv);
    } else if (svv !== undefined) {
      out[k] = svv;
    }
  }
  return out;
}

export async function GET() {
  try {
    await ensureSettingsSeeded();
    const row = await db.botSettings.findUnique({ where: { key: 'main' } });
    if (!row) return NextResponse.json({ settings: DEFAULT_SETTINGS });
    const saved = JSON.parse(row.json) as Settings;
    // دمج مع الافتراضيات لتغطية أي مفاتيح ناقصة (شجرة TAMSA الكاملة)
    const def = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    const sv = saved as unknown as Record<string, unknown>;
    const settings = enforceFrozenSettings({
      ...def,
      ...sv,
      globalRules: { ...(def.globalRules as object), ...(sv.globalRules ?? {}) },
      strategyParams: mergeDeep(def.strategyParams, sv.strategyParams),
      scenarioSessions: mergeDeep(def.scenarioSessions, sv.scenarioSessions),
      indicators: { ...(def.indicators as object), ...(sv.indicators ?? {}) },
      manualLevels: { ...(def.manualLevels as object), ...(sv.manualLevels ?? {}) },
      priorityLadder: { ...(def.priorityLadder as object), ...(sv.priorityLadder ?? {}) },
    } as unknown as Settings);
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
