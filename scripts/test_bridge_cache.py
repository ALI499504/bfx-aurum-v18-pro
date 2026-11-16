#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""اختبارات منطق كاش الشفاء الذاتي في الجسر v22 — بجهاز MT5 وهمي (بلا طرفية حقيقية)."""
import sys
import types
import importlib.util
import os
import tempfile

# stub MetaTrader5 قبل استيراد الجسر كي يعمل الاستيراد بلا طرفية
mt5_stub = types.ModuleType("MetaTrader5")
sys.modules["MetaTrader5"] = mt5_stub

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRIDGE = os.path.join(REPO, "public", "mt5-bridge.py")
spec = importlib.util.spec_from_file_location("bridge", BRIDGE)
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

b.SYMBOL = "XAUUSD.m"
tmpdir = tempfile.mkdtemp()
b.CACHE_PATH = os.path.join(tmpdir, "cache.json.gz")
b.STATE_PATH = os.path.join(tmpdir, "state.json")

fails = []


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


# ---------- 1) الدمج: بلا تكرار وبأي ترتيب زمني ----------
rows1 = [[1000 + i * 300, 1, 2, 3, 4, 5] for i in range(1000)]          # 1000..299700
new = b.cache_merge("5m", rows1)
check("merge أول مرة يعيد العدد الكامل", new == 1000 and len(b._CANDLE_CACHE["tfs"]["5m"]) == 1000)
new2 = b.cache_merge("5m", rows1)
check("merge يعيد نفس الدفعة بلا تكرار", new2 == 0)
rows2 = [[100 + i * 300, 9, 9, 9, 9, 9] for i in range(3)]               # 100,400,700 أقدم وبلا تداخل
b.cache_merge("5m", rows2)
check("merge دمج شموع أقدم", len(b._CANDLE_CACHE["tfs"]["5m"]) == 1003)

# ---------- 2) الحفظ والتحميل: ذرّي ومرتب ويستعاد كما هو ----------
b.save_candle_cache(force=True)
check("ملف الكاش موجود وغير فارغ", os.path.exists(b.CACHE_PATH) and os.path.getsize(b.CACHE_PATH) > 0)
check("لا ملف مؤقت متبقٍ", not os.path.exists(b.CACHE_PATH + ".tmp"))
keys = sorted(b._CANDLE_CACHE["tfs"]["5m"].keys())
check("الحفظ مرتب زمنياً", keys == sorted(keys) and keys[0] == 100 and keys[-1] == 300700)
b._CANDLE_CACHE = {"__v": b.CACHE_VERSION, "symbol": "", "tfs": {}}
b.load_candle_cache()
check("إعادة التحميل تستعيد كل الشموع", len(b._CANDLE_CACHE["tfs"].get("5m", {})) == 1003)
check("الرمز محفوظ مع الكاش", b._CANDLE_CACHE["symbol"] == "XAUUSD.m")

# ---------- 3) الشفاء: الموقع فارغ والكاش بعمق state.minT → يرفع ويحدّث الحالة ----------
calls = []


def fake_push_history(url, key, rows):
    calls.append((key, len(rows)))
    return len(rows)


b.push_history = fake_push_history
state = {"__v": 17, "5m": {"complete": True, "minT": 100}, "15m": {"complete": True, "minT": 5000}}
# الموقع فارغ تقريباً (أحدث 3 شموع) — نفس ما يحدث بعد إعادة النشر
b.server_coverage = lambda url: {"counts": {"5m": 3}, "oldest": {"5m": 1794854400000}}
# كاش 15m أضحل من المسجل: سماحية البوابة = minT + tf_ms*5 = 5000 + 900*1000*5 = 4,505,000
# فنجعل أقدم شمعة كاش 15m = 6,000,000 (أحدث من السماحية) → يجب أن يُرفض
b.cache_merge("15m", [[6000000 + i * 900, 1, 1, 1, 1, 1] for i in range(10)])
healed = b.heal_from_cache("http://x", state)
check("الشفاء رفع 5m فقط (رفض الكاش الأضحل)", ("5m", 1003) in calls and not any(k == "15m" for k, _ in calls))
check("الشفاء أعاد المجموع الصحيح", healed == 1003)
check("حالة 5m مكتملة بعد الشفاء", state["5m"]["complete"] is True and state["5m"]["minT"] == 100)

# ---------- 4) بعد الشفاء: needs_refill تصير زائفة بتغطية مطابقة → لا سحب بطيء ----------
cov2 = {"counts": {"5m": 1003}, "oldest": {"5m": 100}}
check("needs_refill زائفة بعد الشفاء (لا سحب بطيء)", b.needs_refill("5m", state, cov2) is False)

# ---------- 5) أول تشغيل بلا سحب عميق مسجل → لا شفاء (يبنى الكاش بالسحب الصبور) ----------
state_fresh = {"__v": 17}
calls.clear()
healed2 = b.heal_from_cache("http://x", state_fresh)
check("بلا حالة عميقة: لا شفاء خادع", healed2 == 0 and calls == [])

# ---------- 6) كاش أضحل من أعمق ما سُجل → لا شفاء ----------
# سماحية 5m = minT + tf_ms*5 = 100 + 300*1000*5 = 1,500,100 → نبدأ الكاش من 2,000,000
state_deep = {"__v": 17, "5m": {"complete": True, "minT": 100}}
b._CANDLE_CACHE["tfs"]["5m"] = {2000000 + i * 300: [1, 1, 1, 1, 1, 1] for i in range(100)}
calls.clear()
healed3 = b.heal_from_cache("http://x", state_deep)
check("كاش أضحل من المسجل: لا شفاء", healed3 == 0 and calls == [])

# ---------- 7) الخادم غير متاح → لا شفاء ولا انهيار ----------
b.server_coverage = lambda url: None
state_ok = {"__v": 17, "5m": {"complete": True, "minT": 100}}
b._CANDLE_CACHE["tfs"]["5m"] = {100 + i * 300: [1, 1, 1, 1, 1, 1] for i in range(5)}
healed4 = b.heal_from_cache("http://x", state_ok)
check("الخادم غير متاح: صفر شفاء بلا انهيار", healed4 == 0)

# ---------- 8) مزج الرموز ممنوع ----------
b._CANDLE_CACHE["symbol"] = "OTHER"
new8 = b.cache_merge("5m", rows1[:5])
check("رمز مختلف: الدمج مرفوض", new8 == 0)
b._CANDLE_CACHE["symbol"] = "XAUUSD.m"

# ---------- 9) استكمال الكاش من الخادم (bootstrap) ----------
b._CANDLE_CACHE["tfs"] = {}
server_dump = {
    "ok": True,
    "symbol": "XAUUSD.m",
    "tfs": {
        "5m": [[1750000000000 + i * 300, 2, 3, 1, 2, 7] for i in range(500)],
        "1h": [[1750000000000 + i * 3600, 2, 3, 1, 2, 7] for i in range(200)],
        "bad": [[1, 2], "junk", None],  # صفوف تالفة تُتجاهل
    },
}
b.get_dump = lambda url: dict(server_dump)
boot1 = b.bootstrap_cache_from_server("http://x")
check("استكمال الكاش من الخادم يعمل", boot1 == 700)
check("الفريمات التالفة تُتجاهل", set(b._CANDLE_CACHE["tfs"].keys()) == {"5m", "1h"})
check("الكاش المستكمل يُحفظ", os.path.exists(b.CACHE_PATH))

# رمز الخادم مخالف → لا استكمال
dump_bad_symbol = dict(server_dump, symbol="GOLD.m")
b.get_dump = lambda url: dump_bad_symbol
b._CANDLE_CACHE["tfs"] = {}
boot2 = b.bootstrap_cache_from_server("http://x")
check("رمز خادم مخالف: رفض الاستكمال", boot2 == 0 and b._CANDLE_CACHE["tfs"] == {})

# الخادم بلا شموع → صفر بلا انهيار
b.get_dump = lambda url: {"ok": True, "symbol": "XAUUSD.m", "tfs": {}}
boot3 = b.bootstrap_cache_from_server("http://x")
check("خادم فارغ: صفر استكمال", boot3 == 0)

# فشل الاتصال بالخادم → صفر بلا انهيار
def boom(url):
    raise OSError("network down")
b.get_dump = boom
boot4 = b.bootstrap_cache_from_server("http://x")
check("فشل الشبكة: صفر بلا انهيار", boot4 == 0)

# ---------- 10) التسلسل الكامل: تحميل ← استكمال ← شفاء (سيناريو إعادة النشر الحقيقي) ----------
b._CANDLE_CACHE = {"__v": b.CACHE_VERSION, "symbol": "", "tfs": {}}
b.load_candle_cache()                      # من القرص (ما حفظناه في اختبار الاستكمال)
n_after_load = len(b._CANDLE_CACHE["tfs"].get("5m", {}))
check("التحميل بعد الاستكمال يوجد الشموع", n_after_load == 500)
# الخادم انهار (إعادة نشر) — الكاش المحلي أعمق → الشفاء يرفعه فوراً
b.get_dump = boom  # احتياط: bootstrap لا يُستدعى مباشرة هنا
calls.clear()
b.push_history = fake_push_history
state_full = {"__v": 17, "5m": {"complete": True, "minT": 1750000000000}}
b.server_coverage = lambda url: {"counts": {"5m": 3}, "oldest": {"5m": 1794854400000}}
healed5 = b.heal_from_cache("http://x", state_full)
check("سيناريو إعادة النشر: شفاء كامل من الكاش المحلي", healed5 == 500 and ("5m", 500) in calls)

print("=" * 50)
if fails:
    print(f"فشل {len(fails)} اختبار: {fails}")
    sys.exit(1)
print("كل الاختبارات ناجحة — منطق الكاش والشفاء الذاتي سليم")
