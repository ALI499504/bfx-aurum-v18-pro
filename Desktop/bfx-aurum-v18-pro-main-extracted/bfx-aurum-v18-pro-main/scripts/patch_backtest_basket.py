#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""زرع السلة والصمامات في backtest.ts — تعديلات دقيقة موثقة"""
p = '/home/z/my-project/src/lib/engine/backtest.ts'
src = open(p, encoding='utf-8').read()
n0 = len(src)

# ---------- 1) CLOSE_LABELS: إضافة خروج القاعدة ----------
old = """  const CLOSE_LABELS: Record<Trade['result'], string> = {
    sl: 'الوقف ضُرب (ينفذ في أي وقت — القاعدة 12)',
    tp: 'الهدف تحقق',
    time: 'سقف الاحتفاظ الزمني 8 ساعات (القاعدة 4)',
    news: 'إغلاق مرتبط بالأخبار',
    dayend: 'إيقاف اليوم: حد الخسارة/الربح (القاعدتان 7 و8)',
  };"""
new = """  const CLOSE_LABELS: Record<Trade['result'], string> = {
    sl: 'الوقف ضُرب (ينفذ في أي وقت — القاعدة 12)',
    tp: 'الهدف تحقق',
    time: 'سقف الاحتفاظ الزمني 8 ساعات (القاعدة 4)',
    news: 'إغلاق مرتبط بالأخبار',
    dayend: 'إيقاف اليوم: حد الخسارة/الربح (القاعدتان 7 و8)',
    rule: 'خروج قاعدة الاستراتيجية (انعكاس الزخم/التقاطع/القناة — السلة المتحققة)',
  };"""
assert old in src, 'CLOSE_LABELS'
src = src.replace(old, new)

# ---------- 2) إعدادات الصمامات بعد baseBalance ----------
old = """  const baseBalance = gr.fixed_base.enabled ? (gr.fixed_base.value ?? 1000) : 1000; // القاعدة 13
"""
new = """  const baseBalance = gr.fixed_base.enabled ? (gr.fixed_base.value ?? 1000) : 1000; // القاعدة 13

  // ---------- صمامات المخاطر المعتمدة (عصر السلة — قرار المالك بعد المحاكاة على 1000$) ----------
  // حد يومي 3% من الأساس (يُشدد القاعدة 7 المطلقة 50$ إن كان أضيق)، حد أسبوعي 6%،
  // وحماية الإيكويتي: منع الدخول الجديد عند هبوط الإيكويتي عن قمته بنسبة ≥ القيمة.
  const fuseDailyPct = gr.fuse_daily_pct?.enabled ? (gr.fuse_daily_pct.value ?? 3) : null;
  const fuseWeeklyPct = gr.fuse_weekly_pct?.enabled ? (gr.fuse_weekly_pct.value ?? 6) : null;
  const fuseEquityPct = gr.fuse_equity_floor?.enabled ? (gr.fuse_equity_floor.value ?? 15) : null;
  let weekNumPrev = -1;
  let weekPnl = 0;
  let weekStopped = false;
  let eqPeak = baseBalance;
  let equityHalted = false;
  let fuseTrips = { daily: 0, weekly: 0, equity: 0 };
"""
assert old in src, 'fuses init'
src = src.replace(old, new)

# ---------- 3) max_concurrent بدل الصفقة الواحدة العامة ----------
old = """  // القاعدة 10: الصفقة النشطة الواحدة
  const maxConcurrent = gr.single_trade.enabled ? 1 : 99;
"""
new = """  // القاعدة 10 (دلالة عصر السلة): صفقة نشطة واحدة لكل استراتيجية — وليست واحدة للحساب كله —
  // مع سقف تزامن عام max_concurrent (الافتراضي 4 = مكوّنات السلة المعتمدة W/X/Y/AA).
  // التبرير: المحاكاة المعتمدة (+3167$ سنة / PF 3.92) تقوم على مواضع متوازية لمكونات السلة،
  // والصمامات (يومي 3% / أسبوعي 6% / إيكويتي 15%) هي حد المخاطرة الجديد بدل القيد المطلق.
  const maxConcurrent = gr.max_concurrent?.enabled
    ? Math.max(1, gr.max_concurrent.value ?? 4)
    : (gr.single_trade.enabled ? 1 : 99);
"""
assert old in src, 'maxConcurrent'
src = src.replace(old, new)

# ---------- 4) بداية الأسبوع: تصفير عدّاد الأسبوع ----------
old = """    // ---- بداية يوم دمشق جديد ----
    const dn = syriaDayNum(t);
    if (dn !== dayNumPrev) {
      dayNumPrev = dn;
      dayKey = new Date(dn * 86400e3).toISOString().slice(0, 10);
      dayTrades = 0; dayPnl = 0; dayStopped = null;
    }
"""
new = """    // ---- بداية يوم دمشق جديد ----
    const dn = syriaDayNum(t);
    if (dn !== dayNumPrev) {
      dayNumPrev = dn;
      dayKey = new Date(dn * 86400e3).toISOString().slice(0, 10);
      dayTrades = 0; dayPnl = 0; dayStopped = null;
    }

    // ---- بداية أسبوع جديد: تصفير صمام الخسارة الأسبوعية ----
    const wk = weekKey(t);
    if (wk !== weekNumPrev) {
      weekNumPrev = wk;
      weekPnl = 0;
      weekStopped = false;
    }
"""
assert old in src, 'week reset'
src = src.replace(old, new)

# ---------- 5) doClose: تراكم الأسبوع ----------
old = """    balance += tr.pnl;
    dayPnl += tr.pnl;
    trades.push(tr);
    logClose(tr, atT);"""
new = """    balance += tr.pnl;
    dayPnl += tr.pnl;
    weekPnl += tr.pnl;
    trades.push(tr);
    logClose(tr, atT);"""
assert old in src, 'doClose weekPnl'
src = src.replace(old, new)

# ---------- 6) محرك خروج القاعدة للسلة: حسابات مسبقة قبل حلقة الشموع ----------
old = """  const sigPtr = { i: 0 };
  const c5 = data.c5;
"""
new = """  const sigPtr = { i: 0 };
  const c5 = data.c5;

  // ---------- حسابات خروج القاعدة (استراتيجيات السلة المتحققة — على شموع الساعة المغلقة) ----------
  // قرار الخروج من إغلاق ساعة مكتملة، والتنفيذ على آخر شمعة 5m من الساعة (إغلاقها = إغلاق الساعة
  // في التجميع) — بلا تسلل مستقبلي، وحرفياً كما في المحاكاة المعتمدة (exit_fn على شمعة 1h).
  const rl = mergeParams(settings.strategyParams);
  const c1h = data.c1h;
  const c1hCloses = c1h.map(x => x.c);
  const nMom = rl.W.horizonDays * 24;
  const momSign = new Int8Array(c1hCloses.length);
  for (let i = nMom; i < c1hCloses.length; i++) momSign[i] = c1hCloses[i] > c1hCloses[i - nMom] ? 1 : -1;
  const eXSlow = emaSeries(c1h, rl.X.emaSlow);   // خروج Ogle: كسر EMA البطيء
  const eYFast = emaSeries(c1h, rl.Y.fast);      // خروج EWMAC: انعكاس التقاطع
  const eYSlow = emaSeries(c1h, rl.Y.slow);
  const donExitLo = slidingMin(c1h.map(x => x.l), rl.AA.exitN); // دونشييان: كسر قناة الخروج
  const donExitHi = slidingMax(c1h.map(x => x.h), rl.AA.exitN);
  const X_MAX_HOLD_HOURS = 120; // حرفياً من المحاكاة: held > 120 شمعة ساعية (5 أيام)
  const hourIdxAt = (tms: number): number => {
    let lo = 0, hi = c1h.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (c1h[mid].t <= tms) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return idx;
  };
"""
assert old in src, 'rule-exit precompute'
src = src.replace(old, new)

# ---------- 7) إدارة الصفقات المفتوحة: بلا هدف عند tpPips=0 ----------
old = """      // 1) وقف أو هدف (الوقف أولاً تحفظاً — القاعدة 12)
      for (const tr of [...openTrades]) {
        if (tr.dir === 'buy') {
          if (bar.l <= tr.sl) doClose(tr, tr.sl, 'sl', t);
          else if (bar.h >= tr.tp) doClose(tr, tr.tp, 'tp', t);
        } else {
          if (bar.h >= tr.sl) doClose(tr, tr.sl, 'sl', t);
          else if (bar.l <= tr.tp) doClose(tr, tr.tp, 'tp', t);
        }
      }
"""
new = """      // 1) وقف أو هدف (الوقف أولاً تحفظاً — القاعدة 12) — tpPips=0 يعني بلا هدف (السلة)
      for (const tr of [...openTrades]) {
        if (tr.dir === 'buy') {
          if (bar.l <= tr.sl) doClose(tr, tr.sl, 'sl', t);
          else if (tr.tpPips > 0 && bar.h >= tr.tp) doClose(tr, tr.tp, 'tp', t);
        } else {
          if (bar.h >= tr.sl) doClose(tr, tr.sl, 'sl', t);
          else if (tr.tpPips > 0 && bar.l <= tr.tp) doClose(tr, tr.tp, 'tp', t);
        }
      }
      // 1.5) خروج القاعدة لمكونات السلة المتحققة: قرار من آخر شمعة ساعية مكتملة
      if (openTrades.length && bar.t % TF_MS['1h'] === TF_MS['1h'] - TF_MS['5m']) {
        const hIdx = hourIdxAt(bar.t);
        if (hIdx >= 0) {
          for (const tr of [...openTrades]) {
            if (t - tr.entryT < minHoldMs) continue;
            const buy = tr.dir === 'buy';
            let exitRule = false;
            let why = '';
            if (tr.strategy === 'W') {
              // TSMOM-30d: الخروج بانعكاس زخم الأفق (حرفياً من المحاكاة المعتمدة)
              const ms2 = momSign[hIdx];
              if (ms2 !== 0 && ((buy && ms2 < 0) || (!buy && ms2 > 0))) { exitRule = true; why = 'انعكاس زخم 30 يوماً'; }
            } else if (tr.strategy === 'X') {
              // Ogle: كسر EMA البطيء ضد الصفقة أو تجاوز أقصى احتفاظ 120 ساعة
              const e = eXSlow[hIdx];
              if (Number.isFinite(e) && ((buy && bar.c < e) || (!buy && bar.c > e))) { exitRule = true; why = 'كسر EMA البطيء'; }
              else if (t - tr.entryT >= X_MAX_HOLD_HOURS * 3600e3) { exitRule = true; why = 'أقصى احتفاظ 120 ساعة'; }
            } else if (tr.strategy === 'Y') {
              // EWMAC: انعكاس تقاطع EMA 32/128 ضد الصفقة
              if (Number.isFinite(eYFast[hIdx]) && Number.isFinite(eYSlow[hIdx]) && ((buy && eYFast[hIdx] < eYSlow[hIdx]) || (!buy && eYFast[hIdx] > eYSlow[hIdx]))) { exitRule = true; why = 'انعكاس تقاطع EWMAC'; }
            } else if (tr.strategy === 'AA') {
              // دونشييان: كسر قناة الخروج 60 ساعة ضد الصفقة
              const lo60 = donExitLo[hIdx], hi60 = donExitHi[hIdx];
              if (Number.isFinite(lo60) && ((buy && bar.c < lo60) || (!buy && bar.c > hi60))) { exitRule = true; why = 'كسر قناة دونشييان للخروج'; }
            }
            if (exitRule) doClose(tr, bar.c, 'rule', t);
            void why;
          }
        }
      }
"""
assert old in src, 'no-tp + rule exit'
src = src.replace(old, new)

# ---------- 8) القاعدتان 7 و8: دمج الصمام اليومي النسبي ----------
old = """      // 4) القاعدتان 7 و8: حد الخسارة اليومي 50$ والمستهدف الربحي 200$ (على الأسعار العائمة)
      if (openTrades.length) {
        let floating = 0;
        for (const tr of openTrades) floating += (tr.dir === 'buy' ? bar.c - tr.entry : tr.entry - bar.c) * (tr.lot / 0.01);
        const equityPnl = dayPnl + floating;
        const lossStop = gr.daily_loss_stop.enabled ? (gr.daily_loss_stop.value ?? 50) : Infinity;
        const profitStop = gr.daily_profit_stop.enabled ? (gr.daily_profit_stop.value ?? 200) : Infinity;
        if (equityPnl <= -lossStop || equityPnl >= profitStop) {
          dayStopped = equityPnl <= -lossStop ? 'loss' : 'profit';
          for (const tr of [...openTrades]) doClose(tr, bar.o, 'dayend', t);
          stoppedDays.add(dayKey);
        }
      }
    }
"""
new = """      // 4) القاعدتان 7 و8 + الصمام اليومي النسبي: أضيق الحدين هو الحاكم
      if (openTrades.length) {
        let floating = 0;
        for (const tr of openTrades) floating += (tr.dir === 'buy' ? bar.c - tr.entry : tr.entry - bar.c) * (tr.lot / 0.01);
        const equityPnl = dayPnl + floating;
        const lossAbs = gr.daily_loss_stop.enabled ? (gr.daily_loss_stop.value ?? 50) : Infinity;
        const lossPct = fuseDailyPct !== null ? (fuseDailyPct / 100) * baseBalance : Infinity;
        const lossStop = Math.min(lossAbs, lossPct);
        const profitStop = gr.daily_profit_stop.enabled ? (gr.daily_profit_stop.value ?? 200) : Infinity;
        if (equityPnl <= -lossStop || equityPnl >= profitStop) {
          dayStopped = equityPnl <= -lossStop ? 'loss' : 'profit';
          if (equityPnl <= -lossStop) fuseTrips.daily++;
          for (const tr of [...openTrades]) doClose(tr, bar.o, 'dayend', t);
          stoppedDays.add(dayKey);
        }
        // الصمام الأسبوعي 6%: لا إغلاق إجباري — فقط منع الدخول الجديد لبقية الأسبوع
        if (fuseWeeklyPct !== null && !weekStopped && (weekPnl + floating) <= -(fuseWeeklyPct / 100) * baseBalance) {
          weekStopped = true;
          fuseTrips.weekly++;
        }
        // صمام حماية الإيكويتي: منع الدخول الجديد عند تراجع ≥ النسبة عن قمة الإيكويتي
        if (fuseEquityPct !== null) {
          const eqNow = balance + floating;
          eqPeak = Math.max(eqPeak, eqNow);
          equityHalted = eqPeak > 0 && ((eqPeak - eqNow) / eqPeak) * 100 >= fuseEquityPct;
          if (equityHalted) fuseTrips.equity++;
        }
      }
    }
"""
assert old in src, 'daily fuse'
src = src.replace(old, new)

# ---------- 9) بوابات الدخول الجديدة في حلقة التنفيذ ----------
old = """        if (gr.max_daily_trades.enabled && dayTrades >= (gr.max_daily_trades.value ?? 50)) { bump('maxTrades'); logBlock('maxTrades', t, st); continue; }
        if (dayStopped) { bump('dayStop'); logBlock('dayStop', t, st); continue; }
"""
new = """        if (gr.max_daily_trades.enabled && dayTrades >= (gr.max_daily_trades.value ?? 50)) { bump('maxTrades'); logBlock('maxTrades', t, st); continue; }
        if (dayStopped) { bump('dayStop'); logBlock('dayStop', t, st); continue; }
        if (weekStopped) { bump('weeklyStop'); logBlock('weeklyStop', t, st); continue; }
        if (equityHalted) { bump('equityFloor'); logBlock('equityFloor', t, st); continue; }
"""
assert old in src, 'fill gates'
src = src.replace(old, new)

# ---------- 10) القاعدة 10 داخل الحلقة: لكل استراتيجية + سقف التزامن ----------
old = """      for (const st of [...pending]) {
        if (filledNow.has(st.id) || cancelIds.has(st.id)) continue;
        // القاعدة 10 حرفياً: لا صفقة جديدة حتى يُتأكد من إغلاق النشطة
        if (gr.single_trade.enabled && openTrades.length > 0) { bump('single'); logBlock('single', t, st); break; }
"""
new = """      for (const st of [...pending]) {
        if (filledNow.has(st.id) || cancelIds.has(st.id)) continue;
        // القاعدة 10 (دلالة السلة): صفقة نشطة واحدة لكل استراتيجية — لا تكرار لنفس الاستراتيجية
        if (openTrades.some(o => o.strategy === st.strategy)) { bump('single'); logBlock('single', t, st); continue; }
        // سقف التزامن العام (max_concurrent): امتلأت السعة → لا جديد إطلاقاً
        if (openTrades.length >= maxConcurrent) { bump('concurrent'); logBlock('concurrent', t, st); break; }
"""
assert old in src, 'per-strategy single'
src = src.replace(old, new)

# ---------- 11) دخول صفقة بلا هدف: tp=0 وسجل قرار أوضح ----------
old = """        const tr: Trade = {
          id: tradeId++, strategy: st.strategy, case: st.case, scenario: st.scenario, dir: st.dir,
          entryT: t, exitT: 0, entry: fillPrice, exit: 0,
          sl: slPrice, tp: tpPrice, slPips: slPipsFinal, tpPips: st.tpPips,
          result: 'tp', pnl: 0, session: sess, reason: st.reason,
          lot,
        };
        (tr as Trade & { levelKey?: string }).levelKey = st.levelKey;
        openTrades.push(tr);
        dayTrades++; dayTraded.add(dayKey); dayWith1Plus.add(dayKey);
        if (inLogWindow(t)) pushLog({
          t, level: Number.isFinite(st.refLevel) ? Math.round(st.refLevel) : null,
          setup: (st.strategy === 'A' || st.strategy === 'B') ? st.strategy as 'A' | 'B' : null,
          condition: `اكتملت شروط ${st.strategy}${st.case ? ` (${st.case})` : ''} س${st.scenario ?? 1} — تنفيذ ماركت عند سعر الاقتراب ${fillPrice.toFixed(2)}`,
          decision: 'دخول', sl: slPrice, tp: tpPrice,
        });
"""
new = """        const tr: Trade = {
          id: tradeId++, strategy: st.strategy, case: st.case, scenario: st.scenario, dir: st.dir,
          entryT: t, exitT: 0, entry: fillPrice, exit: 0,
          sl: slPrice, tp: st.tpPips > 0 ? tpPrice : 0, slPips: slPipsFinal, tpPips: st.tpPips,
          result: 'tp', pnl: 0, session: sess, reason: st.reason,
          lot,
        };
        (tr as Trade & { levelKey?: string }).levelKey = st.levelKey;
        openTrades.push(tr);
        dayTrades++; dayTraded.add(dayKey); dayWith1Plus.add(dayKey);
        if (inLogWindow(t)) pushLog({
          t, level: Number.isFinite(st.refLevel) ? Math.round(st.refLevel) : null,
          setup: (st.strategy === 'A' || st.strategy === 'B') ? st.strategy as 'A' | 'B' : null,
          condition: `اكتملت شروط ${st.strategy}${st.case ? ` (${st.case})` : ''} س${st.scenario ?? 1} — تنفيذ ماركت عند سعر الاقتراب ${fillPrice.toFixed(2)}`,
          decision: 'دخول', sl: slPrice, tp: st.tpPips > 0 ? tpPrice : null,
          extra: st.tpPips > 0 ? undefined : `وقف ${slPrice.toFixed(2)} — بلا هدف ثابت: الخروج بقاعدة الاستراتيجية`,
        });
"""
assert old in src, 'trade tp0'
src = src.replace(old, new)

# ---------- 12) signalToSetup ليس هنا — لكن حساب tpPrice عند tpPips=0 ----------
old = """        // الأرقام حرفياً من الإشارة: الوقف والهدف من سعر التنفيذ الفعلي بلا أي حدود عامة
        const slPipsFinal = st.slPips;
        const slPrice = st.dir === 'buy' ? fillPrice - pips(slPipsFinal) : fillPrice + pips(slPipsFinal);
        const tpPrice = st.dir === 'buy' ? fillPrice + pips(st.tpPips) : fillPrice - pips(st.tpPips);
"""
new = """        // الأرقام حرفياً من الإشارة: الوقف والهدف من سعر التنفيذ الفعلي بلا أي حدود عامة
        const slPipsFinal = st.slPips;
        const slPrice = st.dir === 'buy' ? fillPrice - pips(slPipsFinal) : fillPrice + pips(slPipsFinal);
        const tpPrice = st.tpPips > 0
          ? (st.dir === 'buy' ? fillPrice + pips(st.tpPips) : fillPrice - pips(st.tpPips))
          : fillPrice; // بلا هدف (مكونات السلة) — القيمة الرمزية لا تُفحص (tpPips=0)
"""
assert old in src, 'tpPrice calc'
src = src.replace(old, new)

# ---------- 13) إحصاءات الصمامات في buildStats ctx ----------
old = """  const stats = buildStats(trades, {
    startT: c5[0].t, endT, baseBalance, finalBalance: balance,
    spreadCents, lot, tpRatio: 2, signalsCount, fillsBlocked,
    settings, emaState: emaStateAt(data, endT, settings.indicators.emaFast, settings.indicators.emaSlow),
    dayTraded, dayWith1Plus, stoppedDays,
    blocked,
    sigByStrat, fillBlockedByStrat,
    dailyTarget,
  });
"""
new = """  const stats = buildStats(trades, {
    startT: c5[0].t, endT, baseBalance, finalBalance: balance,
    spreadCents, lot, tpRatio: 2, signalsCount, fillsBlocked,
    settings, emaState: emaStateAt(data, endT, settings.indicators.emaFast, settings.indicators.emaSlow),
    dayTraded, dayWith1Plus, stoppedDays,
    blocked,
    sigByStrat, fillBlockedByStrat,
    dailyTarget,
    fuseTrips,
  });
"""
assert old in src, 'stats ctx'
src = src.replace(old, new)

# ---------- 14) buildStats: نوع ctx + railHits ----------
old = """  settings: Settings; emaState: Dir;
  dayTraded: Set<string>; dayWith1Plus: Set<string>; stoppedDays: Set<string>;
  blocked: Record<string, number>;
  dailyTarget: number;
}): BacktestStats {"""
new = """  settings: Settings; emaState: Dir;
  dayTraded: Set<string>; dayWith1Plus: Set<string>; stoppedDays: Set<string>;
  blocked: Record<string, number>;
  dailyTarget: number;
  fuseTrips?: { daily: number; weekly: number; equity: number };
}): BacktestStats {"""
assert old in src, 'buildStats type'
src = src.replace(old, new)

old = """    railHits: { maxTrades: 0, dailyLoss: 0, lotClamp: 0, concurrent: 0 },"""
new = """    railHits: { maxTrades: 0, dailyLoss: ctx.fuseTrips?.daily ?? 0, lotClamp: 0, concurrent: 0 },
    fuseTrips: ctx.fuseTrips ?? { daily: 0, weekly: 0, equity: 0 },"""
assert old in src, 'railHits'
src = src.replace(old, new)

# ---------- 15) BacktestStats interface: fuseTrips ----------
old = """  /** ضربات الحوكمة الصلبة (الحدود المكتوبة في الكود) */
  railHits: { maxTrades: number; dailyLoss: number; lotClamp: number; concurrent: number };"""
new = """  /** ضربات الحوكمة الصلبة (الحدود المكتوبة في الكود) */
  railHits: { maxTrades: number; dailyLoss: number; lotClamp: number; concurrent: number };
  /** ضربات صمامات المخاطر المعتمدة (يومي/أسبوعي/إيكويتي) */
  fuseTrips: { daily: number; weekly: number; equity: number };"""
assert old in src, 'stats interface'
src = src.replace(old, new)

# ---------- 16) finalPending: إرفاق tpPips للعرض ----------
old = """    .map(st => ({
      strategy: st.strategy as string,
      case: st.case ?? null,
      scenario: st.scenario ?? (1 as const),
      dir: st.dir,
      entry: st.entry,
      sl: st.dir === 'buy' ? st.entry - pips(st.slPips) : st.entry + pips(st.slPips),
      tp: st.dir === 'buy' ? st.entry + pips(st.tpPips) : st.entry - pips(st.tpPips),
      session: st.session as string,
      reason: st.reason,
      expiresAt: st.expiresAt, createdAt: st.createdAt,
    }));"""
new = """    .map(st => ({
      strategy: st.strategy as string,
      case: st.case ?? null,
      scenario: st.scenario ?? (1 as const),
      dir: st.dir,
      entry: st.entry,
      sl: st.dir === 'buy' ? st.entry - pips(st.slPips) : st.entry + pips(st.slPips),
      tp: st.tpPips > 0 ? (st.dir === 'buy' ? st.entry + pips(st.tpPips) : st.entry - pips(st.tpPips)) : 0,
      tpPips: st.tpPips,
      session: st.session as string,
      reason: st.reason,
      expiresAt: st.expiresAt, createdAt: st.createdAt,
    }));"""
assert old in src, 'finalPending'
src = src.replace(old, new)

# ---------- 17) slidingMin/slidingMax helpers ----------
old = """function weekKey(t: number): number {"""
new = """/** أدنى قيمة في النافذة السابقة [i-n, i-1] لكل موضع (deque رتيب — O(n)) */
function slidingMin(vals: number[], n: number): number[] {
  const out = new Array<number>(vals.length).fill(NaN);
  const dq: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    while (dq.length && vals[dq[dq.length - 1]] >= vals[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - n) dq.shift();
    if (i >= n && dq.length) out[i] = vals[dq[0]];
  }
  return out;
}

/** أعلى قيمة في النافذة السابقة [i-n, i-1] لكل موضع (deque رتيب — O(n)) */
function slidingMax(vals: number[], n: number): number[] {
  const out = new Array<number>(vals.length).fill(NaN);
  const dq: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    while (dq.length && vals[dq[dq.length - 1]] <= vals[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - n) dq.shift();
    if (i >= n && dq.length) out[i] = vals[dq[0]];
  }
  return out;
}

function weekKey(t: number): number {"""
assert old in src, 'sliding helpers'
src = src.replace(old, new)

open(p, 'w', encoding='utf-8').write(src)
print(f'backtest.ts patched: {n0} -> {len(src)} chars')
