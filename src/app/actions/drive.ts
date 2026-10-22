"use server";

// จัดการโฟลเดอร์และข้อมูลกำกับไฟล์ของคลังไฟล์ (/files)
// ตัวไฟล์ไม่ได้ผ่านที่นี่ — อัปโหลด/ดาวน์โหลดใช้ route ใน app/api/drive เพราะ Server Action รับ body ได้จำกัด
// และอ่านทั้ง body เข้าหน่วยความจำก่อนทำงาน ซึ่งใช้กับไฟล์หลายร้อย MB ไม่ได้

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  createFolder,
  deleteFolder,
  removeFile,
  renameFolder,
  updateFile,
} from "@/lib/db/drive";
import { CollectionReadError } from "@/lib/db/store";
import { cleanDriveName, cleanDriveNote } from "@/lib/drive-shared";
import { deleteBlob, isDriveId } from "@/lib/drive/storage";
import { writerOf } from "@/lib/drive/http";

export interface DriveActionResult {
  error?: string;
}

function failure(err: unknown, action: string): DriveActionResult {
  console.error(`[drive] ${action}ไม่สำเร็จ`, err);
  if (err instanceof CollectionReadError) {
    return { error: "อ่านข้อมูลคลังไฟล์ไม่ออก (ไฟล์ JSON เสีย) จึงยังไม่บันทึกทับ — กู้จาก backup ก่อน" };
  }
  return { error: `${action}ไม่สำเร็จ — ลองอีกครั้ง` };
}

const optionalFolder = (id: unknown): id is string | null => id === null || isDriveId(id);

export async function createFolderAction(parentId: string | null, name: string): Promise<DriveActionResult> {
  const session = await requireSession("files");
  if (!optionalFolder(parentId)) return { error: "โฟลเดอร์ปลายทางไม่ถูกต้อง" };
  const clean = cleanDriveName(name, "โฟลเดอร์");
  if (!clean.ok) return { error: clean.error };
  try {
    const result = createFolder({ id: randomUUID(), name: clean.name, parentId, by: writerOf(session) });
    if (!result.ok) return { error: result.error };
  } catch (err) {
    return failure(err, "สร้างโฟลเดอร์");
  }
  revalidatePath("/files");
  return {};
}

export async function renameFolderAction(id: string, name: string): Promise<DriveActionResult> {
  await requireSession("files");
  if (!isDriveId(id)) return { error: "ไม่พบโฟลเดอร์นี้" };
  const clean = cleanDriveName(name, "โฟลเดอร์");
  if (!clean.ok) return { error: clean.error };
  try {
    const result = renameFolder(id, clean.name);
    if (!result.ok) return { error: result.error };
  } catch (err) {
    return failure(err, "เปลี่ยนชื่อโฟลเดอร์");
  }
  revalidatePath("/files");
  return {};
}

export async function deleteFolderAction(id: string): Promise<DriveActionResult> {
  await requireSession("files");
  if (!isDriveId(id)) return { error: "ไม่พบโฟลเดอร์นี้" };
  try {
    const result = deleteFolder(id);
    if (!result.ok) return { error: result.error };
  } catch (err) {
    return failure(err, "ลบโฟลเดอร์");
  }
  revalidatePath("/files");
  return {};
}

export async function updateFileAction(id: string, input: { name: string; note: string }): Promise<DriveActionResult> {
  const session = await requireSession("files");
  if (!isDriveId(id)) return { error: "ไม่พบไฟล์นี้" };
  const name = cleanDriveName(input?.name);
  if (!name.ok) return { error: name.error };
  const note = cleanDriveNote(input?.note);
  if (!note.ok) return { error: note.error };
  try {
    const result = updateFile(id, { name: name.name, note: note.note }, writerOf(session));
    if (!result.ok) return { error: result.error };
  } catch (err) {
    return failure(err, "บันทึกการแก้ไข");
  }
  revalidatePath("/files");
  return {};
}

export async function moveFileAction(id: string, folderId: string | null): Promise<DriveActionResult> {
  const session = await requireSession("files");
  if (!isDriveId(id)) return { error: "ไม่พบไฟล์นี้" };
  if (!optionalFolder(folderId)) return { error: "โฟลเดอร์ปลายทางไม่ถูกต้อง" };
  try {
    const result = updateFile(id, { folderId }, writerOf(session));
    if (!result.ok) return { error: result.error };
  } catch (err) {
    return failure(err, "ย้ายไฟล์");
  }
  revalidatePath("/files");
  return {};
}

export async function deleteFileAction(id: string): Promise<DriveActionResult> {
  await requireSession("files");
  if (!isDriveId(id)) return { error: "ไม่พบไฟล์นี้" };
  try {
    // เอารายการออกก่อนแล้วค่อยลบไฟล์จริง — ถ้าลบไฟล์จริงไม่สำเร็จ ผลเสียคือมีไฟล์กำพร้ากินที่
    // แต่ถ้าสลับลำดับแล้วบันทึกรายการล้ม หน้าเว็บจะโชว์ไฟล์ที่กดดาวน์โหลดแล้วได้ "ไม่พบไฟล์"
    const removed = removeFile(id);
    if (removed) {
      try {
        deleteBlob(id);
      } catch (err) {
        console.error("[drive] ลบไฟล์จริงบนดิสก์ไม่สำเร็จ (รายการถูกลบแล้ว)", err);
      }
    }
  } catch (err) {
    return failure(err, "ลบไฟล์");
  }
  revalidatePath("/files");
  return {};
}
