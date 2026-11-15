#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Strategy Shootout — اختبار مقارن على بيانات MT5 الحقيقية (XAUUSD.m / JustMarkets)

يطبّق نسخاً أمينة (بمعاملاتها المنشورة) لأفضل استراتيجيات مرشحة من بحث GitHub
على نفس بيانات شموع MT5 الحقيقية التي يستخدمها بوت TAMSA، بنفس قواعد المخاطرة:
  - لوت 0.01 (1 أونصة → 1$ لكل 1.0$ حركة سعر)
  - سبريد 30 سنت (0.30$) يخصم من كل صفقة
  - إشارة على إغلاق شمعة i → دخول على افتتاح شمعة i+1 (بلا lookahead)
  - داخل الشمعة: SL له الأولوية على TP (متحفظ، نفس اصطلاح Aurum)

الاستراتيجيات (المصدر):
  1  TSMOM-30d            Aurum (zero-was-here/tradingbot)
  2  EWMAC 32/128         Aurum
  3  Donchian 120/60      Aurum (سلحفاة)
  4  RSI(2)+EMA200        Aurum/Connors
  5  Z-Score Fade         Aurum
  6  Bollinger Revert     Aurum
  7  Vol Squeeze BB/KC    Aurum
  8  ORB London/NY        Aurum (بتوقيت سوريا مثل جلسات TAMSA)
  9  Sunrise Ogle         ilahuerta-IA/backtrader-pullback-window-xauusd
  10 S/R Flip H4          نظرية تبادل الأدوار (فريم كبير)
  11 FVG Retrace H1       FvgGold-EA (مبسّط)

خط الأساس المرجعي: نتيجة باك تيست TAMSA الرسمي (365 يوم) من المحرك نفسه.
الإخراج: جدول طباعة + CSV في download/.
"""
import json
import math
import csv
import datetime as dt
from collections import namedtuple

SNAP = '/home/z/my-project/db/mt5-feed-snapshot.json'
OUT_CSV = '/home/z/my-project/download/strategy-shootout.csv'
SPREAD = 0.30            # 30 سنت لكل صفقة ذهاب-إياب (قاعدة البوت)
SYRIA_MS = 3 * 3600e3
WINDOW_DAYS = 365
RISK_USD_PER_UNIT = 1.0  # 0.01 لوت = 1 أونصة → 1$ لكل 1$ حركة

C = namedtuple('C', 't o h l c v')


# ---------------------------------------------------------------- data
def load_tf(tf):
    d = json.load(open(SNAP))
    return [C(*row) for row in d['tfs'][tf]]


def syria_hour(t):
    return ((t + SYRIA_MS) % 86400e3) / 3600e3


def syria_wd(t):
    return int(((t + SYRIA_MS) // 86400e3) + 4) % 7  # 0=الأحد


# ---------------------------------------------------------- indicators
def ema_series(vals, n):
    out = [None] * len(vals)
    k = 2.0 / (n + 1)
    e = None
    for i, v in enumerate(vals):
        e = v if e is None else v * k + e * (1 - k)
        out[i] = e
    return out


def sma_series(vals, n):
    out = [None] * len(vals)
    s = 0.0
    for i, v in enumerate(vals):
        s += v
        if i >= n:
            s -= vals[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def std_series(vals, n):
    out = [None] * len(vals)
    for i in range(n - 1, len(vals)):
        m = sum(vals[i - n + 1:i + 1]) / n
        var = sum((x - m) ** 2 for x in vals[i - n + 1:i + 1]) / n
        out[i] = math.sqrt(var)
    return out


def atr_series(cs, n=14):
    out = [None] * len(cs)
    trs = []
    for i in range(1, len(cs)):
        c, p = cs[i], cs[i - 1]
        tr = max(c.h - c.l, abs(c.h - p.c), abs(c.l - p.c))
        trs.append(tr)
        if len(trs) > n:
            trs.pop(0)
        if i >= n:
            out[i] = sum(trs) / len(trs)
    return out


def rsi_series(vals, n=2):
    out = [None] * len(vals)
    gains, losses = [], []
    for i in range(1, len(vals)):
        ch = vals[i] - vals[i - 1]
        gains.append(max(ch, 0.0))
        losses.append(max(-ch, 0.0))
        if len(gains) > n:
            gains.pop(0)
            losses.pop(0)
        if len(gains) == n:
            ag = sum(gains) / n
            al = sum(losses) / n
            out[i] = 100.0 if al == 0 else 100.0 - 100.0 / (1.0 + ag / al)
    return out


def roll_max(vals, n, i):   # أعلى قيمة في [i-n, i-1]
    return max(vals[i - n:i])


def roll_min(vals, n, i):
    return min(vals[i - n:i])


# ------------------------------------------------------------- runner
def run(candles, warmup, signals, exit_fn=None, w0t=0, tp_none_ok=True):
    """signals: dict {i: (dir, sl, tp|None)} — قرار على إغلاق i، دخول على افتتاح i+1"""
    trades = []
    eq = [0.0] * len(candles)
    cum = 0.0
    pos = None
    for i in range(warmup, len(candles)):
        c = candles[i]
        closed = None
        if pos is None and signals.get(i - 1) is not None:
            d, sl, tp = signals[i - 1]
            # حماية: لا تدخل بسعر خارج منطق منطق الوقف
            if (d == 1 and c.o > sl) or (d == -1 and c.o < sl):
                pos = dict(dir=d, entry=c.o, sl=sl, tp=tp, i0=i, held=0)
                # فحص داخل شمعة الدخول نفسها — SL أولاً
                if d == 1 and c.l <= sl:
                    closed = (sl, 'sl')
                elif d == 1 and tp is not None and c.h >= tp:
                    closed = (tp, 'tp')
                elif d == -1 and c.h >= sl:
                    closed = (sl, 'sl')
                elif d == -1 and tp is not None and c.l <= tp:
                    closed = (tp, 'tp')
        elif pos is not None:
            pos['held'] += 1
            d = pos['dir']
            if d == 1:
                if c.l <= pos['sl']:
                    closed = (pos['sl'], 'sl')
                elif pos['tp'] is not None and c.h >= pos['tp']:
                    closed = (pos['tp'], 'tp')
                elif exit_fn is not None and exit_fn(i, c, pos):
                    closed = (c.c, 'rule')
            else:
                if c.h >= pos['sl']:
                    closed = (pos['sl'], 'sl')
                elif pos['tp'] is not None and c.l <= pos['tp']:
                    closed = (pos['tp'], 'tp')
                elif exit_fn is not None and exit_fn(i, c, pos):
                    closed = (c.c, 'rule')
        if closed is not None:
            exit_px, why = closed
            raw = (exit_px - pos['entry']) * pos['dir']
            pnl = raw - SPREAD
            risk = abs(pos['entry'] - pos['sl'])
            if candles[pos['i0']].t >= w0t:  # صفقات النافذة فقط (الماضي = تسخين)
                trades.append(dict(
                    entry_t=candles[pos['i0']].t, dir=pos['dir'],
                    entry=pos['entry'], exit=exit_px, risk=risk,
                    pnl=pnl, r=(pnl / risk) if risk > 1e-9 else 0.0,
                    why=why, held=pos['held'] + 1, i_exit=i))
                cum += pnl
            pos = None
        eq[i] = cum
    # صفقة مفتوحة في النهاية تُغلق على آخر إغلاق (لعدّ العادلة)
    if pos is not None:
        c = candles[-1]
        raw = (c.c - pos['entry']) * pos['dir']
        pnl = raw - SPREAD
        risk = abs(pos['entry'] - pos['sl'])
        if candles[pos['i0']].t >= w0t:
            trades.append(dict(entry_t=candles[pos['i0']].t, dir=pos['dir'],
                               entry=pos['entry'], exit=c.c, risk=risk, pnl=pnl,
                               r=pnl / max(risk, 1e-9),
                               why='eod', held=pos['held'] + 1,
                               i_exit=len(candles) - 1))
            cum += pnl
        eq[-1] = cum
    return trades, eq


def metrics(trades, eq, balance=190.81):
    n = len(trades)
    if n == 0:
        return dict(n=0, wins=0, wr=0.0, pf=0.0, net=0.0, dd=0.0, avgr=0.0,
                    exp=0.0, risk=0.0, dd_pct=0.0, minbal=0.0)
    wins = [t for t in trades if t['pnl'] > 0]
    losses = [t for t in trades if t['pnl'] <= 0]
    gw = sum(t['pnl'] for t in wins)
    gl = abs(sum(t['pnl'] for t in losses))
    pf = (gw / gl) if gl > 1e-9 else 99.0
    peak, dd = 0.0, 0.0
    for v in eq:
        peak = max(peak, v)
        dd = max(dd, peak - v)
    net = sum(t['pnl'] for t in trades)
    avgr = sum(t['r'] for t in trades) / n
    risk = sum(t['risk'] for t in trades) / n
    return dict(n=n, wins=len(wins), wr=100.0 * len(wins) / n, pf=pf,
                net=net, dd=dd, avgr=avgr, exp=net / n, risk=risk,
                dd_pct=100.0 * dd / balance, minbal=dd / 0.25)


# ------------------------------------------------------- strategies H1
def sig_tsmom(c1):
    n = 720  # 30 يوم × 24س
    sig, last = {}, 0
    for i in range(n, len(c1)):
        mom = c1[i].c / c1[i - n].c - 1.0
        want = 1 if mom > 0 else -1
        if want != last:
            atr = A1[i]
            if atr:
                sig[i] = (want, c1[i].c - 3 * atr * want, None)
            last = want
    return sig, (lambda i, c, p: (p['dir'] == 1 and c1[i].c / c1[i - n].c - 1 < 0) or
                                  (p['dir'] == -1 and c1[i].c / c1[i - n].c - 1 > 0))


def sig_ewmac(c1):
    e32 = ema_series([x.c for x in c1], 32)
    e128 = ema_series([x.c for x in c1], 128)
    sig, last = {}, 0
    for i in range(128, len(c1)):
        want = 1 if e32[i] > e128[i] else -1
        if want != last:
            atr = A1[i]
            if atr:
                sig[i] = (want, c1[i].c - 3 * atr * want, None)
            last = want
    return sig, (lambda i, c, p: (p['dir'] == 1 and e32[i] < e128[i]) or
                                  (p['dir'] == -1 and e32[i] > e128[i]))


def sig_donchian(c1):
    highs = [x.h for x in c1]
    lows = [x.l for x in c1]
    sig = {}
    for i in range(120, len(c1)):
        atr = A1[i]
        if not atr:
            continue
        if c1[i].c > roll_max(highs, 120, i):
            sig[i] = (1, c1[i].c - 2 * atr, None)
        elif c1[i].c < roll_min(lows, 120, i):
            sig[i] = (-1, c1[i].c + 2 * atr, None)
    return sig, (lambda i, c, p: (p['dir'] == 1 and c.c < roll_min(lows, 60, i)) or
                                  (p['dir'] == -1 and c.c > roll_max(highs, 60, i)))


def sig_rsi2(c1):
    closes = [x.c for x in c1]
    r2 = rsi_series(closes, 2)
    e200 = ema_series(closes, 200)
    sig = {}
    for i in range(200, len(c1)):
        atr = A1[i]
        if not atr or r2[i] is None:
            continue
        if r2[i] < 10 and closes[i] > e200[i]:
            sig[i] = (1, closes[i] - 2 * atr, None)
        elif r2[i] > 90 and closes[i] < e200[i]:
            sig[i] = (-1, closes[i] + 2 * atr, None)
    ex = (lambda i, c, p: (p['dir'] == 1 and (r2[i] > 60 or p['held'] > 60)) or
                          (p['dir'] == -1 and (r2[i] < 40 or p['held'] > 60)))
    return sig, ex


def sig_zfade(c1):
    closes = [x.c for x in c1]
    ma = sma_series(closes, 20)
    sd = std_series(closes, 20)
    sig = {}
    for i in range(20, len(c1)):
        atr = A1[i]
        if not atr or sd[i] in (None, 0):
            continue
        z = (closes[i] - ma[i]) / sd[i]
        num = abs(closes[i] - closes[i - 20])
        den = sum(abs(closes[k] - closes[k - 1]) for k in range(i - 19, i + 1))
        er = num / den if den > 0 else 1.0
        if z > 2.0 and er < 0.35:
            sig[i] = (-1, closes[i] + 2 * atr, None)
        elif z < -2.0 and er < 0.35:
            sig[i] = (1, closes[i] - 2 * atr, None)
    ex = (lambda i, c, p: False if sd[i] in (None, 0) else
          ((closes[i] - ma[i]) / sd[i] < 0.5 if p['dir'] == -1 else
           (closes[i] - ma[i]) / sd[i] > -0.5))
    return sig, ex


def sig_bbrevert(c1):
    closes = [x.c for x in c1]
    ma = sma_series(closes, 20)
    sd = std_series(closes, 20)
    sig = {}
    for i in range(21, len(c1)):
        atr = A1[i]
        if not atr or sd[i] is None:
            continue
        lo_b, up_b = ma[i] - 2 * sd[i], ma[i] + 2 * sd[i]
        lo_p, up_p = ma[i - 1] - 2 * sd[i - 1], ma[i - 1] + 2 * sd[i - 1]
        if closes[i - 1] < lo_p and closes[i] > lo_b:
            sig[i] = (1, closes[i] - 2 * atr, None)
        elif closes[i - 1] > up_p and closes[i] < up_b:
            sig[i] = (-1, closes[i] + 2 * atr, None)
    ex = (lambda i, c, p: c.c >= ma[i] if p['dir'] == 1 else c.c <= ma[i])
    return sig, ex


def sig_squeeze(c1):
    closes = [x.c for x in c1]
    ma = sma_series(closes, 20)
    sd = std_series(closes, 20)
    e20 = ema_series(closes, 20)
    armed_since = {}
    sig = {}
    armed_streak = 0
    for i in range(20, len(c1)):
        atr = A1[i]
        if not atr or sd[i] is None:
            continue
        bb_top, bb_bot = ma[i] + 2 * sd[i], ma[i] - 2 * sd[i]
        kc_top, kc_bot = e20[i] + 1.5 * atr, e20[i] - 1.5 * atr
        squeeze = bb_top < kc_top and bb_bot > kc_bot
        armed_streak = armed_streak + 1 if squeeze else 0
        if armed_streak >= 6 or (0 < armed_streak < 6):
            armed_since[i] = True
        recent_armed = any(armed_since.get(k) for k in range(max(0, i - 5), i + 1))
        if recent_armed and armed_streak == 0:
            if c1[i].c > bb_top:
                sig[i] = (1, closes[i] - 2 * atr, closes[i] + 3 * atr)
            elif c1[i].c < bb_bot:
                sig[i] = (-1, closes[i] + 2 * atr, closes[i] - 3 * atr)
    ex = (lambda i, c, p: c.c < ma[i] if p['dir'] == 1 else c.c > ma[i])
    return sig, ex


def sig_orb(c1):
    """كسر نطاق الافتتاح — لندن (10:00 سوريا) ونيويورك (19:00 سوريا)"""
    sig = {}
    day_state = {}
    for i, c in enumerate(c1):
        h = syria_hour(c.t)
        wd = syria_wd(c.t)
        if wd == 6:
            continue
        day = int((c.t + SYRIA_MS) // 86400e3)
        st = day_state.setdefault(day, dict(done=set(), rng={}))
        # نطاق الافتتاح: ساعة 10 (لندن) وساعة 19 (نيويورك)
        if abs(h - 10.0) < 1e-6:
            st['rng']['lon'] = (c.h, c.l)
        elif abs(h - 19.0) < 1e-6:
            st['rng']['ny'] = (c.h, c.l)
        # نوافذ التداول
        for sess, (h0, h1) in (('lon', (11, 15)), ('ny', (20, 23))):
            if sess in st['rng'] and sess not in st['done'] and h0 <= h < h1:
                rh, rl = st['rng'][sess]
                rng = rh - rl
                if rng <= 0.5:
                    continue
                if c.c > rh:
                    sig[i] = (1, rl, rl + 2.5 * rng)
                    st['done'].add(sess)
                elif c.c < rl:
                    sig[i] = (-1, rh, rh - 2.5 * rng)
                    st['done'].add(sess)
    # خروج زمني بنهاية الجلسة (لندن ≥ 15:00 سوريا، نيويورك ≥ 23:00 سوريا)
    def ex(i, c, p):
        h = syria_hour(c.t)
        he = syria_hour(c1[p['i0']].t)
        return h >= 23 if he >= 20 else h >= 15
    return sig, ex


def sig_ogle(c1):
    """Sunrise Ogle — بولباك ويندو بآلة حالات (EMA 14/18/24، SL 2.5×ATR، TP 12×ATR)
    البولباك: 1-3 شموع تحت EMA14 أثناء اتجاه صاعد، ثم شمعة كسر فوق قمة آخر شمعتين"""
    closes = [x.c for x in c1]
    e14 = ema_series(closes, 14)
    e18 = ema_series(closes, 18)
    e24 = ema_series(closes, 24)
    sig = {}
    pull_up, pull_dn = 0, 0
    for i in range(24, len(c1)):
        atr = A1[i]
        if not atr:
            continue
        up = e14[i] > e18[i] > e24[i]
        dn = e14[i] < e18[i] < e24[i]
        if up:
            if closes[i] < e14[i]:
                pull_up += 1
            else:
                if 1 <= pull_up <= 3 and closes[i] > max(c1[i - 1].h, c1[i - 2].h):
                    sig[i] = (1, closes[i] - 2.5 * atr, closes[i] + 12 * atr)
                pull_up = 0
            pull_dn = 0
        elif dn:
            if closes[i] > e14[i]:
                pull_dn += 1
            else:
                if 1 <= pull_dn <= 3 and closes[i] < min(c1[i - 1].l, c1[i - 2].l):
                    sig[i] = (-1, closes[i] + 2.5 * atr, closes[i] - 12 * atr)
                pull_dn = 0
            pull_up = 0
        else:
            pull_up, pull_dn = 0, 0
    ex = (lambda i, c, p: (p['dir'] == 1 and (closes[i] < e24[i] or p['held'] > 120)) or
                          (p['dir'] == -1 and (closes[i] > e24[i] or p['held'] > 120)))
    return sig, ex


def sig_fvg(c1):
    """FVG retrace مبسّط (روح FvgGold): فجوة 3 شموع مع دفع، دخول عند الرجوع للفجوة، TP 2R"""
    sig = {}
    pend = []  # (side, zone_lo, zone_hi, i_start, atr0)
    for i in range(2, len(c1)):
        atr = A1[i]
        if not atr:
            continue
        # تحديث المعلقات: إبطال أو تأكيد
        still = []
        for (side, zlo, zhi, i0, a0) in pend:
            if i - i0 > 24:
                continue
            c = c1[i]
            if side == 1:
                if c.c < zlo:
                    continue  # أُبطلت
                if c.l <= zhi and c.c >= zlo:
                    slp = zlo - 0.3 * a0
                    sig[i] = (1, slp, c.c + 2.0 * (c.c - slp))
                    continue
            else:
                if c.c > zhi:
                    continue
                if c.h >= zlo and c.c <= zhi:
                    slp = zhi + 0.3 * a0
                    sig[i] = (-1, slp, c.c - 2.0 * (slp - c.c))
                    continue
            still.append((side, zlo, zhi, i0, a0))
        pend = still
        # فجوة صاعدة جديدة: low[i] > high[i-2] وشمعة وسطى دافعة
        if c1[i].l > c1[i - 2].h and abs(c1[i - 1].c - c1[i - 1].o) > 1.2 * atr:
            pend.append((1, c1[i - 2].h, c1[i].l, i, atr))
        elif c1[i].h < c1[i - 2].l and abs(c1[i - 1].c - c1[i - 1].o) > 1.2 * atr:
            pend.append((-1, c1[i - 2].l, c1[i].h, i, atr))
    return sig, None


# ------------------------------------------------- S/R Flip على H4
def sig_flip_h4(c4):
    """تبادل الأدوار: مستوى مقاومة يُكسر ثم يُعاد اختباره من أعلى → شورت (وعكسه لونغ).
    مستوى = قمة/قاع Pivot (±5 شموع). كسر بإغلاق H4 خلف المستوى، إعادة اختبار خلال ≤12 شمعة.
    آلة حالات سريعة: المستويات السليمة تُتتبع تزايدياً — بلا O(n²)."""
    highs = [x.h for x in c4]
    lows = [x.l for x in c4]
    closes = [x.c for x in c4]
    A4 = atr_series(c4, 14)
    n = len(c4)
    # كشف Pivots مسبقاً (pivot مكتمل عند j+5)
    is_pvh = [False] * n
    is_pvl = [False] * n
    for j in range(5, n - 5):
        if highs[j] >= max(highs[j - 5:j]) and highs[j] >= max(highs[j + 1:j + 6]):
            is_pvh[j] = True
        if lows[j] <= min(lows[j - 5:j]) and lows[j] <= min(lows[j + 1:j + 6]):
            is_pvl[j] = True
    sig = {}
    pend_flip = []          # (side, level, i_break, a0) بانتظار إعادة الاختبار
    intact_res, intact_sup = [], []  # مستويات سليمة لم تُكسر بعد
    for i in range(6, n):
        atr = A4[i]
        if not atr:
            continue
        # 1) إدارة المعلقة: إعادة اختبار أو إبطال
        still = []
        for (side, lv, ib, a0) in pend_flip:
            if i - ib > 12:
                continue  # انتهت نافذة إعادة الاختبار
            c = c4[i]
            if side == -1:  # مقاومة سابقة تُختبر من أعلى
                if c.c > lv + 0.5 * a0:
                    continue  # فشل التبادل
                if c.h >= lv and c.c < lv:
                    slp = max(c.h, lv) + 0.5 * a0
                    sig[i] = (-1, slp, c.c - 2.0 * (slp - c.c))
                    continue
            else:  # دعم سابق يُختبر من أسفل
                if c.c < lv - 0.5 * a0:
                    continue
                if c.l <= lv and c.c > lv:
                    slp = min(c.l, lv) - 0.5 * a0
                    sig[i] = (1, slp, c.c + 2.0 * (c.c - slp))
                    continue
            still.append((side, lv, ib, a0))
        pend_flip = still
        # 2) تسجيل Pivots المكتملة حديثاً (j = i-5)
        j = i - 5
        if j >= 5:
            if is_pvh[j]:
                intact_res.append((j, highs[j]))
            if is_pvl[j]:
                intact_sup.append((j, lows[j]))
        # 3) كسور جديدة هذه الشمعة: أول إغلاق خلف مستوى سليم
        if pend_flip is not None:
            k_res = [lv_r for lv_r in intact_res if closes[i] > lv_r[1]]
            if k_res:
                for (j2, lv) in k_res:
                    pend_flip.append((-1, lv, i, atr))
                intact_res = [r for r in intact_res if r not in k_res]
            k_sup = [lv_s for lv_s in intact_sup if closes[i] < lv_s[1]]
            if k_sup:
                for (j2, lv) in k_sup:
                    pend_flip.append((1, lv, i, atr))
                intact_sup = [s for s in intact_sup if s not in k_sup]
    return sig, None


# ---------------------------------------------------------------- main
def evaluate(defs, c1, c4, w0, tag, A1_global_ok=True):
    rows = []
    eqs = {}
    for name, src, (sig, ex) in defs:
        c = c4 if name.startswith('S/R') else c1
        warm = 30 if name.startswith('S/R') else 800
        tr, eq = run(c, warm, sig, ex, w0t=w0)
        m = metrics(tr, eq)
        rows.append(dict(name=f'{name} [{src}]', src=src, window=tag, **m))
        eqs[name] = (c, eq)
    return rows, eqs


def main():
    c1 = load_tf('1h')
    c4 = load_tf('4h')
    global A1
    A1 = atr_series(c1, 14)
    last_t = c1[-1].t
    w0_365 = last_t - WINDOW_DAYS * 86400e3
    w0_730 = last_t - 730 * 86400e3
    print(f"1h: {len(c1)} شمعة | آخر شمعة: {dt.datetime.fromtimestamp(last_t/1000, dt.UTC):%Y-%m-%d}")

    defs = [
        ('TSMOM-30d', 'Aurum', sig_tsmom(c1)),
        ('EWMAC 32/128', 'Aurum', sig_ewmac(c1)),
        ('Donchian 120/60', 'Aurum', sig_donchian(c1)),
        ('RSI(2)+EMA200', 'Aurum', sig_rsi2(c1)),
        ('Z-Score Fade', 'Aurum', sig_zfade(c1)),
        ('Bollinger Revert', 'Aurum', sig_bbrevert(c1)),
        ('Vol Squeeze', 'Aurum', sig_squeeze(c1)),
        ('ORB London/NY', 'Aurum', sig_orb(c1)),
        ('Sunrise Ogle', 'ilahuerta-IA', sig_ogle(c1)),
        ('FVG Retrace', 'FvgGold-EA', sig_fvg(c1)),
        ('S/R Flip H4', 'تبادل الأدوار', sig_flip_h4(c4)),
    ]

    rows365, eqs365 = evaluate(defs, c1, c4, w0_365, '365يوم')
    rows730, eqs730 = evaluate(defs, c1, c4, w0_730, '730يوم')

    all_rows = []
    # خط الأساس TAMSA (من باك تيست المحرك الرسمي 365 يوم)
    all_rows.append(dict(name='TAMSA-18 (خط الأساس الرسمي)', src='المحرك الحالي',
                         window='365يوم', n=11, wins=5, wr=45.45, pf=1.54,
                         net=18.70, dd=22.60, avgr=0.475, exp=1.70,
                         risk=8.0, dd_pct=11.8, minbal=90.4))
    all_rows += rows365
    # مرجع سوق 365يوم
    start_px = next(x.o for x in c1 if x.t >= w0_365)
    bh = (c1[-1].c - start_px) - SPREAD
    all_rows.append(dict(name='Buy&Hold (مرجع السوق فقط)', src='—', window='365يوم',
                         n=1, wins=1, wr=100.0, pf=99.0, net=bh, dd=0.0,
                         avgr=bh, exp=bh, risk=0.0, dd_pct=0.0, minbal=0.0))
    all_rows += rows730

    def table(tag):
        print(f"\n===== النافذة {tag} =====")
        hdr = (f"{'الاستراتيجية':<36}{'صفقات':>6}{'نجاح%':>7}{'PF':>7}{'صافي$':>9}"
               f"{'DD$':>8}{'DD%رصيد':>9}{'خطر/صفقة$':>10}{'الرصيداللزم$':>12}")
        print(hdr)
        print('-' * len(hdr))
        for r in [x for x in all_rows if x['window'] == tag]:
            print(f"{r['name']:<36}{r['n']:>6}{r['wr']:>7.1f}{r['pf']:>7.2f}"
                  f"{r['net']:>9.1f}{r['dd']:>8.1f}{r['dd_pct']:>9.0f}"
                  f"{r['risk']:>10.1f}{r['minbal']:>12.0f}")

    table('365يوم')
    table('730يوم')

    # سلة أفضل 3 (TSMOM + Donchian + EWMAC) — منحنيات مدمجة على فريم 1h
    combo = [0.0] * len(c1)
    for k in ('TSMOM-30d', 'Donchian 120/60', 'EWMAC 32/128'):
        eqk = eqs365[k][1]
        for i, v in enumerate(eqk):
            combo[i] += v
    peak, dd = 0.0, 0.0
    for v in combo:
        peak = max(peak, v)
        dd = max(dd, peak - v)
    netc = combo[-1]
    print(f"\nسلة أفضل-3 (TSMOM+Donchian+EWMAC) 365يوم: صافي={netc:.1f}$ أقصىDD={dd:.1f}$"
          f" ({100 * dd / 190.81:.0f}% من رصيد 190$ | رصيد لازم ≈{dd / 0.25:.0f}$)")

    with open(OUT_CSV, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['strategy', 'source', 'window', 'trades', 'wins', 'winrate_%',
                    'profit_factor', 'net_pnl_usd(0.01lot)', 'maxDD_usd',
                    'DD_%_of_190', 'avg_risk_usd_per_trade', 'avg_R', 'min_balance_usd'])
        for r in all_rows:
            w.writerow([r['name'], r['src'], r['window'], r['n'], r['wins'],
                        round(r['wr'], 2), round(r['pf'], 2), round(r['net'], 2),
                        round(r['dd'], 2), round(r['dd_pct'], 1),
                        round(r['risk'], 1), round(r['avgr'], 3),
                        round(r['minbal'], 0)])
    print(f"\nCSV → {OUT_CSV}")


if __name__ == '__main__':
    main()
