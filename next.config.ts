import type { NextConfig } from "next";

/** หัวข้อความปลอดภัยที่ใส่ให้ทุก path
 *
 *  ต่างจากการกัน F12 ตรงที่ "หัวพวกนี้ทำงานจริงและเลี่ยงไม่ได้จากฝั่งเบราว์เซอร์"
 *  เพราะเป็นคำสั่งที่เซิร์ฟเวอร์บอกเบราว์เซอร์ตรงๆ ไม่ใช่โค้ดที่รันในหน้าเว็บ
 *  สำคัญเป็นพิเศษกับระบบนี้ เพราะเปิดสู่อินเทอร์เน็ตผ่าน Tailscale Funnel โดยไม่มีล็อกอิน
 */
const SECURITY_HEADERS = [
  // ห้ามเว็บอื่นเอาหน้านี้ไปซ้อนใน iframe แล้วหลอกให้กดปุ่ม (clickjacking)
  // ใช้ SAMEORIGIN ไม่ใช่ DENY เผื่อวันหน้ามีหน้าไหนในระบบเดียวกันต้องฝัง iframe ของตัวเอง
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },

  // ห้ามเบราว์เซอร์เดาชนิดไฟล์เอง — กันไฟล์แนบที่ผู้ใช้อัปโหลดถูกตีความเป็นสคริปต์
  { key: "X-Content-Type-Options", value: "nosniff" },

  // ออกไปเว็บนอกแล้วอย่าส่ง path ติดไปด้วย (URL ของระบบนี้เองก็ถือเป็นความลับระดับหนึ่ง)
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // ระบบนี้ไม่ใช้กล้อง/ไมค์/ตำแหน่ง เลยปิดทิ้งทั้งหมด
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },

  // อย่าให้ Google เก็บหน้านี้เข้าดัชนี — URL สาธารณะ + ไม่มีล็อกอิน = ข้อมูลพนักงาน
  // 182 คนอาจโผล่ในผลค้นหาได้จริง ข้อนี้คุ้มค่าที่สุดในไฟล์นี้
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  // จำเป็นสำหรับ Dockerfile (runner stage COPY --from=builder /app/.next/standalone ./)
  // ถ้าไม่ตั้งค่านี้ next build จะไม่สร้างโฟลเดอร์ .next/standalone เลย ทำให้ docker build
  // พังตอน COPY เพราะหาไฟล์ไม่เจอ (เจอจริงตอน build 2026-09-14 — ต้นเหตุคือค่านี้ขาดมาตั้งแต่แรก)
  output: "standalone",

  // ไม่ต้องประกาศให้โลกรู้ว่าใช้ Next.js เวอร์ชันไหน — ลดข้อมูลให้คนสแกนช่องโหว่
  poweredByHeader: false,

  // ห้ามแนบ source map ของ production ไปกับหน้าเว็บ (ค่าตั้งต้นคือ false อยู่แล้ว
  // แต่เขียนไว้ชัดๆ เพราะมันคือสิ่งที่ทำให้ "เปิด DevTools แล้วอ่านโค้ดต้นฉบับได้ทั้งโปรเจกต์")
  productionBrowserSourceMaps: false,

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
