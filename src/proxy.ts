import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, sessionFromToken } from "@/lib/session-token";
import { canAccess, uploadAreaPages } from "@/lib/access";

// Next.js 16 เปลี่ยนชื่อ "Middleware" เป็น "Proxy" (พฤติกรรมเดิมทุกอย่าง แค่เปลี่ยนชื่อไฟล์/คอนเวนชัน)
//
// ⚠️ ไฟล์นี้ต้องอยู่ที่ src/proxy.ts (ระดับเดียวกับ src/app) — เดิมวางไว้ที่ราก repo ซึ่ง Next "ข้ามไปเงียบๆ"
//    เพราะโปรเจกต์ใช้โฟลเดอร์ src (คู่มือ proxy: วางระดับเดียวกับ app) ผลคือด่านนี้ไม่เคยทำงานเลย:
//    ?from= หลังล็อกอินไม่เคยพากลับหน้าเดิม และรูปแนบใน /uploads ที่มีอยู่ตอนเซิร์ฟเวอร์เริ่ม
//    เปิดได้โดยไม่ต้องล็อกอิน (พบตอนทดสอบสิทธิ์รายหน้า ต.ค. 2026 — tests/access.test.cjs กันไว้แล้ว)
//
// หน้าที่ของไฟล์นี้:
//   1. /uploads/* — ตรวจ session จริง + สิทธิ์หน้า (ที่เดียวที่ต้องตรวจจริงที่นี่ เหตุผลอยู่ตรงเงื่อนไขข้างล่าง)
//   2. หน้าอื่น — "optimistic check" แค่ดูว่ามี cookie ไหม เพื่อพาไปล็อกอินพร้อมจำหน้าที่ขอ (?from=)
//      การตรวจจริง (ลายเซ็น + บัญชียังใช้ได้ + สิทธิ์รายหน้า) อยู่ที่ requireSession(page) ในทุกหน้า
//      และทุก Server Action เสมอ ตามที่คู่มือ Next.js กำชับ (อย่าพึ่ง proxy อย่างเดียว)
//
// /api/* ไม่ผ่านไฟล์นี้เลย (ดู matcher ท้ายไฟล์) — ทุก route ตรวจสิทธิ์เองอยู่แล้ว:
//   /api/internal/* ใช้ INTERNAL_API_KEY (ผู้เรียกคือบอท LINE ล็อกอินไม่ได้) · /api/drive/* ตอบ 401 เป็น JSON
//   (ถ้าโดน redirect หน้าเว็บจะได้ HTML แทน) · /api/health ต้องเปิดให้ deploy.ps1 ตรวจ
//   และที่สำคัญ: proxy บัฟเฟอร์ body ได้แค่ 10 MB แล้วตัดทิ้งเงียบๆ (ดู lib/drive-shared.ts)
//   การไม่ให้ API ผ่าน proxy จึงกันไฟล์แนบ/ท่อนอัปโหลดเสียแบบไม่มีใครรู้ไปด้วย

// หน้าที่เปิดได้โดยไม่ต้องล็อกอิน (ผู้ใช้ทั่วไปแจ้งเรื่องผ่าน LIFF / หน้า login เอง)
const PUBLIC_PATHS = ["/login", "/liff"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
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

  // รูปแนบ (/uploads/...) ต้องตรวจ "ของจริง" ที่นี่ ไม่ใช่แค่ดูว่ามี cookie:
  // ไฟล์ที่มีอยู่ตอนเซิร์ฟเวอร์เริ่ม Next เสิร์ฟตรงจาก public/ โดยไม่ผ่าน route handler เลย
  // (proxy ทำงานก่อนขั้น "Filesystem routes" ตามลำดับในคู่มือ proxy) — ถ้าตรวจแค่ cookie มีไหม
  // ใครใส่ cookie มั่วๆ ก็เปิดภาพหน้าจอที่ผู้ใช้แนบมากับ ticket ได้ (เจอจริงตอนทดสอบ ต.ค. 2026)
  if (pathname.startsWith("/uploads/")) {
    const session = await sessionFromToken(request.cookies.get(SESSION_COOKIE)?.value);
    const need = uploadAreaPages(pathname.split("/")[2]);
    if (!session || !need || !canAccess(session.pages, need)) {
      return new NextResponse("not found", { status: 404 });
    }
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    // เก็บ query ไปด้วย — ลิงก์แบบ /tickets?code=IT2026100001 (เปิดจากแชท) ล็อกอินแล้วต้องเปิดเรื่องนั้นต่อ
    // ปลายทางนี้ถูกตรวจซ้ำตอนล็อกอินเสร็จ (safeRedirectPath) จึงแต่ง ?from= ไปเว็บอื่นไม่ได้
    loginUrl.searchParams.set("from", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // ทุก path ยกเว้น /api/* (เหตุผลหัวไฟล์) และไฟล์ระบบของ Next — /uploads/* ต้องอยู่ในนี้เสมอ
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
