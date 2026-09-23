import fs from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /uploads/<...>  — เสิร์ฟไฟล์รูปที่ถูกอัปโหลด "ตอน runtime"
 *
 * ทำไมต้องมี route นี้ ทั้งที่ไฟล์อยู่ใน public/ อยู่แล้ว:
 *   Next.js อ่านรายชื่อไฟล์ในโฟลเดอร์ public/ "ตอนเซิร์ฟเวอร์เริ่มทำงาน" ครั้งเดียว
 *   ไฟล์ที่เขียนเพิ่มทีหลังจึงตอบ 404 จนกว่าจะ restart เซิร์ฟเวอร์
 *
 *   ยืนยันแล้วจริงบน Next.js 16.3.5 standalone (2026-09-15):
 *     อัปโหลด -> GET ได้ 404
 *     restart แล้ว GET ไฟล์เดิม -> 200
 *
 *   แปลว่าฟีเจอร์แนบรูปใน FAQ (src/app/actions/faq.ts -> saveImages) ก็โดนปัญหานี้มาตลอด
 *   แอดมินอัปโหลดรูปประกอบวิธีแก้ปัญหาแล้วรูปไม่ขึ้น จนกว่าจะบังเอิญมีการ restart container
 *   route นี้จึงครอบทั้ง /uploads/faq/* และ /uploads/tickets/* ในตัวเดียว แก้ทั้งสองจุดพร้อมกัน
 *
 *   (ถ้าวันหนึ่งย้ายไป Supabase Storage / S3 ให้ลบ route นี้ทิ้งได้เลย เพราะไฟล์จะไม่ได้อยู่บน
 *    ดิสก์ของแอปอีกต่อไป)
 */

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await context.params;

  // กัน path traversal 2 ชั้น:
  //   ชั้นแรก ปฏิเสธ segment ที่น่าสงสัยตรงๆ (".." หรือมีตัวคั่น path ปนมา)
  //   ชั้นสอง เทียบ path ที่ resolve แล้วว่ายังอยู่ใต้ UPLOAD_ROOT จริง (กันเคสที่ decode แล้วเปลี่ยนรูป)
  // ชั้นเดียวไม่พอ เพราะ %2e%2e%2f ถูก decode เป็น "../" ก่อนถึงตรงนี้ได้
  if (
    !segments?.length ||
    segments.some((s) => !s || s === "." || s === ".." || s.includes("/") || s.includes("\\") || s.includes("\0"))
  ) {
    return new Response("not found", { status: 404 });
  }

  const ext = path.extname(segments[segments.length - 1]).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) return new Response("not found", { status: 404 });

  const filePath = path.resolve(UPLOAD_ROOT, ...segments);
  if (filePath !== UPLOAD_ROOT && !filePath.startsWith(UPLOAD_ROOT + path.sep)) {
    return new Response("not found", { status: 404 });
  }

  let file: Buffer;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return new Response("not found", { status: 404 });
    file = fs.readFileSync(filePath);
  } catch {
    return new Response("not found", { status: 404 });
  }

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(file.length),
      // ชื่อไฟล์เป็น UUID ไม่มีวันถูกใช้ซ้ำกับเนื้อหาอื่น จึง cache ยาวได้อย่างปลอดภัย
      "Cache-Control": "public, max-age=31536000, immutable",
      // กันเบราว์เซอร์เดาชนิดไฟล์เอง (ถ้ามีไฟล์แปลกปลอมหลุดเข้ามาจะได้ไม่ถูกรันเป็น HTML/สคริปต์)
      "X-Content-Type-Options": "nosniff",
    },
  });
}
