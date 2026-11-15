import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// SQLite فقط: إذا كانت DATABASE_URL من بيئة الاستضافة لا تبدأ بـ file:
// (مثلاً PostgreSQL محقون من ربط قاعدة بيانات على Render) نتجاهلها ونستخدم
// ملف القاعدة الداخلي للحاوية — إعداد Dockerfile هو المرجع دائماً
const dbUrl = process.env.DATABASE_URL?.startsWith('file:')
  ? process.env.DATABASE_URL
  : 'file:/app/db/custom.db'

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: dbUrl } },
    // في الإنتاج: الأخطاء والتحذيرات فقط — تسجيل كل استعلام يبطئ الخادم ويضخّم ملفات اللوج
    log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
