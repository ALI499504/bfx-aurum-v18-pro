"""
التحقق من أن الباك تيست يحترم الإعدادات اليدوية للمستخدم.
يطبّق إعدادين مختلفين ويقارن النتائج:
  1. الإعدادات الحالية في قاعدة البيانات
  2. تعديل: تفعيل max_daily_trades=1 (قيد صارم — صفقة واحدة يومياً)
إذا اختلف عدد الصفقات بشكل كبير → الإعداد محترَم.
"""
import json, urllib.request, sys

BASE = "http://localhost:3000"

def get_settings():
    r = urllib.request.urlopen(f"{BASE}/api/settings")
    return json.loads(r.read())["settings"]

def put_settings(s):
    req = urllib.request.Request(
        f"{BASE}/api/settings",
        data=json.dumps({"settings": s}).encode(),
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    urllib.request.urlopen(req)

def run_backtest():
    req = urllib.request.Request(f"{BASE}/api/backtest", method="POST")
    r = urllib.request.urlopen(req, timeout=300)
    return json.loads(r.read())

def snapshot(s, label):
    print(f"\n{'='*60}\n[{label}]\n{'='*60}")
    print(f"  max_daily_trades: enabled={s['globalRules']['max_daily_trades']['enabled']}, value={s['globalRules']['max_daily_trades']['value']}")
    print(f"  single_trade:     enabled={s['globalRules']['single_trade']['enabled']}")
    print(f"  quality_gate:     enabled={s['globalRules']['quality_gate']['enabled']}, value={s['globalRules']['quality_gate']['value']}")
    print(f"  tpRatio (top):    {s['tpRatio']}")
    print(f"  fixed_lot:        enabled={s['globalRules']['fixed_lot']['enabled']}, value={s['globalRules']['fixed_lot']['value']}")
    print(f"  risk_sizing:      enabled={s['globalRules']['risk_sizing']['enabled']}, value={s['globalRules']['risk_sizing']['value']}")
    print(f"  news_filter:      enabled={s['globalRules']['news_filter']['enabled']}")
    res = run_backtest()
    stats = res["stats"]
    print(f"  → الصفقات: {stats['totalTrades']} | WR {stats['winRate']:.1f}% | PF {stats['profitFactor']:.2f} | DD {stats['maxDrawdownPct']:.1f}% |净 {stats['netPnl']:+.2f}$")
    print(f"  → blocked: {stats.get('blocked', {})}")
    return stats

# 1. الإعدادات الحالية
orig = get_settings()
snap_orig = snapshot(orig, "إعدادات المستخدم الحالية")

# 2. نسخة احتياطية عميقة
import copy
modified = copy.deepcopy(orig)

# 3. التعديل: تفعيل max_daily_trades=1 (قيد صارم جداً)
modified["globalRules"]["max_daily_trades"]["enabled"] = True
modified["globalRules"]["max_daily_trades"]["value"] = 1
put_settings(modified)
snap_mod = snapshot(modified, "بعد التعديل: max_daily_trades=enabled,value=1")

# 4. إعادة الإعدادات الأصلية
put_settings(orig)

# 5. الحكم
print(f"\n{'='*60}\nالحكم\n{'='*60}")
diff = snap_orig["totalTrades"] - snap_mod["totalTrades"]
print(f"  الصفقات قبل: {snap_orig['totalTrades']}")
print(f"  الصفقات بعد: {snap_mod['totalTrades']} (فرق {diff})")
if snap_mod["totalTrades"] < snap_orig["totalTrades"]:
    print(f"  ✅ الإعداد محترَم: تفعيل max_daily_trades=1 خفّض عدد الصفقات")
else:
    print(f"  ❌ الإعداد متجاهل: لم يتغيّر عدد الصفقات رغم تفعيل القيد")
    sys.exit(1)

# 6. تحقق إضافي: blocked['maxTrades'] يجب أن يرتفع
b_orig = snap_orig.get("blocked", {}).get("maxTrades", 0)
b_mod = snap_mod.get("blocked", {}).get("maxTrades", 0)
print(f"  blocked[maxTrades] قبل: {b_orig} | بعد: {b_mod}")
if b_mod > b_orig:
    print(f"  ✅ عدّاد الحظر ارتفع — المحرك يرفض الصفقات فوق الحد")
else:
    print(f"  ⚠️ عدّاد الحظر لم يرتفع (ربما لا توجد أيام بأكثر من صفقة واحدة أصلاً)")
print(f"\n[تم بنجاح] الإعدادات اليدوية محترَمة من المحرك")
