// ============================================================
// اختبارات محاذاة ساعة الجسر — تحمي إصلاح «الشارت الفارغ» من الانتكاس
// ------------------------------------------------------------
// الجسر (v21) يبث أزمنة بساعة سيرفر الوسيط (EET/EEST = +2/+3 عن UTC).
// القياس الحيّ قبل الإصلاح: آخر شمعة 5m بطابع 02:35 بينما UTC 00:36 (+119 دقيقة).
// الأثر: الشارت يرسم محوراً زمنياً في المستقبل ويظهر فارغاً/مقطوعاً.
// ============================================================
import { ingestMt5, mt5Feed, getClockSkewMs, getLiveCandles, mergedLastCandle, alignMs } from '../src/lib/server/mt5feed';

let fails = 0;
const check = (n: string, c: boolean, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};

const H = 3600e3;
const TF_MS: Record<string, number> = { '5m': 300e3, '15m': 900e3, '1h': H, '4h': 4 * H, '1d': 24 * H, '1w': 7 * 24 * H };

/** سلسلة شموع بسيطة تنتهي عند lastStart */
function series(n: number, tf: number, lastStart: number): number[][] {
  const out: number[][] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = lastStart - i * tf;
    const base = 2000 + (n - i) * 0.5;
    out.push([t, base, base + 1.2, base - 1.1, base + 0.3, 1000]);
  }
  return out;
}

/** يبني بثاً كاملاً بساعة وسيط متقدمة offsetMs عن الآن */
function pushBridge(nowMs: number, offsetMs: number, tickOffsetMs = offsetMs) {
  const tfs: Record<string, number[][]> = {};
  for (const [tf, ms] of Object.entries(TF_MS)) {
    // آخر شمعة مفتوحة «الآن» بساعة الوسيط
    const lastStart = Math.floor((nowMs + offsetMs) / ms) * ms;
    tfs[tf] = series(300, ms, lastStart);
  }
  ingestMt5({
    symbol: 'XAUUSD.m', v: 21, tfs,
    tick: { bid: 2000.5, ask: 2000.8, time: nowMs + tickOffsetMs },
    account: { login: '1', balance: 1000 },
  });
}

// ===== 1) ساعة وسيط +120 دقيقة (EET) — الحالة الحقيقية المقيسة =====
{
  const now = Date.now();
  pushBridge(now, 120 * 60e3);
  check('يقيس انحراف +120 دقيقة تلقائياً', getClockSkewMs() === 120 * 60e3, `${getClockSkewMs() / 60e3} دقيقة`);

  const c15 = getLiveCandles('15m', 60)!;
  check('يُعيد شموعاً كافية', !!c15 && c15.length > 100);
  const last = c15[c15.length - 1].t;
  check('آخر شمعة ليست في المستقبل', last <= Date.now(), new Date(last).toISOString());
  check('كل الشموع ≤ الآن', c15.every(c => c.t <= Date.now()));

  const m = mergedLastCandle(mt5Feed().tfs['15m'], mt5Feed().tick)!;
  check('الشمعة الحية (tick) ليست في المستقبل', m.t <= Date.now(), new Date(m.t).toISOString());
}

// ===== 2) ساعة وسيط +180 دقيقة (EEST صيفي) =====
{
  const now = Date.now();
  pushBridge(now, 180 * 60e3);
  check('يقيس انحراف +180 دقيقة (توقيت صيفي)', getClockSkewMs() === 180 * 60e3, `${getClockSkewMs() / 60e3} دقيقة`);
  const c5 = getLiveCandles('5m', 60)!;
  check('لا شمعة 5m في المستقبل بعد التحويل', c5.every(c => c.t <= Date.now()));
}

// ===== 3) ساعة متزامنة — لا تحويل ولا تشويه =====
{
  const now = Date.now();
  pushBridge(now, 0);
  check('الساعة المتزامنة تعطي انحراف صفر', getClockSkewMs() === 0, `${getClockSkewMs()}`);
  const c15 = getLiveCandles('15m', 60)!;
  check('لا شمعة في المستقبل', c15.every(c => c.t <= Date.now()));
  check('alignMs لا يغيّر الزمن', alignMs(123456789) === 123456789);
}

// ===== 4) انحراف صغير شاذ (7 دقائق) — لا يُقرَّب لساعة =====
{
  const now = Date.now();
  pushBridge(now, 7 * 60e3, 7 * 60e3);
  check('انحراف 7 دقائق لا يُقرَّب لساعة كاملة', getClockSkewMs() === 0, `${getClockSkewMs() / 60e3} دقيقة`);
}

// ===== 5) القصّ الاحتياطي: لا شمعة مستقبلية حتى لو تخطّى القياس =====
{
  const now = Date.now();
  pushBridge(now, 120 * 60e3);
  // نُدخل شموعاً متقدمة 30 دقيقة إضافية عن الانحراف المقيس (شذوذ غير مضاعف للساعة)
  const extra = 30 * 60e3;
  const tfs: Record<string, number[][]> = {};
  for (const [tf, ms] of Object.entries(TF_MS)) {
    const lastStart = Math.floor((now + 120 * 60e3 + extra) / ms) * ms;
    tfs[tf] = series(120, ms, lastStart);
  }
  ingestMt5({ symbol: 'XAUUSD.m', v: 21, tfs });
  const c = getLiveCandles('15m', 60)!;
  check('القصّ الاحتياطي يمنع أي شمعة مستقبلية', c.every(x => x.t <= Date.now()));
}

// ===== 6) الذيل المحاذي متسق: فروق الشموع تبقى فريم كامل =====
{
  const now = Date.now();
  pushBridge(now, 120 * 60e3);
  const c15 = getLiveCandles('15m', 60)!;
  // المحاذاة إزاحة ثابتة (طرح انحراف واحد)، فالمطلوب: (أ) ترتيب تصاعدي صارم،
  // (ب) لا انزياح كسري بين أول وآخر شمعة، (ج) البنية الأصلية محفوظة بالكامل.
  const ascending = c15.every((c, i) => i === 0 || c.t > c15[i - 1].t);
  check('الترتيب الزمني تصاعدي صارم بعد المحاذاة', ascending);
  // قراءة مطابقة من المخزون مباشرة (نفس اللحظة) — نقارن OHLC والعدّ
  const rawArr = mt5Feed().tfs['15m']!;
  // المعروض = المخزون ناقص الشموع المستقبلية المقصوصة (0 أو أكثر، القصّ إلزامي)
  check('المعروض ≤ المخزون والفارق شموع مستقبلية فقط',
    c15.length <= rawArr.length && c15.every(x => x.t <= Date.now()),
    `${c15.length} / ${rawArr.length}`);
  const sameStruct = c15.every((c, i) => c.o === rawArr[i].o && c.h === rawArr[i].h && c.l === rawArr[i].l && c.c === rawArr[i].c);
  check('قيم OHLC لم تتغير (إزاحة زمن فقط)', sameStruct);
  const shift = c15.length ? rawArr[0].t - c15[0].t : -1;
  check('الإزاحة ثابتة لكل الشموع', c15.every((c, i) => rawArr[i].t - c.t === shift), `${shift} ms`);
}

// ===== 7) الإقلاع من لقطة القرص: القياس يجب أن يحدث بلا أي دفعة جسر =====
// (بعد إعادة النشر تمرّ دقائق قبل أول دفعة — بلا هذا القياس يُعرض الشارت
//  بساعة الوسيط المتقدمة حتى تصل الدفعة الأولى.)
{
  const { execSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const now = Date.now();
  const SHIFT = 120 * 60e3;
  const base = JSON.parse(fs.readFileSync('/tmp/snap.json', 'utf8')) as { tfs: Record<string, number[][]> };
  const tfs: Record<string, number[][]> = {};
  for (const k of Object.keys(base.tfs)) {
    const arr = base.tfs[k];
    const lastReal = arr[arr.length - 1][0];
    const tfms = TF_MS[k] ?? 3600e3;
    const bump = now + SHIFT - lastReal - tfms;
    tfs[k] = arr.map(r => [r[0] + bump, r[1], r[2], r[3], r[4], r[5]]);
  }
  const snapDir = path.join('/tmp', 'clock-align-snap', 'db');
  fs.mkdirSync(snapDir, { recursive: true });
  fs.writeFileSync(path.join(snapDir, 'mt5-feed-snapshot.json'), JSON.stringify({
    symbol: 'XAUUSD.m', broker: 'Just', bridgeV: 21, account: { login: '1' }, tfs,
    tick: { bid: 2000.5, ask: 2000.8, time: now + SHIFT },
    updatedAt: now - 3e3, firstPushAt: now, pushes: 5,
  }));
  const scriptPath = path.join('/tmp/clock-align-snap', 'run.ts');
  fs.writeFileSync(scriptPath, [
    `import { getClockSkewMs, getLiveCandles } from '${process.cwd()}/src/lib/server/mt5feed';`,
    "getLiveCandles('5m', 10);",
    'const skew = getClockSkewMs() / 60e3;',
    "const c = getLiveCandles('15m', 60);",
    'const last = c && c.length ? c[c.length - 1].t : 0;',
    'console.log(JSON.stringify({ skew, future: last > Date.now(), last }));',
  ].join(String.fromCharCode(10)));
  try {
    const out = execSync(`cd /tmp/clock-align-snap && bun run ${scriptPath}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const line = out.trim().split(String.fromCharCode(10)).filter(l => l.startsWith('{')).pop() ?? '{}';
    const r = JSON.parse(line) as { skew?: number; future?: boolean };
    check('الاستعادة من اللقطة تقيس الانحراف بلا دفعة جسر', r.skew === 120, `${r.skew} دقيقة`);
    check('بعد الاستعادة: لا شمعة مستقبلية', r.future === false);
  } catch (e) {
    check('اختبار الاستعادة يعمل', false, String(e).slice(0, 60));
  }
}

console.log(fails === 0 ? '\n🎉 كل اختبارات محاذاة الساعة نجحت' : `\n❌ فشل ${fails} اختباراً`);
process.exit(fails === 0 ? 0 : 1);
