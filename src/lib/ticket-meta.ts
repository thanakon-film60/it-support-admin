import type { Ticket } from "./types";

/**
 * อ่านข้อมูลเสริมของ ticket ที่บอท LINE เก็บไว้ใน meta — ชื่อ LINE ของคนที่ส่งเรื่อง และรายการอุปกรณ์
 *
 * ทำไมต้องมีตัวอ่านกลาง: meta เป็น Record<string, unknown> (ข้อมูลเก่า/สคริปต์ใส่ชนิดผิดมาได้)
 * ถ้าแต่ละหน้า cast เอง วันที่เจอแถวเพี้ยนแถวเดียวทั้งตารางจะพัง — อ่านผ่านที่นี่ที่เดียว ค่าเพี้ยนถูกข้ามไป
 *
 * ไฟล์นี้ใช้ได้ทั้งฝั่ง client และ server (ไม่ import lib/db) — หน้า Tickets เป็น client component
 */

export interface TicketItem {
  name: string;
  qty: number;
}

type MetaCarrier = Pick<Ticket, "meta">;

/** ชื่อโปรไฟล์ LINE ของคนที่ส่งเรื่องเข้ามา (ไม่ใช่ชื่อผู้แจ้งที่พิมพ์ในแชท)
 *
 *  ต่างจาก "ผู้แจ้ง": ผู้แจ้งคือคนที่เรื่องนี้เป็นของเขา (พิมพ์ชื่อ/เลือกจากทะเบียน) ส่วนชื่อ LINE
 *  บอกว่า "ใครเป็นคนกดส่ง" — แจ้งแทนกันได้ และชื่อ LINE คือชื่อที่ทีม IT เห็นในแอป LINE OA ตอนทักกลับ */
export function ticketLineName(ticket: MetaCarrier): string | null {
  const raw = ticket.meta?.line_display_name;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** รายการอุปกรณ์ที่เบิก/คืน — คืนลิสต์ว่างถ้าไม่มีหรือข้อมูลเพี้ยน */
export function ticketItems(ticket: MetaCarrier): TicketItem[] {
  const raw = ticket.meta?.items;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): TicketItem[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const qty = Number(record.qty);
    return name && Number.isFinite(qty) && qty > 0 ? [{ name, qty }] : [];
  });
}

/** "เมาส์ x2, คีย์บอร์ด x1" */
export function formatTicketItems(items: TicketItem[]): string {
  return items.map((item) => `${item.name} x${item.qty}`).join(", ");
}

/** บรรทัดสรุปรายการพร้อมคำนำ: "ขอเบิก เมาส์ x2" / "ขอคืน ..." — null ถ้าไม่มีรายการ */
export function ticketItemsLine(ticket: MetaCarrier & Pick<Ticket, "type">): string | null {
  const items = ticketItems(ticket);
  if (items.length === 0) return null;
  const verb = ticket.type === "withdraw" ? "ขอเบิก" : ticket.type === "return" ? "ขอคืน" : "รายการอุปกรณ์";
  return `${verb} ${formatTicketItems(items)}`;
}

/** เรื่องเบิกที่ไม่มีรายการอุปกรณ์ — ticket เก่าก่อนบังคับระบุอุปกรณ์ (13 ต.ค. 2026) ทีม IT ต้องทักถามเอง */
export function withdrawMissingItems(ticket: MetaCarrier & Pick<Ticket, "type">): boolean {
  return ticket.type === "withdraw" && ticketItems(ticket).length === 0;
}
