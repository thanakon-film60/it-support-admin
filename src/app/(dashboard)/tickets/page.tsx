import { listStatusEditors, listTicketsWithRelations } from "@/lib/db/tickets";
import { canNotifyOnLine } from "@/lib/line/notify";
import { listTicketViews, summarizeViews } from "@/lib/db/ticketViews";
import { TICKET_STATUS_ORDER } from "@/components/ui/Badge";
import type { TicketStatus, TicketView } from "@/lib/types";
import { TicketsBoard } from "@/components/tickets/TicketsBoard";

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
  const params = await searchParams;
  const statusParam = one(params.status);
  // รับเฉพาะสถานะที่มีจริง — ถ้า URL ถูกแก้มั่วให้ตกกลับไปแสดงทั้งหมด ดีกว่าโชว์ตารางว่างเปล่า
  const initialStatus: "all" | TicketStatus =
    statusParam && TICKET_STATUS_ORDER.includes(statusParam as TicketStatus)
      ? (statusParam as TicketStatus)
      : "all";

  const tickets = listTicketsWithRelations();
  const summaries = summarizeViews();

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
      initialStatus={initialStatus}
      initialTicketCode={one(params.code)}
      editors={listStatusEditors()}
      notifiable={notifiable}
    />
  );
}
