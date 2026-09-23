"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  createEquipment,
  getEquipmentById,
  listEquipment,
  removeEquipment,
  updateEquipment,
} from "@/lib/db/equipment";
import { listTickets } from "@/lib/db/tickets";
import { findOrCreateUserByName, getUserById, updateUserProfile } from "@/lib/db/users";
import { dayKeyTH } from "@/lib/date-th";
import type { Equipment, EquipmentCategory, EquipmentStatus } from "@/lib/types";

export interface EquipmentFormState {
  error?: string;
  success?: boolean;
}

/** หน้าที่ต้อง revalidate เมื่อข้อมูลทรัพย์สินเปลี่ยน */
const AFFECTED = ["/assets", "/custodian", "/repair-history", "/"];

function revalidateAll() {
  for (const path of AFFECTED) revalidatePath(path);
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
  revalidateAll();
  return { success: true };
}

export async function updateEquipmentAction(
  id: string,
  _prev: EquipmentFormState,
  formData: FormData
): Promise<EquipmentFormState> {
  await requireSession();

  const existing = getEquipmentById(id);
  if (!existing) return { error: "ไม่พบทรัพย์สินชิ้นนี้" };

  const asset_code = String(formData.get("asset_code") ?? "").trim();
  if (!asset_code) return { error: "กรุณากรอกรหัสทรัพย์สิน" };

  // เตือนตอนแก้รหัสไปชนกับเครื่องอื่น — ข้อมูลจริงมีรหัสซ้ำอยู่ 28 แถวซึ่งเป็นปัญหาที่รู้กันอยู่แล้ว
  // จึงไม่ปิดตายไม่ให้บันทึก (ของเดิมก็ซ้ำอยู่) แต่ต้องไม่ปล่อยให้สร้างความซ้ำ "ใหม่" โดยไม่รู้ตัว
  const clash = listEquipment().filter(
    (e) => e.id !== id && e.asset_code.trim().toUpperCase() === asset_code.toUpperCase()
  );
  if (clash.length > 0 && asset_code.toUpperCase() !== existing.asset_code.trim().toUpperCase()) {
    return { error: `รหัส ${asset_code} ถูกใช้กับทรัพย์สินอื่นอยู่แล้ว (${clash.length} ชิ้น)` };
  }

  const hasOwner = formData.get("has_owner") === "on";
  let current_holder_id: string | null = null;
  let current_holder_since: string | null = null;

  if (hasOwner) {
    const owner_name = String(formData.get("owner_name") ?? "").trim();
    if (!owner_name) return { error: "กรุณากรอกชื่อผู้ครอบครอง" };
    const user = findOrCreateUserByName({
      display_name: owner_name,
      employee_id: String(formData.get("owner_employee_id") ?? "").trim() || null,
      department: String(formData.get("owner_department") ?? "").trim() || null,
    });
    current_holder_id = user.id;
    // เปลี่ยนมือเมื่อไหร่ถึงนับวันใหม่ — ถ้าคนเดิมยังถืออยู่ต้องคงวันที่รับไปเดิมไว้
    // ไม่งั้นแค่แก้ตัวสะกดชื่อรุ่นก็ทำให้ "ถือมานานเท่าไหร่" รีเซ็ตเป็น 0 วันทันที
    current_holder_since =
      existing.current_holder_id === user.id
        ? existing.current_holder_since
        : new Date().toISOString();
  }

  const priceRaw = String(formData.get("purchase_price") ?? "").trim();
  const priceNum = Number(priceRaw);

  updateEquipment(id, {
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
  });

  revalidateAll();
  return { success: true };
}

/** ลบทรัพย์สิน — อนุญาตเฉพาะชิ้นที่ยังไม่มี ticket ผูกอยู่
 *
 *  ถ้าเคยมีเรื่องแจ้งซ่อม/เบิก/คืน แล้วลบทิ้ง ประวัติซ่อมจะชี้ไปยังทรัพย์สินที่ไม่มีข้อมูล
 *  อีกต่อไป — ตารางประวัติจะมีแถวที่บอกไม่ได้ว่าซ่อมเครื่องไหน ซึ่งกู้คืนไม่ได้เลย
 *  กรณีนั้นให้เปลี่ยนสถานะเป็น "เลิกใช้งาน" แทน ของยังอยู่ในระบบแต่ไม่ถูกหยิบมาใช้ */
export async function deleteEquipmentAction(id: string): Promise<EquipmentFormState> {
  await requireSession();

  const existing = getEquipmentById(id);
  if (!existing) return { error: "ไม่พบทรัพย์สินชิ้นนี้" };

  const used = listTickets().filter((t) => t.equipment_id === id).length;
  if (used > 0) {
    return {
      error: `ลบไม่ได้ — มี ${used} เรื่องที่ผูกกับทรัพย์สินชิ้นนี้อยู่ (ใช้สถานะ "เลิกใช้งาน" แทน)`,
    };
  }

  if (!removeEquipment(id)) return { error: "ลบไม่สำเร็จ" };
  revalidateAll();
  return { success: true };
}

/* ─────────────────────────────────────────────────────────────────────────────
   แก้ไข "ผู้ครอบครอง" จากหน้า /custodian

   แยกจาก updateEquipmentAction ทั้งที่เขียนลงตารางเดียวกัน เพราะสิ่งที่หน้านี้ทำคือ
   "เครื่องนี้อยู่กับใคร" ไม่ใช่ "เครื่องนี้คืออะไร" — ถ้าใช้ action เดียวกัน ฟอร์มจะต้องส่ง
   รหัสทรัพย์สิน/ยี่ห้อ/ราคา/ประกันมาด้วยทุกครั้ง แล้วการพลาดส่งฟิลด์ใดฟิลด์หนึ่งจะกลายเป็น
   การล้างข้อมูลนั้นทิ้งเงียบๆ (ค่าที่ไม่ได้ส่ง = null ในโค้ดข้างบน) ซึ่งกู้คืนไม่ได้
   action นี้แตะเฉพาะ 3 ฟิลด์: current_holder_id, current_holder_since, status
   ───────────────────────────────────────────────────────────────────────────── */
export async function updateCustodianAction(
  id: string,
  _prev: EquipmentFormState,
  formData: FormData
): Promise<EquipmentFormState> {
  await requireSession();

  const existing = getEquipmentById(id);
  if (!existing) return { error: "ไม่พบทรัพย์สินชิ้นนี้" };

  const status = String(formData.get("status") ?? existing.status) as EquipmentStatus;
  // "คืนเครื่อง" = ปลดผู้ครอบครองออก แต่ยังเก็บทรัพย์สินไว้ในระบบ
  const released = formData.get("release") === "on";

  if (released) {
    updateEquipment(id, {
      current_holder_id: null,
      current_holder_since: null,
      status,
    });
    revalidateAll();
    return { success: true };
  }

  const owner_name = String(formData.get("owner_name") ?? "").trim();
  if (!owner_name) {
    return { error: 'กรุณากรอกชื่อผู้ครอบครอง (หรือติ๊ก "คืนเครื่อง" ถ้าไม่มีผู้ถือครองแล้ว)' };
  }

  const employee_id = String(formData.get("owner_employee_id") ?? "").trim() || null;
  const department = String(formData.get("owner_department") ?? "").trim() || null;

  // ถ้าชื่อยังเป็นคนเดิมของเครื่องนี้ ให้ยึด id เดิมไว้ก่อนเสมอ
  //
  // ห้ามส่งเข้า findOrCreateUserByName ตรงๆ เพราะมันเทียบทั้งชื่อ "และ" รหัสพนักงาน
  // การที่แอดมินมาหน้านี้เพื่อ "เติมรหัสพนักงานที่ยังว่างอยู่" จะกลายเป็นการสร้างคนใหม่ชื่อซ้ำ
  // แล้วทรัพย์สินจะถูกย้ายไปอยู่กับคนที่เพิ่งเกิดขึ้นมา ส่วนประวัติเดิมค้างอยู่กับคนเก่า
  const currentOwner = existing.current_holder_id
    ? getUserById(existing.current_holder_id)
    : null;
  const user =
    currentOwner && currentOwner.display_name.trim() === owner_name
      ? currentOwner
      : findOrCreateUserByName({ display_name: owner_name, employee_id, department });

  // แก้รหัสพนักงาน/แผนกที่ตัว user จริง ไม่ใช่ปล่อยให้ค่าที่กรอกใหม่หายไปเงียบๆ
  updateUserProfile(user.id, { employee_id, department });

  const sameHolder = existing.current_holder_id === user.id;
  const sinceInput = String(formData.get("holder_since") ?? "").trim();

  let current_holder_since: string;
  if (!sinceInput) {
    // ไม่ได้ระบุวันที่: คนเดิมคงวันเดิมไว้ · เปลี่ยนมือถือว่าเริ่มวันนี้
    current_holder_since = sameHolder
      ? existing.current_holder_since ?? new Date().toISOString()
      : new Date().toISOString();
  } else if (
    existing.current_holder_since &&
    dayKeyTH(existing.current_holder_since) === sinceInput
  ) {
    // วันเดิมไม่ถูกแตะ -> เก็บ timestamp เดิมไว้ทั้งก้อน ไม่ปัดเวลาทิ้งเป็นเที่ยงคืน
    current_holder_since = existing.current_holder_since;
  } else {
    // ระบุเขตเวลาไทยไว้ตรงๆ เพราะคอนเทนเนอร์รันเป็น UTC — ถ้าแปลงด้วยเวลาเครื่อง
    // วันที่ที่แอดมินเลือกจะเลื่อนไปวันก่อนหน้าในช่วงหัวค่ำตามเวลาไทย
    const parsed = new Date(`${sinceInput}T00:00:00+07:00`);
    if (Number.isNaN(parsed.getTime())) return { error: "วันที่เริ่มถือครองไม่ถูกต้อง" };
    if (parsed.getTime() > Date.now()) {
      return { error: "วันที่เริ่มถือครองเป็นวันในอนาคตไม่ได้" };
    }
    current_holder_since = parsed.toISOString();
  }

  updateEquipment(id, {
    current_holder_id: user.id,
    current_holder_since,
    status,
  });

  revalidateAll();
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
