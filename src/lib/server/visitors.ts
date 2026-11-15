// ============================================================
// سجل الزوار — Visitor Registry (لحظي دقيق)
// يعرض فقط الأجهزة المتصلة فعلياً في هذه اللحظة:
// • نبضة كل 15 ثانية من كل تبويب مفتوح
// • إشعار مغادرة فوري (sendBeacon) عند إغلاق التبويب — يختفي الجهاز لحظياً
// • يُعد متصلاً فقط إذا وصلت نبضته خلال آخر 65 ثانية (بدون leftAt)
// • معرّف مجهول يولّده المتصفح (localStorage) — لا كوكيز تتبع ولا بيانات شخصية
// • يُحفظ في db/visitors.json (كتابة ذرية) — يبقى بعد إعادة تشغيل السيرفر
// • المعلومات: المتصفح، النظام، نوع الجهاز، اللغة، المنطقة الزمنية،
//   الشاشة والإطار، IP، الشاشة المفتوحة حالياً (التبويب)، الفريم المعروض،
//   بداية الجلسة ومدتها، مصدر الدخول، أول زيارة، آخر نبضة
// لا يؤثر على أي منطق آخر — سجل للعرض فقط.
// ============================================================
import { promises as fs } from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'db', 'visitors.json');
const ONLINE_MS = 65_000;        // متصل فعلياً = نبضة خلال آخر 65 ثانية فقط (النبضة كل 15ث)
const SESSION_GAP_MS = 30 * 60_000; // فجوة أكبر من 30 دقيقة = جلسة جديدة
const MAX_ENTRIES = 200;         // سقف السجل — تُحذف الأقدم نشاطاً

export interface VisitorUA {
  browser: string;
  os: string;
  device: string; // 'حاسوب' | 'هاتف' | 'لوحي'
}

export interface VisitorRecord {
  id: string;
  firstSeen: number;      // أول زيارة على الإطلاق
  lastSeen: number;       // آخر نبضة
  since: number;          // بداية الجلسة الحالية (تُحسب في الخادم)
  sessions: number;       // عدد الجلسات المميزة
  heartbeats: number;     // إجمالي النبضات
  ip: string;             // عنوان الشبكة
  ua: VisitorUA;
  screen: string;         // دقة الشاشة 1920×1080
  viewport: string;       // حجم نافذة المتصفح
  lang: string;           // لغة المتصفح
  tz: string;             // المنطقة الزمنية
  tab: string;            // الشاشة المفتوحة حالياً (dashboard/trades/...)
  tf: string;             // الفريم الزمني المعروض
  referrer: string;       // مصدر الدخول (hostname أو فارغ = مباشر)
  leftAt?: number;        // لحظة المغادرة الفعلية (إغلاق التبويب) — يُحذف عند العودة
}

interface Registry {
  v: 1;
  visitors: Record<string, VisitorRecord>;
}

const memory: { reg: Registry | null } = { reg: null };

/** تحليل User-Agent إلى متصفح/نظام/جهاز — بدون مكتبات خارجية */
export function parseUA(uaRaw: string): VisitorUA {
  const ua = (uaRaw || '').slice(0, 220);
  // المتصفح
  let browser = 'متصفح آخر';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua) || /Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
  else if (/Chromium/.test(ua)) browser = 'Chromium';
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari';
  else if (/curl/.test(ua)) browser = 'curl';
  // النظام
  let os = 'نظام آخر';
  if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = /Android (\d+)/.exec(ua)?.[1] ? `Android ${/Android (\d+)/.exec(ua)![1]}` : 'Android';
  else if (/iPhone/.test(ua)) os = 'iOS (iPhone)';
  else if (/iPad/.test(ua)) os = 'iPadOS';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  // الجهاز
  let device = 'حاسوب';
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) device = 'لوحي';
  else if (/Mobile|iPhone|Android.*Mobile/.test(ua)) device = 'هاتف';
  return { browser, os, device };
}

async function load(): Promise<Registry> {
  if (memory.reg) return memory.reg;
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    const j = JSON.parse(raw) as Registry;
    if (j && j.visitors && typeof j.visitors === 'object') {
      memory.reg = j;
      return j;
    }
  } catch { /* أول مرة — لا ملف بعد */ }
  memory.reg = { v: 1, visitors: {} };
  return memory.reg;
}

/** كتابة ذرية: ملف مؤقت فريد لكل كتابة ثم إعادة تسمية —
 *  اسم tmp ثابت كان يسبب سباقاً بين نبضات متزامنة (فشل rename → خطأ 500) */
async function save(reg: Registry): Promise<void> {
  const tmp = `${FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(reg), 'utf8');
  await fs.rename(tmp, FILE).catch(e => { fs.unlink(tmp).catch(() => {}); throw e; });
}

function clientIp(h: Headers): string {
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return h.get('x-real-ip') || h.get('cf-connecting-ip') || 'غير معروف';
}

const clean = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.slice(0, max) : '';

/** تسجيل نبضة زائر — تُنشئ أو تُحدّث السجل وترجع النسخة بعد التحديث */
export async function heartbeat(opts: {
  id: string;
  ip: string;
  uaRaw: string;
  screen?: string;
  viewport?: string;
  lang?: string;
  tz?: string;
  tab?: string;
  tf?: string;
  referrer?: string;
}): Promise<VisitorRecord> {
  const reg = await load();
  const now = Date.now();
  const id = opts.id.slice(0, 64);
  const prev = reg.visitors[id];
  // جلسة جديدة إن مرّت فجوة كبيرة أو الزائر جديد
  const isNewSession = !prev || (now - prev.lastSeen) > SESSION_GAP_MS;
  const rec: VisitorRecord = {
    id,
    firstSeen: prev?.firstSeen ?? now,
    lastSeen: now,
    since: isNewSession ? now : (prev.since ?? now),
    sessions: (prev?.sessions ?? 0) + (isNewSession ? 1 : 0),
    heartbeats: (prev?.heartbeats ?? 0) + 1,
    ip: opts.ip,
    ua: parseUA(opts.uaRaw),
    screen: clean(opts.screen, 12) || prev?.screen || '',
    viewport: clean(opts.viewport, 12) || prev?.viewport || '',
    lang: clean(opts.lang, 12) || prev?.lang || '',
    tz: clean(opts.tz, 40) || prev?.tz || '',
    tab: clean(opts.tab, 20),
    tf: clean(opts.tf, 6),
    referrer: clean(opts.referrer, 60),
  };
  delete rec.leftAt; // عاد الجهاز — نبضة حية تلغي أي مغادرة سابقة
  reg.visitors[id] = rec;
  // تقليم السجل: أبقِ الأحدث نشاطاً فقط
  const ids = Object.keys(reg.visitors);
  if (ids.length > MAX_ENTRIES) {
    ids.sort((a, b) => reg.visitors[a].lastSeen - reg.visitors[b].lastSeen);
    for (const old of ids.slice(0, ids.length - MAX_ENTRIES)) delete reg.visitors[old];
  }
  await save(reg);
  return rec;
}

/** إشعار مغادرة فوري — يُستدعى عند إغلاق التبويب فيختفي الجهاز من القائمة لحظياً */
export async function leaveVisitor(id: string): Promise<boolean> {
  const reg = await load();
  const rec = reg.visitors[id];
  if (!rec) return false;
  rec.leftAt = Date.now();
  await save(reg);
  return true;
}

/** هل الجهاز متصل فعلياً في هذه اللحظة؟ (نبضة حية خلال ONLINE_MS وبدون مغادرة) */
function isLive(v: VisitorRecord, now: number): boolean {
  return !v.leftAt && now - v.lastSeen <= ONLINE_MS;
}

/** قائمة الأجهزة المتصلة فعلياً الآن فقط — لحظية ودقيقة */
export async function listVisitors(): Promise<{
  online: number;
  total: number;
  now: number;
  visitors: VisitorRecord[];
}> {
  const reg = await load();
  const now = Date.now();
  const visitors = Object.values(reg.visitors)
    .filter(v => isLive(v, now))
    .sort((a, b) => b.lastSeen - a.lastSeen);
  return { online: visitors.length, total: visitors.length, now, visitors };
}
