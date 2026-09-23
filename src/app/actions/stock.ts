"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  createStockItem,
  getStockItemById,
  listStockTransactions,
  recordStockTransaction,
  removeStockItem,
  updateSafetyStock,
  updateStockItem,
} from "@/lib/db/stock";
import type { StockItem } from "@/lib/types";

export interface StockFormState {
  error?: string;
  success?: boolean;
}

export async function createStockItemAction(
  _prev: StockFormState,
  formData: FormData
): Promise<StockFormState> {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "กรุณากรอกชื่อรายการ" };

  const qty = Number(formData.get("quantity_available") ?? 0);
  const safety = Number(formData.get("safety_stock") ?? 0);

  const input: Omit<StockItem, "id" | "created_at"> = {
    name,
    category: String(formData.get("category") ?? "").trim() || null,
    unit: String(formData.get("unit") ?? "ชิ้น").trim() || "ชิ้น",
    location: String(formData.get("location") ?? "").trim() || null,
    quantity_available: Number.isFinite(qty) ? Math.max(0, qty) : 0,
    safety_stock: Number.isFinite(safety) ? Math.max(0, safety) : 0,
  };

  createStockItem(input);
  revalidatePath("/stock");
  revalidatePath("/");
  return { success: true };
}

export async function updateStockItemAction(
  id: string,
  _prev: StockFormState,
  formData: FormData
): Promise<StockFormState> {
  await requireSession();

  const existing = getStockItemById(id);
  if (!existing) return { error: "ไม่พบรายการนี้" };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "กรุณากรอกชื่อรายการ" };

  const safety = Number(formData.get("safety_stock") ?? existing.safety_stock);

  // จำนวนคงเหลือแก้ที่นี่ไม่ได้โดยตั้งใจ — ต้องผ่านปุ่ม "รับเข้า / ปรับยอด" ที่บันทึกประวัติให้
  updateStockItem(id, {
    name,
    category: String(formData.get("category") ?? "").trim() || null,
    unit: String(formData.get("unit") ?? "ชิ้น").trim() || "ชิ้น",
    location: String(formData.get("location") ?? "").trim() || null,
    safety_stock: Number.isFinite(safety) ? Math.max(0, safety) : existing.safety_stock,
  });

  revalidatePath("/stock");
  revalidatePath("/");
  return { success: true };
}

/** ลบรายการสต็อก — อนุญาตเฉพาะรายการที่ยังไม่เคยมีการเคลื่อนไหว
 *
 *  ถ้ามี transaction แล้วลบทิ้ง หน้าประวัติ transaction จะมีแถวที่บอกไม่ได้ว่าของชิ้นไหน
 *  และยอดรับเข้า/จ่ายออกย้อนหลังจะกระทบกันทั้งชุด */
export async function deleteStockItemAction(id: string): Promise<StockFormState> {
  await requireSession();

  const existing = getStockItemById(id);
  if (!existing) return { error: "ไม่พบรายการนี้" };

  const used = listStockTransactions().filter((t) => t.stock_item_id === id).length;
  if (used > 0) {
    return { error: `ลบไม่ได้ — รายการนี้มีประวัติการเคลื่อนไหว ${used} รายการ` };
  }

  if (!removeStockItem(id)) return { error: "ลบไม่สำเร็จ" };
  revalidatePath("/stock");
  revalidatePath("/");
  return { success: true };
}

export async function stockInAction(
  itemId: string,
  quantity: number,
  referenceNo: string,
  note: string,
  staffName: string
) {
  await requireSession();
  recordStockTransaction({
    stock_item_id: itemId,
    type: "in",
    quantity,
    staff_name: staffName || null,
    reference_no: referenceNo || null,
    note: note || null,
  });
  revalidatePath("/stock");
  revalidatePath("/stock/transactions");
  revalidatePath("/");
}

export async function adjustStockQuantityAction(
  itemId: string,
  newQuantity: number,
  note: string,
  staffName: string
) {
  await requireSession();
  recordStockTransaction({
    stock_item_id: itemId,
    type: "adjust",
    quantity: newQuantity,
    staff_name: staffName || null,
    note: note || null,
  });
  revalidatePath("/stock");
  revalidatePath("/stock/transactions");
  revalidatePath("/");
}

export async function updateSafetyStockAction(itemId: string, safetyStock: number) {
  await requireSession();
  updateSafetyStock(itemId, safetyStock);
  revalidatePath("/stock");
  revalidatePath("/");
}
