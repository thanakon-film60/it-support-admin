/** ตรรกะการเรียงข้อมูลที่ใช้ร่วมกันทั้งฝั่งเซิร์ฟเวอร์ (ชั้น db) และฝั่งเบราว์เซอร์ (ตาราง)
 *
 *  ทำไมต้องแยกเป็นไฟล์กลาง: เดิมแต่ละที่เรียงกันเอง บางที่เรียง บางที่ไม่เรียงเลย
 *  ผลคือ ticket ที่พนักงานเพิ่งแจ้งผ่าน LINE ไปโผล่ "ล่างสุด" ของตาราง เพราะชั้นเก็บข้อมูล
 *  ต่อท้ายไฟล์ JSON แล้วอ่านกลับมาตามลำดับในไฟล์ตรงๆ (store.ts -> all.push(item))
 *  แอดมินจึงไม่เห็นเรื่องใหม่จนกว่าจะเลื่อนไปหน้าสุดท้าย — เป็นบั๊กที่เงียบมาก
 *  เพราะหน้าเว็บ "ดูปกติทุกอย่าง" แค่ลำดับผิด
 */

export type SortDir = "asc" | "desc";

/** ค่าที่เรียงได้ — null/undefined แปลว่า "ไม่มีข้อมูล" และจะถูกดันไปท้ายเสมอ */
export type SortValue = string | number | null | undefined;

export interface SortColumn<T> {
  /** ใช้เป็น id ตอนจำค่าที่ผู้ใช้เลือกไว้ ห้ามเปลี่ยนพร่ำเพรื่อเพราะจะทำให้ค่าที่จำไว้ใช้ไม่ได้ */
  key: string;
  /** ป้ายที่คนอ่าน เช่น "วันที่แจ้ง" */
  label: string;
  /** ดึงค่าที่จะเอาไปเทียบออกจากแถว */
  get: (row: T) => SortValue;
  /** ชนิดข้อมูล มีผลกับวิธีเทียบและคำที่ใช้ในเมนู (ใหม่→เก่า / มาก→น้อย / ก→ฮ) */
  type?: "text" | "number" | "date";
  /** ทิศทางตอนคลิกครั้งแรก — วันที่และตัวเลขควรเริ่มจาก "มากไปน้อย" เพราะคนมองหาของล่าสุด/แพงสุดก่อน */
  firstClick?: SortDir;
  /** ทับคำอธิบายทิศทางเมื่อคำมาตรฐานอ่านแล้วงง
   *  เช่น สถานะเรียงตามลำดับขั้นการทำงาน พูดว่า "มากไปน้อย" ไม่มีใครเข้าใจ
   *  ต้องบอกว่า "รอดำเนินการ → ยกเลิก" ถึงจะรู้ว่าจะได้อะไร */
  dirText?: Record<SortDir, string>;
}

/** คำอธิบายทิศทางที่อ่านรู้เรื่อง ต่างกันตามชนิดข้อมูล
 *  ("จากน้อยไปมาก" ใช้กับวันที่แล้วงง — คนพูดว่า "เก่าสุดก่อน") */
export function dirLabel(col: Pick<SortColumn<unknown>, "type" | "dirText"> | undefined, dir: SortDir): string {
  if (col?.dirText) return col.dirText[dir];
  const type = col?.type;
  if (type === "date") return dir === "desc" ? "ล่าสุดก่อน" : "เก่าสุดก่อน";
  if (type === "number") return dir === "desc" ? "มากไปน้อย" : "น้อยไปมาก";
  return dir === "desc" ? "ฮ → ก" : "ก → ฮ";
}

/** ทิศทางที่ควรได้ตอนคลิกหัวคอลัมน์ครั้งแรก */
export function firstClickDir<T>(col: SortColumn<T>): SortDir {
  return col.firstClick ?? (col.type === "text" ? "asc" : "desc");
}

/** เทียบค่า 2 ตัว โดย "ไม่มีข้อมูล" ไปท้ายเสมอไม่ว่าจะเรียงขึ้นหรือลง
 *
 *  จุดนี้สำคัญกับข้อมูลจริงของระบบนี้มาก: ค่าซ่อมและราคาซื้อเป็น null ได้เยอะ
 *  ถ้าปล่อยให้ null ถูกเทียบเป็น 0 เวลาเรียง "ค่าซ่อมมากไปน้อย" จะได้แถวว่างเปล่า
 *  กองอยู่กลางตาราง ดูเหมือนข้อมูลเพี้ยน ทั้งที่แค่ยังไม่ได้กรอกราคา
 */
function compare(a: SortValue, b: SortValue, type: SortColumn<unknown>["type"]): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;   // ท้ายเสมอ
  if (bEmpty) return -1;

  if (type === "number") return Number(a) - Number(b);
  if (type === "date") {
    const ta = new Date(String(a)).getTime();
    const tb = new Date(String(b)).getTime();
    // วันที่พังก็ถือว่าไม่มีข้อมูล ดันไปท้าย (เคยเจอ created_at เป็นสตริงว่างในข้อมูลนำเข้า)
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return ta - tb;
  }
  // ข้อความ: ต้องใช้ localeCompare แบบไทย ไม่งั้น "ก" กับ "ข" เรียงตามรหัส Unicode
  // ซึ่งพอมีสระ/วรรณยุกต์นำหน้าแล้วลำดับจะไม่ตรงกับที่คนไทยคาด
  return String(a).localeCompare(String(b), "th", { numeric: true, sensitivity: "base" });
}

/** เรียงสำเนาใหม่เสมอ ไม่แก้ array เดิม (array เดิมมาจาก props/React state) */
export function sortRows<T>(rows: T[], col: SortColumn<T> | null, dir: SortDir): T[] {
  if (!col) return rows;
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const r = compare(col.get(a), col.get(b), col.type);
    // เท่ากันแล้วไม่ต้องกลับทิศ ไม่งั้นแถวที่ค่าเท่ากันจะสลับที่ไปมาเวลาสลับทิศทาง
    return r === 0 ? 0 : r * sign;
  });
}

/** เรียงใหม่→เก่าตามฟิลด์วันที่ ใช้ที่ชั้น db เป็นค่าตั้งต้นของทุกตาราง
 *  (ไม่ใช้ sortRows เพื่อให้ฝั่งเซิร์ฟเวอร์ไม่ต้องสร้าง object SortColumn ทุกครั้ง) */
export function byNewestFirst<T>(rows: T[], field: keyof T & string): T[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(String(a[field] ?? "")).getTime();
    const tb = new Date(String(b[field] ?? "")).getTime();
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
}
