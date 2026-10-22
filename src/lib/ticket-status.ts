// สถานะของ ticket: ชื่อที่แสดง + การแปลงสถานะของระบบเดิม — ใช้ได้ทั้งฝั่ง server และ client (ไม่แตะ db)
//
// แยกจาก components/ui/Badge.tsx เพราะ lib/db/tickets.ts (ฝั่งเซิร์ฟเวอร์) ต้องใช้ตารางแปลงชุดเดียวกัน
// ถ้าตารางแปลงไปอยู่สองที่ วันหนึ่งหน้าเว็บจะโชว์ "รอดำเนินการ" ขณะที่ข้อมูลจริงถูกแปลงเป็น "แก้ไขแล้ว"

import type { AnyTicketStatus, LegacyTicketStatus, TicketStatus } from "./types";

export const TICKET_STATUS_ORDER: TicketStatus[] = ["pending", "resolved", "cancelled"];

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  pending: "รอดำเนินการ",
  resolved: "แก้ไขแล้ว",
  cancelled: "ยกเลิก",
};

/** สถานะที่ "จบเรื่องแล้ว" — ทีม IT ไม่ต้องทำอะไรต่อ (ใช้กับตัวเลขค้างงาน/ปฏิทินหน้าแรก) */
export const CLOSED_STATUSES: TicketStatus[] = ["resolved", "cancelled"];

const LEGACY_STATUS_LABEL: Record<LegacyTicketStatus, string> = {
  in_progress: "กำลังดำเนินการ",
  waiting_info: "รอข้อมูล",
  waiting_delivery: "รอส่งมอบ",
  completed: "ดำเนินการเสร็จสิ้น",
  closed: "ปิดแล้ว",
};

/** สถานะเดิม → สถานะปัจจุบัน (ยุบสถานะ 21 ต.ค. 2026)
 *  "ยกเลิก" ไม่อยู่ในนี้แล้ว — ผู้ใช้ขอเพิ่มกลับเป็นสถานะจริงในวันเดียวกัน (ไฟล์ที่กู้จาก backup จึงคงยกเลิกไว้ตามเดิม) */
export const LEGACY_TO_CURRENT: Record<LegacyTicketStatus, TicketStatus> = {
  in_progress: "pending",
  waiting_info: "pending",
  waiting_delivery: "pending",
  completed: "resolved",
  closed: "resolved",
};

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === "string" && Object.hasOwn(TICKET_STATUS_LABEL, value);
}

export function isLegacyStatus(value: unknown): value is LegacyTicketStatus {
  return typeof value === "string" && Object.hasOwn(LEGACY_TO_CURRENT, value);
}

/** ชื่อสถานะสำหรับแสดงผล — รับสถานะเดิมด้วย เพราะประวัติ/ไทม์ไลน์ของเรื่องเก่ายังเก็บค่าเหล่านั้นอยู่
 *  ค่าที่ไม่รู้จักเลย (ไฟล์ถูกแก้มือ) คืนตัวมันเอง ดีกว่าช่องว่างที่ทำให้ประวัติอ่านไม่ออก */
export function statusLabel(code: AnyTicketStatus | string): string {
  if (isTicketStatus(code)) return TICKET_STATUS_LABEL[code];
  if (isLegacyStatus(code)) return LEGACY_STATUS_LABEL[code];
  return code;
}
