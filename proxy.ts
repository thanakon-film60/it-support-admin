import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next.js 16 เปลี่ยนชื่อ "Middleware" เป็น "Proxy" (พฤติกรรมเดิมทุกอย่าง แค่เปลี่ยนชื่อไฟล์/คอนเวนชัน)
// ตรงนี้ทำแค่ "optimistic check" (เช็คว่ามี cookie session ไหม) เพื่อ redirect เร็วๆ ก่อนถึงหน้า
// ส่วนการตรวจสอบสิทธิ์จริง (verify JWT) ทำที่ src/lib/auth.ts -> requireSession() ซึ่งเรียกใน
// ทุกหน้า/ทุก Server Action อีกชั้นหนึ่งเสมอ ตามแนวทางที่ Next.js แนะนำ (อย่าพึ่ง proxy อย่างเดียว)
// /api/internal/* ไม่ได้ใช้ session cookie แต่ป้องกันด้วย INTERNAL_API_KEY แทน (ดู src/lib/internal-auth.ts)
// เพราะผู้เรียกคือ LINE Bot service ไม่ใช่เบราว์เซอร์ของแอดมิน — จะ login ไม่ได้อยู่แล้ว
const PUBLIC_PATHS = ["/login", "/api/line/webhook", "/api/internal", "/liff"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ปิดล็อกอินทั้งระบบ — ปล่อยผ่านทุก path (ดูคำเตือนความเสี่ยงที่ src/lib/auth.ts)
  // ส่งค่านี้ทั้ง build arg และ environment ใน docker-compose.yml เพราะ proxy/middleware
  // ของ Next อาจ inline ค่า env ตั้งแต่ตอน build ไม่ได้อ่านตอน runtime เสมอไป
  if (process.env.AUTH_DISABLED === "true") {
    return NextResponse.next();
  }

  if (
    isPublicPath(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has("itadmin_session");
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
