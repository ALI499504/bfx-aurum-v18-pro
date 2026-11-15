# -*- coding: utf-8 -*-
# إنقاذ كامل تاريخ الشموع من البناء القديم على Render قبل استبداله
# المسار: /api/chart?tf=X&from=T&to=T+120tf  (150 شمعة/طلب، ~250ms)
# النتيجة: download/candle-rescue.json بصيغة mt5-feed-snapshot.json نفسها
import json, time, os, urllib.request, sys

BASE = "https://bfx-aurum-v18-pro.onrender.com/api"
HDR = {"x-bfx-token": "bfx-aurum-mt5-v1"}
OUT = "/home/z/my-project/download/candle-rescue.json"
TF_MS = {"5m": 300000, "15m": 900000, "30m": 1800000, "1h": 3600000,
         "4h": 14400000, "1d": 86400000, "1w": 604800000, "1M": 2592000000}

def get(url, tries=8):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=HDR)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(min(2 * (i + 1), 10))

# مواعيد البداية السخية لكل فريم (أقدم من مخزون الخادم بهامش)
STARTS = {"5m": "2025-06-01", "15m": "2024-12-20", "30m": "2024-12-20",
          "1h": "2023-11-01", "4h": "2022-11-01", "1d": "2020-11-01",
          "1w": "2014-11-01", "1M": "2010-11-01"}

def ts(s):
    return int(time.mktime(time.strptime(s, "%Y-%m-%d")) * 1000)

def _save(rmap, counts):
    tfs = {k: sorted(v.values()) for k, v in rmap.items() if v}
    snap = {"symbol": "XAUUSD.m", "broker": "JustMarkets-Demo", "bridgeV": 21,
            "account": None, "tick": None, "positions": [], "deals": [],
            "updatedAt": int(time.time() * 1000), "savedAt": int(time.time() * 1000),
            "tfs": tfs, "rescuedCounts": counts}
    tmp = OUT + ".tmp"
    json.dump(snap, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    os.rename(tmp, OUT)

status = get(f"{BASE}/mt5/status")
counts = status.get("counts") or {}
oldest = status.get("oldest") or {}
now = int(time.time() * 1000)
print("counts:", counts, flush=True)

# استئناف: إن وُجد ملف ناتج سابق نكمل منه
rescued = {}
if os.path.exists(OUT):
    try:
        rescued = {k: {c[0]: c for c in v} for k, v in json.load(open(OUT)).get("tfs", {}).items()}
        print("استئناف من ملف سابق:", {k: len(v) for k, v in rescued.items()}, flush=True)
    except Exception:
        rescued = {}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
total_pages = 0
t0 = time.time()
for tf in ["5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"]:
    want = counts.get(tf, 0)
    got_map = rescued.get(tf, {})
    if want and len(got_map) >= want * 0.995:
        print(f"[{tf}] مكتمل مسبقاً ({len(got_map)}) — تخطي", flush=True)
        continue
    start = min(ts(STARTS[tf]), (oldest.get(tf) or now) - 7 * TF_MS[tf])
    step = 120 * TF_MS[tf]
    cur = start
    pages = 0
    while cur < now:
        to = min(cur + step, now + TF_MS[tf])
        url = f"{BASE}/chart?tf={tf}&from={cur}&to={to}"
        d = get(url)
        cs = d.get("candles") or []
        for c in cs:
            got_map[c["t"]] = [c["t"], c["o"], c["h"], c["l"], c["c"], c.get("v", 0)]
        pages += 1
        total_pages += 1
        cur = to + TF_MS[tf]
        time.sleep(0.25)  # رحمة للمثيل الحر — يعيق التلعثم تحت الضغط المتواصل
        if pages % 25 == 0:
            print(f"[{tf}] صفحة {pages} — {len(got_map)} شمعة — {int(time.time()-t0)}s", flush=True)
            rescued[tf] = got_map
            _save(rescued, counts)
    rescued[tf] = got_map
    print(f"[{tf}] تم: {len(got_map)} شمعة (المستهدف ~{want}) في {pages} صفحة", flush=True)
    _save(rescued, counts)

_save(rescued, counts)
total = sum(len(v) for v in rescued.values())
print(f"اكتمل الإنقاذ: {total} شمعة في {total_pages} صفحة / {int(time.time()-t0)}s → {OUT}", flush=True)
