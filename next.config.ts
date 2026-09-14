import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone output ทำให้ image ตอน build docker เล็กลงมาก (เอาเฉพาะไฟล์ที่ต้องใช้จริง
  // ตอนรัน ไม่ต้องแบก node_modules ทั้งหมดเข้า runtime image) — ดู Dockerfile
  output: "standalone",
};

export default nextConfig;
