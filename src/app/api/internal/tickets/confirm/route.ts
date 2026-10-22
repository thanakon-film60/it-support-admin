import { after, type NextRequest } from "next/server";
import { verifyInternalKey, unauthorizedJson } from "@/lib/internal-auth";
import { confirmTicketByRequester, getTicketByCode, ticketOwnerLineId } from "@/lib/db/tickets";
import { revalidatePath } from "next/cache";
import { getUserById } from "@/lib/db/users";
import { notifyTicketReopened } from "@/lib/line/notify";
import { canReopen, REOPEN_WINDOW_DAYS } from "@/lib/ticket-feedback";
import { readResolvedBy } from "@/lib/ticket-confirmation";

export const dynamic = "force-dynamic";

interface Payload {
  ticket_code?: string;
  line_user_id?: string;
  /** confirm = "เรียบร้อยแล้ว" (การ์ดรุ่นเก่า) · reject = "ยังไม่หาย" / "ยังมีปัญหาอยู่" */
  action?: "confirm" | "reject";
  confirmed?: boolean;
  display_name?: string;
  viewer_name?: string | null;
  note?: string | null;
}

/**
 * POST /api/internal/tickets/confirm — ผู้แจ้งกดปุ่มผลการแก้ไขจากแชท LINE
 *
 * reject  -> "ยังมีปัญหาอยู่" (การ์ดให้คะแนน) / "ยังไม่หาย" (การ์ดเก่า): แก้ไขแล้ว → รอดำเนินการ + แจ้งทีม IT ทาง LINE
 *            ต้องอยู่ในเพดาน REOPEN_WINDOW_DAYS นับจากวันปิดงาน
 * confirm -> "เรียบร้อยแล้ว" จากการ์ดยืนยันรุ่นเก่าที่ยังค้างในห้องแชท — เรื่องปิดอยู่แล้ว ตอบ duplicate เฉยๆ
 *            (ระบบเหลือ 2 สถานะตั้งแต่ 21 ต.ค. 2026 — "แก้ไขแล้ว" คือสถานะสุดท้าย ไม่มีขั้นรอยืนยันอีก)
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
  // ถ้าไม่เช็ค ใครก็ตามที่รู้เลขที่ตั๋ว (ซึ่งโผล่ในแชทกลุ่มได้ง่ายๆ) จะปิด/เปิดเรื่องของคนอื่นได้
  // และ log การแก้ปัญหาจะมีลายเซ็นของคนที่ไม่เกี่ยวข้อง — ทำให้หลักฐานทั้งชุดใช้ไม่ได้
  const lineUserId = (body.line_user_id ?? "").trim();
  const ticketOwner = ticketOwnerLineId(ticket);

  if (!lineUserId || !ticketOwner || lineUserId !== ticketOwner) {
    return Response.json({ error: "not the requester", reason: "not_owner", ok: false }, { status: 403 });
  }

  // กดจากข้อความเก่าหลังเรื่องถูกเปลี่ยนสถานะไปแล้วเป็นเรื่องปกติ — บอกตรงๆ ดีกว่าทำเงียบๆ
  // (บอทส่ง action มาเสมอ จึงได้ 200 + reason ไว้เลือกคำตอบ ส่วน payload แบบ confirmed ของเดิมได้ 409)
  const isConfirm = body.confirmed ?? (body.action === "confirm");
  const refusedStatus = body.action ? 200 : 409;
  if (ticket.status === "resolved" && isConfirm) {
    return Response.json({ ok: true, duplicate: true, status: ticket.status, ticket_code: ticket.ticket_code });
  }
  if (ticket.status !== "resolved") {
    return Response.json({
      ok: false,
      reason: body.action ? "not_resolved" : "not_confirmable",
      status: ticket.status,
      ticket_code: ticket.ticket_code,
    }, { status: refusedStatus });
  }
  if (!isConfirm && !canReopen(ticket)) {
    return Response.json({
      ok: false,
      reason: "reopen_expired",
      status: ticket.status,
      ticket_code: ticket.ticket_code,
      reopen_days: REOPEN_WINDOW_DAYS,
    }, { status: refusedStatus });
  }

  const actor = (body.viewer_name ?? body.display_name ?? "").trim() || "ผู้แจ้ง";
  // อ่านก่อนเปลี่ยนสถานะ — หลังเปิดกลับ รายการล่าสุดในประวัติจะเป็นของผู้แจ้งแทน
  const closedBy = isConfirm ? null : readResolvedBy(ticket)?.by ?? null;

  const updated = confirmTicketByRequester({
    ticketId: ticket.id,
    confirmed: isConfirm,
    by: actor,
    lineUserId,
    note: isConfirm
      ? body.note?.trim() || "ผู้แจ้งยืนยันว่าใช้งานได้แล้ว"
      : body.note?.trim() || "ผู้แจ้งแจ้งว่ายังมีปัญหาอยู่ ขอให้ตรวจสอบอีกครั้ง",
  });

  if (!isConfirm && updated) {
    // ส่งหาทีม IT "หลังตอบบอทแล้ว" — push ไป LINE ช้าได้หลายวินาที ถ้ารอในนี้ บอทจะ timeout
    // แล้วบอกผู้แจ้งว่าระบบขัดข้อง ทั้งที่เปิดเรื่องกลับสำเร็จไปแล้ว (คนจะกดซ้ำและงง)
    const requesterName = getUserById(updated.requester_id)?.display_name ?? actor;
    after(async () => {
      const result = await notifyTicketReopened({ ticket: updated, requesterName, closedBy });
      if (result === "failed") console.error("[LINE] แจ้งทีม IT ว่าเปิดเรื่องกลับไม่สำเร็จ:", updated.ticket_code);
    });
  }

  for (const path of ["/", "/tickets"]) revalidatePath(path);

  return Response.json({
    ok: true,
    duplicate: false,
    action: isConfirm ? "confirm" : "reject",
    ticket_code: ticket.ticket_code,
    status: updated?.status ?? null,
  });
}
