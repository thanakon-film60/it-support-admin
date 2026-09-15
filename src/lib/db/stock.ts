import { readCollection, upsertOne, patchOne } from "./store";
import { newId } from "../utils";
import type { StockItem, StockTransaction, StockItemWithComputed, StockTxnType } from "../types";

const ITEMS_COLLECTION = "stock_items";
const TXN_COLLECTION = "stock_transactions";

function seedItems(): StockItem[] {
  const now = new Date().toISOString();
  const rows: Omit<StockItem, "id" | "created_at">[] = [
    { name: "ROUTER (เราเตอร์)", category: "hardware", unit: "ชิ้น", location: "IT", quantity_available: 7, safety_stock: 5 },
    { name: "USB Hub", category: "hardware", unit: "ชิ้น", location: "IT", quantity_available: 9, safety_stock: 5 },
    { name: "USB Type C", category: "อุปกรณ์ต่อพ่วง", unit: "ชิ้น", location: "IT", quantity_available: 12, safety_stock: 10 },
    { name: "กล้องวงจรปิด", category: "hardware", unit: "ชิ้น", location: "IT", quantity_available: 6, safety_stock: 5 },
    { name: "ขาตั้ง Tablet", category: "อุปกรณ์ต่อพ่วง", unit: "ชิ้น", location: "IT", quantity_available: 5, safety_stock: 5 },
    { name: "คีย์บอร์ด", category: "hardware", unit: "ชิ้น", location: "IT", quantity_available: 4, safety_stock: 5 },
    { name: "เมาส์", category: "อุปกรณ์ต่อพ่วง", unit: "ชิ้น", location: "IT", quantity_available: 6, safety_stock: 5 },
    { name: "เมาส์มีสาย", category: "อุปกรณ์ต่อพ่วง", unit: "ชิ้น", location: "IT", quantity_available: 4, safety_stock: 5 },
    { name: "เครื่องสำรองไฟ", category: "hardware", unit: "ชิ้น", location: "IT", quantity_available: 2, safety_stock: 5 },
    { name: "สมุดเคลมสินค้า", category: "อื่นๆ", unit: "เล่ม", location: "สำนักงานใหญ่", quantity_available: 2, safety_stock: 10 },
    { name: "หมึกเครื่อง M3870FW", category: "หมึกปริ้นเตอร์", unit: "ชิ้น", location: "IT", quantity_available: 1, safety_stock: 2 },
  ];
  return rows.map((r) => ({ ...r, id: newId(), created_at: now }));
}

function seedTxns(): StockTransaction[] {
  return [];
}

export function listStockItems(): StockItem[] {
  return readCollection<StockItem>(ITEMS_COLLECTION, seedItems);
}

export function getStockItemById(id: string): StockItem | null {
  return listStockItems().find((s) => s.id === id) ?? null;
}

export function computeStockStatus(item: StockItem): StockItemWithComputed["stock_status"] {
  if (item.quantity_available < item.safety_stock) return "ต่ำกว่า";
  if (item.quantity_available === item.safety_stock) return "ถึงขั้นต่ำ";
  return "ปกติ";
}

export function listStockItemsWithStatus(): StockItemWithComputed[] {
  return listStockItems()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "th"))
    .map((item) => ({ ...item, stock_status: computeStockStatus(item) }));
}

export function createStockItem(
  input: Omit<StockItem, "id" | "created_at">
): StockItem {
  const item: StockItem = { ...input, id: newId(), created_at: new Date().toISOString() };
  upsertOne<StockItem>(ITEMS_COLLECTION, item, seedItems);
  return item;
}

export function listStockTransactions(): (StockTransaction & {
  item_name: string;
  item_unit: string;
})[] {
  const items = listStockItems();
  const txns = readCollection<StockTransaction>(TXN_COLLECTION, seedTxns);
  return txns
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((t) => {
      const item = items.find((i) => i.id === t.stock_item_id);
      return { ...t, item_name: item?.name ?? "-", item_unit: item?.unit ?? "" };
    });
}

/** บันทึก transaction + ปรับยอดคงเหลือของ stock_items ให้ atomically ในฟังก์ชันเดียว
 *  (ใน Supabase จริง ส่วนนี้ควรทำเป็น Postgres function/transaction ฝั่ง DB — ดู PROJECT.md) */
export function recordStockTransaction(input: {
  stock_item_id: string;
  type: StockTxnType;
  quantity: number;
  staff_name?: string | null;
  reference_no?: string | null;
  note?: string | null;
}): StockTransaction {
  const txn: StockTransaction = {
    id: newId(),
    stock_item_id: input.stock_item_id,
    type: input.type,
    quantity: input.quantity,
    staff_name: input.staff_name ?? null,
    reference_no: input.reference_no ?? null,
    note: input.note ?? null,
    created_at: new Date().toISOString(),
  };
  const txns = readCollection<StockTransaction>(TXN_COLLECTION, seedTxns);
  txns.push(txn);
  upsertOne<StockTransaction>(TXN_COLLECTION, txn, seedTxns);

  const item = getStockItemById(input.stock_item_id);
  if (item) {
    const delta = input.type === "out" ? -Math.abs(input.quantity) : Math.abs(input.quantity);
    const nextQty = input.type === "adjust" ? input.quantity : item.quantity_available + delta;
    patchOne<StockItem>(ITEMS_COLLECTION, item.id, { quantity_available: Math.max(0, nextQty) }, seedItems);
  }
  return txn;
}

export function updateSafetyStock(id: string, safetyStock: number): StockItem | null {
  return patchOne<StockItem>(ITEMS_COLLECTION, id, { safety_stock: safetyStock }, seedItems);
}

/** หักสต็อกอัตโนมัติเมื่อ ticket ประเภท "เบิกอุปกรณ์" ถูกปิดงาน — ผูก business logic ไว้จุดเดียว
 *  ตามข้อสังเกตในผลวิเคราะห์ (ของต้นแบบดูเหมือนคำนวณฝั่ง client ซึ่งเสี่ยงข้อมูลไม่ตรงกัน) */
export function deductStockForWithdrawTicket(
  items: { name: string; qty: number }[],
  staffName: string,
  referenceNo?: string
) {
  const stockItems = listStockItems();
  items.forEach(({ name, qty }) => {
    const match = stockItems.find((s) => s.name === name);
    if (match) {
      recordStockTransaction({
        stock_item_id: match.id,
        type: "out",
        quantity: qty,
        staff_name: staffName,
        reference_no: referenceNo,
        note: "หักสต็อกอัตโนมัติจาก ticket เบิกอุปกรณ์",
      });
    }
  });
}
