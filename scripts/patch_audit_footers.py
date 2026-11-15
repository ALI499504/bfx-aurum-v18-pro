#!/usr/bin/env python3
# Patch footers: Roman for TOC section, arabic for body; strip empty pgNumType (WPS compat)
import re, shutil, sys, zipfile, os

SRC = "/home/z/my-project/download/تقرير_فحص_بوت_BFX_AURUM.docx"
TMP = "/tmp/audit_docx_patch"

if os.path.exists(TMP):
    shutil.rmtree(TMP)
os.makedirs(TMP)
with zipfile.ZipFile(SRC) as z:
    z.extractall(TMP)

doc_path = os.path.join(TMP, "word", "document.xml")
with open(doc_path, encoding="utf-8") as f:
    doc = f.read()

# 1) remove empty pgNumType emitted for sections without pageNumbers
doc = doc.replace("<w:pgNumType/>", "")

# 2) ordered footerReference rIds (cover has none → 1st = TOC/Roman, 2nd = body/arabic)
rids = re.findall(r'<w:footerReference w:type="default" r:id="(rId\d+)"', doc)
print("footerReference order:", rids)

rels_path = os.path.join(TMP, "word", "_rels", "document.xml.rels")
with open(rels_path, encoding="utf-8") as f:
    rels = f.read()
rid2file = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="(footer\d+\.xml)"', rels))
print("rid map:", rid2file)

def patch_footer(fname, fmt):
    fpath = os.path.join(TMP, "word", fname)
    with open(fpath, encoding="utf-8") as f:
        x = f.read()
    x2 = re.sub(r'(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)',
                r'\1 PAGE \\* ' + fmt + r' \\* MERGEFORMAT \2', x)
    changed = x2 != x
    with open(fpath, "w", encoding="utf-8") as f:
        f.write(x2)
    print(f"patched {fname} -> {fmt} (changed={changed})")

seen = []
for rid in rids:
    fname = rid2file.get(rid)
    if fname and fname not in seen:
        seen.append(fname)
if len(seen) >= 1:
    patch_footer(seen[0], "ROMAN")
for fname in seen[1:]:
    patch_footer(fname, "arabic")

with open(doc_path, "w", encoding="utf-8") as f:
    f.write(doc)

# rezip
out = SRC
tmpzip = "/tmp/audit_patched.docx"
if os.path.exists(tmpzip):
    os.remove(tmpzip)
with zipfile.ZipFile(tmpzip, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(TMP):
        for fn in files:
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, TMP)
            z.write(full, rel)
shutil.move(tmpzip, out)
print("REPACKED OK ->", out)
