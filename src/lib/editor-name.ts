/* ชื่อ "ผู้แก้ไขสถานะ" ที่แอดมินกรอกตอนเปลี่ยนสถานะเรื่องแจ้ง
 *
 * อยู่ใน lib/ ไม่ใช่ใน component เพราะมีสองหน้าที่ต้องใช้กติกาเดียวกันเป๊ะ
 * (หน้า Tickets กับหน้าประวัติซ่อม) — ถ้าปล่อยให้แต่ละหน้าเขียนเอง วันหนึ่งจะจำชื่อคนละคีย์
 * แล้วคนใช้งานจะเจอว่า "บางหน้าจำชื่อให้ บางหน้าไม่จำ" โดยไม่มีเหตุผลอธิบายได้
 *
 * ⚠️ ไฟล์นี้ถูก import จาก client component — ห้ามดึงอะไรจาก lib/db เข้ามาเด็ดขาด
 *    (จะลาก node:fs เข้า bundle ของเบราว์เซอร์แล้ว next build ล้ม)
 *
 * ⚠️ ห้าม import อะไรจาก "react" ในไฟล์นี้เช่นกัน — Server Action (actions/tickets.ts)
 *    import ค่าคงที่ MAX_EDITOR_NAME จากที่นี่ เพื่อตรวจด้วยเกณฑ์เดียวกับที่ฟอร์มบังคับ
 *    ไฟล์นี้จึงอยู่ในกราฟของ Server Component ด้วย และ `next build` จะล้มทันทีที่มี hook ปนมา:
 *      "You're importing a component that needs `useSyncExternalStore`..."
 *    (เจอจริงตอน build ใน Docker — tsc/eslint/เทสต์ผ่านหมดโดยไม่มีอะไรเตือนเลย)
 *    hook ที่อ่านค่านี้อยู่ใน use-last-editor.ts ซึ่งประกาศ "use client" ไว้แยกต่างหาก
 */

/** ความยาวสูงสุด — ต้องตรงกับ MAX_EDITOR_NAME ที่ฝั่ง Server Action ตรวจซ้ำอีกชั้น */
export const MAX_EDITOR_NAME = 60;

/** เก็บใน localStorage ไม่ใช่ cookie/ฐานข้อมูล เพราะเป็นความสะดวกของ "เครื่องนั้น"
 *  ไม่ใช่ข้อมูลของระบบ — เครื่องกลาง 1 เครื่องที่หลายคนผลัดกันใช้ต้องพิมพ์ชื่อทับได้เสมอ */
const EDITOR_KEY = "itadmin:editor-name";

/** localStorage เข้าถึงไม่ได้/โยน error ได้จริงในโหมดส่วนตัวบางเบราว์เซอร์
 *  จึงห่อ try/catch ไว้ทั้งขาอ่านและขาเขียน — จำชื่อไม่ได้ไม่ใช่เหตุผลที่จะทำให้หน้าเว็บพัง */
export function readLastEditor(): string {
  // กันไว้เผื่อถูกเรียกระหว่างเรนเดอร์ฝั่งเซิร์ฟเวอร์ (เช่นแผงรายละเอียดที่เปิดค้างจาก ?code=...)
  // ซึ่งไม่มี window ให้แตะ — ปกติควรอ่านผ่าน useLastEditor() ด้านล่างแทน
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(EDITOR_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberEditor(name: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EDITOR_KEY, name.trim());
  } catch {
    /* งานหลักคือการบันทึกสถานะซึ่งสำเร็จไปแล้ว ส่วนนี้เป็นของแถม */
  }
}

/** รวมชื่อที่เคยใช้ในเครื่องเข้ากับชื่อที่เคยบันทึกในระบบ แล้วตัดที่ซ้ำกันออก
 *  (เทียบแบบไม่สนตัวพิมพ์ใหญ่เล็ก เพื่อไม่ให้ "Film" กับ "film" กลายเป็นคนละตัวเลือก) */
export function editorOptions(fromServer: string[], fromDevice: string): string[] {
  const all = fromDevice.trim() ? [fromDevice.trim(), ...fromServer] : fromServer;
  const seen = new Set<string>();
  return all.filter((name) => {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
