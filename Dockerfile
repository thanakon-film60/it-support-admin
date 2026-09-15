# syntax=docker/dockerfile:1

# ---- deps: ติดตั้ง dependency อย่างเดียว แยก layer เพื่อให้ cache โดนใช้ซ้ำเวลาแก้แค่โค้ด ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: build production build ของ Next.js ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* ถูก inline เข้า client bundle ตอน build เท่านั้น (ไม่ใช่ runtime) ต้องส่งผ่าน
# build arg ตรงนี้ — ถ้าแก้ค่านี้ทีหลังต้อง build image ใหม่เสมอ แค่ restart container ไม่พอ
ARG NEXT_PUBLIC_LIFF_ID=""
ENV NEXT_PUBLIC_LIFF_ID=$NEXT_PUBLIC_LIFF_ID
# proxy.ts (middleware ของ Next) อาจ inline ค่า env ตั้งแต่ตอน build ไม่ได้อ่านตอน runtime
# จึงต้องส่ง AUTH_DISABLED เข้ามาตรงนี้ด้วย ไม่ใช่แค่ใน environment ของ compose
ARG AUTH_DISABLED="false"
ENV AUTH_DISABLED=$AUTH_DISABLED
RUN npm run build

# ---- runner: image สุดท้ายที่ใช้รันจริง เอาเฉพาะ standalone output ทำให้ image เล็กลงมาก ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# ต้องสร้างโฟลเดอร์นี้พร้อมตั้งเจ้าของไว้ใน image ก่อน เพราะ docker-compose.yml เอา named volume
# มา mount ทับตรงนี้ — volume ที่ยังว่างจะ "สืบทอด" สิทธิ์ของโฟลเดอร์เดิมใน image ถ้าไม่มี
# โฟลเดอร์อยู่ก่อน docker จะสร้างให้โดยเจ้าของเป็น root แล้ว user nextjs จะเขียนรูป FAQ ไม่ได้
RUN mkdir -p ./public/uploads/faq && chown -R nextjs:nodejs ./public/uploads

# เหตุผลเดียวกับข้างบนเป๊ะๆ แต่สำหรับ src/lib/db/store.ts ซึ่งเป็น mock data store จริงที่ใช้งาน
# อยู่ตอนนี้ (ticket/user/stock/equipment ทั้งหมด — pg.ts ยังไม่ได้ต่อใช้งานจริง) เขียนไฟล์ JSON ลง
# process.cwd()/data คือ /app/data ใน container นี้ — เดิมไม่มีบรรทัดนี้เลย ทำให้ user nextjs (non-root)
# mkdir ไม่ได้ (EACCES) แอปพังทันทีทุก endpoint ที่แตะข้อมูล ต้องมี mount เป็น named volume ด้วยเสมอ
# (ดู docker-compose.yml ตัวแปร app_data) ไม่งั้นข้อมูลทั้งหมดหายทุกครั้งที่ build image ใหม่
RUN mkdir -p ./data && chown -R nextjs:nodejs ./data

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
