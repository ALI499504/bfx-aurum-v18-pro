// مرحلة 2 من زرع السلة المعتمدة: عزل مسار السلة الظل
// ------------------------------------------------------------
// القياس الحي أثبت أن زرع مكوّنات السلة (W/X/Y/AA) داخل محرك TAMSA
// المزدحم يخنقها: TSMOM 3 صفقات بدل 26، وOgle PF 0.61 بدل 2.15 —
// بسبب الصمامات المشتركة (33 يوماً محظوراً من 90) وسلم الأولويات
// وسقف التزامن 4 المُدار لمصلحة A–R.
//
// القرار المنفذ هنا (وفق الاعتماد):
// 1) W/X/Y/AA معطلة في المحرك الحي — السلة تعمل في مسارها الظلي
//    المستقل (src/lib/engine/basket.ts + /api/basket) بمعزولها الحرفي.
// 2) الصمامات الثلاثة تخرج من إعدادات المحرك (كانت قيدت السلة والمحرك
//    معاً وتغيرت به سلوك TAMSA-18 المتحقق — 33 يوم حظر/90 يوماً).
//    حماية المحرك الرسمية تبقى القاعدة 7 المطلقة (حد خسارة يومي 50$).
//    الصمامات المعتمدة (3%/6%/500$) أصبحت مبنية داخل وحدة السلة نفسها.
// 3) T/U/V تبقى معطلة (مرفوضة بالتحقق المزدوج) — وS محذوفة سابقاً.
import Database from 'bun:sqlite';

const db = new Database('/home/z/my-project/db/custom.db');
const row = db.query("SELECT json FROM BotSettings WHERE key='main'").get();
if (!row) { console.error('لا يوجد صف إعدادات main'); process.exit(1); }
const s = JSON.parse(row.json);

// ---------- 1) مكوّنات السلة تخرج من المحرك الحي إلى مسارها الظلي ----------
const sp = s.strategyParams ?? {};
for (const k of ['W', 'X', 'Y', 'AA']) {
  sp[k] = { ...(sp[k] ?? {}), enabled: false };
}
// المرفوضات بالتحقق المزدوج تبقى معطلة
for (const k of ['T', 'U', 'V']) {
  if (sp[k]) sp[k].enabled = false;
}
s.strategyParams = sp;

// ---------- 2) الصمامات تخرج من المحرك (انتقلت إلى وحدة السلة) ----------
const gr = s.globalRules ?? {};
gr.fuse_daily_pct = { ...(gr.fuse_daily_pct ?? {}), enabled: false };
gr.fuse_weekly_pct = { ...(gr.fuse_weekly_pct ?? {}), enabled: false };
gr.fuse_equity_floor = { ...(gr.fuse_equity_floor ?? {}), enabled: false };
// حماية المحرك الرسمية المتبقية: القاعدة 7 (حد يومي 50$) + سقف تزامن 4
s.globalRules = gr;

db.query("UPDATE BotSettings SET json=?, updatedAt=? WHERE key='main'")
  .run(JSON.stringify(s), Date.now());

// ---------- تحقق مطبوع ----------
const check = JSON.parse(db.query("SELECT json FROM BotSettings WHERE key='main'").get().json);
console.log('=== بعد العزل ===');
for (const [k, v] of Object.entries(check.strategyParams)) console.log(` ${k}: enabled=${v.enabled}`);
console.log('الصمامات في المحرك:', JSON.stringify({
  daily: check.globalRules.fuse_daily_pct?.enabled,
  weekly: check.globalRules.fuse_weekly_pct?.enabled,
  equity: check.globalRules.fuse_equity_floor?.enabled,
}));
console.log('حماية المحرك: rule7 daily_loss_stop =', JSON.stringify(check.globalRules.daily_loss_stop));
console.log('max_concurrent =', JSON.stringify(check.globalRules.max_concurrent));
db.close();
console.log('DONE');
