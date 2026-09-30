import { patchOne, readCollection, upsertOne } from "./store";
import { newId } from "../utils";
import { ensureEmployeeRegistry, seedUsersFromRegistry } from "./employees";
import type { User } from "../types";

const COLLECTION = "users";

/* รายชื่อตั้งต้นมาจากทะเบียนพนักงานของ HR (ดู db/employees.ts) ไม่ใช่ข้อมูลตัวอย่างอีกต่อไป
 *
 * เดิม seed เป็นคนสมมติ 12 คน ซึ่งทำให้ ticket จาก LINE สร้าง user ใหม่ทุกครั้งที่มีคนใหม่พิมพ์ชื่อเข้ามา
 * ("สมชาย ใจดี" ไม่เคยแมตช์กับใครจริง) users จึงค่อยๆ กลายเป็นรายชื่อที่สะกดต่างกันของคนคนเดียวกัน
 * พอมีทะเบียนจริงแล้ว ผู้แจ้งจะถูกผูกกับ "แถวเดิม" ของคนนั้นเสมอ ประวัติต่อคนจึงเชื่อถือได้
 */
const seed = seedUsersFromRegistry;

export function listUsers(): User[] {
  // ซิงก์ทะเบียนให้ก่อน (รอบแรกของแต่ละเวอร์ชันเท่านั้น) — ไม่งั้นเครื่องที่มี data/users.json
  // อยู่แล้วจะไม่มีวันเห็นรายชื่อใหม่ เพราะ seedFn รันเฉพาะตอนยังไม่มีไฟล์
  ensureEmployeeRegistry();
  return readCollection<User>(COLLECTION, seed);
}

export function getUserById(id: string): User | null {
  return listUsers().find((u) => u.id === id) ?? null;
}

export function getUserByLineId(lineUserId: string): User | null {
  return listUsers().find((u) => u.line_user_id === lineUserId) ?? null;
}

/** หา user จากชื่อ+รหัสพนักงาน ถ้าไม่เจอให้สร้างใหม่ (ใช้ตอนแอดมินพิมพ์ชื่อผู้ครอบครองอิสระในฟอร์มทรัพย์สิน) */
export function findOrCreateUserByName(input: {
  display_name: string;
  employee_id?: string | null;
  department?: string | null;
}): User {
  const existing = listUsers().find(
    (u) =>
      u.display_name.trim() === input.display_name.trim() &&
      (input.employee_id ? u.employee_id === input.employee_id : true)
  );
  if (existing) return existing;
  const user: User = {
    id: newId(),
    display_name: input.display_name.trim(),
    employee_id: input.employee_id || null,
    department: input.department || null,
    line_user_id: null,
    email: null,
    created_at: new Date().toISOString(),
    active: true,
  };
  upsertOne<User>(COLLECTION, user, seed);
  return user;
}

/** แก้รหัสพนักงาน/แผนกของผู้ใช้ที่มีอยู่แล้ว (ใช้จากหน้า "ผู้ครอบครอง")
 *
 *  ทำไมต้องมีแยกจาก findOrCreateUserByName: ฟังก์ชันนั้นมีหน้าที่ "หา" เท่านั้น
 *  ถ้าให้มันเขียนทับโปรไฟล์ไปด้วย ทุกจุดที่แค่อยากได้ id ของคนคนหนึ่ง (เช่นบอทผูกผู้แจ้ง)
 *  จะกลายเป็นจุดที่แก้ข้อมูลพนักงานได้โดยไม่มีใครตั้งใจ
 *
 *  ค่า null คือ "ตั้งใจล้าง" ไม่ใช่ "ไม่ได้ส่งมา" — ฟอร์มที่เรียกฟังก์ชันนี้เติมค่าเดิมไว้ให้แล้ว
 *  ช่องที่ถูกลบจนว่างจึงหมายถึงการลบจริงๆ */
export function updateUserProfile(
  id: string,
  patch: { employee_id?: string | null; department?: string | null }
): User | null {
  return patchOne<User>(COLLECTION, id, patch, seed);
}

/** หา user จาก line_user_id ถ้าไม่เจอให้สร้างใหม่ (ใช้โดย LINE webhook / LIFF เพื่อผูกผู้ใช้ LINE
 *  เข้ากับ users table เดียวกับที่แอดมินเห็น — ให้ ticket ที่มาจาก LINE อ้างถึง requester ถูกคน) */
export function upsertLineUser(lineUserId: string, displayName: string): User {
  const existing = getUserByLineId(lineUserId);
  if (existing) return existing;

  const user: User = {
    id: newId(),
    display_name: displayName,
    employee_id: null,
    department: null,
    line_user_id: lineUserId,
    email: null,
    created_at: new Date().toISOString(),
    active: true,
  };
  upsertOne<User>(COLLECTION, user, seed);
  return user;
}
