import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyInternalKey, unauthorizedJson } from "@/lib/internal-auth";
import { createTicket, listTickets, type NewTicketInput } from "@/lib/db/tickets";
import { findOrCreateUserByName } from "@/lib/db/users";
import { findEquipmentByAssetCode, getEquipmentById } from "@/lib/db/equipment";
import { deductStockForWithdrawTicket } from "@/lib/db/stock";
import { findBranchesByName, isCompanyCode } from "@/lib/db/branches";
import type { CompanyCode, TicketType } from "@/lib/types";

// อ่าน/เขียน mock data ที่เปลี่ยนตลอด -> ห้ามให้ Next.js prerender เป็น static
export const dynamic = "force-dynamic";

const VALID_TYPES: TicketType[] = ["repair", "withdraw", "return", "it_service"];

interface Payload {
  request_id?: string;
  initial_message?: string | null;
  equipment_id?: string | null;
  type?: string;
  /** รหัสบริษัท (montipa | motta | central) — ไม่ส่งมาได้ ระบบจะเดาจากชื่อสาขาให้ถ้าไม่กำกวม */
  company?: string | null;
  location?: string;
  description?: string;
  requester_name?: string;
  requester_department?: string | null;
  asset_code?: string | null;
  items?: { name?: string; qty?: number }[];
  line_user_id?: string | null;
  line_display_name?: string | null;
  /** URL รูปที่ผู้ใช้ส่งมาในแชท (อัปโหลดผ่าน POST /api/internal/attachments มาก่อนแล้ว) */
  image_urls?: string[];
}

/** รับเฉพาะ path ที่ /api/internal/attachments เป็นคนออกให้เท่านั้น
 *
 *  ทำไมต้องกรอง: ค่านี้ถูกเก็บลง meta แล้วเอาไปใส่ <img src> ในหน้าแอดมินตรงๆ
 *  ถ้าปล่อยให้ส่ง URL อะไรมาก็ได้ คนที่ได้ INTERNAL_API_KEY ไปจะฝัง URL ภายนอกไว้ในหน้าแอดมินได้
 *  (ใช้ติดตามว่าแอดมินเปิดดูตอนไหน หรือชี้ไปไฟล์ที่ไม่ใช่รูป) — จำกัดไว้ที่ prefix เดียวปลอดภัยกว่า */
function sanitizeImageUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  return urls
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter((u) => /^\/uploads\/tickets\/[A-Za-z0-9-]+\.(jpg|png|gif|webp)$/.test(u))
    .slice(0, 10);
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

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "ต้องส่ง JSON object" }, { status: 400 });
  }
  const textFields = ["request_id", "initial_message", "equipment_id", "type", "company", "location", "description", "requester_name", "requester_department", "asset_code", "line_user_id", "line_display_name"] as const;
  for (const key of textFields) {
    if (body[key] != null && (typeof body[key] !== "string" || body[key]!.length > 10000)) {
      return Response.json({ error: `${key} ต้องเป็นข้อความไม่เกิน 10000 ตัวอักษร` }, { status: 400 });
    }
  }
  const requestId = body.request_id?.trim();
  if (requestId && !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) {
    return Response.json({ error: "request_id ไม่ถูกต้อง" }, { status: 400 });
  }

  // ---- บริษัทที่แจ้งเรื่อง ----
  //
  // รับค่าจากบอทเป็นหลัก (ผู้ใช้กดเลือกเองตั้งแต่ขั้นตอนแรก) แต่ถ้าไม่ได้ส่งมา — เช่นบอทรุ่นเก่า
  // ที่ยังไม่มีขั้นตอนเลือกบริษัท หรือ ticket ที่ยิงเข้ามาจากสคริปต์ — จะเดาจากชื่อสาขาให้
  // โดยเดา "เฉพาะเมื่อชื่อสาขานั้นอยู่บริษัทเดียวเท่านั้น" ถ้าซ้ำกันข้ามบริษัทจะปล่อยว่างไว้
  // ดีกว่าใส่บริษัทผิดลงไปเงียบๆ แล้วรายงานแยกตามบริษัทเพี้ยนโดยไม่มีใครรู้
  const locationInput = body.location?.trim() || "";
  let company: CompanyCode | null = null;
  if (body.company != null && body.company !== "") {
    if (!isCompanyCode(body.company)) {
      return Response.json({ error: "company ต้องเป็น montipa | motta | central" }, { status: 400 });
    }
    company = body.company;
    if (locationInput && findBranchesByName(locationInput, company).length === 0) {
      return Response.json(
        { error: `ไม่พบสาขา "${locationInput}" ในบริษัทที่เลือก` },
        { status: 400 }
      );
    }
  } else if (locationInput) {
    const matched = findBranchesByName(locationInput);
    const companies = Array.from(new Set(matched.map((b) => b.company)));
    company = companies.length === 1 ? companies[0] : null;
  }

  const type = body.type as TicketType | undefined;
  if (!type || !VALID_TYPES.includes(type)) {
    return Response.json({ error: `type ต้องเป็นหนึ่งใน ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }
  if (!body.requester_name?.trim()) {
    return Response.json({ error: "requester_name จำเป็น" }, { status: 400 });
  }

  // ทำความสะอาดรายการอุปกรณ์ที่เบิก: ตัดแถวที่ชื่อว่าง/จำนวนไม่ใช่ตัวเลขบวกทิ้ง
  if (body.items != null && (!Array.isArray(body.items) || body.items.length > 100 || body.items.some((item) =>
    !item || typeof item.name !== "string" || !item.name.trim() ||
    !Number.isInteger(item.qty) || Number(item.qty) <= 0 || Number(item.qty) > 999
  ))) {
    return Response.json({ error: "items ต้องมีชื่อและจำนวนเต็ม 1–999" }, { status: 400 });
  }
  const items = (body.items ?? [])
    .map((i) => ({ name: String(i.name ?? "").trim(), qty: Number(i.qty) }))
    .filter((i) => i.name.length > 0 && Number.isFinite(i.qty) && i.qty > 0);

  // No await between deduplication and persistence: the JSON adapter runs in one Node process.
  const existing = requestId ? listTickets().find((ticket) =>
    ticket.meta?.source === "line-bot" && ticket.meta?.request_id === requestId &&
    ticket.meta?.line_user_id === (body.line_user_id?.trim() || undefined)
  ) : undefined;
  if (existing) {
    return Response.json({ ok: true, duplicate: true, id: existing.id, ticket_code: existing.ticket_code,
      items: existing.meta?.items ?? [], image_urls: existing.meta?.image_urls ?? [] });
  }

  const matches = body.asset_code?.trim() ? findEquipmentByAssetCode(body.asset_code.trim()) : [];
  const equipment = body.equipment_id?.trim()
    ? getEquipmentById(body.equipment_id.trim())
    : matches.length === 1 ? matches[0] : null;
  if (body.equipment_id && (!equipment || (body.asset_code && !matches.some((e) => e.id === equipment.id)))) {
    return Response.json({ error: "ทรัพย์สินที่เลือกไม่ตรงกับรหัส กรุณาเลือกใหม่" }, { status: 400 });
  }

  const requester = findOrCreateUserByName({
    display_name: body.requester_name.trim(),
    department: body.requester_department?.trim() || null,
  });

  const imageUrls = sanitizeImageUrls(body.image_urls);

  // ถ้าไม่มี description ให้ประกอบข้อความสรุปจากรายการที่เบิกแทน เพื่อไม่ให้ ticket ว่างเปล่า
  const fallbackDescription =
    items.length > 0
      ? `${type === "return" ? "ขอคืน" : "รายการอุปกรณ์"} ${items.map((i) => `${i.name} x${i.qty}`).join(", ")}`
      : "(ไม่ได้ระบุรายละเอียด — แจ้งผ่าน LINE Bot)";

  const ticketInput: NewTicketInput = {
    type,
    status: "pending",
    company,
    location: locationInput || "ไม่ระบุสาขา",
    requester_id: requester.id,
    equipment_id: equipment?.id ?? null,
    description: [body.initial_message?.trim(), body.description?.trim()]
      .filter((text, index, all) => text && all.indexOf(text) === index).join("\n\n") || fallbackDescription,
    repair_cost: null,
    meta: {
      source: "line-bot",
      ...(requestId ? { request_id: requestId } : {}),
      requester_name: requester.display_name,
      requester_department: body.requester_department?.trim() || null,
      ...(body.initial_message?.trim() ? { initial_message: body.initial_message.trim() } : {}),
      ...(items.length > 0 ? { items } : {}),
      ...(imageUrls.length > 0 ? { image_urls: imageUrls } : {}),
      ...(body.line_user_id?.trim() ? { line_user_id: body.line_user_id.trim() } : {}),
      ...(body.line_display_name ? { line_display_name: body.line_display_name } : {}),
      // เก็บรหัสดิบที่ผู้ใช้พิมพ์ไว้ด้วย เผื่อหาไม่เจอ แอดมินจะได้ตามต่อเองได้
      ...(body.asset_code?.trim() ? { asset_code_input: body.asset_code.trim() } : {}),
    },
  };

  const ticket = createTicket(ticketInput);

  if (type === "withdraw" && items.length > 0) {
    deductStockForWithdrawTicket(items, `LINE Bot (${requester.display_name})`, ticket.ticket_code);
  }

  for (const path of ["/tickets", "/", "/repair-history", "/stock", "/stock/transactions"]) revalidatePath(path);

  return Response.json({
    ok: true,
    ticket_code: ticket.ticket_code,
    id: ticket.id,
    company: ticket.company,
    location: ticket.location,
    equipment: equipment ? { asset_code: equipment.asset_code, brand_model: equipment.brand_model } : null,
    items,
    image_urls: imageUrls,
  });
}
