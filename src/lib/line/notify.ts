import "server-only";

import { pushMessage } from "./client";
import { buildTicketStatusMessage, STATUS_HEADLINE } from "./status-message";
import { buildStatusConfirmFlex } from "./confirm-card";
import { getUserById } from "@/lib/db/users";
import { getEquipmentById } from "@/lib/db/equipment";
import { TICKET_TYPE_LABEL } from "@/lib/labels";
import type { Ticket, TicketStatus } from "@/lib/types";

/**
 * แจ้งเตือนผู้แจ้งทาง LINE เมื่อสถานะ ticket เปลี่ยน
 *
 * ทำไมถึงสำคัญ: ก่อนหน้านี้ `pushMessage()` ใน client.ts ถูกเขียนไว้แต่ไม่เคยถูกเรียกจากที่ไหนเลย
 * แปลว่าพนักงานแจ้งเรื่องเข้ามาแล้ว "เงียบหายไปเลย" ต้องเดินมาถาม IT เอง หรือพิมพ์ถามบอทเองว่า
 * "เรื่องที่ฉันแจ้งถึงไหนแล้ว" — ซึ่งไม่มีใครทำจริงในชีวิตประจำวัน ระบบจึงถูกใช้แค่ครั้งเดียวแล้วเลิก
 *
 * ⚠️ เรื่องโควตาที่ต้องรู้ก่อนปรับค่า:
 *   LINE OA แพ็กเกจฟรีส่ง push ได้ 300 ข้อความ/เดือน (ข้อความ reply ไม่นับ — ตรวจจาก
 *   GET /v2/bot/info/quota ได้ค่า {"type":"limited","value":300})
 *   ค่าตั้งต้นจึงส่งเฉพาะสถานะ "จบเรื่อง" คือ resolved / closed / cancelled เท่านั้น
 *   = ประมาณ 1 ข้อความต่อ 1 ticket รองรับได้ ~300 ticket/เดือนบนแพ็กเกจฟรี
 *
 *   ถ้าอยากให้แจ้งทุกครั้งที่เปลี่ยนสถานะ ตั้ง env:
 *     LINE_NOTIFY_STATUSES=pending,in_progress,waiting_info,waiting_delivery,resolved,closed,cancelled
 *   ถ้าอยากปิดทั้งหมด ตั้งเป็นค่าว่าง:
 *     LINE_NOTIFY_STATUSES=
 */

const DEFAULT_NOTIFY_STATUSES = "resolved,closed,cancelled";

const ALL_STATUSES: TicketStatus[] = [
  "pending",
  "in_progress",
  "waiting_info",
  "waiting_delivery",
  "resolved",
  "completed",
  "closed",
  "cancelled",
];

function parseNotifyStatuses(): Set<TicketStatus> {
  const raw = process.env.LINE_NOTIFY_STATUSES ?? DEFAULT_NOTIFY_STATUSES;
  const wanted = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(ALL_STATUSES.filter((s) => wanted.includes(s)));
}

/** หา LINE user id ของผู้แจ้ง
 *
 *  ลำดับการหา:
 *    1. meta.line_user_id — ticket ที่สร้างจากบอท LINE จะมีค่านี้เสมอ (ตรงและเชื่อถือได้ที่สุด)
 *    2. users[requester_id].line_user_id — เผื่อ ticket ถูกสร้างทางอื่น แต่ผู้แจ้งเคยผูก LINE ไว้
 *
 *  ถ้าหาไม่เจอ = ผู้แจ้งไม่ได้มาจาก LINE (เช่นแอดมินคีย์เอง) ก็แค่ไม่ต้องส่ง ไม่ใช่ error
 */
function resolveLineUserId(ticket: Ticket): string | null {
  const fromMeta = ticket.meta?.line_user_id;
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim();

  const requester = ticket.requester_id ? getUserById(ticket.requester_id) : null;
  return requester?.line_user_id?.trim() || null;
}

export function canNotifyOnLine(ticket: Ticket): boolean {
  return Boolean(resolveLineUserId(ticket));
}
export type NotifyResult = "sent" | "skipped_status" | "skipped_no_line_user" | "skipped_no_token" | "failed";
export async function notifyTicketStatusChange(ticket: Ticket | null, options?: { force?: boolean; note?: string }): Promise<NotifyResult> {
  if (!ticket || (!options?.force && !parseNotifyStatuses().has(ticket.status))) return "skipped_status";
  try {
    const userId = resolveLineUserId(ticket);
    if (!userId) return "skipped_no_line_user";
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return "skipped_no_token";
    const equipment = ticket.equipment_id ? getEquipmentById(ticket.equipment_id) : null;
    await pushMessage(userId, [ticket.status === "resolved"
      ? buildStatusConfirmFlex(ticket, options?.note, equipment)
      : { type: "text", text: buildTicketStatusMessage(ticket, options?.note, equipment) }]);
    return "sent";
  } catch (error) {
    console.error("[LINE] status notification failed:", ticket.ticket_code, error);
    return "failed";
  }
}



/** Notify configured IT recipients on the first view; notification failure never blocks the view log. */
export async function notifyTicketViewed({ ticket, viewerName, totalViews }: {
  ticket: Ticket; viewerName: string; totalViews: number;
}): Promise<"sent" | "skipped_no_admins" | "skipped_no_token" | "failed"> {
  const admins = (process.env.LINE_ADMIN_USER_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 10);
  if (!admins.length) return "skipped_no_admins";
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return "skipped_no_token";
  const text = ["👁 ผู้แจ้งเปิดดูสถานะเรื่องแล้ว", "", "เลขที่: " + ticket.ticket_code,
    "ประเภท: " + TICKET_TYPE_LABEL[ticket.type], "สาขา: " + (ticket.location || "-"),
    "ผู้เปิดดู: " + viewerName, "สถานะตอนที่เปิดดู: " + STATUS_HEADLINE[ticket.status],
    "เปิดดูแล้วทั้งหมด: " + totalViews + " ครั้ง", "", "แจ้งเฉพาะครั้งแรกที่แต่ละคนเปิดดู เพื่อไม่ให้กินโควตา push"].join("\n");
  const results = await Promise.allSettled(admins.map(id => pushMessage(id, [{ type: "text", text }])));
  return results.some(r => r.status === "fulfilled") ? "sent" : "failed";
}
