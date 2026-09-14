import "server-only";
import { getUserByLineId, upsertLineUser } from "@/lib/db/users";
import { getProfile } from "./client";

/** ให้แน่ใจว่า LINE user คนนี้มี row ใน users table แล้ว (สร้างให้ถ้ายังไม่มี โดยดึงชื่อจาก
 *  LINE Profile API) — เรียกทุกครั้งที่มีข้อความเข้ามาจาก webhook ก่อนทำอย่างอื่น */
export async function ensureLineUser(lineUserId: string) {
  const existing = await getUserByLineId(lineUserId);
  if (existing) return existing;

  const profile = await getProfile(lineUserId);
  return upsertLineUser(lineUserId, profile?.displayName ?? "ผู้ใช้ LINE");
}
