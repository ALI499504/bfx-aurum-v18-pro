# ===== بناء Render — بيئة Docker =====
# المرحلة 1: تثبيت الاعتمادات وبناء Next.js (standalone)
FROM node:20-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# توليد عميل Prisma قبل البناء (schema داخل prisma/)
RUN npx prisma generate
# سكربت build في package.json: next build + نسخ static وpublic إلى standalone
RUN npm run build

# ===== المرحلة 2: صورة التشغيل النهائية =====
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Render يمرر PORT عبر البيئة — خادم standalone يحترمه تلقائياً
ENV PORT=3000 HOSTNAME=0.0.0.0
# Prisma SQLite — مسار نسبي إلى مجلد db داخل الحاوية
ENV DATABASE_URL="file:./db/custom.db"
RUN mkdir -p /app/db
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# ضمان وجود عميل Prisma ومحرك الاستعلام الثنائي (standalone قد يحذفهما أحياناً)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# زر الضابط الذاتي في الواجهة يشغّل bun scripts/tuner-run.ts — تحتاج bun والمصادر
RUN npm install -g bun
COPY --from=builder /app/scripts/tuner-run.ts ./scripts/tuner-run.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["node", "server.js"]
