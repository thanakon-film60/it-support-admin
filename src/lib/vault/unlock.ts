import "server-only";

// "ปลดล็อก 15 นาที" ของหน้ารหัสผ่าน — ใส่รหัสผ่านตัวเองซ้ำแล้วได้ cookie อายุ 15 นาที
//
// ทำไมต้องใส่รหัสซ้ำทั้งที่ล็อกอินอยู่แล้ว: cookie ล็อกอินอยู่ได้ 7 วัน — คอมที่เปิดค้างไว้ในออฟฟิศ
// ใครเดินผ่านก็เปิดหน้านี้ได้ทันที ด่านนี้ทำให้ "การเปิดดูรหัส" ต้องเป็นเจ้าของบัญชีตัวจริงที่นั่งอยู่ตอนนั้น
//
// cookie ผูกกับ (บัญชี + session_version) และเซ็นด้วยกุญแจที่แตกจาก VAULT_KEY (ไม่ใช่ SESSION_SECRET):
//   - บัญชีอื่นเอา cookie นี้ไปใช้ไม่ได้ · เปลี่ยนรหัส/บังคับออกในโปรแกรมจัดการผู้ใช้ = ล็อกทันที
//   - path=/passwords + sameSite=strict: ไม่ถูกส่งไปกับหน้าอื่น และเว็บอื่นพาเข้ามาแล้วไม่ติดไปด้วย

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getStaffById, verifyPasswordAsync } from "../db/staff";
import { versionOf, type SessionPayload } from "../session-token";
import { vaultKeyProblem, vaultSubKey } from "./crypto";

export const VAULT_COOKIE = "itadmin_vault";
export const VAULT_UNLOCK_MINUTES = 15;
const VAULT_PATH = "/passwords";

/** ใส่รหัสผิดเกินเท่านี้ภายในช่วงเวลานี้ = พักการปลดล็อกของบัญชีนั้น — กันการลองเดารหัสจากเครื่องที่ล็อกอินค้าง */
export const VAULT_MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; first: number }>();

export type VaultLockState =
  | { status: "auth_disabled" }
  | { status: "no_key"; problem: string }
  | { status: "locked" }
  | { status: "unlocked"; until: number };

/** เปิดหน้ารหัสผ่านไม่ได้เลยในสองกรณี — คืนข้อความเหตุผล หรือ null ถ้าใช้ได้
 *  ปิดล็อกอินอยู่ (AUTH_DISABLED) = ทุกคนเป็น "ผู้ใช้ทั่วไป" ที่ไม่มีรหัสผ่านให้ยืนยันตัว จึงปลดล็อกไม่ได้โดยหลักการ */
export function vaultBlockedState(session: SessionPayload): VaultLockState | null {
  if (session.staffId === "guest") return { status: "auth_disabled" };
  const problem = vaultKeyProblem();
  if (problem) return { status: "no_key", problem };
  return null;
}

/** เวลาที่การปลดล็อกหมดอายุ (ms) หรือ null = ล็อกอยู่ */
export async function vaultUnlockedUntil(session: SessionPayload): Promise<number | null> {
  if (vaultBlockedState(session)) return null;
  const token = (await cookies()).get(VAULT_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify<{ staffId?: unknown; sv?: unknown; purpose?: unknown }>(token, vaultSubKey("unlock"));
    if (payload.purpose !== "vault" || payload.staffId !== session.staffId) return null;
    const account = getStaffById(session.staffId);
    if (!account || payload.sv !== versionOf(account) || typeof payload.exp !== "number") return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

export async function vaultLockState(session: SessionPayload): Promise<VaultLockState> {
  const blocked = vaultBlockedState(session);
  if (blocked) return blocked;
  const until = await vaultUnlockedUntil(session);
  return until ? { status: "unlocked", until } : { status: "locked" };
}

function throttled(staffId: string, now: number): number | null {
  const f = failures.get(staffId);
  if (!f) return null;
  if (now - f.first > FAIL_WINDOW_MS) {
    failures.delete(staffId);
    return null;
  }
  return f.count >= VAULT_MAX_FAILS ? f.first + FAIL_WINDOW_MS : null;
}

export async function unlockVault(
  session: SessionPayload,
  password: string
): Promise<{ ok: true; until: number } | { ok: false; error: string; failed: boolean }> {
  const blocked = vaultBlockedState(session);
  if (blocked) {
    return { ok: false, failed: false, error: blocked.status === "no_key" ? blocked.problem : "ต้องเปิดระบบล็อกอินก่อน (AUTH_DISABLED=false)" };
  }
  const now = Date.now();
  const waitUntil = throttled(session.staffId, now);
  if (waitUntil) {
    const minutes = Math.max(1, Math.ceil((waitUntil - now) / 60000));
    return { ok: false, failed: false, error: `ใส่รหัสผิดเกิน ${VAULT_MAX_FAILS} ครั้ง — รออีก ${minutes} นาทีแล้วลองใหม่` };
  }
  const account = getStaffById(session.staffId);
  const ok = account ? await verifyPasswordAsync(typeof password === "string" ? password : "", account.password_hash) : false;
  if (!account || !ok) {
    const f = failures.get(session.staffId);
    if (f && now - f.first <= FAIL_WINDOW_MS) f.count++;
    else failures.set(session.staffId, { count: 1, first: now });
    return { ok: false, failed: true, error: "รหัสผ่านไม่ถูกต้อง (ใช้รหัสเดียวกับตอนล็อกอิน)" };
  }
  failures.delete(session.staffId);
  const until = now + VAULT_UNLOCK_MINUTES * 60 * 1000;
  const token = await new SignJWT({ staffId: session.staffId, sv: versionOf(account), purpose: "vault" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(until / 1000))
    .sign(vaultSubKey("unlock"));
  (await cookies()).set(VAULT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: VAULT_PATH,
    maxAge: VAULT_UNLOCK_MINUTES * 60,
  });
  return { ok: true, until: Math.floor(until / 1000) * 1000 };
}

export async function lockVault(): Promise<void> {
  // ลบด้วย path เดียวกับตอนตั้ง ไม่งั้นเบราว์เซอร์ถือว่าเป็นคนละ cookie แล้วไม่ลบ
  (await cookies()).set(VAULT_COOKIE, "", { path: VAULT_PATH, maxAge: 0, httpOnly: true, sameSite: "strict" });
}

/** ล้างตัวนับรหัสผิด — ใช้ในเทสต์เท่านั้น */
export function resetVaultUnlockFailures(): void {
  failures.clear();
}
