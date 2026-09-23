import "server-only";

/** สวิตช์ป้องกันฝั่งหน้าเว็บ — อ่านตอน request ไม่ใช่ตอน build
 *
 *  จงใจไม่ใช้ NEXT_PUBLIC_* เพราะค่าพวกนั้นถูกฝังลงไฟล์ตั้งแต่ตอน `next build`
 *  เปลี่ยนทีต้อง build ใหม่ทั้งก้อน (~2-3 นาที) แต่หน้าแอดมินทุกหน้าเป็น force-dynamic อยู่แล้ว
 *  อ่าน env ตอน request ได้ตรงๆ จึงสลับค่าได้ด้วย `docker compose up -d app` เฉยๆ
 *
 *  ค่าตั้งต้นเป็น "เปิดการป้องกัน" เมื่อไม่ได้ตั้งค่าอะไรเลย — ตั้งใจให้เป็นแบบนี้
 *  เพราะระบบนี้เปิดสู่อินเทอร์เน็ตโดยไม่มีล็อกอิน (AUTH_DISABLED=true)
 */

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw.toLowerCase() === "true" || raw === "1";
}

export const SECURITY_FLAGS = {
  /** BLOCK_DEVTOOLS=false เพื่อปิดทั้งหมด (เช่นตอนทีม IT ต้องดีบักหน้าเว็บจริงๆ) */
  get blockDevTools() {
    return flag("BLOCK_DEVTOOLS", true);
  },
  /** BLOCK_CONTEXT_MENU=false ถ้าทีมรำคาญที่คลิกขวาไม่ได้ */
  get blockContextMenu() {
    return flag("BLOCK_CONTEXT_MENU", true);
  },
  /** BLOCK_DEVTOOLS_DETECT=true เพื่อเปิด "เบลอจอเมื่อเดาว่า DevTools เปิดอยู่"
   *  ปิดไว้เป็นค่าตั้งต้นเพราะการเดานี้พลาดได้ทั้งสองทาง (ดูคอมเมนต์ใน BlockDevTools.tsx) */
  get detectDevToolsOpen() {
    return flag("BLOCK_DEVTOOLS_DETECT", false);
  },
};
