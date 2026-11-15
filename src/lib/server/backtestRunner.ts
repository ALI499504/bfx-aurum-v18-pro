// ============================================================
// مشغّل الباك تيست المشترك — يحمل إعدادات البوت من قاعدة البيانات
// ويُستخدم من نقطة التشغيل اليدوي ومن نقطة التشغيل التلقائي
// (استدعاء الجسر بعد اكتمال سحب التاريخ العميق)
// ============================================================
import { db } from '@/lib/db';
import { DEFAULT_SETTINGS, Settings } from '@/lib/engine/rules';
import { enforceFrozenSettings } from '@/lib/engine/constitution';

/** دمج عميق مع الافتراضيات — شجرة TAMSA تتوسع دون فقدان تعديلات المستخدم */
function mergeDeep(base: unknown, saved: unknown): Record<string, unknown> {
  const b = (base ?? {}) as Record<string, unknown>;
  const s = (saved ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = structuredClone(b);
  for (const k of Object.keys(s)) {
    const bv = b[k], sv = s[k];
    if (bv && typeof bv === 'object' && !Array.isArray(bv) && sv && typeof sv === 'object' && !Array.isArray(sv)) out[k] = mergeDeep(bv, sv);
    else if (sv !== undefined) out[k] = sv;
  }
  return out;
}

export async function loadBotSettings(): Promise<Settings> {
  try {
    const row = await db.botSettings.findUnique({ where: { key: 'main' } });
    if (row) {
      const saved = JSON.parse(row.json) as Settings;
      const def = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
      const sv = saved as unknown as Record<string, unknown>;
      return enforceFrozenSettings({
        ...def, ...sv,
        globalRules: { ...(def.globalRules as object), ...(sv.globalRules ?? {}) },
        strategyParams: mergeDeep(def.strategyParams, sv.strategyParams),
        scenarioSessions: mergeDeep(def.scenarioSessions, sv.scenarioSessions),
        indicators: { ...(def.indicators as object), ...(sv.indicators ?? {}) },
        manualLevels: { ...(def.manualLevels as object), ...(sv.manualLevels ?? {}) },
        priorityLadder: { ...(def.priorityLadder as object), ...(sv.priorityLadder ?? {}) },
      } as unknown as Settings);
    }
  } catch { /* الافتراضيات */ }
  return DEFAULT_SETTINGS;
}

export interface RealNewsEvent { t: number; name: string; impact?: string }

/**
 * أخبار حقيقية عالية التأثير مخزنة من /api/news (تقويم ForexFactory الأسبوعي).
 * هذه هي الوحيدة التي يستخدمها فلتر الأخبار — لا تقويم تقريبي ولا مواعيد مولّدة.
 * إن لم تتوفر أخبار حقيقية يعمل الباك تيست/المحرك بلا فلتر أخبار بدل اختراع مواعيد.
 */
export async function loadRealNews(): Promise<RealNewsEvent[]> {
  try {
    const row = await db.botSettings.findUnique({ where: { key: 'newsCache' } });
    if (!row) return [];
    const j = JSON.parse(row.json) as { updatedAt?: number; events?: RealNewsEvent[] };
    if (!j?.events?.length) return [];
    if (j.updatedAt && Date.now() - j.updatedAt > 7 * 86400e3) return []; // أسبوع كحد أقصى
    return j.events;
  } catch { return []; }
}

/** ملخص مختصر للنتيجة — تطبعه نافذة الجسر وتستخدمه نقطة التشغيل التلقائي */
export function summarizeStats(s: {
  totalTrades: number; wins: number; losses: number; winRate: number;
  netPnl: number; profitFactor: number; maxDrawdownPct: number;
}) {
  return {
    totalTrades: s.totalTrades,
    wins: s.wins,
    losses: s.losses,
    winRate: Math.round(s.winRate * 10) / 10,
    netPnl: Math.round(s.netPnl * 100) / 100,
    profitFactor: Math.round(s.profitFactor * 100) / 100,
    maxDrawdownPct: Math.round(s.maxDrawdownPct * 10) / 10,
  };
}
