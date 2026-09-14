import { readCollection, upsertOne, deleteOne } from "./store";
import { newId } from "../utils";
import type { FaqItem, FaqCategory } from "../types";

const COLLECTION = "faq_items";

function seed(): FaqItem[] {
  const now = new Date().toISOString();
  const rows: Omit<FaqItem, "id" | "created_at">[] = [
    {
      title: "โปรแกรมขายหน้าร้านเข้าใช้งานไม่ได้",
      keywords: ["โปรแกรมขายเข้าไม่ได้", "หน้าร้านค้าง", "ยอดขายดูไม่ได้"],
      content: "1. เช็คสายแลนที่เสียบด้านหลังเครื่องว่าหลุดหรือไม่\n2. ลองปิดเปิดเครื่องใหม่\n3. ถ้ายังแก้ไม่ได้ แจ้งทาง IT เข้าไปตรวจสอบ",
      category: "software",
      image_urls: [],
    },
    {
      title: "ไม่สามารถเข้า LINE ได้",
      keywords: ["เข้าไลน์ไม่ได้", "line ค้าง"],
      content: "1. ปิดเปิด LINE ใหม่อีกครั้ง\n2. ลองเช็คอินเทอร์เน็ตว่าเครื่องอื่นใช้งานได้ไหม\n3. ลองรีสตาร์ทเครื่องคอมพิวเตอร์ใหม่\n4. ถ้ายังไม่สามารถใช้ได้รบกวนแจ้งทาง IT อีกครั้ง",
      category: "network",
      image_urls: [],
    },
    {
      title: "ปริ้นเอกสารไม่ได้",
      keywords: ["ปริ้นเอกสารไม่ออก", "ปริ้นไม่ออก", "ปริ้นไม่ได้"],
      content: "1. เช็คอินเตอร์เน็ตเนื่องจากใช้กับที่ทาง IT เคยแจ้ง\n2. ลองรีสตาร์ทเครื่องคอมพิวเตอร์ใหม่\n3. แจ้งกับทาง IT ให้เข้ามาตรวจสอบ",
      category: "printer",
      image_urls: [],
    },
    {
      title: "กล้องหน้าสาขาไม่สามารถดูได้",
      keywords: ["ดูกล้องไม่ได้", "กล้องไม่ติด", "ดูกล้องหน้าสาขาไม่ได้"],
      content: "1. ให้หน้าสาขาเช็คว่ากล้องทำงานอยู่จริงไหม\n2. ถ้าดูผ่านแอปพลิเคชัน ลองปิดแอปแล้วเปิดใหม่อีกครั้ง\n3. ถ้าหากยังไม่สามารถดูได้แจ้ง IT เพื่อเข้าตรวจสอบเพิ่มเติม",
      category: "hardware",
      image_urls: [],
    },
    {
      title: "ลืมรหัสผ่าน",
      keywords: ["ลืมรหัสผ่าน", "เข้าระบบไม่ได้", "รหัสผ่านผิด"],
      content: "1. ลองพิมพ์รหัสผ่านช้าๆ ตรวจสอบ Caps Lock\n2. ถ้ายังเข้าไม่ได้ แจ้งชื่อ-รหัสพนักงานให้ทาง IT เพื่อรีเซ็ตรหัสผ่านให้",
      category: "account",
      image_urls: [],
    },
    {
      title: "คอมพิวเตอร์ค้าง หน้าจอไม่ตอบสนอง",
      keywords: ["คอมค้าง", "freeze", "หน้าจอค้าง"],
      content: "1. รอสัก 1-2 นาทีก่อน เผื่อเครื่องกำลังประมวลผล\n2. ถ้ายังไม่ตอบสนอง กดปุ่ม power ค้างไว้ 5 วินาทีเพื่อบังคับปิดเครื่อง แล้วเปิดใหม่\n3. ถ้าเกิดขึ้นบ่อย แจ้ง IT เพื่อตรวจเครื่อง",
      category: "hardware",
      image_urls: [],
    },
    {
      title: "Wifi หลุดบ่อย สัญญาณอ่อน",
      keywords: ["wifi หลุด", "เน็ตหลุด", "สัญญาณอ่อน"],
      content: "1. ลองขยับตำแหน่งใกล้เราเตอร์มากขึ้น\n2. ปิดเปิด Wifi บนอุปกรณ์ใหม่\n3. ถ้ายังหลุดบ่อย แจ้ง IT เพื่อตรวจสอบเราเตอร์/สัญญาณที่สาขา",
      category: "network",
      image_urls: [],
    },
    {
      title: "ไม่สามารถส่งอีเมลได้",
      keywords: ["ส่งอีเมลไม่ได้", "อีเมลค้าง", "ส่งเมลไม่ออก"],
      content: "1. ตรวจสอบว่าพิมพ์อีเมลผู้รับถูกต้องหรือไม่\n2. ตรวจสอบขนาดไฟล์แนบว่าเกิน 20MB หรือไม่\n3. ถ้ายังส่งไม่ได้ แจ้ง IT พร้อมข้อความ error ที่ขึ้น",
      category: "software",
      image_urls: [],
    },
    {
      title: "เครื่องพิมพ์บาร์โค้ด/สแกนเนอร์ไม่ทำงาน",
      keywords: ["สแกนบาร์โค้ดไม่ได้", "เครื่องสแกนไม่ทำงาน"],
      content: "1. ตรวจสอบสาย USB ว่าเสียบแน่นดีหรือไม่\n2. ลองเสียบพอร์ต USB อื่น\n3. ถ้ายังไม่ทำงาน แจ้ง IT เพื่อเปลี่ยนสาย/เครื่องสำรอง",
      category: "hardware",
      image_urls: [],
    },
  ];
  return rows.map((r) => ({ ...r, id: newId(), created_at: now }));
}

export async function listFaqItems(): Promise<FaqItem[]> {
  const all = await readCollection<FaqItem>(COLLECTION, seed);
  return all.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function createFaqItem(
  input: Omit<FaqItem, "id" | "created_at">
): Promise<FaqItem> {
  const item: FaqItem = { ...input, id: newId(), created_at: new Date().toISOString() };
  await upsertOne<FaqItem>(COLLECTION, item, seed);
  return item;
}

export async function deleteFaqItem(id: string): Promise<void> {
  await deleteOne(COLLECTION, id);
}

/** จับคู่ FAQ จาก keyword แบบง่าย ๆ ให้ LINE bot แนะนำก่อนสร้าง ticket จริง */
export async function matchFaqByKeyword(userMessage: string): Promise<FaqItem[]> {
  const normalized = userMessage.toLowerCase().trim();
  if (!normalized) return [];
  const all = await listFaqItems();
  return all
    .filter((faq) =>
      faq.keywords.some((k) => normalized.includes(k.toLowerCase()) || k.toLowerCase().includes(normalized))
    )
    .slice(0, 3);
}

export function faqCategories(): FaqCategory[] {
  return ["general", "hardware", "software", "network", "printer", "account"];
}
