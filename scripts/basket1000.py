#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""السلة على أساس حساب 1000$ — تنفيذ خطة المحرك القوي (خطوة 1+2+3 من الخطة)

المكونات:
  1. TSMOM-30d   (اتجاه) — دخول فقط في وضع الاتجاه (بوابة ER)
  2. Sunrise Ogle (اتجاه/بولباك) — دائماً مسموحة (تربح في النظامين)
  3. S/R Flip H4 (تبادل أدوار) — دخول فقط في الوضع العرضي + قاطع أعادة اختراق
  + خط الأساس TAMSA-18 (من المحرك الرسمي)

البوابة: ER (نسبة الكفاءة) على إغلاقات يومية — نافذة 20 تغييراً يومياً،
عتبة ثابتة (Kaufman) — قرار اليوم من بيانات الأمس فقط (بلا lookahead).

اصطلاحات التنفيذ: لوت 0.01، سبريد 0.30$/صفقة، SL أولاً داخل الشمعة،
إشارة على إغلاق i → دخول على افتتاح i+1. الرصيد المرجعي 1000$.
"""
import sys, csv, datetime as dt
sys.path.insert(0, '/home/z/my-project/scripts')
import strategy_shootout as ss
from strategy_shootout import (load_tf, atr_series, sig_tsmom, sig_ogle,
                               SPREAD, SYRIA_MS, C)

BAL = 1000.0
SNAP_DAYS = {'365يوم': 365, '730يوم': 730}


# ------------------------------------------------------------ runner
def run_meta(candles, warmup, signals, exit_fn=None, w0t=0):
    """signals: {i: (dir, sl, tp[, meta])} — يدعم meta لقاطع التبادل"""
    trades, eq = [], [0.0] * len(candles)
    cum = 0.0
    pos = None
    for i in range(warmup, len(candles)):
        c = candles[i]
        closed = None
        if pos is None and signals.get(i - 1) is not None:
            s = signals[i - 1]
            d, sl, tp = s[0], s[1], s[2]
            meta = s[3] if len(s) > 3 else None
            if (d == 1 and c.o > sl) or (d == -1 and c.o < sl):
                pos = dict(dir=d, entry=c.o, sl=sl, tp=tp, meta=meta, i0=i, held=0)
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
            pnl = (exit_px - pos['entry']) * pos['dir'] - SPREAD
            risk = abs(pos['entry'] - pos['sl'])
            if candles[pos['i0']].t >= w0t:
                trades.append(dict(entry_t=candles[pos['i0']].t, dir=pos['dir'],
                                   risk=risk, pnl=pnl,
                                   r=(pnl / risk) if risk > 1e-9 else 0.0,
                                   why=why))
                cum += pnl
            pos = None
        eq[i] = cum
    if pos is not None:
        c = candles[-1]
        pnl = (c.c - pos['entry']) * pos['dir'] - SPREAD
        if candles[pos['i0']].t >= w0t:
            trades.append(dict(entry_t=candles[pos['i0']].t, dir=pos['dir'],
                               risk=abs(pos['entry'] - pos['sl']), pnl=pnl,
                               r=pnl / max(abs(pos['entry'] - pos['sl']), 1e-9),
                               why='eod'))
            cum += pnl
        eq[-1] = cum
    return trades, eq


def metrics(trades, eq):
    n = len(trades)
    if n == 0:
        return dict(n=0, wr=0.0, pf=0.0, net=0.0, dd=0.0, ddp=0.0,
                    risk=0.0, riskp=0.0, minbal=BAL, streak=0, avgr=0.0)
    wins = [t for t in trades if t['pnl'] > 0]
    losses = [t for t in trades if t['pnl'] <= 0]
    gw = sum(t['pnl'] for t in wins)
    gl = abs(sum(t['pnl'] for t in losses))
    peak = dd = 0.0
    for v in eq:
        peak = max(peak, v)
        dd = max(dd, peak - v)
    streak = worst = 0
    for t in trades:
        streak = streak + 1 if t['pnl'] <= 0 else 0
        worst = max(worst, streak)
    risk = sum(t['risk'] for t in trades) / n
    return dict(n=n, wr=100.0 * len(wins) / n, pf=(gw / gl) if gl > 1e-9 else 99.0,
                net=gw - gl, dd=dd, ddp=100.0 * dd / BAL, risk=risk,
                riskp=100.0 * risk / BAL, minbal=BAL - min(eq), streak=worst,
                avgr=sum(t['r'] for t in trades) / n)


# ------------------------------------------------------------ البوابة
def build_regime(c1, theta):
    """ER(20 تغييراً يومياً) → وضع كل يوم: T اتجاه / R عرضي. قرار الشمعة من يوم مكتمل سابق."""
    dc = {}
    for c in c1:
        dc[int((c.t + SYRIA_MS) // 86400e3)] = c.c
    ds = sorted(dc)
    reg = {}
    n = 20
    for k in range(n, len(ds)):
        num = abs(dc[ds[k]] - dc[ds[k - n]])
        den = sum(abs(dc[ds[j]] - dc[ds[j - 1]]) for j in range(k - n + 1, k + 1))
        if den > 1e-9:
            reg[ds[k]] = 'T' if num / den >= theta else 'R'
    def at(t):
        d = int((t + SYRIA_MS) // 86400e3) - 1
        while d >= ds[0] and d not in reg:
            d -= 1
        return reg.get(d)
    return at


# ------------------------------------------ S/R Flip مع الميتا والقاطع
def sig_flip_gated(c4, regime, atrH4):
    """نسخة أمينة من sig_flip_h4 + meta=(level, a0) + فلتر الوضع العرضي"""
    highs = [x.h for x in c4]
    lows = [x.l for x in c4]
    closes = [x.c for x in c4]
    n = len(c4)
    is_pvh = [False] * n
    is_pvl = [False] * n
    for j in range(5, n - 5):
        if highs[j] >= max(highs[j - 5:j]) and highs[j] >= max(highs[j + 1:j + 6]):
            is_pvh[j] = True
        if lows[j] <= min(lows[j - 5:j]) and lows[j] <= min(lows[j + 1:j + 6]):
            is_pvl[j] = True
    sig = {}
    pend_flip, intact_res, intact_sup = [], [], []
    for i in range(6, n):
        a0 = atrH4[i]
        if not a0:
            continue
        still = []
        for (side, lv, ib, a0p) in pend_flip:
            if i - ib > 12:
                continue
            c = c4[i]
            if side == -1:
                if c.c > lv + 0.5 * a0p:
                    continue
                if c.h >= lv and c.c < lv:
                    slp = max(c.h, lv) + 0.5 * a0p
                    if regime(c.t) == 'R':
                        sig[i] = (-1, slp, c.c - 2.0 * (slp - c.c), (lv, a0p))
                    continue
            else:
                if c.c < lv - 0.5 * a0p:
                    continue
                if c.l <= lv and c.c > lv:
                    slp = min(c.l, lv) - 0.5 * a0p
                    if regime(c.t) == 'R':
                        sig[i] = (1, slp, c.c + 2.0 * (c.c - slp), (lv, a0p))
                    continue
            still.append((side, lv, ib, a0p))
        pend_flip = still
        j = i - 5
        if j >= 5:
            if is_pvh[j]:
                intact_res.append((j, highs[j]))
            if is_pvl[j]:
                intact_sup.append((j, lows[j]))
        k_res = [r for r in intact_res if closes[i] > r[1]]
        for (_, lv) in k_res:
            pend_flip.append((-1, lv, i, a0))
        intact_res = [r for r in intact_res if r not in k_res]
        k_sup = [s for s in intact_sup if closes[i] < s[1]]
        for (_, lv) in k_sup:
            pend_flip.append((1, lv, i, a0))
        intact_sup = [s for s in intact_sup if s not in k_sup]

    def kill(i, c, p):  # قاطع إعادة الاختراق أثناء الصفقة
        lv, a0 = p['meta']
        if p['dir'] == -1:
            return c.c > lv + 0.5 * a0
        return c.c < lv - 0.5 * a0
    return sig, kill


# ------------------------------------------------------------ main
def main():
    c1 = load_tf('1h')
    c4 = load_tf('4h')
    A1 = atr_series(c1, 14)
    A4 = atr_series(c4, 14)
    ss.A1 = A1
    last_t = c1[-1].t
    print(f"بيانات 1h: {len(c1)} شمعة | آخر شمعة: "
          f"{dt.datetime.fromtimestamp(last_t/1000, dt.UTC):%Y-%m-%d}\n")

    rows_out = []

    def simulate(name, tf, sig, ex, w0, tag):
        """يرجع (trades, eq) ويسجل صفاً — يستخدم للسلل أيضاً"""
        cs = c4 if tf == '4h' else c1
        warm = 30 if tf == '4h' else 800
        tr, eq = run_meta(cs, warm, sig, ex, w0t=w0)
        return tr, eq

    def record(name, tag, tr, eq):
        m = metrics(tr, eq)
        m['name'], m['window'] = name, tag
        rows_out.append(m)

    for tag, days in SNAP_DAYS.items():
        w0 = last_t - days * 86400e3
        # 1) TSMOM الخام (بلا بوابة — البوابة أضرت به لأن إشارات الاتجاه
        #    تحدث عند بداية التحول قبل تأكد ER)
        sigT, exT = sig_tsmom(c1)
        trT, eqT = simulate('TSMOM', '1h', sigT, exT, w0, tag)
        record('TSMOM-30d (خام — المعتمد)', tag, trT, eqT)
        # 1-ب) TSMOM مُبوَّب — للتوثيق فقط (تجربة مرفوضة)
        regime = build_regime(c1, 0.30)
        sigT_g = {i: s for i, s in sigT.items() if regime(c1[i].t) != 'R'}
        trTg, eqTg = simulate('TSMOM*g', '1h', sigT_g, exT, w0, tag)
        record('TSMOM-30d مُبوَّب (تجربة مرفوضة)', tag, trTg, eqTg)
        # 2) Sunrise Ogle — دائماً مسموحة
        sigO, exO = sig_ogle(c1)
        trO, eqO = simulate('Ogle', '1h', sigO, exO, w0, tag)
        record('Sunrise Ogle (دائماً)', tag, trO, eqO)
        # 3) Flip الخام لل مقارنة
        sigF_raw, _ = ss.sig_flip_h4(c4)
        trF0, eqF0 = simulate('Flip خام', '4h', sigF_raw, None, w0, tag)
        record('S/R Flip H4 خام (بلا بوابة)', tag, trF0, eqF0)
        # 3-ب) Flip المبوَّب + القاطع (إنقاذ)
        sigF, killF = sig_flip_gated(c4, regime, A4)
        trF, eqF = simulate('Flip*g', '4h', sigF, killF, w0, tag)
        record('S/R Flip مبوَّب+قاطع (إنقاذ)', tag, trF, eqF)
        # السلل: منحنيات مجمّعة (كل مكوّن بلوت 0.01)
        for combo, parts in (
                ('سلة A: TSMOM + Ogle', ((trT, eqT), (trO, eqO))),
                ('سلة B: TSMOM + Ogle + Flip*g',
                 ((trT, eqT), (trO, eqO), (trF, eqF)))):
            all_tr = [t for tr, _ in parts for t in tr]
            combo_eq = [sum(v) for v in zip(*[eq for _, eq in parts])]
            record(combo, tag, all_tr, combo_eq)

        # خط الأساس الرسمي TAMSA-18 (من محرك البوت) — DD% يعاد حسابه على 1000
        rows_out.append(dict(name='TAMSA-18 (المحرك الرسمي)', window=tag, n=11,
                             wr=45.45, pf=1.54, net=18.70, dd=22.60,
                             ddp=100 * 22.60 / BAL, risk=8.0, riskp=0.8,
                             minbal=BAL, streak=0, avgr=0.475))

    def table(tag):
        print(f"\n===== النافذة {tag} | الرصيد المرجعي {BAL:.0f}$ =====")
        hdr = (f"{'الاستراتيجية/السلة':<38}{'صفقات':>6}{'نجاح%':>7}{'PF':>6}"
               f"{'صافي$':>9}{'DD$':>8}{'DD%':>6}{'خطر/صفقة$':>10}{'خطر%':>6}"
               f"{'أدنىرصيد$':>10}{'سلسلة':>7}")
        print(hdr)
        print('-' * len(hdr))
        for r in [x for x in rows_out if x['window'] == tag]:
            print(f"{r['name']:<38}{r['n']:>6}{r['wr']:>7.1f}{r['pf']:>6.2f}"
                  f"{r['net']:>9.1f}{r['dd']:>8.1f}{r['ddp']:>6.1f}"
                  f"{r['risk']:>10.1f}{r['riskp']:>6.1f}{r['minbal']:>10.0f}"
                  f"{r['streak']:>7}")
        # توقع شهري واقعي للسلة B
        b = next((x for x in rows_out if x['window'] == tag
                  and x['name'].startswith('سلة B')), None)
        if b:
            months = 12 if tag == '365يوم' else 24
            print(f"\n  سلة B: توقع شهري ≈ {b['net']/months:+.1f}$/شهر "
                  f"({100*b['net']/months/BAL:+.1f}% من 1000$) | أقصى DD {b['ddp']:.1f}%")

    table('365يوم')
    table('730يوم')

    with open('/home/z/my-project/download/basket-1000-results.csv', 'w',
              newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['strategy', 'window', 'trades', 'winrate_%', 'profit_factor',
                    'net_pnl_usd_0.01lot', 'maxDD_usd', 'DD_%_of_1000',
                    'avg_risk_usd', 'risk_%_per_trade', 'min_balance_usd',
                    'longest_losing_streak', 'avg_R'])
        for r in rows_out:
            w.writerow([r['name'], r['window'], r['n'], round(r['wr'], 2),
                        round(r['pf'], 2), round(r['net'], 2), round(r['dd'], 2),
                        round(r['ddp'], 1), round(r['risk'], 1), round(r['riskp'], 2),
                        round(r['minbal'], 0), r['streak'], round(r['avgr'], 3)])
    print('\nCSV → /home/z/my-project/download/basket-1000-results.csv')


if __name__ == '__main__':
    main()
