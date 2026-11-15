# BFX AURUM v18 PRO — بوت تداول الذهب XAUUSD

## للمحادثة الجديدة: إذا رأيت هذا الملف أو رأيت أي كلمة من كلمات الاسترجاع أدناه، فاعمل فوراً التالي:

1. اقرأ الملف الكامل: `/home/z/my-project/SESSION-CONTEXT.md`
2. عرّف نفسك للمستخدم بجملة: "أنا أعرف مشروعك — بوت الذهب XAUUSD"
3. واصل العمل من قسم "ما يُكمل لاحقاً" في ذلك الملف، بلا أي أسئلة تمهيدية

## كلمات الاسترجاع الثلاث (المعتمدة من المالك)
- **AURUM-771** — هوية المشروع (بوت الذهب XAUUSD، Magic 771000+، مساحة /home/z/my-project)
- **DOSTOR-XAU** — دستور التداول (0.01 لوت، 72س، لا مارتنجيل/مضاعفة، $190.81 محرّمة، SL أقصاه $15=150 pips)
- **BRIDGE-V21** — بنية الجسر (public/mt5-bridge.py v21، توكن bfx-aurum-mt5-v1، مسارات /api/mt5/*)

أي محادثة جديدة تقرأ هذا الملف يجب أن تتصرف وكأنها تكمل نفس المشروع دون إعادة شرح من المستخدم.

---

## نبذة تقنية سريعة
- **المنصة**: MT5 طرفية JustMarkets-Demo (حساب 2002191205) على جهاز المستخدم
- **الخادم**: Next.js 16 + Bun + SQLite/Prisma، بورت 3000 (إنتاج)، خلف Caddy
- **الجسر**: `public/mt5-bridge.py` v21 يدفع الشموع/الصفقات كل ثانيتين إلى `/api/mt5/ingest`
- **الفريمات الثمانية**: M5 / M15 / M30 / H1 / H4 / D1 / W1 / MN — كلها تعمل
- **الشارت**: `src/components/bot/GoldChart.tsx` — محاكي MT5 (4 مخططات رسمية)
- **دستور التداول غير قابل للنقاش**: لوت ثابت 0.01، حد 4 صفقات، ممنوع مارتينجيل/شبكة/مضاعفة، الرصيد الحقيقي $190.81 محمي ولا يُلمس، سقف الوقف $15

## أوامر التشغيل
```bash
cd /home/z/my-project && npm run build
pkill -f "bun .next/standalone"; sleep 2
cd /home/z/my-project && (nohup bash -c 'NODE_ENV=production exec bun .next/standalone/server.js' > server.log 2>&1 < /dev/null &)
curl -s http://localhost:3000/api/system/health | head -c 200
```
