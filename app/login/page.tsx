import { Suspense } from 'react'
import { Metadata } from 'next'
import { LoginForm } from './login-form'

export const metadata: Metadata = {
  title: 'BFX AURUM v18 — تسجيل الدخول',
  description: 'أدخل كلمة المرور للوصول إلى بوت تداول الذهب XAUUSD',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0e17] flex items-center justify-center">
          <p className="text-[#6b809a]">جارٍ التحميل...</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
