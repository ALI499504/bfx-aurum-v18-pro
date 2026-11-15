#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# إصلاح ازدواج أول مدخل في جدول المحتويات (أثر إدخال العناصر النائبة)
# 1) حقن رقم الصفحة المخبأ داخل حقل PAGEREF للمدخل الأول
# 2) حذف صف العنصر النائب المكرر لـ«أولاً»
import zipfile, shutil, re, os, sys

src = "/home/z/my-project/download/تقرير-اللوت-الثابت-وسقف-الاحتفاظ.docx"
tmp = "/tmp/report_docx_toc"
shutil.rmtree(tmp, ignore_errors=True)
with zipfile.ZipFile(src) as z:
    z.extractall(tmp)

doc_path = f"{tmp}/word/document.xml"
xml = open(doc_path, encoding="utf-8").read()

# --- 1) المدخل الأول داخل الحقل: استبدال حقل PAGEREF المتعثر برقم ثابت «1» ---
# البنية بعد الحقن السابق: begin dirty + PAGEREF _Toc1 + separate + 1 + end
pat = (r'<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/>'
       r'<w:instrText[^>]*>PAGEREF _Toc1 \\h</w:instrText>'
       r'<w:fldChar w:fldCharType="separate"/>'
       r'(?:<w:r><w:t>1</w:t></w:r>)?'
       r'<w:fldChar w:fldCharType="end"/></w:r>')
xml2, n1 = re.subn(pat, r'<w:r><w:t>1</w:t></w:r>', xml)
print("PAGEREF replaced with static 1:", n1)

# --- 2) احذف صف العنصر النائب المكرر (TOC1 يحوي أولاً + <w:t>1</w:t> وليس فقرة الحقل) ---
# صف العنصر النائب: <w:tabs> ... w:pos="9026" ... + النص + tab + 1
dup_pat = r'<w:p><w:pPr><w:pStyle w:val="TOC1"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9026"/></w:tabs><w:spacing w:before="120" w:after="60"/></w:pPr><w:r><w:t>أولاً: الملخص التنفيذي</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>1</w:t></w:r></w:p>'
xml3, n2 = re.subn(dup_pat, '', xml2)
print("duplicate placeholder row removed:", n2)

if n1 != 1 or n2 > 1:
    print("UNEXPECTED pattern counts — aborting without write")
    sys.exit(1)

open(doc_path, "w", encoding="utf-8").write(xml3)

zout = zipfile.ZipFile(src, "w", zipfile.ZIP_DEFLATED)
for root, _, files in os.walk(tmp):
    for f in files:
        full = os.path.join(root, f)
        zout.write(full, os.path.relpath(full, tmp))
zout.close()
print("repacked", src)
