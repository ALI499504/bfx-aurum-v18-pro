// ============================================================
// جسر MT5 — مخزن البيانات الحية (server-only)
// يستقبل شموع الذهب الحقيقية من طرفية MetaTrader 5 على جهاز
// المستخدم عبر /api/mt5/ingest ويجعلها متاحة لكل نقاط API.
// بدون اتصال حيّ → تعود نقاط API تلقائياً لبيانات المحرك.
// لقطة على القرص: الشموع الحقيقية تُحفظ دورياً وتُستعاد عند إعادة
// تشغيل الخادم — فلا يُفقد التاريخ ولا يعيد الجسر سحبه من الصفر.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

export interface FeedCandle { t: number; o: number; h: number; l: number; c: number; v: number }

export interface FeedTick { bid: number; ask: number; time: number }

export interface FeedAccount {
  login?: string; server?: string; currency?: string; leverage?: number;
  name?: string; company?: string;
  balance?: number; equity?: number; margin?: number; marginFree?: number;
  marginLevel?: number; profit?: number;
}

/** صفقة مفتوحة حقيقية من طرفية MT5 */
export interface FeedPosition {
  ticket: number; t: number; dir: 'buy' | 'sell';
  volume: number; priceOpen: number; priceCurrent: number;
  sl: number; tp: number; profit: number; swap: number; comment: string;
}

/** صفقة منفذة حقيقية (deal) من سجل MT5 */
export interface FeedDeal {
  t: number; dir: 'buy' | 'sell'; entry: 'in' | 'out';
  volume: number; price: number; profit: number;
  swap: number; commission: number; position: number;
  sl: number; tp: number; comment: string;
}

export interface FeedState {
  symbol: string;
  broker: string | null;
  account: FeedAccount | null;
  bridgeV: number | null;      // إصدار الجسر المرسل (v18 وأحدث يرسله مع كل دفعة)
  tfs: Partial<Record<string, FeedCandle[]>>;
  tick: FeedTick | null;
  positions: FeedPosition[];   // الصفقات المفتوحة الحقيقية
  deals: FeedDeal[];           // سجل الصفقات المنفذة الحقيقي
  updatedAt: number;   // آخر دفعة استقبلناها (ms)
  firstPushAt: number;
  pushes: number;
}

const MAX_PER_TF = 300_000; // يكفي لتاريخ 5m من 2025-01-01 (~190 ألف شمعة حقيقية)
const MAX_POSITIONS = 100;
const MAX_DEALS = 800;
export const MT5_FRESH_MS = 120_000; // نعتبر الاتصال حياً ضمن دقيقتين من آخر دفعة

/**
 * وضع الأرشيف المحلي (BFX_ALLOW_STALE_SNAPSHOT=1): يعامل لقطة القرص كمصدر صالح
 * حتى لو توقف الجسر — للعرض والتحليل والباك تيست على جهازك بلا طرفية MT5.
 * لا يُستعمل للتداول الحي: الشموع تبقى بتواريخها الحقيقية ولا تُزحزح.
 */
const offlineSnapshotMode = (): boolean => process.env.BFX_ALLOW_STALE_SNAPSHOT === '1';
export const TF_KEYS = ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];

// singleton عبر globalThis كي يصمد أمام HMR في وضع التطوير
const g = globalThis as unknown as { __bfxMt5Feed?: FeedState };

// ---------- لقطة القرص (حفظ دوري + استعادة عند الإقلاع) ----------
const SNAP_PATH = path.join(process.cwd(), 'db', 'mt5-feed-snapshot.json');

function restoreSnapshot(): FeedState | null {
  try {
    const j = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8')) as Record<string, unknown>;
    if (!j || typeof j !== 'object') return null;
    const s: FeedState = {
      symbol: typeof j.symbol === 'string' ? j.symbol.slice(0, 24) : 'XAUUSD',
      broker: typeof j.broker === 'string' ? j.broker.slice(0, 60) : null,
      account: (j.account && typeof j.account === 'object' ? j.account : null) as FeedState['account'],
      bridgeV: typeof j.bridgeV === 'number' && Number.isFinite(j.bridgeV) ? j.bridgeV : null,
      tfs: {}, tick: null, positions: [], deals: [],
      updatedAt: 0, firstPushAt: 0, pushes: 0,
    };
    const tfsJ = (j.tfs && typeof j.tfs === 'object' ? j.tfs : {}) as Record<string, unknown>;
    let n = 0;
    for (const tf of TF_KEYS) {
      const arr = sanitize(tfsJ[tf]);
      if (arr) { s.tfs[tf] = arr.slice(-MAX_PER_TF); n += arr.length; }
    }
    if (!n) return null;
    if (j.tick && typeof j.tick === 'object') {
      const k = j.tick as Record<string, unknown>;
      const bid = num(k.bid), ask = num(k.ask);
      if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
        s.tick = { bid, ask, time: num(k.time) || 0 };
      }
    }
    if (Array.isArray(j.positions)) s.positions = j.positions.slice(0, MAX_POSITIONS) as FeedState['positions'];
    if (Array.isArray(j.deals)) s.deals = j.deals.slice(0, MAX_DEALS) as FeedState['deals'];
    s.updatedAt = num(j.updatedAt) || 0;
    console.log(`[mt5feed] استُعيدت ${n} شمعة حقيقية من لقطة القرص (${Object.keys(s.tfs).join('، ')})`);
    return s;
  } catch {
    return null;
  }
}

let snapTimer: ReturnType<typeof setTimeout> | null = null;

/** حفظ مؤجل — مرة واحدة كحد أقصى كل 45 ثانية عند تغير البيانات */
function scheduleSnapshotSave() {
  if (snapTimer) return;
  snapTimer = setTimeout(() => {
    snapTimer = null;
    writeSnapshot();
  }, 45_000);
  snapTimer.unref?.();
}

function writeSnapshot(): boolean {
  const s = mt5Feed();
  if (!s.updatedAt || !Object.keys(s.tfs).length) return false;
  try {
    fs.mkdirSync(path.dirname(SNAP_PATH), { recursive: true });
    const data = JSON.stringify({
      symbol: s.symbol, broker: s.broker, account: s.account, bridgeV: s.bridgeV,
      tick: s.tick, positions: s.positions.slice(0, MAX_POSITIONS), deals: s.deals.slice(0, MAX_DEALS),
      updatedAt: s.updatedAt, savedAt: Date.now(),
      // صفوف مدمجة [t,o,h,l,c,v] — أصغر حجماً ومتوافقة مع دالة التنقية عند الاستعادة
      tfs: Object.fromEntries(Object.entries(s.tfs).map(([k, arr]) =>
        [k, (arr ?? []).map(c => [c.t, c.o, c.h, c.l, c.c, c.v])])),
    });
    const tmp = SNAP_PATH + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, SNAP_PATH);
    return true;
  } catch { return false; /* الحفظ اختياري ولا يعطل البث */ }
}

/** الوكيل الحارس — فرض كتابة لقطة الآن (إصلاح لقطة مفقودة/تالفة/قديمة) */
export function forceWriteSnapshot(): boolean {
  try { return writeSnapshot(); } catch { return false; }
}

export function mt5Feed(): FeedState {
  if (!g.__bfxMt5Feed) {
    g.__bfxMt5Feed = restoreSnapshot() ?? {
      symbol: 'XAUUSD', broker: null, account: null, bridgeV: null,
      tfs: {}, tick: null, positions: [], deals: [],
      updatedAt: 0, firstPushAt: 0, pushes: 0,
    };
  }
  return g.__bfxMt5Feed;
}

const num = (x: unknown): number =>
  typeof x === 'number' && Number.isFinite(x) ? x : NaN;

/** تنقية صف شمعة [t,o,h,l,c,v] قادم من الجسر */
function sanitize(arr: unknown): FeedCandle[] | null {
  if (!Array.isArray(arr)) return null;
  const out: FeedCandle[] = [];
  for (const row of arr) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const T = num(row[0]), O = num(row[1]), H = num(row[2]), L = num(row[3]), C = num(row[4]);
    if (!Number.isFinite(T) || !Number.isFinite(O) || !Number.isFinite(H) || !Number.isFinite(L) || !Number.isFinite(C)) continue;
    if (T < 946684800000 || H < L || H < Math.max(O, C) || L > Math.min(O, C)) continue; // تالف/غير منطقي
    const V = num(row[5]);
    out.push({ t: Math.round(T), o: O, h: H, l: L, c: C, v: Number.isFinite(V) ? Math.round(V) : 0 });
  }
  return out.length ? out : null;
}

/** دمج دفعة شموع — upsert حسب زمن الفتح، مع سقف تخزين لكل فريم */
export function ingestMt5(body: {
  symbol?: unknown; broker?: unknown; account?: unknown; v?: unknown;
  history?: unknown; tick?: unknown; tfs?: unknown; positions?: unknown; deals?: unknown;
}): { stored: number; counts: Record<string, number> } {
  const s = mt5Feed();
  let stored = 0;

  // جهاز/حساب جديد يبث؟ امسح الشموع القديمة كي لا تختلط بيانات المحاكاة أو جهاز آخر بحقيقية
  const extractLogin = (a: unknown): string | undefined => {
    if (a && typeof a === 'object' && 'login' in (a as Record<string, unknown>)) {
      const v = (a as Record<string, unknown>).login;
      if (typeof v === 'string' || typeof v === 'number') return String(v).slice(0, 20);
    }
    return undefined;
  };
  const incomingLogin = extractLogin(body.account);
  if (incomingLogin && s.account?.login && incomingLogin !== s.account.login) {
    s.tfs = {};
    s.tick = null;
    s.positions = [];
    s.deals = [];
  }

  if (typeof body.symbol === 'string' && body.symbol.trim()) s.symbol = body.symbol.trim().slice(0, 24);
  if (typeof body.broker === 'string' && body.broker.trim()) s.broker = body.broker.trim().slice(0, 60);
  if (typeof body.v === 'number' && Number.isFinite(body.v)) s.bridgeV = body.v;
  if (body.account && typeof body.account === 'object') {
    const a = body.account as Record<string, unknown>;
    const nb = (k: string): number | undefined =>
      Number.isFinite(a[k] as number) ? (a[k] as number) : undefined;
    // جهاز/حساب مختلف؟ استبدال كامل. نفس الحساب؟ دمج — كي لا تمسح دفعة ناقصة
    // (قراءة حساب تعثرت لحظياً في الطرفية) رصيداً حقيقياً وصل قبلها.
    const prev = s.account;
    const sameAccount = !prev || !prev.login || !incomingLogin || incomingLogin === prev.login;
    s.account = {
      login: typeof a.login === 'string' || typeof a.login === 'number' ? String(a.login).slice(0, 20) : undefined,
      server: typeof a.server === 'string' ? a.server.slice(0, 60) : undefined,
      currency: typeof a.currency === 'string' ? a.currency.slice(0, 10) : undefined,
      leverage: Number.isFinite(a.leverage as number) ? Number(a.leverage) : undefined,
      name: typeof a.name === 'string' ? a.name.slice(0, 60) : undefined,
      company: typeof a.company === 'string' ? a.company.slice(0, 80) : undefined,
      balance: nb('balance') ?? (sameAccount ? prev?.balance : undefined),
      equity: nb('equity') ?? (sameAccount ? prev?.equity : undefined),
      margin: nb('margin') ?? (sameAccount ? prev?.margin : undefined),
      marginFree: nb('marginFree') ?? (sameAccount ? prev?.marginFree : undefined),
      marginLevel: nb('marginLevel') ?? (sameAccount ? prev?.marginLevel : undefined),
      profit: nb('profit') ?? (sameAccount ? prev?.profit : undefined),
    };
  }
  // الصفقات المفتوحة الحقيقية من طرفية MT5
  if (Array.isArray(body.positions)) {
    const out: FeedPosition[] = [];
    for (const raw of body.positions) {
      if (!raw || typeof raw !== 'object') continue;
      const p = raw as Record<string, unknown>;
      const ticket = num(p.ticket), t = num(p.t), volume = num(p.volume), priceOpen = num(p.priceOpen);
      if (!Number.isFinite(ticket) || !Number.isFinite(t) || !Number.isFinite(volume)) continue;
      const dir = p.dir === 'sell' ? 'sell' : 'buy';
      out.push({
        ticket: Math.round(ticket), t: Math.round(t), dir,
        volume, priceOpen: Number.isFinite(priceOpen) ? priceOpen : 0,
        priceCurrent: Number.isFinite(num(p.priceCurrent)) ? (num(p.priceCurrent) as number) : priceOpen,
        sl: Number.isFinite(num(p.sl)) ? (num(p.sl) as number) : 0,
        tp: Number.isFinite(num(p.tp)) ? (num(p.tp) as number) : 0,
        profit: Number.isFinite(num(p.profit)) ? (num(p.profit) as number) : 0,
        swap: Number.isFinite(num(p.swap)) ? (num(p.swap) as number) : 0,
        comment: typeof p.comment === 'string' ? p.comment.slice(0, 40) : '',
      });
      if (out.length >= MAX_POSITIONS) break;
    }
    s.positions = out;
  }
  // سجل الصفقات المنفذة الحقيقي (deals)
  if (Array.isArray(body.deals)) {
    const out: FeedDeal[] = [];
    for (const raw of body.deals) {
      if (!raw || typeof raw !== 'object') continue;
      const d = raw as Record<string, unknown>;
      const t = num(d.t), volume = num(d.volume), price = num(d.price), position = num(d.position);
      if (!Number.isFinite(t) || !Number.isFinite(volume) || !Number.isFinite(price)) continue;
      if (!Number.isFinite(position)) continue;
      const dir = d.dir === 'sell' ? 'sell' : 'buy';
      const entry = d.entry === 'out' ? 'out' : 'in';
      out.push({
        t: Math.round(t), dir, entry, volume, price,
        profit: Number.isFinite(num(d.profit)) ? (num(d.profit) as number) : 0,
        swap: Number.isFinite(num(d.swap)) ? (num(d.swap) as number) : 0,
        commission: Number.isFinite(num(d.commission)) ? (num(d.commission) as number) : 0,
        position: Math.round(position),
        sl: Number.isFinite(num(d.sl)) ? (num(d.sl) as number) : 0,
        tp: Number.isFinite(num(d.tp)) ? (num(d.tp) as number) : 0,
        comment: typeof d.comment === 'string' ? d.comment.slice(0, 40) : '',
      });
      if (out.length >= MAX_DEALS) break;
    }
    if (out.length) s.deals = out; // لا نمسح السجل إن جاءت دفعة فارغة مؤقتاً
  }
  if (body.tick && typeof body.tick === 'object') {
    const k = body.tick as Record<string, unknown>;
    const bid = num(k.bid), ask = num(k.ask), time = num(k.time);
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
      // حارس الإصدار: الجسر الحديث (يحمل v) له الأولوية على دفعات جسر قديم
      // بلا رقم إصدار قد يظل يعمل بنفس الوقت — كي لا يجمّد تيكه المتوقف السعر اللحظي
      const inv = typeof body.v === 'number' && Number.isFinite(body.v) ? body.v : null;
      const authoritative = inv === null ? s.bridgeV === null : inv >= (s.bridgeV ?? 0);
      if (authoritative) {
        s.tick = { bid, ask, time: Number.isFinite(time) ? Math.round(time) : Date.now() };
      }
    }
  }

  const counts: Record<string, number> = {};
  const tfs = (body.tfs && typeof body.tfs === 'object' ? body.tfs : {}) as Record<string, unknown>;
  for (const tf of TF_KEYS) {
    const arr = sanitize(tfs[tf]);
    if (!arr) continue;
    const cur = s.tfs[tf];
    const lastT = cur && cur.length ? cur[cur.length - 1].t : 0;
    let merged: FeedCandle[];
    if (cur && cur.length && arr[0].t > lastT) {
      // مسار سريع: دفعة تراكمية زمنياً كلها أحدث من المخزون (حالات سحب التاريخ والبث اللحظي)
      merged = cur.concat(arr);
      if (merged.length > MAX_PER_TF) merged = merged.slice(merged.length - MAX_PER_TF);
    } else {
      // دمج كامل: upsert حسب زمن الفتح (دفعات تعيد تغطية نطاقات قديمة)
      const map = new Map<number, FeedCandle>();
      for (const c of cur ?? []) map.set(c.t, c);
      for (const c of arr) map.set(c.t, c); // الجديد يغطي القديم
      merged = [...map.values()].sort((a, b) => a.t - b.t);
      if (merged.length > MAX_PER_TF) merged = merged.slice(merged.length - MAX_PER_TF);
    }
    s.tfs[tf] = merged;
    counts[tf] = merged.length;
    stored += arr.length;
  }

  const now = Date.now();
  s.updatedAt = now;
  s.pushes += 1;
  if (!s.firstPushAt) s.firstPushAt = now;
  scheduleSnapshotSave(); // لقطة دورية على القرص — الاستعادة فورية عند إعادة تشغيل الخادم
  return { stored, counts };
}

/** لقطة الحساب الحقيقي الكاملة + الصفقات المفتوحة والسجل — لصفحات الحساب والصفقات */
export function getMt5LiveSnapshot() {
  const s = mt5Feed();
  const age = s.updatedAt ? Date.now() - s.updatedAt : null;
  const fresh = offlineSnapshotMode() ? s.updatedAt > 0 : age !== null && age <= MT5_FRESH_MS;
  return {
    connected: fresh,
    symbol: s.symbol,
    broker: s.broker,
    account: s.account,
    bridgeV: s.bridgeV,
    tick: s.tick,
    updatedAt: s.updatedAt || null,
    ageMs: age,
    positions: fresh ? s.positions : [],
    deals: fresh ? s.deals : [],
  };
}

export function isMt5Fresh(maxAgeMs = MT5_FRESH_MS): boolean {
  const s = mt5Feed();
  if (offlineSnapshotMode()) return s.updatedAt > 0 && (s.tfs['5m']?.length ?? 0) > 0;
  return s.updatedAt > 0 && Date.now() - s.updatedAt <= maxAgeMs;
}

/** شموع حية جاهزة للعرض لفريم معين — أو null إن لم تصل بيانات كافية وحديثة */
export function getLiveCandles(tf: string, minCount = 60): FeedCandle[] | null {
  if (!isMt5Fresh()) return null;
  const arr = mt5Feed().tfs[tf];
  if (!arr || arr.length < minCount) return null;
  return arr;
}

/** آخر شمعة معروضة مع دمج التيك الحي — للعرض فقط دون المساس بالمخزون.
 *  شارت MT5 يرسم السعر الجاري بخط Bid: نطابق ذلك تماماً كي يتحرك آخر شمعة
 *  وخط السعر لحظياً مع كل نبضة سعر بين دفعات الشموع (كل ثانيتين). */
export function mergedLastCandle(a: FeedCandle[] | undefined, tick: FeedTick | null): FeedCandle | null {
  if (!a || !a.length) return null;
  const c0 = a[a.length - 1];
  const base: FeedCandle = { t: c0.t, o: c0.o, h: c0.h, l: c0.l, c: c0.c, v: c0.v };
  if (!tick || !Number.isFinite(tick.bid) || tick.bid <= 0) return base;
  // ندمج فقط إن كان التيك لا يسبق فتح آخر شمعة (شمعة تشكّل الآن فعلاً)
  if (Number.isFinite(tick.time) && tick.time > 0 && tick.time < c0.t) return base;
  return {
    t: c0.t, o: c0.o,
    h: Math.max(c0.h, tick.bid),
    l: Math.min(c0.l, tick.bid),
    c: tick.bid, v: c0.v,
  };
}

export function getMt5Status() {
  const s = mt5Feed();
  const age = s.updatedAt ? Date.now() - s.updatedAt : null;
  const fresh = offlineSnapshotMode() ? s.updatedAt > 0 : age !== null && age <= MT5_FRESH_MS;
  return {
    connected: fresh,
    symbol: s.symbol,
    broker: s.broker,
    account: s.account,
    bridgeV: s.bridgeV,
    tick: s.tick,
    updatedAt: s.updatedAt || null,
    ageMs: age,
    pushes: s.pushes,
    counts: Object.fromEntries(TF_KEYS.map(tf => [tf, s.tfs[tf]?.length ?? 0])),
    // أقدم شمعة لكل فريم — يستخدمها الجسر لكشف فقدان التاريخ العميق (إعادة تشغيل السيرفر)
    oldest: Object.fromEntries(TF_KEYS.map(tf => {
      const a = s.tfs[tf];
      return [tf, a && a.length ? a[0].t : null];
    })),
    // آخر شمعة لكل فريم — للتحديث اللحظي للشارتات في الواجهة (مدموجة مع تيك البث الحي)
    last: Object.fromEntries(TF_KEYS.map(tf => {
      const c = fresh ? mergedLastCandle(s.tfs[tf], s.tick) : null;
      return [tf, c ? { t: c.t, o: c.o, h: c.h, l: c.l, c: c.c } : null];
    })),
  };
}
