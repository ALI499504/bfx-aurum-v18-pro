#!/usr/bin/env python3
"""التحقق من أن بث الصوت تدريجي فعلاً: أوقات وصول القطع + سلامة الأرشفة"""
import time
import urllib.request
import pathlib

url = "http://localhost:3000/api/jarvis/tts?text=" + urllib.parse.quote(
    "فحص التدفق التدريجي الحقيقي للصوت العربي مع تسجيل أزمنة وصول القطع.")
req = urllib.request.Request(url)
arrivals = []
start = time.time()
with urllib.request.urlopen(req, timeout=60) as r:
    total = 0
    while True:
        chunk = r.read(4096)
        if not chunk:
            break
        total += len(chunk)
        arrivals.append((round(time.time() - start, 2), total))
print("عدد القطع:", len(arrivals))
for t, b in arrivals[:12]:
    print(f"  t={t}s  bytes={b}")
print(f"الإجمالي: {total} bytes في {arrivals[-1][0]}s")
spread = arrivals[-1][0] - arrivals[0][0]
print(f"انتشار الزمن بين أول وآخر قطعة: {spread:.2f}s", "→ بث تدريجي مؤكد" if spread > 0.15 and len(arrivals) > 3 else "→ دفعة واحدة!")
# سلامة الأرشفة
cache = pathlib.Path("/home/z/my-project/db/jarvis-tts")
files = sorted(cache.glob("*.mp3"), key=lambda f: f.stat().st_mtime, reverse=True)
print("أرشفة: أحدث ملف", files[0].name, files[0].stat().st_size, "bytes")
