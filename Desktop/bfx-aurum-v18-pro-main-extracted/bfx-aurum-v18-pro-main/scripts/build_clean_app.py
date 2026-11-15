# -*- coding: utf-8 -*-
"""BFX AURUM v13-CLEAN builder — surgically strips engine/strategies/rules/trades
from app.src.js while keeping the price/chart/connection infrastructure intact."""
import re, sys

SRC = '/home/z/my-project/work/BFX-AURUM-v12/source/app.src.js'
OUT = '/home/z/my-project/work/BFX-AURUM-v13/app.js'

lines = open(SRC, encoding='utf-8').read().split('\n')
# lines[] is 0-based; original file line N == lines[N-1]

def seg(a, b):
    """original lines a..b inclusive"""
    return lines[a-1:b]

HEADER = """'use strict';
/* ============================================================
   BFX AURUM v13 — CLEAN SHELL (هيكل نظيف)
   ============================================================
   تيرمنال الذهب XAUUSD — البنية التحتية فقط، بلا أي منطق تداول:
   * أسعار MT5 الحقيقية (جسر محلي + ريلي سحابي + قناة السوق) وكل
     مسارات الاتصال والتعافي التلقائي كما هي.
   * شارت شموع كامل (9 فريمات) + فوليوم + خط السعر الحي + قراءة OHLC
     + عدّاد إغلاق الشمعة + تنبيهات سعر + تظليل الجلسات + ملء الشاشة.
   * أُزيل بالكامل: محرك PROPHET-ML، الاستراتيجيات السبع، محرك
     القواعد، سجل الصفقات، الباك تيست، تنبؤ الشموع المستقبلية.
   * اللوحة الجانبية فارغة عن قصد — القواعد والاستراتيجيات الجديدة
     تُبنى هنا من جديد فوق هذه القشرة.
   ============================================================ */
"""

CORE_OVERLAY = """/* ---------------------------------------------------- طبقة الرسم فوق الشارت
   v13 CLEAN: مساحة رسم عامة فوق الشارت — تُظلّل جلسات التداول الآن
   (زر SES)، وتبقى جاهزة لأي رسم تضيفه الاستراتيجيات الجديدة لاحقاً */
var ovlC = $('ovl'), ovlX = ovlC ? ovlC.getContext('2d') : null;
var OVL_PAD_R = 74;
function ovlSize(){
  var wrap = $('mainWrap'), W = wrap.clientWidth, H = wrap.clientHeight;
  if (ovlC.width !== W*2 || ovlC.height !== H*2){ ovlC.width = W*2; ovlC.height = H*2; }
  ovlX.setTransform(2,0,0,2,0,0);
  ovlX.clearRect(0,0,W,H);
  return {W:W, H:H};
}
function drawOverlay(){
  /* v13: درع الرسم — التنظيف يحدث في ovlSize، والطبقات الفعلية
     (جلسات التداول الآن، وأي طبقات قادمة) تُرسم فوقه */
  try{ ovlSize(); }catch(e){}
}
window.addEventListener('resize', function(){ try{ drawOverlay(); }catch(e){} });

"""

FOLD_ENGINE = """/* ============ v11.71 PRO LAYOUT ENGINE — تنظيم احترافي للوحة الجانبية ============
   كل قسم قابل للطي بالضغط على عنوانه، والحالة محفوظة في localStorage.
   v13 CLEAN: بقي الميكانيزم العام فقط — الأقسام الجديدة القادمة ترثه تلقائياً */
(function(){
  var saved = {};
  try{ saved = JSON.parse(localStorage.getItem('bfx_fold_v11') || '{}'); }catch(e){}
  var state = {};
  var secs = document.querySelectorAll('#aiPanel .psec');
  for (var i = 0; i < secs.length; i++){
    var sec = secs[i];
    var ttl = sec.querySelector('.pttl');
    var box = sec.querySelector('[id]');
    var k = box ? box.id : null;
    if (!ttl || !k || ttl.querySelector('.ptxt')) continue;   /* idempotent */
    var txt = document.createElement('span');
    txt.className = 'ptxt';
    while (ttl.firstChild) txt.appendChild(ttl.firstChild);
    ttl.appendChild(txt);
    var ch = document.createElement('span');
    ch.className = 'chev'; ch.textContent = '▾';
    ttl.appendChild(ch);
    ttl.classList.add('fhead');
    ttl.title = 'اضغط للطي / الفتح';
    state[k] = (k in saved) ? !!saved[k] : false;
    if (state[k]) sec.classList.add('folded');
    (function(sec, k, ttl){
      ttl.addEventListener('click', function(){
        state[k] = !state[k];
        sec.classList.toggle('folded', state[k]);
        try{ localStorage.setItem('bfx_fold_v11', JSON.stringify(state)); }catch(e){}
        if (typeof drawOverlay === 'function') setTimeout(drawOverlay, 60);
      });
    })(sec, k, ttl);
  }
})();

/* v11.74/v11.76: اكتمل تحليل التطبيق — أزل شاشة الإقلاع */
try{ var bsp = document.getElementById('bootSplash');
     if (bsp) bsp.parentNode.removeChild(bsp); }catch(e){}
"""

out = []
out.append(HEADER)
# ---- CORE: fetchT .. applyDigits (20-269), indicators (271-290) dropped below
core = seg(20, 269)
out.append('\n'.join(core).rstrip() + '\n')
out.append('')

# --- fmt / fitRange (generic number + chart-fit helpers, were inside the old engine block)
out.append('\n'.join(seg(519, 535)).rstrip() + '\n')

out.append('\n' + CORE_OVERLAY)

# ---- legendRowHTML + drawReal (3679-3754) with strips
draw_real = '\n'.join(seg(3679, 3754))
draw_real = draw_real.replace("""  st.rKey = k; st.rLen = lc.length;
  /* v12.35: لحظية كاملة — آخر شمعة ماضية في شاشة التنبؤ تُحدَّث بنفس
     التكة المرسومة على الشارت الحقيقي (كانت تنتظر إعادة حساب التنبؤ
     حتى 1.5 ثانية) — فتمشي الشاشتان جنباً إلى جنب تكة-ب-تكة، وبعدها
     يعيد المحرك حساب الشموع المستقبلية كل 1.5 ثانية أو مع شمعة جديدة */
  if (fcAnchor){ try{ fcAnchor.update(lc[lc.length-1]); }catch(e){} }
  /* live bid line""", """  st.rKey = k; st.rLen = lc.length;
  /* live bid line""")
draw_real = draw_real.replace("""  /* SL / TP levels from the REAL-chart signal */
  var sig = st.sig;
  if (plSL){ candle.removePriceLine(plSL); plSL = null; }
  if (plTP){ candle.removePriceLine(plTP); plTP = null; }
  if (sig && sig.dir !== 'wait' && sig.atr > 0){
    var dirUp = sig.dir === 'buy';
    plSL = candle.createPriceLine({price: dirUp ? sig.close-1.5*sig.atr : sig.close+1.5*sig.atr,
      color:'#f6465d', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'SL'});
    plTP = candle.createPriceLine({price: dirUp ? sig.close+3*sig.atr : sig.close-3*sig.atr,
      color:'#2ebd85', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'TP'});
  }
  st.prevPx = last.close;
  try{ drawOverlay(); }catch(e){}   /* v11.71: حماية مربع المعلومات والسعر أعلى الشارت */
  var ai = '';
  if (st.proj && st.sig){
    var dt = st.sig.dir==='buy' ? 'شراء' : (st.sig.dir==='sell' ? 'بيع' : 'انتظار');
    ai = '<div class="lg3"><b>AI</b> ' + dt + ' ' +
         (st.sig.conf*100).toFixed(0) + '% → ' + fmt(st.proj.end) + '</div>';
  }
  /* v10.21: the EMA legend row (lg2) is gone together with the lines
     v12.17.2: سطر OHLC ملوّن موحّد (يشارك قراءة التمرير نفسها) */
  var rb = bars[bars.length-1];
  $('legend').innerHTML =
    '<div class="lg1">' + legendRowHTML(rb, rb[5]) + '</div>' + ai;
  $('upd').textContent = 'آخر تحديث: ' + new Date().toLocaleTimeString('ar-EG');
  drawProj(bars);
}""", """  st.prevPx = last.close;
  /* v12.17.2: سطر OHLC ملوّن موحّد (يشارك قراءة التمرير نفسها) */
  var rb = bars[bars.length-1];
  $('legend').innerHTML =
    '<div class="lg1">' + legendRowHTML(rb, rb[5]) + '</div>';
  $('upd').textContent = 'آخر تحديث: ' + new Date().toLocaleTimeString('ar-EG');
  try{ drawOverlay(); }catch(e){}   /* جلسات التداول + أي طبقات قادمة */
}""")
out.append(draw_real.rstrip() + '\n')

# ---- krow (3965-3967)
out.append('\n/* ------------------------------------------------------- helpers --- */\n' +
           '\n'.join(seg(3965, 3967)).rstrip() + '\n')

# ---- updateTicker + updateChips (4971-5015)
out.append('\n' + '\n'.join(seg(4971, 5015)).rstrip() + '\n')

# ---- demo feed + jget + startDemo/stopDemo (5017-5135) with strips
demo = '\n'.join(seg(5017, 5135))
demo = demo.replace("""  var mtd = $('modeTxt'); if (mtd) mtd.textContent = 'وضع المحاكاة';
  if ($('simBanner')) $('simBanner').style.display='none';
  if (!LOCAL && $('hostNote')) $('hostNote').style.display='block';
  updateSrcPill('demo');""", """  var mtd = $('modeTxt'); if (mtd) mtd.textContent = 'وضع المحاكاة';
  if ($('simBanner')) $('simBanner').style.display='none';
  updateSrcPill('demo');""")
demo = demo.replace("""  st.acc = {acc:{login:0, server:'DEMO-SERVER', balance:10000,
                 equity:10000, currency:'USD'}, positions:[]};
  renderAcc();
  rulesDemoSeed();   /* v11.00: بذرة خبر تجريبي لعرض حالة الأخبار */
  setBridge(true, '');""", """  st.acc = {acc:{login:0, server:'DEMO-SERVER', balance:10000,
                 equity:10000, currency:'USD'}, positions:[]};
  setBridge(true, '');""")
demo = demo.replace("""  st.acc = null;
  st.srv = 0;
  var ab = $('accBox'); if (ab) ab.innerHTML = '<div class="empty">—</div>';
}""", """  st.acc = null;
  st.srv = 0;
}""")
out.append('\n' + demo.rstrip() + '\n')

# ---- MKT-FEED (5136-5277) with strips
mkt = '\n'.join(seg(5136, 5277))
mkt = mkt.replace("""          if (DEMO) stopDemo();
          st.acc = null;
          renderAcc();
          setBridge(true, '');""", """          if (DEMO) stopDemo();
          st.acc = null;
          setBridge(true, '');""")
mkt = mkt.replace("""          drawReal(true);
          updateSignalCard();
          updateTicker();""", """          drawReal(true);
          updateTicker();""")
out.append('\n' + mkt.rstrip() + '\n')

# ---- ALWAYS-ON (5279-5309)
out.append('\n' + '\n'.join(seg(5279, 5309)).rstrip() + '\n')

# ---- WEBTF (5311-6410) with strips
webtf = '\n'.join(seg(5311, 6410))
webtf = webtf.replace("""      st.digits = 2; st.spread = null;
      applyDigits();
      if (st.sig === null) st.sig = computeSignal(j.bars);
      updateSignalCard();
      drawReal(true);
      updateTicker();""", """      st.digits = 2; st.spread = null;
      applyDigits();
      drawReal(true);
      updateTicker();""")
webtf = webtf.replace("""      if (j.tick && j.tick.bid){ st.bid = j.tick.bid; st.ask = j.tick.ask; }
      applyDigits();
      if (st.sig === null) st.sig = computeSignal(j.bars);
      updateSignalCard();
      drawReal(true);
      updateTicker();""", """      if (j.tick && j.tick.bid){ st.bid = j.tick.bid; st.ask = j.tick.ask; }
      applyDigits();
      drawReal(true);
      updateTicker();""")
webtf = webtf.replace("""function refreshData(){
  /* recompute the strategy + redraw the ONE unified screen */
  updateSignalCard();
  drawReal(false);
  updateTicker();
}""", """function refreshData(){
  /* redraw the ONE unified screen (chart + ticker + overlay) */
  drawReal(false);
  updateTicker();
}""")
webtf = webtf.replace("""      if (m.symbols){ st.resolved = m.symbols; updateSymSrc(); }
      st.acc = m;
      renderAcc();
    }""", """      if (m.symbols){ st.resolved = m.symbols; updateSymSrc(); }
      st.acc = m;
    }""")
webtf = webtf.replace("""buildTabs();
buildTfBar();
applyDigits();
st.digits = SYMBOLS[st.sym].digits;
applyDigits();
renderSigList();   /* v10.3: empty-state for the signals journal */""", """buildTabs();
buildTfBar();
applyDigits();
st.digits = SYMBOLS[st.sym].digits;
applyDigits();""")
webtf = webtf.replace("""    if (j.acc){ st.acc = j.acc; renderAcc(); }
    if (j.srv){ st.srv = j.srv; st.srvAt = Date.now(); }
    var tk3 = j.tick && j.tick[st.sym];""", """    if (j.acc){ st.acc = j.acc; }
    if (j.srv){ st.srv = j.srv; st.srvAt = Date.now(); }
    var tk3 = j.tick && j.tick[st.sym];""")
webtf = webtf.replace("""  if (j.acc){ st.acc = j.acc; renderAcc(); }
  if (j.srv){ st.srv = j.srv; st.srvAt = Date.now(); }
  var t = j.tick && j.tick[st.sym];""", """  if (j.acc){ st.acc = j.acc; }
  if (j.srv){ st.srv = j.srv; st.srvAt = Date.now(); }
  var t = j.tick && j.tick[st.sym];""")
webtf = webtf.replace("""  blobFetch(function(){
    updateSignalCard();
    drawReal(true);
    updateTicker();
  });""", """  blobFetch(function(){
    drawReal(true);
    updateTicker();
  });""")
webtf = webtf.replace("""    var m0 = $('modeTxt'); if (m0) m0.textContent = 'غير متصل';
    if ($('hostNote') && !LOCAL) $('hostNote').style.display='block';
    updateSrcPill('demo');""", """    var m0 = $('modeTxt'); if (m0) m0.textContent = 'غير متصل';
    updateSrcPill('demo');""")
webtf = webtf.replace("""    if ($('webWarn')) $('webWarn').style.display='none';
    if ($('hostNote')) $('hostNote').style.display='none';
    updateSrcPill('real', st.resolved && st.resolved[st.sym]);""", """    if ($('webWarn')) $('webWarn').style.display='none';
    updateSrcPill('real', st.resolved && st.resolved[st.sym]);""")
webtf = webtf.replace("""    if ($('webWarn')) $('webWarn').style.display='block';
    if ($('hostNote') && !LOCAL) $('hostNote').style.display='block';
    updateSrcPill('web');""", """    if ($('webWarn')) $('webWarn').style.display='block';
    updateSrcPill('web');""")
webtf = webtf.replace("""    if ($('webWarn')) $('webWarn').style.display='none';
    if ($('hostNote') && !LOCAL) $('hostNote').style.display='none';
    updateSrcPill('web', null,""", """    if ($('webWarn')) $('webWarn').style.display='none';
    updateSrcPill('web', null,""")
webtf = webtf.replace("""      st.rKey=''; st.rLen=0; st.pKey=''; st.pLen=0; st.spread=null;""",
"""      st.rKey=''; st.rLen=0; st.spread=null;""")
webtf = webtf.replace("""  st.rKey=''; st.rLen=0; st.pKey=''; st.pLen=0;
  loadHistory();""", """  st.rKey=''; st.rLen=0;
  loadHistory();""")
out.append('\n' + webtf.rstrip() + '\n')

# ---- fold engine + splash removal
out.append('\n' + FOLD_ENGINE)

# ---- PRO TOUCH (7079-7339) verbatim
out.append('\n' + '\n'.join(seg(7079, 7339)).rstrip() + '\n')

out.append('\n/* ============ نهاية القشرة النظيفة — القواعد والاستراتيجيات الجديدة تُبنى فوق هذا الملف ============ */\n')

result = '\n'.join(out)

# ---- in-place edits on the CORE segment as exact-string replacements:
def rep(old, new, count=1):
    global result
    n = result.count(old)
    if n != count:
        print('FATAL: expected %d occurrence(s), found %d for:\n%r' % (count, n, old[:160]))
        sys.exit(1)
    result = result.replace(old, new, count)

# 1) remove fcChart creation + observers inside initCharts (lines 215-256)
rep("""/* v10.20: the dedicated FORECAST PANE — the AI future-candles drawing in
   its own chart directly under the real MT5 candles (user request). */
fcChart = LightweightCharts.createChart($('fcChart'),
  chartOpts({visible:true, text:'PROPHET', color:'rgba(217,180,92,.035)',
             fontSize:30, fontFamily:'Segoe UI, Tahoma, Arial'}));
/* v12.18b: الماضي باهت أكثر ليبرز المستقبل — والشموع المستقبلية بلون
   الاتجاه الكامل الوضوح (أخضر/أحمر صريح) داخل المنطقة الذهبية المظللة */
fcAnchor = fcChart.addCandlestickSeries({
  upColor:'rgba(46,189,133,.28)', downColor:'rgba(246,70,93,.28)',
  borderVisible:true, borderUpColor:'rgba(46,189,133,.48)',
  borderDownColor:'rgba(246,70,93,.48)',
  wickUpColor:'rgba(46,189,133,.30)', wickDownColor:'rgba(246,70,93,.30)',
  /* v12.18d: وسم آخر شمعة ماضية مخفي — كان يتكرر مع وسم الهدف فيسببان التباساً */
  lastValueVisible:false, priceLineVisible:false});
fcCandle = fcChart.addCandlestickSeries({
  upColor:'#2ebd85', downColor:'#f6465d',
  borderVisible:true, borderUpColor:'#3ad696',
  borderDownColor:'#ff6b7a',
  wickUpColor:'rgba(46,189,133,.85)', wickDownColor:'rgba(246,70,93,.85)'});
/* v12.18b: خطا الحد المنقّطان أُخفيا تماماً — كانا فوضى بصرية؛
   نطاق الثقة يُقرأ من التظليل المتدرج وحده (البيانات تبقى تتحدث
   لأن رسم النطاق يحتاج إحداثياتهما) */
fcHi = fcChart.addLineSeries({color:'rgba(217,180,92,.7)', lineWidth:1,
  lineStyle:2, visible:false, lastValueVisible:false, priceLineVisible:false});
fcLo = fcChart.addLineSeries({color:'rgba(217,180,92,.7)', lineWidth:1,
  lineStyle:2, visible:false, lastValueVisible:false, priceLineVisible:false});
/* v12.30: ملء شاشة التنبؤ — هوامش أضيق للمقياس السعري تُزيل الفراغ
   الأسود أسفل الشموع والمخروط (كان المحتوى يشغل ~66% من الشاشة فقط)
   fcHi/fcLo يشاركان في autoscale فالمخروط يتبع المقياس بلا أي قصّ
   v12.32: هوامش أدنى (3%/1.5%) — المحتوى يصل شبه حتى المحور الزمني */
fcChart.priceScale('right').applyOptions({scaleMargins:{top:0.03, bottom:0.015}});

/* v12.17.2: إعادة رسم نطاق الثقة و«الآن» عند التحريك/التكبير/تغيّر الحجم */
try{
  fcChart.timeScale().subscribeVisibleTimeRangeChange(function(){ if (typeof fcQueueDraw==='function') fcQueueDraw(); });
  fcChart.timeScale().subscribeVisibleLogicalRangeChange(function(){ if (typeof fcQueueDraw==='function') fcQueueDraw(); });
}catch(e){}
if (typeof ResizeObserver !== 'undefined' && $('fcWrap')){
  try{ new ResizeObserver(function(){ if (typeof fcQueueDraw==='function') fcQueueDraw(); }).observe($('fcWrap')); }catch(e){}
}else{
  window.addEventListener('resize', function(){ if (typeof fcQueueDraw==='function') fcQueueDraw(); });
}

  /* plLive/plSL/plTP معرّفة عالمياً خارج هذه الدالة (ترسم لاحقاً) */
}""", """  /* plLive معرّفة عالمياً خارج هذه الدالة (ترسم لاحقاً) */
}""")

# 2) series var declarations
rep("var mainChart, candle, volS, fcChart, fcAnchor, fcCandle, fcHi, fcLo;",
    "var mainChart, candle, volS;")
rep("var plLive=null, plSL=null, plTP=null;   /* خطوط السعر الحي و SL/TP — عالمية */",
    "var plLive=null;                        /* خط السعر الحي — عالمي */")

# 3) applyDigits without the forecast series
rep("""function applyDigits(){
  if (!candle || !fcCandle || !fcAnchor) return;  /* v12: بعد تهيئة الشارت فقط */
  var pf = priceFmt();
  candle.applyOptions({priceFormat:pf});
  fcCandle.applyOptions({priceFormat:pf});
  fcAnchor.applyOptions({priceFormat:pf});
}""", """function applyDigits(){
  if (!candle) return;                            /* بعد تهيئة الشارت فقط */
  candle.applyOptions({priceFormat:priceFmt()});
}""")

# 4) (EMA/RSI helpers at lines 271-290 are already excluded by the seg(20,269) cut)

# 5) trim engine state fields from st
rep("""  digits:2, spread:null, sig:null, proj:null, projAt:0, projBase:0,
  rKey:'', rLen:0, pKey:'', pLen:0, prevPx:0, maxx:false,""",
    """  digits:2, spread:null,
  rKey:'', rLen:0, prevPx:0, maxx:false,""")

open(OUT, 'w', encoding='utf-8').write(result)
print('OK — wrote', OUT, '(%d lines)' % result.count('\n'))
