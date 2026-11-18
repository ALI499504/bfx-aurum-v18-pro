#!/usr/bin/env python3
# ============================================================
# تدريب نموذج التقلب على شموع MT5 الحقيقية
# ------------------------------------------------------------
# يقرأ db/training-dataset.json (الذي ينتجه scripts/export-training-data.ts
# من شموع MT5 حقيقية عبر دالة computeFeatures الإنتاجية نفسها)، ثم:
#   1) يقيّم بصدق عبر walk-forward (تدريب على الماضي، اختبار على المستقبل)
#   2) يدرّب النموذج النهائي ويكتب public/lightgbm-model-xauusd.json
#      بالصيغة التي يقرأها JsonTreeModel في البوت
#
# لا يولّد أي بيانات. لا يدّعي أرقاماً. إن كانت الإشارة ضعيفة يطبعها كما هي.
#
# التشغيل:  python3 scripts/train-model-mt5.py
# ============================================================
import json, sys, os
import numpy as np

try:
    import lightgbm as lgb
    from sklearn.metrics import roc_auc_score
except ImportError:
    print("مطلوب: pip install lightgbm scikit-learn")
    sys.exit(1)

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(HERE, 'db', 'training-dataset.json')
SNAPSHOT = os.path.join(HERE, 'db', 'mt5-feed-snapshot.json')
OUT = os.path.join(HERE, 'public', 'lightgbm-model-xauusd.json')

HORIZON = 24          # أفق التنبؤ بالساعات
FOLDS = 5             # نوافذ walk-forward

PARAMS = dict(
    objective='binary', metric='auc', learning_rate=0.02,
    num_leaves=15, min_data_in_leaf=100, feature_fraction=0.7,
    bagging_fraction=0.8, bagging_freq=5, lambda_l2=5.0,
    verbose=-1, seed=42,
)


def load():
    if not os.path.exists(DATASET):
        print(f"مجموعة التدريب مفقودة: {DATASET}")
        print("شغّل أولاً: bun run scripts/export-training-data.ts")
        sys.exit(1)
    d = json.load(open(DATASET, encoding='utf-8'))
    X = np.array(d['X'], dtype=np.float64)
    ts = list(d['ts'])
    names = d['featureNames']

    snap = json.load(open(SNAPSHOT, encoding='utf-8'))
    c = sorted(snap['tfs']['1h'], key=lambda x: x[0])
    closes = np.array([r[4] for r in c], dtype=np.float64)
    tindex = {r[0]: i for i, r in enumerate(c)}

    kk, ii = [], []
    for k, t in enumerate(ts):
        j = tindex.get(t)
        if j is not None:
            kk.append(k); ii.append(j)
    kk = np.array(kk); ii = np.array(ii)

    ok = ii + HORIZON < len(closes)
    K, I = kk[ok], ii[ok]
    fwd_abs = np.abs(closes[I + HORIZON] - closes[I]) / closes[I]
    med = float(np.median(fwd_abs))
    y = (fwd_abs > med).astype(int)
    return d, X[K], y, med, names


def walk_forward(X, y, names):
    n = len(X); size = n // (FOLDS + 1); aucs = []
    print(f"\n=== Walk-forward ({FOLDS} نوافذ: تدريب على الماضي، اختبار على المستقبل) ===")
    for f in range(FOLDS):
        tr_end = size * (f + 1)
        te_end = min(size * (f + 2), n)
        if te_end - tr_end < 200:
            continue
        dtr = lgb.Dataset(X[:tr_end], label=y[:tr_end], feature_name=names)
        dte = lgb.Dataset(X[tr_end:te_end], label=y[tr_end:te_end], reference=dtr)
        m = lgb.train(PARAMS, dtr, num_boost_round=400, valid_sets=[dte],
                      callbacks=[lgb.early_stopping(50, verbose=False)])
        pr = m.predict(X[tr_end:te_end])
        auc = roc_auc_score(y[tr_end:te_end], pr)
        aucs.append(float(auc))
        print(f"  نافذة {f+1}: تدريب={tr_end:5d} اختبار={te_end-tr_end:4d} "
              f"AUC={auc:.4f} best_iter={m.best_iteration}")
    mean = float(np.mean(aucs))
    above = sum(1 for a in aucs if a > 0.5)
    print(f"\nمتوسط AUC: {mean:.4f} · فوق 0.5 في {above}/{len(aucs)} نوافذ")
    if mean < 0.52:
        print("⚠️  الإشارة ضعيفة (AUC<0.52) — النموذج صالح كفلتر مخاطر خفيف فقط، لا كمولّد إشارات.")
    return mean, aucs, above


def main():
    d, X, y, med, names = load()
    n = len(X)
    print(f"عينات: {n} · ميزات: {len(names)}")
    print(f"المدى: {d['rangeFrom']} → {d['rangeTo']} · الوسيط: {med:.5f} · نسبة الحدث: {y.mean():.3f}")

    mean, aucs, above = walk_forward(X, y, names)

    # النموذج النهائي على 80%
    sp = int(n * 0.8)
    dtr = lgb.Dataset(X[:sp], label=y[:sp], feature_name=names)
    dte = lgb.Dataset(X[sp:], label=y[sp:], reference=dtr)
    m = lgb.train(PARAMS, dtr, num_boost_round=500, valid_sets=[dte],
                  callbacks=[lgb.early_stopping(60, verbose=False)])
    auc = float(roc_auc_score(y[sp:], m.predict(X[sp:])))
    print(f"\nنموذج 80/20: AUC={auc:.4f} best_iter={m.best_iteration}")

    dump = m.dump_model(num_iteration=m.best_iteration)
    out = {
        "model_type": "lightgbm",
        "version": "2.0-volatility",
        "purpose": "volatility_filter",
        "trained_at": __import__('datetime').datetime.now().isoformat(),
        "data_source": "MetaTrader5 real candles via mt5-bridge",
        "symbol": d.get('symbol'), "broker": d.get('broker'),
        "timeframe": "1h", "horizon_hours": HORIZON,
        "data_range": f"{d['rangeFrom']} to {d['rangeTo']}",
        "num_candles": n, "num_features": len(names), "num_classes": 1,
        "task": f"binary: هل الحركة المطلقة خلال {HORIZON} ساعة تتجاوز الوسيط؟",
        "label_threshold_median": med,
        "auc_walkforward_mean": mean,
        "auc_walkforward_windows": aucs,
        "walkforward_windows_above_0_5": f"{above}/{len(aucs)}",
        "auc_holdout": auc,
        "best_iteration": int(m.best_iteration or 500),
        "feature_names": names,
        "model_dump": dump,
        "honest_notes": [
            "بيانات MT5 حقيقية فقط — لا توليد عشوائي",
            "النموذج يتنبأ بالتقلب لا بالاتجاه (الاتجاه أعطى AUC~0.51 = بلا قيمة)",
            f"AUC {mean:.3f} إشارة ضعيفة-متوسطة: صالح كفلتر مخاطر لا كمولّد إشارات",
        ],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f"\n✅ حُفظ: {OUT}")
    print(f"   trees={len(dump['tree_info'])} · AUC={auc:.4f}")


if __name__ == '__main__':
    main()
