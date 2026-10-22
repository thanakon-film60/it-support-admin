// ตัวไฟล์จริงของคลังไฟล์ — โมดูลเดียวที่แตะโฟลเดอร์ DRIVE_DIR
//
// ทำไมไม่เก็บใน data/ ข้าง JSON อื่นๆ: backup.bat คัดลอก /app/data ทั้งก้อนเข้าโฟลเดอร์ backups/ ของโปรเจกต์
// ทุกครั้ง ไฟล์ขนาดหลายร้อย MB จะทำให้ backup ช้าและใหญ่ขึ้นเรื่อยๆ และโฟลเดอร์ backups/ เคยถูก commit
// ขึ้น GitHub มาแล้ว — ไฟล์ของบริษัทจะหลุดตามไปด้วย จึงแยกเป็น docker volume ของตัวเอง (DRIVE_DIR)
//
// ชื่อไฟล์บนดิสก์คือ id (UUID) เสมอ ไม่ใช้ชื่อที่ผู้ใช้ตั้ง — ชื่อจริงอยู่ใน data/drive_files.json
// ผลคือไม่มีทางที่ชื่อไฟล์แปลกๆ (../ , ภาษาไทย, ตัวอักษรที่ Windows ห้าม) จะพาไปเขียนนอกโฟลเดอร์นี้ได้

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDriveId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** อ่านตอนเรียก ไม่ใช่ตอน import — เทสต์กับเครื่อง dev ตั้งค่าเองได้โดยไม่ต้องโหลดโมดูลใหม่ */
export function driveRoot(): string {
  return path.resolve(process.env.DRIVE_DIR || path.join(process.cwd(), "drive"));
}

function sub(name: "blobs" | "parts"): string {
  const dir = path.join(driveRoot(), name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function checked(id: string): string {
  if (!isDriveId(id)) throw new Error("drive id ไม่ถูกต้อง");
  return id.toLowerCase();
}

function blobPath(fileId: string): string {
  return path.join(sub("blobs"), checked(fileId));
}

function partPath(uploadId: string): string {
  return path.join(sub("parts"), `${checked(uploadId)}.part`);
}

/* ───────────── ไฟล์ที่กำลังอัปโหลด (ส่งมาเป็นท่อน ต่อท้ายไปเรื่อยๆ จนครบ) ───────────── */

export function startPart(uploadId: string): void {
  fs.writeFileSync(partPath(uploadId), "");
}

/** ขนาดที่ได้รับแล้ว — null = ไม่มีไฟล์ท่อนนี้ (ถูกยกเลิก/เก็บกวาดไปแล้ว) */
export function partSize(uploadId: string): number | null {
  try {
    return fs.statSync(partPath(uploadId)).size;
  } catch {
    return null;
  }
}

/** ต่อท้ายแบบ sync โดยตั้งใจ: ระหว่างเช็คตำแหน่งกับเขียนต้องไม่มี await คั่น
 *  ไม่งั้นท่อนเดียวกันที่ถูกส่งซ้ำ (เน็ตหลุดแล้วเบราว์เซอร์ลองใหม่) จะถูกเขียนสองรอบจนไฟล์เพี้ยน */
export function appendPart(uploadId: string, chunk: Uint8Array): number {
  const file = partPath(uploadId);
  fs.appendFileSync(file, chunk);
  return fs.statSync(file).size;
}

export function discardPart(uploadId: string): void {
  try {
    fs.unlinkSync(partPath(uploadId));
  } catch {
    // ไม่มีไฟล์ให้ลบ = เป้าหมายสำเร็จอยู่แล้ว
  }
}

/** ส่งครบแล้ว -> คำนวณ SHA-256 แล้วย้ายเป็นไฟล์ถาวร (rename ในโฟลเดอร์เดียวกัน = ไม่ต้องคัดลอกซ้ำ)
 *  อ่านแบบ stream ไม่อ่านทั้งไฟล์เข้าหน่วยความจำ — ไฟล์ 500 MB ห้ามอยู่ใน RAM ทั้งก้อน */
export async function commitPart(uploadId: string, fileId: string): Promise<string> {
  const from = partPath(uploadId);
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(from, { highWaterMark: 1024 * 1024 })) {
    hash.update(chunk as Buffer);
  }
  fs.renameSync(from, blobPath(fileId));
  return hash.digest("hex");
}

/* ───────────────────────────── ไฟล์ถาวร ───────────────────────────── */

export function blobSize(fileId: string): number | null {
  try {
    return fs.statSync(blobPath(fileId)).size;
  } catch {
    return null;
  }
}

export function openBlob(fileId: string, range?: { start: number; end: number }): fs.ReadStream {
  return fs.createReadStream(blobPath(fileId), range ? { start: range.start, end: range.end } : undefined);
}

export function deleteBlob(fileId: string): void {
  try {
    fs.unlinkSync(blobPath(fileId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/* ───────────────────────────── พื้นที่ ───────────────────────────── */

/** เพดานรวมของคลังไฟล์ (DRIVE_QUOTA_GB, ค่าตั้งต้น 20 GB)
 *  ดิสก์เครื่องเดียวกันเก็บข้อมูลทั้งระบบ ถ้าคลังไฟล์กินจนเต็ม การบันทึก ticket/สต็อกจะล้มไปด้วย */
export function quotaBytes(): number {
  const gb = Number(process.env.DRIVE_QUOTA_GB);
  return (Number.isFinite(gb) && gb > 0 ? gb : 20) * 1024 ** 3;
}

/** เว้นที่ว่างบนดิสก์ไว้เสมออย่างน้อยเท่านี้ — กันกรณีโควตายังไม่เต็มแต่ดิสก์จริงใกล้เต็มแล้ว */
export const FREE_SPACE_RESERVE = 2 * 1024 ** 3;

/** พื้นที่ว่างจริงบนดิสก์ที่เก็บคลังไฟล์ — null = ระบบปฏิบัติการไม่บอก (ข้ามการตรวจข้อนี้) */
export function freeBytes(): number | null {
  try {
    fs.mkdirSync(driveRoot(), { recursive: true });
    const stat = fs.statfsSync(driveRoot());
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}
