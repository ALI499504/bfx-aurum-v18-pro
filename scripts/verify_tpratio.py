"""تحقق ثانٍ: تغيير tpRatio من 2 إلى 3 يجب أن يغيّر نسبة الربح/الخسارة."""
import json, urllib.request, copy
BASE = "http://localhost:3000"
def get_s(): return json.loads(urllib.request.urlopen(f"{BASE}/api/settings").read())["settings"]
def put_s(s):
    req = urllib.request.Request(f"{BASE}/api/settings", data=json.dumps({"settings": s}).encode(), headers={"Content-Type":"application/json"}, method="PUT")
    urllib.request.urlopen(req)
def run():
    req = urllib.request.Request(f"{BASE}/api/backtest", method="POST")
    return json.loads(urllib.request.urlopen(req, timeout=300).read())

orig = get_s()
print(f"الإعداد الأصلي tpRatio = {orig['tpRatio']}")
r1 = run(); s1 = r1["stats"]
print(f"  [tpRatio=2] الصفقات={s1['totalTrades']} | wins={s1['wins']} | losses={s1['losses']} | PF={s1['profitFactor']:.2f} |净={s1['netPnl']:+.2f}$")

# تعديل tpRatio إلى 3
m = copy.deepcopy(orig); m["tpRatio"] = 3
put_s(m)
r2 = run(); s2 = r2["stats"]
print(f"  [tpRatio=3] الصفقات={s2['totalTrades']} | wins={s2['wins']} | losses={s2['losses']} | PF={s2['profitFactor']:.2f} |净={s2['netPnl']:+.2f}$")

# إعادة الأصل
put_s(orig)
print(f"\n  → wins+losses قبل: {s1['wins']+s1['losses']} | بعد: {s2['wins']+s2['losses']}")
print(f"  → فرق PF: {s2['profitFactor']-s1['profitFactor']:+.2f}")
print(f"  → فرق净: {s2['netPnl']-s1['netPnl']:+.2f}$")
if s2['profitFactor'] != s1['profitFactor'] or s2['netPnl'] != s1['netPnl']:
    print("  ✅ tpRatio محترَم: تغيير النسبة غيّر النتائج")
else:
    print("  ❌ tpRatio متجاهل: لم تتغير النتائج")
