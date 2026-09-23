import { TICKET_TYPE_LABEL } from "@/lib/labels";
import type { Equipment, Ticket, TicketStatus } from "@/lib/types";

export const STATUS_HEADLINE: Record<TicketStatus, string> = {
  pending: "🕐 รับเรื่องแล้ว รอคิวดำเนินการ",
  in_progress: "🔧 ทีม IT กำลังดำเนินการให้อยู่",
  waiting_info: "❓ ทีม IT ขอข้อมูลเพิ่มเติม",
  waiting_delivery: "🚚 รออะไหล่ / รอของจัดส่ง",
  resolved: "✅ ดำเนินการเสร็จเรียบร้อยแล้ว",
  completed: "🎉 งานนี้สำเร็จเรียบร้อย (ยืนยันแล้ว)",
  closed: "📁 ปิดงานเรียบร้อยแล้ว",
  cancelled: "❌ เรื่องนี้ถูกยกเลิก",
};

/** บรรทัดปิดท้าย — บอกว่าผู้ใช้ทำอะไรต่อได้ ไม่ปล่อยให้เป็นข้อความแจ้งเตือนตัน */
const STATUS_FOOTER: Partial<Record<TicketStatus, string>> = {
  waiting_info: "พิมพ์ตอบกลับในแชทนี้ได้เลยครับ ทีม IT จะเห็นข้อความ",
  resolved: "ช่วยกดยืนยันด้านล่างให้หน่อยครับว่าใช้งานได้ปกติแล้ว 🙏",
  completed: "ขอบคุณที่ยืนยันครับ 🙏 ถ้ามีปัญหาอีก แจ้งเข้ามาใหม่ได้เลย",
  closed: "ขอบคุณที่ใช้บริการครับ 🙏",
  cancelled: "ถ้ายกเลิกผิด แจ้งเข้ามาใหม่ได้เลยครับ",
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

