// اختبار معزول لمنطق دمج الحساب في mt5feed — لا يمس السيرفر الحي إطلاقاً
import { ingestMt5, getMt5Status } from '../src/lib/server/mt5feed';

let fails = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}`);
  if (!cond) fails++;
};

// 1) دفعة حساب كامل (v18 يعمل بشكل طبيعي)
ingestMt5({
  v: 18,
  account: { login: '2002191205', server: 'JustMarkets-Demo', currency: 'USD', leverage: 3000, balance: 10000.0, equity: 10125.5, margin: 150.0, marginFree: 9975.5, marginLevel: 6750.0, profit: 125.5 },
});
let s = getMt5Status();
check('تخزين الرصيد من دفعة كاملة', s.account?.balance === 10000.0);
check('تخزين حقوق الملكية', s.account?.equity === 10125.5);
check('bridgeV = 18', s.bridgeV === 18);

// 2) دفعة ناقصة (محاكاة تعثر قراءة لحظية) — الرصيد يجب أن يبقى
ingestMt5({
  v: 18,
  account: { login: '2002191205', server: 'JustMarkets-Demo', currency: 'USD', leverage: 3000 },
});
s = getMt5Status();
check('الرصيد لا يُمسح بعد دفعة ناقصة (نفس الحساب)', s.account?.balance === 10000.0);
check('حقوق الملكية لا تُمسح', s.account?.equity === 10125.5);
check('الهامش الحر لا يُمسح', s.account?.marginFree === 9975.5);

// 3) تحديث فعلي بقيم جديدة — القيم الجديدة تغلب القديمة
ingestMt5({
  v: 18,
  account: { login: '2002191205', server: 'JustMarkets-Demo', currency: 'USD', leverage: 3000, balance: 10050.0, equity: 10040.0 },
});
s = getMt5Status();
check('القيمة الجديدة تغلب القديمة (balance)', s.account?.balance === 10050.0);
check('القيمة الجديدة تغلب القديمة (equity)', s.account?.equity === 10040.0);
check('الهامش يبقى من آخر قراءة كاملة', s.account?.margin === 150.0);

// 4) شموع تبث بالتوازي ولا تتأثر بدمج الحساب
ingestMt5({ v: 18, tfs: { '5m': [[1704067200000, 2060, 2065, 2055, 2062, 100], [1704075000000, 2062, 2070, 2061, 2068, 120]] } });
ingestMt5({ v: 18, account: { login: '2002191205', server: 'JustMarkets-Demo', currency: 'USD', leverage: 3000 } });
s = getMt5Status();
check('شموع 5m محفوظة', s.counts['5m'] === 2);
check('الرصيد ما زال موجوداً مع بث الشموع', s.account?.balance === 10050.0);

// 5) جسر قديم بلا حقل v — bridgeV يبقى بآخر قيمة معروفة (لا تراجع)
ingestMt5({ account: { login: '2002191205', server: 'JustMarkets-Demo', currency: 'USD', leverage: 3000 } });
s = getMt5Status();
check('bridgeV يبقى 18 بعد دفعة بلا v', s.bridgeV === 18);

process.exit(fails ? 1 : 0);
