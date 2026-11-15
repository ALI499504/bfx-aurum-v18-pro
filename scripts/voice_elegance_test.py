# -*- coding: utf-8 -*-
# اختبار نُبرة الصوت الأنيق لجارفس — توليد عينات بإعدادات مختلفة
# واختيار الإعداد الأنسب (رسمي، فصيح، جميل) لمحرك edge-tts بصوت حامد
import asyncio, os, time, json
import edge_tts

TEXT = ("حاضر يا سيدي. الدراسة الحية تشير إلى أن سعر الذهب الآن "
        "أربعة آلاف وواحد وسبعون دولاراً وثلاثة عشر سنتاً، والرصيد مئة وتسعون دولاراً "
        "وواحد وثمانون سنتاً، مع عدم وجود صفقات مفتوحة حالياً.")

VARIANTS = {
    "A_current_plus4":        {"rate": "+4%", "pitch": "+0Hz"},
    "B_elegant_zero_pminus2": {"rate": "+0%", "pitch": "-2Hz"},
    "C_stately_minus4_p3":    {"rate": "-4%", "pitch": "-3Hz"},
    "D_balanced_plus2_p2":    {"rate": "+2%", "pitch": "-2Hz"},
}

OUT = "/home/z/my-project/download/jarvis-voice-samples"
os.makedirs(OUT, exist_ok=True)

async def gen(name, v):
    t0 = time.time()
    f = os.path.join(OUT, f"hamed-{name}.mp3")
    tts = edge_tts.Communicate(TEXT, voice="ar-SA-HamedNeural", rate=v["rate"], pitch=v["pitch"])
    await tts.save(f)
    dur = time.time() - t0
    size = os.path.getsize(f)
    return {"name": name, **v, "gen_s": round(dur, 2), "bytes": size, "file": f}

async def main():
    results = []
    for name, v in VARIANTS.items():
        try:
            results.append(await gen(name, v))
        except Exception as e:
            results.append({"name": name, "error": str(e)[:100]})
    print(json.dumps(results, ensure_ascii=False, indent=1))

asyncio.run(main())
