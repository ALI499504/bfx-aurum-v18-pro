#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 BFX AURUM v20 - MT5 Live Bridge (Stream First + Background
 Deep History + Auto Backtest)
 جسر البث الحي: يربط طرفية MetaTrader 5 على جهازك بموقع البوت
 ويرسل شموع الذهب الحقيقية XAUUSD + الحساب الحقيقي + الصفقات
 المفتوحة وسجل الصفقات المنفذة كل ثانيتين، ونبضة سعر كل نصف ثانية.
------------------------------------------------------------
 جديد v20 — البث أولاً والسحب في الخلفية (إصلاح تأخر ظهور الشارت):
   • البث اللحظي يبدأ فوراً ولا ينتظر السحب العميق — الشارت يظهر خلال ثوانٍ.
   • سحب التاريخ العميق يعمل في خيط خلفية مع قفل آمن لوصول MT5،
     والفحص الذاتي الدوري أصبح فيه أيضاً — البث لا يتوقف أبداً.
   • عندما تتكاسل الطرفية عن تحميل نافذة تاريخ (تعيد شمعة واحدة أو لا شيء)
     ندفعها للتحميل بطلب كمية كبيرة من الشموع ثم نعيد السؤال بصبر —
     وإن بقيت مغلقة نتخطى النافذة ونكمل البقية، والفحص الذاتي يعيدها لاحقاً.
   • الفريمات الناقصة تُطلب لها 600 شمعة في كل دورة حتى تمتلئ كلها.
   • الموقع يحفظ لقطة للشموع الحقيقية على القرص ويستعيدها عند إعادة
     التشغيل — فلا يُفقد التاريخ ولا يعيد الجسر سحبه من الصفر.
------------------------------------------------------------
 جديد v19 — نبضة السعر اللحظية (Tick Fast-Lane) لتحرك الشارت مع MT5:
   • بين كل دفعتين شموع يرسل الجسر نبضة سعر خفيفة جداً (Bid/Ask فقط)
     كل نصف ثانية تقريباً، فيتحرك السعر وخط السعر في شارت الموقع
     لحظياً مع شارت ميتاتريدر تماماً بدل القفزة كل ثانيتين.
   • دفعات التاريخ العميق تحمل رقم الإصدار كي تعرض الواجهة النسخة
     الفعلية دائماً بلا تخمين.
   • إن بقيت نافذة جسر قديمة تعمل بجانب الجديد فموقع البوت يعطي
     الأولوية لنبضات الجسر الأحدث — ومع ذلك أغلق النافذة القديمة.
------------------------------------------------------------
 جديد v18 — إصلاح بطاقة الحساب + تعميق رأس تاريخ 5m:
   • إصلاح: عند انشغال الطرفية أثناء سحب التاريخ قد تفشل قراءة
     الحساب لحظياً فكان الجسر يرسل حساباً بلا رصيد فيختفي
     الرصيد من الموقع ويظهر تحذير خاطئ "نسخة أقدم".
   • الحل: إعادة المحاولة 4 مرات + الاعتماد على آخر قراءة ناجحة
     (حقيقية 100% من نفس طرفيتك) + كل دفعة تحمل رقم الإصدار v18
     كي يعرض الموقع النسخة الفعلية بدل التخمين.
   • تعميق رأس التاريخ: إن كانت أقدم شمعة 5m على الموقع أحدث
     من 2025-01-01 (بسبب التحميل الكسول للطرفية) يعيد السؤال
     عن الفجوة المتبقية بنوافذ أصغر وصبر أطول حتى يكتمل
     تاريخ 2025 كاملاً، ثم يشغّل الباك تيست الحقيقي تلقائياً.
------------------------------------------------------------
 بلا أي محاكاة أو بيانات وهمية — كل شمعة تأتي من وسيطك مباشرة.
============================================================
"""
import argparse
import glob
import json
import os
import sys
import threading
import time
import urllib.request
import urllib.error

DEFAULT_URL = "https://preview-chat-f4eeb93f-2da4-4577-85d4-0d92f62a07c1.space-z.ai"
TOKEN = "bfx-aurum-mt5-v1"
BRIDGE_V = 20         # رقم إصدار الجسر — يُرسل مع كل دفعة كي يعرضه الموقع بلا تخمين
TICK_STEPS = 4        # نبضات سعر خفيفة بين كل دفعتين شموع (interval ÷ 4 ≈ نصف ثانية)
SELF_CHECK_EVERY_S = 150  # الفحص الذاتي الدوري للتاريخ في خيط الخلفية
MT5_LOCK = threading.RLock()  # وصول MT5 من خيطين يجب أن يكون متسلسلاً وآمناً
FULL_EVERY = 150       # دفعة شموع كاملة كل 150 دورة (ضمان المزامنة — نحو 5 دقائق)
DEALS_DAYS = 60        # سجل الصفقات المنفذة: آخر 60 يوماً
DEALS_MAX = 800        # أقصى عدد صفقات منفذة تُرسل

# ---------- التاريخ العميق (حقيقي 100% من طرفيتك) ----------
import datetime as _dt
HISTORY_FROM_MS = int(_dt.datetime(2025, 1, 1, 0, 0, tzinfo=_dt.timezone.utc).timestamp() * 1000)
BATCH_CANDLES = 4000        # حجم دفعة الرفع الواحدة (شمعة)
CHUNK_MS_SMALL = 183 * 86400 * 1000   # نافذة السحب لأفريم الدقائق: ~6 أشهر
CHUNK_MS_BIG = 5 * 365 * 86400 * 1000 # نافذة السحب للفريمات الكبيرة: ~5 سنوات
PROBE_SLEEP = 3             # ثوانٍ بين كل استعلام (أثناء انتظار تحميل الطرفية)
PROBE_STABLE = 2            # نتوقف عندما تثبت النتيجة بعد هذا العدد من المحاولات
PROBE_MAX = 50              # أقصى محاولات لكل نافذة (~150ث) — صبر كافٍ للتحميل الكسول
PROBE_MAX_DEEP = 100        # صبر أعلى لتعميق رأس التاريخ (~5 دقائق لكل نافذة)
TOPUP_DEADLINE_S = 480      # أقصى زمن لتعميق الرأس في الاستدعاء الواحد (يعاد تلقائياً)
STATE_VERSION = 17
STATE_PATH = os.path.join(os.path.expanduser("~"), ".bfx_history_state.json")

try:
    import MetaTrader5 as mt5
except ImportError:
    print("[X] مكتبة MetaTrader5 غير مثبتة / MetaTrader5 package missing")
    print("    نفّذ: pip install MetaTrader5")
    sys.exit(1)

# (مفتاح الفريم, ثابت MT5, عدد الشموع في الدفعة الكاملة الحية)
TF_MAP = [
    ("5m",  "TIMEFRAME_M5",  20000),
    ("15m", "TIMEFRAME_M15", 20000),
    ("30m", "TIMEFRAME_M30", 12000),
    ("1h",  "TIMEFRAME_H1",  20000),
    ("4h",  "TIMEFRAME_H4",  20000),
    ("1d",  "TIMEFRAME_D1",  1500),
    ("1w",  "TIMEFRAME_W1",  600),
    ("1M",  "TIMEFRAME_MN1", 300),
]

TF_SECONDS = {"5m": 300, "15m": 900, "30m": 1800, "1h": 3600,
              "4h": 14400, "1d": 86400, "1w": 604800, "1M": 2592000}

TF_AR = {"5m": "5 دقائق", "15m": "15 دقيقة", "30m": "30 دقيقة", "1h": "ساعة",
         "4h": "4 ساعات", "1d": "يومي", "1w": "أسبوعي", "1M": "شهري"}

TERMINAL_GLOBS = [
    r"C:\Program Files\*\terminal64.exe",
    r"C:\Program Files (x86)\*\terminal64.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\*\terminal64.exe"),
]

SYMBOL = ""

# ---------- إعادة اتصال ذكية: sandbox is inactive ----------
# خطأ «sandbox is inactive» يظهر حين تنهار قناة API الداخلية بين
# مكتبة MetaTrader5 والطرفية (إغلاق الطرفية، إعادة تشغيلها، أو كسر
# مؤقت في القناة). الحل: إغلاق الاتصال وإعادة تهيئته مع إعادة المحاولة.
# هذه الدالة تُستدعى من أي نقطة تظهر فيها المشكلة — لا ينهار الجسر أبداً.
_INITIALIZED_PATH = ""

def reconnect_mt5(max_attempts: int = 5) -> bool:
    """إعادة تأسيس اتصال MT5 بعد انهيار الساندبوكس الداخلي.
    تُغلق القناة القديمة ثم تُعاد التهيئة مع محاولات صبورة."""
    global _INITIALIZED_PATH
    for attempt in range(1, max_attempts + 1):
        try:
            mt5.shutdown()
        except Exception:
            pass
        time.sleep(1.5 * attempt)  # صبر متزايد: 1.5، 3، 4.5، 6، 7.5 ثانية
        try:
            if _INITIALIZED_PATH:
                ok = mt5.initialize(_INITIALIZED_PATH)
            else:
                ok = mt5.initialize()
            if not ok and not _INITIALIZED_PATH:
                guess = find_terminal()
                if guess:
                    ok = mt5.initialize(guess)
                    if ok:
                        _INITIALIZED_PATH = guess
            if ok:
                # تأكد أن الرمز ما زال مختاراً بعد إعادة التهيئة
                if SYMBOL:
                    try:
                        mt5.symbol_select(SYMBOL, True)
                    except Exception:
                        pass
                print(f"[OK] أعيد الاتصال بطرفية MT5 بنجاح (محاولة {attempt})")
                return True
        except Exception as e:
            print(f"[!] محاولة إعادة الاتصال {attempt} فشلت: {e}")
    print("[X] تعذّر إعادة الاتصال بـ MT5 بعد {max_attempts} محاولات — أغلق الطرفية وافتحها ثم أعد تشغيل الجسر")
    return False

def is_sandbox_inactive_error(e: Exception) -> bool:
    """اكتشاف خطأ الساندبوكس المعطل أو أي خطأ اتصال داخلي بطرفية MT5"""
    msg = str(e).lower()
    return any(k in msg for k in ("sandbox", "not initialized", "terminal", "no connection", "connection"))


def safe_tick(symbol: str = None):
    """جلب نبضة سعر مع اكتشاف خطأ الساندبوكس وإعادة الاتصال التلقائي"""
    sym = symbol or SYMBOL
    for _ in range(2):  # محاولتان: الأولى قد تُعيد الاتصال
        try:
            with MT5_LOCK:
                return mt5.symbol_info_tick(sym)
        except Exception as e:
            if is_sandbox_inactive_error(e):
                print(f"[!] الساندبوكس معطل — أعيد الاتصال: {e}")
                if reconnect_mt5():
                    continue
            return None
    return None


def tf_const(name: str):
    return getattr(mt5, name, None)


def find_terminal():
    """البحث عن terminal64.exe في المسارات الشائعة"""
    found = []
    for pattern in TERMINAL_GLOBS:
        found.extend(glob.glob(pattern))
    if not found:
        return None
    for path in found:
        folder = os.path.basename(os.path.dirname(path)).lower()
        if "metatrader" in folder or "metaquotes" in folder or "mt5" in folder:
            return path
    return found[0]


def pick_symbol(wanted: str):
    """اختيار رمز الذهب — يدعم الأسماء المختلفة لدى الوسطاء (XAUUSD, GOLD, XAUUSD.m ...)"""
    global SYMBOL
    if wanted:
        if mt5.symbol_info(wanted) is not None:
            mt5.symbol_select(wanted, True)
            SYMBOL = wanted
            return True
        print(f"[!] الرمز {wanted} غير موجود في هذه الطرفية — سأبحث تلقائياً")
    candidates = []
    for pat in ("*XAU*", "*GOLD*", "*Gold*"):
        try:
            res = mt5.symbols_get(pat)
        except Exception:
            res = None
        if res:
            candidates.extend(res)
    if not candidates:
        return False
    # الأفضلية: الظاهر في Market Watch ثم الأقصر اسمًا
    candidates.sort(key=lambda s: (not getattr(s, "visible", False), len(s.name)))
    for s in candidates:
        if mt5.symbol_select(s.name, True):
            SYMBOL = s.name
            return True
    return False


def push(url: str, payload: dict, timeout: int = 90):
    data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        url.rstrip("/") + "/api/mt5/ingest",
        data=data,
        headers={"Content-Type": "application/json", "x-bfx-token": TOKEN},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_status(url: str):
    """قراءة حالة الموقع: عدد الشموع وأقدم شمعة لكل فريم"""
    try:
        req = urllib.request.Request(url.rstrip("/") + "/api/mt5/status")
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def _date(ms) -> str:
    try:
        return time.strftime("%Y-%m-%d", time.gmtime(float(ms) / 1000))
    except Exception:
        return "?"


def rates_to_rows(rates):
    """تحويل نتائج MT5 إلى صفوف [t,o,h,l,c,v] — كما هي بدون أي تعديل"""
    rows = []
    if rates is None or len(rates) == 0:
        return rows
    for r in rates:
        try:
            rows.append([
                int(r["time"]) * 1000,
                round(float(r["open"]), 3),
                round(float(r["high"]), 3),
                round(float(r["low"]), 3),
                round(float(r["close"]), 3),
                int(r["tick_volume"]),
            ])
        except Exception:
            continue
    return rows


def build_tfs(force_full: bool, deep_counts=None):
    """جمع الشموع لكل الفريمات — 3 شموع للتحديث اللحظي، أو كامل،
    و600 شمعة للفريمات الناقصة كي تمتلئ كل الفريمات سريعاً."""
    tfs = {}
    with MT5_LOCK:
        for key, const_name, count in TF_MAP:
            const = tf_const(const_name)
            if const is None:
                continue
            n = count if force_full else (600 if (deep_counts and key in deep_counts) else 3)
            try:
                rates = mt5.copy_rates_from_pos(SYMBOL, const, 0, n)
            except Exception as e:
                rates = None
                if is_sandbox_inactive_error(e):
                    print(f"[!] الساندبوكس معطل أثناء نسخ الشموع ({key}) — أعيد الاتصال: {e}")
                    if reconnect_mt5():
                        try:
                            rates = mt5.copy_rates_from_pos(SYMBOL, const, 0, n)
                        except Exception:
                            rates = None
            if rates is None or len(rates) == 0:
                continue
            rows = rates_to_rows(rates)
            if rows:
                tfs[key] = rows
    return tfs


_ACC_CACHE = {"acc": None, "ts": 0.0}
ACC_CACHE_TTL = 900.0  # نستخدم آخر قراءة ناجحة حتى 15 دقيقة عند تعثر القراءة اللحظية


def build_account(retries: int = 4):
    """معلومات الحساب الحقيقية الكاملة — الرصيد وحقوق الملكية والهامش والأرباح العائمة.
    الطرفية قد تعجز لحظياً عن الإجابة أثناء انشغالها بتحميل التاريخ،
    لذا نعيد المحاولة 4 مرات، وإن استمر التعثر نعتمد على آخر قراءة
    ناجحة (حقيقية 100% من نفس الطرفية) بدل إرسال حساب ناقص بلا رصيد.
    محمية ضد خطأ الساندبوكس المعطل — تعيد الاتصال تلقائياً عند اكتشافه."""
    for attempt in range(max(1, retries)):
        try:
            with MT5_LOCK:
                acc = mt5.account_info()
        except Exception as e:
            if is_sandbox_inactive_error(e):
                print(f"[!] الساندبوكس معطل أثناء قراءة الحساب — أعيد الاتصال: {e}")
                if reconnect_mt5():
                    continue
            acc = None
        if acc is not None:
            full = {
                "login": str(acc.login),
                "server": acc.server,
                "currency": acc.currency,
                "leverage": int(acc.leverage),
                "name": getattr(acc, "name", "") or "",
                "company": getattr(acc, "company", "") or "",
                "balance": round(float(acc.balance), 2),
                "equity": round(float(acc.equity), 2),
                "margin": round(float(acc.margin), 2),
                "marginFree": round(float(acc.margin_free), 2),
                "marginLevel": round(float(acc.margin_level), 2) if acc.margin_level else 0.0,
                "profit": round(float(acc.profit), 2),
            }
            _ACC_CACHE["acc"] = full
            _ACC_CACHE["ts"] = time.time()
            return full
        if attempt + 1 < retries:
            time.sleep(0.4)
    cached = _ACC_CACHE["acc"]
    if cached is not None and time.time() - _ACC_CACHE["ts"] <= ACC_CACHE_TTL:
        out = dict(cached)
        out["stale"] = True  # حقيقية لكن منذ لحظات — تُستبدل تلقائياً عند نجاح القراءة التالية
        return out
    return None


def build_positions():
    """الصفقات المفتوحة الحقيقية على رمز الذهب.
    محمية ضد خطأ الساندبوكس المعطل — تعيد الاتصال تلقائياً."""
    positions = None
    try:
        with MT5_LOCK:
            positions = mt5.positions_get(symbol=SYMBOL)
    except Exception as e:
        if is_sandbox_inactive_error(e):
            print(f"[!] الساندبوكس معطل أثناء قراءة الصفقات — أعيد الاتصال: {e}")
            if reconnect_mt5():
                try:
                    with MT5_LOCK:
                        positions = mt5.positions_get(symbol=SYMBOL)
                except Exception:
                    positions = None
    if not positions:
        return []
    out = []
    for p in positions:
        try:
            out.append({
                "ticket": int(p.ticket),
                "t": int(p.time) * 1000,
                "dir": "buy" if int(p.type) == 0 else "sell",
                "volume": float(p.volume),
                "priceOpen": round(float(p.price_open), 3),
                "priceCurrent": round(float(p.price_current), 3),
                "sl": round(float(p.sl), 3),
                "tp": round(float(p.tp), 3),
                "profit": round(float(p.profit), 2),
                "swap": round(float(p.swap), 2),
                "comment": (p.comment or "")[:40],
            })
        except Exception:
            continue
    return out


def build_deals():
    """سجل الصفقات المنفذة الحقيقي (deals) لرمز الذهب — آخر 60 يوماً.
    محمية ضد خطأ الساندبوكس المعطل — تعيد الاتصال تلقائياً."""
    deals = None
    try:
        to_t = time.time() + 86400
        from_t = to_t - DEALS_DAYS * 86400
        with MT5_LOCK:
            deals = mt5.history_deals_get(
                _dt.datetime.fromtimestamp(from_t, tz=_dt.timezone.utc),
                _dt.datetime.fromtimestamp(to_t, tz=_dt.timezone.utc),
            )
    except Exception as e:
        if is_sandbox_inactive_error(e):
            print(f"[!] الساندبوكس معطل أثناء قراءة السجل — أعيد الاتصال: {e}")
            if reconnect_mt5():
                try:
                    to_t = time.time() + 86400
                    from_t = to_t - DEALS_DAYS * 86400
                    with MT5_LOCK:
                        deals = mt5.history_deals_get(
                            _dt.datetime.fromtimestamp(from_t, tz=_dt.timezone.utc),
                            _dt.datetime.fromtimestamp(to_t, tz=_dt.timezone.utc),
                        )
                except Exception:
                    deals = None
    if not deals:
        return []
    rows = []
    for d in deals:
        try:
            # فقط صفقات الشراء/البيع الحقيقية على الذهب (نستثني الإيداع/السحب/التعديلات)
            if d.symbol != SYMBOL:
                continue
            if int(d.type) not in (0, 1):
                continue
            rows.append({
                "t": int(d.time) * 1000,
                "dir": "buy" if int(d.type) == 0 else "sell",
                "entry": "in" if int(d.entry) == 0 else "out",
                "volume": float(d.volume),
                "price": round(float(d.price), 3),
                "profit": round(float(d.profit), 2),
                "swap": round(float(d.swap), 2),
                "commission": round(float(d.commission), 2),
                "position": int(d.position_id),
                "sl": round(float(d.sl), 3),
                "tp": round(float(d.tp), 3),
                "comment": (d.comment or "")[:40],
            })
        except Exception:
            continue
    rows.sort(key=lambda x: x["t"])
    return rows[-DEALS_MAX:]


# ============================================================
#  التاريخ العميق الصبور — سحب شموع حقيقية من 2025-01-01
# ============================================================

def load_state():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            st = json.load(f)
        if not isinstance(st, dict) or st.get("__v") != STATE_VERSION:
            return {"__v": STATE_VERSION}
        return st
    except Exception:
        return {"__v": STATE_VERSION}


def save_state(state: dict):
    try:
        state["__v"] = STATE_VERSION
        with open(STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f)
    except Exception:
        pass


def chunk_ms_for(key: str) -> int:
    """نافذة السحب الواحدة لكل فريم — أصغر للأفريم الدقيقة كي لا نتجاوز حدود الطرفية
    (فريم 5m تحمّل الطرفية تاريخه ببطء أكبر لذا نوافذ أصغر = تحميل أعمق وأوثق)"""
    if TF_SECONDS[key] <= 300:
        return 45 * 86400 * 1000          # 5m: ~45 يوماً للنافذة الواحدة
    return CHUNK_MS_SMALL if TF_SECONDS[key] <= 1800 else CHUNK_MS_BIG


def probe_range(const, start_ms: int, end_ms: int):
    """سؤال الطرفية عن شموع نافذة زمنية — None إن لم تكن محمّلة بعد"""
    try:
        with MT5_LOCK:
            return mt5.copy_rates_range(
                SYMBOL, const,
                _dt.datetime.fromtimestamp(start_ms / 1000, tz=_dt.timezone.utc),
                _dt.datetime.fromtimestamp(end_ms / 1000, tz=_dt.timezone.utc),
            )
    except Exception:
        return None


def force_history_sync(const_name):
    """دفع الطرفية الكسولة لتحميل التاريخ من وسيطك: طلب كمية كبيرة من
    الشموع الحديثة يجعل الطرفية تبدأ تحميل التاريخ في قاعدتها المحلية.
    طلبات متكررة = تحميل أعمق — كل الشموع تبقى حقيقية 100% من وسيطك."""
    const = tf_const(const_name)
    if const is None:
        return
    try:
        with MT5_LOCK:
            mt5.copy_rates_from_pos(SYMBOL, const, 0, 100_000)
    except Exception:
        pass


def push_history(url: str, key: str, rows: list) -> int:
    """رفع شموع التاريخ على دفعات صغيرة (نمط history — الدمج في الموقع زمني وبدون تكرار)"""
    sent = 0
    i = 0
    while i < len(rows):
        part = rows[i:i + BATCH_CANDLES]
        push(url, {"symbol": SYMBOL, "v": BRIDGE_V, "history": True, "tfs": {key: part}})
        sent += len(part)
        i += len(part)
        time.sleep(0.2)
    return sent


def pull_deep_tf(key: str, const_name: str, url: str, state: dict):
    """
    سحب صبور للتاريخ الحقيقي لفريم واحد من 2025-01-01 حتى الآن:
    نكرر السؤال لنفس النافذة حتى تستقر النتيجة — لأن طرفية MT5
    تحمّل التاريخ القديم من الوسيط في الخلفية، وأول استعلام يعيد
    المتاح محلياً فقط ثم ينمو مع كل استعلام.
    """
    const = tf_const(const_name)
    if const is None:
        return 0, None
    tf_ms = TF_SECONDS[key] * 1000
    now_ms = int(time.time() * 1000)
    total = 0
    deep_min = None
    start = HISTORY_FROM_MS
    window_no = 0

    while start < now_ms:
        end = min(start + chunk_ms_for(key), now_ms + tf_ms * 2)
        window_no += 1
        prev = -1
        stable = 0
        tries = 0
        rates = None
        while tries < PROBE_MAX:
            rates = probe_range(const, start, end)
            n = len(rates) if rates is not None else 0
            if n > 0 and n == prev:
                stable += 1
                if stable >= PROBE_STABLE:
                    break
            else:
                stable = 0
            prev = n
            tries += 1
            time.sleep(PROBE_SLEEP)

        rows = rates_to_rows(rates)
        # الطرفية الكسولة: إن أعادت أقل من 10 شموع لنافذة كاملة ندفعها للتحميل
        # بطلب كمية كبيرة من الشموع ثم نعيد السؤال بصبر — كل الشموع حقيقية 100%
        if len(rows) < 10:
            force_history_sync(const_name)
            prev = -1
            stable = 0
            tries = 0
            while tries < PROBE_MAX_DEEP:
                rates = probe_range(const, start, end)
                n = len(rates) if rates is not None else 0
                if n > 0 and n == prev:
                    stable += 1
                    if stable >= PROBE_STABLE:
                        break
                else:
                    stable = 0
                prev = n
                tries += 1
                time.sleep(PROBE_SLEEP)
            rows = rates_to_rows(rates)

        uploaded_ok = False
        if rows:
            push_fails = 0
            while True:
                try:
                    sent = push_history(url, key, rows)
                    total += sent
                    if deep_min is None or rows[0][0] < deep_min:
                        deep_min = rows[0][0]
                    print(f"      [{key}] نافذة {window_no}: رُفع {sent} شمعة حقيقية "
                          f"({_date(rows[0][0])} ← {_date(rows[-1][0])})")
                    uploaded_ok = True
                    break
                except KeyboardInterrupt:
                    raise
                except Exception as e:
                    push_fails += 1
                    if push_fails >= 5:
                        print(f"      [{key}] تعذر رفع النافذة ({e}) — سأعيد المحاولة في الفحص الذاتي")
                        break
                    print(f"      [{key}] تعذر رفع دفعة ({e}) — محاولة {push_fails}/5 بعد ثوانٍ")
                    time.sleep(5)
        else:
            if start == HISTORY_FROM_MS:
                print(f"      [{key}] لا يوجد تاريخ قبل {_date(end)} لدى وسيطك الآن "
                      f"({tries} محاولة) — إن ظهر لاحقاً سيسحبه الفحص الذاتي تلقائياً")
                print("          لتعميق التاريخ: أدوات → خيارات → رسوم بيانية → Max Bars = Unlimited،")
                print("          ثم افتح شارت الذهب على هذا الفريم واضغط Home لتحميل الأقدم")
            elif tries >= PROBE_MAX and prev == 0:
                print(f"      [{key}] لا بيانات في نافذة {_date(start)} ← {_date(end)} — أتخطاها وأكمل، والفحص الذاتي يعيدها")

        # النافذة تُعتبر مكتملة فقط إذا رُفعت فعلاً — وإلا يعيدها الفحص الذاتي لاحقاً
        st = state.get(key) if isinstance(state.get(key), dict) else {}
        st["complete"] = bool(rows) and uploaded_ok
        st["minT"] = deep_min if (rows and deep_min is not None) else None
        st["pushed"] = (st.get("pushed") or 0) + total
        st["doneAt"] = int(time.time() * 1000)
        state[key] = st
        save_state(state)
        start = end + 1

    return total, deep_min


def topup_head_tf(key: str, const_name: str, url: str, state: dict):
    """
    تعميق رأس التاريخ — الفجوة المتبقية بين 2025-01-01 وأقدم شمعة على الموقع.
    تنشأ الفجوة لأن طرفية MT5 تحمّل التاريخ القديم من الوسيط تدريجياً؛
    نعيد السؤال عن الفجوة المتبقية (بنوافذ أصغر وصبر أطول) حتى تكتمل،
    ونرفع الشموع الحقيقية فقط — إن لم تحمّل الطرفية النافذة بعد نتركها
    للفحص الذاتي التالي دون أي بديل وهمي.
    """
    const = tf_const(const_name)
    if const is None:
        return 0, None
    cov = server_coverage(url)
    oldest = (cov or {}).get("oldest", {}).get(key) if cov else None
    if not isinstance(oldest, (int, float)) or oldest <= 0:
        return 0, None
    gap_end = int(oldest) - TF_SECONDS[key] * 1000  # نصلك حتى هنا
    if gap_end <= HISTORY_FROM_MS:
        return 0, None  # التاريخ كامل من 2025-01-01 — لا فجوة
    tf_ms = TF_SECONDS[key] * 1000
    deadline = time.time() + TOPUP_DEADLINE_S
    total = 0
    deep_min = None
    start = HISTORY_FROM_MS
    window_no = 0
    print(f"  [{key}] فجوة رأس التاريخ: {_date(start)} ← {_date(oldest)} — سحب صبور ...")
    while start < gap_end and time.time() < deadline and window_no < 40:
        end = min(start + chunk_ms_for(key), gap_end)
        window_no += 1
        prev = -1
        stable = 0
        tries = 0
        rates = None
        while tries < PROBE_MAX_DEEP:
            rates = probe_range(const, start, end)
            n = len(rates) if rates is not None else 0
            if n > 0 and n == prev:
                stable += 1
                if stable >= PROBE_STABLE:
                    break
            else:
                stable = 0
            prev = n
            tries += 1
            time.sleep(PROBE_SLEEP)
            if time.time() > deadline:
                break
        rows = rates_to_rows(rates)
        if rows:
            try:
                sent = push_history(url, key, rows)
                total += sent
                if deep_min is None or rows[0][0] < deep_min:
                    deep_min = rows[0][0]
                print(f"      [{key}] تعميق نافذة {window_no}: رُفع {sent} شمعة حقيقية "
                      f"({_date(rows[0][0])} ← {_date(rows[-1][0])})")
                # نتقدم وفق أقدم شمعة رفعناها فعلاً كي نعيد سؤال ما قبلها لاحقاً
                start = int(rows[0][0])
                if start <= HISTORY_FROM_MS + tf_ms:
                    break  # وصلنا لبداية 2025
                start = max(HISTORY_FROM_MS, start - tf_ms)
            except KeyboardInterrupt:
                raise
            except Exception as e:
                print(f"      [{key}] تعذر رفع دفعة التعميق ({e}) — يعاد في الفحص الذاتي")
                break
        else:
            # الطرفية لم تحمّل هذه النافذة بعد — ندفعها للتحميل ثم نتركها للفحص الذاتي
            print(f"      [{key}] الطرفية لم تحمّل {_date(start)} ← {_date(end)} بعد "
                  f"({tries} محاولة) — أدفع الطرفية للتحميل وسأعيد السؤال تلقائياً")
            force_history_sync(const_name)
            break
    if total:
        st = state.get(key) if isinstance(state.get(key), dict) else {}
        old_min = st.get("minT")
        if deep_min is not None and (not isinstance(old_min, (int, float)) or deep_min < old_min):
            st["minT"] = deep_min
        st["complete"] = True
        st["pushed"] = (st.get("pushed") or 0) + total
        st["doneAt"] = int(time.time() * 1000)
        state[key] = st
        save_state(state)
    return total, deep_min


def server_coverage(url: str):
    """خريطة (أقدم شمعة + العدد لكل فريم) من الموقع — لكشف فقدان التاريخ"""
    j = get_status(url)
    if not j:
        return None
    return {
        "counts": j.get("counts") or {},
        "oldest": j.get("oldest") or {},
    }


def needs_refill(key: str, state: dict, cov) -> bool:
    """هل ينقص الموقع تاريخ هذا الفريم؟ (أقدم شمعة عنده أحدث مما سحبنا / عدد أقل)"""
    st = state.get(key) if isinstance(state.get(key), dict) else {}
    if not st.get("complete") or not isinstance(st.get("minT"), (int, float)):
        return True
    if not cov:
        return True
    oldest = (cov.get("oldest") or {}).get(key)
    count = (cov.get("counts") or {}).get(key) or 0
    if not isinstance(oldest, (int, float)) or count == 0:
        return True
    tf_ms = TF_SECONDS[key] * 1000
    return oldest > st["minT"] + tf_ms * 5  # الموقع فقد بداية ما رفعناه


def pull_all_deep(url: str, state: dict):
    """سحب التاريخ العميق الصبور لكل الفريمات — يتخطى ما هو مكتمل على الموقع"""
    print("=" * 60)
    print("  [التاريخ العميق] سحب كل شموع 2025 → اليوم من طرفيتك (حقيقي 100%)")
    print("  أول مرة قد يستغرق دقائق: الطرفية تحمّل التاريخ القديم من وسيطك")
    print("  في الخلفية وأنا أنتظر التحميل الفعلي شمعةً شمعة — لا محاكاة إطلاقاً")
    print("=" * 60)
    cov = server_coverage(url)
    grand = 0
    for key, const_name, _cnt in TF_MAP:
        try:
            if cov is not None and not needs_refill(key, state, cov):
                # التاريخ مرفوع كاملاً — لكن قد تبقى فجوة رأس (تحميل كسول لفريم 5m مثلاً)
                n, _mn = topup_head_tf(key, const_name, url, state)
                grand += n
                if not n:
                    print(f"  [{key}] تاريخ {TF_AR.get(key, key)} مكتمل على الموقع — تخطي")
                continue
            print(f"  [{key}] جاري السحب الصبور من 2025-01-01 ...")
            t0 = time.time()
            n, mn = pull_deep_tf(key, const_name, url, state)
            grand += n
            # بعد السحب الأساسي: هل تبقّت فجوة رأس؟ نعمّقها فوراً
            n2, _ = topup_head_tf(key, const_name, url, state)
            grand += n2
            mn_s = _date(mn) if mn else "—"
            print(f"  [OK] [{key}] اكتمل: {n + n2} شمعة حقيقية — أقدمها {mn_s} ({time.time() - t0:.0f}ث)")
        except KeyboardInterrupt:
            raise
        except Exception as e:
            print(f"  [{key}] خطأ غير متوقع: {e} — أتابع البقية")
    print(f"  [التاريخ العميق] انتهى — مجموع الشموع الحقيقية المرفوعة: {grand}")
    return grand


def history_worker(url: str, state: dict, no_backtest: bool):
    """خيط الخلفية: سحب التاريخ العميق + الفحص الذاتي الدوري.
    البث اللحظي في الخيط الرئيسي لا يتوقف أبداً — هذا الخيط يشاركه
    وصول MT5 عبر قفل آمن، وفشله لا يؤثر على البث إطلاقاً."""
    try:
        pull_all_deep(url, state)
        if not no_backtest:
            trigger_backtest(url)
        while True:
            time.sleep(SELF_CHECK_EVERY_S)
            try:
                cov = server_coverage(url)
                if cov is None:
                    continue
                gained = 0
                for key, const_name, _cnt in TF_MAP:
                    try:
                        if needs_refill(key, state, cov):
                            print(f"[i] الموقع ناقص تاريخ {key} — سحب صبور وإعادة رفع تلقائية")
                            n, _mn = pull_deep_tf(key, const_name, url, state)
                        else:
                            n, _mn = topup_head_tf(key, const_name, url, state)
                        if n:
                            print(f"[i] رُفع {n} شمعة حقيقية إضافية لـ {key}")
                            gained += n
                    except Exception as e:
                        print(f"[!] فحص تاريخ {key}: {e}")
                if gained and not no_backtest:
                    print("[i] تاريخ أعمق متوفر الآن — إعادة الباك تيست الحقيقي")
                    trigger_backtest(url)
            except Exception as e:
                print(f"[!] فحص التاريخ الدوري: {e}")
    except Exception as e:
        print(f"[!] خيط التاريخ توقف: {e} — البث اللحظي مستمر بلا تأثر")


def trigger_backtest(url: str):
    """تشغيل الباك تيست الحقيقي 2025→اليوم على الموقع وطباعة النتيجة هنا"""
    print("-" * 60)
    print("  [الباك تيست] تشغيل الباك تيست الحقيقي من 2025 حتى اليوم ...")
    print("  (قد يستغرق دقيقة إلى عدة دقائق حسب حجم التاريخ — لا تغلق النافذة)")
    data = json.dumps({"trigger": "bridge-v20"}).encode("utf-8")
    req = urllib.request.Request(
        url.rstrip("/") + "/api/backtest/auto",
        data=data,
        headers={"Content-Type": "application/json", "x-bfx-token": TOKEN},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=1200) as resp:
            j = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")[:300]
        except Exception:
            pass
        print(f"  [!] رفض الموقع تشغيل الباك تيست ({e.code}) {body}")
        print("      سيعاد تلقائياً عند الفحص الذاتي التالي")
        return None
    except Exception as e:
        print(f"  [!] تعذر الاتصال لتشغيل الباك تيست: {e}")
        return None

    if j.get("skipped"):
        print("  [i] الباك تيست الحقيقي محدّث منذ دقائق — النتيجة موجودة على الموقع")
        s = j.get("summary") or {}
        if s:
            print(f"      آخر نتيجة: {s.get('totalTrades')} صفقة — ربح {s.get('winRate')}% "
                  f"— صافي {s.get('netPnl')}$")
        return j

    cov = j.get("coverage") or {}
    s = j.get("summary") or {}
    print("  [OK] اكتمل الباك تيست الحقيقي وحُفظ على الموقع:")
    print(f"      التغطية الحقيقية: {_date(cov.get('fromMs'))} ← {_date(cov.get('toMs'))} "
          f"(رمز {cov.get('symbol')})")
    print(f"      الصفقات: {s.get('totalTrades')} — رابحة {s.get('wins')} — خاسرة {s.get('losses')} "
          f"— نسبة الربح {s.get('winRate')}%")
    print(f"      صافي الربح: {s.get('netPnl')}$ — أقصى تراجع: {s.get('maxDrawdownPct')}% "
          f"— معامل الربح: {s.get('profitFactor')}")
    return j


def tick_payload():
    """نبضة سعر خفيفة (Bid/Ask فقط) — نفس السعر الذي يرسمه شارت ميتاتريدر لحظياً.
    محمية ضد خطأ الساندبوكس المعطل عبر safe_tick التي تعيد الاتصال تلقائياً."""
    t = safe_tick()
    if t is None or not t.bid or not t.ask:
        return None
    tms = int(getattr(t, "time_msc", 0) or 0)
    return {
        "symbol": SYMBOL,
        "v": BRIDGE_V,
        "tick": {
            "bid": float(t.bid),
            "ask": float(t.ask),
            "time": tms if tms else int(t.time) * 1000,
        },
    }


def send_tick(url: str):
    """إرسال نبضة السعر الخفيفة — فشلها غير مؤثر لأن الدفعة الكاملة التالية تصحح كل شيء"""
    tp = tick_payload()
    if tp is None:
        return
    try:
        push(url, tp, timeout=15)
    except Exception:
        pass


def quick_live_push(url: str, acc):
    """دفعة حية كاملة فور التشغيل كي لا ينقطع بث الموقع أثناء سحب التاريخ"""
    tfs = build_tfs(True)
    tick = safe_tick()  # محمي ضد خطأ الساندبوكس المعطل
    acc_now = build_account()
    payload = {
        "symbol": SYMBOL,
        "v": BRIDGE_V,
        "tfs": tfs,
        "tick": (
            {"bid": float(tick.bid), "ask": float(tick.ask), "time": int(tick.time) * 1000}
            if tick is not None and tick.bid and tick.ask else None
        ),
        "positions": build_positions(),
        "deals": build_deals(),
    }
    if acc_now:
        payload["broker"] = acc_now["server"]
        payload["account"] = acc_now
    elif acc:
        payload["broker"] = acc.server
        payload["account"] = {
            "login": str(acc.login), "server": acc.server,
            "currency": acc.currency, "leverage": int(acc.leverage),
        }
    try:
        push(url, payload)
        n = sum(len(v) for v in tfs.values())
        print(f"[OK] دفعة حية أولى أُرسلت ({n} شمعة) — الموقع متصل الآن")
        return True
    except Exception as e:
        print(f"[!] تعذر إرسال الدفعة الأولى: {e} — سأتابع (الفحص الذاتي سيصلح أي نقص)")
        return False


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--url", default=DEFAULT_URL, help="عنوان موقع البوت")
    ap.add_argument("--symbol", default="", help="رمز الذهب عند وسيطك إن لم يُكتشف تلقائياً (مثال: XAUUSD.m)")
    ap.add_argument("--interval", type=int, default=2, help="الفاصل بالثواني بين كل دفعة (الحد الأدنى 2 — للبث اللحظي)")
    ap.add_argument("--path", default="", help="مسار terminal64.exe إن لم يُكتشف تلقائياً")
    ap.add_argument("--once", action="store_true", help="دفعة واحدة ثم خروج (للاختبار)")
    ap.add_argument("--no-history", action="store_true", help="تخطي سحب التاريخ العميق (بث حي فقط)")
    ap.add_argument("--no-backtest", action="store_true", help="تخطي تشغيل الباك تيست التلقائي بعد السحب")
    ap.add_argument("--refresh-history", action="store_true", help="إعادة سحب التاريخ العميق من 2025 كاملاً")
    args = ap.parse_args()

    interval = max(2, int(args.interval))
    now_str = lambda: time.strftime("%H:%M:%S")  # noqa: E731

    print("=" * 60)
    print("  BFX AURUM v20 - MT5 Live Bridge (Stream First + Background History)")
    print("  بث لحظي فوري + تاريخ 2025 في الخلفية + باك تيست تلقائي — حقيقي 100%")
    print("  الوجهة / Target:", args.url)
    print("=" * 60)

    # 1) الاتصال بالطرفية — يفتح MT5 تلقائياً إن كان مغلقاً
    connected = False
    if args.path:
        connected = mt5.initialize(args.path)
        if connected:
            _INITIALIZED_PATH = args.path
    if not connected:
        connected = mt5.initialize()
    if not connected:
        guess = find_terminal()
        if guess:
            print(f"[*] محاولة المسار: {guess}")
            connected = mt5.initialize(guess)
            if connected:
                _INITIALIZED_PATH = guess
    if not connected:
        print("[X] فشل الاتصال بطرفية MetaTrader 5 / Cannot connect to MT5")
        print("    السبب:", mt5.last_error())
        print("    - تأكد أن MetaTrader 5 مثبت على الجهاز وافتحه مرة واحدة")
        print("    - إن كان في مسار غير معتاد أضف: --path \"C:\\...\\terminal64.exe\"")
        print("    - إن ظهر خطأ 'sandbox is inactive':")
        print("      * أغلق طرفية MT5 كلياً من علامة X")
        print("      * أعد فتحها وسجّل الدخول (حتى حساب تجريبي Demo يكفي)")
        print("      * فعّل زر 'Algo Trading' الأخضر في شريط الأدوات")
        print("      * أعد تشغيل هذا الجسر")
        sys.exit(2)

    # قراءة معلومات الطرفية والحساب — محمية ضد خطأ الساندبوكس
    try:
        term = mt5.terminal_info()
    except Exception as e:
        print(f"[!] تعذّرت قراءة معلومات الطرفية: {e}")
        term = None
    try:
        acc = mt5.account_info()
    except Exception as e:
        if is_sandbox_inactive_error(e):
            print(f"[!] الساندبوكس معطل بعد التهيئة — أعيد الاتصال: {e}")
            reconnect_mt5()
            try:
                acc = mt5.account_info()
            except Exception:
                acc = None
        else:
            print(f"[!] تعذّرت قراءة معلومات الحساب: {e}")
            acc = None
    if term:
        print(f"[OK] الطرفية: {term.name} — بناء {term.build} — متصلة بالسيرفر: {bool(term.connected)}")
    if acc:
        print(f"[OK] الحساب: {acc.login} — {acc.server} — {acc.currency} — رافعة 1:{acc.leverage}")
        print(f"[OK] الرصيد الحقيقي: {acc.balance:.2f} {acc.currency} — حقوق الملكية: {acc.equity:.2f}")
    else:
        print("[!] تنبيه: لا يوجد حساب مسجّل الدخول في MT5")
        print("    افتح الطرفية وسجّل الدخول (حتى حساب تجريبي Demo يكفي) والبيانات ستبدأ تلقائياً")

    # 2) اختيار رمز الذهب
    if not pick_symbol(args.symbol):
        print("[X] لم أجد رمز الذهب (XAUUSD / GOLD) في هذه الطرفية")
        print("    أعد الأمر وأضف رمز وسيطك: --symbol XAUUSD.m")
        mt5.shutdown()
        sys.exit(3)
    print(f"[OK] رمز الذهب: {SYMBOL}")

    state = load_state()
    if args.refresh_history:
        state = {"__v": STATE_VERSION}
        save_state(state)
        print("[i] طُلب إعادة سحب التاريخ كاملاً — مسح حالة الاستئناف")

    # 3) دفعة حية فورية — البث لا ينقطع أبداً
    quick_live_push(args.url, acc)

    # 4) التاريخ العميق في خيط خلفية — البث اللحظي يبدأ فوراً ولا ينتظر أحداً
    if not args.no_history:
        th = threading.Thread(target=history_worker, args=(args.url, state, args.no_backtest), daemon=True)
        th.start()
        print("[i] سحب التاريخ العميق يعمل في الخلفية — الشارت يظهر الآن فوراً")

    print("-" * 60)
    print("[OK] جاهز — البث اللحظي يعمل الآن (شموع كل ثانيتين + نبضة سعر كل نصف ثانية)")
    print("     اترك هذه النافذة مفتوحة — الفحص الذاتي في الخلفية يكمل أي تاريخ ناقص")
    print("=" * 60)

    # 5) حلقة البث اللحظي
    cycle = 0
    force_full = True  # أول دفعة كاملة
    have_tfs = set()   # الفريمات التي وصلت بياناتها — الناقص يُطلب له 600 شمعة كل دورة
    try:
        while True:
            cycle += 1
            full = force_full or (cycle % FULL_EVERY == 0)
            missing = {k for k, _c, _n in TF_MAP} - have_tfs
            tfs = build_tfs(full, deep_counts=None if full else missing)
            have_tfs.update(tfs.keys())
            force_full = not tfs  # لا بيانات؟ أعد الدفعة الكاملة لاحقاً

            with MT5_LOCK:
                tick = safe_tick()
            if tick is None:
                # الساندبوكس معطل ولم يُعاد الاتصال — انتظر قليلاً وأعد المحاولة
                print(f"[{now_str()}] [!] نبضة السعر تعذّرت — الساندبوكس معطل، أعيد المحاولة بعد ثانيتين")
                time.sleep(2)
                force_full = True
                continue
            acc_now = build_account()   # الحساب الحقيقي كاملاً كل دورة
            positions = build_positions()
            # سجل الصفقات المنفذة: أول دورتين ثم كل 5 دورات (يخفف الحمل على الطرفية)
            deals = build_deals() if (cycle <= 2 or cycle % 5 == 0) else None

            payload = {
                "symbol": SYMBOL,
                "v": BRIDGE_V,
                "tfs": tfs,
                "tick": (
                    {"bid": float(tick.bid), "ask": float(tick.ask), "time": int(tick.time) * 1000}
                    if tick is not None and tick.bid and tick.ask else None
                ),
                "positions": positions,
            }
            if deals is not None:
                payload["deals"] = deals
            if acc_now:
                payload["broker"] = acc_now["server"]
                payload["account"] = acc_now
            elif acc:
                payload["broker"] = acc.server
                payload["account"] = {
                    "login": str(acc.login),
                    "server": acc.server,
                    "currency": acc.currency,
                    "leverage": int(acc.leverage),
                }

            try:
                res = push(args.url, payload)
                n = sum(len(v) for v in tfs.values())
                px = float(tick.bid) if tick is not None and tick.bid else 0.0
                mode = "كامل" if full else "تحديث"
                bal = f" — الرصيد {acc_now['balance']:.2f}" if acc_now else ""
                pos = f" — مفتوحة {len(positions)}" if positions else ""
                dls = f" — سجل {len(deals)}" if deals is not None else ""
                print(f"[{now_str()}] OK  أُرسلت {n} شمعة ({mode}) — الذهب {px:.2f}{bal}{pos}{dls}")
            except urllib.error.HTTPError as e:
                print(f"[{now_str()}] [!] رفض الموقع الطلب ({e.code}) — سأعيد المحاولة")
                force_full = True
            except Exception as e:
                print(f"[{now_str()}] [!] تعذر الإرسال: {e} — سأعيد المحاولة")
                force_full = True

            # الفحص الذاتي للتاريخ انتقل إلى خيط الخلفية history_worker —
            # حلقة البث تبقى خفيفة وسريعة ولا تتعطل أبداً

            if args.once:
                break
            # نبضة السعر اللحظية: نقسّم الفاصل إلى نبضات خفيفة (Bid/Ask فقط)
            # كي يتحرك السعر في شارت الموقع مع كل تغير سعر في ميتاتريدر
            for _ in range(TICK_STEPS):
                time.sleep(interval / TICK_STEPS)
                send_tick(args.url)
    except KeyboardInterrupt:
        print("\n[i] تم الإيقاف بناءً على طلبك / Stopped by user")
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
