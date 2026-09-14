"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  createStockItem,
  recordStockTransaction,
  updateSafetyStock,
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
