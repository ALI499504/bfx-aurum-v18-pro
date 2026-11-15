// ============================================================
// جارفس — سجل الأدوات المنفذة (server-only)
// كل أداة تنفّذ عبر نفس واجهات البوت الرسمية (نفس مسار التحقق
// وحارس الدستور الذي يمشي عليه المستخدم من الواجهة) — جارفس
// لا يكتب قاعدة البيانات مباشرة إطلاقاً: صلاحياته = صلاحياتك.
// كل تنفيذ يعيد: نجاح/فشل + وصف عربي دقيق بالأرقام (يُعرض في
// شريط النشاط ويُنطق بصوت ليلى الأنيق).
// ============================================================

const BASE = 'http://localhost:3000';

async function api<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, {
    cache: 'no-store',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error((j.error as string) || `HTTP ${r.status}`);
  return j;
}

export interface ToolResult {
  ok: boolean;
  label: string;      // اسم الخطوة المعروض في الشريط
  detail: string;     // النتيجة بالأرقام — عربي
  data?: unknown;
}

export interface JarvisAction {
  tool: string;
  args?: Record<string, unknown>;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

interface SettingsShape {
  sessions: Record<string, Record<string, boolean>>;
  priority: string[];
  globalRules: Record<string, { enabled: boolean; value: number }>;
  manualLevels: { enabled: boolean; levels: { id: string; price: number; dir: string; slDollars: number; note?: string; createdAt: number }[] };
}

async function getSettings(): Promise<SettingsShape> {
  const j = await api<{ settings: SettingsShape }>('/api/settings');
  return j.settings;
}

/** تلخيص الإعدادات الحالية — نص عربي مضغوط يُغذّى للعقل ويُعرض للسيد */
export async function settingsDigest(): Promise<string> {
  const s = await getSettings();
  const rules = Object.entries(s.globalRules)
    .filter(([, v]) => v.enabled)
    .map(([k, v]) => `${k}=${v.value}`)
    .join('، ');
  const on: string[] = [];
  for (const [st, sess] of Object.entries(s.sessions)) {
    const act = Object.entries(sess).filter(([, v]) => v).map(([k]) => k);
    if (act.length) on.push(`${st}(${act.join('+')})`);
  }
  const ml = s.manualLevels?.levels?.length ?? 0;
  return `القواعد المفعلة: ${rules || 'لا شيء'} | جلسات الاستراتيجيات: ${on.join('، ') || 'لا شيء'} | مستويات يدوية: ${ml} | سلم الأولويات: ${s.priority.join('>')}`;
}

/** تطبيق فرق إعدادات عبر مسار الواجهة الرسمي (حارس الدستور يعمل تلقائياً) */
async function patchSettings(patches: { op: 'replace'; path: string; value: unknown }[]): Promise<{ applied: number; refused: { path: string; reason?: string }[] }> {
  const j = await api<{ applied: number; refused: { path: string; reason?: string }[] }>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ patches }),
  });
  return j;
}

const STRATEGIES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'Z'];
const SESSIONS = ['asia', 'london', 'londonNY', 'ny'];
const SESSION_AR: Record<string, string> = { asia: 'آسيا', london: 'لندن', londonNY: 'لندن/نيويورك', ny: 'نيويورك' };

export const TOOLS: Record<string, { desc: string; args: string; run: (args: Record<string, unknown>) => Promise<ToolResult> }> = {
  // ---------- قراءة ----------
  read_status: {
    desc: 'قراءة الحالة اللحظية: سعر الذهب، مصدره، الجلسة الحالية، حالة بث MT5 ورصيد الحساب',
    args: '{}',
    run: async () => {
      const price = await api<{ price: number; source: string; session: string; changePct: number | null }>('/api/price');
      const st = await api<{ connected: boolean; account?: { balance: number; equity: number; server: string } | null; broker: string | null }>('/api/mt5/status');
      const src = price.source === 'mt5' ? 'بث ميتاتريدر الحي' : 'مرجع احتياطي (Binance)';
      const acc = st.account;
      return {
        ok: true,
        label: 'قراءة الحالة اللحظية',
        detail: `الذهب ${price.price.toFixed(2)}$ (${src}${price.changePct !== null ? `، التغير ${price.changePct.toFixed(2)}%` : ''}) | الاتصال: ${st.connected ? 'حي' : 'بانتظار الجسر'}${acc ? ` | رصيد ${acc.balance.toFixed(2)}$ على ${acc.server ?? st.broker ?? ''}` : ''} | الجلسة: ${price.session || 'غير محددة'}`,
        data: { price, connected: st.connected, balance: acc?.balance ?? null },
      };
    },
  },

  read_positions: {
    desc: 'قراءة الصفقات المفتوحة الآن على حساب MT5 الحقيقي: الاتجاه، اللوت، سعر الدخول، السعر الحالي، الوقف، الهدف، الربح/الخسارة العائمة',
    args: '{}',
    run: async () => {
      const j = await api<{ connected?: boolean; positions?: { dir: string; volume: number; priceOpen: number; priceCurrent: number; profit: number; sl: number; tp: number }[] }>('/api/mt5/account');
      const ps = j.positions ?? [];
      if (!ps.length) return { ok: true, label: 'قراءة الصفقات المفتوحة', detail: 'لا توجد أي صفقة مفتوحة الآن — الحساب بلا مراكز' };
      const lines = ps.slice(0, 6).map(p => `${p.dir === 'buy' ? 'شراء' : 'بيع'} ${p.volume} لوت من ${p.priceOpen}$ (الحالي ${p.priceCurrent}$، عائم ${p.profit >= 0 ? '+' : ''}${p.profit.toFixed(2)}$${p.sl ? `، وقف ${p.sl}$` : ''}${p.tp ? `، هدف ${p.tp}$` : ''})`);
      const total = ps.reduce((a, p) => a + p.profit, 0);
      return { ok: true, label: 'قراءة الصفقات المفتوحة', detail: `${ps.length} صفقة مفتوحة، الربح العائم الإجمالي ${total >= 0 ? '+' : ''}${total.toFixed(2)}$ | ${lines.join(' — ')}`, data: ps };
    },
  },

  read_trades: {
    desc: 'قراءة آخر الصفقات المنفذة المغلقة من سجل MT5 الحقيقي: الاتجاه، اللوت، الدخول والخروج، الربح/الخسارة المحققة',
    args: '{}',
    run: async () => {
      const j = await api<{ connected?: boolean; closedTrades?: { dir: string; volume: number; openPrice: number; closePrice: number; profit: number }[] }>('/api/mt5/account');
      const ts = (j.closedTrades ?? []).slice(0, 5);
      if (!ts.length) return { ok: true, label: 'قراءة الصفقات المنفذة', detail: 'لا توجد صفقات مغلقة مسجلة على الحساب حتى الآن' };
      const lines = ts.map(t => `${t.dir === 'buy' ? 'شراء' : 'بيع'} ${t.volume} لوت من ${Number(t.openPrice).toFixed(2)}$ إلى ${Number(t.closePrice).toFixed(2)}$ (${t.profit >= 0 ? '+' : ''}${Number(t.profit).toFixed(2)}$)`);
      const total = ts.reduce((a, t) => a + t.profit, 0);
      return { ok: true, label: 'قراءة الصفقات المنفذة', detail: `آخر ${ts.length} صفقة مغلقة، محصلتها ${total >= 0 ? '+' : ''}${total.toFixed(2)}$ | ${lines.join(' — ')}`, data: ts };
    },
  },

  analyze_market: {
    desc: 'دراسة سوق الذهب الشاملة الفورية: الاتجاه عبر EMA20/EMA90 على فريم 15 دقيقة، مدى الحركة والتقلب، موقع السعر من المدى، الإشارات الحية النشطة، وأخبار الدولار القادمة — تعيد خلاصة تحليلية كاملة بالأرقام',
    args: '{}',
    run: async () => {
      const [chart, price, sigs, news] = await Promise.all([
        api<{ candles?: { o: number; h: number; l: number; c: number }[]; emaFast?: { v: number | null }[]; emaSlow?: { v: number | null }[]; tf?: string }>('/api/chart?tf=15m&limit=200').catch(() => null),
        api<{ price: number; source: string; session: string; changePct: number | null }>('/api/price').catch(() => null),
        api<{ signals?: { strategy: string; dir: string; entry: number; setup?: string }[] }>('/api/signals').catch(() => null),
        api<{ events?: { t: number; name: string; impact?: string }[] }>('/api/news').catch(() => null),
      ]);
      if (!chart?.candles?.length || !price) {
        return { ok: false, label: 'دراسة السوق', detail: 'تعذر جلب شموع السوق الحية — بانتظار بث MT5 من جهازك' };
      }
      const cs = chart.candles;
      const last = cs[cs.length - 1];
      const emaF = chart.emaFast?.[chart.emaFast.length - 1]?.v ?? null;
      const emaS = chart.emaSlow?.[chart.emaSlow.length - 1]?.v ?? null;
      // الاتجاه: تقاطع المتوسطين + موقع السعر منهما
      let trend = 'عرضي (لا اتجاه واضح)';
      if (emaF !== null && emaS !== null && Number.isFinite(emaF) && Number.isFinite(emaS)) {
        const gap = ((emaF - emaS) / emaS) * 100;
        if (gap > 0.04 && last.c > emaF) trend = `صاعد (EMA20 فوق EMA90 بفارق ${gap.toFixed(2)}% والسعر فوق المتوسط السريع)`;
        else if (gap < -0.04 && last.c < emaF) trend = `هابط (EMA20 تحت EMA90 بفارق ${Math.abs(gap).toFixed(2)}% والسعر تحت المتوسط السريع)`;
        else trend = 'عرضي (المتوسطان متقاربان والسعر يتأرجح حولهما)';
      }
      // مدى وتقلب آخر 20 شمعة (5 ساعات على فريم 15د)
      const win = cs.slice(-20);
      const hi = Math.max(...win.map(c => c.h));
      const lo = Math.min(...win.map(c => c.l));
      const atr = cs.slice(-14).reduce((a, c) => a + (c.h - c.l), 0) / 14;
      const pos = hi > lo ? ((price.price - lo) / (hi - lo)) * 100 : 50;
      // الإشارات
      const active = sigs?.signals ?? [];
      const sigLine = active.length
        ? `${active.length} إشارة نشطة: ${active.slice(0, 3).map(s => `${s.strategy} ${s.dir === 'buy' ? 'شراء' : 'بيع'} عند ${s.entry}`).join(' — ')}`
        : 'لا إشارات دخول نشطة الآن — شروط الاستراتيجيات لم تكتمل';
      // الأخبار
      const evs = news?.events ?? [];
      const newsLine = evs.length
        ? `تنبيهات قادمة: ${evs.slice(0, 3).map(e => `${e.name} (${new Date(e.t).toLocaleString('ar', { weekday: 'short', hour: '2-digit', minute: '2-digit' })})`).join(' — ')}`
        : 'لا أخبار عالية التأثير مسجلة قادمة';
      const detail =
        `خلاصة دراسة ${chart.tf ?? '15m'} لحظتها: الذهب ${price.price.toFixed(2)}$ | الاتجاه: ${trend} | ` +
        `مدى آخر 20 شمعة من ${lo.toFixed(2)}$ إلى ${hi.toFixed(2)}$ (السعر عند ${pos.toFixed(0)}% من المدى) | ` +
        `متوسط تقلب الشمعة ${atr.toFixed(2)}$ | ${sigLine} | ${newsLine}`;
      return {
        ok: true,
        label: `دراسة السوق الشاملة (${chart.tf ?? '15m'})`,
        detail,
        data: { price: price.price, trend, hi, lo, atr, pos, signals: active.length, news: evs.length },
      };
    },
  },

  read_settings: {
    desc: 'قراءة الإعدادات الحالية كاملة: القواعد المفعلة، جلسات كل استراتيجية، سلم الأولويات، المستويات اليدوية',
    args: '{}',
    run: async () => ({
      ok: true,
      label: 'قراءة الإعدادات',
      detail: await settingsDigest(),
    }),
  },

  read_signals: {
    desc: 'قراءة الإشارات الحية النشطة الآن من محرك الاستراتيجيات',
    args: '{}',
    run: async () => {
      const j = await api<{ signals?: { strategy: string; dir: string; entry: number; sl: number; tp: number; setup?: string; score?: number }[]; count?: number }>('/api/signals');
      const sigs = j.signals ?? [];
      if (!sigs.length) return { ok: true, label: 'قراءة الإشارات الحية', detail: 'لا توجد إشارات نشطة الآن — الشروط لم تكتمل على أي استراتيجية' };
      const lines = sigs.slice(0, 5).map(s => `${s.strategy} ${s.dir === 'buy' ? 'شراء' : 'بيع'} @ ${s.entry}${s.setup ? ` (مواصفة ${s.setup})` : ''}`);
      return { ok: true, label: 'قراءة الإشارات الحية', detail: `${sigs.length} إشارة نشطة: ${lines.join(' — ')}`, data: sigs };
    },
  },

  read_news: {
    desc: 'قراءة أهم أحداث السوق القادمة من تقويم ForexFactory (أخبار الدولار عالية التأثير التي تُحرك الذهب)',
    args: '{}',
    run: async () => {
      const j = await api<{ ok?: boolean; count?: number; events?: { t: number; name: string; impact?: string }[]; error?: string }>('/api/news');
      const evs = j.events ?? [];
      if (!evs.length) return { ok: false, label: 'قراءة أخبار السوق', detail: j.error ?? 'لا توجد أحداث قادمة مسجلة الآن' };
      const fmt = (t: number) => new Date(t).toLocaleString('ar', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      const lines = evs.slice(0, 4).map(e => `${e.name} (${fmt(e.t)})`);
      return { ok: true, label: 'قراءة أخبار السوق', detail: `${evs.length} حدثاً مؤثراً قادماً: ${lines.join(' — ')}`, data: evs };
    },
  },

  read_trainer: {
    desc: 'قراءة تقرير المدرب الذكي: أداء آخر باك تيست + المقترحات المبنية على الأرقام',
    args: '{}',
    run: async () => {
      const j = await api<{ report?: unknown; suggestions?: { title?: string }[] }>('/api/trainer');
      const sug = (j.suggestions ?? []).slice(0, 3).map(s => s.title ?? '').filter(Boolean);
      return { ok: true, label: 'قراءة المدرب الذكي', detail: `${sug.length ? 'مقترحات: ' + sug.join(' | ') : 'لا مقترحات حالياً — الأداء مطابق للهدف'}`, data: j };
    },
  },

  read_backtest: {
    desc: 'قراءة نتائج آخر باك تيست محفوظ: عدد الصفقات، النجاح، الصافي، معامل الربح، التراجع',
    args: '{}',
    run: async () => {
      const j = await api<{ stats?: { totalTrades: number; winRate: number; netPnl: number; profitFactor: number; maxDrawdownPct: number; finalBalance: number }; trades?: unknown[]; runAt?: string }>('/api/backtest');
      const s = j.stats;
      if (!s) return { ok: false, label: 'قراءة آخر باك تيست', detail: 'لا يوجد باك تيست محفوظ — اطلب مني تشغيل واحد' };
      return {
        ok: true,
        label: 'قراءة آخر باك تيست',
        detail: `${s.totalTrades} صفقة | نجاح ${s.winRate.toFixed(1)}% | صافي ${s.netPnl >= 0 ? '+' : ''}${s.netPnl.toFixed(1)}$ | PF ${s.profitFactor.toFixed(2)} | تراجع ${s.maxDrawdownPct.toFixed(1)}% | الرصيد ${s.finalBalance.toFixed(1)}$`,
        data: { backtest: { stats: s, trades: (j.trades ?? []).slice(-10), runAt: j.runAt } },
      };
    },
  },

  // ---------- تغيير (نفس صلاحيات الواجهة — حارس الدستور يحرس الأرقام المجمدة) ----------
  set_rule: {
    desc: 'تغيير قاعدة عليا واحدة (تفعيل/تعطيل + قيمة رقمية). أمثلة المفاتيح: fixed_lot, max_daily_trades, daily_loss_stop, daily_profit_stop, sl_floor, sl_cap, tp_ratio, max_concurrent, quality_gate, spread_gate, risk_sizing, news_filter, max_hold_hours, min_hold_min, min_daily_trades_kpi',
    args: '{"key": "اسم القاعدة", "enabled": true, "value": رقم}',
    run: async (a) => {
      const key = str(a.key);
      if (!key) return { ok: false, label: 'تغيير قاعدة', detail: 'مفتاح القاعدة مفقود' };
      const cur = await getSettings();
      const rule = cur.globalRules[key];
      if (!rule) return { ok: false, label: `تغيير قاعدة ${key}`, detail: `لا توجد قاعدة بهذا الاسم (${key}) — تحقق من الاسم` };
      const enabled = typeof a.enabled === 'boolean' ? a.enabled : rule.enabled;
      const value = num(a.value) ?? rule.value;
      const res = await patchSettings([
        { op: 'replace', path: `/globalRules/${key}/enabled`, value: enabled },
        { op: 'replace', path: `/globalRules/${key}/value`, value },
      ]);
      if (!res.applied) return { ok: false, label: `تغيير قاعدة ${key}`, detail: `رفض حارس الدستور: ${res.refused[0]?.reason ?? 'رقم مجمد'}` };
      return {
        ok: true,
        label: `تغيير قاعدة ${key}`,
        detail: `تم: ${key} ${enabled ? 'مفعّلة' : 'معطّلة'} بالقيمة ${value} (كانت ${rule.enabled ? `مفعّلة=${rule.value}` : 'معطّلة'})`,
      };
    },
  },

  set_session: {
    desc: 'تفعيل/تعطيل جلسة أو جلسات لاستراتيجية. الجلسات: asia, london, londonNY, ny — الاستراتيجيات: A حتى O وZ',
    args: '{"strategy": "E", "session": "london أو اتركه فارغاً لكل الجلسات", "enabled": true}',
    run: async (a) => {
      const st = str(a.strategy).toUpperCase();
      if (!STRATEGIES.includes(st)) return { ok: false, label: 'تغيير جلسة', detail: `استراتيجية غير معروفة: ${st}` };
      const enabled = a.enabled !== false;
      const target = str(a.session) ? [str(a.session)] : SESSIONS;
      const valid = target.filter(s => SESSIONS.includes(s));
      if (!valid.length) return { ok: false, label: 'تغيير جلسة', detail: `جلسة غير معروفة: ${str(a.session)}` };
      const patches = valid.map(s => ({ op: 'replace' as const, path: `/sessions/${st}/${s}`, value: enabled }));
      const res = await patchSettings(patches);
      if (!res.applied) return { ok: false, label: `جلسات ${st}`, detail: `رفض حارس الدستور: ${res.refused[0]?.reason ?? ''}` };
      const ar = valid.map(s => SESSION_AR[s]).join('، ');
      return { ok: true, label: `جلسات الاستراتيجية ${st}`, detail: `تم ${enabled ? 'تفعيل' : 'تعطيل'} ${ar} للاستراتيجية ${st}` };
    },
  },

  solo_strategy: {
    desc: 'حصرية كاملة: تفعيل استراتيجية واحدة على كل جلساتها وتعطيل كل الاستراتيجيات الأخرى (نمط E الحالي)',
    args: '{"strategy": "E"}',
    run: async (a) => {
      const st = str(a.strategy).toUpperCase();
      if (!STRATEGIES.includes(st)) return { ok: false, label: 'حصرية استراتيجية', detail: `استراتيجية غير معروفة: ${st}` };
      const patches: { op: 'replace'; path: string; value: boolean }[] = [];
      for (const s of STRATEGIES) for (const ses of SESSIONS) patches.push({ op: 'replace', path: `/sessions/${s}/${ses}`, value: s === st });
      const res = await patchSettings(patches);
      if (!res.applied) return { ok: false, label: 'حصرية استراتيجية', detail: `رفض حارس الدستور: ${res.refused[0]?.reason ?? ''}` };
      return { ok: true, label: 'حصرية استراتيجية', detail: `تم: الاستراتيجية ${st} وحدها مفعّلة على كل الجلسات، والبقية مطفأة` };
    },
  },

  set_priority: {
    desc: 'إعادة ترتيب سلم الأولويات (3 بنود من: counter, close100, far100)',
    args: '{"order": ["counter", "close100", "far100"]}',
    run: async (a) => {
      const order = Array.isArray(a.order) ? (a.order as unknown[]).map(str) : [];
      const valid = ['counter', 'close100', 'far100'];
      if (order.length !== 3 || !order.every(o => valid.includes(o))) return { ok: false, label: 'سلم الأولويات', detail: 'الترتيب يجب أن يكون 3 بنود من: counter, close100, far100' };
      const res = await patchSettings([{ op: 'replace', path: '/priority', value: order }]);
      if (!res.applied) return { ok: false, label: 'سلم الأولويات', detail: `رفض حارس الدستور: ${res.refused[0]?.reason ?? ''}` };
      return { ok: true, label: 'سلم الأولويات', detail: `تم الترتيب: ${order.join(' ثم ')}` };
    },
  },

  add_manual_level: {
    desc: 'إضافة مستوى يدوي (تعليمة دخول مباشرة للبوت): سعر، اتجاه buy/sell، مسافة الوقف بالدولار',
    args: '{"price": 4028.5, "dir": "buy", "slDollars": 12, "note": "سبب اختياري"}',
    run: async (a) => {
      const price = num(a.price);
      const dir = str(a.dir) === 'sell' ? 'sell' : 'buy';
      const slDollars = num(a.slDollars) ?? 10;
      if (price === null || price <= 0) return { ok: false, label: 'إضافة مستوى يدوي', detail: 'سعر غير صالح' };
      const cur = await getSettings();
      const levels = cur.manualLevels?.levels ?? [];
      const lvl = { id: `jv${Date.now()}`, price, dir, slDollars, note: str(a.note) || 'أمر جارفس المباشر', createdAt: Date.now() };
      const res = await patchSettings([{ op: 'replace', path: '/manualLevels/levels', value: [...levels, lvl] }]);
      if (!res.applied) return { ok: false, label: 'إضافة مستوى يدوي', detail: `رفض حارس الدستور: ${res.refused[0]?.reason ?? ''}` };
      return { ok: true, label: 'إضافة مستوى يدوي', detail: `تم: ${dir === 'buy' ? 'شراء' : 'بيع'} عند ${price}$ بوقف ${slDollars}$ — البوت سينفذه وفق قواعد الحوكمة`, data: lvl };
    },
  },

  clear_manual_levels: {
    desc: 'حذف كل المستويات اليدوية دفعة واحدة',
    args: '{}',
    run: async () => {
      const res = await patchSettings([{ op: 'replace', path: '/manualLevels/levels', value: [] }]);
      if (!res.applied) return { ok: false, label: 'حذف المستويات', detail: `رفض حارس الدستور: ${res.refused[0]?.reason ?? ''}` };
      return { ok: true, label: 'حذف المستويات', detail: 'تم حذف كل المستويات اليدوية' };
    },
  },

  remove_manual_level: {
    desc: 'حذف مستوى يدوي واحد بالسعر (يُختار الأقرب للسعر المعطى) أو بمعرّفه',
    args: '{"price": 4028.5} أو {"id": "jv123"}',
    run: async (a) => {
      const cur = await getSettings();
      const levels = cur.manualLevels?.levels ?? [];
      if (!levels.length) return { ok: false, label: 'حذف مستوى يدوي', detail: 'لا توجد مستويات يدوية أصلاً' };
      const id = str(a.id);
      const price = num(a.price);
      let target: (typeof levels)[number] | null = null;
      if (id) target = levels.find(l => l.id === id) ?? null;
      else if (price !== null) target = levels.reduce((best, l) => (best === null || Math.abs(l.price - price) < Math.abs(best.price - price) ? l : best), null as (typeof levels)[number] | null);
      if (!target) return { ok: false, label: 'حذف مستوى يدوي', detail: 'لم أجد مستوى مطابقاً — اقرأ الإعدادات أولاً لعرض المستويات الحالية' };
      const rest = levels.filter(l => l.id !== target!.id);
      const res = await patchSettings([{ op: 'replace', path: '/manualLevels/levels', value: rest }]);
      if (!res.applied) return { ok: false, label: 'حذف مستوى يدوي', detail: `رفض حارس الدستور: ${res.refused[0]?.reason ?? ''}` };
      return { ok: true, label: 'حذف مستوى يدوي', detail: `تم حذف: ${target.dir === 'buy' ? 'شراء' : 'بيع'} عند ${target.price}$ بوقف ${target.slDollars}$ (بقي ${rest.length} مستوى)` };
    },
  },

  run_backtest: {
    desc: 'تشغيل باك تيست حقيقي على شموع XAUUSD الفعلية من MT5 (سريع جداً — كاش دائم) ويعيد الأرقام الكاملة. لسنة محددة مرّر الوسيطة year (مثال {"year": 2025})، ولمدى سنوات مرّر from وto (مثال {"from": 2020, "to": 2023}) — متاح من 2015 إلى السنة الحالية، وبلا وسائل = كل التاريخ المتوفر. مرّر دائماً hint = نص السيد الحرفي كي تُستخرج السنة تلقائياً إن فاتتك',
    args: '{"year": 2025} أو {"from": 2020, "to": 2023} أو {} مع hint نص السيد',
    run: async (a) => {
      // ---- قراءة سنة مرنة: رقم، نص لاتيني «"2025"»، أرقام عربية-هندية «٢٠٢٥»، أو استخراج من نص السيد ----
      const AR_DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
      const toLatin = (s: string) => s.replace(/[٠-٩۰-۹]/g, d => AR_DIGITS[d] ?? d);
      const parseY = (v: unknown): number | null => {
        if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
        if (typeof v === 'string') { const s = toLatin(v).replace(/[^\d]/g, ''); if (/^\d{4}$/.test(s)) return Number(s); }
        return null;
      };
      const hint = str(a.hint);
      let year = parseY(a.year) ?? (hint ? (toLatin(hint).match(/\b(20\d{2}|201\d)\b/)?.[1] ? Number(toLatin(hint).match(/\b(20\d{2}|201\d)\b/)![1]) : null) : null);
      let fromYear = parseY(a.from) ?? (hint && /من\s+(20\d{2})/.test(toLatin(hint)) ? Number(toLatin(hint).match(/من\s+(20\d{2})/)![1]) : null);
      let toYear = parseY(a.to) ?? (hint && /(إلى|الى|حتى)\s+(20\d{2})/.test(toLatin(hint)) ? Number(toLatin(hint).match(/(إلى|الى|حتى)\s+(20\d{2})/)![2]) : null);
      // صيغة المدى الصريحة «من 2020 إلى 2023» تقدّم على السنة المفردة ولو اختار العقل أول سنة
      const rangeM = hint ? toLatin(hint).match(/من\s+(20\d{2})\s*(?:إلى|الى|حتى)\s+(20\d{2})/) : null;
      if (rangeM) { year = null; fromYear = Number(rangeM[1]); toYear = Number(rangeM[2]); }
      const MAXY = new Date().getFullYear();
      if (year !== null && (year < 2015 || year > MAXY)) {
        return { ok: false, label: 'تشغيل باك تيست', detail: `سنة ${year} خارج النطاق المدعوم — المتاح من 2015 إلى ${MAXY}` };
      }
      // ---- تنفيذ مع إعادة محاولة ذاتية: عطل شبكة/تجمّد عابر لا يوقف أمر السيد ----
      const attempt = async (): Promise<ToolResult> => {
        const payload: Record<string, unknown> = {};
        if (year !== null) payload.year = year;
        else if (fromYear !== null && toYear !== null) { payload.from = fromYear; payload.to = toYear; }
        const j = await api<{
          year?: number; fromYear?: number | null; toYear?: number | null;
          period?: { from: string; to: string };
          coverage5m?: { from: string; to: string } | null;
          runMs?: number;
          coverage?: { from?: string; to?: string; symbol?: string };
          trades?: { dir?: string; strategy?: string; entry?: number; exit?: number; result?: string; pnl?: number; entryT?: number }[];
          stats?: Record<string, number | string | object> & { totalTrades?: number; winRate?: number; netPnl?: number; profitFactor?: number; maxDrawdownPct?: number; finalBalance?: number; baseBalance?: number };
        }>('/api/backtest', { method: 'POST', body: JSON.stringify(payload), signal: AbortSignal.timeout(240_000) });
        const s = j.stats ?? {};
        if (typeof s.totalTrades !== 'number') {
          return { ok: false, label: 'تشغيل باك تيست', detail: 'انتهى التشغيل بلا صفقات قابلة للقياس — تأكد من تغطية الشموع' };
        }
        const scope = year !== null ? `سنة ${year}` : (fromYear !== null && toYear !== null ? `من ${fromYear} إلى ${toYear}` : 'كل التاريخ المتوفر');
        const span = j.period ? ` (${j.period.from.slice(0, 10)} → ${j.period.to.slice(0, 10)})` : '';
        // شفافية التغطية: إن بدأت شموع 5m الحقيقية وسط الفترة يُذكر ذلك صراحة بالتواريخ
        const covNote = j.coverage5m && j.period && j.coverage5m.from.slice(0, 10) > j.period.from.slice(0, 10)
          ? ` — تحذير شفافية: شموع 5m الحقيقية المتاحة تبدأ من ${j.coverage5m.from.slice(0, 10)} (حد طرفية الوسيط) فالتقرير الفعلي يغطي من ${j.coverage5m.from.slice(0, 10)} فصاعداً`
          : '';
        return {
          ok: true,
          label: `تشغيل باك تيست — ${scope}`,
          detail: `على شموع XAUUSD الحقيقية من MT5${span}${covNote}: ${s.totalTrades} صفقة | نجاح ${Number(s.winRate ?? 0).toFixed(1)}% | صافي ${Number(s.netPnl ?? 0) >= 0 ? '+' : ''}${Number(s.netPnl ?? 0).toFixed(1)}$ | PF ${Number(s.profitFactor ?? 0).toFixed(2)} | تراجع ${Number(s.maxDrawdownPct ?? 0).toFixed(1)}% | الرصيد من ${Number(s.baseBalance ?? 1000).toFixed(0)}$ إلى ${Number(s.finalBalance ?? 0).toFixed(1)}$ (${Number(j.runMs ?? 0) < 1000 ? Number(j.runMs ?? 0) : Math.round(Number(j.runMs ?? 0) / 100) / 10}ث)`,
          data: {
            backtest: {
              year: year ?? null,
              fromYear: fromYear ?? null,
              toYear: toYear ?? null,
              period: j.period ?? null,
              stats: s,
              trades: (j.trades ?? []).slice(-12),
              coverage: j.coverage ?? null,
            },
          },
        };
      };
      try {
        return await attempt();
      } catch (e) {
        const msg = String((e as Error).message ?? e);
        // الأخطاء الحتمية (حد تغطية البيانات) لا تُعاد — الرد فوري بالسبب الحقيقي
        if (/غير متوفرة|غير كافية|خارج النطاق/.test(msg)) {
          return { ok: false, label: `تشغيل باك تيست${year !== null ? ` — سنة ${year}` : ''}`, detail: msg.slice(0, 200) };
        }
        // إعادة محاولة واحدة تلقائية — تعطل عابر أو مهلة بوابة لا تُرجع السيد خائب الانتظار
        await new Promise(r => setTimeout(r, 4000));
        try {
          return await attempt();
        } catch (e2) {
          return { ok: false, label: `تشغيل باك تيست${year !== null ? ` — سنة ${year}` : ''}`, detail: `${msg.slice(0, 120)} — وأعدت المحاولة ففشل: ${String((e2 as Error).message ?? e2).slice(0, 120)}` };
        }
      }
    },
  },

  guardian_heal: {
    desc: 'أمر فوري للوكيل الحارس: دورة فحص وإصلاح شاملة لكل مكونات النظام',
    args: '{}',
    run: async () => {
      const j = await api<{ report?: { status?: string; checks?: { label: string; status: string }[] }; status?: string; checks?: { label: string; status: string }[] }>('/api/system/heal', { method: 'POST', body: JSON.stringify({}) });
      const rep = j.report ?? j; // الـ API يعيد التقرير في الجذر مباشرة
      const checks = rep.checks ?? [];
      const bad = checks.filter(c => c.status === 'fail').map(c => c.label);
      return {
        ok: true,
        label: 'دورة فحص وإصلاح شاملة',
        detail: `الحالة: ${rep.status ?? 'غير معروفة'} | ${checks.length} فحص${bad.length ? ` | فاشل: ${bad.join('، ')}` : ' | كل الفحوصات سليمة'}`,
        data: rep,
      };
    },
  },
};

export function toolsCatalog(): string {
  return Object.entries(TOOLS)
    .map(([name, t]) => `- ${name}: ${t.desc} | الوسائط: ${t.args}`)
    .join('\n');
}

export function isTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOLS, name);
}
