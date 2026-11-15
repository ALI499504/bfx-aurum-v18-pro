#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""فحص صحة شامل للبوت — الجسر، التنفيذ، الدستور، الأوامر الحية، التنبيهات"""
import json, urllib.request

BASE = 'http://localhost:3000'
TOKEN = 'bfx-aurum-mt5-v1'
def get(path, auth=False):
    try:
        req = urllib.request.Request(BASE + path)
        if auth:
            req.add_header('x-bfx-token', TOKEN)
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {'ERROR': str(e)}

ok = lambda b: 'PASS' if b else 'FAIL'
print('=' * 72)
print('BFX AURUM — الفحص الصحي الشامل')
print('=' * 72)

# 1) الجسر الحي
s = get('/api/mt5/status')
conn = s.get('connected') is True
acc = s.get('account') or {}
tick = s.get('tick') or {}
print(f"\n[1] جسر MT5: {ok(conn)}  connected={s.get('connected')} v={s.get('bridgeV')} symbol={s.get('symbol')}")
print(f"    الحساب: {acc.get('login')} @ {acc.get('server')} | رصيد=${acc.get('balance')} | عدالة=${acc.get('equity')}")
print(f"    آخر تيك: bid={tick.get('bid')} ask={tick.get('ask')}")

# 2) النبض اللحظي
t = get('/api/mt5/tick')
print(f"\n[2] نبض السعر: {ok(t.get('connected') is True)}  price={t.get('price')} spread={t.get('spread')}")

# 3) الأوامر الحية + محرك التنفيذ (بتوثيق الجسر)
o = get('/api/mt5/orders', auth=True)
if 'ERROR' in o:
    print(f"\n[3] محرك التنفيذ: FAIL — {o['ERROR']}")
else:
    print(f"\n[3] محرك التنفيذ: {ok(o.get('ok') is True)}  enabled={o.get('enabled')} feedFresh={o.get('feedFresh')}")
    cfg = o.get('config') or {}
    print(f"    config: {json.dumps(cfg, ensure_ascii=False)[:220]}")
    st = o.get('state') or {}
    print(f"    الحالة: open={st.get('openCount')} working={st.get('workingCount')}")
    for w in (o.get('workingOrders') or []):
        print(f"    أمر عامل: {json.dumps(w, ensure_ascii=False)[:180]}")
    for p in (o.get('open') or []):
        print(f"    صفقة مفتوحة: {json.dumps(p, ensure_ascii=False)[:180]}")

# 4) الإعدادات الدستورية (مفاتيح فعلية)
g = get('/api/settings')
gr = ((g.get('settings') or {}).get('globalRules')) or {}
print(f"\n[4] الإعدادات الدستورية:")
print(f"    التأمين (قاعدة 20): {ok('insurance' not in gr)} — محذوف كلياً من الدستور (مفاتيح القواعد: {len(gr)})")
msl = gr.get('mandatory_sl') or {}
print(f"    سقف الوقف 15$: {ok(msl.get('enabled') is True and msl.get('value') == 15)} value={msl.get('value')}$ = 150 بيب")
fl = gr.get('fixed_lot') or {}
print(f"    اللوت الثابت: {ok(fl.get('enabled') is True and fl.get('value') == 0.01)} raw={json.dumps(fl, ensure_ascii=False)[:100]}")
mh = gr.get('max_hold_hours') or {}
print(f"    Time Stop 72h: {ok(mh.get('enabled') is True and mh.get('value') == 72)} raw={json.dumps(mh, ensure_ascii=False)[:100]}")
sl_ = gr.get('symbol_lock') or {}
print(f"    قفل الرمز XAUUSD: {ok(sl_.get('enabled') is True)} raw={json.dumps(sl_, ensure_ascii=False)[:100]}")
nm = gr.get('no_martingale') or {}
print(f"    حظر المارتينجيل: {ok(nm.get('enabled') is True)} raw={json.dumps(nm, ensure_ascii=False)[:100]}")
cc = gr.get('max_concurrent') or {}
print(f"    التزامن الأقصى 4: {ok(cc.get('enabled') is True and cc.get('value') == 4)} raw={json.dumps(cc, ensure_ascii=False)[:100]}")

# 5) المستويات الحية على الحساب (ما ترسمه الواجهة)
ac = get('/api/mt5/account')
ll = ac.get('liveLevels') or []
print(f"\n[5] المستويات الحية من الحساب ({len(ll)}):")
for l in ll:
    print(f"    {json.dumps(l, ensure_ascii=False)[:170]}")

# 6) التنبيهات الحية الأخيرة
a = get('/api/alerts?limit=4')
alerts = a.get('alerts') or []
print(f"\n[6] آخر التنبيهات ({len(alerts)}):")
for x in alerts[:4]:
    print(f"    #{x.get('id')} [{x.get('kind')}] {str(x.get('title'))[:70]}")

# 7) عقل القرار
d = get('/api/forecast?tf=15m')
dec = d.get('decision') or {}
stc = d.get('structure') or {}
print(f"\n[7] عقل القرار (15m): dir={dec.get('dir')} conf={dec.get('confidence')}% pUp={round((dec.get('pUpOverall') or 0)*100,1)}% trend={stc.get('trend')}")

# 8) صحة النظام
h = get('/api/system/health')
print(f"\n[8] صحة النظام: status={h.get('status')} uptime={round((h.get('uptimeSec') or 0)/3600,1)}h cycles={h.get('cycles')} heals={h.get('heals')}")

print('\n' + '=' * 72)
print('انتهى الفحص')
print('=' * 72)
