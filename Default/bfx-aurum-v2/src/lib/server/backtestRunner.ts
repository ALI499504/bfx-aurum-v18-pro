// ============================================================
// مشغّل الباك تيست المشترك — يحمل إعدادات البوت من قاعدة البيانات
// ويُستخدم من نقطة التشغيل اليدوي ومن نقطة التشغيل التلقائي
// (استدعاء الجسر بعد اكتمال سحب التاريخ العميق)
// ============================================================
import { db } from '@/lib/db';
import { DEFAULT_SETTINGS, Settings } from '@/lib/engine/rules';
import { enforceFrozenSettings } from '@/lib/engine/constitution';

export async function loadBotSettings(): Promise<Settings> {
  try {
    const row = await db.botSettings.findUnique({ where: { key: 'main' } });
    if (row) {
      const saved = JSON.parse(row.json) as Settings;
      // الدستور ينتصر: كل حقل مجمد يُعاد إلى قيمة المواصفة مهما كان المخزّن (قاعدة 2)
      return enforceFrozenSettings({
        ...DEFAULT_SETTINGS, ...saved,
        globalRules: { ...DEFAULT_SETTINGS.globalRules, ...(saved.globalRules ?? {}) },
        sessions: { ...DEFAULT_SETTINGS.sessions, ...(saved.sessions ?? {}) },
        indicators: { ...DEFAULT_SETTINGS.indicators, ...(saved.indicators ?? {}) },
        manualLevels: { ...DEFAULT_SETTINGS.manualLevels, ...(saved.manualLevels ?? {}) },
        priority: saved.priority?.length === 3 ? saved.priority : DEFAULT_SETTINGS.priority,
      });
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
