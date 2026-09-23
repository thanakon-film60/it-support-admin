import { newId } from "../utils";
import { readCollection, upsertOne, writeCollection } from "./store";
import { byNewestFirst } from "../sorting";
import type { TicketEvent, TicketStatus } from "../types";

const COLLECTION = "ticket_events";

/** เก็บได้สูงสุดกี่เหตุการณ์ — เหตุผลเดียวกับ ticket_views
 *  store.ts อ่านทั้งไฟล์เข้าหน่วยความจำทุก request ปล่อยให้โตไม่จำกัดแล้วหน้าเว็บจะช้าลงเรื่อยๆ
 *  10,000 แถว ≈ 1,500 ticket ที่ผ่านครบทุกขั้น เพียงพอสำหรับการตรวจสอบย้อนหลัง */
const MAX_ROWS = 10_000;

function seed(): TicketEvent[] {
  return [];
}

export function listTicketEvents(): TicketEvent[] {
  return byNewestFirst(readCollection<TicketEvent>(COLLECTION, seed), "created_at");
}

/** ไทม์ไลน์ของ ticket หนึ่งใบ เรียงเก่า→ใหม่
 *  (ต่างจากที่อื่นในระบบที่เรียงใหม่ก่อน เพราะไทม์ไลน์ต้องอ่านจากต้นเรื่องไปท้ายเรื่อง) */
export function listEventsForTicket(ticketId: string): TicketEvent[] {
  return listTicketEvents()
    .filter((e) => e.ticket_id === ticketId)
    .reverse();
}

/** จัดกลุ่มไทม์ไลน์ของทุก ticket ในครั้งเดียว — กันไม่ให้หน้าเว็บวนหาเองทีละใบ (O(n×m)) */
export function groupEventsByTicket(): Record<string, TicketEvent[]> {
  const out: Record<string, TicketEvent[]> = {};
  // listTicketEvents เรียงใหม่→เก่า จึง unshift เพื่อให้ผลลัพธ์เรียงเก่า→ใหม่
  for (const e of listTicketEvents()) (out[e.ticket_id] ??= []).unshift(e);
  return out;
}

export interface RecordEventInput {
  ticket_id: string;
  ticket_code: string;
  type: TicketEvent["type"];
  from_status?: TicketStatus | null;
  to_status?: TicketStatus | null;
  /** ใครเป็นคนทำ — ชื่อแอดมิน หรือชื่อผู้แจ้งตอนกดตกลงในแชท */
  actor: string;
  actor_role: TicketEvent["actor_role"];
  note?: string | null;
}

export function recordTicketEvent(input: RecordEventInput): TicketEvent {
  const event: TicketEvent = {
    id: newId(),
    ticket_id: input.ticket_id,
    ticket_code: input.ticket_code,
    type: input.type,
    from_status: input.from_status ?? null,
    to_status: input.to_status ?? null,
    actor: (input.actor || "").trim() || "ไม่ทราบชื่อ",
    actor_role: input.actor_role,
    note: input.note?.trim() || null,
    created_at: new Date().toISOString(),
  };
  upsertOne<TicketEvent>(COLLECTION, event, seed);
  trimOldRows();
  return event;
}

function trimOldRows() {
  const all = readCollection<TicketEvent>(COLLECTION, seed);
  if (all.length <= MAX_ROWS) return;
  writeCollection<TicketEvent>(COLLECTION, byNewestFirst(all, "created_at").slice(0, MAX_ROWS));
}
