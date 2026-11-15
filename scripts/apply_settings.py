#!/usr/bin/env python3
# تطبيق إعدادات المستخدم الحالية: 10 صفقات/يوم + نسبة هدف 1:2 (الدليل)
import json, urllib.request

BASE = 'http://localhost:3000'

def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return json.loads(r.read())

def put(path, data):
    req = urllib.request.Request(BASE + path, data=json.dumps(data).encode(),
                                 headers={'Content-Type': 'application/json'}, method='PUT')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

s = get('/api/settings')['settings']
s['globalRules']['max_daily_trades'] = {'enabled': True, 'value': 10}
s['globalRules']['min_daily_trades_kpi'] = {'enabled': True, 'value': 10}
s['tpRatio'] = 2  # الدليل: الهدف 1:2 افتراضياً (كان 1:1 مخزناً — انحراف)
res = put('/api/settings', {'settings': s})
print('updatedAt:', res.get('updatedAt'))
chk = get('/api/settings')['settings']
print('max_daily_trades =', chk['globalRules']['max_daily_trades'])
print('min_daily_trades_kpi =', chk['globalRules']['min_daily_trades_kpi'])
print('tpRatio =', chk['tpRatio'])
