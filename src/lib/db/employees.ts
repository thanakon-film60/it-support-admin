/* ─────────────────────────────────────────────────────────────────────────────
   ทะเบียนพนักงาน — ที่มาของ "ผู้แจ้ง" ทั้งระบบ

   ที่มาของข้อมูล (employees.seed.json 338 คน · มีฝ่าย 282 · ยังไม่ถูกจัดฝ่าย 56 -> department = null
   แสดงผลเป็น "อื่นๆ" และ HR เติมฝ่ายให้ทีหลังได้) มาจาก 2 ไฟล์ของ HR แยกตามกลุ่มรหัส:
     • ทุกกลุ่มรหัสยกเว้น AS: "รายชื่อพนักงานฝ่าย ตามผังองค์กร สำหรับนำเข้า.xlsx"
       (ผังองค์กร H2-2026 · ส่งให้ไอที 24/9/69)
     • AS = พนักงานขายสาขา Motta 150 คน: "รายงานตารางเวลาการทำงานประจำเดือน 2026-10" (24 ต.ค. 69)
       ใช้แค่บรรทัดหัวของแต่ละคน "รหัส : ชื่อ นามสกุล (ชื่อเล่น) แผนก: SALE ตำแหน่ง: …"
         - ตำแหน่งเก็บตามไฟล์ทุกตัวอักษร (รวมคำสะกดผิดของ HR) — ชื่อสาขาอยู่ในตำแหน่ง และเป็นสิ่งเดียว
           ที่แยก "ครีม" 5 คนออกจากกันตอนค้นหาในบอท
         - แผนก SALE -> "ฝ่ายขาย" (ชื่อตามผังใน DEPARTMENTS) — ถ้าเก็บ "SALE" ตรงๆ departmentSummary()
           จะไม่นับคนกลุ่มนี้เลย เพราะนับเฉพาะชื่อที่อยู่ในผัง
         - ไฟล์นี้ไม่มีคำนำหน้า/บริษัท/ระดับ -> คนที่เพิ่มใหม่ 12 คนเป็น null ไม่เดาจากกลุ่มรหัส
         - AS69096 อยู่ในทะเบียน ก.ย. แต่ไม่อยู่ในรายงาน ต.ค. — คงข้อมูลเดิม ไม่ปิดใช้งานเอง
           (หายจากรายงานเวลาทำงานไม่ได้แปลว่าลาออก ให้ HR/แอดมินตัดสินที่หน้า /employees)

   ทำไมต้อง "ซิงก์" ไม่ใช่แค่ seed:
     store.readCollection() รัน seedFn เฉพาะตอน "ยังไม่มีไฟล์" เท่านั้น
     แต่ระบบที่รันอยู่จริงมี data/users.json อยู่แล้ว (และอยู่บน docker volume ที่ไม่ถูกลบ
     เวลา deploy) การแก้ seed() เฉยๆ จึงไม่มีผลกับเครื่องที่ใช้งานอยู่เลยแม้แต่คนเดียว
     — อาการคือ "อัปเดตโค้ดแล้วแต่รายชื่อยังเป็นชุดเดิม" ซึ่งหาสาเหตุยากมาก
     ไฟล์ HR 2 ชุดข้างบนซิงก์แยกเวอร์ชันกัน (REGISTRY_SYNCS) — ขยับชุดไหนก็ซิงก์แค่แถวของชุดนั้น

   กติกาการเขียนทับ (สำคัญ):
     ช่องที่ทะเบียนมีค่า -> ทะเบียนชนะ (HR เป็นเจ้าของข้อมูลฝ่าย/ตำแหน่ง/ระดับ)
     ช่องที่ทะเบียนเป็น null -> ไม่แตะของเดิม (ไม่งั้นฝ่ายที่แอดมินเพิ่งเติมให้คนที่ทะเบียนยังไม่จัดฝ่าย
     จะถูกล้างกลับเป็นค่าว่างทุกครั้งที่ซิงก์)
     line_user_id / email / id / created_at -> ไม่แตะเด็ดขาด เป็นของฝั่งระบบ ไม่ใช่ของ HR
   ───────────────────────────────────────────────────────────────────────────── */

import { patchOne, readCollection, upsertOne, writeCollection } from "./store";
import { newId } from "../utils";
import registry from "./employees.seed.json";
import type { CompanyCode, User } from "../types";
import {
  codePrefix,
  companyForSheet,
  isMassDeactivation,
  normalizeCode,
  parsePrefixes,
  resolveDepartment,
  type RegistryRow,
} from "../employee-import";

const COLLECTION = "users";
const META_COLLECTION = "registry_meta";

/** ขยับค่านี้ทุกครั้งที่แก้ employees.seed.json ส่วนผังองค์กร (ทุกกลุ่มรหัสยกเว้น BRANCH_STAFF_PREFIXES)
 *  ไม่งั้นเครื่องที่ซิงก์ไปแล้วจะข้ามการซิงก์รอบใหม่ */
export const EMPLOYEE_REGISTRY_VERSION = "2026-09-25";
/** แบบเดียวกันของพนักงานสาขาที่มาจากรายงานตารางเวลาการทำงาน — แก้แถวกลุ่มนี้แล้วขยับค่านี้แทน */
export const BRANCH_STAFF_REGISTRY_VERSION = "2026-10-24";
/** กลุ่มรหัสที่ข้อมูลมาจากรายงานตารางเวลาการทำงานประจำเดือน ไม่ใช่ทะเบียนผังองค์กร */
export const BRANCH_STAFF_PREFIXES: ReadonlySet<string> = new Set(["AS"]);

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

type RegistryScope = (row: EmployeeSeed) => boolean;

const isBranchStaff: RegistryScope = (row) => BRANCH_STAFF_PREFIXES.has(codePrefix(normalizeCode(row.code)));

/** รวมแถวทะเบียน (เฉพาะที่ scope ยอม) เข้ากับ users ที่อ่านมาแล้ว — แก้ rows ในที่ ไม่เขียนไฟล์ */
function mergeRegistry(rows: User[], scope: RegistryScope): { added: number; updated: number } {
  const byCode = new Map<string, User>();
  for (const u of rows) if (u.employee_id) byCode.set(u.employee_id.trim().toUpperCase(), u);

  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;

  for (const row of EMPLOYEE_REGISTRY) {
    if (!scope(row)) continue;
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
  return { added, updated };
}

/** รวมทะเบียนเข้ากับ users ที่มีอยู่ — รันซ้ำได้ ผลลัพธ์เหมือนเดิมทุกครั้ง (ไม่ระบุ scope = ทั้งทะเบียน) */
export function syncEmployeeRegistry(scope: RegistryScope = () => true): { added: number; updated: number } {
  const rows = readCollection<User>(COLLECTION, seedUsersFromRegistry);
  const result = mergeRegistry(rows, scope);
  if (result.added > 0 || result.updated > 0) writeCollection(COLLECTION, rows);
  return result;
}

/** ทะเบียนแต่ละชุดซิงก์แยกเวอร์ชัน (และแถวใน registry_meta) — แบบเดียวกับ AREA_SYNCS ใน branches.ts
 *
 *  ขยับชุดพนักงานสาขาแล้วต้องไม่ไปซิงก์ชุดผังองค์กรซ้ำ: ชุดนั้นเป็นข้อมูล ก.ย. ถ้าซิงก์ซ้ำจะเขียนทับ
 *  ชื่อ/ฝ่ายที่นำเข้าจากทะเบียน HR รุ่นใหม่กว่า (020) และที่แอดมินแก้ในหน้าเว็บ กลับเป็นค่าเดือน ก.ย.
 *  ทั้งบริษัทโดยไม่มีอะไรเตือน (id "employees" คือชุดผังองค์กรมาตั้งแต่ก่อนแยก — คงไว้ เครื่องที่ซิงก์ไปแล้ว
 *  จะได้ไม่ซิงก์ซ้ำ) · export ไว้ให้เทสต์ประกาศว่า "ซิงก์ครบแล้ว" ได้โดยไม่ต้องรู้จัก id ทีละตัว */
export const REGISTRY_SYNCS: readonly { id: string; version: string; scope: RegistryScope }[] = [
  { id: "employees", version: EMPLOYEE_REGISTRY_VERSION, scope: (row) => !isBranchStaff(row) },
  { id: "employees-branch-staff", version: BRANCH_STAFF_REGISTRY_VERSION, scope: isBranchStaff },
];

/** ซิงก์ให้เองครั้งเดียวต่อ 1 เวอร์ชันของแต่ละชุด — ถูกเรียกจากทุกทางเข้าที่ต้องใช้รายชื่อ
 *
 *  ราคาของการเรียกซ้ำคืออ่านไฟล์เล็ก 1 ไฟล์ + เทียบสตริง จึงเรียกได้ทุก request
 *  โดยไม่ต้องกลัว ส่วนที่แพงจริง (เทียบ 338 แถว + เขียนไฟล์) รันแค่รอบแรกของแต่ละเวอร์ชัน */
export function ensureEmployeeRegistry(): void {
  const meta = readCollection<RegistryMeta>(META_COLLECTION, () => []);
  const pending = REGISTRY_SYNCS.filter((s) => meta.find((m) => m.id === s.id)?.version !== s.version);
  if (pending.length === 0) return;

  const rows = readCollection<User>(COLLECTION, seedUsersFromRegistry);
  const results = pending.map((s) => ({ id: s.id, version: s.version, result: mergeRegistry(rows, s.scope) }));
  if (results.some(({ result }) => result.added > 0 || result.updated > 0)) writeCollection(COLLECTION, rows);
  for (const { id, version, result } of results) {
    upsertOne<RegistryMeta>(META_COLLECTION, { id, version, synced_at: new Date().toISOString(), ...result }, () => []);
  }
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

// ---------------------------------------------------------------- นำเข้าทะเบียนล่าสุดจากไฟล์ของ HR (020)
//
// ต่างจาก syncEmployeeRegistry() ด้านบน: ตัวนั้นซิงก์ seed ที่ติดมากับโค้ด (ครั้งเดียวต่อเวอร์ชัน)
// ตัวนี้คือ "ไฟล์ล่าสุดที่ HR ส่งมา" ผ่านหน้า /employees — ใครไม่อยู่ในไฟล์ถือว่าพ้นสภาพ (สถานะ 0)
// กติกาทั้งหมดอยู่หัวไฟล์ lib/employee-import.ts (ชุดเดียวกับระบบจองห้องประชุมและระบบนวด)

export interface RegistryPerson {
  employee_id: string;
  name: string;
  department: string | null;
}

export interface RegistryPlan {
  in_file: number;
  inserted: RegistryPerson[];
  updated: RegistryPerson[];
  reactivated: RegistryPerson[];
  unchanged: number;
  /** สถานะ 1 → 0: ไม่อยู่ในไฟล์ + อยู่ในขอบเขต */
  deactivate: RegistryPerson[];
  /** ไม่อยู่ในไฟล์แต่เป็นกลุ่มยกเว้น → คงสถานะเดิม */
  kept_missing_by_prefix: Record<string, number>;
  kept_missing: number;
  /** รหัสที่มีมากกว่า 1 แถวในระบบ — ไม่เดาว่าคนไหน (กฎเหล็กข้อ 4) ข้ามไว้ให้แอดมินแก้ก่อน */
  ambiguous: string[];
  /** แถวในระบบที่ไม่มีรหัสพนักงาน (เพิ่มเองจากหน้าแอดมิน) — จับคู่กับไฟล์ไม่ได้ จึงไม่แตะ */
  without_code: number;
  active_in_scope: number;
  mass: boolean;
  keep_prefixes: string[];
  departments: { unknown: { value: string; count: number }[]; guess_kept: number; guess_used: number };
}

export interface RegistryImportResult {
  in_file: number;
  inserted: number;
  updated: number;
  reactivated: number;
  unchanged: number;
  deactivated: number;
  kept_missing: number;
  ambiguous: number;
}

/** กลุ่มรหัสที่ไม่ปิดเมื่อไม่อยู่ในไฟล์ — ตั้งใน .env (EMPLOYEE_SYNC_KEEP_PREFIXES) ค่าเดียวกับอีก 2 ระบบ */
export function keepPrefixes(): Set<string> {
  return parsePrefixes(process.env.EMPLOYEE_SYNC_KEEP_PREFIXES);
}

const person = (u: Pick<User, "employee_id" | "display_name" | "department">): RegistryPerson => ({
  employee_id: u.employee_id ?? "",
  name: u.display_name,
  department: u.department ?? null,
});

interface Change {
  user: User | null;
  row: RegistryRow;
  patch: Partial<User>;
}

/** คำนวณสิ่งที่จะเปลี่ยน (ไม่เขียนไฟล์) — preview และการนำเข้าจริงใช้ตัวเดียวกัน ผลจึงตรงกันเสมอ */
function computePlan(users: User[], rows: RegistryRow[], keep: Set<string>): { plan: RegistryPlan; changes: Change[] } {
  const byCode = new Map<string, User[]>();
  let withoutCode = 0;
  for (const u of users) {
    const code = normalizeCode(u.employee_id);
    if (!code) {
      withoutCode += 1;
      continue;
    }
    byCode.set(code, [...(byCode.get(code) ?? []), u]);
  }

  const plan: RegistryPlan = {
    in_file: rows.length, inserted: [], updated: [], reactivated: [], unchanged: 0, deactivate: [],
    kept_missing_by_prefix: {}, kept_missing: 0, ambiguous: [], without_code: withoutCode,
    active_in_scope: 0, mass: false, keep_prefixes: [...keep].sort(),
    departments: { unknown: [], guess_kept: 0, guess_used: 0 },
  };
  const unknown = new Map<string, number>();
  const changes: Change[] = [];
  const inFile = new Set<string>();

  for (const row of rows) {
    inFile.add(row.code);
    const matches = byCode.get(row.code) ?? [];
    if (matches.length > 1) {
      plan.ambiguous.push(row.code);
      continue;
    }
    const old = matches[0] ?? null;
    const dept = resolveDepartment(row.department, old?.department?.trim() || null, DEPARTMENTS);
    if (dept.how === "unknown" && row.department) unknown.set(row.department, (unknown.get(row.department) ?? 0) + 1);
    if (dept.how === "guess_kept") plan.departments.guess_kept += 1;
    if (dept.how === "guess_used") plan.departments.guess_used += 1;
    const company = companyForSheet(row.sheet);

    if (!old) {
      changes.push({ user: null, row, patch: { department: dept.value, company } });
      plan.inserted.push({ employee_id: row.code, name: row.name, department: dept.value });
      continue;
    }
    // ช่องว่างในไฟล์ = ไม่แตะ · line_user_id / email / position / level เป็นของฝั่งระบบ ไม่ใช่ของทะเบียนนี้
    const patch: Partial<User> = {};
    if (old.display_name !== row.name) patch.display_name = row.name;
    if (row.title && old.title !== row.title) patch.title = row.title;
    if (row.nickname && old.nickname !== row.nickname) patch.nickname = row.nickname;
    if (dept.value !== (old.department?.trim() || null)) patch.department = dept.value;
    if (company && old.company !== company) patch.company = company;
    if (old.active === false) patch.active = true;
    if (Object.keys(patch).length === 0) {
      plan.unchanged += 1;
      continue;
    }
    changes.push({ user: old, row, patch });
    plan.updated.push(person({ ...old, ...patch }));
    if (old.active === false) plan.reactivated.push(person({ ...old, ...patch }));
  }

  for (const [code, list] of byCode) {
    for (const u of list) {
      if (u.active === false) continue;
      const protectedCode = keep.has(codePrefix(code));
      if (!protectedCode) plan.active_in_scope += 1;
      if (inFile.has(code)) continue;
      if (protectedCode) {
        plan.kept_missing += 1;
        const p = codePrefix(code) || "-";
        plan.kept_missing_by_prefix[p] = (plan.kept_missing_by_prefix[p] ?? 0) + 1;
      } else {
        plan.deactivate.push(person(u));
        changes.push({ user: u, row: { code, name: u.display_name, title: null, nickname: null, department: null, sheet: "", row: 0 }, patch: { active: false } });
      }
    }
  }
  plan.deactivate.sort((a, b) => a.employee_id.localeCompare(b.employee_id));
  plan.mass = isMassDeactivation(plan.deactivate.length, plan.active_in_scope);
  plan.departments.unknown = [...unknown].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  return { plan, changes };
}

export function planRegistryImport(rows: RegistryRow[], keep: Set<string> = keepPrefixes()): RegistryPlan {
  ensureEmployeeRegistry(); // seed เวอร์ชันใหม่ที่ยังไม่ซิงก์ต้องลงก่อน ไม่งั้นมันจะมาทับผลนำเข้าทีหลัง
  return computePlan(readCollection<User>(COLLECTION, seedUsersFromRegistry), rows, keep).plan;
}

export class MassDeactivationError extends Error {}

/** นำเข้าจริง — คำนวณใหม่จากข้อมูลล่าสุด (ไม่เชื่อผล preview ที่อาจเก่าแล้ว) แล้วเขียนไฟล์ครั้งเดียว
 *  ทั้งก้อนเป็นโค้ด sync ไม่มี await คั่น — คำขออื่นแทรกกลางระหว่างอ่านกับเขียนไม่ได้ */
export function applyRegistryImport(
  rows: RegistryRow[],
  { confirmMass, keep = keepPrefixes() }: { confirmMass: boolean; keep?: Set<string> }
): RegistryImportResult {
  ensureEmployeeRegistry();
  const users = readCollection<User>(COLLECTION, seedUsersFromRegistry);
  const { plan, changes } = computePlan(users, rows, keep);
  if (plan.mass && !confirmMass) {
    throw new MassDeactivationError(
      `ไฟล์นี้จะเปลี่ยนพนักงาน ${plan.deactivate.length} คนเป็นสถานะ 0 (จาก ${plan.active_in_scope} คนที่ใช้งานอยู่) ` +
        "— ตรวจว่าไม่ได้เลือกไฟล์ผิด (ไฟล์บริษัทเดียว/ไฟล์เก่า) แล้วยืนยันอีกครั้ง"
    );
  }
  const now = new Date().toISOString();
  for (const c of changes) {
    if (c.user) {
      Object.assign(c.user, c.patch);
      continue;
    }
    users.push({
      ...toUser(
        { code: c.row.code, title: c.row.title, name: c.row.name, nickname: c.row.nickname, department: null,
          position: null, level: null, company: null },
        now
      ),
      ...c.patch,
    });
  }
  if (changes.length > 0) writeCollection(COLLECTION, users);
  return {
    in_file: plan.in_file,
    inserted: plan.inserted.length,
    updated: plan.updated.length,
    reactivated: plan.reactivated.length,
    unchanged: plan.unchanged,
    deactivated: plan.deactivate.length,
    kept_missing: plan.kept_missing,
    ambiguous: plan.ambiguous.length,
  };
}
