/**
 * POST /api/drive/uploads/<id>/complete — ส่งครบทุกท่อนแล้ว: ตรวจขนาด ทำ SHA-256 แล้วขึ้นรายการคลังไฟล์
 *
 * ไฟล์ปรากฏในหน้าเว็บก็ต่อเมื่อขนาดตรงกับที่แจ้งไว้ตอนเริ่มทุกไบต์เท่านั้น — ไฟล์ติดตั้งโปรแกรมที่ขาดไปแม้แต่
 * ไม่กี่ไบต์จะเปิดไม่ขึ้น และคนจะโทษโปรแกรมแทนที่จะสงสัยว่าอัปโหลดไม่ครบ
 */
import { randomUUID } from "node:crypto";
import { addFile, getFolder, getUpload, removeUpload } from "@/lib/db/drive";
import { commitPart, deleteBlob, isDriveId, partSize } from "@/lib/drive/storage";
import { json, requireDriveSession } from "@/lib/drive/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireDriveSession(request, { mutate: true });
  if (session instanceof Response) return session;
  const { id } = await params;
  if (!isDriveId(id)) return json(400, { error: "รหัสการอัปโหลดไม่ถูกต้อง" });

  let upload;
  try {
    upload = getUpload(id);
  } catch {
    return json(500, { error: "อ่านข้อมูลคลังไฟล์ไม่ออก" });
  }
  if (!upload) return json(410, { error: "การอัปโหลดนี้หมดอายุหรือถูกยกเลิกแล้ว — เริ่มอัปโหลดไฟล์นี้ใหม่" });

  const received = partSize(id);
  if (received !== upload.size) {
    return json(409, { error: "ไฟล์ยังส่งมาไม่ครบ", received: received ?? 0 });
  }

  const fileId = randomUUID();
  let sha256: string;
  try {
    sha256 = await commitPart(id, fileId);
  } catch (err) {
    console.error("[drive] ย้ายไฟล์เข้าคลังไม่สำเร็จ", err);
    return json(500, { error: "บันทึกไฟล์ไม่สำเร็จ — ลองอัปโหลดใหม่" });
  }
  try {
    addFile({
      id: fileId,
      // โฟลเดอร์ถูกลบระหว่างอัปโหลดไม่ได้ (deleteFolder กันไว้) แต่ถ้าเกิดจริงให้ไปอยู่ชั้นบนสุด ดีกว่าทำไฟล์หาย
      folder_id: upload.folder_id && getFolder(upload.folder_id) ? upload.folder_id : null,
      name: upload.name,
      size: upload.size,
      mime: upload.mime,
      note: null,
      sha256,
      uploaded_at: new Date().toISOString(),
      uploaded_by: upload.created_by,
      updated_at: null,
      updated_by: null,
    });
    removeUpload(id);
  } catch (err) {
    // ไม่มีรายการชี้มา = ไฟล์บนดิสก์กลายเป็นของกำพร้าที่ไม่มีใครเห็น ลบทิ้งดีกว่าปล่อยกินที่
    console.error("[drive] บันทึกรายการไฟล์ไม่สำเร็จ", err);
    deleteBlob(fileId);
    return json(500, { error: "บันทึกรายการไฟล์ไม่สำเร็จ — ลองอัปโหลดใหม่" });
  }
  return json(200, { ok: true, fileId });
}
