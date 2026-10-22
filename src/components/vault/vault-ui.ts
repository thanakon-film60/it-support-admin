// ค่ากลางของหน้ารหัสผ่านฝั่งเบราว์เซอร์ (สี/ข้อความที่หลายคอมโพเนนต์ใช้ร่วมกัน)

import type { VaultCategory } from "@/lib/vault-shared";

export const CONTROL =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";

export const OFFLINE = "ติดต่อเซิร์ฟเวอร์ไม่ได้ — เช็กอินเทอร์เน็ตแล้วลองใหม่";

/** รหัสที่กดดูแล้วโชว์ค้างไว้นานเท่านี้ แล้วกลับเป็น •••• เอง — ลืมกดซ่อนแล้วลุกไปไหนต้องไม่ค้างบนจอ */
export const REVEAL_SECONDS = 30;

export const CATEGORY_BADGE: Record<VaultCategory, string> = {
  account: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/25",
  network: "bg-indigo-400/10 text-indigo-300 ring-indigo-400/25",
  wifi: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
  apple_id: "bg-slate-300/10 text-slate-200 ring-slate-300/25",
};

/** ป้องกันเบราว์เซอร์/ตัวจัดการรหัสผ่าน "จำ" รหัสในฟอร์มนี้เป็นรหัสล็อกอินของเว็บเรา
 *  ถ้าปล่อย Chrome จะเสนอบันทึกรหัส Wi-Fi ว่าเป็นรหัสของ it.thanakronpart-time.com แล้วกรอกให้ผิดที่ทีหลัง */
export const NO_AUTOFILL = {
  autoComplete: "off",
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-form-type": "other",
} as const;

export function isLinkable(url: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(url);
}

/** คัดลอกลงคลิปบอร์ด — คืน false ถ้าเบราว์เซอร์ไม่ยอม (ไม่ใช่ HTTPS / ไม่ได้รับอนุญาต) */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
