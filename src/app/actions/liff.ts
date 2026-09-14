"use server";

import { revalidatePath } from "next/cache";
import { createTicket } from "@/lib/db/tickets";
import { findOrCreateUserByName, getUserByLineId, upsertLineUser } from "@/lib/db/users";
import { deductStockForWithdrawTicket } from "@/lib/db/stock";
import { verifyLiffIdToken } from "@/lib/line/id-token";
import type { Ticket, TicketType } from "@/lib/types";

export interface LiffTicketInput {
  type: TicketType;
  location: string;
  description: string;
  equipmentId?: string | null;
  items?: { name: string; qty: number }[];
  identity:
    | { mode: "liff"; idToken: string }
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
  const validTypes: TicketType[] = ["repair", "withdraw", "return", "it_service"];
  if (!input || !validTypes.includes(input.type)) {
    return { error: "ประเภทคำขอไม่ถูกต้อง" };
  }

  const description = typeof input.description === "string" ? input.description.trim() : "";
  const location = typeof input.location === "string" ? input.location.trim() : "";
  if (!description) {
    return { error: "กรุณากรอกรายละเอียดปัญหา" };
  }
  if (description.length > 4_000 || location.length > 200) {
    return { error: "รายละเอียดหรือสถานที่ยาวเกินกำหนด" };
  }
  if (!input.identity || !["liff", "manual"].includes(input.identity.mode)) {
    return { error: "ข้อมูลผู้แจ้งไม่ถูกต้อง" };
  }
  if (
    input.identity.mode === "manual" &&
    (process.env.NEXT_PUBLIC_LIFF_ID?.trim() || process.env.LINE_LOGIN_CHANNEL_ID?.trim())
  ) {
    return { error: "กรุณาเปิดฟอร์มนี้ผ่าน LINE เพื่อยืนยันตัวตน" };
  }
  if (input.identity.mode === "manual" && !input.identity.name.trim()) {
    return { error: "กรุณากรอกชื่อผู้แจ้ง" };
  }

  const items = Array.isArray(input.items)
    ? input.items
        .slice(0, 20)
        .map((item) => ({
          name: typeof item?.name === "string" ? item.name.trim().slice(0, 200) : "",
          qty: Number.isFinite(item?.qty) ? Math.trunc(item.qty) : 0,
        }))
        .filter((item) => item.name && item.qty > 0 && item.qty <= 999)
    : [];

  let requesterId: string;
  if (input.identity.mode === "liff") {
    let identity;
    try {
      identity = await verifyLiffIdToken(input.identity.idToken);
    } catch (error) {
      console.error("[LINE LIFF] verification unavailable:", error);
      return { error: "ระบบยืนยันตัวตน LINE ยังตั้งค่าไม่ครบ กรุณาติดต่อทีม IT" };
    }
    if (!identity) {
      return { error: "ยืนยันตัวตน LINE ไม่สำเร็จ กรุณาปิดแล้วเปิดฟอร์มใหม่จาก LINE" };
    }

    const existing = await getUserByLineId(identity.userId);
    if (existing) {
      requesterId = existing.id;
    } else {
      const user = await upsertLineUser(identity.userId, identity.displayName);
      requesterId = user.id;
    }
  } else {
    const name = input.identity.name.trim().slice(0, 120);
    const user = await findOrCreateUserByName({
      display_name: name,
      employee_id: input.identity.employeeId?.trim().slice(0, 80) || null,
      department: input.identity.department?.trim().slice(0, 120) || null,
    });
    requesterId = user.id;
  }

  const ticketInput: Omit<Ticket, "id" | "ticket_code" | "created_at" | "resolved_at"> = {
    type: input.type,
    status: "pending",
    location: location || "ไม่ระบุสาขา",
    requester_id: requesterId,
    equipment_id:
      typeof input.equipmentId === "string" && input.equipmentId.trim()
        ? input.equipmentId.trim()
        : null,
    description,
    repair_cost: null,
    meta: items.length > 0 ? { items } : null,
  };

  const ticket = await createTicket(ticketInput);

  if (ticket.type === "withdraw" && items.length > 0) {
    await deductStockForWithdrawTicket(items, "LIFF (พนักงานแจ้งเอง)", ticket.ticket_code);
  }

  revalidatePath("/tickets");
  revalidatePath("/");
  revalidatePath("/stock");

  return { ticketCode: ticket.ticket_code };
}
