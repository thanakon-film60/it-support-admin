// cookie session → "บัญชีจริงในไฟล์" — ใช้ร่วมกันระหว่าง lib/auth.ts (หน้า/Server Action) กับ proxy.ts
//
// แยกออกจาก auth.ts เพราะ proxy.ts ต้องใช้ด้วย (ตรวจรูปแนบใน /uploads ก่อน Next เสิร์ฟไฟล์จาก public/)
// แต่ proxy ไม่มี cookies() ของ next/headers และ bundle คนละชั้นกับหน้าเว็บ — ไฟล์นี้จึงห้าม import
// "server-only" หรือ next/headers (รับ token เป็นสตริงแทน ให้ผู้เรียกไปหยิบจาก cookie เอง)

import { jwtVerify } from "jose";
import { getStaffById } from "./db/staff";
import { PAGE_KEYS, pagesOf, type PageKey } from "./access";
import type { StaffAccount } from "./types";

export const SESSION_COOKIE = "itadmin_session";

export interface SessionPayload {
  staffId: string;
  username: string;
  displayName: string;
  role: StaffAccount["role"];
  /** หน้าที่เข้าได้ — คำนวณจากไฟล์บัญชี "ทุก request" ไม่ได้ฝังไว้ใน cookie
   *  แอดมินติ๊ก/เอาออกในโปรแกรมจัดการผู้ใช้แล้วมีผลทันที ไม่ต้องรอให้คนนั้นล็อกอินใหม่ */
  pages: PageKey[];
}

/** สิ่งที่อยู่ใน cookie จริง — แค่ "เป็นใคร" กับ "รุ่นของ session"
 *  ชื่อ/สิทธิ์ไม่ใส่ เพราะ cookie อยู่ได้ 7 วัน ถ้าใส่ไว้ การเปลี่ยนสิทธิ์จะไม่มีผลจนกว่าจะหมดอายุ */
export interface TokenClaims {
  staffId: string;
  /** ต้องเท่ากับ session_version ของบัญชี — โปรแกรมจัดการผู้ใช้เพิ่มเลขนี้ตอนเปลี่ยนรหัสผ่าน
   *  ปิดใช้งาน หรือกด "บังคับออกจากระบบ" ทำให้ cookie ทุกใบที่ออกก่อนหน้านั้นใช้ไม่ได้ทันที */
  sv: number;
}

/** ตัวตนที่ใช้แทนตอนปิดล็อกอิน (AUTH_DISABLED) — ทุกหน้า/Server Action อ่าน session ไปแสดงผล */
export const GUEST_SESSION: SessionPayload = {
  staffId: "guest",
  username: "guest",
  displayName: "ผู้ใช้ทั่วไป",
  role: "admin",
  pages: [...PAGE_KEYS],
};

export function sessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // ใช้ fallback เฉพาะตอน dev เพื่อให้รันได้ทันทีโดยไม่ต้องตั้งค่าก่อน
    // *** ต้องตั้งค่า SESSION_SECRET ใน .env ก่อนขึ้น production เสมอ ดู .env.example ***
    return new TextEncoder().encode("dev-only-insecure-secret-change-me");
  }
  return new TextEncoder().encode(secret);
}

export function sessionOf(account: StaffAccount): SessionPayload {
  return {
    staffId: account.id,
    username: account.username,
    displayName: account.display_name,
    role: account.role,
    pages: pagesOf(account),
  };
}

/** session_version ของบัญชีรุ่นเก่า (ก่อนมีช่องนี้) = 0 — cookie ที่ออกก่อนอัปเดตนี้จึงยังใช้ได้ต่อ */
export function versionOf(account: StaffAccount): number {
  return Number.isSafeInteger(account.session_version) ? (account.session_version as number) : 0;
}

/** ตรวจลายเซ็น cookie แล้ว "เปิดไฟล์บัญชีดูของจริงทุกครั้ง"
 *
 *  เดิมเชื่อข้อมูลใน cookie อย่างเดียว ผลคือบัญชีที่ถูกลบ/เปลี่ยนรหัสไปแล้วยังใช้งานต่อได้จนครบ 7 วัน
 *  (ใครได้ cookie ไป ต่อให้เจ้าของเปลี่ยนรหัสผ่าน คนนั้นก็ยังเข้าได้) ตอนนี้ session ใช้ไม่ได้ทันทีเมื่อ
 *  บัญชีถูกลบ · ถูกปิดใช้งาน · หรือ session_version ไม่ตรง (เปลี่ยนรหัส/สั่งออกจากระบบ)
 *  ไฟล์บัญชีมีไม่กี่แถว อ่านทุก request ไม่ได้มีต้นทุนที่รู้สึกได้ */
export async function sessionFromToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  let claims: Partial<TokenClaims>;
  try {
    ({ payload: claims } = await jwtVerify<Partial<TokenClaims>>(token, sessionSecret()));
  } catch {
    return null;
  }
  if (typeof claims.staffId !== "string") return null;
  const account = getStaffById(claims.staffId);
  if (!account || account.active === false) return null;
  const tokenVersion = typeof claims.sv === "number" ? claims.sv : 0;
  if (tokenVersion !== versionOf(account)) return null;
  return sessionOf(account);
}
