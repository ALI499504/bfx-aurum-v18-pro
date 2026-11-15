// ============================================================
// نظام التنبيهات الحي — تشغيل ذاتي كامل بلا تحكم يدوي
// ------------------------------------------------------------
// كل حدث جوهري في دورة حياة البوت يُولّد تنبيهاً:
//   • إشارة جديدة جاهزة للتنفيذ (استراتيجية/اتجاه/دخول/وقف/هدف)
//   • تنفيذ إشارة في وضع الظل (Shadow) ونتيجتها (هدف/وقف/زمني)
//   • قرارات المدير الآلي (تعطيل/تفعيل/قتل جلسة)
//   • ضربات صمامات المخاطر (يومي 3% / أسبوعي 6% / إيكويتي 15%)
// التنبيهات تُحفظ في سجل حي (آخر 150 حدثاً) وتُدفع فوراً إلى تليجرام
// عند ضبط التوكن من قاعدة البيانات (مفتاح settings الرئيسي — حقل
// telegram). غياب التوكن لا يعطل السجل أبداً — التنبيه يبقى محفوظاً.
// ============================================================
import { db } from '@/lib/db';

export type AlertKind = 'signal' | 'shadow' | 'auto' | 'fuse' | 'system' | 'live';

export interface BotAlert {
  id: number;
  t: number;            // UTC ms
  syria: string;        // وقت دمشق للعرض
  kind: AlertKind;
  title: string;
  body: string;
  delivered: 'telegram' | 'local' | 'sending' | 'failed';
}

const g = globalThis as unknown as {
  __bfxAlerts?: { list: BotAlert[]; nextId: number; seen: Set<string> };
  __bfxTgCfg?: { token: string | null; chatId: string | null; loadedAt: number };
};
const store = () =>
  g.__bfxAlerts ?? (g.__bfxAlerts = { list: [], nextId: 1, seen: new Set() });

const syriaStamp = (t: number) =>
  new Date(t + 3 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');

const KIND_ICON: Record<AlertKind, string> = {
  signal: '🎯', shadow: '📈', auto: '🤖', fuse: '🛡️', system: '⚙️', live: '⚡',
};

/** قراءة إعدادات تليجرام من صف البوت (token/chatId) — كاش 60 ثانية */
async function telegramCfg(): Promise<{ token: string | null; chatId: string | null }> {
  const cached = g.__bfxTgCfg;
  if (cached && Date.now() - cached.loadedAt < 60e3) return { token: cached.token, chatId: cached.chatId };
  let token: string | null = null, chatId: string | null = null;
  try {
    const row = await db.botSettings.findUnique({ where: { key: 'telegram' } });
    if (row) {
      const j = JSON.parse(row.json) as { botToken?: string; chatId?: string };
      token = j.botToken?.trim() || null;
      chatId = j.chatId?.trim() || null;
    }
  } catch { /* القاعدة غير متاحة — تنبيهات محلية فقط */ }
  g.__bfxTgCfg = { token, chatId, loadedAt: Date.now() };
  return { token, chatId };
}

/** تحديث إعدادات تليجرام + تفريغ الكاش فوراً */
export async function setTelegramCfg(botToken: string, chatId: string): Promise<void> {
  await db.botSettings.upsert({
    where: { key: 'telegram' },
    create: { key: 'telegram', json: JSON.stringify({ botToken, chatId }) },
    update: { json: JSON.stringify({ botToken, chatId }) },
  });
  g.__bfxTgCfg = { token: botToken.trim() || null, chatId: chatId.trim() || null, loadedAt: Date.now() };
}

export async function getTelegramCfg(): Promise<{ configured: boolean; chatId: string | null }> {
  const { token, chatId } = await telegramCfg();
  return { configured: !!token && !!chatId, chatId };
}

/** دفع رسالة إلى تليجرام — لا يرمي أبداً (مهلة 6 ثوانٍ وفشل صامت موثق) */
async function sendTelegram(token: string, chatId: string, text: string): Promise<'telegram' | 'failed'> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return res.ok ? 'telegram' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * توليد تنبيه — يُسجل دائماً في السجل الحي، ويُدفع إلى تليجرام إن كان مضبوطاً.
 * dedupeKey: مفتاح اختياري لمنع تكرار نفس الحدث (مفتاح إشارة مثلاً).
 */
export function pushAlert(kind: AlertKind, title: string, body: string, dedupeKey?: string): BotAlert | null {
  const s = store();
  if (dedupeKey) {
    if (s.seen.has(dedupeKey)) return null;
    s.seen.add(dedupeKey);
    if (s.seen.size > 2000) {
      // تقليم مفاتيح الأقدمية: نُبقي آخر 1000 (Set يحفظ ترتيب الإدراج)
      const arr = [...s.seen].slice(-1000);
      s.seen = new Set(arr);
      g.__bfxAlerts!.seen = s.seen;
    }
  }
  const t = Date.now();
  const alert: BotAlert = {
    id: s.nextId++, t, syria: syriaStamp(t), kind, title, body, delivered: 'sending',
  };
  s.list.unshift(alert);
  if (s.list.length > 150) s.list.length = 150;
  // الدفع إلى تليجرام في الخلفية — لا يعطل ولا يبطئ المتصل
  void (async () => {
    const { token, chatId } = await telegramCfg();
    if (!token || !chatId) { alert.delivered = 'local'; return; }
    const text = `${KIND_ICON[kind]} <b>${title}</b>\n${body}\n<i>${alert.syria} دمشق</i>`;
    alert.delivered = await sendTelegram(token, chatId, text);
  })();
  return alert;
}

/** قراءة السجل الحي */
export function getAlerts(limit = 50): BotAlert[] {
  return store().list.slice(0, Math.max(1, Math.min(limit, 150)));
}
