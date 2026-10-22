"use server";

import { revalidatePath } from "next/cache";
import { AUTH_DISABLED, requireSession } from "@/lib/auth";
import {
  getTicketById, updateTicketStatus, readStatusHistory, recordStatusNotification,
} from "@/lib/db/tickets";
import { notifyTicketStatusChange, type NotifyResult } from "@/lib/line/notify";
import { isTicketStatus } from "@/lib/ticket-status";
import { MAX_EDITOR_NAME, accountEditorName } from "@/lib/editor-name";
import type { Ticket, TicketStatus } from "@/lib/types";

export interface StatusChangeResult {
  success?: boolean;
  error?: string;
  ticket?: Ticket;
  notify?: NotifyResult | "not_requested";
}
/** editor = ชื่อที่พิมพ์ในหน้าต่าง ใช้เฉพาะตอนปิดล็อกอิน (AUTH_DISABLED) — ล็อกอินอยู่ใช้ชื่อบัญชีจาก session เสมอ */
export async function changeTicketStatusAction(
  ticketId: string, status: TicketStatus, editor?: string,
  options: { note?: string; notifyLine?: boolean; expectedUpdatedAt?: string | null } = {}
): Promise<StatusChangeResult> {
  // หน้า "แก้ไขปัญหาแล้ว" กับ "ประวัติซ่อม" ถูกรวมเข้าหน้า Tickets แล้ว (21 ต.ค. 2026) — ปุ่มนี้เหลือหน้าเดียว
  const session = await requireSession("tickets");
  // ผู้แก้ไข = บัญชีที่ล็อกอินอยู่ (ผู้ใช้ขอ 13 ต.ค. 2026 — ไม่ต้องพิมพ์ชื่อเอง)
  // ห้ามเชื่อชื่อจากหน้าเว็บตอนล็อกอินอยู่: Server Action ถูกเรียกตรงได้ ใครก็ส่งชื่อคนอื่นมาบันทึกในประวัติได้
  // ปิดล็อกอิน (AUTH_DISABLED) ไม่มีตัวตนให้อ้างอิง (ทุกคนเป็น "ผู้ใช้ทั่วไป") จึงยังใช้ชื่อที่พิมพ์มาแบบเดิม
  const editorName = AUTH_DISABLED ? editor?.trim() ?? "" : accountEditorName(session);
  if (!editorName) return { error: "กรุณาระบุชื่อผู้แก้ไข" };
  if (editorName.length > MAX_EDITOR_NAME) return { error: "ชื่อผู้แก้ไขยาวเกินไป" };
  // รับแค่ 2 สถานะ — สถานะของระบบเดิม (completed, cancelled ฯลฯ) จากหน้าต่างที่เปิดค้างไว้ก่อนอัปเดตถูกปฏิเสธที่นี่
  if (!isTicketStatus(status)) return { error: "สถานะไม่ถูกต้อง" };
  const note = options.note?.trim() ?? "";
  if (note.length > 500) return { error: "หมายเหตุยาวเกินไป" };
  const before = getTicketById(ticketId);
  if (!before) return { error: "ไม่พบเรื่องนี้" };
  if (options.expectedUpdatedAt !== undefined && options.expectedUpdatedAt !== (before.status_updated_at ?? null)) {
    return { error: "เรื่องนี้ถูกอัปเดตแล้ว กรุณาเปิดใหม่ก่อนบันทึก" };
  }
  if (status === before.status && !note) return { error: "กรุณาเปลี่ยนสถานะหรือระบุหมายเหตุก่อนบันทึก" };
  // ไม่มีสถานะ "รอข้อมูล" ที่สั่งบอทเงียบอัตโนมัติแล้ว (ยุบเหลือ 2 สถานะ) — จะคุยกับผู้แจ้งเองใน LINE OA
  // ให้กด "รับแชทต่อเอง" ในแผงรายละเอียดของเรื่อง (ChatTakeoverCard) ซึ่งทำงานเหมือนเดิมทุกอย่าง
  let ticket = updateTicketStatus(ticketId, status, editorName, { note })!;
  let notify: StatusChangeResult["notify"] = "not_requested";
  if (options.notifyLine) {
    const historyId = readStatusHistory(ticket).at(-1)!.id;
    notify = await notifyTicketStatusChange(ticket, { force: true, note });
    ticket = recordStatusNotification(ticketId, historyId, notify === "sent") ?? ticket;
  }
  for (const path of ["/tickets", "/"]) revalidatePath(path);
  return { success: true, ticket, notify };
}
