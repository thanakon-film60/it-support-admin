import type { NextRequest } from "next/server";
import { verifyInternalKey, unauthorizedJson } from "@/lib/internal-auth";
import { listStockItemsWithStatus } from "@/lib/db/stock";
import {
  getEquipmentByAssetCode,
  listEquipment,
  listEquipmentSummary,
} from "@/lib/db/equipment";
import { matchFaqByKeyword, listFaqItems } from "@/lib/db/faq";
import { listTickets, listTicketsWithRelations } from "@/lib/db/tickets";
import { formatThaiDateShort } from "@/lib/utils";
import type { TicketWithRelations } from "@/lib/types";

export const dynamic = "force-dynamic";

/** แปลง ticket เป็นรูปแบบที่บอทเอาไปแสดงใน LINE ได้เลย (แปลงวันที่เป็น พ.ศ. ให้เสร็จจากฝั่งนี้
 *  เพื่อไม่ให้ bot ต้องรู้เรื่องรูปแบบวันที่ไทย ซึ่งจะกลายเป็น logic ซ้ำสองที่) */
function serializeTicket(ticket: TicketWithRelations) {
  return {
    ticket_code: ticket.ticket_code,
    type: ticket.type,
    status: ticket.status,
    location: ticket.location,
    description: ticket.description,
    requester_name: ticket.requester?.display_name ?? null,
    asset_code: ticket.equipment?.asset_code ?? null,
    created_at_th: formatThaiDateShort(ticket.created_at),
  };
}

/** รายชื่อสาขาที่ระบบรู้จัก — ดึงจาก location ของ ticket ที่มีอยู่จริง ไม่ได้ hardcode
 *  บอทใช้ชุดนี้ตรวจว่าสาขาที่ผู้ใช้พิมพ์มามีอยู่จริงไหม ก่อนจะรับเข้าเป็น ticket */
function listBranches(): string[] {
  return Array.from(
    new Set(
      listTickets()
        .map((t) => t.location?.trim())
        .filter((v): v is string => Boolean(v) && v !== "ไม่ระบุสาขา")
    )
  ).sort((a, b) => a.localeCompare(b, "th"));
}

/**
 * GET /api/internal/lookup?kind=stock|equipment|faq
 *
 * รวม endpoint อ่านข้อมูลที่ bot ต้องใช้ไว้ที่เดียว เพื่อไม่ให้มีไฟล์ route เล็กๆ กระจัดกระจาย
 *   - kind=stock              -> รายการสต็อกไว้ทำปุ่ม quick reply ตอนเลือกอุปกรณ์ที่จะเบิก
 *   - kind=equipment&code=... -> ตรวจว่ารหัสทรัพย์สินที่ผู้ใช้พิมพ์มีจริงไหม
 *   - kind=faq&q=...          -> จับคู่คำถามกับ FAQ ที่แอดมินสร้างไว้ในระบบ
 */
export async function GET(request: NextRequest) {
  if (!verifyInternalKey(request.headers.get("x-internal-key"))) {
    return unauthorizedJson();
  }

  const { searchParams } = request.nextUrl;
  const kind = searchParams.get("kind");

  if (kind === "stock") {
    // ส่งเฉพาะฟิลด์ที่ bot ใช้จริง ไม่ส่งทั้งก้อน — ลด payload และไม่รั่วข้อมูลเกินจำเป็น
    const items = listStockItemsWithStatus().map((s) => ({
      id: s.id,
      name: s.name,
      unit: s.unit,
      quantity_available: s.quantity_available,
      stock_status: s.stock_status,
    }));
    return Response.json({ items });
  }

  if (kind === "equipment") {
    const code = searchParams.get("code")?.trim();
    if (!code) return Response.json({ error: "ต้องส่ง code" }, { status: 400 });
    const eq = getEquipmentByAssetCode(code);
    // ดึงข้อมูลผู้ถือครอง/จำนวนครั้งที่ซ่อมมาด้วย เพื่อให้บอทตอบคำถามอย่าง
    // "NB2501001 ใครถืออยู่" ได้จากข้อมูลจริง ไม่ต้องให้คนไปเปิดหน้าเว็บดูเอง
    const summary = eq ? listEquipmentSummary().find((e) => e.id === eq.id) : null;
    return Response.json({
      found: Boolean(eq),
      equipment: eq
        ? {
            id: eq.id,
            asset_code: eq.asset_code,
            brand_model: eq.brand_model,
            status: eq.status,
            install_location: eq.install_location,
            holder_name: summary?.owner_name ?? null,
            holder_department: summary?.owner_department ?? null,
            repair_count: summary?.repair_count ?? 0,
          }
        : null,
    });
  }

  if (kind === "ticket") {
    const code = searchParams.get("code")?.trim();
    if (!code) return Response.json({ error: "ต้องส่ง code" }, { status: 400 });
    const ticket = listTicketsWithRelations().find(
      (t) => t.ticket_code.toUpperCase() === code.toUpperCase()
    );
    return Response.json({
      found: Boolean(ticket),
      ticket: ticket ? serializeTicket(ticket) : null,
    });
  }

  if (kind === "my_tickets") {
    const lineUserId = searchParams.get("line_user_id")?.trim();
    if (!lineUserId) return Response.json({ error: "ต้องส่ง line_user_id" }, { status: 400 });
    // จับคู่ได้ 2 ทาง: ticket ที่บอทสร้าง (เก็บ line_user_id ไว้ใน meta) และ ticket ที่ผูกกับ
    // user ที่มี line_user_id ตรงกัน (เช่นที่มาจาก LIFF) — ครอบคลุมทั้งสองเส้นทาง
    const tickets = listTicketsWithRelations()
      .filter(
        (t) =>
          (t.meta as Record<string, unknown> | null)?.line_user_id === lineUserId ||
          t.requester?.line_user_id === lineUserId
      )
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10);
    return Response.json({ tickets: tickets.map(serializeTicket) });
  }

  if (kind === "faq") {
    const q = searchParams.get("q")?.trim() ?? "";
    const matches = matchFaqByKeyword(q).map((f) => ({
      id: f.id,
      title: f.title,
      content: f.content,
      image_urls: f.image_urls,
    }));
    return Response.json({ matches });
  }

  if (kind === "branches") {
    return Response.json({ branches: listBranches() });
  }

  if (kind === "knowledge") {
    // ชุดข้อมูลรวมสำหรับให้ชั้น AI ของบอทใช้ทำความเข้าใจข้อความผู้ใช้
    // (ชื่อสาขา รหัสทรัพย์สิน ชื่อของในสต็อก และ FAQ ทั้งหมด)
    // บอทจะ cache ไว้ฝั่งมันเอง ไม่ได้ยิงมาทุกข้อความ
    //
    // ข้อควรระวังเมื่อข้อมูลโตขึ้น: ตอนนี้ส่งทรัพย์สินทั้งหมดในคราวเดียว ถ้าวันหนึ่งมีเป็นหมื่นชิ้น
    // ต้องเปลี่ยนเป็นส่งเฉพาะรหัส หรือทำ endpoint ค้นหาแทนการส่งทั้งก้อน
    return Response.json({
      branches: listBranches(),
      stock_items: listStockItemsWithStatus().map((s) => ({
        id: s.id,
        name: s.name,
        unit: s.unit,
        quantity_available: s.quantity_available,
        stock_status: s.stock_status,
      })),
      equipment: listEquipment().map((e) => ({
        asset_code: e.asset_code,
        brand_model: e.brand_model,
        category: e.category,
      })),
      faq: listFaqItems().map((f) => ({
        id: f.id,
        title: f.title,
        keywords: f.keywords,
        content: f.content,
      })),
    });
  }

  return Response.json(
    {
      error:
        "kind ต้องเป็น stock | equipment | faq | knowledge | branches | ticket | my_tickets",
    },
    { status: 400 }
  );
}
