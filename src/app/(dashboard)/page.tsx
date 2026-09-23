import { PageHeader, StatCard } from "@/components/ui/Card";
import { listTicketsWithRelations, ticketCountsByStatus } from "@/lib/db/tickets";
import { listEquipment } from "@/lib/db/equipment";
import { listStockItemsWithStatus } from "@/lib/db/stock";
import { dayKeyTH, timeKeyTH, todayKeyTH } from "@/lib/date-th";
import { TicketCalendar, type CalendarTicket } from "@/components/overview/TicketCalendar";
import type { TicketStatus } from "@/lib/types";

// อ่านข้อมูลที่เปลี่ยนตลอด + ต้องรู้ "วันนี้" ตอนเปิดหน้า -> ห้าม prerender เป็น static
export const dynamic = "force-dynamic";

/** สถานะที่ถือว่า "ยังไม่จบเรื่อง" = ทีม IT ยังต้องทำอะไรบางอย่างกับมัน
 *
 *  cancelled ไม่นับเป็นค้าง เพราะเรื่องถูกปิดไปแล้ว (แค่ปิดแบบไม่ได้ซ่อม)
 *  ถ้านับรวม รายการ "ค้างอยู่" จะมีเรื่องที่ไม่มีใครต้องทำอะไรปนอยู่เต็มไปหมด */
const OPEN_STATUSES: TicketStatus[] = [
  "pending",
  "in_progress",
  "waiting_info",
  "waiting_delivery",
];

export default function OverviewPage() {
  const ticketCounts = ticketCountsByStatus();
  const equipment = listEquipment();
  const stockItems = listStockItemsWithStatus();

  const inRepairCount = equipment.filter((e) => e.status === "ส่งซ่อม").length;
  const availableCount = equipment.filter((e) => e.status === "ว่าง").length;
  const lowStockCount = stockItems.filter((s) => s.stock_status !== "ปกติ").length;

  // แปลงวันที่เป็น key ตามเวลาไทยตั้งแต่ฝั่งนี้ แล้วส่งลงไปเป็นสตริง
  // ฝั่ง client จึงไม่ต้องคำนวณ time zone เอง (ดูเหตุผลเต็มๆ ที่ lib/date-th.ts)
  const todayKey = todayKeyTH();
  const calendarTickets: CalendarTicket[] = listTicketsWithRelations().map((t) => ({
    id: t.id,
    ticket_code: t.ticket_code,
    type: t.type,
    status: t.status,
    company: t.company,
    location: t.location,
    requester_name: t.requester?.display_name ?? null,
    description: t.description,
    day_key: dayKeyTH(t.created_at),
    time: timeKeyTH(t.created_at),
    open: OPEN_STATUSES.includes(t.status),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="ภาพรวม"
        description="สรุปสถานะระบบ IT Support ทั้งหมด — กดที่การ์ดเพื่อดูรายการของตัวเลขนั้น"
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1.5 text-xs text-muted">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            ระบบทำงานปกติ
          </span>
        }
      />

      {/* 2 คอลัมน์บนมือถือ · 3 บนแท็บเล็ต · 5 บนจอใหญ่
          มือถือใช้ 2 คอลัมน์แทน 1 เพราะการ์ดเรียงลงมาทีละใบทำให้ต้องปัดผ่านเกือบเต็มจอ
          กว่าจะถึงปฏิทิน ซึ่งเป็นของที่คนเปิดหน้านี้มาดูจริงๆ
          ทุกการ์ดลิงก์ไปยังรายการที่กรองไว้ให้ "ได้จำนวนเท่ากับตัวเลขบนการ์ดเป๊ะๆ" */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
        <StatCard
          icon="🎫"
          label="Ticket ทั้งหมด"
          value={ticketCounts.all}
          tone="accent"
          href="/tickets"
          linkHint="ดู Ticket ทั้งหมด"
        />
        <StatCard
          icon="⏳"
          label="รอดำเนินการ"
          value={ticketCounts.pending}
          tone={ticketCounts.pending > 0 ? "warning" : "success"}
          hint={`จากทั้งหมด ${ticketCounts.all} เรื่อง`}
          href="/tickets?status=pending"
          linkHint="ดูเรื่องที่รอดำเนินการ"
        />
        <StatCard
          icon="💻"
          label="ทรัพย์สินทั้งหมด"
          value={equipment.length}
          hint={`ว่างพร้อมจ่าย ${availableCount} ชิ้น`}
          href="/assets"
          linkHint="ดูทรัพย์สินทั้งหมด"
        />
        <StatCard
          icon="🔧"
          label="อุปกรณ์ในการซ่อม"
          value={inRepairCount}
          tone={inRepairCount > 0 ? "warning" : "success"}
          href={`/assets?status=${encodeURIComponent("ส่งซ่อม")}`}
          linkHint="ดูอุปกรณ์ที่ส่งซ่อมอยู่"
        />
        <StatCard
          icon="📦"
          label="สต็อกใกล้หมด"
          value={lowStockCount}
          tone={lowStockCount > 0 ? "danger" : "success"}
          hint={`จาก ${stockItems.length} รายการ`}
          // status=low = ถึงขั้นต่ำ + ต่ำกว่า รวมกัน ให้ได้จำนวนตรงกับตัวเลขบนการ์ด
          href="/stock?status=low"
          linkHint="ดูรายการสต็อกที่ใกล้หมด"
        />
      </div>

      {/* ตัวเลข "วันนี้" กับ "ค้างอยู่" อยู่ในหัวปฏิทินแล้ว (และกดสลับดูรายการได้ด้วย)
          จึงไม่ทำการ์ดซ้ำอีกชุด — ข้อมูลเดียวกันโผล่สองที่ห่างกันแค่บรรทัดเดียวคือความรก
          ที่ทำให้คนต้องอ่านสองรอบเพื่อรู้ว่ามันคือเลขเดียวกัน */}
      <TicketCalendar tickets={calendarTickets} todayKey={todayKey} />
    </div>
  );
}
