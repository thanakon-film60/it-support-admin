import type { TicketStatus, EquipmentStatus } from "@/lib/types";
import { TICKET_STATUS_LABEL, TICKET_STATUS_ORDER } from "@/lib/ticket-status";

/* ป้ายสถานะแบบ "เรืองแสงจาง" — พื้นโปร่ง 10% + ขอบวงใน + จุดนำหน้า
   อ่านง่ายกว่าพิลล์พื้นสว่างบนธีมมืด และแยกสถานะออกจากกันได้ด้วยสีเดียวไม่ต้องพึ่งข้อความ */
const PILL =
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ring-1 ring-inset";

function Dot({ className }: { className: string }) {
  return <span className={`h-1.5 w-1.5 rounded-full ${className}`} aria-hidden />;
}

// ส้ม = ยังต้องทำ · เขียว = แก้เสร็จ · แดง = ยกเลิก (ปิดโดยไม่ได้แก้) — ต้องแยกเขียวกับแดงได้ทันที
// ไม่งั้นคนกวาดตาดูตารางจะนับเรื่องที่ยกเลิกเป็นงานที่ทำเสร็จ
const TICKET_STATUS_STYLE: Record<TicketStatus, { pill: string; dot: string }> = {
  pending: { pill: "bg-amber-400/10 text-amber-300 ring-amber-400/25", dot: "bg-amber-300" },
  resolved: { pill: "bg-emerald-500/15 text-emerald-200 ring-emerald-400/40", dot: "bg-emerald-300" },
  cancelled: { pill: "bg-rose-500/10 text-rose-300 ring-rose-400/25", dot: "bg-rose-400" },
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const s = TICKET_STATUS_STYLE[status];
  return (
    <span className={`${PILL} ${s.pill}`}>
      <Dot className={s.dot} />
      {TICKET_STATUS_LABEL[status]}
    </span>
  );
}

// ค่าคงที่อยู่ที่ lib/ticket-status.ts (ฝั่งเซิร์ฟเวอร์ใช้ด้วย) — ส่งต่อจากที่นี่ให้ไฟล์ที่ import จาก Badge อยู่เดิม
export { TICKET_STATUS_LABEL, TICKET_STATUS_ORDER };

const EQUIPMENT_STATUS_STYLE: Record<EquipmentStatus, { pill: string; dot: string }> = {
  ว่าง: { pill: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25", dot: "bg-emerald-300" },
  จองแล้ว: { pill: "bg-amber-400/10 text-amber-300 ring-amber-400/25", dot: "bg-amber-300" },
  ใช้งานอยู่: { pill: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/25", dot: "bg-cyan-300" },
  ส่งซ่อม: { pill: "bg-orange-400/10 text-orange-300 ring-orange-400/25", dot: "bg-orange-300" },
  เลิกใช้งาน: { pill: "bg-slate-400/10 text-slate-300 ring-slate-400/20", dot: "bg-slate-400" },
};

export function EquipmentStatusBadge({ status }: { status: EquipmentStatus }) {
  const s = EQUIPMENT_STATUS_STYLE[status];
  return (
    <span className={`${PILL} ${s.pill}`}>
      <Dot className={s.dot} />
      {status}
    </span>
  );
}

const STOCK_STATUS_STYLE: Record<string, { pill: string; dot: string }> = {
  ปกติ: { pill: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25", dot: "bg-emerald-300" },
  ถึงขั้นต่ำ: { pill: "bg-amber-400/10 text-amber-300 ring-amber-400/25", dot: "bg-amber-300" },
  ต่ำกว่า: { pill: "bg-rose-500/10 text-rose-300 ring-rose-400/25", dot: "bg-rose-400 animate-pulse" },
};

export function StockStatusBadge({
  status,
}: {
  status: "ปกติ" | "ถึงขั้นต่ำ" | "ต่ำกว่า";
}) {
  const s = STOCK_STATUS_STYLE[status];
  return (
    <span className={`${PILL} ${s.pill}`}>
      <Dot className={s.dot} />
      {status}
    </span>
  );
}

/** ป้ายบริษัทของสาขา — สีต่างกันเพื่อให้กวาดตาแยกออกทันทีในตารางที่ปนกันทั้งสองบริษัท
 *  ไม่มีข้อมูล = สาขาไม่อยู่ในทะเบียน (ticket เก่า หรือแอดมินคีย์ชื่อสาขาเอง)
 *  แสดงเป็น "—" จางๆ ไม่เดาให้ เพราะเดาผิดแล้วรายงานแยกบริษัทจะเพี้ยนโดยไม่มีใครรู้ */
const COMPANY_STYLE: Record<string, string> = {
  Montipa: "bg-teal-400/10 text-teal-300 ring-teal-400/25",
  Motta: "bg-fuchsia-400/10 text-fuchsia-300 ring-fuchsia-400/25",
  สำนักงานใหญ่: "bg-slate-400/10 text-slate-300 ring-slate-400/25",
};

export function CompanyBadge({ label }: { label: string | null }) {
  if (!label) return <span className="text-xs text-muted/40">—</span>;
  const style = COMPANY_STYLE[label] ?? "bg-slate-400/10 text-slate-300 ring-slate-400/25";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${style}`}
    >
      {label}
    </span>
  );
}
