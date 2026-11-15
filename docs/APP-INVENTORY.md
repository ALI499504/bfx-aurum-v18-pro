# جرد التطبيق (من الكود + إعدادات المحرك الحية)

> هذا الجرد يصف **النسخة المنشورة 2026-11-11** (14 تبويباً · 25 استراتيجية · 38 قاعدة).
> أما محرك `app/` المحلي (المصدري 2026-11-04) فيعرف 11 تبويباً و16 استراتيجية (A–O + Z)
> و28 قاعدة — الفرق مُوثَّق في `README.md` قسم «المفقود المتبقي».

## التبويبات (14) — `source-readable/app/app-module.js` سطر ~2661

| المعرّف | العنوان | الوصف الظاهر |
|---|---|---|
| `dashboard` | لوحة القيادة | الشارت الحقيقي MT5 كامل الشاشة |
| `autotune` | الضبط الذاتي | بحث شبكي + مدير آلي بالأداء |
| `strategies` | الاستراتيجيات A–W | الشجرة الآلية (بلا تحكم يدوي) |
| `signals` | الإشارات الحية | دخول فوري لحظة اكتمال الشروط |
| `trainer` | المدرب الذكي | تقرير أداء + مقترحات بالأرقام |
| `levels` | المستويات اليدوية | تعليماتك المباشرة للبوت |
| `trades` | سجل الصفقات | كل صفقة بتقرير وشارت |
| `account` | حسابي | الرصيد ومنحنى النمو |
| `backtest` | الباك تيست والتقارير | اختبار على شموع MT5 الحقيقية |
| `basket` | السلة المعتمدة | محفظة الظل على أساس 1000$ |
| `sessions` | جدولة الجلسات | بوابات آلية بالأداء المقاس |
| `priority` | سلم الأولويات | 4 لوحات جلسات + حل النزاعات |
| `rules` | القواعد العليا | إدارة المخاطر الحاكمة (21 قاعدة معروضة، 38 مفتاحاً في المحرك) |
| `indicators` | المؤشرات الفنية | الجلسات + EMA 20/90 |

## الاستراتيجيات (25 مفتاحاً في المحرك)

| # | مفعّلة | الحالات/السيناريوهات | أبرز معاملاتها |
|---|---|---|---|
| A | ✅ | case1, case2 | insideBars, smallCandles, minExtPips, maxExtPips, entry/sl/tp |
| B | ✅ | main | realBreakPips, bodyBreakMin/Max, entry/sl/tp |
| C | ✅ | case1, case2 | minLevelBreakPips, internalBreakMin/Max, fibTouch, forcedFibLevel, rr |
| D | ✅ | d1, d2 | gapMin/MaxPips, bodyBreakMin, totalMin/Max, realBreakPips |
| E | ✅ | e1, e2, e3 | minCandles, imp1, imp2, proximityPct, firstMitigationOnly |
| F | ✅ | f1, f2, f3 | absenceHours, absencePips, weeklyOpenPips, dailyOpenPips, exec |
| G | ✅ | rev, brk | absenceHours/Pips, revEntry/Sl/Tp, breakBodyMin, windowHours |
| H | ✅ | main | breakPips, conflictPips, conflictSlPips |
| I | ⛔ | main | waveMin/MaxPips, conflict* (معطّلة) |
| J | ✅ | bear, bull | sepCandles, headBreakMin/Max, dZoneNear/Far, windowMinMin/Max |
| K | ✅ | bear, bull | نفس بنية J |
| L | ✅ | rev, brk | levels, exec |
| M | ✅ | rev, brk | extraLevel, exec |
| N | ✅ | rev, brk | approachPips, openDistPips |
| O | ✅ | rev, brk | approachPips, recencyDays |
| P | ✅ | rev | approachPips, entry/sl/tp |
| Q | ✅ | upper, lower | wickMinPips, checkCandles, isolationPips, asiaOpenMinPips |
| R | ✅ | r1, r2 | tfs |
| T | ✅ | main | n, bbK, kcMult, minSqueeze, momN, ATR SL/TP, holdBars |
| U | ⛔ | main | rsiN, lower, upper, trendN (معطّلة) |
| V | ✅ | main | n, entryZ, exitZ, erN, erMax |
| W | ✅ | main | horizonDays, atrN, slAtrMult, expHours |
| X | ✅ | main | emaFast/Mid/Slow, pullMax, atrN, ATR SL/TP |
| Y | ✅ | main | fast, slow, atrN, slAtrMult, expHours |
| AA | ✅ | main | entryN, exitN, atrN, reassertBars, expHours |

## القواعد العليا (38 مفتاحاً — القيم الحية)

| القاعدة | مفعّلة | القيمة |
|---|---|---|
| symbol_lock | ✅ | 0 |
| fixed_lot | ✅ | 0.01 |
| min_hold_min | ✅ | 4 |
| max_hold_hours | ✅ | 72 |
| max_daily_trades | ✅ | 50 |
| min_daily_trades | ✅ | 1 |
| daily_loss_stop | ✅ | 50 |
| daily_profit_stop | ⛔ | 200 |
| no_martingale | ✅ | 0 |
| single_trade | ⛔ | 0 |
| no_stacking_hedge | ✅ | 0 |
| mandatory_sl | ✅ | 15 |
| fixed_base | ✅ | 1000 |
| news_filter | ✅ | 15 |
| news_after_min | ✅ | 60 |
| market_open_filter | ✅ | 30 |
| market_close_filter | ✅ | 60 |
| fixed_spread | ✅ | 30 |
| slippage | ✅ | 10 |
| ghost_entry | ✅ | 50 |
| ghost_run_pips | ✅ | 100 |
| break_even | ⛔ | 50 |
| be_case1 | ⛔ | 50 |
| be_case2 | ⛔ | 100 |
| be_lock_pips | ⛔ | 50 |
| hierarchy | ✅ | 0 |
| fuse_daily_pct | ⛔ | 3 |
| fuse_weekly_pct | ⛔ | 6 |
| fuse_equity_floor | ⛔ | 50 |
| max_concurrent | ✅ | 4 |
| gate_daily_trend | ✅ | 0 |
| gate_er_quiet | ✅ | 30 |
| gate_spread_guard | ⛔ | 1 |
| gate_min_sample | ✅ | 30 |
| gate_ladder | ✅ | 0 |
| gate_side_pf | ✅ | 90 |
| gate_decay90 | ✅ | 100 |
| sizing_quality | ⛔ | 1 |

## المؤشرات
`sessionTiming: true` · `ema: true` · `emaFast: 20` · `emaSlow: 90`

## الحالة التشغيلية وقت الالتقاط

- الحساب: JustMarkets-Demo · `2002191205` · USD · رافعة 3000 · **الرصيد 190.81$**.
- السعر: `XAUUSD.m` = 3987.65 · سبريد 0.26$ · الجلسة النشطة: آسيا.
- البيانات: 202,022 شمعة حقيقية (5m: 100,551 · 15m: 44,077 · 1h: 20,040 · 4h: 13,034 · 1d: 1,501).
- الجسر: v21 · متصل · آخر دفعة قبل ~1 ثانية.
- الصحة: 85 دورة إصلاح ذاتي، 0 إصلاحات، `lastCycleMs` = 70.

## آخر باك تيست (مرجع أداء حقيقي)

| المقياس | القيمة |
|---|---|
| الصفقات | 2,105 |
| الفوز/الخسارة | 987 / 1,118 |
| نسبة النجاح | 46.89% |
| صافي الربح | +8,060.46$ على أساس 1,000$ |
| معامل الربح (PF) | 1.626 |
| أقصى تراجع | 223.13$ (22.31%) |
| خارج العينة (OOS) | 565 صفقة · نجاح 48.14% · متوسط R = 0.363 |
| الفترة | 2025-06-13 → 2026-11-11 |

كل صفقة بالتفصيل في `derived/bfx-backtest-trades.csv` (نفس تصدير البوت).

## وضع التحسين الآلي
`tuner`: مكتمل 229/252 مرحلة، غير قيد التشغيل الآن، وسجلّه يوضح اعتماد معاملات
خارج العينة لكل استراتيجية (مثال A: `slPips=100 · tpPips=120`، OOS 5 صفقات · PF 2.15).
`automanager`: آخر قرار في وضع `factory-reset+decide` على نافذة 2025-06-13 → 2026-11-11،
مع تعطيل/تفعيل مبني على عيّنة ≥ 30 صفقة.
