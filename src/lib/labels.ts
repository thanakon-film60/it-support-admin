// Label ภาษาไทยที่ใช้ร่วมกันหลายหน้า (เก็บรวมไว้ที่เดียวกันเลี่ยงการพิมพ์ซ้ำ)
import type { EquipmentCategory, TicketType, FaqCategory, StockTxnType } from "./types";

export const TICKET_TYPE_LABEL: Record<TicketType, string> = {
  repair: "แจ้งซ่อม",
  withdraw: "เบิกอุปกรณ์",
  return: "คืนอุปกรณ์",
  it_service: "บริการ IT",
};

export const EQUIPMENT_CATEGORY_LABEL: Record<EquipmentCategory, string> = {
  notebook: "โน้ตบุ๊ค",
  desktop: "คอมพิวเตอร์ตั้งโต๊ะ",
  monitor: "จอมอนิเตอร์",
  mouse: "เมาส์",
  keyboard: "คีย์บอร์ด",
  phone: "โทรศัพท์",
  headset: "หูฟัง",
  printer: "เครื่องพิมพ์",
  scanner: "เครื่องสแกน",
  router: "เราเตอร์",
  projector: "โปรเจคเตอร์",
  ups: "เครื่องสำรองไฟ",
  server: "เซิร์ฟเวอร์",
  tablet: "แท็บเล็ต",
  other: "อื่นๆ",
};

export const FAQ_CATEGORY_LABEL: Record<FaqCategory, string> = {
  general: "ทั่วไป",
  hardware: "ฮาร์ดแวร์",
  software: "ซอฟต์แวร์",
  network: "เครือข่าย",
  printer: "เครื่องพิมพ์",
  account: "บัญชีผู้ใช้",
};

export const STOCK_TXN_TYPE_LABEL: Record<StockTxnType, string> = {
  in: "รับเข้า",
  adjust: "ปรับปรุงยอด",
  out: "เบิกออก",
};
