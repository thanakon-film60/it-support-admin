// บัญชี LINE ของทีม IT ที่สั่งเปิด/ปิดบอทจากแชทได้ — data/line_staff.json
//
// ทำไมต้องมีทะเบียน: การ์ดควบคุมบอท (พิมพ์ "แอดมิน" หาบอท) สั่งให้บอทเงียบกับใครก็ได้ทั้งระบบ
// ถ้าใครพิมพ์ก็ได้สิทธิ์ ผู้ใช้ทั่วไปจะปิดบอทกันเองได้ — สิทธิ์จึงต้องผ่านแอดมินที่ล็อกอินหน้าเว็บอนุมัติก่อน
//
// ลำดับการใช้งาน: ทีม IT พิมพ์ "ขอสิทธิ์แอดมิน" ในแชท → บอทสร้างคำขอ (pending) ผ่าน /api/internal/line-staff
//                → แอดมินกดอนุมัติในหน้า "บอท LINE" → พิมพ์ "แอดมิน" ได้การ์ดควบคุมบอท
//
// อ่านแบบ strict (เหมือนหน้าฝากข้อความ): เป็นข้อมูลที่คนอนุมัติเอง ไฟล์เสียแล้วต้องไม่ถูกมองว่า
// "ยังไม่มีใคร" แล้วเขียนทับ — ไม่งั้นสิทธิ์ทั้งหมดหายเงียบๆ และคำขอใหม่จะทับไฟล์เดิม

import { newId } from "../utils";
import { readCollectionStrict, writeCollection } from "./store";
import type { LineStaff } from "../types";

const COLLECTION = "line_staff";

/** คำขอที่ยังไม่อนุมัติค้างได้มากสุดเท่านี้ — กันคนพิมพ์ "ขอสิทธิ์แอดมิน" รัวจากหลายบัญชีจนหน้าเว็บรก */
export const MAX_PENDING = 30;

/** user id ของ LINE ขึ้นต้นด้วย U (ของจริงยาว 33 ตัว) — ตรวจรูปแบบก่อนเก็บ กันค่าแปลกถูกยัดลงไฟล์ */
const LINE_USER_ID = /^U[0-9A-Za-z_]{1,63}$/;

export function isLineUserId(value: unknown): value is string {
  return typeof value === "string" && LINE_USER_ID.test(value);
}

function cleanName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim().slice(0, 100);
  return trimmed || null;
}

/** รออนุมัติขึ้นก่อน (ต้องทำอะไรสักอย่าง) แล้วตามด้วยคนที่อนุมัติแล้ว เรียงตามเวลาขอ */
export function listLineStaff(): LineStaff[] {
  return readCollectionStrict<LineStaff>(COLLECTION)
    .slice()
    .sort((a, b) =>
      a.status === b.status ? a.requested_at.localeCompare(b.requested_at) : a.status === "pending" ? -1 : 1
    );
}

export type LineStaffStatus = "approved" | "pending" | "none";

/** บอทถามว่าบัญชีนี้เป็นทีม IT ไหม — อัปเดตชื่อ LINE ล่าสุดไปด้วย (คนเปลี่ยนชื่อโปรไฟล์ได้ตลอด) */
export function checkLineStaff(lineUserId: string, displayName?: string | null): { status: LineStaffStatus; name: string | null } {
  const all = readCollectionStrict<LineStaff>(COLLECTION);
  const hit = all.find((s) => s.line_user_id === lineUserId);
  if (!hit) return { status: "none", name: null };
  const name = cleanName(displayName);
  const now = new Date().toISOString();
  const renamed = name !== null && name !== hit.display_name;
  // เวลาใช้งานล่าสุดเขียนไม่เกินชั่วโมงละครั้งต่อคน (เทียบถึงหลักชั่วโมงของ ISO)
  // — การ์ดถามสิทธิ์ทุกครั้งที่กดปุ่ม ไม่ต้องเขียนไฟล์ทุกครั้ง
  const staleSeen = hit.status === "approved" && hit.last_seen_at?.slice(0, 13) !== now.slice(0, 13);
  if (renamed || staleSeen) {
    if (renamed) hit.display_name = name;
    if (hit.status === "approved") hit.last_seen_at = now;
    writeCollection(COLLECTION, all);
  }
  return { status: hit.status, name: hit.display_name };
}

/** ขอสิทธิ์จากแชท — มีอยู่แล้วคืนสถานะเดิม (ขอซ้ำไม่สร้างแถวใหม่) · คำขอค้างเต็มแล้วไม่รับเพิ่ม */
export function requestLineStaff(lineUserId: string, displayName?: string | null): { status: LineStaffStatus; name: string | null } {
  const all = readCollectionStrict<LineStaff>(COLLECTION);
  const hit = all.find((s) => s.line_user_id === lineUserId);
  if (hit) return { status: hit.status, name: hit.display_name };
  if (all.filter((s) => s.status === "pending").length >= MAX_PENDING) return { status: "none", name: null };
  const row: LineStaff = {
    id: newId(),
    line_user_id: lineUserId,
    display_name: cleanName(displayName),
    status: "pending",
    requested_at: new Date().toISOString(),
    approved_at: null,
    approved_by: null,
    last_seen_at: null,
  };
  all.push(row);
  writeCollection(COLLECTION, all);
  return { status: "pending", name: row.display_name };
}

/** คืน null เมื่อไม่พบ (อาจถูกลบจากอีกเครื่องไปแล้ว) */
export function approveLineStaff(id: string, approvedBy: string): LineStaff | null {
  const all = readCollectionStrict<LineStaff>(COLLECTION);
  const hit = all.find((s) => s.id === id);
  if (!hit) return null;
  if (hit.status !== "approved") {
    hit.status = "approved";
    hit.approved_at = new Date().toISOString();
    hit.approved_by = approvedBy;
    writeCollection(COLLECTION, all);
  }
  return hit;
}

/** ปฏิเสธคำขอ / ถอดสิทธิ์ — ลบทั้งแถว (ขอใหม่ได้ ถ้าจำเป็น) · คืน false เมื่อไม่มีอยู่แล้ว */
export function removeLineStaff(id: string): boolean {
  const all = readCollectionStrict<LineStaff>(COLLECTION);
  const next = all.filter((s) => s.id !== id);
  if (next.length === all.length) return false;
  writeCollection(COLLECTION, next);
  return true;
}
