// ข้อมูลกำกับของคลังไฟล์ — data/drive_folders.json · drive_files.json · drive_uploads.json
//
// ตัวไฟล์จริงไม่ได้อยู่ที่นี่ (อยู่ใน lib/drive/storage.ts) ไฟล์นี้เก็บแค่ "ไฟล์ไหนอยู่โฟลเดอร์ไหน ชื่ออะไร
// ใครอัปโหลด" ซึ่งถ้าหาย ไฟล์จริงจะยังอยู่บนดิสก์แต่ไม่มีใครรู้ว่าอันไหนคืออะไร — จึงอ่านด้วย
// readCollectionStrict ทุกจุด: ไฟล์ JSON เสียเมื่อไหร่ต้องหยุดบันทึก ห้ามเขียนรายการว่างทับของเดิม
// (เหตุผลเต็มอยู่ที่ store.ts หัวข้อ readCollectionStrict)

import { readCollectionStrict, writeCollection } from "./store";
import type { DriveFile, DriveFolder, DriveUpload } from "../types";

const FOLDERS = "drive_folders";
const FILES = "drive_files";
const UPLOADS = "drive_uploads";

/** การอัปโหลดที่ค้างเกินนี้ถือว่าถูกทิ้ง (ปิดเบราว์เซอร์กลางทาง/เน็ตหลุดแล้วไม่กลับมา)
 *  ต้องเก็บกวาด ไม่งั้นไฟล์ท่อนที่ส่งมาครึ่งๆ จะกินดิสก์และกินโควตาไปเรื่อยๆ โดยไม่มีใครเห็น */
export const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

const sameName = (a: string, b: string) => a.localeCompare(b, "th", { sensitivity: "accent" }) === 0;

/* ───────────────────────────── โฟลเดอร์ ───────────────────────────── */

export function listFolders(): DriveFolder[] {
  return readCollectionStrict<DriveFolder>(FOLDERS);
}

export function getFolder(id: string): DriveFolder | null {
  return listFolders().find((f) => f.id === id) ?? null;
}

export type DriveResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** ชื่อโฟลเดอร์ห้ามซ้ำในชั้นเดียวกัน — ไฟล์ซ้ำชื่อได้ (เหมือน Google Drive) แต่โฟลเดอร์ซ้ำชื่อ
 *  ทำให้คนอัปโหลดเข้าผิดที่เพราะหน้าตาเหมือนกันทุกอย่าง แล้วหาไฟล์ไม่เจอในอีกอันที่ชื่อเหมือนกัน */
function nameTaken(all: DriveFolder[], parentId: string | null, name: string, exceptId?: string) {
  return all.some((f) => f.parent_id === parentId && f.id !== exceptId && sameName(f.name, name));
}

export function createFolder(input: { id: string; name: string; parentId: string | null; by: string }): DriveResult<DriveFolder> {
  const all = listFolders();
  if (input.parentId && !all.some((f) => f.id === input.parentId)) {
    return { ok: false, error: "ไม่พบโฟลเดอร์ปลายทาง (อาจถูกลบจากอีกเครื่อง)" };
  }
  if (nameTaken(all, input.parentId, input.name)) return { ok: false, error: `มีโฟลเดอร์ชื่อ "${input.name}" อยู่แล้ว` };
  const folder: DriveFolder = {
    id: input.id,
    name: input.name,
    parent_id: input.parentId,
    created_at: new Date().toISOString(),
    created_by: input.by,
  };
  all.push(folder);
  writeCollection(FOLDERS, all);
  return { ok: true, value: folder };
}

export function renameFolder(id: string, name: string): DriveResult<DriveFolder> {
  const all = listFolders();
  const folder = all.find((f) => f.id === id);
  if (!folder) return { ok: false, error: "ไม่พบโฟลเดอร์นี้ (อาจถูกลบจากอีกเครื่อง)" };
  if (nameTaken(all, folder.parent_id, name, id)) return { ok: false, error: `มีโฟลเดอร์ชื่อ "${name}" อยู่แล้ว` };
  folder.name = name;
  writeCollection(FOLDERS, all);
  return { ok: true, value: folder };
}

/** ลบได้เฉพาะโฟลเดอร์ว่าง — ลบโฟลเดอร์ที่มีของทีเดียวหายทั้งต้นไม้ ซึ่งกดพลาดครั้งเดียวก็เสียไฟล์หลายสิบไฟล์
 *  ให้ย้าย/ลบของข้างในก่อน เป็นการยืนยันอีกชั้นโดยไม่ต้องมีถังขยะ */
export function deleteFolder(id: string): DriveResult<true> {
  const all = listFolders();
  // ไม่พบ = ถูกลบจากอีกเครื่องไปแล้ว ผลที่ผู้ใช้ต้องการเป็นจริงอยู่แล้ว
  if (!all.some((f) => f.id === id)) return { ok: true, value: true };
  if (all.some((f) => f.parent_id === id)) return { ok: false, error: "ลบไม่ได้ — ยังมีโฟลเดอร์ย่อยอยู่ข้างใน" };
  if (listFiles().some((f) => f.folder_id === id)) return { ok: false, error: "ลบไม่ได้ — ยังมีไฟล์อยู่ข้างใน ย้ายหรือลบไฟล์ก่อน" };
  if (listUploads().some((u) => u.folder_id === id)) return { ok: false, error: "ลบไม่ได้ — มีไฟล์กำลังอัปโหลดเข้าโฟลเดอร์นี้อยู่" };
  writeCollection(FOLDERS, all.filter((f) => f.id !== id));
  return { ok: true, value: true };
}

/* ───────────────────────────── ไฟล์ ───────────────────────────── */

export function listFiles(): DriveFile[] {
  return readCollectionStrict<DriveFile>(FILES);
}

export function getFile(id: string): DriveFile | null {
  return listFiles().find((f) => f.id === id) ?? null;
}

export function addFile(file: DriveFile): DriveFile {
  const all = listFiles();
  all.push(file);
  writeCollection(FILES, all);
  return file;
}

/** แก้ชื่อ / ข้อความกำกับ / ย้ายโฟลเดอร์ — ส่งมาเฉพาะช่องที่เปลี่ยน */
export function updateFile(
  id: string,
  patch: { name?: string; note?: string | null; folderId?: string | null },
  by: string
): DriveResult<DriveFile> {
  const all = listFiles();
  const file = all.find((f) => f.id === id);
  if (!file) return { ok: false, error: "ไม่พบไฟล์นี้ (อาจถูกลบจากอีกเครื่อง)" };
  if (patch.folderId !== undefined && patch.folderId !== null && !getFolder(patch.folderId)) {
    return { ok: false, error: "ไม่พบโฟลเดอร์ปลายทาง (อาจถูกลบจากอีกเครื่อง)" };
  }
  const next: DriveFile = {
    ...file,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.folderId !== undefined ? { folder_id: patch.folderId } : {}),
  };
  const changed = next.name !== file.name || next.note !== file.note || next.folder_id !== file.folder_id;
  if (!changed) return { ok: true, value: file };
  Object.assign(file, next, { updated_at: new Date().toISOString(), updated_by: by });
  writeCollection(FILES, all);
  return { ok: true, value: file };
}

/** คืนแถวที่ถูกเอาออก (ไว้ให้ผู้เรียกลบไฟล์จริงต่อ) — ไม่พบ = null */
export function removeFile(id: string): DriveFile | null {
  const all = listFiles();
  const file = all.find((f) => f.id === id);
  if (!file) return null;
  writeCollection(FILES, all.filter((f) => f.id !== id));
  return file;
}

/* ───────────────────────────── การอัปโหลดที่ยังไม่จบ ───────────────────────────── */

export function listUploads(): DriveUpload[] {
  return readCollectionStrict<DriveUpload>(UPLOADS);
}

export function getUpload(id: string): DriveUpload | null {
  return listUploads().find((u) => u.id === id) ?? null;
}

export function addUpload(upload: DriveUpload): DriveUpload {
  const all = listUploads();
  all.push(upload);
  writeCollection(UPLOADS, all);
  return upload;
}

export function removeUpload(id: string): void {
  const all = listUploads();
  const next = all.filter((u) => u.id !== id);
  if (next.length !== all.length) writeCollection(UPLOADS, next);
}

/** เอาการอัปโหลดที่ค้างนานออกจากรายการ แล้วคืน id ให้ผู้เรียกลบไฟล์ท่อนบนดิสก์ต่อ */
export function takeStaleUploads(now = Date.now()): string[] {
  const all = listUploads();
  const stale = all.filter((u) => now - Date.parse(u.created_at) > STALE_UPLOAD_MS);
  if (stale.length) writeCollection(UPLOADS, all.filter((u) => !stale.includes(u)));
  return stale.map((u) => u.id);
}

/** พื้นที่ที่จองไว้แล้ว = ไฟล์ที่อัปโหลดเสร็จ + ไฟล์ที่กำลังอัปโหลด (นับเต็มขนาดตั้งแต่เริ่ม)
 *  ถ้านับแค่ไฟล์ที่เสร็จแล้ว คนอัปโหลดพร้อมกันหลายไฟล์จะผ่านการตรวจโควตาทุกไฟล์แล้วรวมกันเกิน */
export function reservedBytes(): number {
  return (
    listFiles().reduce((sum, f) => sum + f.size, 0) + listUploads().reduce((sum, u) => sum + u.size, 0)
  );
}
