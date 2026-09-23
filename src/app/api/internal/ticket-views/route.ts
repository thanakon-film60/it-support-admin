import type { NextRequest } from "next/server";
import { verifyInternalKey, unauthorizedJson } from "@/lib/internal-auth";
import { getTicketByCode, markTicketAcknowledged } from "@/lib/db/tickets";
import { recordTicketView, listViewsForTicket } from "@/lib/db/ticketViews";
import { notifyTicketViewed } from "@/lib/line/notify";
import type { TicketView } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_SOURCES: TicketView["source"][] = ["line-bot", "admin-panel", "liff"];

interface Payload {
  ticket_code?: string;
  source?: string;
  line_user_id?: string | null;
  viewer_name?: string | null;
  /** IP ที่ฝั่งบอทเห็นตอนรับ webhook — ดูคำเตือนใน types.ts ว่ามันคือ IP ของใคร */
  ip?: string | null;
  user_agent?: string | null;
}

/** คำกำกับที่จะติดไปกับ IP ทุกแถว เพื่อไม่ให้คนอ่าน log เข้าใจผิดว่าเป็น IP ของพนักงาน */
const IP_NOTE: Record<TicketView["source"], string> = {
  "line-bot": "IP ของเซิร์ฟเวอร์ LINE/พร็อกซี ไม่ใช่เครื่องของผู้กด (LINE ไม่ส่ง IP ผู้ใช้มาให้)",
  "admin-panel": "IP ของเครื่องที่เปิดหน้าแอดมิน",
  liff: "IP ของเครื่องผู้ใช้จริง (เปิดผ่านหน้าเว็บ)",
};

/**
 * POST /api/internal/ticket-views — บันทึกว่ามีคนเปิดดูสถานะ ticket
 *
 * ใช้ตอนผู้ใช้กดปุ่ม "เช็คสถานะเรื่องนี้" ในแชท LINE
 * คืน total_views กลับไปให้บอทเอาไปแสดงในการ์ดได้ และ first_view ไว้ตัดสินใจว่าจะ push แจ้งทีม IT ไหม
 */
export async function POST(req: NextRequest) {
  if (!verifyInternalKey(req.headers.get("x-internal-key"))) return unauthorizedJson();

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const code = (body.ticket_code ?? "").trim();
  if (!code) return Response.json({ error: "ticket_code is required" }, { status: 400 });

  const source = VALID_SOURCES.includes(body.source as TicketView["source"])
    ? (body.source as TicketView["source"])
    : "line-bot";

  // ต้องมี ticket จริงเท่านั้น — ไม่งั้นใครที่ได้ key ไปจะยัด log ปลอมเข้ามาได้ไม่จำกัด
  const ticket = getTicketByCode(code);
  if (!ticket) return Response.json({ error: "ticket not found" }, { status: 404 });

  const result = recordTicketView({
    ticket_id: ticket.id,
    ticket_code: ticket.ticket_code,
    source,
    line_user_id: body.line_user_id ?? null,
    viewer_name: body.viewer_name ?? null,
    ip: body.ip ?? null,
    ip_note: IP_NOTE[source],
    user_agent: body.user_agent ?? null,
  });

  // บันทึกว่าผู้แจ้งรับทราบแล้ว — เฉพาะตอนที่คนกดคือผู้แจ้งเอง
  // ถ้าแอดมินเปิดดูเรื่องของคนอื่น ไม่ควรนับว่า "ผู้แจ้งรับทราบ"
  const viewerIsRequester =
    source === "line-bot" &&
    typeof ticket.meta?.line_user_id === "string" &&
    ticket.meta.line_user_id === body.line_user_id;
  if (viewerIsRequester) markTicketAcknowledged(ticket.id, result.view.viewer_name);

  // push แจ้งทีม IT เฉพาะ "ครั้งแรกที่คนนี้เปิดดูเรื่องนี้"
  // ถ้าแจ้งทุกครั้งที่กด โควตา push 300 ข้อความ/เดือนของแพ็กเกจฟรีจะหมดภายในไม่กี่วัน
  // (กดซ้ำๆ ระหว่างรอคือพฤติกรรมปกติของคนที่รีบ) — ครั้งต่อๆ ไปยังถูกบันทึกลง log ครบ
  let notify: string = "skipped_repeat_view";
  if (result.first_view_by_this_user) {
    notify = await notifyTicketViewed({
      ticket,
      viewerName: result.view.viewer_name,
      totalViews: result.total_views,
    });
  }

  return Response.json({
    ok: true,
    first_view: result.first_view_by_this_user,
    total_views: result.total_views,
    acknowledged: viewerIsRequester,
    notify,
  });
}

/** GET /api/internal/ticket-views?code=... — ดู log ของเรื่องหนึ่ง (ไว้ตรวจสอบย้อนหลัง) */
export async function GET(req: NextRequest) {
  if (!verifyInternalKey(req.headers.get("x-internal-key"))) return unauthorizedJson();

  const code = (req.nextUrl.searchParams.get("code") ?? "").trim();
  if (!code) return Response.json({ error: "code is required" }, { status: 400 });

  const ticket = getTicketByCode(code);
  if (!ticket) return Response.json({ found: false, views: [] });

  return Response.json({ found: true, views: listViewsForTicket(ticket.id) });
}
