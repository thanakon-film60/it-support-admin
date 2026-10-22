import type { Ticket } from "@/lib/types";
import { formatTicketItems, ticketItems, ticketLineName, withdrawMissingItems } from "@/lib/ticket-meta";

/**
 * ชิ้นส่วนแสดง "ชื่อ LINE ของคนที่ส่งเรื่อง" และ "รายการอุปกรณ์ที่เบิก/คืน" — ใช้ร่วมกันทุกหน้าที่แสดง ticket
 *
 * ที่มา (ผู้ใช้แจ้ง 13 ต.ค. 2026): หน้า Tickets ไม่บอกว่าใครส่งเรื่องเข้ามาทาง LINE และเรื่องเบิกขึ้นแค่
 * "รายละเอียด: เบิกอุปกรณ์" ทั้งที่บอทเก็บรายการของไว้ครบใน meta — แค่ไม่มีหน้าไหนเอามาแสดง
 */

type TicketLike = Pick<Ticket, "meta" | "type">;

/** บรรทัดเล็กใต้ชื่อผู้แจ้งในตาราง — ชื่อโปรไฟล์ LINE ของคนที่กดส่ง (แจ้งแทนกันได้ จึงไม่จำเป็นต้องตรงกับผู้แจ้ง) */
export function LineNameHint({ ticket }: { ticket: TicketLike }) {
  const name = ticketLineName(ticket);
  if (!name) return null;
  return (
    <span
      className="mt-0.5 block max-w-[12rem] truncate text-[11px] text-[#06C755]"
      title={`ชื่อ LINE ของคนที่ส่งเรื่อง: ${name}`}
    >
      LINE: {name}
    </span>
  );
}

/** บรรทัดเล็กใต้ประเภทเรื่องในตาราง — เห็นตั้งแต่ในตารางว่าเบิกอะไร ไม่ต้องเปิดดูทีละเรื่อง */
export function ItemsHint({ ticket }: { ticket: TicketLike }) {
  if (withdrawMissingItems(ticket)) {
    return <span className="mt-0.5 block whitespace-nowrap text-[11px] text-amber-300">⚠ ไม่ได้ระบุอุปกรณ์</span>;
  }
  const items = formatTicketItems(ticketItems(ticket));
  if (!items) return null;
  return (
    <span className="mt-0.5 block max-w-[14rem] truncate text-[11px] text-muted" title={items}>
      📦 {items}
    </span>
  );
}

/** กล่องรายการอุปกรณ์ในแผงรายละเอียด/หน้าต่างแก้สถานะ — แยกจาก "รายละเอียด" ให้เห็นชัดว่าต้องเตรียมของอะไร */
export function TicketItemsBlock({ ticket, className = "" }: { ticket: TicketLike; className?: string }) {
  const items = ticketItems(ticket);
  if (items.length === 0) {
    if (!withdrawMissingItems(ticket)) return null;
    return (
      <div className={`rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-xs leading-5 text-amber-200 ${className}`}>
        ⚠ ผู้แจ้งไม่ได้ระบุอุปกรณ์ที่ต้องการเบิก (เรื่องที่แจ้งก่อนบอทบังคับให้ระบุ) — ทักถามในแชท LINE
      </div>
    );
  }
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <p className="text-xs text-muted">
        {ticket.type === "return" ? "อุปกรณ์ที่คืน" : "อุปกรณ์ที่ขอเบิก"} ({items.length} รายการ)
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((item, index) => (
          <li
            key={`${item.name}-${index}`}
            className="flex items-baseline justify-between gap-3 rounded-lg border border-line bg-page/40 px-3 py-2 text-sm"
          >
            <span className="text-ink">{item.name}</span>
            <span className="shrink-0 font-num text-accent">x{item.qty}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
