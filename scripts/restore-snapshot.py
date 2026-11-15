# -*- coding: utf-8 -*-
# استعادة الشموع المنقذة إلى الخادم الجديد عبر /api/mt5/ingest (بمقاطع — دمج آمن)
# الاستخدام: python3 /home/z/my-project/scripts/restore-snapshot.py [رابط الخادم]
import json, time, os, sys, urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://bfx-aurum-v18-pro.onrender.com").rstrip("/")
SRC = "/home/z/my-project/download/candle-rescue.json"
HDR = {"x-bfx-token": "bfx-aurum-mt5-v1", "Content-Type": "application/json"}
CHUNK = 8000  # ~0.8MB لكل دفعة — آمن على المثيل الحر

snap = json.load(open(SRC))
tfs = snap.get("tfs", {})
print("مقاطع الاستعادة:", {k: len(v) for k, v in tfs.items()})

def post(url, payload, tries=6):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=HDR, method="POST")
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(min(3 * (i + 1), 15))

total = 0
t0 = time.time()
for tf in ["5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"]:
    rows = tfs.get(tf) or []
    for i in range(0, len(rows), CHUNK):
        part = rows[i:i + CHUNK]
        d = post(f"{BASE}/api/mt5/ingest", {"symbol": "XAUUSD.m", "broker": "JustMarkets-Demo", "v": 21, "tfs": {tf: part}})
        total += d.get("stored", 0)
        print(f"  {tf} +{d.get('stored', 0)} (إجمالي {total}) — {int(time.time()-t0)}s", flush=True)
        time.sleep(0.3)

time.sleep(2)
req = urllib.request.Request(f"{BASE}/api/mt5/status", headers=HDR)
st = json.load(urllib.request.urlopen(req, timeout=30))
print("أعداد الخادم بعد الاستعادة:", st.get("counts"))
print(f"اكتملت الاستعادة: {total} شمعة في {int(time.time()-t0)}s")
