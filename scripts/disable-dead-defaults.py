#!/usr/bin/env python3
# تثبيت تعطيل الاستراتيجيات الميتة في افتراضات الكود (tamsa-params.ts)
import re
PATH = '/home/z/my-project/src/lib/engine/tamsa-params.ts'
DEAD = ['B','C','D','G','I','J','O','P','Q','R']
src = open(PATH, encoding='utf-8').read()
changed = []
for sid in DEAD:
    m = re.search(rf'\n  {re.escape(sid)}: \{{\n    enabled: true,', src)
    if not m:
        print(f'⚠️ {sid}: لا نمط (ربما معطل أصلاً)')
        continue
    seg = src[m.start():m.start()+120].replace('enabled: true,', 'enabled: false,', 1)
    src = src[:m.start()] + seg + src[m.start()+120:]
    changed.append(sid)
open(PATH, 'w', encoding='utf-8').write(src)
print('عُطّلت:', ','.join(changed))
