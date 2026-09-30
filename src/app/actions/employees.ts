"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  createEmployee,
  deleteEmployee,
  getEmployeeByCode,
  listEmployees,
  setEmployeeActive,
  unbindLineUser,
  updateEmployee,
} from "@/lib/db/employees";
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
  await requireSession();
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
  await requireSession();

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
  await requireSession();

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
  await requireSession();
  if (!setEmployeeActive(id, active)) return { error: "ไม่พบพนักงานคนนี้" };
  revalidateAll();
  return { success: true };
}

/** ถอดการผูกบัญชี LINE — ครั้งหน้าที่คนนี้แจ้งเรื่อง บอทจะถามชื่ออีกครั้ง
 *
 *  ใช้ตอนพนักงานลาออกแล้วมือถือ/บัญชี LINE ถูกส่งต่อ หรือตอนผูกผิดคนไว้ตั้งแต่แรก
 *  ซึ่งเจ้าตัวแก้เองในแชทไม่ได้ถ้าไม่รู้ว่ามีปุ่ม "เปลี่ยนคนแจ้ง" อยู่ */
export async function unlinkEmployeeLineAction(id: string): Promise<EmployeeFormState> {
  await requireSession();
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
  await requireSession();

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
