import { newId } from "../utils";
import { readCollection, upsertOne, writeCollection } from "./store";
import { byNewestFirst } from "../sorting";
import type { TicketView } from "../types";

const COLLECTION = "ticket_views";

/** เพดานจำนวน log ที่เก็บไว้ — กันไฟล์ JSON โตไม่มีที่สิ้นสุด
 *
 *  store.ts อ่านทั้งไฟล์เข้าหน่วยความจำทุก request ถ้าปล่อยให้โตเรื่อยๆ วันหนึ่ง
 *  หน้า /tickets จะช้าลงเรื่อยๆ โดยไม่มีใครรู้สาเหตุ (พนักงาน 182 คน กดเช็คสถานะคนละหลายครั้ง
 *  ต่อเรื่อง = โตเร็วกว่าตาราง ticket เองมาก) ตัดที่ 5,000 แถวล่าสุดพอสำหรับการตรวจสอบย้อนหลัง
 */
const MAX_ROWS = 5000;

function seed(): TicketView[] {
  return [];
}

export function listTicketViews(): TicketView[] {
  return byNewestFirst(readCollection<TicketView>(COLLECTION, seed), "created_at");
}

export function listViewsForTicket(ticketId: string): TicketView[] {
  return listTicketViews().filter((v) => v.ticket_id === ticketId);
}

/** สรุปต่อ ticket ไว้ให้หน้าแอดมินใช้ — คำนวณครั้งเดียวแล้วแจกเป็น map
 *  ถ้าให้แต่ละแถวไปหาเองจะกลายเป็น O(จำนวน ticket × จำนวน log) */
export interface TicketViewSummary {
  count: number;
  last_at: string;
  last_viewer: string;
}

export function summarizeViews(): Record<string, TicketViewSummary> {
  const out: Record<string, TicketViewSummary> = {};
  // listTicketViews เรียงใหม่→เก่าอยู่แล้ว แถวแรกที่เจอของแต่ละ ticket จึงคือครั้งล่าสุด
  for (const v of listTicketViews()) {
    const cur = out[v.ticket_id];
    if (cur) {
      cur.count += 1;
    } else {
      out[v.ticket_id] = { count: 1, last_at: v.created_at, last_viewer: v.viewer_name };
    }
  }
  return out;
}

export interface RecordViewInput {
  ticket_id: string;
  ticket_code: string;
  source: TicketView["source"];
  line_user_id?: string | null;
  viewer_name?: string | null;
  ip?: string | null;
  ip_note?: string | null;
  user_agent?: string | null;
}

export interface RecordViewResult {
  view: TicketView;
  /** ผู้ใช้คนนี้เพิ่งเปิดดูเรื่องนี้เป็นครั้งแรก — ใช้ตัดสินใจว่าจะ push แจ้งทีม IT ไหม
   *  ถ้า push ทุกครั้งที่กด โควตา push 300 ข้อความ/เดือนจะหมดภายในไม่กี่วัน */
  first_view_by_this_user: boolean;
  /** จำนวนครั้งที่เรื่องนี้ถูกเปิดดูทั้งหมด (รวมครั้งนี้) */
  total_views: number;
}

export function recordTicketView(input: RecordViewInput): RecordViewResult {
  const all = listTicketViews();
  const sameTicket = all.filter((v) => v.ticket_id === input.ticket_id);
  const first =
    !input.line_user_id ||
    !sameTicket.some((v) => v.line_user_id === input.line_user_id);

  const view: TicketView = {
    id: newId(),
    ticket_id: input.ticket_id,
    ticket_code: input.ticket_code,
    source: input.source,
    line_user_id: input.line_user_id ?? null,
    viewer_name: (input.viewer_name ?? "").trim() || "ไม่ทราบชื่อ",
    ip: input.ip ?? null,
    ip_note: input.ip_note ?? null,
    user_agent: input.user_agent ? input.user_agent.slice(0, 300) : null,
    created_at: new Date().toISOString(),
  };

  upsertOne<TicketView>(COLLECTION, view, seed);
  trimOldRows();

  return {
    view,
    first_view_by_this_user: first,
    total_views: sameTicket.length + 1,
  };
}

/** ตัดแถวเก่าทิ้งเมื่อเกินเพดาน — เขียนกลับเฉพาะตอนที่ต้องตัดจริงเท่านั้น */
function trimOldRows() {
  const all = readCollection<TicketView>(COLLECTION, seed);
  if (all.length <= MAX_ROWS) return;
  writeCollection<TicketView>(COLLECTION, byNewestFirst(all, "created_at").slice(0, MAX_ROWS));
}
