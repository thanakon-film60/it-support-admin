import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getStaffByUsername, verifyPassword } from "./db/staff";
import type { StaffAccount } from "./types";

const COOKIE_NAME = "itadmin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 วัน

function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // ใช้ fallback เฉพาะตอน dev เพื่อให้รันได้ทันทีโดยไม่ต้องตั้งค่าก่อน
    // *** ต้องตั้งค่า SESSION_SECRET ใน .env ก่อนขึ้น production เสมอ ดู .env.example ***
    return new TextEncoder().encode("dev-only-insecure-secret-change-me");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  staffId: string;
  username: string;
  displayName: string;
  role: StaffAccount["role"];
}

/** ปิดระบบล็อกอินทั้งระบบเมื่อ AUTH_DISABLED=true (ตั้งใน docker-compose.yml / .env)
 *
 *  ⚠️ เปิดโหมดนี้แล้ว "ทุกคนที่เปิด URL ได้ จะเห็นข้อมูลทั้งหมด" — ข้อมูลพนักงาน ค่าซ่อม
 *  ทรัพย์สิน สต็อก ทั้งหมด เพราะเว็บนี้เปิดสู่อินเทอร์เน็ตผ่าน Tailscale Funnel อยู่
 *  เลือกเปิดโดยเจ้าของระบบเมื่อ 2026-09-15 หลังได้รับแจ้งความเสี่ยงแล้ว
 *
 *  ไม่ได้ลบโค้ด auth ทิ้ง เพื่อให้กลับมาเปิดใหม่ได้ด้วยการเปลี่ยนค่าตัวแปรเดียว:
 *  ตั้ง AUTH_DISABLED=false ใน .env แล้ว `docker compose up -d --build app`
 */
export const AUTH_DISABLED = process.env.AUTH_DISABLED === "true";

/** ตัวตนที่ใช้แทนตอนปิดล็อกอิน — ต้องมี เพราะทุกหน้า/Server Action อ่าน session ไปแสดงผล */
const GUEST_SESSION: SessionPayload = {
  staffId: "guest",
  username: "guest",
  displayName: "ผู้ใช้ทั่วไป",
  role: "admin",
};


export async function signIn(
  username: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const account = getStaffByUsername(username);
  if (!account || !verifyPassword(password, account.password_hash)) {
    return { ok: false, error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
  }

  const token = await new SignJWT({
    staffId: account.id,
    username: account.username,
    displayName: account.display_name,
    role: account.role,
  } satisfies SessionPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return { ok: true };
}

export async function signOut(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  if (AUTH_DISABLED) return GUEST_SESSION;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/** เรียกใช้ต้นๆ ของทุกหน้า/Server Action ที่ต้อง login — เด้งไป /login ถ้ายังไม่ได้เข้าสู่ระบบ
 *  (เป็นแนวทางที่ Next.js แนะนำ: เช็คสิทธิ์ใกล้ data access จริง ไม่ใช่พึ่ง proxy.ts อย่างเดียว) */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
