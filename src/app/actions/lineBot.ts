"use server";

import { revalidatePath } from "next/cache";
import { requireSession, type SessionPayload } from "@/lib/auth";
import { approveLineStaff, removeLineStaff } from "@/lib/db/lineStaff";
import { CollectionReadError } from "@/lib/db/store";
import { setBotGlobal, setBotUser, type BotControlResult } from "@/lib/line/bot-control";

export interface LineStaffActionResult {
  error?: string;
}

/** ชื่อที่บอทแสดงว่า "ใครปิดไว้" — ใช้ชื่อที่แสดงของบัญชีหน้าเว็บ (บอทรับได้ไม่เกิน 80 ตัวอักษร) */
function actorOf(session: SessionPayload): string {
  return (session.displayName?.trim() || session.username).slice(0, 80);
}

function failure(err: unknown, action: string): LineStaffActionResult {
  console.error(`[line-bot] ${action}ไม่สำเร็จ`, err);
  if (err instanceof CollectionReadError) {
    return { error: "อ่านไฟล์ทะเบียนทีม IT (data/line_staff.json) ไม่ออก จึงยังไม่บันทึกทับ — กู้ไฟล์จาก backup ก่อนแล้วลองใหม่" };
  }
  return { error: `${action}ไม่สำเร็จ — ลองกดอีกครั้ง` };
}

/** อนุมัติให้บัญชี LINE นี้พิมพ์ "แอดมิน" แล้วได้การ์ดควบคุมบอท */
export async function approveLineStaffAction(id: string): Promise<LineStaffActionResult> {
  const session = await requireSession("line-bot");
  if (typeof id !== "string" || !id) return { error: "ไม่พบคำขอ" };
  try {
    if (!approveLineStaff(id, actorOf(session))) return { error: "ไม่พบคำขอนี้แล้ว (อาจถูกลบจากอีกเครื่อง)" };
  } catch (err) {
    return failure(err, "อนุมัติ");
  }
  revalidatePath("/line-bot");
  return {};
}

/** ปฏิเสธคำขอ / ถอดสิทธิ์ — การ์ดที่ค้างในแชทของคนนั้นกดไม่ได้อีกทันที (บอทถามสิทธิ์ทุกครั้งที่กด) */
export async function removeLineStaffAction(id: string): Promise<LineStaffActionResult> {
  await requireSession("line-bot");
  if (typeof id !== "string" || !id) return { error: "ไม่พบรายการ" };
  try {
    removeLineStaff(id);
  } catch (err) {
    return failure(err, "ลบ");
  }
  revalidatePath("/line-bot");
  return {};
}

/** ปิด/เปิดบอททั้งระบบจากหน้าเว็บ (ทางสำรองของการ์ดในแชท) */
export async function setBotGlobalAction(off: boolean): Promise<BotControlResult> {
  const session = await requireSession("line-bot");
  const result = await setBotGlobal(off === true, actorOf(session));
  revalidatePath("/line-bot");
  return result;
}

/** เปิดบอทกลับให้ผู้ใช้คนหนึ่ง (คนที่ทีม IT ปิดไว้จากการ์ดในแชท) */
export async function resumeBotUserAction(lineUserId: string): Promise<BotControlResult> {
  const session = await requireSession("line-bot");
  if (typeof lineUserId !== "string" || !/^U[0-9A-Za-z_]{1,63}$/.test(lineUserId)) {
    return { ok: false, reason: "rejected" };
  }
  const result = await setBotUser(lineUserId, false, actorOf(session));
  revalidatePath("/line-bot");
  return result;
}
