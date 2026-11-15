#!/usr/bin/env python3
"""تفعيل هدف ~20 صفقة/يوم — تعديل الإعدادات التي كانت تمنع بلوغ العدد:
- تعطيل بروتوكول الصفقة الواحدة (كان يجبر البوت على صفقة واحدة متزامنة فقط)
- رفع الصفقات المتوازية إلى 6
- السماح بتعزيز نفس الاستراتيجية حتى 3 صفقات متزامنة
- تعطيل هدف الربح اليومي (كان يوقف اليوم عند +100$ قبل إكمال 20 صفقة)
يبقى محفوظاً: حد الخسارة اليومي 100$، max_daily_trades=20، بوابة الجودة 56."""
import sqlite3, json, sys

DB = '/home/z/my-project/db/custom.db'
con = sqlite3.connect(DB)
cur = con.cursor()
cur.execute("SELECT json FROM BotSettings WHERE key='main'")
d = json.loads(cur.fetchone()[0])
gr = d['globalRules']

before = {
    'single_trade': gr['single_trade']['enabled'],
    'max_concurrent': gr['max_concurrent']['value'],
    'no_stacking_hedge_value': gr['no_stacking_hedge']['value'],
    'daily_profit_stop': gr['daily_profit_stop']['enabled'],
}

gr['single_trade']['enabled'] = False          # كان: صفقة واحدة متزامنة فقط
gr['max_concurrent']['value'] = 6              # كان: 2
gr['no_stacking_hedge']['value'] = 3           # كان: 0 (صفقة واحدة لكل استراتيجية) — الآن حتى 3 متزامنة
gr['daily_profit_stop']['enabled'] = False     # كان: يوقف اليوم عند +100$ قبل إكمال 20 صفقة

cur.execute("UPDATE BotSettings SET json=? WHERE key='main'", (json.dumps(d, ensure_ascii=False),))
con.commit()
after = {
    'single_trade': gr['single_trade']['enabled'],
    'max_concurrent': gr['max_concurrent']['value'],
    'no_stacking_hedge_value': gr['no_stacking_hedge']['value'],
    'daily_profit_stop': gr['daily_profit_stop']['enabled'],
}
print('قبل:', before)
print('بعد:', after)
print('يبقى كما هو: max_daily_trades =', gr['max_daily_trades']['value'],
      '| daily_loss_stop =', gr['daily_loss_stop']['value'],
      '| quality_gate =', gr['quality_gate']['value'])
con.close()
