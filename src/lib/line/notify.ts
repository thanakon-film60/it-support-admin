import "server-only";

import { pushMessage, type LineMessage } from "./client";
import { buildTicketStatusMessage, STATUS_HEADLINE } from "./status-message";
import { buildCompletedRatingFlex } from "./rating-card";
import { ticketOwnerLineId } from "@/lib/db/tickets";
import { getEquipmentById } from "@/lib/db/equipment";
import { TICKET_TYPE_LABEL } from "@/lib/labels";
import type { Equipment, Ticket, TicketStatus } from "@/lib/types";

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
 *   ค่าตั้งต้นจึงส่งเฉพาะสถานะ "จบเรื่อง" คือ resolved (แก้ไขแล้ว — การ์ดให้คะแนน) และ cancelled (ยกเลิก — ข้อความธรรมดา)
 *   = ประมาณ 1 ข้อความต่อ 1 ticket รองรับได้ ~300 ticket/เดือนบนแพ็กเกจฟรี
 *   การแจ้งทีม IT (เปิดดูครั้งแรก / ผู้แจ้งกดยังมีปัญหา) ก็เป็น push เหมือนกัน — นับ 1 ต่อแอดมิน 1 คน
 *   (ค่านี้มีผลเฉพาะการส่งอัตโนมัติ — หน้าต่างอัปเดตสถานะส่งตามสวิตช์ที่แอดมินติ๊กเสมอ)
 *
 *   ถ้าอยากให้แจ้งทุกครั้งที่เปลี่ยนสถานะ ตั้ง env:
 *     LINE_NOTIFY_STATUSES=pending,resolved,cancelled
 *   ถ้าอยากปิดทั้งหมด ตั้งเป็นค่าว่าง:
 *     LINE_NOTIFY_STATUSES=
 *   ค่าของระบบเดิม (completed, closed ฯลฯ) ใน .env ถูกข้ามไปเฉยๆ ไม่ทำให้อะไรพัง
 */

export const DEFAULT_NOTIFY_STATUSES = "resolved,cancelled";

const ALL_STATUSES: TicketStatus[] = ["pending", "resolved", "cancelled"];

function parseNotifyStatuses(): Set<TicketStatus> {
  const raw = process.env.LINE_NOTIFY_STATUSES ?? DEFAULT_NOTIFY_STATUSES;
  const wanted = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(ALL_STATUSES.filter((s) => wanted.includes(s)));
}

/** ถ้าหาบัญชี LINE ไม่เจอ = ผู้แจ้งไม่ได้มาจาก LINE (เช่นแอดมินคีย์เอง) ก็แค่ไม่ต้องส่ง ไม่ใช่ error */
export function canNotifyOnLine(ticket: Ticket): boolean {
  return Boolean(ticketOwnerLineId(ticket));
}

/** หน้าตาข้อความตามสถานะ — แก้ไขแล้วได้การ์ดแจ้งผล + ให้คะแนน + ปุ่ม "ยังมีปัญหาอยู่"
 *  · รอดำเนินการ / ยกเลิก ได้ข้อความธรรมดา (ยกเลิกไม่มีอะไรให้คะแนน — ส่งการ์ดดาวไปจะได้คะแนนของงานที่ไม่ได้ทำ) */
export function buildStatusNotification(ticket: Ticket, note?: string | null, equipment?: Equipment | null): LineMessage {
  if (ticket.status === "resolved") return buildCompletedRatingFlex(ticket, note, equipment);
  return { type: "text", text: buildTicketStatusMessage(ticket, note, equipment) };
}

export type NotifyResult = "sent" | "skipped_status" | "skipped_no_line_user" | "skipped_no_token" | "failed";
export async function notifyTicketStatusChange(ticket: Ticket | null, options?: { force?: boolean; note?: string }): Promise<NotifyResult> {
  if (!ticket || (!options?.force && !parseNotifyStatuses().has(ticket.status))) return "skipped_status";
  try {
    const userId = ticketOwnerLineId(ticket);
    if (!userId) return "skipped_no_line_user";
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return "skipped_no_token";
    const equipment = ticket.equipment_id ? getEquipmentById(ticket.equipment_id) : null;
    await pushMessage(userId, [buildStatusNotification(ticket, options?.note, equipment)]);
    return "sent";
  } catch (error) {
    console.error("[LINE] status notification failed:", ticket.ticket_code, error);
    return "failed";
  }
}

export type AdminNotifyResult = "sent" | "skipped_no_admins" | "skipped_no_token" | "failed";

/** ส่งข้อความหาทีม IT ตาม LINE_ADMIN_USER_IDS (ไม่เกิน 10 คน — กันโควตา push หมดเพราะใส่รายชื่อยาว)
 *  ส่งไม่สำเร็จต้องไม่ทำให้งานหลักล้ม จึงคืนผลเป็นค่า ไม่ throw */
async function pushToItAdmins(text: string): Promise<AdminNotifyResult> {
  const admins = (process.env.LINE_ADMIN_USER_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 10);
  if (!admins.length) return "skipped_no_admins";
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return "skipped_no_token";
  const results = await Promise.allSettled(admins.map(id => pushMessage(id, [{ type: "text", text }])));
  return results.some(r => r.status === "fulfilled") ? "sent" : "failed";
}

/** Notify configured IT recipients on the first view; notification failure never blocks the view log. */
export async function notifyTicketViewed({ ticket, viewerName, totalViews }: {
  ticket: Ticket; viewerName: string; totalViews: number;
}): Promise<AdminNotifyResult> {
  const text = ["👁 ผู้แจ้งเปิดดูสถานะเรื่องแล้ว", "", "เลขที่: " + ticket.ticket_code,
    "ประเภท: " + TICKET_TYPE_LABEL[ticket.type], "สาขา: " + (ticket.location || "-"),
    "ผู้เปิดดู: " + viewerName, "สถานะตอนที่เปิดดู: " + STATUS_HEADLINE[ticket.status],
    "เปิดดูแล้วทั้งหมด: " + totalViews + " ครั้ง", "", "แจ้งเฉพาะครั้งแรกที่แต่ละคนเปิดดู เพื่อไม่ให้กินโควตา push"].join("\n");
  return pushToItAdmins(text);
}

/** ผู้แจ้งกด "ยังมีปัญหาอยู่" — เรื่องถูกดึงกลับมาเป็น "รอดำเนินการ"
 *
 *  ต้องแจ้งทีม IT ทันที: ตอนทีมปิดงานไปแล้ว ไม่มีใครเปิดดูเรื่องนั้นอีก ถ้าแค่เปลี่ยนสถานะเงียบๆ
 *  เรื่องจะไปโผล่ในตารางโดยไม่มีใครสังเกต ขณะที่ผู้แจ้งเข้าใจว่าทีม IT รู้แล้วและกำลังมา */
export async function notifyTicketReopened({ ticket, requesterName, closedBy }: {
  ticket: Ticket; requesterName: string; closedBy?: string | null;
}): Promise<AdminNotifyResult> {
  const text = ["🔁 ผู้แจ้งแจ้งว่ายังมีปัญหาอยู่ — เปิดเรื่องกลับมาแล้ว", "", "เลขที่: " + ticket.ticket_code,
    "ประเภท: " + TICKET_TYPE_LABEL[ticket.type], "สาขา: " + (ticket.location || "-"),
    "ผู้แจ้ง: " + requesterName, ...(closedBy ? ["ปิดงานรอบก่อนโดย: " + closedBy] : []),
    "สถานะตอนนี้: " + STATUS_HEADLINE[ticket.status], "", "ดูรายละเอียดได้ที่หน้า Tickets ในระบบแอดมิน"].join("\n");
  return pushToItAdmins(text);
}
