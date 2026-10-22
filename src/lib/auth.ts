import "server-only";
import { SignJWT } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getStaffByUsername, verifyPasswordAsync } from "./db/staff";
import { NO_ACCESS_PATH, canAccess, type PageKey } from "./access";
import {
  GUEST_SESSION,
  SESSION_COOKIE,
  sessionFromToken,
  sessionOf,
  sessionSecret,
  versionOf,
  type SessionPayload,
  type TokenClaims,
} from "./session-token";

export type { SessionPayload } from "./session-token";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 วัน

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

export async function signIn(
  username: string,
  password: string
): Promise<{ ok: true; session: SessionPayload } | { ok: false; error: string }> {
  const account = getStaffByUsername(username);
  // เทียบรหัสทุกครั้งแม้ไม่พบบัญชี (เทียบกับ hash หลอก) — เวลาตอบต้องเท่ากัน ดู verifyPasswordAsync
  const passwordOk = await verifyPasswordAsync(password, account?.password_hash);
  if (!account || !passwordOk) {
    return { ok: false, error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
  }
  // บอกตรงๆ ได้ว่าถูกปิด เพราะถึงบรรทัดนี้แปลว่ารู้รหัสผ่านถูกแล้ว — ไม่ได้เปิดเผยอะไรให้คนเดาสุ่ม
  // ถ้าตอบ "รหัสผิด" เหมือนกันหมด เจ้าของบัญชีจะนั่งพิมพ์ซ้ำไม่จบโดยไม่รู้ว่าต้องติดต่อแอดมิน
  if (account.active === false) {
    return { ok: false, error: "บัญชีนี้ถูกปิดใช้งาน — ติดต่อผู้ดูแลระบบ IT" };
  }

  const token = await new SignJWT({ staffId: account.id, sv: versionOf(account) } satisfies TokenClaims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(sessionSecret());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return { ok: true, session: sessionOf(account) };
}

export async function signOut(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/** session ปัจจุบัน — ตรวจกับไฟล์บัญชีจริงทุกครั้ง (รายละเอียดที่ sessionFromToken) */
export async function getSession(): Promise<SessionPayload | null> {
  if (AUTH_DISABLED) return GUEST_SESSION;
  const cookieStore = await cookies();
  return sessionFromToken(cookieStore.get(SESSION_COOKIE)?.value);
}

/** เรียกใช้ต้นๆ ของทุกหน้า/Server Action ที่ต้อง login — เด้งไป /login ถ้ายังไม่ได้เข้าสู่ระบบ
 *  (เป็นแนวทางที่ Next.js แนะนำ: เช็คสิทธิ์ใกล้ data access จริง ไม่ใช่พึ่ง proxy.ts อย่างเดียว)
 *
 *  ส่ง page = ต้องมีสิทธิ์หน้านั้นด้วย (ส่งหลายหน้า = หน้าใดหน้าหนึ่งก็พอ) ไม่มีสิทธิ์ → /no-access
 *  Server Action ทุกตัวต้องส่ง page เสมอ: การซ่อนเมนู/ปุ่มไม่ใช่ด่านความปลอดภัย เพราะ action
 *  ถูกเรียกตรงได้โดยไม่ผ่านหน้าเว็บ (Next.js เขียนไว้ชัดในคู่มือ Server Actions หัวข้อ Security) */
export async function requireSession(page?: PageKey | readonly PageKey[]): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (page !== undefined && !canAccess(session.pages, page)) {
    redirect(NO_ACCESS_PATH);
  }
  return session;
}
