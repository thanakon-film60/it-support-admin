"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  activateBranch,
  createBranch,
  deactivateBranch,
  deleteBranch,
  findBranchesByName,
  getBranchById,
  isCompanyCode,
  updateBranch,
} from "@/lib/db/branches";
import { listTickets } from "@/lib/db/tickets";

export interface BranchFormState {
  error?: string;
  success?: boolean;
}

/** หน้าที่ต้อง revalidate เมื่อรายชื่อสาขาเปลี่ยน
 *  /liff/new-ticket อยู่ในลิสต์ด้วย เพราะ dropdown สาขาในฟอร์มพนักงานอ่านจากชุดเดียวกัน */
const AFFECTED_PATHS = ["/branches", "/tickets", "/liff/new-ticket"];

function revalidateAll() {
  for (const path of AFFECTED_PATHS) revalidatePath(path);
}

export async function createBranchAction(
  _prev: BranchFormState,
  formData: FormData
): Promise<BranchFormState> {
  await requireSession();

  const company = String(formData.get("company") ?? "").trim();
  if (!isCompanyCode(company)) return { error: "กรุณาเลือกบริษัท" };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "กรุณากรอกชื่อสาขา" };
  if (name.length > 100) return { error: "ชื่อสาขายาวเกินไป" };

  // ชื่อซ้ำในบริษัทเดียวกัน = ห้าม เพราะ ticket อ้างถึงสาขาด้วยชื่อ ไม่ใช่ id
  // ถ้ามีสองแถวชื่อเดียวกัน จะบอกไม่ได้ว่า ticket นั้นหมายถึงแถวไหน (ทีม/ชั้นคนละค่า)
  if (findBranchesByName(name, company).length > 0) {
    return { error: `มีสาขา "${name}" ในบริษัทนี้อยู่แล้ว` };
  }

  createBranch({
    company,
    name,
    group: String(formData.get("group") ?? ""),
    floor: String(formData.get("floor") ?? ""),
    sale_manager: String(formData.get("sale_manager") ?? ""),
    area_manager: String(formData.get("area_manager") ?? ""),
  });

  revalidateAll();
  return { success: true };
}

export async function updateBranchAction(
  id: string,
  patch: {
    name?: string;
    group?: string;
    floor?: string;
    sale_manager?: string;
    area_manager?: string;
  }
): Promise<BranchFormState> {
  await requireSession();

  const branch = getBranchById(id);
  if (!branch) return { error: "ไม่พบสาขานี้" };

  const name = patch.name?.trim();
  if (name !== undefined) {
    if (!name) return { error: "ชื่อสาขาว่างไม่ได้" };
    const clash = findBranchesByName(name, branch.company).filter((b) => b.id !== id);
    if (clash.length > 0) return { error: `มีสาขา "${name}" ในบริษัทนี้อยู่แล้ว` };
  }

  updateBranch(id, {
    ...(name !== undefined ? { name } : {}),
    ...(patch.group !== undefined ? { group: patch.group.trim() || null } : {}),
    ...(patch.floor !== undefined ? { floor: patch.floor.trim() || null } : {}),
    ...(patch.sale_manager !== undefined
      ? { sale_manager: patch.sale_manager.trim() || null }
      : {}),
    ...(patch.area_manager !== undefined
      ? { area_manager: patch.area_manager.trim() || null }
      : {}),
  });

  revalidateAll();
  return { success: true };
}

/** เปิด/ปิดการใช้งานสาขา — ปิดแล้วจะหายจากปุ่มในบอทและ dropdown ในฟอร์ม
 *  แต่ ticket เก่าที่อ้างถึงสาขานี้ยังอ่านได้ตามปกติ */
export async function toggleBranchAction(id: string, active: boolean): Promise<BranchFormState> {
  await requireSession();
  const result = active ? activateBranch(id) : deactivateBranch(id);
  if (!result) return { error: "ไม่พบสาขานี้" };
  revalidateAll();
  return { success: true };
}

/** ลบถาวร — อนุญาตเฉพาะสาขาที่ยังไม่มี ticket ผูกอยู่
 *
 *  ถ้ามี ticket อยู่แล้วต้องใช้ "ปิดการใช้งาน" แทน ไม่งั้นประวัติจะอ้างถึงสาขาที่ไม่มีข้อมูล
 *  บริษัท/ทีมกำกับอีกต่อไป และรายงานย้อนหลังจะอธิบายไม่ได้ว่าแถวนั้นมาจากไหน */
export async function deleteBranchAction(id: string): Promise<BranchFormState> {
  await requireSession();

  const branch = getBranchById(id);
  if (!branch) return { error: "ไม่พบสาขานี้" };

  const used = listTickets().filter(
    (t) => t.location.trim() === branch.name && (t.company ?? null) === branch.company
  ).length;
  if (used > 0) {
    return { error: `ลบไม่ได้ — มี ${used} เรื่องที่แจ้งจากสาขานี้ (ใช้ "ปิดการใช้งาน" แทน)` };
  }

  if (!deleteBranch(id)) return { error: "ลบไม่สำเร็จ" };
  revalidateAll();
  return { success: true };
}
