/* ─────────────────────────────────────────────────────────────────────────────
   ทะเบียนพนักงาน — ที่มาของ "ผู้แจ้ง" ทั้งระบบ

   ที่มาของข้อมูล: ไฟล์ "รายชื่อพนักงานฝ่าย ตามผังองค์กร สำหรับนำเข้า.xlsx" ของ HR
   (ผังองค์กร H2-2026 · ส่งให้ไอที 24/9/69) แปลงเป็น employees.seed.json 326 คน
     • 133 คน มีฝ่ายตามผังองค์กร
     • 193 คน ยังไม่ถูกจัดฝ่าย (ส่วนใหญ่เป็นพนักงานขายหน้าร้าน/สาขา) -> department = null
       แสดงผลเป็น "อื่นๆ" และ HR เติมฝ่ายให้ทีหลังได้

   ทำไมต้อง "ซิงก์" ไม่ใช่แค่ seed:
     store.readCollection() รัน seedFn เฉพาะตอน "ยังไม่มีไฟล์" เท่านั้น
     แต่ระบบที่รันอยู่จริงมี data/users.json อยู่แล้ว (และอยู่บน docker volume ที่ไม่ถูกลบ
     เวลา deploy) การแก้ seed() เฉยๆ จึงไม่มีผลกับเครื่องที่ใช้งานอยู่เลยแม้แต่คนเดียว
     — อาการคือ "อัปเดตโค้ดแล้วแต่รายชื่อยังเป็นชุดเดิม" ซึ่งหาสาเหตุยากมาก

   กติกาการเขียนทับ (สำคัญ):
     ช่องที่ทะเบียนมีค่า -> ทะเบียนชนะ (HR เป็นเจ้าของข้อมูลฝ่าย/ตำแหน่ง/ระดับ)
     ช่องที่ทะเบียนเป็น null -> ไม่แตะของเดิม (ไม่งั้นฝ่ายที่แอดมินเพิ่งเติมให้ 193 คนนั้น
     จะถูกล้างกลับเป็นค่าว่างทุกครั้งที่ซิงก์)
     line_user_id / email / id / created_at -> ไม่แตะเด็ดขาด เป็นของฝั่งระบบ ไม่ใช่ของ HR
   ───────────────────────────────────────────────────────────────────────────── */

import { patchOne, readCollection, upsertOne, writeCollection } from "./store";
import { newId } from "../utils";
import registry from "./employees.seed.json";
import type { CompanyCode, User } from "../types";

const COLLECTION = "users";
const META_COLLECTION = "registry_meta";

/** ขยับค่านี้ทุกครั้งที่แก้ employees.seed.json ไม่งั้นเครื่องที่ซิงก์ไปแล้วจะข้ามการซิงก์รอบใหม่ */
export const EMPLOYEE_REGISTRY_VERSION = "2026-09-25";

/** ป้ายของคนที่ยังไม่ถูกจัดฝ่าย — ใช้ทั้งในเมนู LINE และหน้าแอดมิน ห้ามพิมพ์ค่านี้ซ้ำที่อื่น */
export const OTHER_DEPARTMENT = "อื่นๆ";

/** ลำดับฝ่ายตามผังองค์กร (ไม่ได้เรียงตามตัวอักษร) — เมนูใน LINE เรียงตามนี้
 *  เรียงแบบนี้เพราะคนจำ "ฝ่ายตัวเองอยู่ตรงไหนของผัง" ได้ดีกว่าจำตัวอักษรตัวแรก */
export const DEPARTMENTS = [
  "สำนักงานผู้บริหารและกำกับดูแลกิจการ",
  "ฝ่ายขาย",
  "ฝ่ายขายออนไลน์",
  "ฝ่ายการตลาดและพาณิชย์",
  "ฝ่ายวิชวลเมอร์แชนไดซ์",
  "ฝ่ายพัฒนาสินค้าและฝึกอบรม",
  "ฝ่ายฝึกอบรม",
  "ฝ่ายวางแผน",
  "ฝ่ายออกแบบ",
  "ฝ่ายครีเอทีฟและภาพลักษณ์แบรนด์",
  "ฝ่ายสกินแคร์",
  "ฝ่ายจัดซื้อ",
  "ฝ่ายบัญชีและการเงิน",
  "ฝ่ายทรัพยากรบุคคลและธุรการ",
  "ฝ่ายคลังสินค้า",
  "ฝ่ายเทคโนโลยีสารสนเทศ",
  "ฝ่ายปฏิบัติการและตรวจสอบ",
] as const;

export interface EmployeeSeed {
  code: string;
  title: string | null;
  name: string;
  nickname: string | null;
  department: string | null;
  position: string | null;
  level: string | null;
  company: CompanyCode | null;
}

export const EMPLOYEE_REGISTRY = registry as EmployeeSeed[];

interface RegistryMeta {
  id: string;
  version: string;
  synced_at: string;
  added: number;
  updated: number;
}

function toUser(row: EmployeeSeed, now: string): User {
  return {
    id: newId(),
    display_name: row.name,
    employee_id: row.code,
    department: row.department,
    line_user_id: null,
    email: null,
    created_at: now,
    title: row.title,
    nickname: row.nickname,
    position: row.position,
    level: row.level,
    company: row.company,
    active: true,
  };
}

/** ใช้เป็น seedFn ของ collection "users" — ติดตั้งใหม่จะได้รายชื่อจริงตั้งแต่แรก ไม่ใช่ข้อมูลตัวอย่าง */
export function seedUsersFromRegistry(): User[] {
  const now = new Date().toISOString();
  return EMPLOYEE_REGISTRY.map((row) => toUser(row, now));
}

/** รวมทะเบียนเข้ากับ users ที่มีอยู่ — รันซ้ำได้ ผลลัพธ์เหมือนเดิมทุกครั้ง */
export function syncEmployeeRegistry(): { added: number; updated: number } {
  const rows = readCollection<User>(COLLECTION, seedUsersFromRegistry);
  const byCode = new Map<string, User>();
  for (const u of rows) if (u.employee_id) byCode.set(u.employee_id.trim().toUpperCase(), u);

  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;

  for (const row of EMPLOYEE_REGISTRY) {
    const hit = byCode.get(row.code.trim().toUpperCase());
    if (!hit) {
      rows.push(toUser(row, now));
      added += 1;
      continue;
    }
    // เขียนทับเฉพาะช่องที่ทะเบียนมีค่า — ดูเหตุผลที่หัวไฟล์
    const patch: Partial<User> = {};
    if (row.name && hit.display_name !== row.name) patch.display_name = row.name;
    if (row.title && hit.title !== row.title) patch.title = row.title;
    if (row.nickname && hit.nickname !== row.nickname) patch.nickname = row.nickname;
    if (row.department && hit.department !== row.department) patch.department = row.department;
    if (row.position && hit.position !== row.position) patch.position = row.position;
    if (row.level && hit.level !== row.level) patch.level = row.level;
    if (row.company && hit.company !== row.company) patch.company = row.company;
    if (hit.active === undefined) patch.active = true;
    if (Object.keys(patch).length > 0) {
      Object.assign(hit, patch);
      updated += 1;
    }
  }

  if (added > 0 || updated > 0) writeCollection(COLLECTION, rows);
  return { added, updated };
}

/** ซิงก์ให้เองครั้งเดียวต่อ 1 เวอร์ชันทะเบียน — ถูกเรียกจากทุกทางเข้าที่ต้องใช้รายชื่อ
 *
 *  ราคาของการเรียกซ้ำคืออ่านไฟล์เล็ก 1 ไฟล์ + เทียบสตริง 1 ครั้ง จึงเรียกได้ทุก request
 *  โดยไม่ต้องกลัว ส่วนที่แพงจริง (เทียบ 326 แถว + เขียนไฟล์) รันแค่รอบแรกของแต่ละเวอร์ชัน */
export function ensureEmployeeRegistry(): void {
  const meta = readCollection<RegistryMeta>(META_COLLECTION, () => []);
  const hit = meta.find((m) => m.id === "employees");
  if (hit?.version === EMPLOYEE_REGISTRY_VERSION) return;

  const result = syncEmployeeRegistry();
  const row: RegistryMeta = {
    id: "employees",
    version: EMPLOYEE_REGISTRY_VERSION,
    synced_at: new Date().toISOString(),
    ...result,
  };
  upsertOne<RegistryMeta>(META_COLLECTION, row, () => []);
}

// ---------------------------------------------------------------- อ่านรายชื่อ

export function listEmployees(includeInactive = false): User[] {
  ensureEmployeeRegistry();
  const rows = readCollection<User>(COLLECTION, seedUsersFromRegistry);
  return includeInactive ? rows : rows.filter((u) => u.active !== false);
}

/** ชื่อฝ่ายของคนคนหนึ่งแบบที่เอาไปแสดงได้เลย */
export function departmentLabel(user: Pick<User, "department">): string {
  return user.department?.trim() || OTHER_DEPARTMENT;
}

/** ชื่อเต็มพร้อมคำนำหน้า — ใช้ในหัว ticket และข้อความยืนยันในแชท */
export function fullName(user: Pick<User, "title" | "display_name">): string {
  return [user.title?.trim(), user.display_name.trim()].filter(Boolean).join("");
}

export interface DepartmentSummary {
  name: string;
  count: number;
}

/** ฝ่ายทั้งหมดที่ "มีคนอยู่จริง" พร้อมจำนวน — เมนูเลือกฝ่ายใน LINE ใช้ชุดนี้
 *  ไม่คืนฝ่ายที่ไม่มีใครอยู่ เพราะกดเข้าไปแล้วเจอหน้าว่างคือประสบการณ์ที่แย่ที่สุดของเมนูทีละชั้น */
export function departmentSummary(): DepartmentSummary[] {
  const rows = listEmployees();
  const counts = new Map<string, number>();
  for (const u of rows) {
    const key = departmentLabel(u);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ordered: DepartmentSummary[] = [];
  for (const name of DEPARTMENTS) {
    const count = counts.get(name);
    if (count) ordered.push({ name, count });
  }
  // "อื่นๆ" ไว้ท้ายสุดเสมอ ไม่ว่าจะมีคนเยอะแค่ไหน เพราะมันคือถังที่ยังไม่ได้จัด ไม่ใช่ฝ่ายจริง
  const other = counts.get(OTHER_DEPARTMENT);
  if (other) ordered.push({ name: OTHER_DEPARTMENT, count: other });
  return ordered;
}

export function employeesInDepartment(name: string): User[] {
  return listEmployees()
    .filter((u) => departmentLabel(u) === name)
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "th"));
}

function normalize(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

export interface EmployeeMatch {
  user: User;
  /** 3 = ตรงรหัสพนักงาน · 2 = ตรงชื่อเล่น/ชื่อเต็มเป๊ะ · 1 = มีคำที่พิมพ์อยู่ในชื่อ */
  score: number;
}

/** ค้นหาพนักงานจากคำเดียว — รับได้ทั้งรหัส ชื่อจริง นามสกุล และชื่อเล่น
 *
 *  จัดลำดับด้วยคะแนนแทนการคืนตามลำดับที่เจอ เพราะพิมพ์ "ปอ" แล้วได้คนชื่อเล่น "ปอ"
 *  อยู่อันดับ 1 สำคัญกว่าการได้คนที่ชื่อจริงบังเอิญมี "ปอ" อยู่กลางคำขึ้นมาก่อน
 *  ฝั่งบอทมี rapidfuzz ไว้จับคำพิมพ์ผิดต่ออีกชั้น ตรงนี้จึงจับเฉพาะที่ "ตรงจริง" พอ */
export function searchEmployees(query: string, limit = 20): EmployeeMatch[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const out: EmployeeMatch[] = [];
  for (const user of listEmployees()) {
    const code = normalize(user.employee_id ?? "");
    const name = normalize(user.display_name);
    const nick = normalize(user.nickname ?? "");
    let score = 0;
    if (code && code === q) score = 3;
    else if ((nick && nick === q) || name === q) score = 2;
    else if (name.includes(q) || (nick && nick.includes(q)) || (code && code.startsWith(q))) score = 1;
    if (score > 0) out.push({ user, score });
  }
  out.sort((a, b) => b.score - a.score || a.user.display_name.localeCompare(b.user.display_name, "th"));
  return out.slice(0, limit);
}

export function getEmployeeByCode(code: string): User | null {
  const key = normalize(code);
  return listEmployees(true).find((u) => normalize(u.employee_id ?? "") === key) ?? null;
}

// ---------------------------------------------------------------- ผูกกับ LINE

export interface BoundEmployee {
  id: string;
  employee_id: string | null;
  name: string;
  full_name: string;
  nickname: string | null;
  department: string;
  position: string | null;
  company: CompanyCode | null;
}

export function toBound(user: User): BoundEmployee {
  return {
    id: user.id,
    employee_id: user.employee_id,
    name: user.display_name,
    full_name: fullName(user),
    nickname: user.nickname ?? null,
    department: departmentLabel(user),
    position: user.position ?? null,
    company: user.company ?? null,
  };
}

/** ผูกบัญชี LINE เข้ากับพนักงาน 1 คน
 *
 *  ต้องถอดของเดิมออกก่อนเสมอ: line_user_id ถูกใช้เป็นกุญแจค้นหาย้อนกลับ (getUserByLineId)
 *  ถ้าปล่อยให้ค้างอยู่ 2 แถว ฟังก์ชันนั้นจะคืน "แถวไหนก็ได้ที่เจอก่อน" แปลว่าคนคนเดียว
 *  อาจกลายเป็นผู้แจ้งคนละคนในแต่ละครั้งโดยไม่มีอะไรฟ้องเลย */
export function bindLineUser(lineUserId: string, userId: string): User | null {
  const key = lineUserId.trim();
  if (!key) return null;
  const rows = readCollection<User>(COLLECTION, seedUsersFromRegistry);
  const target = rows.find((u) => u.id === userId);
  if (!target) return null;
  let changed = false;
  for (const u of rows) {
    if (u.line_user_id === key && u.id !== userId) {
      u.line_user_id = null;
      changed = true;
    }
  }
  if (target.line_user_id !== key) {
    target.line_user_id = key;
    changed = true;
  }
  if (changed) writeCollection(COLLECTION, rows);
  return target;
}

export function unbindLineUser(lineUserId: string): number {
  const key = lineUserId.trim();
  if (!key) return 0;
  const rows = readCollection<User>(COLLECTION, seedUsersFromRegistry);
  let count = 0;
  for (const u of rows) {
    if (u.line_user_id === key) {
      u.line_user_id = null;
      count += 1;
    }
  }
  if (count > 0) writeCollection(COLLECTION, rows);
  return count;
}

// ---------------------------------------------------------------- แก้ไขจากหน้าแอดมิน

export type EmployeeInput = Pick<User, "display_name"> &
  Partial<Pick<User, "employee_id" | "title" | "nickname" | "department" | "position" | "level" | "company" | "email">>;

export function createEmployee(input: EmployeeInput): User {
  const user: User = {
    id: newId(),
    display_name: input.display_name.trim(),
    employee_id: input.employee_id?.trim() || null,
    department: input.department?.trim() || null,
    line_user_id: null,
    email: input.email?.trim() || null,
    created_at: new Date().toISOString(),
    title: input.title?.trim() || null,
    nickname: input.nickname?.trim() || null,
    position: input.position?.trim() || null,
    level: input.level?.trim() || null,
    company: input.company ?? null,
    active: true,
  };
  return upsertOne<User>(COLLECTION, user, seedUsersFromRegistry);
}

export function updateEmployee(id: string, patch: Partial<User>): User | null {
  return patchOne<User>(COLLECTION, id, patch, seedUsersFromRegistry);
}

export function setEmployeeActive(id: string, active: boolean): User | null {
  return updateEmployee(id, { active });
}

/** ลบถาวร — ใช้ได้เฉพาะคนที่ยังไม่มีประวัติผูกอยู่ ตัวเรียกต้องเช็คเองก่อน (ดู employeeUsage) */
export function deleteEmployee(id: string): boolean {
  const rows = readCollection<User>(COLLECTION, seedUsersFromRegistry);
  if (!rows.some((u) => u.id === id)) return false;
  writeCollection(COLLECTION, rows.filter((u) => u.id !== id));
  return true;
}
