import { listStatusEditors, listTicketsWithRelations } from "@/lib/db/tickets";
import { groupEventsByTicket } from "@/lib/db/ticketEvents";
import { listStockTransactions } from "@/lib/db/stock";
import { canNotifyOnLine } from "@/lib/line/notify";
import { listTicketViews, summarizeViews } from "@/lib/db/ticketViews";
import { isTicketStatus } from "@/lib/ticket-status";
import type { TicketEvent, TicketStatus, TicketType, TicketView } from "@/lib/types";
import type { TicketPart } from "@/lib/ticket-export";
import { TicketsBoard, type RatingFilter } from "@/components/tickets/TicketsBoard";
import { requireSession } from "@/lib/auth";

const TICKET_TYPES: TicketType[] = ["repair", "withdraw", "return", "it_service"];
const RATING_FILTERS: RatingFilter[] = ["low", "satisfied", "unrated"];

/** จำนวน log ต่อ ticket ที่ส่งลงไปให้หน้าเว็บ
 *
 *  ส่งทั้งหมดไม่ได้ — ตาราง ticket_views เก็บได้ถึง 5,000 แถว ถ้ายัดลง HTML ทุกแถว
 *  หน้า /tickets จะหนักขึ้นเรื่อยๆ ตามการใช้งาน โดยไม่มีใครสังเกตจนกว่าจะช้ามาก
 *  10 ครั้งล่าสุดพอสำหรับคำถามที่ทีม IT ถามจริง ("เขาเห็นหรือยัง / ดูบ่อยแค่ไหน")
 *  ส่วนจำนวนครั้งทั้งหมดใช้จาก summary ซึ่งนับครบอยู่แล้ว
 */
const MAX_LOG_PER_TICKET = 10;

/** อ่านค่าเดียวจาก searchParams — Next.js คืนเป็น array ได้ถ้า query ซ้ำ (?status=a&status=b) */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// searchParams ใน Next.js 16 เป็น Promise ต้อง await (ดู node_modules/next/dist/docs/
// 01-app/01-getting-started/03-layouts-and-pages.md หัวข้อ "Rendering with search params")
// และการอ่านมันทำให้หน้านี้เป็น dynamic rendering โดยอัตโนมัติ ซึ่งตรงกับที่ต้องการอยู่แล้ว
export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireSession("tickets");
  const params = await searchParams;
  // รับเฉพาะค่าที่มีจริง — ถ้า URL ถูกแก้มั่ว (หรือเป็นสถานะของระบบเดิมจากบุ๊กมาร์กเก่า เช่น ?status=completed)
  // ให้ตกกลับไปแสดงทั้งหมด ดีกว่าโชว์ตารางว่างเปล่า
  // ?type=repair มาจากหน้าประวัติซ่อมเดิม · ?status=resolved มาจากหน้าแก้ไขปัญหาแล้วเดิม (redirect)
  const statusParam = one(params.status);
  const typeParam = one(params.type);
  const ratingParam = one(params.rating);
  const initialStatus: "all" | TicketStatus = isTicketStatus(statusParam) ? statusParam : "all";
  const initialType: "all" | TicketType = TICKET_TYPES.includes(typeParam as TicketType) ? (typeParam as TicketType) : "all";
  const initialRating: RatingFilter = RATING_FILTERS.includes(ratingParam as RatingFilter) ? (ratingParam as RatingFilter) : "all";

  const tickets = listTicketsWithRelations();
  const summaries = summarizeViews();

  // ไทม์ไลน์ + อะไหล่ที่เบิก (เดิมอยู่หน้าแก้ไขปัญหาแล้ว) — จัดกลุ่มต่อ ticket id ครั้งเดียวที่นี่
  // อะไหล่ผูกกับ ticket ผ่าน "เลขที่อ้างอิง" ของรายการเบิกสต็อก (ไม่ได้เพิ่มฟิลด์ใหม่ เพราะ reference_no
  // มีอยู่แล้วและเป็นที่ที่คนคีย์เลขที่ตั๋วอยู่จริง)
  const eventsById = groupEventsByTicket();
  const idByCode = new Map(tickets.map((t) => [t.ticket_code.toUpperCase(), t.id]));
  const parts: Record<string, TicketPart[]> = {};
  for (const txn of listStockTransactions()) {
    const id = txn.type === "out" ? idByCode.get(txn.reference_no?.trim().toUpperCase() ?? "") : undefined;
    if (id) (parts[id] ??= []).push({ name: txn.item_name, qty: txn.quantity, unit: txn.item_unit });
  }
  const events: Record<string, TicketEvent[]> = {};
  for (const t of tickets) if (eventsById[t.id]?.length) events[t.id] = eventsById[t.id];

  // เรื่องไหนแจ้งกลับทาง LINE ได้บ้าง — ต้องคำนวณที่นี่เพราะต้องอ่านตาราง users
  // (client component แตะ lib/db เองไม่ได้) แอดมินจะได้รู้ "ก่อนกดบันทึก" ว่าส่งได้หรือไม่ได้
  const notifiable: Record<string, boolean> = {};
  for (const t of tickets) notifiable[t.id] = canNotifyOnLine(t);

  // จัดกลุ่ม log ต่อ ticket ครั้งเดียว แทนที่จะให้แต่ละแถวไปกรองเอง
  const recentViews: Record<string, TicketView[]> = {};
  for (const v of listTicketViews()) {
    const bucket = (recentViews[v.ticket_id] ??= []);
    if (bucket.length < MAX_LOG_PER_TICKET) bucket.push(v);
  }

  return (
    <TicketsBoard
      initialTickets={tickets}
      viewSummaries={summaries}
      recentViews={recentViews}
      events={events}
      parts={parts}
      initialStatus={initialStatus}
      initialType={initialType}
      initialRating={initialRating}
      initialTicketCode={one(params.code)}
      editors={listStatusEditors()}
      notifiable={notifiable}
    />
  );
}
