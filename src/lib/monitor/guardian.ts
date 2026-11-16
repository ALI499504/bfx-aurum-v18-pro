// ============================================================
// الوكيل الحارس — Guardian Agent (server-only)
// وكيل مراقبة وإصلاح تلقائي يعمل على مدار الساعة داخل عملية
// الخادم نفسها (يُقلع تلقائياً مع الإقلاع عبر instrumentation).
//
// ماذا يراقب كل 30 ثانية:
// • قاعدة البيانات (Prisma/SQLite) — فحص الاتصال وإعادة ربطه تلقائياً
// • بثّ MT5 الحيّ — رصد انقطاع الجسر وعمر آخر دفعة شموع حقيقية
// • لقطة القرص db/mt5-feed-snapshot.json — كشف التلف/القِدم وإعادة كتابتها
// • كاش الأخبار (ForexFactory) — تجديده تلقائياً من المصدر عند انتهاء صلاحيته
// • إعدادات البوت BotSettings(main) — كشف التلف واستعادة الافتراضيات فوراً
// • محرك التنبؤ — اختبار ذاتي دوري: هل يُنتج 12 شمعة متوقعة صالحة OHLC؟
// • ذاكرة العملية — رصد الاستهلاك المرتفع قبل أن يقتل الخادم
//
// كل عملية إصلاح تُسجَّل في سجل أحداث يُعرض لحظياً في لوحة الحارس
// ويُحفظ في db/guardian-log.json (يبقى بعد إعادة التشغيل).
// الوكيل لا يلمس أي منطق تداول أو إشارات — قراءة وفحص وإصلاح بنية تحتية فقط.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { db } from '@/lib/db';
import { DEFAULT_SETTINGS } from '@/lib/engine/rules';
import { settingsSeedRaw } from '@/lib/server/seedSettings';
import { buildForecast } from '@/lib/engine/forecast';
import { getEngineData } from '@/lib/server/data';
import { mt5Feed, forceWriteSnapshot, MT5_FRESH_MS } from '@/lib/server/mt5feed';

// ---------- الأنواع ----------
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';
export type EventLevel = 'info' | 'fix' | 'warn' | 'critical';
export type GuardianStatus = 'healthy' | 'degraded' | 'healing' | 'critical';

export interface CheckResult {
  id: string;
  label: string;      // بالعربية
  status: CheckStatus;
  detail: string;     // بالعربية
  ms: number;
}

export interface GuardianEvent {
  t: number;
  level: EventLevel;
  action: string;     // بالعربية
  detail: string;     // بالعربية
}

export interface GuardianReport {
  status: GuardianStatus;
  now: number;
  startedAt: number;
  uptimeSec: number;
  cycles: number;
  heals: number;
  fixes: number;
  lastCycleMs: number;
  lastCycleAt: number;
  nextCycleInSec: number;
  healingNow: boolean;
  checks: CheckResult[];
  events: GuardianEvent[];   // الأحدث أولاً
  mem: { rssMb: number; heapMb: number };
  node: string;
}

// ---------- ثوابت ----------
const CYCLE_MS = 30_000;            // دورة مراقبة كل 30 ثانية
const NEWS_TTL_MS = 6 * 3600e3;     // صلاحية كاش الأخبار (كما في /api/news)
const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const LOG_PATH = path.join(process.cwd(), 'db', 'guardian-log.json');
const MAX_EVENTS = 120;
const ENGINE_TEST_EVERY = 5;        // اختبار ذاتي للمحرك كل 5 دورات (~2.5 دقيقة)
const SNAP_STALE_MS = 10 * 60_000;  // لقطة أقدم من 10 دقائق والبث حي = تحتاج حفظاً

interface NewsCache { updatedAt: number; events: { t: number; name: string; impact: string; country: string }[] }

// ---------- الوكيل ----------
class Guardian {
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private healingNow = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;

  startedAt = 0;
  cycles = 0;
  heals = 0;
  fixes = 0;
  lastCycleMs = 0;
  lastCycleAt = 0;
  checks: CheckResult[] = [];
  events: GuardianEvent[] = [];

  // ----- سجل الأحداث -----
  private loadLog() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const j = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')) as { events?: GuardianEvent[] };
      if (Array.isArray(j?.events)) this.events = j.events.slice(-MAX_EVENTS);
    } catch { /* أول مرة — لا سجل بعد */ }
  }

  event(level: EventLevel, action: string, detail: string) {
    this.loadLog();
    this.events.push({ t: Date.now(), level, action, detail });
    if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS);
    const tag = level === 'critical' ? '🚨' : level === 'fix' ? '🔧' : level === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`[guardian] ${tag} ${action} — ${detail}`);
    // حفظ مؤجل ذري — مرة كل ثانيتين كحد أقصى
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
        const tmp = LOG_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ v: 1, events: this.events }));
        fs.renameSync(tmp, LOG_PATH);
      } catch { /* الحفظ اختياري */ }
    }, 2000);
    this.saveTimer.unref?.();
  }

  // ----- الإقلاع -----
  start() {
    this.loadLog();
    if (this.timer || this.bootTimer) return;
    this.startedAt = Date.now();
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      void this.runCycle(false);
      this.timer = setInterval(() => void this.runCycle(false), CYCLE_MS);
    }, 2000);
    this.bootTimer.unref?.();
    console.log('[guardian] 🛡️ الوكيل الحارس أقلع — مراقبة كل 30 ثانية على مدار الساعة');
    this.event('info', 'الوكيل الحارس', 'أقلع مع الخادم — مراقبة لحظية وإصلاح تلقائي كل 30 ثانية');
  }

  // ----- دورة المراقبة -----
  async runCycle(healMode: boolean): Promise<GuardianReport> {
    if (this.running) return this.report();
    this.running = true;
    if (healMode) { this.heals++; this.healingNow = true; }
    const t0 = Date.now();
    const checks: CheckResult[] = [];

    const run = async (id: string, label: string, fn: () => Promise<CheckResult>) => {
      const s = Date.now();
      try { checks.push(await fn()); }
      catch (e) {
        checks.push({ id, label, status: 'fail', detail: `استثناء غير متوقع: ${String(e).slice(0, 120)}`, ms: Date.now() - s });
      }
    };

    try {
      await run('db', 'قاعدة البيانات', () => this.checkDb());
      await run('feed', 'بثّ MT5 الحي', () => this.checkFeed(healMode));
      await run('snapshot', 'لقطة القرص', () => this.checkSnapshot(healMode));
      await run('settings', 'إعدادات البوت', () => this.checkSettings());
      await run('news', 'كاش الأخبار', () => this.checkNews());
      await run('engine', 'محرك التنبؤ', () => this.checkEngine(healMode));
      await run('memory', 'ذاكرة العملية', () => Promise.resolve(this.checkMemory()));
    } finally {
      this.running = false;
      if (healMode) this.healingNow = false;
    }

    this.checks = checks;
    this.cycles += 1;
    this.lastCycleMs = Date.now() - t0;
    this.lastCycleAt = Date.now();
    return this.report();
  }

  /** إصلاح يدوي/تلقائي — دورة كاملة مع تفعيل كل إجراءات الإصلاح */
  async runHeal(): Promise<GuardianReport> {
    this.event('info', 'دورة إصلاح', 'بدأت دورة فحص وإصلاح شاملة');
    const rep = await this.runCycle(true);
    const bad = rep.checks.filter(c => c.status === 'fail');
    if (!bad.length) this.event('fix', 'دورة إصلاح', `اكتملت بنجاح — كل الفحوصات سليمة (${this.lastCycleMs}ms)`);
    else this.event('critical', 'دورة إصلاح', `اكتملت وما زالت ${bad.length} مشكلة قائمة: ${bad.map(b => b.label).join('، ')}`);
    return rep;
  }

  // ----- الفحوصات -----

  /** 1) قاعدة البيانات — فحص + إعادة اتصال تلقائية عند الفشل */
  private async checkDb(): Promise<CheckResult> {
    const t0 = Date.now();
    const mk = (status: CheckStatus, detail: string): CheckResult =>
      ({ id: 'db', label: 'قاعدة البيانات', status, detail, ms: Date.now() - t0 });
    try {
      await db.$queryRaw`SELECT 1`;
      return mk('ok', 'الاتصال سليم (SQLite/Prisma)');
    } catch {
      // إصلاح تلقائي: فصل ثم إعادة اتصال وإعادة الاختبار
      try {
        await db.$disconnect().catch(() => { /* تجاهل */ });
        await db.$connect();
        await db.$queryRaw`SELECT 1`;
        this.fixes++;
        this.event('fix', 'قاعدة البيانات', 'انقطع الاتصال وأُعيد ربطه تلقائياً — الفحص نجح بعد الإصلاح');
        return mk('ok', 'انقطع وأُصلح تلقائياً — إعادة الاتصال نجحت');
      } catch (e2) {
        this.event('critical', 'قاعدة البيانات', `تعذر الوصول للقاعدة حتى بعد إعادة الاتصال: ${String(e2).slice(0, 120)}`);
        return mk('fail', 'تعذر الوصول للقاعدة — أُعيدت المحاولة تلقائياً وفشلت');
      }
    }
  }

  /** 2) بثّ MT5 الحي — رصد انقطاع الجسر (الإصلاح الفعلي لدى الجسر على جهاز المستخدم) */
  private async checkFeed(healMode: boolean): Promise<CheckResult> {
    const t0 = Date.now();
    const s = mt5Feed();
    const n = Object.values(s.tfs).reduce((a, b) => a + (b?.length ?? 0), 0);
    const mk = (status: CheckStatus, detail: string): CheckResult =>
      ({ id: 'feed', label: 'بثّ MT5 الحي', status, detail, ms: Date.now() - t0 });

    if (!s.updatedAt) {
      return mk('skip', 'لم يتصل الجسر بعد — بانتظار أول دفعة شموع من طرفية MT5 على جهازك');
    }
    const age = Date.now() - s.updatedAt;
    if (age <= MT5_FRESH_MS) {
      // البث حي — في وضع الإصلاح نضمن حفظ لقطة محدثة على القرص (حماية من الفقد)
      if (healMode && n > 0) {
        const ok = forceWriteSnapshot();
        if (ok) { this.fixes++; this.event('fix', 'لقطة القرص', `حُفظت لقطة محدثة (${n.toLocaleString('en')} شمعة) حمايةً من فقدان البيانات`); }
      }
      return mk('ok', `الجسر متصل — آخر دفعة قبل ${Math.round(age / 1000)} ثانية · ${n.toLocaleString('en')} شمعة حقيقية · v${s.bridgeV ?? '؟'}`);
    }
    if (age <= 15 * 60_000) {
      return mk('warn', `الجسر صامت منذ ${Math.round(age / 60000)} دقيقة — إعادة الاتصال التلقائية تعمل من جهة جهازك (سكربت الجسر v20+)`);
    }
    this.event('warn', 'بثّ MT5', `انقطع بث الشموع منذ ${Math.round(age / 60000)} دقيقة — شغّل سكربت الجسر على جهازك إن استمر الانقطاع`);
    return mk('fail', `انقطع البث منذ ${Math.round(age / 60000)} دقيقة — سكربت الجسر يعيد الاتصال تلقائياً عند عودة الطرفية`);
  }

  /** 3) لقطة القرص — كشف التلف/الغياب/القِدم وإعادة الكتابة تلقائياً */
  private async checkSnapshot(healMode: boolean): Promise<CheckResult> {
    const t0 = Date.now();
    const SNAP = path.join(process.cwd(), 'db', 'mt5-feed-snapshot.json');
    const mk = (status: CheckStatus, detail: string): CheckResult =>
      ({ id: 'snapshot', label: 'لقطة القرص', status, detail, ms: Date.now() - t0 });
    const feed = mt5Feed();
    const feedHasData = !!feed.updatedAt && Object.keys(feed.tfs).length > 0;

    let raw: string | null = null;
    try { raw = fs.readFileSync(SNAP, 'utf8'); } catch { raw = null; }

    if (raw === null) {
      if (feedHasData) {
        const ok = forceWriteSnapshot();
        if (ok) { this.fixes++; this.event('fix', 'لقطة القرص', 'اللقطة كانت مفقودة وأُعيد إنشاؤها تلقائياً من البيانات الحية'); return mk('ok', 'كانت مفقودة — أُنشئت تلقائياً'); }
        return mk('warn', 'مفقودة ولم تتوفر بيانات كافية لإعادة إنشائها بعد');
      }
      return mk('skip', 'لا لقطة بعد — تُنشأ تلقائياً مع أول بيانات حية');
    }
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      const tfs = (j.tfs && typeof j.tfs === 'object' ? j.tfs : null) as Record<string, unknown> | null;
      const savedAt = typeof j.savedAt === 'number' ? j.savedAt : 0;
      if (!tfs || !Object.keys(tfs).length) throw new Error('بنية اللقطة فارغة');
      // لقطة قديمة والبث حي أحدث منها — أعد الحفظ
      if (feedHasData && savedAt && Date.now() - savedAt > SNAP_STALE_MS && feed.updatedAt > savedAt) {
        const ok = forceWriteSnapshot();
        if (ok) { this.fixes++; this.event('fix', 'لقطة القرص', 'اللقطة كانت قديمة عن البث الحي — أعيد حفظها تلقائياً'); return mk('ok', 'كانت قديمة — حُفظت نسخة محدثة'); }
      }
      return mk('ok', `سليمة — آخر حفظ قبل ${savedAt ? Math.round((Date.now() - savedAt) / 60000) : '؟'} دقيقة`);
    } catch {
      // لقطة تالفة — الإصلاح: إعادة الكتابة من البيانات الحية
      if (feedHasData) {
        const ok = forceWriteSnapshot();
        if (ok) { this.fixes++; this.event('fix', 'لقطة القرص', 'اللقطة كانت تالفة (JSON غير صالح) وأُعيدت كتابتها تلقائياً من البيانات الحية'); return mk('ok', 'كانت تالفة — أُصلحت تلقائياً'); }
      }
      this.event('critical', 'لقطة القرص', 'اللقطة تالفة ولا توجد بيانات حية لإصلاحها الآن — ستُستبدل مع أول دفعة من الجسر');
      return mk('fail', 'اللقطة تالفة — بانتظار بيانات الجسر لإعادة كتابتها');
    }
  }

  /** 4) إعدادات البوت — كشف الغياب/التلف واستعادة البذرة المعتمدة تلقائياً */
  private async checkSettings(): Promise<CheckResult> {
    const t0 = Date.now();
    const mk = (status: CheckStatus, detail: string): CheckResult =>
      ({ id: 'settings', label: 'إعدادات البوت', status, detail, ms: Date.now() - t0 });
    try {
      // الإصلاح يزرع البذرة المعتمدة (db/settings-seed.json) لا الافتراضيات —
      // سباق الإقلاع على Render: لو سبق الحارس أول قراءة إعدادات كان يزرع
      // DEFAULT_SETTINGS (8 استراتيجيات) بدل البذرة المعتمدة (10: A,AA,E,F,H,K,L,M,N,X)
      // فتختلف نتيجة الباك تيست من نشر لآخر بصمت. البذرة أولى دائماً.
      const seedRaw = settingsSeedRaw();
      const restoreJson = seedRaw ?? JSON.stringify(DEFAULT_SETTINGS);
      const fromSeed = seedRaw !== null;
      const restoreMsg = fromSeed ? 'البذرة المعتمدة' : 'الإعدادات الافتراضية';
      const row = await db.botSettings.findUnique({ where: { key: 'main' } });
      if (!row) {
        await db.botSettings.upsert({
          where: { key: 'main' },
          create: { key: 'main', json: restoreJson },
          update: { json: restoreJson },
        });
        this.fixes++;
        this.event('fix', 'الإعدادات', `لم تكن موجودة — زُرعت ${restoreMsg} تلقائياً`);
        return mk('ok', `كانت مفقودة — زُرعت ${restoreMsg} تلقائياً`);
      }
      try {
        const parsed = JSON.parse(row.json) as Record<string, unknown>;
        // بنية TAMSA الصحيحة: globalRules + strategyParams (+ بقية المفاتيح الاختيارية)
        // (الفحص القديم كان يبحث عن lot/spreadCents في الجذر — بنية النظام القديم قبل
        //  إعادة البناء وفق الدليل — فكان يعيد ضبط إعدادات المستخدم كل دورة خطأً)
        const shaped = !!(parsed && typeof parsed === 'object'
          && ('globalRules' in parsed || 'strategyParams' in parsed
            || 'lot' in parsed || 'spreadCents' in parsed));
        if (!shaped) throw new Error('بنية غير معروفة');
        return mk('ok', `إعدادات المستخدم سليمة — آخر تحديث ${row.updatedAt.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}`);
      } catch {
        await db.botSettings.upsert({
          where: { key: 'main' },
          create: { key: 'main', json: restoreJson },
          update: { json: restoreJson },
        });
        this.fixes++;
        this.event('critical', 'الإعدادات', `كانت الإعدادات المحفوظة تالفة — استُعيدت ${restoreMsg} تلقائياً لمنع توقف البوت`);
        return mk('ok', `كانت تالفة — استُعيدت ${restoreMsg} تلقائياً`);
      }
    } catch (e) {
      return mk('fail', `تعذر فحص الإعدادات: ${String(e).slice(0, 100)}`);
    }
  }

  /** 5) كاش الأخبار — تجديد تلقائي من ForexFactory عند انتهاء الصلاحية */
  private async checkNews(): Promise<CheckResult> {
    const t0 = Date.now();
    const mk = (status: CheckStatus, detail: string): CheckResult =>
      ({ id: 'news', label: 'كاش الأخبار', status, detail, ms: Date.now() - t0 });
    try {
      const row = await db.botSettings.findUnique({ where: { key: 'newsCache' } });
      if (!row) return mk('skip', 'لا كاش بعد — يُسحب تقويم ForexFactory عند أول طلب');
      let cache: NewsCache | null = null;
      try { cache = JSON.parse(row.json) as NewsCache; } catch { cache = null; }
      if (!cache?.updatedAt || !Array.isArray(cache.events)) {
        // كاش تالف — امسحه ليُسحب من جديد فوراً
        await db.botSettings.delete({ where: { key: 'newsCache' } }).catch(() => { /* قد يكون حُذف */ });
        this.fixes++;
        this.event('fix', 'كاش الأخبار', 'كان الكاش تالفاً — مُسح ليُسحب التقويم الحقيقي من جديد');
        return mk('ok', 'كان تالفاً — مُسح وسيُجدد تلقائياً');
      }
      const age = Date.now() - cache.updatedAt;
      if (age < NEWS_TTL_MS) {
        return mk('ok', `تقويم الأخبار محدث (${cache.events.length} حدث عالي التأثير) — آخر سحب قبل ${Math.round(age / 60000)} دقيقة`);
      }
      // منتهي الصلاحية — تجديد تلقائي من المصدر مباشرة
      const ok = await this.refreshNews();
      if (ok) {
        this.fixes++;
        this.event('fix', 'كاش الأخبار', 'انتهت صلاحية الكاش وجُدّد تلقائياً من ForexFactory بدون انتظار المستخدم');
        return mk('ok', 'كان منتهياً — جُدّد تلقائياً من ForexFactory');
      }
      this.event('warn', 'كاش الأخبار', 'انتهت صلاحية الكاش وتعذر السحب الآن (شبكة/مصدر) — ستُعاد المحاولة في الدورة القادمة');
      return mk('warn', 'الكاش منتهي وتعذر التجديد الآن — إعادة محاولة تلقائية كل دورة');
    } catch (e) {
      return mk('fail', `تعذر فحص الأخبار: ${String(e).slice(0, 100)}`);
    }
  }

  private async refreshNews(): Promise<boolean> {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(FF_URL, {
        cache: 'no-store', signal: ctl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BfxAurumBot/1.0)' },
      });
      clearTimeout(to);
      if (!r.ok) return false;
      const arr = await r.json() as { title?: string; country?: string; date?: string; impact?: string }[];
      const events = (Array.isArray(arr) ? arr : [])
        .filter(e => e.country === 'USD' && e.impact === 'High' && e.date && e.title)
        .map(e => ({ t: new Date(e.date!).getTime(), name: e.title!, impact: e.impact!, country: e.country! }))
        .filter(e => Number.isFinite(e.t))
        .sort((a, b) => a.t - b.t);
      if (!events.length) return false;
      await db.botSettings.upsert({
        where: { key: 'newsCache' },
        create: { key: 'newsCache', json: JSON.stringify({ updatedAt: Date.now(), events }) },
        update: { json: JSON.stringify({ updatedAt: Date.now(), events }) },
      });
      return true;
    } catch { return false; }
  }

  /** 6) محرك التنبؤ — اختبار ذاتي دوري على الشموع الحية (يراقب الكود نفسه) */
  private async checkEngine(healMode: boolean): Promise<CheckResult> {
    const t0 = Date.now();
    const mk = (status: CheckStatus, detail: string): CheckResult =>
      ({ id: 'engine', label: 'محرك التنبؤ', status, detail, ms: Date.now() - t0 });
    if (!healMode && this.cycles % ENGINE_TEST_EVERY !== 0) {
      return mk('skip', `الاختبار الذاتي التالي بعد ${ENGINE_TEST_EVERY - (this.cycles % ENGINE_TEST_EVERY)} دورات`);
    }
    try {
      const data = getEngineData();
      if (!data) return mk('skip', 'لا بيانات حية كافية بعد للاختبار الذاتي — طبيعي قبل تشغيل الجسر');
      const arr = data.c15 ?? data.c5;
      if (!arr || arr.length < 40) return mk('skip', 'شموع غير كافية للاختبار الذاتي بعد');
      const fc = buildForecast(arr.slice(-80), '15m');
      if (!fc || !Array.isArray(fc.projected) || fc.projected.length !== 12) {
        this.event('critical', 'محرك التنبؤ', 'الاختبار الذاتي فشل — عدد الشموع المتوقعة غير صحيح');
        return mk('fail', 'الاختبار الذاتي فشل — مخرجات المحرك غير مكتملة');
      }
      for (const c of fc.projected) {
        const nums = [c.t, c.o, c.h, c.l, c.c];
        if (nums.some(x => !Number.isFinite(x)) || c.h < Math.max(c.o, c.c) - 1e-9 || c.l > Math.min(c.o, c.c) + 1e-9) {
          this.event('critical', 'محرك التنبؤ', `الاختبار الذاتي فشل — شمعة متوقعة ببنية OHLC غير منطقية (O:${c.o} H:${c.h} L:${c.l} C:${c.c})`);
          return mk('fail', 'الاختبار الذاتي فشل — شمعة متوقعة غير منطقية');
        }
      }
      if (!Array.isArray(fc.band) || fc.band.length !== 12) {
        this.event('critical', 'محرك التنبؤ', 'الاختبار الذاتي فشل — نطاق الثقة غير مكتمل');
        return mk('fail', 'الاختبار الذاتي فشل — نطاق الثقة غير مكتمل');
      }
      return mk('ok', `الاختبار الذاتي نجح — 12 شمعة متوقعة صالحة · الاتجاه ${fc.decision.dir === 'up' ? 'صاعد' : 'هابط'} · ثقة ${fc.decision.confidence.toFixed(0)}%`);
    } catch (e) {
      this.event('critical', 'محرك التنبؤ', `انفجر الاختبار الذاتي باستثناء: ${String(e).slice(0, 140)}`);
      return mk('fail', `استثناء داخل المحرك: ${String(e).slice(0, 120)}`);
    }
  }

  /** 7) ذاكرة العملية — عتبات أعلى في وضع التطوير (Next.js dev يستهلك أكثر بطبيعته) */
  private checkMemory(): CheckResult {
    const t0 = Date.now();
    const mu = process.memoryUsage();
    const rssMb = Math.round(mu.rss / 1048576);
    const heapMb = Math.round(mu.heapUsed / 1048576);
    const mk = (status: CheckStatus, detail: string): CheckResult =>
      ({ id: 'memory', label: 'ذاكرة العملية', status, detail, ms: Date.now() - t0 });
    const dev = process.env.NODE_ENV !== 'production';
    const warnMb = dev ? 1500 : 700;
    const failMb = dev ? 2400 : 1200;
    if (rssMb > failMb) {
      this.event('warn', 'الذاكرة', `استهلاك مرتفع (${rssMb} MB) — راقب الخادم، إعادة التشغيل تحرر الذاكرة`);
      return mk('fail', `${rssMb} MB RSS — مرتفع جداً`);
    }
    if (rssMb > warnMb) return mk('warn', `${rssMb} MB RSS — مرتفع قليلاً (تبقى تحت حد الخطر)`);
    return mk('ok', `${rssMb} MB RSS · ${heapMb} MB heap — سليمة${dev ? ' (وضع تطوير)' : ''}`);
  }

  // ----- التقرير -----
  report(): GuardianReport {
    const statuses = this.checks.map(c => c.status);
    let status: GuardianStatus = 'healthy';
    if (this.healingNow) status = 'healing';
    else if (statuses.includes('fail')) status = 'critical';
    else if (statuses.includes('warn')) status = 'degraded';
    const mu = process.memoryUsage();
    return {
      status,
      now: Date.now(),
      startedAt: this.startedAt,
      uptimeSec: this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0,
      cycles: this.cycles,
      heals: this.heals,
      fixes: this.fixes,
      lastCycleMs: this.lastCycleMs,
      lastCycleAt: this.lastCycleAt,
      nextCycleInSec: this.lastCycleAt ? Math.max(0, Math.round((this.lastCycleAt + CYCLE_MS - Date.now()) / 1000)) : 0,
      healingNow: this.healingNow,
      checks: this.checks,
      events: [...this.events].reverse().slice(0, 30),
      mem: { rssMb: Math.round(mu.rss / 1048576), heapMb: Math.round(mu.heapUsed / 1048576) },
      node: process.version,
    };
  }
}

// singleton يصمد أمام HMR في وضع التطوير
const g = globalThis as unknown as { __bfxGuardian?: Guardian };
export const guardian = g.__bfxGuardian ?? new Guardian();
g.__bfxGuardian = guardian;
