"use server";

import { revalidatePath } from "next/cache";
import { createTicket, type NewTicketInput } from "@/lib/db/tickets";
import { findOrCreateUserByName, getUserByLineId, upsertLineUser } from "@/lib/db/users";
import { deductStockForWithdrawTicket } from "@/lib/db/stock";
import { getProfile } from "@/lib/line/client";
import { findBranchesByName, isCompanyCode } from "@/lib/db/branches";
import type { CompanyCode, TicketType } from "@/lib/types";

export interface LiffTicketInput {
  type: TicketType;
  /** บริษัทที่แจ้ง — ฟอร์มบังคับให้เลือกก่อน แล้วค่อยกรองสาขาตามบริษัทนั้น */
  company: CompanyCode | "";
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
  if (!isCompanyCode(input.company)) {
    return { error: "กรุณาเลือกบริษัท" };
  }
  const location = input.location.trim();
  if (!location) {
    return { error: "กรุณาเลือกสาขา" };
  }
  // ตรวจว่าสาขาที่ส่งมาอยู่ในบริษัทที่เลือกจริง — ฟอร์มกรองให้แล้ว แต่ Server Action
  // ถูกเรียกตรงจากที่อื่นได้ ห้ามเชื่อค่าที่มาจากฝั่ง client อย่างเดียว
  if (findBranchesByName(location, input.company).length === 0) {
    return { error: `ไม่พบสาขา "${location}" ในบริษัทที่เลือก` };
  }

  let requesterId: string;
  if (input.identity.mode === "liff") {
    const existing = getUserByLineId(input.identity.lineUserId);
    if (existing) {
      requesterId = existing.id;
    } else {
      // เผื่อกรณีเปิด LIFF ตรงๆ โดยยังไม่เคยทักบอทมาก่อน (webhook เลยยังไม่เคย sync user นี้)
      const profile = await getProfile(input.identity.lineUserId);
      const user = upsertLineUser(input.identity.lineUserId, profile?.displayName ?? "ผู้ใช้ LINE");
      requesterId = user.id;
    }
  } else {
    const user = findOrCreateUserByName({
      display_name: input.identity.name,
      employee_id: input.identity.employeeId || null,
      department: input.identity.department || null,
    });
    requesterId = user.id;
  }

  const ticketInput: NewTicketInput = {
    type: input.type,
    status: "pending",
    company: input.company,
    location,
    requester_id: requesterId,
    equipment_id: input.equipmentId ?? null,
    description: input.description.trim(),
    repair_cost: null,
    meta: input.items && input.items.length > 0 ? { items: input.items } : null,
  };

  const ticket = createTicket(ticketInput);

  if (ticket.type === "withdraw" && input.items && input.items.length > 0) {
    deductStockForWithdrawTicket(input.items, "LIFF (พนักงานแจ้งเอง)", ticket.ticket_code);
  }

  revalidatePath("/tickets");
  revalidatePath("/");
  revalidatePath("/stock");

  return { ticketCode: ticket.ticket_code };
}
