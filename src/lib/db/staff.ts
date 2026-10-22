import bcrypt from "bcryptjs";
import { readCollection, upsertOne } from "./store";
import { newId } from "../utils";
import type { StaffAccount } from "../types";

const COLLECTION = "staff_accounts";

// รหัสผ่านเริ่มต้นสำหรับทดสอบ (ดูรายละเอียดใน README.md หัวข้อ "บัญชีทดสอบ")
// *** เปลี่ยนรหัสผ่านนี้ก่อนใช้งานจริงเสมอ ***
const SEED_PASSWORD = "ITadmin@2026";

/** hash ของรหัสสุ่มที่ไม่มีใครรู้ — ใช้เทียบตอนไม่พบชื่อผู้ใช้ ให้เวลาตอบเท่ากับกรณีรหัสผิด
 *  ถ้าข้ามการเทียบไปเลย หน้า login จะตอบเร็วผิดปกติเฉพาะชื่อที่ไม่มีในระบบ
 *  คนนอกจับเวลาแล้วรู้ได้ว่าชื่อไหนมีบัญชีจริง (user enumeration) แล้วไล่เดารหัสเฉพาะชื่อนั้น
 *  cost 10 เท่ากับที่ tools/staff_admin.py และ scripts/admin-password.js ใช้สร้างบัญชีจริง */
const DUMMY_HASH = "$2b$10$nNFnAkGw8rqnAht5gVHeBeG4qABs4lHLk/V.sOJPC.R6M/6e/gVsi";

function seed(): StaffAccount[] {
  const now = new Date().toISOString();
  return [
    {
      id: newId(),
      username: "admin",
      password_hash: bcrypt.hashSync(SEED_PASSWORD, 10),
      display_name: "ผู้ดูแลระบบ IT",
      role: "admin",
      created_at: now,
    },
  ];
}

export function listStaffAccounts(): StaffAccount[] {
  return readCollection<StaffAccount>(COLLECTION, seed);
}

/** คืน null ทั้งตอนไม่พบ และตอน "พบมากกว่า 1" (ชื่อซ้ำกันแบบไม่สนตัวพิมพ์)
 *
 *  โปรแกรมจัดการผู้ใช้กันชื่อซ้ำไว้แล้ว แต่ไฟล์ยังแก้มือได้ — ถ้าซ้ำแล้วหยิบอันแรก
 *  การล็อกอินจะไปตกบัญชีที่ไม่ได้ตั้งใจ (สิทธิ์ต่างกันได้) จึงปฏิเสธทั้งคู่จนกว่าจะแก้ไฟล์ให้ถูก */
export function getStaffByUsername(username: string): StaffAccount | null {
  const wanted = username.trim().toLowerCase();
  if (!wanted) return null;
  const matches = listStaffAccounts().filter(
    (s) => typeof s.username === "string" && s.username.toLowerCase() === wanted
  );
  if (matches.length > 1) {
    console.error(`[auth] ชื่อผู้ใช้ซ้ำกัน ${matches.length} บัญชีใน staff_accounts.json — ปฏิเสธการล็อกอินจนกว่าจะแก้ไฟล์`);
    return null;
  }
  return matches[0] ?? null;
}

export function getStaffById(id: string): StaffAccount | null {
  if (!id) return null;
  return listStaffAccounts().find((s) => s.id === id) ?? null;
}

export function verifyPassword(plain: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    // hash เพี้ยน (แก้ไฟล์มือพลาด) = ล็อกอินไม่ได้ ไม่ใช่ทำให้หน้า login พังทั้งหน้า
    return false;
  }
}

/** แบบไม่บล็อก event loop — ใช้ในเส้นทางที่คนนอกยิงเข้ามาได้ (หน้า login)
 *
 *  compareSync ใช้ CPU ล้วนราว 70 ms ต่อครั้งโดยหยุดทั้งโปรเซส ซึ่งรับทั้งหน้าแอดมินและ API ของบอท LINE
 *  ใครยิง login รัวๆ ทุกอย่างจะช้าไปหมด ตัว async ยอมสลับให้ request อื่นทำงานคั่นได้
 *  ไม่พบบัญชี → เทียบกับ DUMMY_HASH แทน เพื่อให้ใช้เวลาเท่ากัน (ดูคอมเมนต์ที่ DUMMY_HASH) */
export async function verifyPasswordAsync(plain: string, hash: string | null | undefined): Promise<boolean> {
  try {
    const ok = await bcrypt.compare(plain, hash || DUMMY_HASH);
    return ok && Boolean(hash);
  } catch {
    return false;
  }
}

export function createStaffAccount(input: {
  username: string;
  password: string;
  display_name: string;
  role: StaffAccount["role"];
}): StaffAccount {
  const account: StaffAccount = {
    id: newId(),
    username: input.username,
    password_hash: bcrypt.hashSync(input.password, 10),
    display_name: input.display_name,
    role: input.role,
    created_at: new Date().toISOString(),
  };
  upsertOne<StaffAccount>(COLLECTION, account, seed);
  return account;
}
