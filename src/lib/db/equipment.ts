import { readCollection, upsertOne, patchOne } from "./store";
import { newId } from "../utils";
import { listUsers } from "./users";
import { listTickets } from "./tickets";
import type { Equipment, EquipmentSummary } from "../types";

const COLLECTION = "equipment";

async function seed(): Promise<Equipment[]> {
  const now = new Date();
  const iso = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * 86400000).toISOString();
  const dateOnly = (daysAgo: number) => iso(daysAgo).slice(0, 10);
  const users = await listUsers();
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

export async function listEquipment(): Promise<Equipment[]> {
  return readCollection<Equipment>(COLLECTION, seed);
}

export async function getEquipmentById(id: string): Promise<Equipment | null> {
  const all = await listEquipment();
  return all.find((e) => e.id === id) ?? null;
}

export async function createEquipment(
  input: Omit<Equipment, "id" | "created_at">
): Promise<Equipment> {
  const item: Equipment = { ...input, id: newId(), created_at: new Date().toISOString() };
  await upsertOne<Equipment>(COLLECTION, item, seed);
  return item;
}

export async function updateEquipment(
  id: string,
  patch: Partial<Equipment>
): Promise<Equipment | null> {
  return patchOne<Equipment>(COLLECTION, id, patch, seed);
}

/** เทียบเท่า view `equipment_summary` ของต้นแบบ — join ผู้ครอบครอง + นับจำนวนครั้งที่ส่งซ่อม */
export async function listEquipmentSummary(): Promise<EquipmentSummary[]> {
  const [users, tickets, equipment] = await Promise.all([
    listUsers(),
    listTickets(),
    listEquipment(),
  ]);
  return equipment.map((e) => {
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

export async function listCustodianRows(): Promise<EquipmentSummary[]> {
  const summary = await listEquipmentSummary();
  return summary.filter((e) => e.current_holder_id !== null);
}
