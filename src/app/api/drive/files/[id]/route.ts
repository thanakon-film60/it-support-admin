/**
 * GET /api/drive/files/<id> — ดาวน์โหลดไฟล์จากคลังไฟล์ (ต้องล็อกอิน)
 *
 * ส่งแบบ stream ไม่อ่านทั้งไฟล์เข้าหน่วยความจำ (ไฟล์ละถึง 500 MB) และรองรับ Range
 * เบราว์เซอร์จึงดาวน์โหลดต่อจากที่ค้างได้เมื่อเน็ตหลุด แทนที่จะเริ่มใหม่จากศูนย์
 */
import { Readable } from "node:stream";
import { getSession } from "@/lib/auth";
import { NO_ACCESS_PATH, canAccess } from "@/lib/access";
import { getFile } from "@/lib/db/drive";
import { blobSize, isDriveId, openBlob } from "@/lib/drive/storage";
import { contentDisposition, parseRange } from "@/lib/drive/http";

export const dynamic = "force-dynamic";

function text(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // ลิงก์ดาวน์โหลดถูกเปิดตรงจากเบราว์เซอร์ — ยังไม่ล็อกอินให้พาไปหน้า login แทนการโชว์ JSON error
  const session = await getSession();
  if (!session) {
    return Response.redirect(new URL("/login?from=/files", request.url), 307);
  }
  // ลิงก์ไฟล์ถูกส่งต่อกันในแชทได้ — ล็อกอินอยู่แต่ไม่มีสิทธิ์หน้าคลังไฟล์ = ห้ามดาวน์โหลด
  if (!canAccess(session.pages, "files")) {
    return Response.redirect(new URL(NO_ACCESS_PATH, request.url), 307);
  }
  const { id } = await params;
  if (!isDriveId(id)) return text(400, "รหัสไฟล์ไม่ถูกต้อง");

  let file;
  try {
    file = getFile(id);
  } catch {
    return text(500, "อ่านข้อมูลคลังไฟล์ไม่ออก");
  }
  if (!file) return text(404, "ไม่พบไฟล์นี้ (อาจถูกลบไปแล้ว)");
  const size = blobSize(id);
  if (size === null) return text(404, "ไฟล์ต้นฉบับหายจากดิสก์ของเซิร์ฟเวอร์ — ต้องอัปโหลดใหม่");

  const headers: Record<string, string> = {
    // octet-stream เสมอ ไม่ใช้ชนิดที่ผู้อัปโหลดบอกมา — กันเบราว์เซอร์เปิดไฟล์ HTML/SVG ขึ้นมาทำงานในหน้าเว็บ
    "Content-Type": "application/octet-stream",
    "Content-Disposition": contentDisposition(file.name),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
  };
  if (file.sha256) headers.ETag = `"${file.sha256}"`;

  const range = parseRange(request.headers.get("range"), size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  if (size === 0) return new Response(new Uint8Array(0), { status: 200, headers: { ...headers, "Content-Length": "0" } });

  const stream = Readable.toWeb(openBlob(id, range ?? undefined)) as ReadableStream<Uint8Array>;
  if (range) {
    return new Response(stream, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    });
  }
  return new Response(stream, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}
