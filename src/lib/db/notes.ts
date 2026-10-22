// ข้อความที่ฝากไว้ในหน้า /notes — data/notes.json
//
// ทุกฟังก์ชันอ่านผ่าน readCollectionStrict ไม่ใช่ readCollection/upsertOne/patchOne แบบโมดูลอื่น
// เหตุผล: ตัวเหล่านั้นถือว่า "ไฟล์อ่านไม่ออก = ยังไม่มีข้อมูล" แล้วเขียนทับได้ทันที ซึ่งพอรับได้กับข้อมูล
// ที่ seed กลับมาเองได้ แต่ข้อความในหน้านี้คนพิมพ์เองทั้งหมด หายแล้วสร้างคืนไม่ได้ —
// ไฟล์เสียเมื่อไหร่ต้อง "ไม่ยอมบันทึก" แล้วบอกผู้ใช้ ดีกว่าบันทึกสำเร็จแต่ข้อความเก่าหายหมด

import { newId } from "../utils";
import { readCollectionStrict, writeCollection } from "./store";
import type { Note } from "../types";

const COLLECTION = "notes";

/** ใหม่สุดก่อน — เทียบสตริง ISO ตรงๆ ได้เพราะทุกแถวสร้างจาก toISOString() (UTC รูปแบบเดียวกันหมด)
 *  เวลาเท่ากันถึงระดับมิลลิวินาทีให้ id ตัดสิน เพื่อให้ลำดับไม่สลับไปมาระหว่างการโหลดแต่ละครั้ง */
function newestFirst(a: Note, b: Note): number {
  return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
}

export function listNotes(): Note[] {
  return readCollectionStrict<Note>(COLLECTION).slice().sort(newestFirst);
}

export function getNote(id: string): Note | null {
  return readCollectionStrict<Note>(COLLECTION).find((n) => n.id === id) ?? null;
}

/** body ต้องผ่าน checkNoteBody (lib/notes-shared.ts) มาก่อนแล้ว — ชั้นนี้ไม่ตรวจซ้ำ */
export function createNote(input: { body: string; author: string }): Note {
  const all = readCollectionStrict<Note>(COLLECTION);
  const note: Note = {
    id: newId(),
    body: input.body,
    author: input.author,
    created_at: new Date().toISOString(),
    updated_at: null,
    updated_by: null,
  };
  all.push(note);
  writeCollection(COLLECTION, all);
  return note;
}

/** คืน null เมื่อไม่พบ (เช่นถูกลบจากอีกเครื่องไปก่อนแล้ว)
 *  กดบันทึกโดยไม่ได้แก้อะไร = ไม่แตะไฟล์ และไม่ติดป้าย "แก้ไขแล้ว" ให้ข้อความที่ไม่ได้เปลี่ยนจริง */
export function updateNote(id: string, input: { body: string; editor: string }): Note | null {
  const all = readCollectionStrict<Note>(COLLECTION);
  const idx = all.findIndex((n) => n.id === id);
  if (idx === -1) return null;
  if (all[idx].body === input.body) return all[idx];
  all[idx] = {
    ...all[idx],
    body: input.body,
    updated_at: new Date().toISOString(),
    updated_by: input.editor,
  };
  writeCollection(COLLECTION, all);
  return all[idx];
}

/** คืน false เมื่อไม่มีข้อความนั้นอยู่แล้ว — ผลลัพธ์ที่ผู้ใช้ต้องการ (ข้อความหายไป) เป็นจริงอยู่แล้ว */
export function deleteNote(id: string): boolean {
  const all = readCollectionStrict<Note>(COLLECTION);
  const next = all.filter((n) => n.id !== id);
  if (next.length === all.length) return false;
  writeCollection(COLLECTION, next);
  return true;
}
