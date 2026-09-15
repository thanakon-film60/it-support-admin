import type { NextRequest } from "next/server";
import { verifyInternalKey, unauthorizedJson } from "@/lib/internal-auth";
import { createTicket } from "@/lib/db/tickets";
import { findOrCreateUserByName } from "@/lib/db/users";
import { getEquipmentByAssetCode } from "@/lib/db/equipment";
import { deductStockForWithdrawTicket } from "@/lib/db/stock";
import type { Ticket, TicketType } from "@/lib/types";

// อ่าน/เขียน mock data ที่เปลี่ยนตลอด -> ห้ามให้ Next.js prerender เป็น static
export const dynamic = "force-dynamic";

const VALID_TYPES: TicketType[] = ["repair", "withdraw", "return", "it_service"];

interface Payload {
  type?: string;
  location?: string;
  description?: string;
  requester_name?: string;
  requester_department?: string | null;
  asset_code?: string | null;
  items?: { name?: string; qty?: number }[];
  line_user_id?: string | null;
  line_display_name?: string | null;
}

/**
 * POST /api/internal/tickets
 * สร้าง ticket จากภายนอก (ใช้โดย LINE Bot service ที่เขียนด้วย Python)
 *
 * เหตุผลที่ให้ Python ยิงมาที่นี่ แทนที่จะเขียนลง data store เอง:
 *   1. ตรรกะสำคัญ (เลข ticket, การตัดสต็อก, การผูก requester) อยู่ที่เดียว ไม่ต้อง maintain 2 ภาษา
 *   2. ถ้ามี process เขียนไฟล์ JSON เดียวกันพร้อมกัน 2 ตัว ข้อมูลมีโอกาสพังจาก race condition
 *   3. วันที่ย้ายไป Supabase แก้แค่ฝั่งนี้ฝั่งเดียว bot ไม่ต้องแก้เลย
 */
export async function POST(request: NextRequest) {
  if (!verifyInternalKey(request.headers.get("x-internal-key"))) {
    return unauthorizedJson();
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const type = body.type as TicketType | undefined;
  if (!type || !VALID_TYPES.includes(type)) {
    return Response.json({ error: `type ต้องเป็นหนึ่งใน ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }
  if (!body.requester_name?.trim()) {
    return Response.json({ error: "requester_name จำเป็น" }, { status: 400 });
  }

  // ทำความสะอาดรายการอุปกรณ์ที่เบิก: ตัดแถวที่ชื่อว่าง/จำนวนไม่ใช่ตัวเลขบวกทิ้ง
  const items = (body.items ?? [])
    .map((i) => ({ name: String(i.name ?? "").trim(), qty: Number(i.qty) }))
    .filter((i) => i.name.length > 0 && Number.isFinite(i.qty) && i.qty > 0);

  const requester = findOrCreateUserByName({
    display_name: body.requester_name.trim(),
    department: body.requester_department?.trim() || null,
  });

  const equipment = body.asset_code?.trim()
    ? getEquipmentByAssetCode(body.asset_code.trim())
    : null;

  // ถ้าไม่มี description ให้ประกอบข้อความสรุปจากรายการที่เบิกแทน เพื่อไม่ให้ ticket ว่างเปล่า
  const fallbackDescription =
    items.length > 0
      ? `ขอเบิก ${items.map((i) => `${i.name} x${i.qty}`).join(", ")}`
      : "(ไม่ได้ระบุรายละเอียด — แจ้งผ่าน LINE Bot)";

  const ticketInput: Omit<Ticket, "id" | "ticket_code" | "created_at" | "resolved_at"> = {
    type,
    status: "pending",
    location: body.location?.trim() || "ไม่ระบุสาขา",
    requester_id: requester.id,
    equipment_id: equipment?.id ?? null,
    description: body.description?.trim() || fallbackDescription,
    repair_cost: null,
    meta: {
      source: "line-bot",
      ...(items.length > 0 ? { items } : {}),
      ...(body.line_user_id ? { line_user_id: body.line_user_id } : {}),
      ...(body.line_display_name ? { line_display_name: body.line_display_name } : {}),
      // เก็บรหัสดิบที่ผู้ใช้พิมพ์ไว้ด้วย เผื่อหาไม่เจอ แอดมินจะได้ตามต่อเองได้
      ...(body.asset_code?.trim() ? { asset_code_input: body.asset_code.trim() } : {}),
    },
  };

  const ticket = createTicket(ticketInput);

  if (type === "withdraw" && items.length > 0) {
    deductStockForWithdrawTicket(items, `LINE Bot (${requester.display_name})`, ticket.ticket_code);
  }

  return Response.json({
    ok: true,
    ticket_code: ticket.ticket_code,
    id: ticket.id,
    equipment: equipment ? { asset_code: equipment.asset_code, brand_model: equipment.brand_model } : null,
    items,
  });
}
