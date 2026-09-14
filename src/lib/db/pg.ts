import "server-only";
import { Pool, types } from "pg";

// pg คืนค่า numeric เป็น string โดย default (กัน floating point ผิดเพี้ยน) แต่ type ของเรา
// (purchase_price, repair_cost) คือ number ตรงๆ ตาม types.ts — parse กลับเป็น number ให้ตรงกับ
// ที่โค้ดเดิม (formatBaht, การคำนวณต่างๆ) คาดหวัง
types.setTypeParser(types.builtins.NUMERIC, (val) => (val === null ? null : parseFloat(val)));

// pg คืนค่า timestamp/timestamptz เป็น JS Date object โดย default แต่ types.ts ประกาศทุกฟิลด์
// วันที่เป็น string (ISO 8601) ตามที่ JSON.stringify ของ mock data เดิมเคยให้ — แปลงกลับเป็น
// ISO string เสมอ กัน runtime type เพี้ยนไปจาก type ที่ประกาศไว้ (เช่น .slice()/string compare
// ที่โค้ดเดิมใช้กับค่าพวกนี้)
const toIsoString = (val: string | null) => (val === null ? null : new Date(val).toISOString());
types.setTypeParser(types.builtins.TIMESTAMPTZ, toIsoString);
types.setTypeParser(types.builtins.TIMESTAMP, toIsoString);
// date (ไม่มีเวลา เช่น purchase_date) postgres คืนเป็น "YYYY-MM-DD" อยู่แล้วโดย default ตรงกับ
// dateOnly() ใน src/lib/db/equipment.ts พอดี ไม่ต้องแปลงเพิ่ม

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "ไม่ได้ตั้งค่า DATABASE_URL — ต้องตั้งค่าใน .env ก่อนรันแอป (ดู .env.example)"
    );
  }
  return new Pool({ connectionString, max: 10 });
}

// กัน hot-reload ตอน dev (next dev) สร้าง Pool ซ้ำซ้อนจนชน connection limit ของ Postgres
const globalForPg = globalThis as unknown as { __pgPool?: Pool };

/**
 * สร้าง Pool แบบ lazy — ห้ามสร้างตอน import module เด็ดขาด เพราะ `next build` จะ import ไฟล์
 * ฝั่งเซิร์ฟเวอร์ทุกตัวเข้ามาอ่าน route config ตอน build ซึ่งตอนนั้น (ในขั้น builder ของ
 * Dockerfile) ยังไม่มี DATABASE_URL และยังไม่มี Postgres ให้ต่อ — ถ้าเช็ค env ที่ top level
 * build จะพังทันทีทั้งที่ตอนรันจริงมีค่าครบ
 */
export function getPool(): Pool {
  const cached = globalForPg.__pgPool;
  if (cached) return cached;

  const pool = createPool();
  // dev เท่านั้นที่ต้อง cache ไว้บน globalThis (hot-reload ล้าง module cache แต่ไม่ล้าง global)
  // ส่วน production module ถูก import ครั้งเดียวตลอดอายุ process อยู่แล้ว
  globalForPg.__pgPool = pool;
  return pool;
}
