import { readCollection, writeCollection, upsertOne, patchOne } from "./store";
import { byNewestFirst } from "../sorting";
import { EQUIPMENT_CATEGORY_LABEL } from "../labels";
import { newId } from "../utils";
import { listUsers } from "./users";
import { listTickets } from "./tickets";
import type { Equipment, EquipmentCategory, EquipmentSummary } from "../types";

const COLLECTION = "equipment";

function seed(): Equipment[] {
  const now = new Date();
  const iso = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * 86400000).toISOString();
  const dateOnly = (daysAgo: number) => iso(daysAgo).slice(0, 10);
  const users = listUsers();
  const uid = (i: number) => users[i % users.length].id;

  const rows: Omit<Equipment, "id" | "created_at">[] = [
    { asset_code: "NB2501001", brand_model: "LENOVO ThinkPad E14", serial_number: "SN-A1001", category: "notebook", status: "ใช้งานอยู่", purchase_price: 24900, install_location: "สำนักงานใหญ่", notes: null, purchase_date: dateOnly(400), warranty_expiry: dateOnly(-330), current_holder_id: uid(0), current_holder_since: iso(400) },
    { asset_code: "NB2501002", brand_model: "DELL Latitude 5420", serial_number: "SN-A1002", category: "notebook", status: "ใช้งานอยู่", purchase_price: 26500, install_location: "สำนักงานใหญ่", notes: null, purchase_date: dateOnly(380), warranty_expiry: dateOnly(-350), current_holder_id: uid(1), current_holder_since: iso(380) },
    { asset_code: "NB2502003", brand_model: "LENOVO ThinkPad E14", serial_number: "SN-A1003", category: "notebook", status: "ว่าง", purchase_price: 24900, install_location: "คลัง IT", notes: "เพิ่งรับคืนจากพนักงานลาออก", purchase_date: dateOnly(200), warranty_expiry: dateOnly(-165), current_holder_id: null, current_holder_since: null },
    { asset_code: "NB2503004", brand_model: "HP ProBook 440", serial_number: "SN-A1004", category: "notebook", status: "ส่งซ่อม", purchase_price: 23000, install_location: "สำนักงานใหญ่", notes: "จอไม่ติด รอใบเสนอราคาซ่อม", purchase_date: dateOnly(300), warranty_expiry: dateOnly(-260), current_holder_id: uid(2), current_holder_since: iso(300) },
    { asset_code: "PC2501001", brand_model: "ACER Veriton", serial_number: "SN-B2001", category: "desktop", status: "ใช้งานอยู่", purchase_price: 18500, install_location: "แผนกบัญชี", notes: null, purchase_date: dateOnly(500), warranty_expiry: dateOnly(-135), current_holder_id: uid(3), current_holder_since: iso(500) },
    { asset_code: "PC2501002", brand_model: "ACER Veriton", serial_number: "SN-B2002", category: "desktop", status: "ว่าง", purchase_price: 18500, install_location: "คลัง IT", notes: null, purchase_date: dateOnly(500), warranty_expiry: dateOnly(-135), current_holder_id: null, current_holder_since: null },
    { asset_code: "PC2504003", brand_model: "DELL OptiPlex", serial_number: "SN-B2003", category: "desktop", status: "จองแล้ว", purchase_price: 19900, install_location: "คลัง IT", notes: "จองให้พนักงานใหม่แผนกขาย เริ่มงานสัปดาห์หน้า", purchase_date: dateOnly(60), warranty_expiry: dateOnly(-1035), current_holder_id: null, current_holder_since: null },
    { asset_code: "MN2501001", brand_model: "SAMSUNG 24\" F24T35", serial_number: "SN-C3001", category: "monitor", status: "ใช้งานอยู่", purchase_price: 3200, install_location: "แผนกบัญชี", notes: null, purchase_date: dateOnly(500), warranty_expiry: dateOnly(-135), current_holder_id: uid(3), current_holder_since: iso(500) },
    { asset_code: "MN2502002", brand_model: "SAMSUNG 24\" F24T35", serial_number: "SN-C3002", category: "monitor", status: "ว่าง", purchase_price: 3200, install_location: "คลัง IT", notes: null, purchase_date: dateOnly(120), warranty_expiry: dateOnly(245), current_holder_id: null, current_holder_since: null },
    { asset_code: "PR2501001", brand_model: "EPSON L3250", serial_number: "SN-D4001", category: "printer", status: "ใช้งานอยู่", purchase_price: 5900, install_location: "สำนักงานใหญ่ ชั้น 2", notes: null, purchase_date: dateOnly(260), warranty_expiry: dateOnly(-260), current_holder_id: null, current_holder_since: null },
    { asset_code: "PR2502002", brand_model: "HP LaserJet M15w", serial_number: "SN-D4002", category: "printer", status: "ส่งซ่อม", purchase_price: 4200, install_location: "สาขาเซ็นทรัล", notes: "ลูกกลิ้งดึงกระดาษเสีย", purchase_date: dateOnly(600), warranty_expiry: dateOnly(-235), current_holder_id: null, current_holder_since: null },
    { asset_code: "SC2501001", brand_model: "ZEBRA DS2208", serial_number: "SN-E5001", category: "scanner", status: "ใช้งานอยู่", purchase_price: 3800, install_location: "สาขาเซ็นทรัล", notes: null, purchase_date: dateOnly(300), warranty_expiry: dateOnly(65), current_holder_id: uid(8), current_holder_since: iso(300) },
    { asset_code: "SC2502002", brand_model: "ZEBRA DS2208", serial_number: "SN-E5002", category: "scanner", status: "ว่าง", purchase_price: 3800, install_location: "คลัง IT", notes: null, purchase_date: dateOnly(300), warranty_expiry: dateOnly(65), current_holder_id: null, current_holder_since: null },
    { asset_code: "RT2501001", brand_model: "TP-Link Archer C6", serial_number: "SN-F6001", category: "router", status: "ใช้งานอยู่", purchase_price: 1590, install_location: "สาขาเซ็นทรัล", notes: null, purchase_date: dateOnly(700), warranty_expiry: dateOnly(-335), current_holder_id: null, current_holder_since: null },
    { asset_code: "PH2501001", brand_model: "iPhone SE (บริษัท)", serial_number: "SN-G7001", category: "phone", status: "ใช้งานอยู่", purchase_price: 15900, install_location: "แผนกการตลาด", notes: "เบอร์สำหรับติดต่องานขาย", purchase_date: dateOnly(200), warranty_expiry: dateOnly(165), current_holder_id: uid(1), current_holder_since: iso(200) },
    { asset_code: "HS2501001", brand_model: "Logitech H390", serial_number: "SN-H8001", category: "headset", status: "ใช้งานอยู่", purchase_price: 890, install_location: "แผนก IT", notes: "ใช้รับสายซัพพอร์ต", purchase_date: dateOnly(150), warranty_expiry: dateOnly(215), current_holder_id: uid(6), current_holder_since: iso(150) },
    { asset_code: "KB2501001", brand_model: "Logitech K120", serial_number: null, category: "keyboard", status: "ว่าง", purchase_price: 290, install_location: "คลัง IT", notes: null, purchase_date: dateOnly(90), warranty_expiry: null, current_holder_id: null, current_holder_since: null },
    { asset_code: "MS2501001", brand_model: "Logitech M90", serial_number: null, category: "mouse", status: "ว่าง", purchase_price: 190, install_location: "คลัง IT", notes: null, purchase_date: dateOnly(90), warranty_expiry: null, current_holder_id: null, current_holder_since: null },
    { asset_code: "UPS2501001", brand_model: "APC BX650", serial_number: "SN-I9001", category: "ups", status: "ใช้งานอยู่", purchase_price: 2400, install_location: "ห้องเซิร์ฟเวอร์", notes: null, purchase_date: dateOnly(800), warranty_expiry: dateOnly(-435), current_holder_id: null, current_holder_since: null },
    { asset_code: "SRV2501001", brand_model: "Dell PowerEdge T150", serial_number: "SN-J1001", category: "server", status: "ใช้งานอยู่", purchase_price: 89000, install_location: "ห้องเซิร์ฟเวอร์", notes: "File server หลัก", purchase_date: dateOnly(900), warranty_expiry: dateOnly(-170), current_holder_id: null, current_holder_since: null },
    { asset_code: "TB2501001", brand_model: "iPad 9th Gen", serial_number: "SN-K2001", category: "tablet", status: "ใช้งานอยู่", purchase_price: 11900, install_location: "สาขาเซ็นทรัล", notes: "ใช้รับออเดอร์หน้าร้าน", purchase_date: dateOnly(250), warranty_expiry: dateOnly(115), current_holder_id: uid(8), current_holder_since: iso(250) },
    { asset_code: "PJ2501001", brand_model: "EPSON EB-X05", serial_number: "SN-L3001", category: "projector", status: "ว่าง", purchase_price: 15900, install_location: "ห้องประชุมใหญ่", notes: null, purchase_date: dateOnly(500), warranty_expiry: dateOnly(-135), current_holder_id: null, current_holder_since: null },
    { asset_code: "NB2504005", brand_model: "LENOVO ThinkPad E14", serial_number: "SN-A1005", category: "notebook", status: "เลิกใช้งาน", purchase_price: 22900, install_location: "คลัง IT", notes: "เครื่องเก่า จอแตก ตัดจำหน่ายแล้ว", purchase_date: dateOnly(1400), warranty_expiry: dateOnly(-1035), current_holder_id: null, current_holder_since: null },
    { asset_code: "PC2505004", brand_model: "ACER Veriton", serial_number: "SN-B2004", category: "desktop", status: "ใช้งานอยู่", purchase_price: 18500, install_location: "แผนกจัดซื้อ", notes: null, purchase_date: dateOnly(500), warranty_expiry: dateOnly(-135), current_holder_id: uid(8), current_holder_since: iso(500) },
  ];

  return rows.map((r) => ({ ...r, id: newId(), created_at: iso(0) }));
}

export function listEquipment(): Equipment[] {
  // เรียงใหม่→เก่าเหมือน listTickets ด้วยเหตุผลเดียวกัน — ทรัพย์สินที่เพิ่งเพิ่ม
  // (ทั้งจากฟอร์มและจาก Import Excel) เคยไปต่อท้ายจนมองไม่เห็นว่าเข้าระบบแล้ว
  return byNewestFirst(readCollection<Equipment>(COLLECTION, seed), "created_at");
}

/** normalize รหัสทรัพย์สินให้เทียบกันได้ เช่น "nb-001", "NB 001", "NB001" -> "NB001"
 *  (คนพิมพ์ใน LINE มักใส่ขีด/เว้นวรรค/พิมพ์เล็ก ไม่ตรงกับที่เก็บใน DB เป๊ะๆ) */
function normalizeAssetCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/** ค้นทรัพย์สินจากรหัสที่ผู้ใช้พิมพ์เข้ามา — ยอมรับรูปแบบที่ไม่เป๊ะได้ระดับหนึ่ง
 *  ลำดับการค้น: ตรงเป๊ะ -> ลงท้ายด้วย -> มีคำนี้อยู่ข้างใน (กันเคสพิมพ์ย่อ เช่น NB-001) */
export function getEquipmentByAssetCode(input: string): Equipment | null {
  return findEquipmentByAssetCode(input)[0] ?? null;
}

/** ค้นทรัพย์สินจากรหัส แล้วคืน "ทุกเครื่องที่ตรง" ไม่ใช่เครื่องแรกเครื่องเดียว
 *
 *  ทำไมต้องมีฟังก์ชันนี้: ข้อมูลจริงในระบบมี 28 แถวที่ใช้รหัสซ้ำกับเครื่องอื่น
 *  (เช่น PC2306001 ถูกใช้กับ 4 เครื่องคนละสาขา — ดู db/imports/equipment-import-conflicts.csv)
 *  ของเดิมคืนแค่ `.find()` ตัวแรก แปลว่าเวลาผู้ใช้พิมพ์รหัสที่ซ้ำ บอทจะผูก ticket เข้ากับเครื่องแรก
 *  ที่บังเอิญอยู่ในไฟล์ **เงียบๆ โดยไม่มีใครรู้ว่าเลือกผิด** — ช่างอาจไปผิดสาขา
 *
 *  วิธีที่ถูกคือคืนทุกตัวแล้วให้คนเลือก ส่วนการแก้รหัสซ้ำที่ต้นทางยังต้องทำอยู่ดี
 *  แต่ระหว่างที่ยังไม่ได้แก้ ระบบต้องไม่เดาแทนผู้ใช้
 *
 *  ลำดับผลลัพธ์: ตรงเป๊ะก่อน -> ลงท้ายด้วย -> มีคำนี้อยู่ข้างใน (กันเคสพิมพ์ย่อ เช่น NB-001)
 *  โดยแต่ละเครื่องจะปรากฏครั้งเดียวเท่านั้น
 */
export function findEquipmentByAssetCode(input: string): Equipment[] {
  const needle = normalizeAssetCode(input);
  if (!needle) return [];
  const all = listEquipment();

  const exact = all.filter((e) => normalizeAssetCode(e.asset_code) === needle);
  // เจอแบบตรงเป๊ะแล้วไม่ต้องค้นแบบหลวมต่อ — ไม่งั้นพิมพ์ "PC2306001" เป๊ะๆ
  // จะพ่วงเครื่องที่รหัสแค่ "มีคำนี้อยู่ข้างใน" มาให้เลือกด้วย ซึ่งไม่ใช่สิ่งที่ผู้ใช้หมายถึง
  if (exact.length > 0) return exact;

  const endsWith = all.filter((e) => normalizeAssetCode(e.asset_code).endsWith(needle));
  if (endsWith.length > 0) return endsWith;

  return all.filter((e) => normalizeAssetCode(e.asset_code).includes(needle));
}

export function getEquipmentById(id: string): Equipment | null {
  return listEquipment().find((e) => e.id === id) ?? null;
}

export function createEquipment(
  input: Omit<Equipment, "id" | "created_at">
): Equipment {
  const item: Equipment = { ...input, id: newId(), created_at: new Date().toISOString() };
  upsertOne<Equipment>(COLLECTION, item, seed);
  return item;
}

export function updateEquipment(
  id: string,
  patch: Partial<Equipment>
): Equipment | null {
  return patchOne<Equipment>(COLLECTION, id, patch, seed);
}

/** ลบถาวร — ผู้เรียกต้องตรวจเองก่อนว่าไม่มี ticket ผูกอยู่ (ดู deleteEquipmentAction)
 *  คืน false เมื่อไม่พบ id นั้น เพื่อให้แยกออกจากกรณีลบสำเร็จได้ */
export function removeEquipment(id: string): boolean {
  const all = readCollection<Equipment>(COLLECTION, seed);
  const next = all.filter((e) => e.id !== id);
  if (next.length === all.length) return false;
  writeCollection(COLLECTION, next);
  return true;
}

/** เทียบเท่า view `equipment_summary` ของต้นแบบ — join ผู้ครอบครอง + นับจำนวนครั้งที่ส่งซ่อม */
export function listEquipmentSummary(): EquipmentSummary[] {
  const users = listUsers();
  const tickets = listTickets();
  return listEquipment().map((e) => {
    const owner = e.current_holder_id
      ? users.find((u) => u.id === e.current_holder_id) ?? null
      : null;
    const repairCount = tickets.filter(
      (t) => t.type === "repair" && t.equipment_id === e.id
    ).length;
    return {
      ...e,
      owner_name: owner?.display_name ?? null,
      owner_department: owner?.department ?? null,
      repair_count: repairCount,
    };
  });
}

/** ตัวเลือกหนึ่งอันในเมนูเลือกทรัพย์สินของบอท LINE */
export interface AssetOption {
  /** ค่าที่ส่งกลับมาตอนผู้ใช้กด */
  value: string;
  label: string;
  /** บรรทัดรองใต้ label เช่น ยี่ห้อ/ที่ติดตั้ง ใช้แยกของที่ชื่อซ้ำกัน */
  sub: string | null;
  count: number;
}

/** ตัวเลือกสำหรับเมนูเลือกทรัพย์สินทีละชั้น: ประเภท → ยี่ห้อ/รุ่น → รหัส
 *
 *  ทำไมต้องไล่ทีละชั้น: แชท LINE ไม่มี dropdown จริงให้ใช้ (ไม่มี <select>)
 *  quick reply ใส่ได้สูงสุด 13 ปุ่ม ส่วน carousel ใส่ได้ 12 ใบ แต่ข้อมูลจริงมีทรัพย์สิน 200+ ชิ้น
 *  การไล่กรองทีละชั้นจึงเป็นวิธีเดียวที่ทำให้เลือกของจาก 200+ ชิ้นได้จบในไม่กี่ปุ่ม
 *  โดยไม่ต้องให้ผู้ใช้จำรหัสเอง — ซึ่งเป็นจุดที่คนเลิกใช้บอทมากที่สุด
 *
 *  จงใจ "ไม่" กรองตามสาขาที่เลือกไว้ตอนต้น เพราะ install_location ในข้อมูลจริงปนกัน
 *  ทั้งชื่อสาขา ("สาขาเซ็นทรัล") และชื่อแผนก/ห้อง ("แผนกบัญชี", "คลัง IT")
 *  ถ้ากรองด้วยจะซ่อนของที่ควรเห็นโดยผู้ใช้ไม่รู้ตัว — แสดงที่ติดตั้งไว้ในบรรทัดรองแทน
 */
export function listAssetFilterOptions(input: {
  level: "category" | "brand" | "code";
  category?: string | null;
  brand?: string | null;
}): { options: AssetOption[]; total: number } {
  const { level, category, brand } = input;

  let rows = listEquipment();
  if (level !== "category" && category) {
    rows = rows.filter((e) => e.category === category);
  }
  if (level === "code" && brand) {
    rows = rows.filter((e) => (e.brand_model?.trim() || NO_BRAND) === brand);
  }

  if (level === "category") return { options: groupCategories(rows), total: rows.length };
  if (level === "brand") return { options: groupBrands(rows), total: rows.length };
  return { options: listCodes(rows), total: rows.length };
}

const NO_BRAND = "ไม่ระบุยี่ห้อ";

function groupCategories(rows: Equipment[]): AssetOption[] {
  const counts = new Map<string, number>();
  for (const e of rows) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({
      value,
      label: EQUIPMENT_CATEGORY_LABEL[value as EquipmentCategory] ?? value,
      sub: null,
      count,
    }))
    // เรียงตามจำนวนมากไปน้อย ของที่คนแจ้งบ่อยสุดจะอยู่บนสุดโดยไม่ต้อง hardcode ลำดับ
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th"));
}

function groupBrands(rows: Equipment[]): AssetOption[] {
  const counts = new Map<string, number>();
  for (const e of rows) {
    const key = e.brand_model?.trim() || NO_BRAND;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: value, sub: null, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th"));
}

function listCodes(rows: Equipment[]): AssetOption[] {
  const users = listUsers();
  return rows
    .map((e) => {
      const holder = e.current_holder_id
        ? users.find((u) => u.id === e.current_holder_id)?.display_name ?? null
        : null;
      // บรรทัดรองสำคัญมากกับข้อมูลชุดนี้ เพราะรหัสทรัพย์สินซ้ำกันอยู่ 28 แถว
      // ถ้าโชว์แต่รหัส ผู้ใช้จะเลือกเครื่องผิดสาขาโดยไม่มีทางรู้เลย
      const parts = [e.brand_model?.trim(), e.install_location?.trim(), holder].filter(Boolean);
      return {
        value: e.asset_code,
        label: e.asset_code,
        sub: parts.length ? parts.join(" · ") : null,
        count: 1,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "th", { numeric: true }));
}

export function listCustodianRows(): EquipmentSummary[] {
  return listEquipmentSummary().filter((e) => e.current_holder_id !== null);
}
