/**
 * POST /api/drive/uploads — เริ่มอัปโหลดไฟล์ 1 ไฟล์ (คลังไฟล์ /files)
 *
 * ไฟล์ไม่ได้ถูกส่งมาใน request นี้ — request นี้แค่ "จองที่" แล้วคืน uploadId
 * จากนั้นหน้าเว็บส่งไฟล์เป็นท่อนละ 8 MB ไปที่ PUT /api/drive/uploads/<id> แล้วปิดท้ายด้วย .../complete
 * เหตุผลที่ต้องแบ่งท่อนอยู่ที่ DRIVE_CHUNK_BYTES ใน lib/drive-shared.ts
 *
 * ตรวจทุกอย่างที่ทำให้อัปโหลดไม่สำเร็จไว้ตรงนี้ "ก่อน" ส่งไฟล์ (ขนาด · โควตา · ดิสก์ · โฟลเดอร์)
 * ไม่งั้นคนจะรอส่งไฟล์ 500 MB จนเกือบเสร็จแล้วค่อยมารู้ว่าที่เต็ม
 */
import { randomUUID } from "node:crypto";
import { addUpload, getFolder, removeUpload, reservedBytes, takeStaleUploads } from "@/lib/db/drive";
import { CollectionReadError } from "@/lib/db/store";
import { DRIVE_CHUNK_BYTES, DRIVE_MAX_FILE_BYTES, cleanDriveName, formatBytes } from "@/lib/drive-shared";
import { discardPart, FREE_SPACE_RESERVE, freeBytes, isDriveId, quotaBytes, startPart } from "@/lib/drive/storage";
import { json, requireDriveSession, writerOf } from "@/lib/drive/http";

export const dynamic = "force-dynamic";

const MIME = /^[\w.+-]+\/[\w.+-]+$/;

export async function POST(request: Request) {
  const session = await requireDriveSession(request, { mutate: true });
  if (session instanceof Response) return session;

  let body: { name?: unknown; size?: unknown; type?: unknown; folderId?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "ข้อมูลไม่ถูกต้อง" });
  }

  const name = cleanDriveName(body?.name);
  if (!name.ok) return json(400, { error: name.error });
  const size = body?.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    return json(400, { error: "ขนาดไฟล์ไม่ถูกต้อง" });
  }
  if (size > DRIVE_MAX_FILE_BYTES) {
    return json(413, { error: `ไฟล์ใหญ่ ${formatBytes(size)} เกินเพดาน ${formatBytes(DRIVE_MAX_FILE_BYTES)} ต่อไฟล์` });
  }
  const folderId = body?.folderId ?? null;
  if (folderId !== null && !isDriveId(folderId)) return json(400, { error: "โฟลเดอร์ปลายทางไม่ถูกต้อง" });

  try {
    if (folderId && !getFolder(folderId)) {
      return json(404, { error: "ไม่พบโฟลเดอร์ปลายทาง (อาจถูกลบจากอีกเครื่อง)" });
    }
    // เก็บกวาดการอัปโหลดที่ถูกทิ้งไว้ก่อนคิดโควตา ไม่งั้นของค้างจะกินโควตาจนอัปโหลดใหม่ไม่ได้
    for (const id of takeStaleUploads()) discardPart(id);

    const quota = quotaBytes();
    const reserved = reservedBytes();
    if (reserved + size > quota) {
      return json(507, {
        error: `คลังไฟล์เต็ม — ใช้ไป ${formatBytes(reserved)} จาก ${formatBytes(quota)} ลบไฟล์ที่ไม่ใช้แล้วก่อน`,
      });
    }
    const free = freeBytes();
    if (free !== null && free - size < FREE_SPACE_RESERVE) {
      return json(507, {
        error: `ดิสก์ของเครื่องเซิร์ฟเวอร์เหลือ ${formatBytes(free)} — ไม่พอสำหรับไฟล์นี้ (ต้องเหลือที่ไว้ให้ระบบอื่นด้วย)`,
      });
    }

    const id = randomUUID();
    addUpload({
      id,
      folder_id: folderId,
      name: name.name,
      size,
      mime: typeof body?.type === "string" && MIME.test(body.type) ? body.type.slice(0, 100) : "application/octet-stream",
      created_at: new Date().toISOString(),
      created_by: writerOf(session),
    });
    try {
      startPart(id);
    } catch (err) {
      removeUpload(id);
      throw err;
    }
    return json(201, { uploadId: id, chunkSize: DRIVE_CHUNK_BYTES, received: 0 });
  } catch (err) {
    console.error("[drive] เริ่มอัปโหลดไม่สำเร็จ", err);
    if (err instanceof CollectionReadError) {
      return json(500, { error: "อ่านข้อมูลคลังไฟล์ไม่ออก (ไฟล์ JSON เสีย) จึงยังไม่รับไฟล์ใหม่ — กู้จาก backup ก่อน" });
    }
    return json(500, { error: "เริ่มอัปโหลดไม่สำเร็จ — ลองอีกครั้ง" });
  }
}
