// ============================================================
// نسخ static و public إلى standalone بعد next build — بديل
// cross-platform لأوامر cp في package.json: يعمل على Linux
// (Render/Docker) وعلى ويندوز (حزمة اللابتوب) على حد سواء.
// يكتشف تلقائياً موقع server.js داخل standalone: في الجذر،
// أو متداخلاً تحت مجلد المشروع حين يوجد lockfile في الأب
// (اكتشاف Next لمساحة العمل) — فينسخ الملفات بجواره مباشرة.
// الفشل غير قاتل — يُسجَّل فقط.
// ============================================================
const fs = require('fs');
const path = require('path');

function copy(src, dest) {
  try {
    if (!fs.existsSync(src)) {
      console.log(`تخطي ${src} — غير موجود`);
      return;
    }
    fs.cpSync(src, dest, { recursive: true, force: true });
    console.log(`نُسخ: ${src} → ${dest}`);
  } catch (e) {
    console.error(`تعذر النسخ ${src}: ${e.message}`);
  }
}

const standalone = path.join('.next', 'standalone');
const nested = path.join(standalone, path.basename(process.cwd()));

// الهدف: المجلد الذي يضم server.js فعلاً — المتداخل إن وُجد وإلا الجذر
let target = standalone;
if (fs.existsSync(path.join(nested, 'server.js'))) {
  target = nested;
  console.log(`التخطيط متداخل — server.js داخل ${nested}`);
} else if (!fs.existsSync(path.join(standalone, 'server.js'))) {
  console.log(`تنبيه: server.js غير موجود في standalone — النسخ إلى الجذر`);
}

copy(path.join('.next', 'static'), path.join(target, '.next', 'static'));
copy(path.join('public'), path.join(target, 'public'));
