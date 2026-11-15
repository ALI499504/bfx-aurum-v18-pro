// تقرير الفحص الشامل لبوت الذهب BFX AURUM — Arabic RTL docx (R1 cover mirrored, IG-1 palette)
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, NumberFormat, AlignmentType, HeadingLevel,
  WidthType, BorderStyle, ShadingType, SectionType, TableOfContents,
  PageBreak, TableLayoutType,
} = require("docx");
const fs = require("fs");

// ---------- palette IG-1 (Ink Gold — finance) ----------
const P = {
  bg: "1A1A1A", accent: "C9A84C",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "C9A84C", headerText: "1A1A1A", accentLine: "C9A84C", innerLine: "DDD5C0", surface: "F5F2E8" },
  primary: "1A1A1A",
  crit: "922B21", high: "B9770E", med: "7D6608", low: "5D6D7E", ok: "1E8449",
};
const AR = { ascii: "Arial", hAnsi: "Arial", cs: "Arial" };

const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

// ---------- RTL helpers ----------
const run = (text, o = {}) => new TextRun({ text, font: AR, rightToLeft: true, size: 24, ...o });
const bodyP = (children, o = {}) => new Paragraph({
  bidirectional: true, alignment: AlignmentType.JUSTIFIED,
  spacing: { line: 312, after: 120, ...(o.spacing || {}) }, children, ...o.p || {},
});
const p = (text, o = {}) => bodyP([run(text, o.run || {})], o.p || {});

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, bidirectional: true, alignment: AlignmentType.START,
    spacing: { before: 360, after: 180, line: 340, lineRule: "atLeast" },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 6 } },
    children: [run(text, { bold: true, size: 30, color: P.primary })],
  });
}

// finding: bold colored label + normal text, one dense paragraph + optional second
function finding(label, color, title, sentences) {
  return bodyP([
    run(label + " — ", { bold: true, color, size: 24 }),
    run(title + ". ", { bold: true, color: P.primary, size: 24 }),
    run(sentences, { size: 24 }),
  ], { p: { spacing: { line: 312, after: 200 } } });
}

// ---------- cover title layout (Arabic-aware) ----------
function splitTitleLines(title, cpl) {
  if (title.length <= cpl) return [title];
  const breakAfter = new Set([..."،.؛:!؟", ..."-_/", ..." \t"]);
  const lines = []; let rem = title;
  while (rem.length > cpl) {
    let at = -1;
    for (let i = cpl; i >= Math.floor(cpl * 0.6); i--) if (i < rem.length && breakAfter.has(rem[i - 1])) { at = i; break; }
    if (at === -1) { const lim = Math.min(rem.length, Math.ceil(cpl * 1.3)); for (let i = cpl + 1; i < lim; i++) if (breakAfter.has(rem[i - 1])) { at = i; break; } }
    if (at === -1) at = cpl;
    lines.push(rem.slice(0, at).trim()); rem = rem.slice(at).trim();
  }
  if (rem) lines.push(rem);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) { const last = lines.pop(); lines[lines.length - 1] += " " + last; }
  return lines;
}
function calcTitleLayout(title, maxW, prefPt = 40, minPt = 24) {
  const charW = (pt) => pt * 12; // Arabic average glyph width (incl. spaces)
  let pt = prefPt, lines;
  while (pt >= minPt) {
    const cpl = Math.floor(maxW / charW(pt));
    if (cpl < 2) { pt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    pt -= 2;
  }
  if (!lines || lines.length > 3) { lines = splitTitleLines(title, Math.floor(maxW / charW(minPt))); pt = minPt; }
  return { titlePt: pt, titleLines: lines };
}
function calcCoverSpacing(q) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0 } = q;
  const SAFETY = 1200;
  const usable = pageHeight - marginTop - marginBottom - SAFETY;
  const content = titleLineCount * (titlePt * 23 + 200) + (hasSubtitle ? (12 * 23 + 600) : 0)
    + (hasEnglishLabel ? (9 * 23 + 600) : 0) + metaLineCount * (10 * 23 + 100) + fixedHeight + 3 * 300;
  const remaining = Math.max(usable - content, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(remaining * 0.45), rawBottom = Math.floor(remaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  return { topSpacing, bottomSpacing };
}

// ---------- R1 cover (mirrored for RTL) ----------
function buildCoverR1RTL(config) {
  const C = config.palette;
  const padR = 1200, padL = 800;
  const availableWidth = 11906 - padR - padL - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const sp = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentRight = { style: BorderStyle.SINGLE, size: 8, color: C.accent, space: 12 };
  const ch = [];
  ch.push(new Paragraph({ spacing: { before: sp.topSpacing } }));
  if (config.englishLabel) {
    ch.push(new Paragraph({
      alignment: AlignmentType.START, bidirectional: true,
      indent: { right: padR, left: padL }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join(" "), size: 18, color: C.accent, font: AR, characterSpacing: 40 })],
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    ch.push(new Paragraph({
      bidirectional: true, alignment: AlignmentType.START,
      indent: { right: padR, left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [run(titleLines[i], { size: titleSize, bold: true, color: C.cover.titleColor })],
    }));
  }
  if (config.subtitle) {
    ch.push(new Paragraph({
      bidirectional: true, alignment: AlignmentType.START,
      indent: { right: padR, left: padL }, spacing: { after: 800, line: 340, lineRule: "atLeast" },
      children: [run(config.subtitle, { size: 24, color: C.cover.subtitleColor })],
    }));
  }
  for (const line of (config.metaLines || [])) {
    ch.push(new Paragraph({
      bidirectional: true, alignment: AlignmentType.START,
      indent: { right: padR + 200, left: padL }, spacing: { after: 80, line: 312 },
      border: { right: accentRight },
      children: [run(line, { size: 24, color: C.cover.metaColor })],
    }));
  }
  ch.push(new Paragraph({ spacing: { before: sp.bottomSpacing } }));
  ch.push(new Paragraph({
    bidirectional: true, alignment: AlignmentType.START,
    indent: { right: padR, left: padL },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: C.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      run(config.footerRight || "", { size: 16, color: C.cover.footerColor }),
      new TextRun({ text: "                                        ", font: AR }),
      run(config.footerLeft || "", { size: 16, color: C.cover.footerColor }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({ shading: { type: ShadingType.CLEAR, fill: C.bg }, borders: noBorders, children: ch })],
    })],
  })];
}

// ---------- shared header/footer ----------
const pageHeader = () => new Header({
  children: [new Paragraph({
    bidirectional: true, alignment: AlignmentType.CENTER,
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine, space: 4 } },
    children: [run("تقرير الفحص الشامل — بوت الذهب BFX AURUM v18", { size: 16, color: "888888" })],
  })],
});
const pageFooter = () => new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "888888", font: AR })],
  })],
});

// ---------- tables ----------
function dataTable(headers, rows, widths) {
  const cellP = (text, bold, color) => new Paragraph({
    bidirectional: true, alignment: AlignmentType.START, spacing: { line: 312 },
    children: [run(text, { bold: !!bold, size: 21, color: color || P.primary })],
  });
  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: P.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: P.table.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
      insideVertical: NB,
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: headers.map((t, i) => new TableCell({
          shading: { type: ShadingType.CLEAR, fill: P.table.headerBg },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          width: { size: widths[i], type: WidthType.PERCENTAGE },
          children: [cellP(t, true, P.table.headerText)],
        })),
      }),
      ...rows.map((r, ri) => new TableRow({
        cantSplit: true,
        children: r.map((t, i) => new TableCell({
          shading: { type: ShadingType.CLEAR, fill: ri % 2 === 0 ? "FFFFFF" : P.table.surface },
          margins: { top: 70, bottom: 70, left: 120, right: 120 },
          width: { size: widths[i], type: WidthType.PERCENTAGE },
          children: [cellP(t)],
        })),
      })),
    ],
  });
}
const tableTitle = (text) => new Paragraph({
  bidirectional: true, alignment: AlignmentType.START, keepNext: true,
  spacing: { before: 160, after: 100 },
  children: [run(text, { bold: true, size: 22, color: P.primary })],
});

// ================= CONTENT =================
const execSummary = [
  p("خضع بوت الذهب BFX AURUM (الإصدار v18 PRO المتصل بجسر MT5 v20) لفحص هندسي شامل غطى الكود المصدري بكامله، وطبقة نقاط API البالغ عددها 18 نقطة، وطبقة استقبال البيانات الحية من ميتاتريدر 5، ومحرك الباك تيست والإشارات، وقاعدة البيانات، والوكيل الحارس، والبنية التشغيلية المحيطة (البروكسي والإعدادات وأوامر التشغيل). كما أُجري اختبار حي أثناء الفحص شمل تشغيل باك تيست فعلي وقياس أثره على استجابة الخادم، واختبار قنوات المزامنة بين المستخدمين."),
  p("أفرز الفحص 25 ثغرة أو موضع ضعف: 5 حرجة، و6 عالية الخطورة، و8 متوسطة، و6 منخفضة. وقد نُفذت ثلاثة إصلاحات فورية أثناء الفحص نفسه (تخفيف حمل الاستطلاع اللحظي، وإيقاف تسجيل كل استعلامات قاعدة البيانات في الإنتاج، وتفعيل فحص الأنواع في البناء) وأعيد بناء النظام والتحقق منه عملياً بعدها. أخطر ما كشفه الفحص هو غياب أي طبقة مصادقة على واجهة التحكم كاملة، وظهور رمز اتصال افتراضي مكتوب في الكود وفعّال على أرض الواقع، فهما معاً يفتحان الباب أمام أي شخص يعرف عنوان اللوحة إلى تغيير استراتيجيات التداول أو حقن بيانات مزيفة في تدفق الشموع الذي يفترض القاعدة الحديدية ألا يُغذى إلا من ميتاتريدر."),
  p("في المقابل، أظهر الفحص أن أساس المحرك سليم ومحكم: تنقية صارمة للشموع الواردة، وسقوف حوكمة صلبة مكتوبة في الكود لا يمكن للإعدادات تجاوزها، وتتبع ظل حقيقي لكل إشارة، ومدرب حتمي بلا هلوسة، والتزام موثق بحد أدنى للوقف قدره 10 دولارات تحقق عملياً على 96 صفقة مغلقة بالوقف. الثغرات الموثقة في هذا التقرير لا تلغي هذه القوة، لكنها تحدد ما يجب إغلاقه قبل أي توسع في الوصول أو الاعتماد الكامل على البوت برأس مال أكبر."),
];

const method = [
  p("اعتمد الفحص على أربع أدوات متكاملة: أولاً القراءة المباشرة للكود المصدري ملفاً ملفاً (طبقة الخادم: استقبال البث mt5feed ونقاط API للإعدادات والباك تيست والإشارات والزوار والمدرب والفحص الصحي والوكيل الحارس؛ وطبقة المحرك: قواعد الحوكمة الصلبة ومحاكاة التنفيذ؛ وطبقة الواجهة: المخزن المركزي ونوافذ الجدولة والباك تيست). ثانياً مراجعة البنية التشغيلية: ملف البروكسي Caddy، ومحتوى ملف البيئة، وإعدادات بناء Next.js، وأوامر التشغيل في package.json، وغياب أي وسيط middleware للمصادقة. ثالثاً اختبار حي على الخادم العامل: قياس زمن دورة باك تيست كاملة (استغرق نحو 60 إلى 80 ثانية أعقبته محاولة طلب متزامنة انتهت بمهلة انتظار)، والتحقق من فعالية قنوات المزامنة الجديدة بين المستخدمين، وفحص مؤشرات الذاكرة التي نمت من 348 إلى 405 ميغابايت خلال ساعة تشغيل. رابعاً تتبع مسار البيانات من الجسر حتى القرار: التنقية، والدمج، وبوابة السبريد، وبوابة الجودة، وسقوف الصفقات والخسارة، ثم مقارنة ما يُطبق في المحاكاة بما يُطبق فعلاً في التشغيل الحي."),
  p("صُنفت كل ملاحظة وفق الأثر العملي على أمور ثلاثة: أمان الحساب والتحكم، وصحة البيانات والقرارات، واستمرارية الخدمة. والتصنيف المستخدم هو: حرج (خطر مباشر على التحكم أو سلامة التداول)، وعالٍ (ضرر مؤكد عند استغلال بسيط أو مع الزمن)، ومتوسط (ضرر مشروط أو تراكمي)، ومنخفض (تحسين جودة ومقاومة أعطال مستقبلية). كل بند أدناه يذكر الدليل من الكود أو من الاختبار الحي، ثم الأثر، ثم الإصلاح المقترح."),
];

const critical = [
  finding("أ1 — خطر حرج", P.crit, "لا توجد أي مصادقة على واجهة التحكم كاملة",
    "كل نقاط API المكتوبة أعلاه (تغيير الإعدادات، تشغيل الباك تيست، تشغيل الإصلاح، قراءة الحساب والزوار) مفتوحة بلا تسجيل دخول ولا رمز وصول، ولا يوجد أي ملف middleware في المشروع، وملف البروكسي Caddyfile يعيد التوجيه إلى الخادم على المنفذ 81 بلا كلمة مرور ولا تشفير. الدليل: ملف Caddyfile في جذر المشروع يحتوي reverse_proxy فقط بلا any basic_auth، ونقاط مثل PUT /api/settings تنفذ ما يُرسل إليها فوراً. الأثر: أي شخص يعرف عنوان اللوحة يستطيع تغيير استراتيجيات التداول أو تعطيلها أو إخفاءها، وتشغيل باك تيست، وقراءة رصيد حسابك ورقمه، وكل ذلك من متصفح عادي. الإصلاح المقترح: إضافة مصادقة إما على مستوى Caddy (basic_auth أو قائمة عناوين مسموحة) أو middleware في Next.js بجلسة ورمز قوي، مع تعطيل كامل للوصول المجهول قبل أي نشر خارج شبكتك المحلية."),
  finding("أ2 — خطر حرج", P.crit, "رمز جسر MT5 الافتراضي مكتوب في الكود وفعّال",
    "نقطة استقبال الشموع /api/mt5/ingest هي الباب الوحيد الذي يتغذى منه المحرك، وحمايتها رمزية بحتة: السطر const TOKEN = process.env.MT5_TOKEN ?? 'bfx-aurum-mt5-v1' يعني أنه ما لم يُعرّف متغير البيئة، فالرمز الفعلي هو نص ثابت مطبوع في الكود، وفحص ملف البيئة أكد أنه لا يحوي إلا DATABASE_URL فقط، أي أن الرمز الافتراضي هو الفعلي الآن. الأثر: أي جهة تعرف هذا النص (وهو معروف لمن رأى الكود) تستطيع ضخ شموع مزيفة وتيكات وأسعار تمر كل فحوص التنقية الشكلية، فتوجه الإشارات وقرارات العرض، وينهار بذلك معنى القاعدة الحديدية المعلنة: بيانات حقيقية من MT5 فقط. الإصلاح المقترح: توليد رمز عشوائي طويل ووضعه في ملف البيئة، مع تنبيه مهم: يجب أولاً تحديث سكربت الجسر على جهازك ليصدر بالرمز الجديد ثم تحديث الخادم، وإلا انقطع البث؛ كذلك يُستحسن ربط كل نقطة إدارية بالرمز نفسه لا الجسر فقط."),
  finding("أ3 — خطر حرج", P.crit, "الباك تيست اليدوي يجمّد الخادم كاملاً لدقيقة أو أكثر",
    "محرك الباك تيست يعمل حساباً متزامناً على كامل التاريخ (نحو 201 ألف شمعة خمس دقائق) داخل عملية الخادم نفسها، فتتوقف حلقة الأحداث عن خدمة أي طلب آخر إلى انتهاء الحساب. الدليل الحي: أثناء تشغيل باك تيست من المستخدم الثاني استغرق الحفظ من الدقيقة 18:01 إلى 18:02 و21 ثانية، وفي نفس النافذة انتهت مهلة طلب تعديل إعدادات متزامن لم يستلم رداً. الأثر: أثناء كل باك تيست يدوي تتوقف نبضة السعر في الواجهة، ويتوقف استقبال شموع الجسر، ويتعطل فحص الصحة؛ ولو تجاوز التجميد دقيقتين فسيعتبر النظام البث غير حي (نافذة MT5_FRESH_MS تساوي 120 ثانية) فتختفي الصفقات المفتوحة الحقيقية من الواجهة وتتعطل بوابة السبريد. الإصلاح المقترح: نقل الباك تيست الكامل إلى عملية عامل منفصلة تعمل بالأمر bun وتبتلع اللقطة من القرص وتكتب النتيجة في قاعدة البيانات، فيبقى الخادم الأمامي خفيفاً؛ أو على الأقل تقسيم الحساب إلى دفعات صغيرة متتالية تفرج حلقة الأحداث بينها."),
  finding("أ4 — خطر حرج", P.crit, "فحص الأنواع معطل في البناء (كان معطلاً وقد أُغلق أثناء هذا الفحص)",
    "كان ملف next.config.ts يحمل ignoreBuildErrors: true، أي أن أي خطأ في الأنواع يمر إلى الإنتاج بصمت مهما كان خطيراً. الأثر: تعطل متغير مكتوب بشكل خاطئ يمكن أن يصل الإنتاج ويظهر كعطل تشغيلي عشوائي يصعب تتبعه، وهو نمط يفسر أعطالاً غامضة سابقة مثل مشكلة النسخة القديمة من الواجهة. الإصلاح: نُفذ أثناء هذا الفحص؛ استُبعدت المجلدات الخارجية عن المشروع من نطاق الفحص في tsconfig (أمثلة ومهارات وسكربتات مساعدة) وحُول العلم إلى false، وأعيد البناء بنجاح مع الفحص الصارم مفعلاً، فصار البناء يتوقف أمام أي خطأ أنواع مستقبلاً."),
  finding("أ5 — خطر حرج", P.crit, "الحوكمة صارمة في المحاكاة واستشارية في التشغيل الحي",
    "سقوف الصفقات اليومية (30 صفقة)، وسقف خسارة اليوم (15 بالمئة من الأساس)، وسقف اللوت (2.00)، وحد الصفقات المتوازية (8)، وبوابة السبريد وبوابة الجودة، كلها مطبقة بدقة داخل محاكاة الباك تيست وفي عرض قابلية التنفيذ للإشارات الحية (canFillNow)، لكن الخادم لا يرسل أي أمر تنفيذ إلى ميتاتريدر أصلاً (لا يوجد في المشروع أي مسار إرسال أوامر؛ الجسر يستقبل البيانات فقط)، فالتنفيذ الفعلي بيد الموضوع أو أي أداة خارجية على الطرفية. الأثر: يمكن نظرياً تجاوز كل الوعود الرقمية في التشغيل الفعلي دون أن يرفع النظام إنذاراً مانعاً، والوعد المعلن للمستخدم بالالتزام الصارم يستند إلى طبقة عرض لا طبقة تنفيذ. الإصلاح المقترح: إما إضافة طبقة تنفيذ موحدة يمر عبرها كل أمر (حتى اليدوي عبر المستويات اليدوية) ليخضع للسقوف نفسها، أو إضافة حارس مطابقة يراقب صفقات ميتاتريدر الحقيقية ويقارنها بالسقوف ويطلق إنذاراً فورياً ووسم الانحراف في الواجهة."),
];

const high = [
  finding("ب1 — عالٍ", P.high, "كشف بيانات خصوصية الزوار لأي متصل",
    "نقطة GET /api/visitors تعيد قائمة الأجهزة المتصلة بتفاصيلها: عنوان IP المستخرج من ترويسات التوجيه، ومتصفح الجهاز، ودقة الشاشة، والمنطقة الزمنية، واللغة، وصفحة الإحالة، لأي زائر بلا مصادقة. الأثر: خصوصية كل مستخدم مكشوفة لأي شخص يصل إلى العنوان. الإصلاح: إخفاء عنوان IP جزئياً أو كاملاً في العرض، وحصر القائمة خلف المصادقة العامة المذكورة في البند أ1."),
  finding("ب2 — عالٍ", P.high, "بيانات الحساب الحقيقي مكشوفة",
    "لقطة الحساب عبر getMt5LiveSnapshot تكشف رقم الحساب والوسيط والرصيد وحقوق الملك والهامش في صفحة الحساب لأي متصل. الأثر: معلومات مالية حساسة تصفها بوابة مفتوحة، وهي مدخل للاستهداف الاجتماعي. الإصلاح: إدراجها ضمن نطاق المصادقة، وعدم إظهار رقم الحساب كاملاً (إخفاء جزئي)."),
  finding("ب3 — عالٍ", P.high, "نقطة الإصلاح اليدوي بلا حماية",
    "POST /api/system/heal يستدعي دورة فحص وإصلاح كاملة لأي من يطلبها، وبلا رمز ولا حد للمعدل. الأثر: إغراق متكرر يستهلك المعالج ويولّد عمليات حفظ لقطة متلاحقة. الإصلاح: حماية النقطة بالرمز (نفس رمز الجسر أو رمز الإدارة) وحد معدل بسيط."),
  finding("ب4 — عالٍ", P.high, "تسجيل كل استعلامات قاعدة البيانات في الإنتاج (أُغلق أثناء الفحص)",
    "كان Prisma يشتغل بخيار log: ['query'] في الإنتاج، فكل استعلام يُطبع في ملف اللوج الذي يمر بأمر tee إلى ملفات لا تدوير لها (dev.log وserver.log وprod.log). الأثر: تضخم مستمر للسجلات حتى امتلاء القرص، وتباطؤ عام، وتسرب تفاصيل البيانات إلى ملفات نصية مكشوفة. الإصلاح: نُفذ؛ صار الإنتاج يسجل الأخطاء والتحذيرات فقط. ويبقى مقترحاً إضافياً: تفعيل تدوير للسجلات (logrotate أو حذف دوري)."),
  finding("ب5 — عالٍ", P.high, "إعادة دمج كاملة لكل فريم عند كل دفعة تيك",
    "شرط المسار السريع في ingestMt5 هو أن تكون أول شمعة الدفعة أحدث من آخر شمعة مخزنة، لكن الدفعات اللحظية تعيد إرسال الشمعة المتكونة نفسها، فيفشل الشرط ويسلك الكود المسار البطيء: بناء خريطة من نحو 200 ألف شمعة وترتيبها كاملاً كل ثانيتين تقريباً. الأثر: ضغط معالجة وجمع نفايات مستمر يفسر جزءاً من نمو الذاكرة الملاحظ (348 إلى 405 ميغابايت في ساعة) ويضيف حمل تقاعس لحظي في حلقة الأحداث. الإصلاح المقترح: السماح بالدمج من الطرف (استبدال آخر شمعة إذا تطابق زمنها وإلحاق الأحدث فقط) قبل اللجوء إلى الخريطة الكاملة، مع حد أقصى لحجم جسم الطلب."),
  finding("ب6 — عالٍ", P.high, "استطلاع المزامنة كان ينقل السجل كاملاً كل 4 ثوانٍ (أُغلق أثناء الفحص)",
    "قناة المزامنة اللحظية بين المستخدمين كانت تنزل سجل الصفقات كاملاً (حتى 3000 صفقة) في كل نبضة استطلاع لكل تاب مفتوح، أي حمل شبكي ومعالجة لا يتناسب مع الغرض وهو رصد تغير النتيجة. الإصلاح: نُفذ؛ أُضيف وضع بصمة خفيف (meta=1) يعيد معرف النتيجة ووقتها وثلاثة أرقام فقط، والتنزيل الكامل يتم مرة واحدة عند تغير البصمة فعلاً، واختير المسار عملياً بعد إعادة البناء."),
];

const medium = [
  finding("ج1 — متوسط", P.med, "سقف خسارة اليوم الصلب متساهل نسبياً",
    "HARD_RAILS.maxDailyLossPct يساوي 15 بالمئة من الأساس الثابت 1000 دولار، أي 150 دولاراً في اليوم الواحد، والتعليق في الكود نفسه يقر بأنه رُفع من 5 بالمئة كي لا يقطع اليوم. الأثر: يوم كارثي يمكن أن يستهلك ما يعادل عشرة إلى خمسة عشر وقفاً متتالياً قبل أن يتوقف النظام. المقترح: إعادة النظر في القيمة مع بقاء حد المستخدم الإعدادي حاكماً، أو جعلها تتقلص تلقائياً بعد سلسلة خسائر."),
  finding("ج2 — متوسط", P.med, "المستويات اليدوية Z تتجاوز كل الحواجز بلا تأكيد ثانٍ",
    "الاستراتيجية Z تتجاوز جدولة الجلسات وبوابة الجودة دائماً (sessOk تعيد true بلا شرط)، وهذا مقصود لأنها أوامر المستخدم المباشرة، لكن لا توجد صلاحية زمنية للمستوى ولا تأكيد إدخال ولا حد لأعداده. الأثر: خطأ إدخال واحد في رقم المستوى ينفذ فوراً بأي جلسة. المقترح: تأكيد بصري ثاني عند الإضافة، وصلاحية زمنية افتراضية تنتهي تلقائياً، وعدّاد صفقات Z اليومي في تقرير الحوكمة."),
  finding("ج3 — متوسط", P.med, "استعادة اللقطة تعيد الصفقات بلا تنقية",
    "عند الاستعادة من لقطة القرص تُقبل مصفوفات positions وdeals بتحويل نوع مباشر بلا مرور بدوال التحقق المستخدمة للبث المباشر (سطرا 90 و91 في mt5feed). الأثر: ملف لقطة تالف أو معدل يدوياً قد يدخل قيماً غير منطقية إلى الواجهة والإحصاءات. المقترح: تمرير ما يُستعاد على نفس دوال sanitize المنقحة."),
  finding("ج4 — متوسط", P.med, "محاسبة وضع الظل تفترض تنفيذاً مثالياً عند اللمس",
    "كشف الملء في وضع الظل يعتبر أن لمس السعر لقيمة الدخول يعني تنفيذ الأمر فوراً، بلا خصم السبريد ولا التحقق من أن المستخدم اتخذ الصفقة أصلاً، ثم تُقارن نسبة نجاح هذا النموذج بنسبة الباك تيست في كاشف الانحراف. الأثر: نموذج الظل متفائل بنحو ثابت، وقد يطلق إنذار انحراف متأخراً أو مضللاً. المقترح: خصم السبريد من منطق اللمس (الدخول عند العرض للشراء)، وفصل إحصاء الإشارات التي لم يأخذها المستخدم عن المنفذة."),
  finding("ج5 — متوسط", P.med, "SQLite بلا إعداد صريح لوضع WAL",
    "الكتابات المتزامنة واردة جداً: نبضات الزوار كل ثوانٍ، وتحديثات إشارات الظل، وحفظ الإعدادات، ونتائج الباك تيست. الوضع الافتراضي بدون WAL يسهل أن ينتج خطأ database is locked تحت تزامن أعلى. المقترح: تفعيل WAL وbusy_timeout مرة واحدة عند الإقلاع عبر executeRaw."),
  finding("ج6 — متوسط", P.med, "لا نسخ احتياطي مجدول لقاعدة البيانات",
    "كل الإعدادات وإشارات الظل ونتائج التشغيلات في ملف db/custom.db واحد، والوكيل الحارس يفحص ويصلح لكنه لا يأخذ نسخاً محفوظة. الأثر: فساد الملف أو خطأ أمر مثل db:push مع خيار قبول فقدان البيانات قد يمسح التاريخ بلا رجعة. المقترح: نسخة يومية مجدولة للملف إلى مجلد خارجي مع تدوير أسبوعي."),
  finding("ج7 — متوسط", P.med, "سبريد ثابت في المحاكاة لا يمثل الأيام المضطربة",
    "الباك تيست يحسب التكلفة بسبريد ثابت 30 سنتاً بينما البث الحي أظهر سبريد 26 سنتاً وبوابة الرفض عند 45 سنتاً. الأثر: نتائج الاختبار تفاؤلية نسبياً في لحظات الأخبار والسيولة الرقيقة حيث ينتفخ السبريد فعلاً. المقترح: إضافة سيناريو سبريد متغير (متوسط مع ذيل أعلى) كخيار تقرير جانبي بجوار السيناريو الثابت."),
  finding("ج8 — متوسط", P.med, "إغلاق زمني تقريبي في إحصاءات الظل",
    "الإشارة المفتوحة التي تتجاوز صلاحيتها بأربع وعشرين ساعة تُغلق بسعر آخر إغلاق متاح وتُحسب في متوسط النجاح بجانب إغلاقات الهدف والوقف. الأثر: خلط نوعين من الخروج في نسبة واحدة يضخم أو يخفض المتوسط حسب الزخم. المقترح: فصل حصة الإغلاق الزمني وعرضها كسطر مستقل في إحصاءات الظل."),
];

const low = [
  finding("د1 — منخفض", P.low, "أذونات ملف البيئة فضفاضة",
    "ملف .env بأذونات 755 أي قابل للقراءة من أي مستخدم على الجهاز. المقترح: chmod 600، وهو أمر بسيط لكنه من عادات الحماية الأساسية."),
  finding("د2 — منخفض", P.low, "أمر قاعدة بيانات خطر بلمسة واحدة",
    "سكربت db:push في package.json يحمل --accept-data-loss بشكل دائم، فأي تنفيذ عرضي عند تغير المخطط قد يسقط أعمدة بلا سؤال. المقترح: إزالة الخيار من السكربت الدائم وتركه أمراً يدوياً واعياً."),
  finding("د3 — منخفض", P.low, "كثير من كتل الالتقاط الصامتة",
    "عشرات catch الفارغة في الخادم والواجهة تبتلع الأعطال دون أثر، وقد أخفى أحدها سابقاً فشل حفظ الجدولة حتى عولج بوعي. المقترح: توحيد مسجل أخطاء خفيف يكتب الأسطر المهمة فقط، ومراجعة الكتل الحرجة (الحفظ، الالتقاط، الإغلاق)."),
  finding("د4 — منخفض", P.low, "وضع صارم معطل في React",
    "reactStrictMode: false يخفي مشاكل التأثيرات الجانبية أثناء التطوير. المقترح: تفعيله في جلسة تطوير مخصصة ومعالجة ما يظهره."),
  finding("د5 — منخفض", P.low, "ازدواجية مسار التشغيل",
    "سكربت start في package.json يشغل نسخة standalone بينما التشغيل الفعلي المستقر في هذه البيئة يتم بـ next start، والاختلاف بين المسارين كان جذر حادثة النسخة القديمة التي ظهرت في واجهة الجدولة. المقترح: توحيد مسار واحد رسمي وتعليق الآخر بوضوح."),
  finding("د6 — منخفض", P.low, "نمو جدول إشارات الظل بلا تنظيف",
    "الاستعلامات تحدد أخذ 500 سجلاً للعرض لكن الجدول نفسه ينمو بلا حذف دوري. المقترح: حذف مجدول للسجلات الأقدم من تسعين يوماً بعد تلخيصها."),
];

const strengths = [
  p("للإنصاف، يملك النظام أساساً هندسياً أعلى من المعتاد في أدوات هذا النوع. طبقة استقبال البيانات تنقية كل شمعة قادمة قبل قبولها وترفض الصفوف غير المنطقية، وتمسح كل التاريخ إذا تغير رقم الحساب المبث كي لا تختلط بيانات جهازين، ولها لقطة قرص كل خمس وأربعين ثانية تستعاد عند إعادة التشغيل فلا يضيع التاريخ ولا يعاد سحبه من الصفر. الحوكمة داخل المحرك سقوف صلبة معرفة في الكود قبل أن تكون إعدادات قابلة للتعديل، ومحاكاة التنفيذ تدرك الحد الأدنى للاحتفاظ فلا تقطع الصفقة قبل موعده مع بقاء الوقف والهدف نافذين دائماً."),
  p("كذلك نقاط API للإشارات تعمل بنمط قديم-أثناء-التحديث مع احتساب خلفي واحد لا يسمح بتكدس الحسابات المتوازية، والوضع الظل يسجل كل إشارة حية ويتتبع نتيجتها فعلياً في قاعدة البيانات وهو أساس صحيح لكاشف الانحراف بين الحي والمحاكاة، والمدرب الذكي حتمي صرف يقرأ الأرقام المحفوظة ولا يولد توصيات بلا مصدر، ووعد الحد الأدنى للوقف بعشرة دولارات موثق بالكود وتحقق عملياً على 96 صفقة مغلقة بالوقف دون أي خرق. أخيراً قناة المزامنة اللحظية بين المستخدمين أثبتت أثناء الفحص أنها تنقل أي تغيير إعدادات أو نتيجة باك تيست إلى كل الشاشات المفتوحة خلال ثوانٍ مع حماية من التعارض بين تعديلين متزامنين."),
];

const roadmap = dataTable(
  ["الأولوية", "الإجراء", "يعالج", "الأثر المتوقع"],
  [
    ["1 — فوري", "مصادقة على اللوحة كاملة (Caddy basic_auth أو middleware بجلسة ورمز قوي) قبل أي وصول من خارج الشبكة المحلية", "أ1، ب1، ب2، ب3", "إغلاق باب التحكم غير المصرح به نهائياً"],
    ["2 — فوري", "رمز عشوائي طويل لـ MT5 في ملف البيئة، مع تحديث سكربت الجسر على جهازك أولاً ثم الخادم (بالترتيب وإلا انقطع البث)", "أ2", "استعادة معنى القاعدة: بيانات حقيقية فقط"],
    ["3 — قريب", "نقل الباك تيست الكامل إلى عملية عامل منفصلة أو تقسيمه إلى دفعات تفرج حلقة الأحداث", "أ3", "لا تجميد أثناء الاختبار، وبث مستقر"],
    ["4 — قريب", "حد لحجم جسم طلب الجسر + حد معدل على ingest وheal + دمج من الطرف للشموع", "أ2، ب3، ب5", "مقاومة إغراق وكفاءة معالجة"],
    ["5 — قريب", "نسخ احتياطي يومي مجدول لقاعدة البيانات مع تدوير أسبوعي + تفعيل WAL", "ج5، ج6", "حماية الإعدادات والسجل من الفقد"],
    ["6 — متوسط", "حارس مطابقة يقارن صفقات MT5 الحقيقية بالسقوف الصلبة وينبه فوراً عند التجاوز", "أ5", "جعل الحوكمة نافذة في الواقع لا في العرض فقط"],
    ["7 — متوسط", "خصم السبريد في محاكاة وضع الظل + فصل الإغلاق الزمني في الإحصاءات + سيناريو سبريد متغير في الباك تيست", "ج4، ج7، ج8", "أرقام أكثر صدقاً لكاشف الانحراف"],
    ["8 — متابعة", "تدوير السجلات + تنظيف LiveSignal القديم + توحيد مسار التشغيل + أذونات الملفات", "ب4، د1، د5، د6", "استدامة تشغيل طويلة المدى"],
  ],
  [14, 40, 16, 30]
);

const summaryTable = dataTable(
  ["الشدة", "العدد", "أبرز الأمثلة"],
  [
    ["حرج", "5", "بلا مصادقة، رمز جسر افتراضي فعّال، تجميد الخادم أثناء الباك تيست، فحص أنواع معطل (أُغلق)، حوكمة استشارية في الحي"],
    ["عالٍ", "6", "كشف بيانات الزوار والحساب، نقطة إصلاح مفتوحة، تسجيل استعلامات (أُغلق)، دمج كامل كل تيك، حمل استطلاع (أُغلق)"],
    ["متوسط", "8", "سقف خسارة 15%، تجاوز Z بلا تأكيد، لقطة بلا تنقية، ظل بلا سبريد، SQLite بلا WAL، بلا نسخ احتياطي"],
    ["منخفض", "6", "أذونات ملف البيئة، أمر db:push خطر، التقاط صامت، React صارم معطل، ازدواجية تشغيل، نمو LiveSignal"],
  ],
  [12, 10, 78]
);

const bodyChildren = [
  h1("1. الملخص التنفيذي"), ...execSummary,
  tableTitle("جدول 1: توزيع الملاحظات حسب الشدة"), summaryTable,
  h1("2. المنهجية ونطاق الفحص"), ...method,
  h1("3. الثغرات الحرجة"), ...critical,
  h1("4. الثغرات عالية الخطورة"), ...high,
  h1("5. الثغرات متوسطة الخطورة"), ...medium,
  h1("6. الثغرات منخفضة الخطورة وتحسينات الجودة"), ...low,
  h1("7. الإصلاحات المنفذة فوراً أثناء الفحص"), ...[
    p("ثلاث ثغرات من القائمتين العالية والحرجة أُغلقت فعلياً أثناء الفحص نفسه ثم أُعيد بناء النظام في وضع الإنتاج والتحقق منه بالتشغيل الحي: الأولى تخفيف حمل قناة المزامنة اللحظية بنمط البصمة الخفيفة فلم يعد التاب المفتوح ينزل آلاف الصفقات كل أربع ثوانٍ بل بصمة صغيرة والتنزيل الكامل عند تغير النتيجة فقط؛ والثانية إيقاف تسجيل كل استعلامات قاعدة البيانات في الإنتاج فالسجل الآن للأخطاء والتحذيرات فقط؛ والثالثة تفعيل فحص الأنواع في البناء مع استبعاد المجلدات الخارجية عن المشروع، وأعيد البناء بنجاح تحت الفحص الصارم كدليل على سلامة الكود الحالي. جميع الإصلاحات الثلاثة جرى التحقق منها بعد إعادة التشغيل: نقطة البصمة الخفيفة تعيد مئات البايتات بدل مئات الكيلوبايت، وفحص الصحة سليم، وواجهة الباك تيست تعرض النتيجة المشتركة كما يجب."),
  ],
  h1("8. نقاط القوة الملاحظة"), ...strengths,
  h1("9. خارطة الإصلاح المقترحة بالأولوية"),
  p("رتُبت الإجراءات بحيث تبدأ بما يغلق أخطر أبواب الخطر بأقل جهد، ثم يعالج الاستقرار والأداء، ثم دقة الأرقام، ثم الاستدامة. البندان الأول والثاني يتطلب قرارك قبل التنفيذ لأن الأول قد يقيد وصولك المؤقت من خارج شبكتك، والثاني يتطلب لمسة على جهازك (تحديث سكربت الجسر بالرمز الجديد) قبل تحديث الخادم."),
  tableTitle("جدول 2: خارطة الإصلاح"), roadmap,
  h1("10. الخلاصة والتوصية النهائية"),
  p("البوت في جوهره مبني بجدية: بيانات منقية، وسقوف صلبة، وشفافية أرقام، وتتبع حي لإشاراته. لكنه يعمل اليوم بباب تحكم مفتوح بلا قفل، ويغذي قاعدته الحديدية ببرميل مزود بغطاء معروف للجميع، ويتجمد دقيقة كاملة كلما شغل مستخدم باك تيست. هذه ثلاثية الخطر الأولى (أ1، أ2، أ3) هي كل التوصية العاجلة: مصادقة الآن، ورمز قوي بتنسيق مع جهازك، وإخراج الباك تيست عن حلقة الخدمة. بعدها يصبح النظام جاهزاً لثقة أعلى بكثير برأس مال أكبر، وتبقى بنود المتوسط والمنخفض لمتابعة مجدولة هادئة."),
];

// ================= DOCUMENT =================
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1417, right: 1701 };

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: AR, size: 24, color: "000000" },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: AR, size: 30, bold: true, color: P.primary },
        paragraph: { spacing: { before: 360, after: 180, line: 340 } },
      },
    },
  },
  sections: [
    { // Section 1: cover — margin 0, no footer/header
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1RTL({
        title: "تقرير الفحص الشامل لبوت الذهب BFX AURUM",
        subtitle: "ثغرات النظام والمخاطر التشغيلية وخارطة الإصلاح — فحص كود كامل مع اختبار حي",
        englishLabel: "SECURITY AND RELIABILITY AUDIT",
        metaLines: [
          "النظام: بوت تداول XAUUSD — الإصدار v18 PRO — جسر MT5 v20",
          "تاريخ الفحص: 3 نوفمبر 2026",
          "النطاق: الكود المصدري كاملاً — 18 نقطة API — قاعدة البيانات — البنية التشغيلية",
          "النتيجة: 25 ملاحظة (5 حرجة، 6 عالية، 8 متوسطة، 6 منخفضة) — أُغلقت 3 فوراً",
        ],
        footerRight: "BFX AURUM v18 PRO",
        footerLeft: "تقرير داخلي — سري",
        palette: P,
      }),
    },
    { // Section 2: TOC — Roman numerals
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      headers: { default: pageHeader() },
      footers: { default: pageFooter() },
      children: [
        new Paragraph({
          bidirectional: true, alignment: AlignmentType.CENTER, spacing: { before: 480, after: 360 },
          children: [run("المحتويات", { bold: true, size: 32 })],
        }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          bidirectional: true, alignment: AlignmentType.START, spacing: { before: 200 },
          children: [run("ملاحظة: هذا الفهرس مولد بحقول تلقائية؛ بعد أي تعديل انقر عليه بالزر الأيمن واختر تحديث الحقل لتحديث أرقام الصفحات.", { italics: true, size: 18, color: "888888" })],
        }),
        // لا PageBreak هنا — قسم المتن يبدأ بـ NEXT_PAGE وكسر مزدوج يولد صفحة فارغة
      ],
    },
    { // Section 3: body — Arabic numerals from 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: pageHeader() },
      footers: { default: pageFooter() },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("/home/z/my-project/download/تقرير_فحص_بوت_BFX_AURUM.docx", buf);
  console.log("DOCX written OK");
});
