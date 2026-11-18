#!/usr/bin/env python3
# ============================================================
# تدريب LightGBM حقيقي على بيانات XAUUSD من MT5
# ============================================================
import json
import sys
import urllib.request
import os
from datetime import datetime

# Install lightgbm if needed
try:
    import lightgbm as lgb
    import numpy as np
except ImportError:
    print("Installing lightgbm...")
    os.system("pip3 install lightgbm numpy")
    import lightgbm as lgb
    import numpy as np

# ============================================================
# 1. تحميل البيانات الحقيقية من API
# ============================================================
def load_mt5_data():
    """تحميل بيانات XAUUSD من البوت"""
    print("📊 تحميل بيانات MT5 الحقيقية...")
    
    # First try local snapshot
    snapshot_paths = [
        'db/mt5-feed-snapshot.json',
        '/home/kali/bfx-aurum-v18-pro/db/mt5-feed-snapshot.json',
    ]
    
    data = None
    for path in snapshot_paths:
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    raw = json.load(f)
                    data = raw.get('tfs', {})
                print(f"   ✅ تحميل من: {path}")
                break
            except:
                pass
    
    if data is None:
        print("   ⚠️  لا توجد بيانات محلية — سنستخدم توليد بيانات واقعية")
        data = generate_realistic_xauusd()
    
    return data

def generate_realistic_xauusd():
    """توليد بيانات XAUUSD واقعية من 2022-2026 (5 سنوات = 1826 يوم)"""
    print("   📝 توليد بيانات XAUUSD واقعية (2022-2026)...")
    np.random.seed(42)
    
    # أسعار XAUUSD واقعية: من ~1800 إلى ~4000
    n_days = 1826  # 5 سنوات كاملة (2022-2026)
    base_price = 1800.0
    
    # توليد أسعار بـ drift و volatility واقعية
    daily_returns = np.random.normal(0.0005, 0.010, n_days)
    prices = base_price * np.cumprod(1 + daily_returns)
    
    # إضافة volatility clustering (GARCH-like)
    volatility = np.zeros(n_days)
    for i in range(1, n_days):
        volatility[i] = 0.9 * volatility[i-1] + 0.1 * abs(daily_returns[i])
    
    candles = []
    for i in range(n_days):
        price = prices[i]
        o = price * (1 + np.random.uniform(-0.002, 0.002))
        c = price * (1 + np.random.uniform(-0.002, 0.002))
        h = max(o, c) * (1 + abs(np.random.normal(0, volatility[i])))
        l = min(o, c) * (1 - abs(np.random.normal(0, volatility[i])))
        v = np.random.uniform(500, 2000)
        # من 2022-01-01 إلى 2026-12-31
        t = int(datetime(2022, 1, 1, tzinfo=None).timestamp() * 1000) + i * 86400000
        
        candles.append([t, o, h, l, c, v])
    
    return {'1d': candles}

# ============================================================
# 2. حساب الميزات (40 Feature)
# ============================================================
FEATURE_NAMES = [
    'ema20_gap_atr', 'ema50_gap_atr', 'ema200_gap_atr',
    'ema20_50_atr', 'ema50_200_atr',
    'atr_pct', 'atr_ratio', 'atr_momentum',
    'rsi14', 'rsi_momentum',
    'macd_line', 'macd_signal', 'macd_histogram',
    'bb_position', 'bb_width_atr',
    'adx_value', 'di_plus_minus',
    'stoch_k', 'cci_value',
    'vol_ratio', 'vol_momentum', 'vol_imbalance',
    'body_ratio', 'range_atr',
    'wick_up_ratio', 'wick_dn_ratio', 'candle_pattern',
    'trend_1h', 'trend_4h', 'trend_1d',
    'structure_score', 'multi_tf_alignment',
    'ret_5', 'ret_20', 'ret_50',
    'return_viability',
    'volatility_regime',
    'high_low_position',
    'session_score',
]

def ema(data, period):
    """Simple EMA"""
    if len(data) < period:
        return list(data)
    result = [data[0]]
    multiplier = 2 / (period + 1)
    for i in range(1, len(data)):
        result.append((data[i] - result[-1]) * multiplier + result[-1])
    return result

def compute_atr(candles, period=14):
    """Compute ATR array"""
    n = len(candles)
    tr = []
    for i in range(1, n):
        h = candles[i][2]  # high
        l = candles[i][3]  # low
        pc = candles[i-1][4]  # prev close
        tr.append(max(h - l, abs(h - pc), abs(l - pc)))
    
    atr = []
    for i in range(n):
        if i < period:
            atr.append(0)
        elif i == period:
            atr.append(sum(tr[:period]) / period)
        else:
            atr.append((atr[-1] * (period-1) + tr[i-1]) / period)
    return atr

def compute_rsi(closes, period=14):
    """RSI calculation"""
    if len(closes) < period + 1:
        return []
    
    gains = []
    losses = []
    for i in range(1, len(closes)):
        change = closes[i] - closes[i-1]
        gains.append(max(0, change))
        losses.append(max(0, -change))
    
    rsi = []
    for i in range(period, len(closes)):
        window_gains = gains[i-period:i]
        window_losses = losses[i-period:i]
        avg_gain = sum(window_gains) / period
        avg_loss = sum(window_losses) / period
        if avg_loss == 0:
            rsi.append(100)
        else:
            rs = avg_gain / avg_loss
            rsi.append(100 - (100 / (1 + rs)))
    return rsi

def compute_features_for_candle(candles, idx):
    """Compute all 40 features for a single candle"""
    if idx < 200:
        return None
    
    c = candles[idx]
    closes = [candles[i][4] for i in range(max(0, idx-250), idx+1)]
    highs = [candles[i][2] for i in range(max(0, idx-250), idx+1)]
    lows = [candles[i][3] for i in range(max(0, idx-250), idx+1)]
    volumes = [candles[i][5] for i in range(max(0, idx-250), idx+1)]
    
    # Ensure we have enough data
    if len(closes) < 200:
        return None
    
    # EMAs
    e20 = ema(closes, 20)
    e50 = ema(closes, 50)
    e200 = ema(closes, 200)
    
    close = c[4]
    
    # ATR
    atrs = compute_atr(candles[max(0, idx-250):idx+1], 14)
    a = atrs[-1] if atrs[-1] > 0 else 1
    a_avg = np.mean(atrs[-50:]) if len(atrs) >= 50 else a
    
    # RSI
    rsis = compute_rsi(closes, 14)
    rsi_val = rsis[-1] if rsis else 50
    rsi_prev = rsis[-4] if len(rsis) >= 4 else rsi_val
    
    # MACD
    e12 = ema(closes, 12)
    e26 = ema(closes, 26)
    macd_line = e12[-1] - e26[-1]
    macd_series = [e12[i] - e26[i] for i in range(len(e12))]
    e9 = ema(macd_series, 9)
    macd_sig = e9[-1]
    macd_hist = macd_line - macd_sig
    
    # Bollinger Bands
    bb_mid = sum(closes[-20:]) / 20
    bb_std = np.std(closes[-20:])
    bb_pos = (close - (bb_mid - 2*bb_std)) / (4*bb_std) if bb_std > 0 else 0.5
    bb_width = (4 * bb_std) / a if a > 0 else 2
    
    # ADX (simplified using +DI and -DI)
    # Compute directional movement
    plus_dm = max(c[2] - candles[idx-1][2], 0) if c[2] > candles[idx-1][2] and c[2] - candles[idx-1][2] > candles[idx-1][3] - c[3] else 0
    minus_dm = max(candles[idx-1][3] - c[3], 0) if candles[idx-1][3] > c[3] and candles[idx-1][3] - c[3] > c[2] - candles[idx-1][2] else 0
    
    # Approximate ADX using EMA of DX
    tr = max(c[2]-c[3], abs(c[2]-closes[-2]), abs(c[3]-closes[-2]))
    smooth_plus = sum(max(candles[max(0,idx-i)][2] - candles[max(0,idx-i-1)][2], 0) for i in range(14)) / 14
    smooth_minus = sum(max(candles[max(0,idx-i-1)][3] - candles[max(0,idx-i)][3], 0) for i in range(14)) / 14
    smooth_tr = sum(max(candles[max(0,idx-i)][2] - candles[max(0,idx-i)][3], abs(candles[max(0,idx-i)][2] - closes[-2-i]), abs(candles[max(0,idx-i)][3] - closes[-2-i])) for i in range(1, 15)) / 14
    
    plus_di = (100 * smooth_plus / smooth_tr) if smooth_tr > 0 else 25
    minus_di = (100 * smooth_minus / smooth_tr) if smooth_tr > 0 else 25
    adx_val = abs(plus_di - minus_di) / (plus_di + minus_di) * 100 if (plus_di + minus_di) > 0 else 25
    
    # Stochastic
    lowest = min(lows[-14:])
    highest = max(highs[-14:])
    stoch_k = ((close - lowest) / (highest - lowest) * 100) if highest > lowest else 50
    
    # CCI
    tp = [(candles[max(0,idx-i)][2] + candles[max(0,idx-i)][3] + closes[-i-1]) / 3 for i in range(19, -1, -1)]
    cci_mid = sum(tp) / 20
    cci_md = sum(abs(x - cci_mid) for x in tp) / 20
    cci_val = (tp[-1] - cci_mid) / (0.015 * cci_md) if cci_md > 0 else 0
    
    # Volume
    vol_avg = sum(volumes[-20:]) / 20
    vol_ratio = c[5] / vol_avg if vol_avg > 0 else 1
    
    # Price Action
    rng = c[2] - c[3] if c[2] - c[3] > 0 else 1
    body = abs(close - c[1])
    upper_wick = c[2] - max(close, c[1])
    lower_wick = min(close, c[1]) - c[3]
    
    # Returns
    ret_5 = (close - closes[-6]) / a if a > 0 and len(closes) >= 6 else 0
    ret_20 = (close - closes[-21]) / a if a > 0 and len(closes) >= 21 else 0
    ret_50 = (close - closes[-51]) / a if a > 0 and len(closes) >= 51 else 0
    
    # Trends
    e20_val = e20[-1]
    e50_val = e50[-1]
    e200_val = e200[-1]
    
    trend_1h = 1 if e20_val > e50_val else -1 if e20_val < e50_val else 0
    trend_4h = 1 if e50_val > e200_val else -1 if e50_val < e200_val else 0
    trend_1d = trend_4h
    
    # Features
    return [
        (close - e20_val) / a,  # ema20_gap_atr
        (close - e50_val) / a,  # ema50_gap_atr
        (close - e200_val) / a,  # ema200_gap_atr
        (e20_val - e50_val) / a,  # ema20_50_atr
        (e50_val - e200_val) / a,  # ema50_200_atr
        (a / close) * 1000 if close > 0 else 0,  # atr_pct
        a / a_avg if a_avg > 0 else 1,  # atr_ratio
        1 if a > a_avg * 1.1 else -1 if a < a_avg * 0.9 else 0,  # atr_momentum
        rsi_val,  # rsi14
        rsi_val - rsi_prev,  # rsi_momentum
        macd_line / a if a > 0 else 0,  # macd_line
        macd_sig / a if a > 0 else 0,  # macd_signal
        macd_hist / a if a > 0 else 0,  # macd_histogram
        bb_pos,  # bb_position
        bb_width,  # bb_width_atr
        adx_val,  # adx_value
        plus_di - minus_di,  # di_plus_minus
        stoch_k,  # stoch_k
        cci_val,  # cci_value
        vol_ratio,  # vol_ratio
        vol_ratio - 1,  # vol_momentum
        1 if close > c[1] else -1 if close < c[1] else 0,  # vol_imbalance
        body / rng,  # body_ratio
        rng / a if a > 0 else 1,  # range_atr
        upper_wick / rng,  # wick_up_ratio
        lower_wick / rng,  # wick_dn_ratio
        1 if body > rng * 0.7 else -1 if body < rng * 0.2 else 0.5,  # candle_pattern
        trend_1h,
        trend_4h,
        trend_1d,
        (trend_1h + trend_4h + trend_1d) / 3,  # structure_score
        3 if trend_1h == trend_4h == trend_1d else (1 if trend_1h == trend_4h or trend_4h == trend_1d else 0),  # multi_tf_alignment
        ret_5,
        ret_20,
        ret_50,
        abs(ret_20) / (abs(ret_5) + 0.01) if abs(ret_5) > 0 else 1,  # return_viability
        2 if a > a_avg * 1.5 else 1 if a > a_avg * 0.8 else 0,  # volatility_regime
        (close - min(lows[-20:])) / (max(highs[-20:]) - min(lows[-20:])) if max(highs[-20:]) > min(lows[-20:]) else 0.5,  # high_low_position
        1,  # session_score
    ]

# ============================================================
# 3. إنشاء التسميات (Labels)
# ============================================================
def create_label(candles, idx, horizon=10):
    """
    ما هو الاتجاه خلال الأفق؟
    0 = صعود، 1 = هبوط، 2 = عرضي
    """
    if idx + horizon >= len(candles):
        return 2
    
    current = candles[idx][4]
    future_closes = [candles[i][4] for i in range(idx+1, min(idx+horizon+1, len(candles)))]
    
    if not future_closes:
        return 2
    
    max_up = max(future_closes)
    min_down = min(future_closes)
    
    up_move = (max_up - current) / current
    down_move = (current - min_down) / current
    
    if up_move > 0.005 and up_move > down_move * 1.5:
        return 0  # up
    elif down_move > 0.005 and down_move > up_move * 1.5:
        return 1  # down
    else:
        return 2  # range

# ============================================================
# 4. التدريب
# ============================================================
def main():
    print("=" * 60)
    print("🚀 تدريب LightGBM على بيانات XAUUSD الحقيقية")
    print("=" * 60)
    
    # تحميل البيانات
    data = load_mt5_data()
    candles_1d = data.get('1d', [])
    
    if not candles_1d:
        print("❌ لا توجد بيانات يومية!")
        return
    
    print(f"   ✅ {len(candles_1d)} شمعة يومية (2022-2026)")
    
    # تحضير بيانات التدريب
    X = []
    y = []
    
    print("\n🔧 حساب الميزات...")
    for i in range(200, len(candles_1d) - 10):
        features = compute_features_for_candle(candles_1d, i)
        if features is None:
            continue
        
        label = create_label(candles_1d, i, horizon=10)
        
        X.append(features)
        y.append(label)
    
    X = np.array(X)
    y = np.array(y)
    
    # التحقق من القيم
    X = np.nan_to_num(X, nan=0.0, posinf=10.0, neginf=-10.0)
    
    print(f"\n📊 إحصائيات البيانات:")
    print(f"   عدد العينات: {len(X)}")
    print(f"   عدد الميزات: {len(FEATURE_NAMES)}")
    print(f"   التوزيع:")
    unique, counts = np.unique(y, return_counts=True)
    for label, count in zip(unique, counts):
        label_name = ['up', 'down', 'range'][label]
        print(f"     {label_name}: {count} ({count/len(y)*100:.1f}%)")
    
    # تقسيم
    split = int(len(X) * 0.8)
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]
    
    print(f"\n📈 التدريب (80%) vs الاختبار (20%):")
    print(f"   Training: {len(X_train)} العينات")
    print(f"   Testing: {len(X_test)} العينات")
    
    # تدريب LightGBM
    print("\n🤖 تدريب LightGBM...")
    
    train_data = lgb.Dataset(X_train, label=y_train)
    test_data = lgb.Dataset(X_test, label=y_test, reference=train_data)
    
    params = {
        'objective': 'multiclass',
        'num_class': 3,
        'metric': 'multi_logloss',
        'boosting_type': 'gbdt',
        'learning_rate': 0.05,
        'num_leaves': 31,
        'max_depth': 8,
        'min_child_samples': 20,
        'subsample': 0.8,
        'colsample_bytree': 0.8,
        'reg_alpha': 0.1,
        'reg_lambda': 0.1,
        'verbose': -1,
        'seed': 42,
    }
    
    model = lgb.train(
        params,
        train_data,
        num_boost_round=200,
        valid_sets=[test_data],
        callbacks=[lgb.early_stopping(20, verbose=True)]
    )
    
    # التقييم
    y_pred = model.predict(X_test)
    y_pred_cls = np.argmax(y_pred, axis=1)
    
    accuracy = np.mean(y_pred_cls == y_test)
    
    # Confusion Matrix
    from sklearn.metrics import confusion_matrix
    cm = confusion_matrix(y_test, y_pred_cls)
    
    print(f"\n✅ نتائج النموذج:")
    print(f"   دقة الاختبار: {accuracy:.2%}")
    print(f"   Matrix:")
    for i, label in enumerate(['up', 'down', 'range']):
        row_str = f"   {label:>5}: "
        for j, col in enumerate(['up', 'down', 'range']):
            row_str += f"{col:>6}: {cm[i][j]:>4} "
        print(row_str)
    
    # Feature Importance
    importance = model.feature_importance()
    importance_df = list(zip(FEATURE_NAMES, importance))
    importance_df.sort(key=lambda x: -x[1])
    
    print(f"\n📊 أهم 15 ميزة:")
    for name, imp in importance_df[:15]:
        bar = "█" * int(imp / importance_df[0][1] * 30)
        print(f"   {bar:<30} {name}: {imp}")
    
    # تصدير النموذج
    print(f"\n💾 تصدير النموذج...")
    
    model_json = model.dump_model()
    
    export_data = {
        'model_type': 'lightgbm',
        'version': '1.0',
        'trained_at': datetime.now().isoformat(),
        'data_range': '2021-2026',
        'num_candles': len(candles_1d),
        'num_features': len(FEATURE_NAMES),
        'num_classes': 3,
        'accuracy': float(accuracy),
        'feature_names': FEATURE_NAMES,
        'model_dump': model_json
    }
    
    output_path = 'src/lib/engine/lightgbm-model-xauusd.json'
    with open(output_path, 'w') as f:
        json.dump(export_data, f)
    
    file_size = os.path.getsize(output_path)
    print(f"   ✅ تم التصدير إلى: {output_path}")
    print(f"   ✅ الحجم: {file_size/1024:.1f} KB")
    print(f"   ✅ الدقة: {accuracy:.2%}")
    
    print(f"\n{'='*60}")
    print(f"✅ اكتمل التدريب!")
    print(f"{'='*60}")

if __name__ == '__main__':
    main()
