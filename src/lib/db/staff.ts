import bcrypt from "bcryptjs";
import { readCollection, upsertOne } from "./store";
import { newId } from "../utils";
import type { StaffAccount } from "../types";

const COLLECTION = "staff_accounts";

// รหัสผ่านเริ่มต้นสำหรับทดสอบ (ดูรายละเอียดใน README.md หัวข้อ "บัญชีทดสอบ")
// *** เปลี่ยนรหัสผ่านนี้ก่อนใช้งานจริงเสมอ ***
const SEED_PASSWORD = "ITadmin@2026";

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

export function getStaffByUsername(username: string): StaffAccount | null {
  return (
    listStaffAccounts().find(
      (s) => s.username.toLowerCase() === username.toLowerCase()
    ) ?? null
  );
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
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
