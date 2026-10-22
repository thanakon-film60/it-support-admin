import type { Ticket } from "./types";

/**
 * ความเห็นของผู้แจ้ง "หลังทีม IT ปิดงาน" — คะแนน 1–5 ดาว และการขอเปิดเรื่องกลับ
 *
 * ทำไมต้องแยกไฟล์ (เหตุผลเดียวกับ ticket-confirmation.ts):
 *   หน้า /resolved เป็น client component ห้าม import lib/db/* ส่วน route ฝั่งเซิร์ฟเวอร์และการ์ด LINE
 *   ก็ต้องใช้เกณฑ์ชุดเดียวกัน — ถ้าเกณฑ์ "คะแนนต่ำ" ไปอยู่สองที่ วันหนึ่งจะเพี้ยนกัน
 *   แล้วบอทถามหาข้อติตอนได้ 4 ดาว ขณะที่หน้าเว็บนับ 4 ดาวเป็น "พอใจ"
 *   ไฟล์นี้จึงห้าม import อะไรที่แตะดิสก์ และห้าม import react (ฝั่งเซิร์ฟเวอร์ก็ใช้)
 *
 * meta เป็น JSON ที่แก้ด้วยมือได้ ตัวอ่านจึงต้องกันค่าเพี้ยนเองทั้งหมด ห้าม cast ตรงๆ
 */

export const RATING_MAX = 5;

/** 1–3 ดาว = ไม่พอใจ → บอทถามต่อว่าควรปรับปรุงตรงไหน (ผู้แจ้งกดข้ามได้) */
export const RATING_LOW_MAX = 3;

export const MAX_RATING_COMMENT = 500;

/** กด "ยังมีปัญหาอยู่" ได้ภายในกี่วันหลังปิดงาน
 *
 *  ต้องมีเพดาน: การ์ดในห้องแชทอยู่ตลอดไป ถ้าไม่จำกัด การ์ดเมื่อหลายเดือนก่อนจะดึงเรื่องที่ปิดไปนานแล้ว
 *  กลับมาเปิดทั้งที่จริงเป็นปัญหาใหม่ — เรื่องหายจากหน้า log และตัวเลขรายเดือนย้อนหลังเพี้ยนโดยไม่มีใครรู้
 *  เกินกำหนดแล้วบอทบอกให้แจ้งเรื่องใหม่แทน */
export const REOPEN_WINDOW_DAYS = 14;

export interface TicketRating {
  score: number;
  comment: string | null;
  /** ชื่อที่แสดงใน LINE ของคนกด — เก็บเป็นข้อความเพราะเปลี่ยนชื่อทีหลังได้ แต่ log ต้องบอกได้ว่าตอนนั้นใครกด */
  by: string;
  line_user_id: string | null;
  /** เวลาที่แก้คะแนน/ความเห็นล่าสุด */
  at: string;
}

export function isValidScore(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= RATING_MAX;
}

export function isLowScore(score: number): boolean {
  return score <= RATING_LOW_MAX;
}

export function readRating(ticket: Pick<Ticket, "meta">): TicketRating | null {
  const raw = ticket.meta?.rating;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isValidScore(r.score) || typeof r.at !== "string" || !r.at) return null;
  return {
    score: r.score,
    comment: typeof r.comment === "string" && r.comment.trim() ? r.comment.trim() : null,
    by: typeof r.by === "string" && r.by.trim() ? r.by.trim() : "ผู้แจ้ง",
    line_user_id: typeof r.line_user_id === "string" ? r.line_user_id : null,
    at: r.at,
  };
}

/** ★★★☆☆ — ใช้ตัวอักษรแทนอีโมจิ เพราะใส่สีได้และกว้างเท่ากันทุกเครื่อง คอลัมน์ในตารางจึงไม่เบี้ยว */
export function starText(score: number): string {
  const n = Math.min(RATING_MAX, Math.max(0, Math.round(score)));
  return "★".repeat(n) + "☆".repeat(RATING_MAX - n);
}

export interface RatingSummary {
  /** จำนวนเรื่องทั้งหมดที่เอามาคิด (รวมที่ยังไม่ให้คะแนน) */
  total: number;
  /** ให้คะแนนแล้วกี่เรื่อง */
  rated: number;
  average: number | null;
  /** สัดส่วนที่ให้ 4–5 ดาว (CSAT) เป็นเปอร์เซ็นต์ · null = ยังไม่มีใครให้คะแนน */
  csat: number | null;
  /** จำนวนที่ให้ 1–3 ดาว — เรื่องที่ควรตามไปดู */
  low: number;
  /** distribution[n - 1] = จำนวนที่ให้ n ดาว */
  distribution: number[];
}

/** สรุปคะแนนจากเรื่องที่ "ให้คะแนนแล้ว" เท่านั้น
 *
 *  ไม่นับเรื่องที่ยังไม่ให้คะแนนเป็น 0 ดาว เพราะคนที่ไม่กดไม่ได้แปลว่าไม่พอใจ — ถ้านับรวม ค่าเฉลี่ย
 *  จะต่ำกว่าความจริงจนเอาไปพูดต่อไม่ได้ อัตราการตอบ (rated/total) จึงแสดงแยกให้เห็นแทน */
export function summarizeRatings(tickets: Pick<Ticket, "meta">[]): RatingSummary {
  const distribution = Array.from({ length: RATING_MAX }, () => 0);
  let sum = 0;
  let rated = 0;
  for (const ticket of tickets) {
    const rating = readRating(ticket);
    if (!rating) continue;
    rated += 1;
    sum += rating.score;
    distribution[rating.score - 1] += 1;
  }
  const satisfied = distribution.slice(RATING_LOW_MAX).reduce((a, b) => a + b, 0);
  return {
    total: tickets.length,
    rated,
    average: rated ? sum / rated : null,
    csat: rated ? (satisfied / rated) * 100 : null,
    low: rated - satisfied,
    distribution,
  };
}

/** เวลาที่ปิดงานล่าสุด — meta.completed_at มีทุกเรื่องที่ปิดผ่านระบบ ส่วน resolved_at เผื่อข้อมูลเก่า/แก้มือ */
export function closedAt(ticket: Pick<Ticket, "meta" | "resolved_at">): string | null {
  const completed = ticket.meta?.completed_at;
  if (typeof completed === "string" && completed) return completed;
  return ticket.resolved_at ?? null;
}

/** ยังกด "ยังมีปัญหาอยู่" ได้ไหม
 *
 *  ไม่รู้ว่าปิดเมื่อไหร่ (ข้อมูลเก่า/แก้มือ) ให้ผ่าน — กันผิดฝั่งนี้แย่กว่า: ผู้แจ้งที่ยังมีปัญหาจริง
 *  จะโดนไล่ไปเล่าใหม่ตั้งแต่ต้น ขณะที่การเปิดเรื่องที่เกินกำหนดไปนิดหน่อยแทบไม่มีผลเสีย */
export function canReopen(ticket: Pick<Ticket, "meta" | "resolved_at">, now: number = Date.now()): boolean {
  const at = closedAt(ticket);
  if (!at) return true;
  const closedMs = Date.parse(at);
  if (Number.isNaN(closedMs)) return true;
  return now - closedMs <= REOPEN_WINDOW_DAYS * 86_400_000;
}
