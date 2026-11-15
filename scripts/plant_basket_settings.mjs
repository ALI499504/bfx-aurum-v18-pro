// زرع إعدادات السلة المعتمدة في قاعدة البوت — تنفيذ واحد آمن وموثق
// يعمل عبر bun scripts/plant_basket_settings.mjs
import Database from 'bun:sqlite';

const db = new Database('/home/z/my-project/db/custom.db');
const row = db.query("SELECT json FROM BotSettings WHERE key='main'").get();
if (!row) { console.error('لا يوجد صف إعدادات main'); process.exit(1); }
const s = JSON.parse(row.json);

// ---------- 1) معاملات الاستراتيجيات ----------
const sp = s.strategyParams ?? {};
// حذف ORB نهائياً (S) — الرمز محجوز للتاريخ ولا يُعاد
delete sp.S;
// T/U/V: مرفوضة بالتحقق المزدوج (PF<1 في النافذتين) — تعطيل صريح
if (sp.T) sp.T.enabled = false;
if (sp.U) sp.U.enabled = false;
if (sp.V) sp.V.enabled = false;
// W: إعادة بناء كاملة بالنسخة المتحقق منها (TSMOM-30d على الساعة)
sp.W = {
  enabled: true,
  main: { enabled: true, s1: { asia: true, london: true, londonNY: true, ny: true }, s2: { asia: true, london: true, londonNY: true, ny: true } },
  horizonDays: 30,
  atrN: 14,
  slAtrMult: 3.0,
  expHours: 8,
};
// X: Ogle — تبقى كما هي (مفعلة، متحقق منها)
if (!sp.X) sp.X = { enabled: true };
sp.X.enabled = true;
// Y: EWMAC 32/128 — تحقق مزدوج ناجح
sp.Y = {
  enabled: true,
  main: { enabled: true, s1: { asia: true, london: true, londonNY: true, ny: true }, s2: { asia: true, london: true, londonNY: true, ny: true } },
  fast: 32, slow: 128, atrN: 14, slAtrMult: 3.0, expHours: 8,
};
// AA: دونشييان 120/60 — تحقق مزدوج ناجح
sp.AA = {
  enabled: true,
  main: { enabled: true, s1: { asia: true, london: true, londonNY: true, ny: true }, s2: { asia: true, london: true, londonNY: true, ny: true } },
  entryN: 120, exitN: 60, atrN: 14, slAtrMult: 2.0, reassertBars: 24, expHours: 6,
};
s.strategyParams = sp;

// ---------- 2) الصمامات + سقف التزامن ----------
const gr = s.globalRules ?? {};
gr.fuse_daily_pct = { enabled: true, value: 3 };
gr.fuse_weekly_pct = { enabled: true, value: 6 };
gr.fuse_equity_floor = { enabled: true, value: 15 };
gr.max_concurrent = { enabled: true, value: 4 };
gr.single_trade = { enabled: true, value: 0 }; // دلالة عصر السلة: صفقة لكل استراتيجية
gr.max_hold_hours = { enabled: false, value: 8 }; // السلة تحتفظ طويلاً بالتصميم (خروج القاعدة)
s.globalRules = gr;

// ---------- 3) سلم الأولويات: السلة بعد TAMSA ثم المرفوضات ----------
const ladderOrder = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','W','X','Y','AA','T','U','V'];
for (const k of ['asia','london','londonNY','ny']) {
  s.priorityLadder[k] = ladderOrder;
}

// ---------- 4) بوابات الجلسات: حذف S + ضمان W/X/Y/AA ----------
const ss = s.scenarioSessions ?? {};
delete ss.S;
const allOn = { enabled: true, asia: true, london: true, londonNY: true, ny: true };
for (const st of ['T','U','V','W','X','Y','AA']) {
  ss[st] = ss[st] ?? {};
  ss[st].main = { s1: { ...allOn }, s2: { ...allOn } };
}
s.scenarioSessions = ss;

db.query("UPDATE BotSettings SET json=?, updatedAt=? WHERE key='main'")
  .run(JSON.stringify(s), Date.now());

// ---------- تحقق نهائي مطبوع ----------
const check = JSON.parse(db.query("SELECT json FROM BotSettings WHERE key='main'").get().json);
console.log('=== بعد الزرع ===');
for (const [k, v] of Object.entries(check.strategyParams)) console.log(` ${k}: enabled=${v.enabled}`);
console.log('Fuses:', JSON.stringify({
  daily: check.globalRules.fuse_daily_pct, weekly: check.globalRules.fuse_weekly_pct,
  equity: check.globalRules.fuse_equity_floor, maxCon: check.globalRules.max_concurrent,
  maxHold: check.globalRules.max_hold_hours,
}));
console.log('Ladder:', check.priorityLadder.asia.join(','));
console.log('scenarioSessions keys:', Object.keys(check.scenarioSessions).join(','));
db.close();
console.log('DONE');
