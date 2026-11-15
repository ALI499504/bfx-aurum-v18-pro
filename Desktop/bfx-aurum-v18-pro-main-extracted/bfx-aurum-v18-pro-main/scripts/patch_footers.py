#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Post-process: footer instrText format switches + strip empty pgNumType (WPS compat)
import zipfile, shutil, re, sys

src = "/home/z/my-project/download/تقرير-اللوت-الثابت-وسقف-الاحتفاظ.docx"
tmp = "/tmp/report_docx_patch"
shutil.rmtree(tmp, ignore_errors=True)
with zipfile.ZipFile(src) as z:
    z.extractall(tmp)

# 1) document.xml: find sectPr order -> map footers to sections via rIds
doc_path = f"{tmp}/word/document.xml"
doc = open(doc_path, encoding="utf-8").read()

# Strip empty pgNumType (cover section emits <w:pgNumType/> without attrs)
doc2 = re.sub(r"<w:pgNumType/>", "", doc)
open(doc_path, "w", encoding="utf-8").write(doc2)

# 2) Identify footer refs per section: sectPr blocks in order
sects = re.findall(r"<w:sectPr.*?</w:sectPr>", doc2, re.S)
print("sections:", len(sects))
fmts = []
for s in sects:
    if 'w:fmt="upperRoman"' in s:
        fmts.append("roman")
    elif 'w:fmt="decimal"' in s:
        fmts.append("arabic")
    else:
        fmts.append(None)
print("section formats:", fmts)

# footer rIds per section
rel = open(f"{tmp}/word/_rels/document.xml.rels", encoding="utf-8").read()
rid2file = dict(re.findall(r'Id="([^"]+)"[^>]*Target="(footer\d+\.xml)"', rel))
plan = {}
for i, s in enumerate(sects):
    for rid in re.findall(r'<w:footerReference[^>]*r:id="([^"]+)"', s):
        f = rid2file.get(rid)
        if f and fmts[i]:
            plan[f] = fmts[i]
print("patch plan:", plan)

for fname, kind in plan.items():
    p = f"{tmp}/word/{fname}"
    xml = open(p, encoding="utf-8").read()
    switch = "ROMAN" if kind == "roman" else "arabic"
    xml2 = re.sub(r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
                  rf"\1 PAGE \\* {switch} \\* MERGEFORMAT \2", xml)
    changed = xml2 != xml
    open(p, "w", encoding="utf-8").write(xml2)
    print(f"{fname}: patched={changed} -> {switch}")

# repack
out = src
import os
zout = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)
for root, _, files in os.walk(tmp):
    for f in files:
        full = os.path.join(root, f)
        arc = os.path.relpath(full, tmp)
        zout.write(full, arc)
zout.close()
print("repacked", out)
