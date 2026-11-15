#!/usr/bin/env python3
# ترقيم الصفحات (المخطط القياسي: الغلاف مخفي، المتن يبدأ من 1، صفحة الختام الخلفية بلا رقم)
# + البيانات الوصفية
import io
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from pypdf import PdfReader, PdfWriter

SRC = '/home/z/my-project/download/strategy-analysis-gold-bot.pdf'
W, H = 540, 765.12

reader = PdfReader(SRC)
n = len(reader.pages)
writer = PdfWriter()

for i, page in enumerate(reader.pages):
    # الصفحة 1 = الغلاف (بلا رقم) | الصفحة الأخيرة = الختام الخلفي (بلا رقم)
    if 0 < i < n - 1:
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(W, H))
        c.setFont('Helvetica', 8.5)
        c.setFillColor(HexColor('#7f7c75'))
        c.drawCentredString(W / 2, 16, str(i))  # المتن يبدأ من 1
        c.save()
        buf.seek(0)
        overlay = PdfReader(buf).pages[0]
        page.merge_page(overlay)
    writer.add_page(page)

writer.add_metadata({
    '/Title': 'تشريح أداء استراتيجيات بوت تداول الذهب XAUUSD — النجاح والفشل وخطة التحويل',
    '/Author': 'Z.ai',
    '/Creator': 'Z.ai',
    '/Subject': 'تحليل أداء 26 استراتيجية تداول ذهب: أسباب النجاح والخسارة وخطة تحويل الفشل إلى نجاح (باك تيست 17.4 شهراً، أساس 1000 دولار)',
})
with open(SRC, 'wb') as f:
    writer.write(f)
print(f'OK: numbered pages 2..{n-1} as 1..{n-2}, metadata set, total {n} pages')
