import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyInternalKey, unauthorizedJson } from "@/lib/internal-auth";
import { getTicketByCode, rateTicketByRequester, ticketOwnerLineId } from "@/lib/db/tickets";
import { isLowScore, isValidScore, MAX_RATING_COMMENT } from "@/lib/ticket-feedback";

export const dynamic = "force-dynamic";

interface Payload {
  ticket_code?: unknown;
  line_user_id?: unknown;
  /** 1–5 · ไม่ส่ง = แก้แค่ความเห็น */
  score?: unknown;
  /** ไม่ส่ง = คงความเห็นเดิม · สตริงว่าง = ลบความเห็น */
  comment?: unknown;
  viewer_name?: unknown;
}

function bad(error: string) {
  return Response.json({ error }, { status: 400 });
}

/**
 * POST /api/internal/tickets/rate — ผู้แจ้งให้คะแนน 1–5 ดาว / เขียนความเห็น หลังทีม IT ปิดงาน
 *
 * บอทเรียก 2 จังหวะ: (1) กดดาวบนการ์ดปิดงาน → ส่ง score
 *                  (2) พิมพ์ความเห็นตามหลังดาวต่ำ → ส่ง comment อย่างเดียว
 * ตอบ ask_comment=true เมื่อควรถามความเห็นต่อ — เกณฑ์ "คะแนนต่ำ" ตัดสินที่นี่ที่เดียว บอทแค่ทำตาม
 * ถ้าบอทตัดสินเอง วันที่ปรับเกณฑ์จะต้องแก้สองภาษาพร้อมกัน แล้วสักวันจะแก้ไม่ครบ
 */
export async function POST(req: NextRequest) {
  if (!verifyInternalKey(req.headers.get("x-internal-key"))) return unauthorizedJson();

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return bad("invalid json");
  }
  if (!body || typeof body !== "object") return bad("invalid payload");

  const { ticket_code: rawCode, line_user_id: rawLineId, score: rawScore, comment: rawComment, viewer_name: viewerName } = body;
  if (typeof rawCode !== "string" || !rawCode.trim()) return bad("ticket_code is required");
  if (rawLineId !== undefined && typeof rawLineId !== "string") return bad("invalid line_user_id");
  if (viewerName != null && typeof viewerName !== "string") return bad("invalid viewer_name");

  let score: number | undefined;
  if (rawScore !== undefined) {
    if (!isValidScore(rawScore)) return bad("score must be an integer 1-5");
    score = rawScore;
  }
  let comment: string | undefined;
  if (rawComment != null) {
    if (typeof rawComment !== "string") return bad("invalid comment");
    // ความเห็นคือข้อความที่ผู้ใช้พิมพ์เองทั้งก้อน — ต้องมีเพดาน ไม่งั้นไฟล์ tickets.json บวมได้จากคนเดียว
    if (rawComment.trim().length > MAX_RATING_COMMENT) return bad("comment too long");
    // ช่องว่างล้วน = ไม่ได้เขียนอะไร (ไม่ใช่คำสั่งลบความเห็นเดิม) — บอทไม่มีทางส่งแบบนี้ มาเมื่อไหร่คือของเพี้ยน
    if (rawComment.trim()) comment = rawComment;
  }
  if (score === undefined && comment === undefined) return bad("score or comment is required");

  const ticket = getTicketByCode(rawCode);
  if (!ticket) return Response.json({ error: "ticket not found" }, { status: 404 });

  // ให้คะแนนได้เฉพาะผู้แจ้งเรื่องนั้น — เหตุผลเดียวกับ route ยืนยัน: เลขที่ตั๋วหลุดไปแชทกลุ่มได้ง่าย
  // ถ้าใครก็กดได้ คะแนนเฉลี่ยของทีม IT จะถูกปั่นได้จากคนที่ไม่เคยใช้บริการเลย
  const lineUserId = (rawLineId ?? "").trim();
  const owner = ticketOwnerLineId(ticket);
  if (!lineUserId || !owner || lineUserId !== owner) {
    return Response.json({ error: "not the requester", reason: "not_owner", ok: false }, { status: 403 });
  }

  const result = rateTicketByRequester({
    ticketId: ticket.id,
    score,
    comment,
    by: typeof viewerName === "string" ? viewerName : "",
    lineUserId,
  });

  if (!result.ok) {
    // not_completed เกิดได้ปกติ: ผู้แจ้งกด "ยังมีปัญหาอยู่" ไปแล้วค่อยมากดดาวบนการ์ดใบเดิม
    // ตอบ 200 + reason ให้บอทเลือกคำอธิบายได้ (ธรรมเนียมเดียวกับ route ยืนยัน)
    return Response.json({
      ok: false, reason: result.reason, status: ticket.status, ticket_code: ticket.ticket_code,
    });
  }

  if (!result.duplicate) revalidatePath("/tickets");

  return Response.json({
    ok: true,
    duplicate: result.duplicate,
    ticket_code: ticket.ticket_code,
    score: result.rating.score,
    comment: result.rating.comment,
    ask_comment: score !== undefined && isLowScore(result.rating.score) && !result.rating.comment,
  });
}
