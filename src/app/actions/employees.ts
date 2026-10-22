"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  applyRegistryImport,
  createEmployee,
  deleteEmployee,
  getEmployeeByCode,
  listEmployees,
  MassDeactivationError,
  planRegistryImport,
  setEmployeeActive,
  unbindLineUser,
  updateEmployee,
  type RegistryImportResult,
  type RegistryPerson,
  type RegistryPlan,
} from "@/lib/db/employees";
import { RegistryError, sanitizeRegistryRows } from "@/lib/employee-import";
import { isCompanyCode } from "@/lib/companies";
import { listEquipment } from "@/lib/db/equipment";
import { listTickets } from "@/lib/db/tickets";
import type { CompanyCode } from "@/lib/types";

export interface EmployeeFormState {
  error?: string;
  success?: boolean;
}

/** หน้าที่ต้อง revalidate เมื่อทะเบียนพนักงานเปลี่ยน
 *
 *  /custodian กับ /assets อยู่ในลิสต์ด้วย เพราะ dropdown "ผู้ครอบครอง" อ่านจาก users ชุดเดียวกัน
 *  ถ้าไม่ล้าง cache หน้าเหล่านั้นจะยังเห็นรายชื่อชุดเก่าจนกว่าจะ deploy ใหม่ */
const AFFECTED_PATHS = ["/employees", "/custodian", "/assets", "/tickets"];

function revalidateAll() {
  for (const path of AFFECTED_PATHS) revalidatePath(path);
}

/** จำนวน "ประวัติที่ผูกอยู่" ของพนักงาน 1 คน — ใช้ตัดสินว่าลบถาวรได้ไหม */
export async function employeeUsage(id: string): Promise<{ tickets: number; assets: number }> {
  await requireSession("employees");
  return {
    tickets: listTickets().filter((t) => t.requester_id === id).length,
    assets: listEquipment().filter((e) => e.current_holder_id === id).length,
  };
}

function readForm(formData: FormData) {
  const get = (key: string) => String(formData.get(key) ?? "").trim();
  const company = get("company");
  return {
    display_name: get("display_name"),
    employee_id: get("employee_id"),
    title: get("title"),
    nickname: get("nickname"),
    department: get("department"),
    position: get("position"),
    level: get("level"),
    email: get("email"),
    company: isCompanyCode(company) ? (company as CompanyCode) : null,
  };
}

function validate(input: ReturnType<typeof readForm>, selfId?: string): string | null {
  if (!input.display_name) return "กรุณากรอกชื่อ-นามสกุล";
  if (input.display_name.length > 120) return "ชื่อยาวเกินไป";
  if (input.email && !input.email.includes("@")) return "อีเมลไม่ถูกต้อง";
  if (!input.employee_id) return null;

  // รหัสพนักงานคือกุญแจที่ใช้ซิงก์กับทะเบียนของ HR — ซ้ำเมื่อไหร่ การซิงก์รอบถัดไป
  // จะเขียนทับแถวไหนก็ได้ที่เจอก่อน แล้วข้อมูล 2 คนจะปนกันโดยไม่มีอะไรฟ้อง
  const clash = getEmployeeByCode(input.employee_id);
  if (clash && clash.id !== selfId) {
    return `รหัสพนักงาน "${input.employee_id}" ถูกใช้กับ ${clash.display_name} แล้ว`;
  }
  return null;
}

export async function createEmployeeAction(
  _prev: EmployeeFormState,
  formData: FormData
): Promise<EmployeeFormState> {
  await requireSession("employees");

  const input = readForm(formData);
  const error = validate(input);
  if (error) return { error };

  createEmployee(input);
  revalidateAll();
  return { success: true };
}

export async function updateEmployeeAction(
  id: string,
  formData: FormData
): Promise<EmployeeFormState> {
  await requireSession("employees");

  const target = listEmployees(true).find((u) => u.id === id);
  if (!target) return { error: "ไม่พบพนักงานคนนี้" };

  const input = readForm(formData);
  const error = validate(input, id);
  if (error) return { error };

  updateEmployee(id, {
    display_name: input.display_name,
    employee_id: input.employee_id || null,
    title: input.title || null,
    nickname: input.nickname || null,
    department: input.department || null,
    position: input.position || null,
    level: input.level || null,
    email: input.email || null,
    company: input.company,
  });

  revalidateAll();
  return { success: true };
}

/** เปิด/ปิดการใช้งาน — ปิดแล้วหายจากเมนูเลือกผู้แจ้งในบอทและ dropdown ผู้ครอบครอง
 *  แต่ ticket เก่าที่อ้าง requester_id นี้ยังอ่านได้ครบ */
export async function toggleEmployeeAction(
  id: string,
  active: boolean
): Promise<EmployeeFormState> {
  await requireSession("employees");
  if (!setEmployeeActive(id, active)) return { error: "ไม่พบพนักงานคนนี้" };
  revalidateAll();
  return { success: true };
}

/** ถอดการผูกบัญชี LINE — ครั้งหน้าที่คนนี้แจ้งเรื่อง บอทจะถามชื่ออีกครั้ง
 *
 *  ใช้ตอนพนักงานลาออกแล้วมือถือ/บัญชี LINE ถูกส่งต่อ หรือตอนผูกผิดคนไว้ตั้งแต่แรก
 *  ซึ่งเจ้าตัวแก้เองในแชทไม่ได้ถ้าไม่รู้ว่ามีปุ่ม "เปลี่ยนคนแจ้ง" อยู่ */
export async function unlinkEmployeeLineAction(id: string): Promise<EmployeeFormState> {
  await requireSession("employees");
  const target = listEmployees(true).find((u) => u.id === id);
  if (!target) return { error: "ไม่พบพนักงานคนนี้" };
  if (!target.line_user_id) return { error: "คนนี้ยังไม่ได้ผูกบัญชี LINE" };
  unbindLineUser(target.line_user_id);
  revalidateAll();
  return { success: true };
}

/** ลบถาวร — อนุญาตเฉพาะคนที่ยังไม่มีประวัติผูกอยู่
 *
 *  มี ticket หรือถือทรัพย์สินอยู่ต้องใช้ "ปิดการใช้งาน" แทน ไม่งั้นประวัติจะอ้างถึงคนที่ไม่มีตัวตน
 *  และรายงานย้อนหลังจะบอกไม่ได้ว่าใครแจ้ง/ใครถือเครื่องอยู่ตอนนั้น */
export async function deleteEmployeeAction(id: string): Promise<EmployeeFormState> {
  await requireSession("employees");

  const target = listEmployees(true).find((u) => u.id === id);
  if (!target) return { error: "ไม่พบพนักงานคนนี้" };

  const tickets = listTickets().filter((t) => t.requester_id === id).length;
  const assets = listEquipment().filter((e) => e.current_holder_id === id).length;
  if (tickets > 0 || assets > 0) {
    const parts = [
      tickets > 0 ? `${tickets} เรื่องที่แจ้งไว้` : null,
      assets > 0 ? `ทรัพย์สินในความรับผิดชอบ ${assets} ชิ้น` : null,
    ].filter(Boolean);
    return { error: `ลบไม่ได้ — มี${parts.join(" และ ")} (ใช้ "ปิดการใช้งาน" แทน)` };
  }

  if (target.line_user_id) unbindLineUser(target.line_user_id);
  if (!deleteEmployee(id)) return { error: "ลบไม่สำเร็จ" };
  revalidateAll();
  return { success: true };
}

// ---------------------------------------------------------------- นำเข้าทะเบียนล่าสุดจาก HR (020)
//
// หน้าเว็บอ่านไฟล์ .xlsx เอง แล้วส่งมาแค่ "แถวข้อมูล" — เหตุผลอยู่หัวไฟล์ lib/employee-import.ts
// ทุกแถวถูกตรวจซ้ำที่นี่ (sanitizeRegistryRows) เพราะของที่มาจากเบราว์เซอร์แก้ได้ทุกช่อง
// ไม่มีขั้น "เก็บไฟล์ไว้รอยืนยัน" — ยืนยัน = หน้าเว็บส่งแถวชุดเดิมมาอีกรอบ แล้วคำนวณใหม่จากข้อมูลล่าสุด

/** รายชื่อตัวอย่างในหน้าตรวจผลไม่เกินนี้ต่อกลุ่ม — ตัวเลขใน counts คือยอดจริง */
const PREVIEW_LIST_LIMIT = 100;

export interface RegistryPreview {
  counts: {
    in_file: number;
    inserted: number;
    updated: number;
    reactivated: number;
    unchanged: number;
    deactivate: number;
    kept_missing: number;
    ambiguous: number;
    without_code: number;
  };
  inserted: RegistryPerson[];
  updated: RegistryPerson[];
  reactivated: RegistryPerson[];
  deactivate: RegistryPerson[];
  ambiguous: string[];
  kept_missing_by_prefix: Record<string, number>;
  keep_prefixes: string[];
  active_in_scope: number;
  mass: boolean;
  departments: RegistryPlan["departments"];
}

function toPreview(plan: RegistryPlan): RegistryPreview {
  const cut = <T,>(list: T[]) => list.slice(0, PREVIEW_LIST_LIMIT);
  return {
    counts: {
      in_file: plan.in_file,
      inserted: plan.inserted.length,
      updated: plan.updated.length,
      reactivated: plan.reactivated.length,
      unchanged: plan.unchanged,
      deactivate: plan.deactivate.length,
      kept_missing: plan.kept_missing,
      ambiguous: plan.ambiguous.length,
      without_code: plan.without_code,
    },
    inserted: cut(plan.inserted),
    updated: cut(plan.updated),
    reactivated: cut(plan.reactivated),
    deactivate: cut(plan.deactivate),
    ambiguous: cut(plan.ambiguous),
    kept_missing_by_prefix: plan.kept_missing_by_prefix,
    keep_prefixes: plan.keep_prefixes,
    active_in_scope: plan.active_in_scope,
    mass: plan.mass,
    departments: plan.departments,
  };
}

/** ดูผลก่อนบันทึก — ไม่เขียนอะไรเลย */
export async function previewRegistryAction(
  rows: unknown
): Promise<{ error?: string; preview?: RegistryPreview }> {
  await requireSession("employees");
  try {
    const clean = sanitizeRegistryRows(rows);
    if (clean.length === 0) return { error: "ไม่มีรายชื่อที่ใช้ได้ในไฟล์นี้" };
    return { preview: toPreview(planRegistryImport(clean)) };
  } catch (e) {
    if (e instanceof RegistryError) return { error: e.message };
    throw e;
  }
}

/** นำเข้าจริง — จะเปลี่ยนคนจำนวนมากเป็นสถานะ 0 ต้องส่ง confirmMass=true (หน้าเว็บให้ติ๊กยืนยันก่อน) */
export async function importRegistryAction(
  rows: unknown,
  confirmMass: boolean
): Promise<{ error?: string; needConfirm?: boolean; result?: RegistryImportResult }> {
  await requireSession("employees");
  try {
    const clean = sanitizeRegistryRows(rows);
    if (clean.length === 0) return { error: "ไม่มีรายชื่อที่ใช้ได้ในไฟล์นี้" };
    const result = applyRegistryImport(clean, { confirmMass: confirmMass === true });
    revalidateAll();
    return { result };
  } catch (e) {
    if (e instanceof MassDeactivationError) return { error: e.message, needConfirm: true };
    if (e instanceof RegistryError) return { error: e.message };
    throw e;
  }
}
