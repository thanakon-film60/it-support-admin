"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createEquipment } from "@/lib/db/equipment";
import { findOrCreateUserByName } from "@/lib/db/users";
import type { Equipment, EquipmentCategory, EquipmentStatus } from "@/lib/types";

export interface EquipmentFormState {
  error?: string;
  success?: boolean;
}

export async function createEquipmentAction(
  _prev: EquipmentFormState,
  formData: FormData
): Promise<EquipmentFormState> {
  await requireSession();

  const asset_code = String(formData.get("asset_code") ?? "").trim();
  if (!asset_code) {
    return { error: "กรุณากรอกรหัสทรัพย์สิน" };
  }

  const hasOwner = formData.get("has_owner") === "on";
  let current_holder_id: string | null = null;
  let current_holder_since: string | null = null;

  if (hasOwner) {
    const owner_name = String(formData.get("owner_name") ?? "").trim();
    if (!owner_name) {
      return { error: "กรุณากรอกชื่อผู้ครอบครอง" };
    }
    const user = findOrCreateUserByName({
      display_name: owner_name,
      employee_id: String(formData.get("owner_employee_id") ?? "").trim() || null,
      department: String(formData.get("owner_department") ?? "").trim() || null,
    });
    current_holder_id = user.id;
    current_holder_since = new Date().toISOString();
  }

  const priceRaw = String(formData.get("purchase_price") ?? "").trim();
  const priceNum = Number(priceRaw);

  const input: Omit<Equipment, "id" | "created_at"> = {
    asset_code,
    brand_model: String(formData.get("brand_model") ?? "").trim() || null,
    serial_number: String(formData.get("serial_number") ?? "").trim() || null,
    category: String(formData.get("category") ?? "other") as EquipmentCategory,
    status: String(formData.get("status") ?? "ว่าง") as EquipmentStatus,
    purchase_price: priceRaw && !Number.isNaN(priceNum) ? priceNum : null,
    install_location: String(formData.get("install_location") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
    purchase_date: String(formData.get("purchase_date") ?? "").trim() || null,
    warranty_expiry: String(formData.get("warranty_expiry") ?? "").trim() || null,
    current_holder_id,
    current_holder_since,
  };

  createEquipment(input);
  revalidatePath("/assets");
  revalidatePath("/custodian");
  revalidatePath("/");
  return { success: true };
}

export interface BulkImportState {
  error?: string;
  importedCount?: number;
  skippedCount?: number;
}

type ImportableEquipment = Omit<
  Equipment,
  "id" | "created_at" | "current_holder_id" | "current_holder_since"
>;

export async function bulkImportEquipmentAction(
  rows: ImportableEquipment[]
): Promise<BulkImportState> {
  await requireSession();
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.asset_code) {
      skipped++;
      continue;
    }
    createEquipment({
      ...row,
      current_holder_id: null,
      current_holder_since: null,
    });
    imported++;
  }

  revalidatePath("/assets");
  revalidatePath("/");
  return { importedCount: imported, skippedCount: skipped };
}
