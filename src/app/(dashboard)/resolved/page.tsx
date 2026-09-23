import { listTicketsWithRelations } from "@/lib/db/tickets";
import { groupEventsByTicket } from "@/lib/db/ticketEvents";
import { listStockTransactions } from "@/lib/db/stock";
import { ResolvedLogBoard, type ResolvedLogRow } from "@/components/tickets/ResolvedLogBoard";

/** หน้า log ของเรื่องที่แก้ไขเสร็จและผู้แจ้งยืนยันแล้ว
 *
 *  ต่างจากหน้า "ประวัติซ่อม" ตรงที่หน้านั้นดูเฉพาะ ticket ประเภทแจ้งซ่อมทุกสถานะ
 *  ส่วนหน้านี้ดูทุกประเภทแต่เฉพาะที่ "จบสมบูรณ์แล้ว" พร้อมหลักฐานครบชุด:
 *  ไทม์ไลน์ทุกขั้น · วิธีแก้ของช่าง · คนที่ทำแต่ละขั้น · รูปแนบ · ค่าซ่อมและอะไหล่ที่เบิก
 */
export default function ResolvedPage() {
  const events = groupEventsByTicket();

  // อะไหล่ที่เบิกไปใช้ผูกกับ ticket ผ่านเลขที่อ้างอิงของ transaction
  // (ไม่ได้เพิ่มฟิลด์ใหม่ เพราะ reference_no มีอยู่แล้วและเป็นที่ที่คนคีย์เลขที่ตั๋วอยู่จริง)
  const partsByCode = new Map<string, { name: string; qty: number; unit: string }[]>();
  for (const t of listStockTransactions()) {
    const ref = t.reference_no?.trim().toUpperCase();
    if (!ref || t.type !== "out") continue;
    const bucket = partsByCode.get(ref) ?? [];
    bucket.push({ name: t.item_name, qty: t.quantity, unit: t.item_unit });
    partsByCode.set(ref, bucket);
  }

  const rows: ResolvedLogRow[] = listTicketsWithRelations()
    .filter((t) => t.status === "completed")
    .map((t) => ({
      ticket: t,
      events: events[t.id] ?? [],
      parts: partsByCode.get(t.ticket_code.toUpperCase()) ?? [],
    }));

  return <ResolvedLogBoard rows={rows} />;
}
