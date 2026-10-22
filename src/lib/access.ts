// สิทธิ์รายหน้าของบัญชีเจ้าหน้าที่ — ส่วนที่ "ไม่แตะไฟล์" ใช้ได้ทั้งเซิร์ฟเวอร์และเมนูฝั่งเบราว์เซอร์
//
// รายชื่อหน้าอยู่ใน pages.json ไม่ใช่ในไฟล์นี้ เพราะโปรแกรมจัดการผู้ใช้ (tools/staff_admin.py)
// อ่านไฟล์เดียวกันไปสร้างช่องติ๊ก — เพิ่มหน้าใหม่ที่ pages.json ที่เดียว โปรแกรมเห็นเองโดยไม่ต้องแก้ .py
//
// PAGE_KEYS ข้างล่างซ้ำกับ pages.json โดยตั้งใจ: TypeScript อ่านค่าใน JSON เป็น string ธรรมดา
// ถ้าไม่มีรายการนี้ requireSession("ticket") (พิมพ์ผิด) จะผ่าน tsc แล้วล็อกเจ้าหน้าที่ออกจากหน้านั้นเงียบๆ
// โดยที่แอดมินไม่มีวันเห็นปัญหา (แอดมินเข้าได้ทุกหน้า) — tests/access.test.cjs ตรวจว่าสองที่ตรงกันเสมอ

import PAGE_LIST from "./pages.json";
import type { StaffAccount } from "./types";

export const PAGE_KEYS = [
  "overview",
  "tickets",
  "notes",
  "files",
  "assets",
  "custodian",
  "employees",
  "branches",
  "stock",
  "faq",
  "line-bot",
  "passwords",
] as const;

export type PageKey = (typeof PAGE_KEYS)[number];

export interface PageInfo {
  key: PageKey;
  href: string;
  icon: string;
  label: string;
  /** คำอธิบายสั้นๆ ว่าหน้านี้ทำอะไรได้บ้าง — โชว์ข้างช่องติ๊กในโปรแกรมจัดการผู้ใช้ */
  hint: string;
}

/** เรียงตามเมนูด้านบน — หน้าแรกที่เข้าได้ในลำดับนี้คือหน้าที่พาไปหลังล็อกอิน */
export const PAGES = PAGE_LIST as PageInfo[];

/** หน้าที่บอกว่า "ไม่มีสิทธิ์" — อยู่ในกลุ่ม dashboard จึงยังเห็นเมนูของหน้าที่เข้าได้ */
export const NO_ACCESS_PATH = "/no-access";

export function isPageKey(value: unknown): value is PageKey {
  return typeof value === "string" && (PAGE_KEYS as readonly string[]).includes(value);
}

/** หน้าที่บัญชีนี้เข้าได้
 *
 *  แอดมิน = ทุกหน้าเสมอ รวมหน้าที่จะเพิ่มในอนาคต (ไม่ต้องตามติ๊กให้ตัวเองทุกครั้งที่มีหน้าใหม่)
 *  เจ้าหน้าที่ = เฉพาะที่ติ๊กไว้ · หน้าใหม่ปิดไว้ก่อนจนกว่าแอดมินจะติ๊กให้ (deny by default)
 *  ค่าที่ไม่รู้จัก (หน้าที่ถูกเอาออกไปแล้ว / แก้ไฟล์มือแล้วพิมพ์ผิด) ถูกตัดทิ้ง ไม่ทำให้อะไรพัง */
export function pagesOf(account: Pick<StaffAccount, "role" | "pages">): PageKey[] {
  if (account.role === "admin") return [...PAGE_KEYS];
  const wanted = new Set(Array.isArray(account.pages) ? account.pages : []);
  return PAGE_KEYS.filter((key) => wanted.has(key));
}

/** ส่งหลายหน้า = เข้าได้ถ้ามีสิทธิ์ "หน้าใดหน้าหนึ่ง" — ใช้กับ Server Action ที่หลายหน้าเรียกร่วมกัน
 *  เช่นเปลี่ยนสถานะ ticket ทำได้ทั้งจากหน้า Tickets และหน้าประวัติซ่อม */
export function canAccess(pages: readonly PageKey[], need: PageKey | readonly PageKey[]): boolean {
  const list: readonly PageKey[] = typeof need === "string" ? [need] : need;
  return list.some((key) => pages.includes(key));
}

/** หน้าที่ควรพาไปเมื่อหน้าแรก (ภาพรวม) เข้าไม่ได้ — หน้าแรกที่มีสิทธิ์ตามลำดับเมนู */
export function landingPath(pages: readonly PageKey[]): string {
  const first = PAGES.find((page) => pages.includes(page.key));
  return first ? first.href : NO_ACCESS_PATH;
}

/** รูปแนบใน /uploads/<โฟลเดอร์>/... → ต้องมีสิทธิ์หน้าใดหน้าหนึ่งที่ใช้รูปนั้นถึงจะเปิดได้
 *
 *  ใช้สองที่: proxy.ts (ด่านแรก — ไฟล์ที่มีอยู่ตอนเซิร์ฟเวอร์เริ่ม Next เสิร์ฟตรงจาก public/ โดยไม่ผ่าน route)
 *  และ app/uploads/[...path]/route.ts (ไฟล์ที่อัปโหลดหลังเซิร์ฟเวอร์เริ่ม) — ต้องใช้ตารางเดียวกันเสมอ
 *  โฟลเดอร์ที่ไม่อยู่ในตาราง = ไม่เสิร์ฟให้ใครเลย (เพิ่มโฟลเดอร์อัปโหลดใหม่ต้องมาเพิ่มที่นี่) */
export const UPLOAD_AREA_PAGES: Readonly<Record<string, readonly PageKey[]>> = {
  tickets: ["tickets"],
  faq: ["faq"],
};

export function uploadAreaPages(area: string | undefined): readonly PageKey[] | null {
  return area && Object.hasOwn(UPLOAD_AREA_PAGES, area) ? UPLOAD_AREA_PAGES[area] : null;
}

/** ปลายทางหลังล็อกอินที่ยอมพาไป — เฉพาะ path ภายในระบบนี้เท่านั้น
 *
 *  ค่า ?from= มาจาก URL ที่ใครก็แต่งส่งมาได้ ถ้ารับ "https://เว็บปลอม" หรือ "//เว็บปลอม" ตรงๆ
 *  ผู้ใช้ที่เพิ่งล็อกอินสำเร็จจะถูกส่งต่อไปหน้าหลอกที่หน้าตาเหมือนระบบเรา (open redirect → phishing)
 *  "/\\" ก็ต้องกัน เพราะเบราว์เซอร์บางตัวตีความ \ เป็น / แล้วกลายเป็น //เว็บปลอม */
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string") return "/";
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return "/";
  // ตัวควบคุม (ขึ้นบรรทัด/tab) ใน URL ไม่มีเหตุผลที่ถูกต้อง และบางเบราว์เซอร์ตัดทิ้งก่อนตีความ
  // ทำให้ "/\t/เว็บปลอม" กลายเป็น "//เว็บปลอม" ได้หลังผ่านด่านข้างบนไปแล้ว
  for (const ch of path) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return "/";
  }
  return path.slice(0, 500);
}
