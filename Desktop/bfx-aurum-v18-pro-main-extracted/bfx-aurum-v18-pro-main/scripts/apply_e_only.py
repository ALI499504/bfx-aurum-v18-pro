#!/usr/bin/env python3
"""تطبيق الوضع الحصري: استراتيجية E (الأرقام المئوية النفسية) فقط — طلب المستخدم الصريح.
تبقى جلسات E كما ضبطها المستخدم (كل الجلسات الأربع)، وكل الاستراتيجيات الأخرى تُطفأ."""
import sqlite3, json, sys

DB = '/home/z/my-project/db/custom.db'
con = sqlite3.connect(DB)
cur = con.cursor()
cur.execute("SELECT json FROM BotSettings WHERE key='main'")
row = cur.fetchone()
if not row:
    print('ERROR: no settings row'); sys.exit(1)
d = json.loads(row[0])
old = {k: [s for s, v in cfg.items() if v] for k, cfg in d['sessions'].items()}

for k in d['sessions']:
    if k == 'Z':
        continue  # مستويات يدوية — للعرض فقط
    if k == 'E':
        continue  # تبقى جلساتها كما ضبطها المستخدم
    for s in ('asia', 'london', 'londonNY', 'ny'):
        d['sessions'][k][s] = False

cur.execute("UPDATE BotSettings SET json=? WHERE key='main'", (json.dumps(d, ensure_ascii=False),))
con.commit()
con.row_factory = sqlite3.Row
cur.execute("SELECT json FROM BotSettings WHERE key='main'")
new = json.loads(cur.fetchone()[0])['sessions']
print('قبل:', json.dumps(old, ensure_ascii=False))
print('بعد:', json.dumps({k: [s for s, v in cfg.items() if v] for k, cfg in new.items()}, ensure_ascii=False))
con.close()
