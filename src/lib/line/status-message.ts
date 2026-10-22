import { TICKET_TYPE_LABEL } from "@/lib/labels";
import { REOPEN_WINDOW_DAYS } from "@/lib/ticket-feedback";
import type { Equipment, Ticket, TicketStatus } from "@/lib/types";

export const STATUS_HEADLINE: Record<TicketStatus, string> = {
  pending: "🕐 รับเรื่องแล้ว รอคิวดำเนินการ",
  resolved: "✅ แก้ไขเรียบร้อยแล้ว",
  cancelled: "❌ เรื่องนี้ถูกยกเลิก",
};

/** บรรทัดปิดท้าย — บอกว่าผู้ใช้ทำอะไรต่อได้ ไม่ปล่อยให้เป็นข้อความแจ้งเตือนตัน */
const STATUS_FOOTER: Partial<Record<TicketStatus, string>> = {
  pending: "มีข้อมูลเพิ่มเติม พิมพ์ตอบในแชทนี้ได้เลยครับ",
  // ข้อความนี้คือ altText ของการ์ดให้คะแนน (เห็นในแจ้งเตือนล็อกสกรีน) จึงต้องบอกว่ามีอะไรให้กดในการ์ด
  resolved: `ช่วยให้คะแนนการบริการ 1–5 ดาวในการ์ดหน่อยนะครับ 🙏 ถ้ายังใช้งานไม่ได้ กด "ยังมีปัญหาอยู่" ได้ภายใน ${REOPEN_WINDOW_DAYS} วัน`,
  // ยกเลิกไม่มีปุ่มเปิดกลับ (ไม่ใช่งานที่แก้แล้วไม่หาย) — บอกทางไปต่อแทน ไม่งั้นคนที่ถูกยกเลิกผิดจะไม่รู้ต้องทำยังไง
  cancelled: "ถ้ายกเลิกผิด หรือยังต้องการความช่วยเหลือ แจ้งเข้ามาใหม่ได้เลยครับ",
};

export function buildTicketStatusMessage(ticket: Ticket, note?: string | null, equipment?: Equipment | null): string {
  const typeLabel = TICKET_TYPE_LABEL[ticket.type] ?? ticket.type;

  const lines = [
    "📢 อัปเดตเรื่องที่คุณแจ้งไว้",
    "",
    `เลขที่: ${ticket.ticket_code}`,
    `ประเภท: ${typeLabel}`,
    `สาขา: ${ticket.location || "-"}`,
  ];

  if (equipment) {
    lines.push(
      `อุปกรณ์: ${equipment.asset_code}${
        equipment.brand_model ? ` — ${equipment.brand_model}` : ""
      }`
    );
  }

  lines.push("", `สถานะล่าสุด: ${STATUS_HEADLINE[ticket.status]}`);

  if (ticket.type === "repair" && ticket.repair_cost !== null && ticket.repair_cost > 0) {
    lines.push(`ค่าซ่อม: ${ticket.repair_cost.toLocaleString("th-TH")} บาท`);
  }

  // หมายเหตุจากทีม IT — วางไว้ "เหนือ" บรรทัดปิดท้าย เพราะเป็นข้อความที่คนเขียนถึงผู้แจ้งโดยตรง
  // ถ้าเอาไปไว้ล่างสุดจะอยู่ใต้ประโยคอย่าง "ขอบคุณที่ใช้บริการครับ" ซึ่งอ่านเหมือนหมดเรื่องไปแล้ว
  const trimmedNote = (note ?? "").trim();
  if (trimmedNote) lines.push("", `📝 หมายเหตุจากทีม IT:`, trimmedNote);

  const footer = STATUS_FOOTER[ticket.status];
  if (footer) lines.push("", footer);

  return lines.join("\n");
}

