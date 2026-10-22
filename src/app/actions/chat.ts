"use server";

import { AUTH_DISABLED, requireSession } from "@/lib/auth";
import { getTicketById, ticketOwnerLineId } from "@/lib/db/tickets";
import { recordTicketEvent } from "@/lib/db/ticketEvents";
import { endBotHandoff, getBotHandoff, startBotHandoff, type BotHandoffResult } from "@/lib/line/bot-handoff";
import { MAX_EDITOR_NAME, accountEditorName } from "@/lib/editor-name";
import { formatThaiDateShort } from "@/lib/utils";

/** not_found = ไม่มี ticket นี้ · no_line_user = ผู้แจ้งไม่ได้มาจาก LINE (แอดมินคีย์แทน) ไม่มีแชทให้รับต่อ */
export type ChatTakeoverResult = BotHandoffResult | { ok: false; reason: "not_found" | "no_line_user" };

/** สถานะแชท LINE ของผู้แจ้ง ticket นี้ — บอทตอบอยู่ หรือเจ้าหน้าที่รับไปคุยเองแล้ว */
export async function getChatTakeoverAction(ticketId: string): Promise<ChatTakeoverResult> {
  await requireSession("tickets");
  const ticket = getTicketById(ticketId);
  if (!ticket) return { ok: false, reason: "not_found" };
  const owner = ticketOwnerLineId(ticket);
  if (!owner) return { ok: false, reason: "no_line_user" };
  return getBotHandoff(owner);
}

/** take=true รับแชทต่อเอง (บอทเงียบกับผู้แจ้งคนนี้) · take=false คืนให้บอทตอบ
 *
 *  บันทึกลงไทม์ไลน์ของ ticket ทุกครั้งที่สำเร็จ — ตอนผู้แจ้งถามว่า "ทำไมบอทไม่ตอบ" ทีมต้องตอบได้
 *  ว่าใครสั่งให้บอทเงียบเมื่อไหร่ ไม่งั้นจะไล่หาสาเหตุไม่เจอเพราะไม่มีร่องรอยที่ไหนเลย */
export async function setChatTakeoverAction(
  ticketId: string,
  take: boolean,
  editor?: string
): Promise<ChatTakeoverResult> {
  const session = await requireSession("tickets");
  const ticket = getTicketById(ticketId);
  if (!ticket) return { ok: false, reason: "not_found" };
  const owner = ticketOwnerLineId(ticket);
  if (!owner) return { ok: false, reason: "no_line_user" };

  const result = take ? await startBotHandoff(owner) : await endBotHandoff(owner);
  if (result.ok) {
    // ใครสั่ง = บัญชีที่ล็อกอินอยู่ · ชื่อจากหน้าเว็บใช้เฉพาะตอนปิดล็อกอิน (เหตุผลเดียวกับ changeTicketStatusAction)
    const actor = AUTH_DISABLED
      ? (editor?.trim() || session.displayName).slice(0, MAX_EDITOR_NAME)
      : accountEditorName(session);
    recordTicketEvent({
      ticket_id: ticket.id,
      ticket_code: ticket.ticket_code,
      type: "note",
      actor,
      actor_role: "admin",
      note: take
        ? `รับแชทต่อเองใน LINE OA — บอทหยุดตอบผู้แจ้ง${result.state.until ? `ถึง ${formatThaiDateShort(result.state.until)}` : ""}`
        : "คืนแชทให้บอทตอบตามปกติ",
    });
  }
  return result;
}
