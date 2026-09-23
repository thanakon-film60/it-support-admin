import type { NextRequest } from "next/server";
import { verifyInternalKey, unauthorizedJson } from "@/lib/internal-auth";
import { confirmTicketByRequester, getTicketByCode } from "@/lib/db/tickets";
import { revalidatePath } from "next/cache";
import { getUserById } from "@/lib/db/users";

export const dynamic = "force-dynamic";

interface Payload {
  ticket_code?: string;
  line_user_id?: string;
  /** confirm = ผู้แจ้งกด "ตกลง" · reject = กด "ยังไม่หาย" */
  action?: "confirm" | "reject";
  confirmed?: boolean;
  display_name?: string;
  viewer_name?: string | null;
  note?: string | null;
}

/**
 * POST /api/internal/tickets/confirm — ผู้แจ้งยืนยันผลการแก้ไขจากแชท LINE
 *
 * confirm -> สถานะกลายเป็น "ดำเนินการเสร็จสิ้น" (completed) แล้วย้ายไปหน้า log
 * reject  -> ดึงกลับเป็น "กำลังดำเนินการ" พร้อมบันทึกไว้ในไทม์ไลน์ว่าผู้แจ้งแจ้งว่ายังไม่หาย
 */
export async function POST(req: NextRequest) {
  if (!verifyInternalKey(req.headers.get("x-internal-key"))) return unauthorizedJson();

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || typeof body.ticket_code !== "string" ||
      (typeof body.confirmed !== "boolean" && !["confirm", "reject"].includes(body.action ?? "")) ||
      (body.line_user_id !== undefined && typeof body.line_user_id !== "string") ||
      [body.viewer_name, body.display_name, body.note].some(v => v != null && typeof v !== "string")) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }
  const code = body.ticket_code.trim();
  if (!code) return Response.json({ error: "ticket_code is required" }, { status: 400 });

  const ticket = getTicketByCode(code);
  if (!ticket) return Response.json({ error: "ticket not found" }, { status: 404 });

  // ต้องเป็นผู้แจ้งคนนั้นจริงๆ เท่านั้น
  //
  // ถ้าไม่เช็ค ใครก็ตามที่รู้เลขที่ตั๋ว (ซึ่งโผล่ในแชทกลุ่มได้ง่ายๆ) จะปิดเรื่องของคนอื่นได้
  // และ log การแก้ปัญหาจะมีลายเซ็นของคนที่ไม่เกี่ยวข้อง — ทำให้หลักฐานทั้งชุดใช้ไม่ได้
  const lineUserId = (body.line_user_id ?? "").trim();
  const ticketOwner =
    (typeof ticket.meta?.line_user_id === "string" ? ticket.meta.line_user_id : null) ??
    (ticket.requester_id ? getUserById(ticket.requester_id)?.line_user_id ?? null : null);

  if (!lineUserId || !ticketOwner || lineUserId !== ticketOwner) {
    return Response.json({ error: "not the requester", reason: "not_owner", ok: false }, { status: 403 });
  }

  // ยืนยันได้เฉพาะตอนที่ทีม IT แจ้งว่าแก้เสร็จแล้วเท่านั้น
  // กดจากข้อความเก่าหลังเรื่องถูกเปลี่ยนสถานะไปแล้วเป็นเรื่องปกติ — บอกตรงๆ ดีกว่าทำเงียบๆ
  const isConfirm = body.confirmed ?? (body.action === "confirm");
  if (ticket.status === "completed" && isConfirm) {
    return Response.json({ ok: true, duplicate: true, status: ticket.status, ticket_code: ticket.ticket_code });
  }
  if (ticket.status !== "resolved" && ticket.status !== "completed") {
    return Response.json({
      ok: false,
      reason: body.action ? "not_resolved" : "not_confirmable",
      status: ticket.status,
      ticket_code: ticket.ticket_code,
    }, { status: body.action ? 200 : 409 });
  }

  const actor = (body.viewer_name ?? body.display_name ?? "").trim() || "ผู้แจ้ง";

  const updated = confirmTicketByRequester({
    ticketId: ticket.id,
    confirmed: isConfirm,
    by: actor,
    lineUserId,
    note: isConfirm
      ? body.note?.trim() || "ผู้แจ้งยืนยันว่าใช้งานได้แล้ว"
      : body.note?.trim() || "ผู้แจ้งแจ้งว่ายังไม่หาย ขอให้ตรวจสอบอีกครั้ง",
  });

  for (const path of ["/", "/tickets", "/completed", "/resolved", "/repair-history"]) revalidatePath(path);

  return Response.json({
    ok: true,
    duplicate: false,
    action: isConfirm ? "confirm" : "reject",
    ticket_code: ticket.ticket_code,
    status: updated?.status ?? null,
  });
}
