import type { TicketStatus, EquipmentStatus } from "@/lib/types";

// สีดึงมาจาก computed style จริงของ it-support-admin.vercel.app (soft pill: bg อ่อน + ตัวหนังสือเข้ม)
const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  pending: "รอดำเนินการ",
  in_progress: "กำลังดำเนินการ",
  waiting_info: "รอข้อมูล",
  waiting_delivery: "รอส่งมอบ",
  resolved: "แก้ไขแล้ว",
  closed: "ปิดแล้ว",
  cancelled: "ยกเลิก",
};

const TICKET_STATUS_STYLE: Record<TicketStatus, string> = {
  pending: "bg-amber-100 text-amber-600",
  in_progress: "bg-blue-100 text-blue-600",
  waiting_info: "bg-violet-100 text-violet-600",
  waiting_delivery: "bg-orange-100 text-orange-600",
  resolved: "bg-emerald-100 text-emerald-600",
  closed: "bg-gray-100 text-gray-500",
  cancelled: "bg-red-100 text-red-500",
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${TICKET_STATUS_STYLE[status]}`}
    >
      {TICKET_STATUS_LABEL[status]}
    </span>
  );
}

export const TICKET_STATUS_ORDER: TicketStatus[] = [
  "pending",
  "in_progress",
  "waiting_info",
  "waiting_delivery",
  "resolved",
  "closed",
  "cancelled",
];

export { TICKET_STATUS_LABEL };

const EQUIPMENT_STATUS_STYLE: Record<EquipmentStatus, string> = {
  ว่าง: "bg-emerald-100 text-emerald-600",
  จองแล้ว: "bg-amber-100 text-amber-600",
  ใช้งานอยู่: "bg-blue-100 text-blue-600",
  ส่งซ่อม: "bg-orange-100 text-orange-600",
  เลิกใช้งาน: "bg-gray-100 text-gray-500",
};

export function EquipmentStatusBadge({ status }: { status: EquipmentStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${EQUIPMENT_STATUS_STYLE[status]}`}
    >
      {status}
    </span>
  );
}

const STOCK_STATUS_STYLE: Record<string, string> = {
  ปกติ: "bg-emerald-100 text-emerald-600",
  ถึงขั้นต่ำ: "bg-amber-100 text-amber-600",
  ต่ำกว่า: "bg-red-100 text-red-500",
};

export function StockStatusBadge({ status }: { status: "ปกติ" | "ถึงขั้นต่ำ" | "ต่ำกว่า" }) {
  const icon = status === "ปกติ" ? "" : "⚠️ ";
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${STOCK_STATUS_STYLE[status]}`}
    >
      {icon}
      {status}
    </span>
  );
}
