// بوابة الدخول — صفحة كلمة السر (بطلب السيد: لا يفتح الموقع إلا بكلمة سره)

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ e?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const errored = sp.e === '1';
  const next = sp.next && sp.next.startsWith('/') && !sp.next.startsWith('//') ? sp.next : '/';

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0a0e17] px-4"
      style={{ fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif" }}>
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-[#2a3450] bg-[#0d1322] shadow-2xl overflow-hidden">
          <div className="px-6 py-5 border-b border-[#1c2438] flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#d9b45c] to-[#a8842f] flex items-center justify-center text-[#0a0e17] text-lg font-black">Au</span>
            <div>
              <div className="text-[15px] font-bold text-[#e9edf4]" dir="ltr">BFX AURUM <span className="text-[#d9b45c]">v18 PRO</span></div>
              <div className="text-[11px] text-[#8b94a8]">منصة بوت الذهب XAUUSD الخاصة</div>
            </div>
          </div>
          <div className="px-6 py-6">
            <p className="text-[12.5px] text-[#aeb6c6] leading-6 mb-4">
              هذه المنصة خاصة بالمالك ومدعوينه فقط — أدخل كلمة السر للمتابعة.
            </p>
            {errored && (
              <div className="mb-4 rounded-lg border border-[#5a2a2a] bg-[#2a1212] px-3 py-2.5 text-[12px] text-[#ff8a8a]">
                كلمة السر غير صحيحة — حاول مرة أخرى.
              </div>
            )}
            <form method="POST" action="/api/auth/gate" className="flex flex-col gap-3">
              <input type="hidden" name="next" value={next} />
              <input
                type="password" name="password" required autoFocus autoComplete="current-password"
                placeholder="كلمة السر" dir="ltr"
                className="w-full rounded-lg border border-[#2a3450] bg-[#0a0e17] px-3.5 py-2.5 text-[14px] text-[#e9edf4] outline-none focus:border-[#d9b45c] transition-colors placeholder:text-[#5c6579]"
              />
              <button type="submit"
                className="w-full rounded-lg bg-gradient-to-b from-[#e0bc64] to-[#b08c34] text-[#0a0e17] font-bold text-[14px] py-2.5 hover:brightness-110 active:brightness-95 transition-all">
                دخول
              </button>
            </form>
          </div>
          <div className="px-6 py-3 border-t border-[#1c2438] text-center text-[10.5px] text-[#5c6579]">
            الجلسة تبقى مفتوحة 30 يوماً على هذا المتصفح
          </div>
        </div>
      </div>
    </main>
  );
}
