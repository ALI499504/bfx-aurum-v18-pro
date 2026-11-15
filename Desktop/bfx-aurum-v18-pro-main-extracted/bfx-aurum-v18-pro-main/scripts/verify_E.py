#!/usr/bin/env python3
# التحقق من الاستراتيجية E المعاد بناؤها حرفياً: تفعيل مؤقت → باك تيست → إعادة الحالة الأصلية
import json, urllib.request, time

BASE = 'http://localhost:3000'

def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return json.loads(r.read())

def put(path, data):
    req = urllib.request.Request(BASE + path, data=json.dumps(data).encode(),
                                 headers={'Content-Type': 'application/json'}, method='PUT')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

orig = get('/api/settings')['settings']
saved_e = dict(orig['sessions']['E'])
try:
    s = json.loads(json.dumps(orig))
    s['sessions']['E'] = {'asia': True, 'london': True, 'londonNY': True, 'ny': True}
    put('/api/settings', {'settings': s})
    time.sleep(1)
    req = urllib.request.Request(BASE + '/api/backtest', data=b'{}',
                                 headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=300) as r:
        d = json.loads(r.read())
    res = d.get('result', d)
    trades = [t for t in res['trades'] if t['strategy'] == 'E']
    print('صفقات E:', len(trades))
    if trades:
        wins = sum(1 for t in trades if t['pnl'] > 0)
        print('WR:', round(wins/len(trades)*100, 1), '% | net:', round(sum(t['pnl'] for t in trades), 1))
        sls = sorted(set(round(abs(t['entry']-t['sl']), 1) for t in trades))
        tps = sorted(set(round(abs(t['tp']-t['entry']), 1) for t in trades))
        print('مسافات الوقف ($):', sls[:6], '| مسافات الهدف ($):', tps[:6])
        # مستويات الدخول يجب أن تكون على أرقام تنتهي بـ00 أو قربها بـ4$ (قبل الرقم بـ40 بيب)
        from collections import Counter
        ends = Counter(abs(t['entry']) % 100 for t in trades)
        print('أشهر بقايا السعرmod 100:', ends.most_common(5))
        print('نموذج سبب:', trades[0]['reason'][:110])
finally:
    orig['sessions']['E'] = saved_e
    put('/api/settings', {'settings': orig})
    print('أعيدت E إلى حالتها المخزنة:', saved_e)
