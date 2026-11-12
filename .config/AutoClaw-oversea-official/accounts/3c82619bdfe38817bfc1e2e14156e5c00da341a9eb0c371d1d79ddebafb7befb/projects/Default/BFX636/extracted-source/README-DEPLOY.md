# BFX636 – نشر الواجهة على استضافة مجانية

## المتطلبات
- Bun (أو Node.js) ≥ 1.3  
- Git  
- حساب Vercel (أو Netlify / Railway)  
- حساب ngrok (مجاني – يعطي URL مؤقت) أو Cloudflare Tunnel

## خطوات النشر المختصرة

1. **إنشاء نفق**  
   ```bash
   ngrok http 3000      # أعطاك URL https://<random>.ngrok.io
   ```

2. **تعديل المتغيّر**  
   في `BFX636/extracted-source/.env.local` ضع القيمة:
   ```text
   NEXT_PUBLIC_API_URL=https://<random>.ngrok.io
   ```

3. **بناء الواجهة**  
   ```bash
   cd BFX636/extracted-source
   bun install
   bun run build
   ```

4. **رفع المستودع**  
   ```bash
   git add .
   git commit -m "Ready for Vercel"
   git push origin main
   ```

5. **نشر على Vercel**  
   - تسجيل الدخول على <https://vercel.com>.  
   - اختيار “New Project” وربط مستودع GitHub.  
   - في إعدادات المشروع، إضافة متغيّر بيئي `NEXT_PUBLIC_API_URL` بقيمة URL من الخطوة 1.  
   - الضغط على “Deploy”.

6. **تشغيل الجسر (على جهازك)**  
   ```bash
   source BFX636/mt5_venv/bin/activate   # إذا كنت تستخدم venv
   python BFX636/mt5-bridge.py
   ```

7. **اختبار النتيجة**  
   افتح الرابط الذي أعطته Vercel (مثل `https://bfx636.vercel.app`).  
   يجب أن يظهر شارت XAUUSD مع الشموع الحية والتحديث اللحظي، مطوَّر تماماً كما في MetaTrader 5.

## تشغيل النفق تلقائياً عند بدء كل جلسة (اختياري)

لإشغال ngrok تلقائياً عند كل دخول إلىterminal، أضف هذا السطر إلى `~/.bashrc`:

```bash
ngrok http 3000 > /dev/null 2>&1 &
```

بهذا سيتم نفق HTTP 3000 في كل مرة تفتح فيها نافذة terminal جديدة، ولن تضطر لتفعيله يدوياً.

## ملاحظات هامة
- **لا تشارك** ملف `.env.local` أو قيمة `NEXT_PUBLIC_API_URL` مع أي شخص عدا نفسك، لأنها تحتوي عنوان نفقك الخاص.  
- النفق المجاني (ngrok) ينتهي بعد فترة من عدم النشاط (حوالي 8 ساعات)، لذا يفضل إعادة تشغيله من حين لآخر أو استخدم Cloudflare Tunnel للاستمرار.  
- البيانات الحقيقية تأتي من **MetaTrader 5 المثبتة على جهازك**، ولايمكن استضافتها بالكامل على منصة مجانية؛ الجزء المُستضاف هو فقط الواجهة (Next.js) والتواصل عبر نفق.  

##License
هذا الدليل مُنشأ لأغراض تعليمية ومشروع `BFX636` – يحتفظ صاحبه بحقوق الملكية.