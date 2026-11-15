# عقد الـAPI — BFX AURUM

مستخرج من كود العميل (`source-readable/app/app-module.js`) ومُوثَّق باستجابات حقيقية محفوظة في `api/`.

> يصف هذا الملف **واجهة النسخة المنشورة (2026-11-11)**. نسخة المحرك المحلية في `app/`
> تغطي معظمها وتضيف تنفيذاتها الخاصة لأربعة مسارات — انظر «تنفيذ المحرك المحلي» أسفل الملف.
كل المسارات نسبية إلى أصل الموقع، وكلها JSON إلا ما ذُكر.

## قراءة (GET)

| المسار | الوصف | الملف المحفوظ |
|---|---|---|
| `/api/system/health` | صحة النظام: db / feed / snapshot / settings + دورات الإصلاح الذاتي (`cycles`, `heals`, `lastCycleMs`, `checks[]`) | `api/system/health.json` |
| `/api/system/heal` | (POST) يطلب دورة إصلاح فورية | — |
| `/api/price` | السعر الحي + حالة البيانات (عدد الشموع لكل فريم، النطاق الزمني، المصدر) | `api/market/price.json` |
| `/api/mt5/status` | حالة الجسر + الحساب + آخر تِك + عدّاد الدفعات | `api/mt5/status.json` |
| `/api/mt5/account` | الرصيد/الحقوق/الهامش/الربح | `api/mt5/account.json` |
| `/api/mt5/tick` | آخر تِك (bid/ask/time) | `api/mt5/tick.json` |
| `/api/settings` | إعدادات المحرك كاملة (`globalRules`, `strategyParams`, `scenarioSessions`, `priorityLadder`, `indicators`, `manualLevels`) + `updatedAt` | `api/engine/settings.json` |
| `/api/signals` | الإشارات الحية: الجلسة، اتجاه EMA والترند 1h/4h، حالة السوق، المعلّقة، حدود اليوم، الصفقات الظلية | `api/engine/signals.json` |
| `/api/alerts` | إعداد تنبيهات تيليجرام | `api/engine/alerts.json` |
| `/api/automanager` | تقرير المدير الآلي: قرارات تفعيل/تعطيل لكل استراتيجية مع المقاييس والأسباب | `api/engine/automanager.json` |
| `/api/backtest?meta=1` | ملخّص آخر تشغيل (id, runAt, summary) | `api/backtest/meta.json` |
| `/api/backtest` | آخر تشغيل كامل: `trades[2105]` + `stats{41}` | `api/backtest/run-latest.json` |
| `/api/basket` | السلة المعتمدة (محفظة الظل على أساس 1000$) | `api/engine/basket.json` |
| `/api/tuner` | حالة الضبط الشبكي: `running`, `stage`, `done/total`, `log[]` | `api/tuning/tuner.json` |
| `/api/trainer` | تقرير المدرب الذكي بالأرقام | `api/tuning/trainer.json` |
| `/api/visitors` | عدّاد الزوار | `api/system/visitors.json` |
| `/api/jarvis/auth` | حالة قفل J.A.R.V.I.S (`locked`, `closed`) | `api/jarvis/auth.json` |
| `/api/chart?tf=<TF>&limit=<n>` | شموع + EMA سريع/بطيء. `TF ∈ 5m 15m 30m 1h 4h 1d 1w 1M`، السقف العملي 800 شمعة | `api/market/chart-<TF>.json` |
| `/api/chart?tf=&from=&to=` | نفس الاستجابة لكن بنافذة زمنية (يستخدمها شارت الصفقة في السجل) | — |
| `/api/forecast?tf=<TF>` | توقع الفريم نفسه | `api/market/forecast-<TF>.json` |

## كتابة (POST/PUT/DELETE)

| المسار | الطريقة | جسم الطلب | ملاحظات |
|---|---|---|---|
| `/api/settings` | `PUT` | `{ "patches": [...] }` | حفظ جماعي للتعديلات؛ يحفظ `updatedAt` لكل تعديل ويعيده للمزامنة بين التبويبات |
| `/api/backtest` | `POST` | — | يبدأ تشغيل باك تيست جديد على شموع MT5 الحقيقية |
| `/api/tuner` | `POST` | — | يبدأ بحثاً شبكياً (تدريب ثم تحقق خارج العينة) |
| `/api/automanager` | `POST` | `{ mode, ... }` | يطلب قرارات المدير الآلي |
| `/api/alerts` | `POST` | `{ botToken, chatId }` | ضبط تيليجرام؛ النجاح = `{ok:true}` |
| `/api/visitors` | `POST` | `{ id, leave?: true }` | تتبّع زائر |
| `/api/jarvis/auth` | `POST` | بيانات الدخول | يفتح جلسة J.A.R.V.I.S؛ `DELETE` يقفلها |
| `/api/jarvis` | `POST` | `{ text }` | **رد متدفق** (streaming) — العميل يقرأ بـ `getReader()`؛ 401 يعني جلسة مقفلة؛ 503 = المحرك غير متاح |
| `/api/jarvis/tts?text=...` | `GET` | — | صوت المساعد |
| `/api/system/heal` | `POST` | — | إصلاح ذاتي فوري |

## ملاحظات سلوكية مهمة

- كل استدعاءات القراءة تُرسل بـ `cache: "no-store"` — لا كاش.
- واجهة التحكم تنبض دورياً (health كل ثوانٍ، price/signals/backtest الأحدث، settings للمزامنة)،
  لذلك أي إعادة بناء خلفية محلية يجب أن تحافظ على نفس معدّل التحديث وإلا تجمّدت المؤشرات.
- `401` من `/api/jarvis` + `PATCH` على `/api/settings` هما المساران الوحيدان اللذان يغيّران حالة
  الواجهة (قفل J.A.R.V.I.S / حالة الحفظ).

---

## تنفيذ المحرك المحلي (`app/`) للمسارات الأربعة

هذه المسارات غير موجودة في الكود المصدري المنزَّل (2026-11-04) لكن الواجهة الأحدث تطلبها،
فنُفِّذت على بيانات المحرك الحقيقية:

| المسار | السلوك في `app/` | الشكل |
|---|---|---|
| `GET /api/alerts` | يقرأ إعداد تيليجرام من `BotSettings(key='alerts')` — لا يعيد التوكن أبداً | `{ok, alerts:[], telegram:{configured, chatId}}` |
| `POST /api/alerts` | `{botToken, chatId}` → حفظ؛ `DELETE` يمسح الضبط | `{ok, telegram:{...}}` |
| `GET /api/automanager` | التقرير المحفوظ أو `{exists:false}` | `{exists, report, autoMode, updatedAt}` |
| `POST /api/automanager` | يبني القرارات من **آخر باك تيست محفوظ**: عيّنة < 30 → «تحت المراقبة»، `PF < 1` → تعطيل، `PF ≥ 1.15` → تفعيل | `{ok, report:{runAt, mode, window, decisions[], finalEnabled, summary}}` |
| `GET /api/basket` | محفظة ظل على أساس 1000$ من صفقات آخر باك تيست: `metricsAll/metrics365/monthly/validation/live` | مطابق للمفاتيح المستهلكة في الواجهة |
| `GET /api/tuner` | التقرير المحفوظ فقط (إن وُجد) وإلا حالة فارغة صريحة | `{running:false, stage, done, total, log, error, report}` |
| `POST /api/tuner` | **501** برسالة صريحة: البحث الشبكي غير موجود في هذا المحرك (المعاملات مجمّدة في المواصفة) | `{ok:false, error}` |

الفروق المقصودة عن النسخة المنشورة: `basket` لا يحسب سلةً متعددة المكوّنات على 20,040 شمعة
ساعية بل يشتق المقاييس من صفقات الباك تيست المحفوظة، و`validation[]` فيه بند لكل استراتيجية
(ليس 13 بنداً كما في المنصة).
