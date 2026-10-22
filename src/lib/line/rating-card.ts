import type { Equipment, Ticket } from "@/lib/types";
import { RATING_MAX, REOPEN_WINDOW_DAYS } from "@/lib/ticket-feedback";
import { buildTicketStatusMessage, STATUS_HEADLINE } from "./status-message";
import { buildConfirmPostbackData } from "./confirm-card";
import { headerBox, INK, LINE_COLOR, MUTED, ticketSummaryContents, toAltText, type FlexNode } from "./card-parts";
import type { LineMessage } from "./client";

/**
 * การ์ด "แก้ไขเรียบร้อยแล้ว" ที่ส่งหาผู้แจ้งตอนทีม IT ปิดงาน (สถานะ resolved — แก้ไขแล้ว)
 *
 * แทนการ์ดยืนยันรุ่นเก่า (ก่อน ต.ค. 2026): ผู้แจ้งไม่ต้องกดยืนยันให้เรื่องจบอีกแล้ว
 * แต่ได้ "ให้คะแนน" แทน — ตัวเลขที่บอกคุณภาพงานได้จริงกว่าการกดตกลง ซึ่งคนกดผ่านๆ ทุกครั้ง
 *
 * ทุกอย่างอยู่ในข้อความเดียว (ผล + ดาว + ปุ่มยังมีปัญหา) เพราะ push แพ็กเกจฟรีมี 300 ข้อความ/เดือน
 * แยกเป็นสองข้อความ = โควตาหมดเร็วขึ้นเท่าตัว ส่วนคำตอบของบอทหลังผู้ใช้กดเป็น reply ซึ่งไม่กินโควตา
 */

const STAR_COLOR = "#F59E0B";
const STAR_BG = "#FFFBEB";
const STAR_BORDER = "#FDE68A";

/** a=rate&code=...&s=1..5 — ใช้ ticket_code ด้วยเหตุผลเดียวกับปุ่มยืนยัน (สั้น ไม่ชน 300 ไบต์ ดีบักง่าย) */
export function buildRatingPostbackData(ticketCode: string, score: number): string {
  return `a=rate&code=${ticketCode}&s=${score}`;
}

function starBox(ticketCode: string, score: number): FlexNode {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    paddingTop: "sm",
    paddingBottom: "sm",
    cornerRadius: "md",
    backgroundColor: STAR_BG,
    borderWidth: "light",
    borderColor: STAR_BORDER,
    // แตะทั้งกล่องได้ ไม่ต้องเล็งที่ตัวดาว — กล่องเล็กบนมือถือ ถ้าเล็งยาก คนจะกดผิดดวงแล้วเลิกให้คะแนน
    action: {
      type: "postback",
      label: `${score} ดาว`,
      data: buildRatingPostbackData(ticketCode, score),
      // ข้อความที่โผล่ในแชทฝั่งผู้ใช้ ทำให้เห็นทันทีว่ากดไปกี่ดาว ถ้ากดผิดจะได้กดใหม่
      displayText: `ให้คะแนน ${"⭐".repeat(score)} (${score}/${RATING_MAX})`,
    },
    contents: [
      { type: "text", text: "★", size: "xl", color: STAR_COLOR, align: "center" },
      { type: "text", text: String(score), size: "xxs", color: MUTED, align: "center" },
    ],
  };
}

export function buildCompletedRatingFlex(
  ticket: Ticket,
  note?: string | null,
  equipment?: Equipment | null
): LineMessage {
  const body = ticketSummaryContents(ticket, note, equipment);

  body.push(
    { type: "separator", margin: "lg", color: LINE_COLOR },
    { type: "text", text: "ให้คะแนนการบริการครั้งนี้หน่อยนะครับ 🙏", size: "sm", weight: "bold", color: INK, margin: "lg", wrap: true },
    { type: "text", text: "แตะดาวได้เลย · 1 = ต้องปรับปรุง · 5 = ดีมาก", size: "xxs", color: MUTED, wrap: true, margin: "xs" },
    {
      type: "box",
      layout: "horizontal",
      spacing: "xs",
      margin: "md",
      contents: Array.from({ length: RATING_MAX }, (_, i) => starBox(ticket.ticket_code, i + 1)),
    }
  );

  const contents: Record<string, unknown> = {
    type: "bubble",
    header: headerBox(STATUS_HEADLINE.resolved),
    body: { type: "box", layout: "vertical", paddingAll: "lg", contents: body },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "lg",
      contents: [
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: {
            type: "postback",
            // label ยาวได้ 20 ตัวอักษร (นับแบบ UTF-16 — อีโมจิกิน 2) อย่าต่อคำเพิ่มโดยไม่นับใหม่
            label: "🔁 ยังมีปัญหาอยู่",
            // ใช้ data เดียวกับปุ่ม "ยังไม่หาย" ของการ์ดรุ่นเก่า บอทจึงมีทางเปิดเรื่องกลับทางเดียว
            data: buildConfirmPostbackData(ticket.ticket_code, false),
            displayText: "ยังมีปัญหาอยู่ครับ",
          },
        },
        {
          type: "text",
          text: `กดได้ภายใน ${REOPEN_WINDOW_DAYS} วัน ทีม IT จะเปิดเรื่องกลับมาดูให้ทันที`,
          size: "xxs",
          color: MUTED,
          wrap: true,
          align: "center",
        },
      ],
    },
  };

  return {
    type: "flex",
    altText: toAltText(buildTicketStatusMessage(ticket, note, equipment)),
    contents,
  };
}
