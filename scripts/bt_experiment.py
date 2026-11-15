#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
تجارب الباك تست على بيانات MT5 الحقيقية:
- يقرأ إعدادات القاعدة الحالية، يطبّق patch (JSON ملف)، يشغّل POST /api/backtest
- يطبع: صفقات/يوم، نسبة الربح، PF، صافي، أسباب الحظر، أفضل الاستراتيجيات
Usage: python3 bt_experiment.py patch.json [label]
"""
import sqlite3, json, sys, time, urllib.request, datetime

DB = '/home/z/my-project/db/custom.db'
API = 'http://localhost:3000/api/backtest'

def load_settings():
    con = sqlite3.connect(DB)
    row = con.execute("SELECT json FROM BotSettings WHERE key='main'").fetchone()
    con.close()
    return json.loads(row[0])

def save_settings(s):
    con = sqlite3.connect(DB)
    # Prisma يخزن DateTime كعدد صحيح ms — أي نص هنا يكسر قراءة الصف ويرجع الافتراضيات بصمت!
    con.execute("UPDATE BotSettings SET json=?, updatedAt=? WHERE key='main'",
                (json.dumps(s, ensure_ascii=False), int(time.time() * 1000)))
    con.commit(); con.close()
    # تحقق فوري أن الصف يبقى قابلاً للقراءة بصيغته الجديدة
    con = sqlite3.connect(DB)
    row = con.execute("SELECT updatedAt, typeof(updatedAt) FROM BotSettings WHERE key='main'").fetchone()
    con.close()
    assert row[1] == 'integer', f'updatedAt ليس integer: {row}'

def run_bt():
    t0 = time.time()
    req = urllib.request.Request(API, data=b'{}', headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=280) as r:
        d = json.loads(r.read().decode())
    d['_wall'] = round(time.time() - t0, 1)
    return d

def summarize(d, label=''):
    st = d['stats']
    days = max(1, (st['endT'] - st['startT']) / 86400e3)
    # أيام تداول فعلية (تقريباً: أيام الأسبوع عدا السبت)
    tpday = st['totalTrades'] / (days * 5 / 7)
    print(f"--- {label} ---")
    print(f"wall={d.get('_wall')}s runMs={d.get('runMs')}")
    print(f"الفترة: {datetime.datetime.fromtimestamp(st['startT']/1000, datetime.UTC):%Y-%m-%d} → {datetime.datetime.fromtimestamp(st['endT']/1000, datetime.UTC):%Y-%m-%d} ({days:.0f} يوم تقويمي)")
    print(f"صفقات: {st['totalTrades']} | رابحة: {st['wins']} | خاسرة: {st['losses']} | WR={st['winRate']:.1f}%")
    print(f"صفقات/يوم تداول≈{tpday:.1f} | صافي={st['netPnl']:.0f}$ | PF={st['profitFactor']:.2f} | DD={st['maxDrawdownPct']:.1f}%")
    print(f"إشارات: {st.get('signalsCount')} | محظورة: {st.get('fillsBlocked')}")
    blk = st.get('blocked') or {}
    if blk:
        top = sorted(blk.items(), key=lambda x: -x[1])[:8]
        print('أسباب الحظر:', ', '.join(f'{k}={v}' for k, v in top))
    m = st.get('strategyTotals') or {}
    rows = sorted(m.items(), key=lambda kv: -kv[1]['trades'])
    print('أفضل الاستراتيجيات (صفقات | WR% | صافي$):')
    for k, v in rows[:10]:
        if v['trades']:
            print(f"  {k}: {v['trades']} | {v['winRate']:.0f}% | {v['net']:+.0f}$")
    oos = st.get('oos') or {}
    print(f"OOS(آخر30%): صفقات={oos.get('trades')} WR={oos.get('winRate',0):.0f}% avgR={oos.get('avgR',0):.2f}")
    print()

if __name__ == '__main__':
    label = sys.argv[2] if len(sys.argv) > 2 else 'exp'
    s = load_settings()
    if len(sys.argv) > 1 and sys.argv[1] != '-':
        patch = json.load(open(sys.argv[1]))
        def deep_merge(a, b):
            for k, v in b.items():
                if isinstance(v, dict) and isinstance(a.get(k), dict):
                    deep_merge(a[k], v)
                else:
                    a[k] = v
        deep_merge(s, patch)
        save_settings(s)
        print(f"[تم تطبيق التعديل على القاعدة]")
    d = run_bt()
    json.dump(d, open('/tmp/bt_last.json', 'w'))
    summarize(d, label)
