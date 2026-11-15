// ============================================================
// تقرير اللوت الثابت 0.01 وسقف الاحتفاظ 72 ساعة — Arabic RTL docx
// R1 recipe (adapted RTL) + IG-1 Ink Gold palette (finance)
// البيانات من /tmp/report_final.json (تشغيلة موحدة الع source)
// ============================================================
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, PageBreak, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableLayoutType, SectionType, TableOfContents, LevelFormat, VerticalAlign,
} = require("docx");
const fs = require("fs");

const R = JSON.parse(fs.readFileSync("/tmp/report_final.json", "utf-8"));

// ---------- البيانات المرجعية الثابتة (تشغيلات سابقة موثقة) ----------
const BASE = { trades: 3930, net: 10268.75, pf: 1.642, dd: 26.77 };   // خط الأساس الأصلي
const BOOST = { trades: 2003, net: 11481.85, pf: 1.767, dd: 42.99 };  // تشغيلة لوت 0.02 (ملغاة)
const CAP48 = { trades: 2164, net: 5933.49, pf: 1.539, dd: 29.65 };  // تشغيلة سقف 48 ساعة

// ---------- IG-1 Ink Gold palette ----------
const P = {
  bg: "1A1A1A", accent: "C9A84C",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "C9A84C", headerText: "1A1A1A", accentLine: "C9A84C", innerLine: "DDD5C0", surface: "F5F2E8" },
  ink: "1A1A1A", body: "242424", secondary: "5A5A5A",
};

const AR_FONT = { ascii: "Arial", hAnsi: "Arial", cs: "Arial", eastAsia: "Arial" };
const noB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const allNoBorders = { top: noB, bottom: noB, left: noB, right: noB, insideHorizontal: noB, insideVertical: noB };
const noBorders = { top: noB, bottom: noB, left: noB, right: noB };

const fmt$ = (n) => `${n >= 0 ? "+" : "\u2212"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (n) => n.toLocaleString("en-US");

// ---------- Arabic text run / paragraph helpers ----------
function ar(text, opts = {}) {
  return new TextRun({ text, rightToLeft: true, font: AR_FONT, ...opts });
}
function body(text, opts = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: 120 },
    children: [ar(text, { size: 24, color: P.body, ...opts.run })],
    ...opts.para,
  });
}
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 360, after: 160, line: 312 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 6 } },
    children: [ar(text, { size: 30, bold: true, boldComplexScript: true, color: P.ink })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 240, after: 120, line: 312 },
    children: [ar(text, { size: 26, bold: true, boldComplexScript: true, color: "3A3A3A" })],
  });
}

// ---------- RTL data table ----------
function dataTable(headers, rows, widths, opts = {}) {
  const hdr = new TableRow({
    tableHeader: true, cantSplit: true,
    children: headers.map((t, i) => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: P.table.headerBg },
      margins: { top: 70, bottom: 70, left: 110, right: 110 },
      width: { size: widths[i], type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        bidirectional: true, alignment: AlignmentType.CENTER, spacing: { line: 276 },
        children: [ar(t, { size: 21, bold: true, boldComplexScript: true, color: P.table.headerText })],
      })],
    })),
  });
  const bodyRows = rows.map((r, ri) => new TableRow({
    cantSplit: true,
    children: r.map((cell, i) => {
      const conf = typeof cell === "object" ? cell : { text: String(cell) };
      return new TableCell({
        shading: { type: ShadingType.CLEAR, fill: ri % 2 === 1 ? P.table.surface : "FFFFFF" },
        margins: { top: 60, bottom: 60, left: 110, right: 110 },
        width: { size: widths[i], type: WidthType.PERCENTAGE },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          bidirectional: true,
          alignment: conf.align || (opts.numericCols?.includes(i) ? AlignmentType.CENTER : AlignmentType.RIGHT),
          spacing: { line: 276 },
          children: [ar(conf.text, { size: 20, color: conf.color || P.body, bold: conf.bold || false, boldComplexScript: conf.bold || false })],
        })],
      });
    }),
  }));
  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: P.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: P.table.accentLine },
      left: noB, right: noB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
      insideVertical: noB,
    },
    rows: [hdr, ...bodyRows],
  });
}
function tableTitle(text) {
  return new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT, keepNext: true,
    spacing: { before: 160, after: 80, line: 312 },
    children: [ar(text, { size: 21, bold: true, boldComplexScript: true, color: P.secondary })],
  });
}
function tableNote(text) {
  return new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT,
    spacing: { before: 60, after: 160, line: 276 },
    children: [ar(text, { size: 19, color: P.secondary })],
  });
}

// ---------- Cover spacing calc (per design-system) ----------
function calcCoverSpacing(params) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 400, pageHeight = 16838, marginTop = 0, marginBottom = 0 } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const remainingSpace = usableHeight - contentHeight;
  const safeRemaining = Math.max(remainingSpace, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

// ---------- Cover R1 — RTL mirror (right-aligned, accent border on right) ----------
function buildCoverR1RTL(config) {
  const C = config.palette;
  const padR = 1200, padL = 800;
  const titlePt = 34; // عنوان عربي سطران — ضمن الميزانية (Rule 8: line = pt*23)
  const titleLines = config.titleLines;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentRight = { style: BorderStyle.SINGLE, size: 8, color: C.accent, space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  // الشعار الإنجليزي بخط سفلي ذهبي
  if (config.englishLabel) {
    children.push(new Paragraph({
      bidirectional: true, alignment: AlignmentType.RIGHT,
      indent: { right: padR, left: padL }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join(" "), size: 18, color: C.accent, font: AR_FONT, characterSpacing: 40 })],
    }));
  }
  // العنوان الرئيسي (سطران بحجم محسوب — Rule 8)
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      bidirectional: true, alignment: AlignmentType.RIGHT,
      indent: { right: padR },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [ar(titleLines[i], { size: titlePt * 2, bold: true, boldComplexScript: true, color: C.cover.titleColor })],
    }));
  }
  // العنوان الفرعي
  if (config.subtitle) {
    children.push(new Paragraph({
      bidirectional: true, alignment: AlignmentType.RIGHT,
      indent: { right: padR, left: padL }, spacing: { after: 800, line: 340, lineRule: "atLeast" },
      children: [ar(config.subtitle, { size: 24, color: C.cover.subtitleColor })],
    }));
  }
  // سطور التعريف بشريط ذهبي يميني (مرآة RTL لـ border.left)
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      bidirectional: true, alignment: AlignmentType.RIGHT,
      indent: { right: padR + 200, left: padL }, spacing: { after: 80, line: 300, lineRule: "atLeast" },
      border: { right: accentRight },
      children: [ar(line, { size: 22, color: C.cover.metaColor })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  // تذييل الغلاف بفاصل علوي ذهبي
  children.push(new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT,
    indent: { right: padR, left: padL },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: C.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      ar(config.footerRight || "", { size: 16, color: C.cover.footerColor }),
      new TextRun({ text: "                                        " }),
      ar(config.footerLeft || "", { size: 16, color: C.cover.footerColor }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: C.bg }, borders: noBorders,
        children,
      })],
    })],
  })];
}
module.exports = { ar, body, h1, h2, dataTable, tableTitle, tableNote, buildCoverR1RTL, allNoBorders, noBorders, P, AR_FONT, fmt$, fmtN, R, BASE, BOOST, CAP48 };
