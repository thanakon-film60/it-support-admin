import type { Ticket } from "./types";

/**
 * อ่านผลการยืนยันของผู้แจ้งออกจาก `ticket.meta`
 *
 * ทำไมต้องมีไฟล์นี้แยก ไม่ไปอยู่ใน lib/db/tickets.ts:
 *   หน้า /completed เป็น client component ซึ่งห้าม import lib/db/* เด็ดขาด
 *   (จะลาก node:fs เข้า bundle เบราว์เซอร์แล้ว next build ล้ม — ดู tests/client-bundle.test.cjs)
 *   ไฟล์นี้จึงต้องไม่ import อะไรที่แตะดิสก์ และไม่ import react ด้วย เพราะฝั่งเซิร์ฟเวอร์ก็ใช้
 *
 * meta เป็น Record<string, unknown> ที่ใครเขียนอะไรลงไปก็ได้ ตัวอ่านจึงต้องกันค่าเพี้ยนเองทั้งหมด
 * ห้าม cast ตรงๆ — ข้อมูลชุดนี้มาจากไฟล์ JSON ที่แก้ด้วยมือได้ และเคยถูกแก้ด้วยมือมาแล้วจริง
 */
export interface TicketConfirmation {
  confirmed: boolean;
  by: string;
  line_user_id: string | null;
  at: string;
  note: string | null;
}

export function readConfirmation(ticket: Pick<Ticket, "meta">): TicketConfirmation | null {
  const raw = ticket.meta?.confirmation;
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.at !== "string" || !c.at) return null;
  return {
    confirmed: c.confirmed === true,
    by: typeof c.by === "string" && c.by.trim() ? c.by : "ผู้แจ้ง",
    line_user_id: typeof c.line_user_id === "string" ? c.line_user_id : null,
    at: c.at,
    note: typeof c.note === "string" && c.note.trim() ? c.note : null,
  };
}

/** ระยะเวลาตั้งแต่แจ้งจนผู้แจ้งกดยืนยัน — ตัวเลขชี้วัดจริงของทีม IT
 *
 *  ต่างจาก "เวลาที่ช่างกดว่าแก้แล้ว" ตรงที่อันนี้นับถึงตอนที่ผู้ใช้ยืนยันว่าใช้งานได้จริง
 *  ซึ่งเป็นตัวเลขเดียวที่เอาไปพูดกับผู้บริหารได้โดยไม่ต้องอธิบายต่อ
 *
 *  คืน null เมื่อข้อมูลไม่ครบหรือเวลาย้อนหลัง (แก้ไฟล์ JSON ด้วยมือแล้วพลาดได้)
 */
export function confirmationLeadTimeHours(createdAt: string, confirmedAt: string | null): number | null {
  if (!confirmedAt) return null;
  const start = Date.parse(createdAt);
  const end = Date.parse(confirmedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return (end - start) / 3_600_000;
}

/** แปลงชั่วโมงเป็นข้อความที่คนอ่านแล้วเข้าใจทันที ("3 ชม. 20 นาที" / "2 วัน 4 ชม.") */
export function formatLeadTime(hours: number | null): string {
  if (hours === null) return "-";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} นาที`;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
  }
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  return h > 0 ? `${d} วัน ${h} ชม.` : `${d} วัน`;
}

/** ทีม IT คนที่กด "แก้ไขแล้ว" เป็นครั้งสุดท้าย — อ่านจาก status_history
 *
 *  ทำไมไม่ใช้ ticket.status_updated_by: ฟิลด์นั้นคือ "คนที่แตะล่าสุด" ซึ่งอาจเป็นคนที่มาปิดงาน
 *  ทีหลัง หรือคนที่แก้สถานะผิดแล้วแก้กลับ คำถามของหน้า /completed คือ "ใครเป็นคนแก้เรื่องนี้"
 *  ซึ่งตอบได้จากรายการที่เปลี่ยนสถานะเป็น resolved เท่านั้น
 *
 *  คืน null ได้ตามปกติ — เรื่องเก่าที่ปิดไปก่อนมีระบบประวัติจะไม่มีข้อมูลส่วนนี้
 */
export function readResolvedBy(
  ticket: Pick<Ticket, "meta">
): { by: string; at: string; note: string } | null {
  const raw = ticket.meta?.status_history;
  if (!Array.isArray(raw)) return null;

  for (let i = raw.length - 1; i >= 0; i -= 1) {
    const e = raw[i];
    if (!e || typeof e !== "object") continue;
    const entry = e as Record<string, unknown>;
    if (entry.to !== "resolved") continue;
    if (typeof entry.at !== "string") continue;
    return {
      by: typeof entry.by === "string" && entry.by.trim() ? entry.by : "-",
      at: entry.at,
      note: typeof entry.note === "string" ? entry.note : "",
    };
  }
  return null;
}
