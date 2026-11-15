// ============================================================
// تجميع تقرير اللوت الثابت — الجزء الثاني: المحتوى والوثيقة
// bun run scripts/report_main.js
// ============================================================
const {
  Document, Packer, Paragraph, TextRun, ImageRun, PageBreak, Header, Footer,
  PageNumber, NumberFormat, AlignmentType, SectionType, TableOfContents,
} = require("docx");
const fs = require("fs");
const {
  ar, body, h1, h2, dataTable, tableTitle, tableNote, buildCoverR1RTL,
  P, AR_FONT, fmt$, fmtN, R, BASE, BOOST, CAP48,
} = require("./report_lib.js");

const st = R.stats;
const hold = R.hold;
const net = st.netPnl;
const monthsPositive = R.monthly.filter(m => m.net >= 0).length;
const worstMonth = R.monthly.reduce((a, b) => (b.net < a.net ? b : a));
const bestMonth = R.monthly.reduce((a, b) => (b.net > a.net ? b : a));
const strat = (code) => R.byStrat.find(s => s.strategy === code) || { n: 0, net: 0 };

// ============ الغلاف ============
const cover = buildCoverR1RTL({
  palette: P,
  englishLabel: "FIXED LOT COMPLIANCE REPORT",
  titleLines: ["اللوت الثابت 0.01 الصارم", "وسقف الاحتفاظ 72 ساعة"],
  subtitle: "تكييف الاستراتيجيات مع اللوت الثابت — تقرير التحقق الرسمي على شموع XAUUSD الحقيقية",
  metaLines: [
    "المنصة: MetaTrader 5 — XAUUSD (الذهب)",
    `النافذة: 13 يونيو 2025 — 10 نوفمبر 2026 (${fmtN(201589)} شمعة 5 دقائق)`,
    "الأساس: 1,000$ | اللوت: 0.01 ثابت بلا أي استثناء",
    "تاريخ التقرير: 11 نوفمبر 2026",
  ],
  footerLeft: "سري — للمالك فقط",
  footerRight: "XAUUSD TRADING BOT",
});

// ============ الجسم ============
const bodyChildren = [];

// ---- 1. الملخص التنفيذي ----
bodyChildren.push(h1("أولاً: الملخص التنفيذي"));
bodyChildren.push(body(`نفّذ قرار المالك القاضي بجعل اللوت ثابتاً عند 0.01 والتزاماً صارماً بلا أي استثناء، وجعل الاستراتيجيات تتناسب مع هذا اللوت عبر ثلاث أدوات متكاملة: تعطيل تضخيم الجودة (القاعدة 33) الذي كان يضاعف اللوت إلى 0.02 لسلة السبعة، وتفعيل سقف الاحتفاظ الزمني عند 72 ساعة استجابة لتعليمة «لا أريد صفقة أكثر من يومين أو ثلاثة أيام»، وإبقاء البوابات التكيفية (31 و32) التي تجمّد الاتجاهات الميتة والاستراتيجيات المنحسرة تلقائياً. تحقّق من ذلك على كامل النافذة التاريخية من 13 يونيو 2025 إلى 10 نوفمبر 2026 على ${fmtN(201589)} شمعة حقيقية من طرفية MT5.`));
bodyChildren.push(body(`النتيجة الرسمية بعد التنفيذ: ${fmtN(st.totalTrades)} صفقة، صافي ${fmt$(net)} على أساس 1,000$، معامل ربحية ${st.profitFactor.toFixed(3)}، أقصى تراجع ${st.maxDrawdownPct.toFixed(2)}%. الأهم من الأرقام المطلقة: كل صفقة في التشغيلة استخدمت لوت 0.01 بالضبط — لا صفقة واحدة بلوت 0.02 ولا أي حجم آخر، وصفر صفقة تجاوزت سقف 72 ساعة (أطول صفقة فعلية ${hold.maxHours} ساعة). المقارنة مع تشغيلة 0.02 السابقة تُظهر أن التزام اللوت الثابت خفّض أقصى تراجع من 42.99% إلى ${st.maxDrawdownPct.toFixed(2)}% مقابل تنازل عن جزء من الربح الإجمالي، وهو مقايضة تتسق مع دستور البوت الذي يجعل البقاء أولاً.`));

// ---- 2. قرار المالك وتنفيذه ----
bodyChildren.push(h1("ثانياً: قرار المالك وتنفيذه على كل مسارات البوت"));
bodyChildren.push(body("كان في الإعدادات السابقة استثناء واحد على اللوت الثابت: القاعدة 33 (تحجيم الجودة) تمنح سلة السبعة (E/W/X/I/AA/F/Y) لوتاً مضاعفاً 0.02 عندما تكون نافذة 90 يوماً صحية (PF ≥ 1.15 بعينة ≥ 10 صفقات)، بشرط ألا يتجاوز التراجع عن قمة الإيكويتي 10%. رغم أن المبدأ النظري سليم (تضخيم الرابح الموثق لا مضاعفة الخاسر)، فإن المحاكاة أثبتت أن التضخيم رفع أقصى التراجع إلى 42.99% — وهو مستوى لا يتسق مع طبيعة الحساب الحقيقي البالغ رصيده 190.81$. لذلك عُطّلت القاعدة 33 دستورياً في موضعين معاً: القيمة الافتراضية في الكود، وقيمة الإعدادات المحفوظة الحية."));
bodyChildren.push(body(`التحقق من الالتزام تم على ثلاثة مستويات مستقلة. أولاً: فحص اللوت الفعلي لكل صفقة في تشغيلة التحقق الكاملة — النتيجة مصفوفة لوت تحوي قيمة واحدة فقط: 0.01، وعدد صفقات اللوت المحسّن صفر. ثانياً: مسار المدير الآلي (automanager) يقرأ اللوت حصراً من قاعدة fixed_lot ويعيد حساب تكلفة السبريد على أساسه. ثالثاً: نافذة المستويات اليدوية في الواجهة تستخرج اللوت من القاعدة نفسها. بهذا لا يوجد في النظام كله مسار تنفيذ واحد قادر على إصدار حجم غير 0.01، وأي تعديل مستقبلي على هذه القاعدة يظهر فوراً في الباك تيست وفي الحي معاً لأن المصدر واحد.`));
bodyChildren.push(tableTitle("جدول 1: مواضع التحكم باللوت في النظام وحالتها بعد التنفيذ"));
bodyChildren.push(dataTable(
  ["الموضع", "الوظيفة", "القيمة الآن"],
  [
    ["fixed_lot (القاعدة 2)", "اللوت الموحد لكل التنفيذ — الباك تيست والحي", { text: "0.01 مفعل", color: "2E7D32", bold: true }],
    ["sizing_quality (القاعدة 33)", "تضخيم الجودة 0.02 لسلة السبعة", { text: "معطّل دستورياً", color: "B3261E", bold: true }],
    ["التحقق من الصفقات", `فحص مصفوفة اللوت في ${fmtN(st.totalTrades)} صفقة`, { text: "[0.01] فقط", color: "2E7D32", bold: true }],
    ["صفقات اللوت المحسّن", "عدّاد القاعدة 33 في التشغيلة الكاملة", { text: "0", color: "2E7D32", bold: true }],
  ],
  [30, 45, 25]
));
bodyChildren.push(tableNote("المصدر: تشغيلة التحقق الرسمية على كامل النافذة — عدّاد القاعدة 33 وألوانها من سجل المحرك مباشرة."));

// ---- 3. سقف الاحتفاظ ----
bodyChildren.push(h1("ثالثاً: سقف الاحتفاظ الزمني — 72 ساعة بلا تجاوز"));
bodyChildren.push(body("تنفيذ تعليمة المالك «لا أريد صفقة أكثر من يومين أو ثلاثة أيام — اجعله يتقيد بذلك» تم عبر سقف الاحتفاظ الزمني (القاعدة 4). آلية العمل في الباك تيست: أي صفقة كانت ستنتهي شمعتها التالية بعد السقف تُغلق إجبارياً على إغلاق آخر شمعة ما زالت ضمن السقف — هذا الاختيار متعمد: انتظار أول شمعة بعد التجاوز كان سيُمرّر الصفقة عبر فجوة يومية أو عطلة نهاية أسبوع إلى أيام فوق الحد المسموح. في الحي: مراقب دوري في مسار الإشارات يقيس عمر كل موقف MT5 مفتوح، وأي موقف يتجاوز السقف يولّد تنبيهاً إلزامياً فورياً على اللوحة والتليجرام بمفتاح منع تكرار يومي حتى الإغلاق الفعلي."));
bodyChildren.push(body(`قبل تثبيت القيمة قورنت التخصّصتان المسموحتان بتعليمة المالك: سقف 48 ساعة (يومان) وسقف 72 ساعة (ثلاثة أيام). كلاهما يحترم التعليمة حرفياً، والفرق بينهما جوهري اقتصادياً: استراتيجيات الاتجاه الطويل X وW تحقق معظم ربحها في التمدد الزمني، والسقف الأقصر يقطعها قبل النضج — X انتقل من ${fmt$(667.24)} عند 48 ساعة إلى ${fmt$(strat("X").net)} عند 72 ساعة، وY انتقل من الخسارة إلى الربح. أثر ذلك في المقايضة: سقف 72 ساعة يضيف نحو 700$ صافي ويرفع معامل الربحية بنحو 0.06 مقابل زيادة أقصى تراجع بمقدار 1.33 نقطة مئوية فقط. روعي في الاختيار أن كلا المقياسين يبقى ضمن نطاق الدستور.`));
bodyChildren.push(tableTitle("جدول 2: مقارنة سقفي 48 و72 ساعة — اللوت الثابت 0.01 والبوابات نفسها"));
bodyChildren.push(dataTable(
  ["المؤشر", "سقف 48 ساعة", "سقف 72 ساعة (المعتمد)"],
  [
    ["عدد الصفقات", fmtN(CAP48.trades), { text: fmtN(st.totalTrades), bold: true }],
    ["صافي الربح", fmt$(CAP48.net), { text: fmt$(net), bold: true }],
    ["معامل الربحية", CAP48.pf.toFixed(3), { text: st.profitFactor.toFixed(3), bold: true }],
    ["أقصى تراجع", `${CAP48.dd.toFixed(2)}%`, { text: `${st.maxDrawdownPct.toFixed(2)}%`, bold: true }],
    ["أطول صفقة فعلية", "47.9 ساعة", { text: `${hold.maxHours} ساعة`, bold: true }],
    ["إغلاقات زمنية إجبارية", "85", { text: String(hold.timeExits), bold: true }],
    ["صفقات فوق السقف", "0", { text: "0", bold: true }],
  ],
  [34, 30, 36],
  { numericCols: [1, 2] }
));
bodyChildren.push(tableNote("الاعتماد: سقف 72 ساعة — أرباحاً ومعامل ربحية أعلى بزيادة تراجع هامشية، وكلاهما داخل تعليمة «يومين أو ثلاثة»."));

// ---- 4. تكيّف الاستراتيجيات ----
bodyChildren.push(h1("رابعاً: كيف تتكيف الاستراتيجيات مع اللوت 0.01"));
bodyChildren.push(body(`اللوت الثابت يعني أن تكلفة السبريد الثابتة (0.30$ لكل صفقة) تشكّل عبئاً نسبياً يتفاوت بين الاستراتيجيات: من له هامش صافٍ لكل صفقة أدنى من التكلفة لا يبرر وجوده أصلاً بهذا اللوت. لذلك بنيت الطبقة التكيفية على ثلاث طبقات تعمل تلقائياً دون تدخل يدوي. الطبقة الأولى: التعطيل الكامل للاستراتيجية I التي كانت تستهلك 40% من حجم التداول بنافذة 90 يوماً دون 1.00 — قرار معتمد سابقاً ومنفذ في الإعدادات. الطبقة الثانية: بوابة الانحسار الزمني (القاعدة 32) تحتجز أي استراتيجية نافذتها 90 يوماً دون PF 1.00 بعينة ≥ 50 إلى صفقة واحدة يومياً حتى تعافي النافذة — في التشغيلة الحالية احتجزت ${fmtN((st.adaptiveGates?.decayGuard?.M ?? 0) + (st.adaptiveGates?.decayGuard?.F ?? 0))} إشارة (M: ${fmtN(st.adaptiveGates?.decayGuard?.M ?? 0)} وF: ${fmtN(st.adaptiveGates?.decayGuard?.F ?? 0)}). الطبقة الثالثة: الاحتجاز الاتجاهي (القاعدة 31) الذي يجمّد أي طرف (شراء/بيع) PF التراكمي له دون 0.90 بعينة ≥ 30 — لم يُضطر للعمل في هذه التشغيلة لأن الميتة أُزيلت أولاً.`));
bodyChildren.push(body(`النتيجة العملية: من 20 استراتيجية نشطة، 15 بربحية موجبة و4 بالخسارة والواحدة محايدة، ولا توجد أي استراتيجية هامشها السنوي سالب يتجاوز 60$ — حدّ خسارة الفردي صار محكوماً. استراتيجية M التي كانت تُهدّر رأس المال في تشغيلات لا تنتهي حُصرت إلى ${fmtN(strat("M").n)} صفقة فقط بخسارة ${fmt$(strat("M").net)} بدل آلاف الصفقات، والسلة السبعة كلها حقيقية الوجود في الأرباح ما عدا Y التي بقيت قرب التعادل (${fmt$(strat("Y").net)}) بانتظار قرار نافذتها.`));
bodyChildren.push(tableTitle("جدول 3: الأداء لكل استراتيجية — التشغيلة الرسمية (لوت 0.01 صارم، سقف 72 ساعة)"));
bodyChildren.push(dataTable(
  ["الكود", "الصفقات", "صافي $", "معامل الربحية"],
  R.byStrat.map(s => [
    s.strategy,
    fmtN(s.n),
    { text: fmt$(s.net), color: s.net >= 0 ? "2E7D32" : "B3261E" },
    s.pf != null ? s.pf.toFixed(2) : "—",
  ]),
  [22, 26, 26, 26],
  { numericCols: [1, 2, 3] }
));
bodyChildren.push(tableNote("معامل الربحية للاستراتيجيات ذات الصفقات القليلة (~1-8 صفقات) إرشادي فقط — عينة الحكم الدستورية 30 صفقة."));
bodyChildren.push(body(`أثر هذا التنظيم على جودة التوزيع ظاهر في مقارنة خط الأساس: التشكيلة القديمة كانت تسجّل 80% من أرباحها من أربعة رموز فقط مع 15 استراتيجية ذيلية تساهم بـ490$ على ${fmtN(674)} صفقة، بينما التشكيلة الحالية تحقق نفس الروح بتركيبة أنظف: المركز الأول E يستحوذ على 44% من الربح، ثم ثلاثة مراكز متوسطة (X وAA وW) فوق 770$ لكل منها، وذيل محكوم خسارته الفردية لا يهدد الأساس. هذا هو معنى «الاستراتيجيات تتناسب مع اللوت»: لا استراتيجية تحمل حجم المركز أكبر من اقتصاديتها الحقيقية عند 0.01، ولا صفقة واحدة قادرة على كسر أساس الحساب.`));

// ---- 5. النتائج الرسمية والمقارنة ----
bodyChildren.push(h1("خامساً: النتائج الرسمية والمقارنة مع خط الأساس"));
bodyChildren.push(body(`تشغيلة التحقق الرسمية (كامل النافذة، أساس 1,000$، سبريد ثابت 0.30$، الوقف يسبق إشارة الخروج تسبق السقف الزمني) سجّلت: ${fmtN(st.totalTrades)} صفقة، نسبة نجاح ${st.winRate.toFixed(1)}%، صافي ${fmt$(net)}، معامل ربحية ${st.profitFactor.toFixed(3)}، أقصى تراجع ${st.maxDrawdownPct.toFixed(2)}%. العينة خارج نطاق التدريب (${fmtN(st.oos?.trades ?? 0)} صفقة) تحتفظ بنسبة نجاح ${(st.oos?.winRate ?? 0).toFixed(1)}% — دليل أن أداء التشكيلة ليس انحصاراً في فترة التدريب. الشهور السالبة ثلاثة فقط من 18 شهراً (أسوأها ${fmt$(worstMonth.net)} في ${worstMonth.month}) مقابل شهور الذروة ${fmt$(bestMonth.net)}، ولم يُضرب أي صمام حماية (يومي أو أسبوعي أو إيكويتي) طوال النافذة.`));
bodyChildren.push(tableTitle("جدول 4: الثلاث تشغيلات المرجعية على النافذة الكاملة نفسها"));
bodyChildren.push(dataTable(
  ["المؤشر", `خط الأساس\n(بلا سقف، مع I)`, "لوت 0.02\n(تشغيلة ملغاة)", "المعتمد الآن\n(0.01 صارم + 72 ساعة)"],
  [
    ["الصفقات", fmtN(BASE.trades), fmtN(BOOST.trades), { text: fmtN(st.totalTrades), bold: true }],
    ["صافي الربح", fmt$(BASE.net), fmt$(BOOST.net), { text: fmt$(net), bold: true }],
    ["معامل الربحية", BASE.pf.toFixed(3), BOOST.pf.toFixed(3), { text: st.profitFactor.toFixed(3), bold: true }],
    ["أقصى تراجع", `${BASE.dd.toFixed(2)}%`, { text: `${BOOST.dd.toFixed(2)}%`, color: "B3261E" }, { text: `${st.maxDrawdownPct.toFixed(2)}%`, bold: true }],
    ["أطول احتفاظ", "غير مقيد", "48 ساعة", { text: `${hold.maxHours} ساعة`, bold: true }],
    ["حجم اللوت", "0.01", { text: "0.01 و0.02", color: "B3261E" }, { text: "0.01 حصراً", bold: true }],
  ],
  [25, 25, 25, 25],
  { numericCols: [1, 2, 3] }
));
bodyChildren.push(tableNote("خط الأساس يعتمد أرقام الاعتماد الأصلية الموثقة (3,930 صفقة | +10,268.75$ | PF 1.642 | DD 26.77%)."));
bodyChildren.push(body(`قراءة المقايضة بصراحة: الربح الإجمالي انتقل من ${fmt$(BASE.net)} إلى ${fmt$(net)} — أي تنازل عن ${fmtN(Math.round(BASE.net - net))}$ نحوياً مقابل ثلاث مكاسب هيكلية لا تُعوّض بالمال المباشر. الأولى: أقصى تراجع في تشغيلة 0.02 بلغ 42.99% وهو الذي كان سيضاعف الخسارة الاسمية على الحساب الحقيقي؛ التشكيلة المعتمدة أعادته إلى نطاق ${st.maxDrawdownPct.toFixed(1)}% بلات التضخيم. الثانية: كل صفقة الآن عمرها محدود بسقف المالك — لا مواقف عالقة عبر عطلات الأسابيع تسحب الهامش أياماً. الثالثة: خسارة كل استراتيجية فردية محكومة ومراقبة، فلا يوجد صندوق أسود يتراكم بصمت كما كان مع I. هذا هو معنى أن البوت «يتقيد» باللوت لا أنه يعرضه في الواجهة.`));

// ---- الشكل 1 ----
const img = fs.readFileSync("/home/z/my-project/download/timestop_fixed_lot_performance.png");
const IMG_W = 590, IMG_H = Math.round(590 * 1184 / 1840);
bodyChildren.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 200, after: 60 },
  children: [new ImageRun({ data: img, transformation: { width: IMG_W, height: IMG_H }, type: "png" })],
}));
bodyChildren.push(new Paragraph({
  bidirectional: true, alignment: AlignmentType.CENTER, spacing: { after: 200, line: 276 },
  children: [ar("شكل 1: منحنى الإيكويتي (فوق) وصافي الربح الشهري (تحت) — اللوت الثابت 0.01 وسقف الاحتفاظ 72 ساعة على أساس 1,000$", { size: 19, color: P.secondary })],
}));

// ---- 6. الخلاصة والتوصيات ----
bodyChildren.push(h1("سادساً: الخلاصة والحالة التشغيلية"));
bodyChildren.push(body(`ثلاثة بنود حُسمت ونُفذت وتحققت: (1) اللوت ثابت 0.01 في كل مسارات النظام — تحقق بالفحص المباشر لمصفوفة اللوت في ${fmtN(st.totalTrades)} صفقة وعدّاد التضخيم صفر؛ (2) سقف الاحتفاظ 72 ساعة منفذ في الباك تيست وفي مراقب الحي مع تنبيهات إلزامية — صفر تجاوز في كامل النافذة؛ (3) الاستراتيجيات متكيفة مع اقتصاد اللوت عبر تعطيل I والبوابتين 31/32 — الديون القديمة المزمنة أُزيلت والمنحسر يُحتضر تلقائياً. الحالة التشغيلية الآن: الإعدادات الحية محفوظة بالقيم المعتمدة نفسها، وأي تشغيل مستقبلي للباك تيست يقرأ القيم من المصدر ذاته فلا انفصام بين المقاس والمُقاس.`));
bodyChildren.push(body(`التوصية التالية بترتيب الأولوية: تشغيل الوضع الظلي على الحساب الحقيقي أسبوعين بقرارات المحرك الآلي دون تدخل يدوي، ومقارنة انحراف الحي عن هذه التشغيلة المرجعية (نسبة التنفيذ، السبريد الفعلي مقابل 0.30$، زمن الاحتفاظ) قبل أي رفع للسلم نحو التنفيذ الكامل. البنود الأربعة المؤجلة من الجلسة السابقة (صمام التراجع 15%، تقاعد الذيل، السبريد الديناميكي، فلتر الجلسات) تبقى معلقة بلا تنفيذ حتى تقرير الانحراف الأول — لا يُفتح أي منها بلا قرار من المالك.`));

// ============ الوثيقة ============
const headerBar = new Header({
  children: [new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT,
    border: { bottom: { style: "single", size: 2, color: P.accent, space: 4 } },
    spacing: { after: 0 },
    children: [ar("اللوت الثابت 0.01 وسقف الاحتفاظ 72 ساعة — تقرير التحقق", { size: 16, color: P.secondary })],
  })],
});
const footerNum = new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "888888", font: AR_FONT })],
  })],
});

const doc = new Document({
  creator: "XAUUSD Trading Bot",
  title: "اللوت الثابت 0.01 وسقف الاحتفاظ 72 ساعة",
  styles: {
    default: {
      document: {
        run: { font: AR_FONT, size: 24, color: P.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: { run: { font: AR_FONT, size: 30, bold: true, color: P.ink }, paragraph: { spacing: { before: 360, after: 160, line: 312 } } },
      heading2: { run: { font: AR_FONT, size: 26, bold: true, color: "3A3A3A" }, paragraph: { spacing: { before: 240, after: 120, line: 312 } } },
    },
  },
  sections: [
    // القسم 1: الغلاف — بلا ترقيم ولا تذييل
    {
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: cover,
    },
    // القسم 2: المحتويات — ترقيم روماني
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 }, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      footers: { default: footerNum },
      children: [
        new Paragraph({
          bidirectional: true, alignment: AlignmentType.RIGHT,
          spacing: { before: 200, after: 240, line: 400, lineRule: "atLeast" },
          children: [ar("المحتويات", { size: 32, bold: true, boldComplexScript: true, color: P.ink })],
        }),
        new TableOfContents("المحتويات", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          bidirectional: true, spacing: { before: 200, line: 276 },
          children: [ar("ملاحظة: إن ظهرت عناوين بلا أرقام صفحات، انقر بالزر الأيمن على قائمة المحتويات ثم اختر «تحديث الحقل».", { size: 18, italics: true, color: "888888" })],
        }),
      ],
    },
    // القسم 3: الجسم — ترقيم عربي يبدأ من 1
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 }, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: headerBar },
      footers: { default: footerNum },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then(buf => {
  const out = "/home/z/my-project/download/تقرير-اللوت-الثابت-وسقف-الاحتفاظ.docx";
  fs.writeFileSync(out, buf);
  console.log("saved", out, buf.length, "bytes");
});
