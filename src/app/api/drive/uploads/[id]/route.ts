/**
 * PUT    /api/drive/uploads/<id>?offset=N — ส่งไฟล์ 1 ท่อน (≤ 8 MB) เริ่มที่ตำแหน่ง N
 * GET    /api/drive/uploads/<id>          — ได้รับไปแล้วกี่ไบต์ (ไว้ส่งต่อจากที่ค้าง)
 * DELETE /api/drive/uploads/<id>          — ยกเลิก ลบท่อนที่ส่งมาแล้วทิ้ง
 *
 * ท่อนเดียวกันอาจมาซ้ำได้เสมอ (เน็ตหลุดหลังเซิร์ฟเวอร์เขียนเสร็จแต่ก่อนเบราว์เซอร์ได้คำตอบ แล้วกดส่งใหม่)
 * จึงตัดสินจาก offset: ตรงกับที่มีอยู่ = ต่อท้าย · อยู่ในช่วงที่มีแล้ว = ได้แล้ว ไม่เขียนซ้ำ · กระโดดข้าม = 409
 * พร้อมบอกตำแหน่งจริง ให้หน้าเว็บส่งต่อจากตรงนั้น — ไม่มีทางที่ไฟล์จะมีท่อนซ้ำหรือรูกลางไฟล์
 */
import { getUpload, removeUpload } from "@/lib/db/drive";
import { DRIVE_CHUNK_BYTES } from "@/lib/drive-shared";
import { appendPart, discardPart, isDriveId, partSize } from "@/lib/drive/storage";
import { json, requireDriveSession } from "@/lib/drive/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const GONE = "การอัปโหลดนี้หมดอายุหรือถูกยกเลิกแล้ว — เริ่มอัปโหลดไฟล์นี้ใหม่";

export async function PUT(request: Request, { params }: Ctx) {
  const session = await requireDriveSession(request, { mutate: true });
  if (session instanceof Response) return session;
  const { id } = await params;
  if (!isDriveId(id)) return json(400, { error: "รหัสการอัปโหลดไม่ถูกต้อง" });

  const offset = Number(new URL(request.url).searchParams.get("offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) return json(400, { error: "ตำแหน่งไม่ถูกต้อง" });

  let upload;
  try {
    upload = getUpload(id);
  } catch {
    return json(500, { error: "อ่านข้อมูลคลังไฟล์ไม่ออก" });
  }
  if (!upload) return json(410, { error: GONE });

  const chunk = new Uint8Array(await request.arrayBuffer());
  if (chunk.length === 0) return json(400, { error: "ท่อนข้อมูลว่าง" });
  if (chunk.length > DRIVE_CHUNK_BYTES) return json(413, { error: "ท่อนข้อมูลใหญ่เกินกำหนด" });
  // ตรวจว่าได้ครบตามที่เบราว์เซอร์บอกว่าส่ง — กันกรณีมีตัวกลาง (proxy) ตัด body ทิ้งเงียบๆ
  // ถ้าไม่ตรวจ ไฟล์จะสั้นลงทีละนิดแล้ว "อัปโหลดสำเร็จ" ทั้งที่ไฟล์เสีย ซึ่งรู้ตัวอีกทีตอนติดตั้งโปรแกรมไม่ขึ้น
  const declared = Number(request.headers.get("x-chunk-length"));
  if (!Number.isSafeInteger(declared) || declared !== chunk.length) {
    return json(400, { error: "ข้อมูลท่อนนี้มาไม่ครบ — กำลังส่งใหม่", retry: true });
  }

  const current = partSize(id);
  if (current === null) return json(410, { error: GONE });
  if (offset === current) {
    if (current + chunk.length > upload.size) return json(400, { error: "ข้อมูลเกินขนาดไฟล์ที่แจ้งไว้" });
    return json(200, { received: appendPart(id, chunk) });
  }
  if (offset + chunk.length <= current) return json(200, { received: current });
  return json(409, { error: "ตำแหน่งไม่ตรงกับที่เซิร์ฟเวอร์ได้รับ", received: current });
}

export async function GET(request: Request, { params }: Ctx) {
  const session = await requireDriveSession(request, { mutate: false });
  if (session instanceof Response) return session;
  const { id } = await params;
  if (!isDriveId(id)) return json(400, { error: "รหัสการอัปโหลดไม่ถูกต้อง" });
  const received = partSize(id);
  if (received === null) return json(410, { error: GONE });
  return json(200, { received });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const session = await requireDriveSession(request, { mutate: true });
  if (session instanceof Response) return session;
  const { id } = await params;
  if (!isDriveId(id)) return json(400, { error: "รหัสการอัปโหลดไม่ถูกต้อง" });
  try {
    removeUpload(id);
  } catch {
    return json(500, { error: "อ่านข้อมูลคลังไฟล์ไม่ออก" });
  }
  discardPart(id);
  return json(200, { ok: true });
}
