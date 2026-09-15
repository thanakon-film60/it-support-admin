import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // จำเป็นสำหรับ Dockerfile (runner stage COPY --from=builder /app/.next/standalone ./)
  // ถ้าไม่ตั้งค่านี้ next build จะไม่สร้างโฟลเดอร์ .next/standalone เลย ทำให้ docker build
  // พังตอน COPY เพราะหาไฟล์ไม่เจอ (เจอจริงตอน build 2026-09-14 — ต้นเหตุคือค่านี้ขาดมาตั้งแต่แรก)
  output: "standalone",
};

export default nextConfig;
