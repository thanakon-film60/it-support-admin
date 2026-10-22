// ตัวช่วยฝั่ง HTTP ของคลังไฟล์ — ใช้ร่วมกันทุก route ใน app/api/drive
import { getSession, type SessionPayload } from "../auth";
import { DRIVE_HEADER } from "../drive-shared";
import { canAccess } from "../access";

export function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** ตรวจสิทธิ์ทุก request — route handler ไม่ได้อยู่ใต้ layout ของหน้าแอดมิน จึงไม่มีอะไรตรวจล็อกอินให้
 *
 *  ตอบ 401 เป็น JSON ไม่ redirect: ผู้เรียกคือโค้ดอัปโหลดในหน้าเว็บ ถ้า redirect ไปหน้า login มันจะได้ HTML
 *  กลับมาแทน JSON แล้วรายงานว่า "อัปโหลดล้ม" โดยไม่บอกว่าเพราะ session หมดอายุ
 *  คำขอที่เปลี่ยนข้อมูลต้องมี header ของเราด้วย (ดู DRIVE_HEADER) — กันหน้าเว็บอื่นแอบสั่งแทนแอดมิน */
export async function requireDriveSession(
  request: Request,
  { mutate }: { mutate: boolean }
): Promise<SessionPayload | Response> {
  if (mutate && request.headers.get(DRIVE_HEADER) !== "1") {
    return json(403, { error: "คำขอนี้ต้องมาจากหน้าคลังไฟล์เท่านั้น" });
  }
  const session = await getSession();
  if (!session) return json(401, { error: "ล็อกอินหมดอายุ — ล็อกอินใหม่แล้วลองอีกครั้ง" });
  // route handler ไม่ผ่าน requireSession ของหน้า /files — ต้องตรวจสิทธิ์หน้าเองที่นี่
  if (!canAccess(session.pages, "files")) {
    return json(403, { error: "บัญชีนี้ไม่มีสิทธิ์ใช้คลังไฟล์ — ติดต่อผู้ดูแลระบบ IT" });
  }
  return session;
}

export function writerOf(session: SessionPayload): string {
  return session.displayName?.trim() || session.username;
}

/** Content-Disposition ที่ชื่อภาษาไทยไม่เพี้ยน: filename* (UTF-8) สำหรับเบราว์เซอร์ปัจจุบัน
 *  + filename แบบ ASCII เป็นทางสำรอง · attachment เสมอ ห้าม inline — ไฟล์ HTML/SVG ที่ใครอัปโหลดขึ้นมา
 *  ถ้าเปิดในหน้าเว็บโดเมนเดียวกับแอดมินได้ สคริปต์ข้างในจะทำงานด้วยสิทธิ์ของแอดมินที่เปิดดู */
export function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_") || "download";
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** อ่าน header Range แบบช่วงเดียว (bytes=start-end) — ทำให้เบราว์เซอร์ดาวน์โหลดต่อจากที่ค้างได้
 *  null = ไม่มี/ไม่รองรับ (ส่งทั้งไฟล์) · "invalid" = ช่วงเกินขนาดไฟล์ (ตอบ 416) */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    // bytes=-500 = 500 ไบต์สุดท้าย
    const suffix = Number(match[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    return "invalid";
  }
  return { start, end };
}
