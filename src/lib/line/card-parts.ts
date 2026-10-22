import { TICKET_TYPE_LABEL } from "@/lib/labels";
import type { Equipment, Ticket } from "@/lib/types";

/**
 * ชิ้นส่วนที่การ์ด Flex ของ ticket ใช้ร่วมกัน (การ์ดยืนยันรุ่นเก่า + การ์ดปิดงาน/ให้คะแนน)
 *
 * แยกออกมาเพราะสองการ์ดต้องแสดงรายละเอียดเรื่องชุดเดียวกันเป๊ะ — ถ้าต่างคนต่างเขียน
 * วันที่เพิ่มบรรทัดใหม่ (เช่นทรัพย์สิน) จะเพิ่มแค่การ์ดเดียว แล้วผู้แจ้งเห็นข้อมูลไม่เท่ากันในแต่ละขั้น
 */

export const INK = "#111827";
export const MUTED = "#6B7280";
export const OK_COLOR = "#16A34A";
export const BG_SOFT = "#F9FAFB";
export const LINE_COLOR = "#E5E7EB";

export type FlexNode = Record<string, unknown>;

export function row(label: string, value: string): FlexNode {
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
export function toAltText(value: string): string {
  return value.length <= 400 ? value : `${value.slice(0, 397)}...`;
}

/** เลขที่เรื่อง + ประเภท/สาขา/ทรัพย์สิน/ค่าซ่อม + กล่องหมายเหตุจากทีม IT */
export function ticketSummaryContents(
  ticket: Ticket,
  note?: string | null,
  equipment?: Equipment | null
): FlexNode[] {
  const typeLabel = TICKET_TYPE_LABEL[ticket.type] ?? ticket.type;
  const trimmedNote = (note ?? "").trim();

  const body: FlexNode[] = [
    { type: "text", text: "เลขที่เรื่อง", size: "xs", color: MUTED },
    { type: "text", text: ticket.ticket_code, size: "xxl", weight: "bold", color: OK_COLOR },
    { type: "separator", margin: "lg", color: LINE_COLOR },
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

  return body;
}

export function headerBox(text: string, color: string = OK_COLOR): FlexNode {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: color,
    paddingAll: "lg",
    contents: [{ type: "text", text, color: "#FFFFFF", weight: "bold", size: "md", wrap: true }],
  };
}
