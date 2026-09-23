import { TICKET_TYPE_LABEL } from "@/lib/labels";
import type { Equipment, Ticket } from "@/lib/types";
import { buildTicketStatusMessage, STATUS_HEADLINE } from "./status-message";
import type { LineMessage } from "./client";

/**
 * การ์ด "แก้ให้แล้ว ช่วยยืนยันหน่อย" ที่ส่งหาผู้แจ้งทาง LINE
 *
 * ทำไมต้องมีขั้นยืนยันจากผู้แจ้ง แทนที่จะให้ทีม IT กดปิดงานเอง:
 *   ทีม IT กด "แก้ไขแล้ว" = แก้เสร็จ "ในมุมของช่าง" แต่คนที่รู้จริงว่าใช้งานได้หรือยัง
 *   คือคนที่แจ้ง ระบบเดิมจึงมีแต่ตัวเลข "งานที่ช่างบอกว่าเสร็จ" ซึ่งเอาไปวัดคุณภาพงานไม่ได้เลย
 *   สถานะ completed จะเกิดได้ทางเดียวคือผู้แจ้งกดยืนยันเอง ตัวเลขนี้จึงเชื่อถือได้
 *
 * ทำไมเป็น Flex ไม่ใช่ template/buttons:
 *   template จำกัดข้อความ 160 ตัวอักษร ซึ่งไม่พอสำหรับรายละเอียด + หมายเหตุจากทีม IT
 *   ถ้าแยกเป็น 2 ข้อความจะกินโควตา push 2 ข้อความ/ticket (แพ็กเกจฟรีมี 300/เดือน)
 */

const INK = "#111827";
const MUTED = "#6B7280";
const OK_COLOR = "#16A34A";
const BG_SOFT = "#F9FAFB";

/** ข้อมูลที่ส่งกลับมากับ postback ตอนผู้ใช้กดปุ่ม
 *
 *  ใช้ ticket_code ไม่ใช่ id ภายใน เพราะ (1) สั้นกว่า ไม่เสี่ยงชน 300 ไบต์
 *  (2) เป็นเลขที่ผู้ใช้เห็นอยู่แล้ว ดีบักจาก log ได้ทันทีโดยไม่ต้องเปิดฐานข้อมูล
 *  v=1 คือเรียบร้อย · v=0 คือยังไม่หาย */
export function buildConfirmPostbackData(ticketCode: string, ok: boolean): string {
  return `a=confirm&code=${ticketCode}&v=${ok ? 1 : 0}`;
}

function row(label: string, value: string) {
  return {
    type: "box",
    layout: "baseline",
    margin: "sm",
    contents: [
      { type: "text", text: label, size: "xs", color: MUTED, flex: 2 },
      { type: "text", text: value || "-", size: "sm", color: INK, flex: 5, wrap: true },
    ],
  };
}

/** altText ยาวได้ไม่เกิน 400 ตัวอักษร ยาวกว่านั้น LINE ตอบ 400 ทั้งข้อความ
 *  ตัดแบบเหลือจุดไข่ปลาไว้ เพื่อให้คนที่เห็นจากแจ้งเตือนล็อกสกรีนรู้ว่ายังมีต่อ */
function toAltText(value: string): string {
  return value.length <= 400 ? value : `${value.slice(0, 397)}...`;
}

export function buildStatusConfirmFlex(
  ticket: Ticket,
  note?: string | null,
  equipment?: Equipment | null
): LineMessage {
  const typeLabel = TICKET_TYPE_LABEL[ticket.type] ?? ticket.type;
  const trimmedNote = (note ?? "").trim();

  const body: Record<string, unknown>[] = [
    { type: "text", text: "เลขที่เรื่อง", size: "xs", color: MUTED },
    { type: "text", text: ticket.ticket_code, size: "xxl", weight: "bold", color: OK_COLOR },
    { type: "separator", margin: "lg", color: "#E5E7EB" },
    row("ประเภท", typeLabel),
    row("สาขา", ticket.location || "-"),
  ];

  if (equipment) {
    body.push(
      row("ทรัพย์สิน", `${equipment.asset_code}${equipment.brand_model ? ` — ${equipment.brand_model}` : ""}`)
    );
  }

  if (ticket.type === "repair" && ticket.repair_cost !== null && ticket.repair_cost > 0) {
    body.push(row("ค่าซ่อม", `${ticket.repair_cost.toLocaleString("th-TH")} บาท`));
  }

  if (trimmedNote) {
    body.push({
      type: "box",
      layout: "vertical",
      margin: "lg",
      paddingAll: "md",
      backgroundColor: BG_SOFT,
      cornerRadius: "md",
      contents: [
        { type: "text", text: "📝 หมายเหตุจากทีม IT", size: "xxs", color: MUTED },
        { type: "text", text: trimmedNote, size: "sm", color: INK, wrap: true, margin: "sm" },
      ],
    });
  }

  body.push({ type: "separator", margin: "lg", color: "#E5E7EB" });
  body.push({
    type: "text",
    text: "ลองใช้งานดูแล้วกดยืนยันให้หน่อยครับ ถ้ายังไม่หายกดปุ่มขวาได้เลย ทีม IT จะกลับไปดูให้ทันที",
    size: "xs",
    color: MUTED,
    wrap: true,
    margin: "md",
  });

  const contents: Record<string, unknown> = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: OK_COLOR,
      paddingAll: "lg",
      contents: [
        { type: "text", text: STATUS_HEADLINE.resolved, color: "#FFFFFF", weight: "bold", size: "md", wrap: true },
      ],
    },
    body: { type: "box", layout: "vertical", paddingAll: "lg", contents: body },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "lg",
      contents: [
        {
          type: "button",
          style: "primary",
          color: OK_COLOR,
          height: "sm",
          action: {
            type: "postback",
            // label ยาวได้ 20 ตัวอักษร — นับ emoji ด้วย อย่าต่อข้อความเพิ่มโดยไม่นับใหม่
            label: "✅ เรียบร้อยแล้ว",
            data: buildConfirmPostbackData(ticket.ticket_code, true),
            displayText: "เรียบร้อยแล้วครับ ขอบคุณครับ",
          },
        },
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: {
            type: "postback",
            label: "❌ ยังไม่หาย",
            data: buildConfirmPostbackData(ticket.ticket_code, false),
            displayText: "ยังไม่หายครับ",
          },
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
