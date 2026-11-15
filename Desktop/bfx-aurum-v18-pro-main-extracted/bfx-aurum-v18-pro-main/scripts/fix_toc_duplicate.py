#!/usr/bin/env python3
# Fix TOC duplicate first entry:
# 1) give the structural entry's PAGEREF sub-field a visible result ("1")
# 2) remove the injected plain duplicate of entry 1
import os, re, shutil, zipfile

SRC = "/home/z/my-project/download/تقرير_فحص_بوت_BFX_AURUM.docx"
TMP = "/tmp/toc_fix"

if os.path.exists(TMP):
    shutil.rmtree(TMP)
os.makedirs(TMP)
with zipfile.ZipFile(SRC) as z:
    z.extractall(TMP)

p = os.path.join(TMP, "word", "document.xml")
x = open(p, encoding="utf-8").read()

# 1) sub-field separate+end (adjacent, unique to PAGEREF result slot) -> insert visible "1"
before = x
x = x.replace('<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/>',
              '<w:fldChar w:fldCharType="separate"/><w:r><w:t>1</w:t></w:r><w:fldChar w:fldCharType="end"/>',
              1)
print("PAGEREF result inserted:", x != before)

# 2) remove injected plain duplicate paragraph of entry 1 (no hyperlink, literal tab + 1)
dup = re.search(
    r'<w:p><w:pPr><w:pStyle w:val="TOC1"/>(?:(?!</w:p>).)*?<w:t>1\. &#1575;&#1604;&#1605;&#1604;&#1582;&#1589;[^<]*</w:t>(?:(?!</w:p>).)*?</w:p>',
    x)
if dup is None:
    # direct literal with raw Arabic
    dup = re.search(
        r'<w:p><w:pPr><w:pStyle w:val="TOC1"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9026"/></w:tabs><w:spacing w:before="120" w:after="60"/></w:pPr><w:r><w:t>1\. الملخص التنفيذي</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>1</w:t></w:r></w:p>',
        x)
if dup:
    x = x.replace(dup.group(0), "", 1)
    print("duplicate entry removed: True")
else:
    print("duplicate entry removed: NOT FOUND")

open(p, "w", encoding="utf-8").write(x)

out = "/tmp/toc_fixed.docx"
if os.path.exists(out):
    os.remove(out)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(TMP):
        for fn in files:
            full = os.path.join(root, fn)
            z.write(full, os.path.relpath(full, TMP))
shutil.move(out, SRC)
print("REPACKED ->", SRC)
