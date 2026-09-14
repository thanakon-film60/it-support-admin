"use server";

import { revalidatePath } from "next/cache";
import { createTicket } from "@/lib/db/tickets";
import { findOrCreateUserByName, getUserByLineId, upsertLineUser } from "@/lib/db/users";
import { deductStockForWithdrawTicket } from "@/lib/db/stock";
import { getProfile } from "@/lib/line/client";
import type { Ticket, TicketType } from "@/lib/types";

export interface LiffTicketInput {
  type: TicketType;
  location: string;
  description: string;
  equipmentId?: string | null;
  items?: { name: string; qty: number }[];
  identity:
    | { mode: "liff"; lineUserId: string }
    | { mode: "manual"; name: string; employeeId?: string; department?: string };
}

export interface LiffTicketResult {
  error?: string;
  ticketCode?: string;
}

/** จุดเดียวที่สร้าง ticket ได้จริงในระบบทั้งหมด — เรียกจาก LIFF mini-app ที่พนักงานเปิดจาก
 *  LINE (หรือจากปุ่มที่ Bot ส่งให้) ตามสถาปัตยกรรมที่วิเคราะห์มาจากต้นแบบ (ดู PROJECT.md) */
export async function createLiffTicketAction(
  input: LiffTicketInput
): Promise<LiffTicketResult> {
  if (!input.description.trim()) {
    return { error: "กรุณากรอกรายละเอียดปัญหา" };
  }
  if (input.identity.mode === "manual" && !input.identity.name.trim()) {
    return { error: "กรุณากรอกชื่อผู้แจ้ง" };
  }

  let requesterId: string;
  if (input.identity.mode === "liff") {
    const existing = await getUserByLineId(input.identity.lineUserId);
    if (existing) {
      requesterId = existing.id;
    } else {
      // เผื่อกรณีเปิด LIFF ตรงๆ โดยยังไม่เคยทักบอทมาก่อน (webhook เลยยังไม่เคย sync user นี้)
      const profile = await getProfile(input.identity.lineUserId);
      const user = await upsertLineUser(input.identity.lineUserId, profile?.displayName ?? "ผู้ใช้ LINE");
      requesterId = user.id;
    }
  } else {
    const user = await findOrCreateUserByName({
      display_name: input.identity.name,
      employee_id: input.identity.employeeId || null,
      department: input.identity.department || null,
    });
    requesterId = user.id;
  }

  const ticketInput: Omit<Ticket, "id" | "ticket_code" | "created_at" | "resolved_at"> = {
    type: input.type,
    status: "pending",
    location: input.location.trim() || "ไม่ระบุสาขา",
    requester_id: requesterId,
    equipment_id: input.equipmentId ?? null,
    description: input.description.trim(),
    repair_cost: null,
    meta: input.items && input.items.length > 0 ? { items: input.items } : null,
  };

  const ticket = await createTicket(ticketInput);

  if (ticket.type === "withdraw" && input.items && input.items.length > 0) {
    await deductStockForWithdrawTicket(input.items, "LIFF (พนักงานแจ้งเอง)", ticket.ticket_code);
  }

  revalidatePath("/tickets");
  revalidatePath("/");
  revalidatePath("/stock");

  return { ticketCode: ticket.ticket_code };
}
