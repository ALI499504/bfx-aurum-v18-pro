# -*- coding: utf-8 -*-
"""BFX AURUM v13-CLEAN HTML builder — strips strategy/rules/trades/forecast UI
from index.src.html, keeps the terminal shell (header, chart, toolbar,
alerts, sessions, side-panel shell)."""
import re, sys

SRC = '/home/z/my-project/work/BFX-AURUM-v12/source/index.src.html'
OUT = '/home/z/my-project/work/BFX-AURUM-v13/index.html'

src = open(SRC, encoding='utf-8').read()
lines = src.split('\n')

def rep1(old, new, s=None, label=''):
    s = src if s is None else s
    n = s.count(old)
    if n != 1:
        print('FATAL [%s]: expected 1 occurrence, found %d for: %r' % (label, n, old[:100]))
        sys.exit(1)
    return s.replace(old, new)

def drop_blocks(text, prefixes):
    """Remove CSS blocks whose trimmed line starts with any prefix.
    Handles multi-line blocks via brace balance."""
    out, i = [], 0
    lines_ = text.split('\n')
    removed = []
    while i < len(lines_):
        t = lines_[i].strip()
        hit = None
        if t and not t.startswith('/*') and not t.startswith('*'):
            for p in prefixes:
                if t.startswith(p) and (len(t) == len(p) or not (t[len(p)].isalnum() or t[len(p)] == '-')):
                    hit = p
                    break
        if hit:
            # collect until braces balance (or single line without brace)
            depth = 0
            j = i
            started = False
            while j < len(lines_):
                depth += lines_[j].count('{') - lines_[j].count('}')
                if '{' in lines_[j]:
                    started = True
                j += 1
                if started and depth <= 0:
                    break
            removed.append((hit, i + 1, j))
            i = j
        else:
            out.append(lines_[i])
            i += 1
    print('CSS blocks removed:', len(removed))
    for p, a, b in removed[:60]:
        print('   L%d-%d  %s' % (a, b, p))
    return '\n'.join(out)

# ---------- 1) title + meta ----------
src = rep1(
 '<title>BFX AURUM v12.13 PROPHET — تيرمنال الذهب اللحظي من MetaTrader 5 · تنبؤ مدرَّب على 2010-2026 · 12 شمعة مستقبلية بنطاق ثقة</title>',
 '<title>BFX AURUM v13 — تيرمنال الذهب اللحظي من MetaTrader 5 (هيكل نظيف جاهز للاستراتيجيات الجديدة)</title>',
 label='title')
src = rep1(
 '<meta name="description" content="تيرمنال XAUUSD احترافي: شموع MT5 لحظية، تنبؤ PROPHET-ML لـ 12 شمعة قادمة بنطاق ثقة كمّي، سبع استراتيجيات مدمجة، محرك قواعد 1000$ — نموذج مدرَّب على 17 سنة من بيانات M1 الحقيقية.">',
 '<meta name="description" content="تيرمنال XAUUSD احترافي: شموع MT5 لحظية، 9 فريمات، تنبيهات سعر، جلسات التداول، اتصال ذكي بالجسر والسحابة — هيكل نظيف بلا استراتيجيات، جاهز لبناء القواعد والاستراتيجيات الجديدة.">',
 label='meta')

# ---------- 2) app.js version + sw version ----------
src = rep1('<script src="app.js?v=1247" defer></script>',
           '<script src="app.js?v=1300" defer></script>', label='appjs-v')
src = rep1("navigator.serviceWorker.register('/sw.js?v=1211')",
           "navigator.serviceWorker.register('/sw.js?v=1300')", label='sw-v')

# ---------- 3) boot splash + brand + haltBanner ----------
src = rep1(
 '<div style="color:#8fa3c8;font-size:14px">جارٍ تحميل تيرمنال الذهب الاحترافي — PROPHET-ML&hellip; لحظات ويصلك السعر اللحظي</div>',
 '<div style="color:#8fa3c8;font-size:14px">جارٍ تحميل تيرمنال الذهب&hellip; لحظات ويصلك السعر اللحظي</div>', label='splash')
src = rep1(
 '<span class="bname">BFX <b>AURUM</b><small>PROPHET v12.0 &mdash; تنبؤ مدرَّب على بيانات 2010-2026 &middot; 12 شمعة مستقبلية بنطاق ثقة كمّي &middot; سبع استراتيجيات مدمجة &middot; الشرح الكامل بزر «؟»</small></span>',
 '<span class="bname">BFX <b>AURUM</b><small>v13 &mdash; تيرمنال الذهب اللحظي من MetaTrader 5 &middot; أسعار وسيطك الحقيقية بلا أي وسيط بديل</small></span>', label='brand')
src = rep1('<div id="haltBanner"></div>\n\n', '', label='haltBanner-div')

# ---------- 4) remove mpModal (explanations modal for the 7 strategies) ----------
a = src.index('<div id="mpModal">')
b = src.index('</div>\n  </div>\n', a)  # end of modal container (box + list)
# safer: find the closing of mpModal by brace-like structure: it ends before "  <div class=\"toolbar\">"
b = src.index('  <div class="toolbar">', a)
src = src[:a] + src[b:]
print('mpModal removed')

# ---------- 5) profCtl strategy buttons -> only generic tools remain ----------
prof = re.search(r'    <div class="profCtl" id="profCtl">.*?</div>\n', src, re.S)
if not prof:
    print('FATAL: profCtl block not found'); sys.exit(1)
src = src[:prof.start()] + src[prof.end():]
print('profCtl block removed')

# ---------- 6) fpHint + wait text ----------
src = rep1('    <div id="fpHint">فوتربرنت: قرّب الشارت (＋) — القراءة الدقيقة تحتاج أقل من 46 شمعة</div>\n', '', label='fpHint')
src = rep1(
 '<div id="wait">بانتظار البيانات الحية من ميتاتريدر 5&hellip;<br><span style="font-size:12px">شغّل BFX_START.bat من حزمة v12 على جهاز MT5 — سيفتح المتصفح تلقائياً عند وصول الأسعار</span></div>',
 '<div id="wait">بانتظار البيانات الحية من ميتاتريدر 5&hellip;<br><span style="font-size:12px">شغّل BFX_START.bat على جهاز MT5 — سيفتح المتصفح تلقائياً عند وصول الأسعار</span></div>', label='wait')

# ---------- 7) fcWrap -> statusBar ----------
fc = re.search(r'  <div id="fcWrap">.*?</div><!-- /chartsCol -->', src, re.S)
if not fc:
    print('FATAL: fcWrap block not found'); sys.exit(1)
statusbar = '''  <div id="statusBar">
    <span id="fakebadge" style="display:none"></span>
    <span id="symSrc"></span>
    <span id="upd">آخر تحديث: &mdash;</span>
    <span id="lat" title="زمن استجابة قناة البيانات الحية">&mdash;</span>
  </div>
  </div><!-- /chartsCol -->'''
src = src[:fc.start()] + statusbar + src[fc.end():]
print('fcWrap -> statusBar')

# ---------- 8) side panel -> clean placeholder ----------
a = src.index('<aside id="aiPanel">')
b = src.index('</aside>') + len('</aside>')
placeholder = '''<aside id="aiPanel">
  <div class="psec">
    <div class="pttl"><i></i>BFX AURUM v13 — الهيكل الأساسي</div>
    <div class="panelNote">
      <b>القشرة جاهزة — بلا أي منطق تداول.</b><br>
      التيرمنال يعمل الآن بالبنية التحتية فقط: أسعار MT5 الحقيقية، الشموع
      بجميع الفريمات، خط السعر الحي، تنبيهات السعر، تظليل الجلسات، والاتصال
      الذكي (جسر مباشر ← ريلي سحابي ← قناة السوق ← محاكاة صريحة).<br>
      <b>أُزيل بالكامل:</b> محرك PROPHET-ML والنموذج المدرَّب، الاستراتيجيات
      السبع (بروفايل/فوتربرنت/وايكوف/برس أكشن/استبدال الأدوار/مستويات
      D-W-M/الكسر الكاذب)، محرك القواعد، سجل الصفقات، والباك تيست.<br>
      <b>الخطوة التالية:</b> هذه اللوحة فارغة عن قصد — القواعد والاستراتيجيات
      الجديدة ستُبنى هنا من جديد فوق نفس البنية.
    </div>
  </div>
</aside>'''
src = src[:a] + placeholder + src[b:]
print('side panel -> placeholder')

# ---------- 9) fsBar without signal chip ----------
src = rep1('  <span class="fsPx up" id="fsPx">&mdash;</span>\n  <span class="fsSig sell" id="fsSig">&mdash;</span>\n',
           '  <span class="fsPx up" id="fsPx">&mdash;</span>\n', label='fsSig')
src = rep1('title="طيّ اللوحة الجانبية — شاشة الشموع والتنبؤ بعرض الشاشة كاملاً"',
           'title="طيّ اللوحة الجانبية — الشموع بعرض الشاشة كاملاً"', label='panelBtn-title')

# ---------- 10) CSS surgery ----------
# fix mainWrap ratio (fcWrap gone -> main chart takes the whole column)
src = rep1('#mainWrap{flex:1 1 calc(50% - 52px);position:relative;min-height:0}',
           '#mainWrap{flex:1 1 auto;position:relative;min-height:0}', label='mainWrap-ratio')
src = rep1('  #mainWrap{flex:1 1 calc(50% - 52px)}\n  #fcWrap{flex:1 1 calc(50% + 52px)}\n  #fcWrap{min-height:280px}\n',
           '  #mainWrap{flex:1 1 auto}\n', label='mainWrap-media')
src = rep1('  #mainWrap{min-height:420px;flex:0 0 auto;height:52vh}',
           '  #mainWrap{min-height:420px;flex:0 0 auto;height:72vh}', label='mainWrap-mobile')

# drop CSS blocks of removed components
src = drop_blocks(src, [
    '#haltBanner', '#mpModal', '#fpHint', '#pTabs', '.ptb',
    '#fcWrap', '#fcChart', '#fcHead', '#fcOvl', '#fcDecide', '.fstat',
    '#tradesHead', '#tradesFeed',
    '#btCards', '.btc', '.seg', '.btflt', '.btr', '.whyli', '.agg',
    '.vwrap', '.ringbox', '.ring-bg', '.ring-fg', '.ringnum',
    '.vdir', '.vsub', '.vplan', '.prob', '.meter',
    '.comp', '.chip', '.rst',
    '.tcard', '.trow', '.tsym', '.tdir', '.tmut', '.tprofit',
    '.elog', '.et', '.esym', '.edir',
    '.reg', '.rico', '.rmain', '.rname', '.rdesc', '.rlive',
    '.rrow', '.rnote', '.swx', '.lock', '.wt',
    '.ppane', '#classicToggle', '#classicPanel',
    '.pcstrip', '.pc', '.rbar', '.knote',
    '#rulesBox', '#engStat', '#verdictBox', '#mlBox', '#fcBox', '#statBox',
    '#accBox', '#posList', '#logList', '#sigList', '#wyBox', '#paBox',
    '#rrBox', '#krBox', '#fbBox', '#btBox', '#rlList', '#rlStat',
    '#indList', '#indLive', '#stList',
])

# wait: #engStat/#accBox etc were still used? renderEngStat writes to #engStat —
# but the side panel placeholder no longer contains engStat, so rules are dead. OK.

# ---------- 11) add new CSS after #mainWrap rule ----------
src = rep1(
 '#mainWrap{flex:1 1 auto;position:relative;min-height:0}',
 '''#mainWrap{flex:1 1 auto;position:relative;min-height:0}
/* v13 CLEAN: شريط الحالة أسفل الشارت — بديل شاشة التنبؤ المحذوفة */
#statusBar{flex:0 0 20px;display:flex;align-items:center;gap:12px;
  padding:0 10px;font-size:9px;color:var(--mut);
  background:rgba(13,18,30,.55);border-top:1px solid var(--line);
  white-space:nowrap;overflow:hidden;direction:rtl}
#statusBar:empty{display:none}
#statusBar #fakebadge{color:var(--warn);font-weight:700}
#statusBar #fakebadge.live{color:var(--up)}
#statusBar #fakebadge.web{color:var(--gold)}
#statusBar #symSrc{color:var(--dim)}
#statusBar #lat.ok{color:var(--up)}
#statusBar #lat.mid{color:var(--gold)}
#statusBar #lat.bad{color:var(--dn)}
/* v13 CLEAN: بطاقة اللوحة الفارغة الجاهزة للاستراتيجيات الجديدة */
.panelNote{font-size:11px;color:var(--mut);line-height:2.1;padding:4px 0}
.panelNote b{color:var(--gold)}''', label='statusBar-css')

open(OUT, 'w', encoding='utf-8').write(src)
print('OK — wrote', OUT, '(%d lines)' % src.count('\n'))
