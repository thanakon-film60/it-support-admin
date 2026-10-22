"use server";

import { revalidatePath } from "next/cache";
import { requireSession, type SessionPayload } from "@/lib/auth";
import { createNote, deleteNote, updateNote } from "@/lib/db/notes";
import { CollectionReadError } from "@/lib/db/store";
import { checkNoteBody } from "@/lib/notes-shared";

export interface NoteActionResult {
  error?: string;
}

/** ชื่อที่ติดไปกับข้อความ — ใช้ชื่อที่แสดงของบัญชี ถ้าว่างค่อยใช้ชื่อผู้ใช้ */
function writerOf(session: SessionPayload): string {
  return session.displayName?.trim() || session.username;
}

/** แปลง error เป็นข้อความที่บอกผู้ใช้ได้ว่าข้อความที่พิมพ์ "ยังไม่หาย" และต้องทำอะไรต่อ
 *
 *  หน้าเว็บเก็บข้อความไว้ในช่องเมื่อบันทึกไม่สำเร็จ ข้อความ error จึงต้องพูดตรงกับพฤติกรรมนั้น
 *  ไม่งั้นคนจะพิมพ์ใหม่ทั้งหมด หรือเข้าใจว่าบันทึกไปแล้ว */
function failure(err: unknown, action: string): NoteActionResult {
  console.error(`[notes] ${action}ไม่สำเร็จ`, err);
  if (err instanceof CollectionReadError) {
    return {
      error:
        "อ่านไฟล์ข้อความเดิม (data/notes.json) ไม่ออก จึงยังไม่บันทึกทับ เพื่อไม่ให้ข้อความเก่าหาย — " +
        "กู้ไฟล์จาก backup ก่อนแล้วค่อยลองใหม่ (ข้อความที่พิมพ์ยังอยู่ในช่อง)",
    };
  }
  return { error: `${action}ไม่สำเร็จ — ลองกดอีกครั้ง` };
}

export async function createNoteAction(body: string): Promise<NoteActionResult> {
  const session = await requireSession("notes");
  const checked = checkNoteBody(body);
  if (!checked.ok) return { error: checked.error };
  try {
    createNote({ body: checked.body, author: writerOf(session) });
  } catch (err) {
    return failure(err, "บันทึก");
  }
  revalidatePath("/notes");
  return {};
}

export async function updateNoteAction(id: string, body: string): Promise<NoteActionResult> {
  const session = await requireSession("notes");
  if (typeof id !== "string" || !id) return { error: "ไม่พบข้อความที่จะแก้" };
  const checked = checkNoteBody(body);
  if (!checked.ok) return { error: checked.error };
  let updated;
  try {
    updated = updateNote(id, { body: checked.body, editor: writerOf(session) });
  } catch (err) {
    return failure(err, "บันทึกการแก้ไข");
  }
  if (!updated) return { error: "ข้อความนี้ถูกลบไปแล้ว (อาจลบจากอีกเครื่อง) — คัดลอกข้อความที่แก้ไปบันทึกเป็นข้อความใหม่แทนได้" };
  revalidatePath("/notes");
  return {};
}

export async function deleteNoteAction(id: string): Promise<NoteActionResult> {
  await requireSession("notes");
  if (typeof id !== "string" || !id) return { error: "ไม่พบข้อความที่จะลบ" };
  try {
    // ลบไม่เจอ = ถูกลบจากอีกเครื่องไปแล้ว ผลลัพธ์ที่ผู้ใช้ต้องการเป็นจริงอยู่แล้ว ไม่ต้องฟ้อง error
    deleteNote(id);
  } catch (err) {
    return failure(err, "ลบ");
  }
  revalidatePath("/notes");
  return {};
}
