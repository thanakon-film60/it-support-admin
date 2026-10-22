/* ─────────────────────────────────────────────────────────────────────────────
   นำเข้าทะเบียนพนักงานจากไฟล์ Excel ของ HR — ส่วนที่ "ไม่แตะฐานข้อมูล"
   ใช้ได้ทั้งหน้าเว็บ (อ่านไฟล์ หาหัวคอลัมน์) และเซิร์ฟเวอร์ (ตรวจแถวซ้ำอีกรอบ + แปลงฝ่าย)

   ทำไมแยกไฟล์: หน้าเว็บต้องใช้ logic นี้ ถ้าอยู่ใน lib/db/employees.ts ซึ่ง import store.ts (node:fs)
   bundler จะลาก fs เข้า bundle ของเบราว์เซอร์แล้ว build ล้ม (กฎเหล็กข้อ 1 ใน PROJECT.md)

   ทำไมอ่านไฟล์ที่หน้าเว็บ ไม่อ่านที่เซิร์ฟเวอร์:
     xlsx 0.18.5 (รุ่นสุดท้ายที่มีใน npm) มีช่องโหว่ตอน "อ่าน" ไฟล์ที่ถูกแต่งมา (prototype pollution
     · CVE-2023-30533) — อ่านในเบราว์เซอร์ ผลกระทบจำกัดอยู่ในแท็บของแอดมินคนนั้น
     อ่านในเซิร์ฟเวอร์ = โปรเซสที่รันทั้งระบบ (บอท LINE + หน้าแอดมิน) โดนไปด้วย
     เซิร์ฟเวอร์จึงรับแค่ "แถวข้อมูล" (JSON) แล้วตรวจทุกช่องเองด้วย sanitizeRegistryRows() — ไม่เชื่อหน้าเว็บ

   กติกา (ผู้ใช้กำหนด 11 ต.ค. 2569 — ชุดเดียวกับระบบจองห้องประชุมและระบบนวด):
     ไฟล์ = ทะเบียนล่าสุด: อยู่ในไฟล์ → สถานะ 1 (active) · ไม่อยู่ในไฟล์ → 0 (active=false · ไม่ลบ)
     ยกเว้นกลุ่มรหัสที่ทะเบียนชุดนี้ไม่มี (EMPLOYEE_SYNC_KEEP_PREFIXES · ตั้งต้น AS,MS,PS = พนักงานสาขา) → คงเดิม
     กลุ่มรหัส = ตัวอักษรนำหน้า "ทั้งหมด": AS12345 → AS ไม่ใช่ A (ไม่งั้นพนักงานสำนักงาน A… ที่ออกแล้วไม่ถูกปิด)
     ช่องว่างในไฟล์ = ทะเบียนไม่ได้บอก → คงค่าเดิม (ไม่ล้าง)
   ───────────────────────────────────────────────────────────────────────────── */

import type { CompanyCode } from "./types";

export const MAX_FILE_MB = 5;
/** เพดานแถว — ทะเบียนจริง 143 คน · ส่งเข้า Server Action เป็น JSON ซึ่งจำกัด 1 MB (ค่าตั้งต้นของ Next.js) */
export const MAX_ROWS = 3000;
const HEADER_SCAN_ROWS = 15;
/** เกณฑ์ "ปิดจำนวนมาก" = น่าจะเลือกไฟล์ผิด (ไฟล์บริษัทเดียว / ไฟล์เก่า) → ต้องติ๊กยืนยันก่อน */
export const MASS_MIN = 10;
export const MASS_RATIO = 0.3;

/** ตรงกับระบบจองห้องประชุม/ระบบนวด — รหัสเดียวกันต้องผ่านเกณฑ์เดียวกันทุกระบบ */
export const CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
export const DEFAULT_KEEP_PREFIXES = ["AS", "MS", "PS"];

export class RegistryError extends Error {}

export interface RegistryRow {
  code: string;
  name: string;
  title: string | null;
  nickname: string | null;
  /** ค่าในไฟล์ตามที่ HR พิมพ์ — แปลงเป็นชื่อฝ่ายตามผังตอนนำเข้า (resolveDepartment) */
  department: string | null;
  sheet: string;
  /** เลขแถวใน Excel (นับ 1) — HR เปิดไฟล์หาแถวนั้นได้ทันที */
  row: number;
}

export interface RegistryProblem {
  sheet: string;
  row: number;
  code: string | null;
  message: string;
}

export interface RegistrySheet {
  name: string;
  header_row: number | null;
  valid: number;
  has_department: boolean;
  note: string | null;
}

export interface ParsedRegistry {
  sheets: RegistrySheet[];
  rows: RegistryRow[];
  problems: RegistryProblem[];
}

/** ข้อมูลดิบของ 1 ชีต — first_row = เลขแถว Excel ของ rows[0] (ช่วงข้อมูลไม่จำเป็นต้องเริ่มที่แถว 1) */
export interface RawSheet {
  name: string;
  first_row: number;
  rows: unknown[][];
}

// ---------------------------------------------------------------- จัดรูปข้อความ

/** ข้อความจากไฟล์: NFC · ทิ้งอักขระล่องหน (zero-width/BOM) · อักขระควบคุมเป็นช่องว่าง · ยุบช่องว่างซ้ำ */
export function cleanText(value: unknown, limit = 200): string {
  if (value === null || value === undefined) return "";
  const text = String(value)
    .normalize("NFC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\p{Cc}/gu, " ");
  return text.split(/\s+/).filter(Boolean).join(" ").slice(0, limit);
}

/** รหัสพนักงาน: ตัวใหญ่ ไม่มีช่องว่าง — Excel เก็บรหัสตัวเลขล้วนเป็น number ต้องไม่กลายเป็น "1234.5" */
export function normalizeCode(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).normalize("NFKC").replace(/\s+/g, "").replace(/^'/, "").toUpperCase();
}

export function codePrefix(code: string): string {
  return /^[A-Z]+/.exec(code)?.[0] ?? "";
}

export function parsePrefixes(raw: string | undefined): Set<string> {
  const list = raw === undefined ? DEFAULT_KEEP_PREFIXES : raw.split(",");
  return new Set(list.map((p) => p.trim().toUpperCase()).filter(Boolean));
}

// ---------------------------------------------------------------- อ่านไฟล์

type Field = "code" | "name" | "title" | "nickname" | "department";

const headerKey = (value: unknown) => cleanText(value).replace(/[\s\-_./()*:]+/g, "").toLowerCase();

// "ฝ่ายงาน" = ทะเบียน HR ชุด 11 ต.ค. 69 · "แผนก / ฝ่าย" = ไฟล์ตามผังองค์กรชุดเดิม
const ALIASES: Record<Field, string[]> = {
  code: ["รหัสพนักงาน", "รหัส", "employeecode", "empcode", "employeeid", "code"],
  name: ["ชื่อนามสกุล", "ชื่อนามสกุลhr", "ชื่อพนักงาน", "fullname", "name"],
  title: ["คำนำหน้าชื่อ", "คำนำหน้า", "title", "prefix"],
  nickname: ["ชื่อเล่น", "nickname"],
  department: ["แผนกฝ่าย", "ฝ่ายแผนก", "ฝ่ายงาน", "ฝ่าย", "แผนก", "หน่วยงาน", "department", "dept"],
};

function findColumns(row: unknown[]): Partial<Record<Field, number>> | null {
  const cols: Partial<Record<Field, number>> = {};
  row.forEach((cell, idx) => {
    const key = headerKey(cell);
    for (const [field, names] of Object.entries(ALIASES) as [Field, string[]][]) {
      if (cols[field] === undefined && names.includes(key)) cols[field] = idx;
    }
  });
  return cols.code !== undefined && cols.name !== undefined ? cols : null;
}

/** อ่านทุกชีต — แถวที่ผิดถูกรายงานพร้อมเลขแถว (ไม่ทิ้งเงียบ) · รหัสซ้ำใช้แถวแรก · ชีตที่ไม่มีหัวคอลัมน์ถูกข้าม */
export function parseRegistrySheets(sheets: RawSheet[]): ParsedRegistry {
  const out: ParsedRegistry = { sheets: [], rows: [], problems: [] };
  const seen = new Map<string, { sheet: string; row: number }>();
  let total = 0;
  for (const raw of sheets) {
    const name = cleanText(raw.name, 60) || "(ไม่มีชื่อ)";
    const info: RegistrySheet = { name, header_row: null, valid: 0, has_department: false, note: null };
    out.sheets.push(info);
    let cols: Partial<Record<Field, number>> | null = null;
    raw.rows.forEach((cells, i) => {
      const rowNo = raw.first_row + i;
      if (cols === null) {
        if (i >= HEADER_SCAN_ROWS) return;
        cols = findColumns(cells ?? []);
        if (cols) {
          info.header_row = rowNo;
          info.has_department = cols.department !== undefined;
        }
        return;
      }
      const c = cols;
      const cell = (f: Field) => (c[f] === undefined ? null : (cells ?? [])[c[f] as number]);
      const code = normalizeCode(cell("code"));
      const fullName = cleanText(cell("name"));
      if (!code && !fullName) return; // แถวว่าง / แถวคั่น
      total += 1;
      if (total > MAX_ROWS) throw new RegistryError(`รายชื่อเกิน ${MAX_ROWS.toLocaleString()} แถว — ตรวจว่าเลือกไฟล์ถูก`);
      const problem = (message: string, withCode = true) =>
        out.problems.push({ sheet: name, row: rowNo, code: withCode && code ? code.slice(0, 30) : null, message });
      if (!code) return problem("ไม่มีรหัสพนักงาน", false);
      if (!CODE_RE.test(code)) return problem("รหัสพนักงานต้องเป็นตัวอักษรอังกฤษ/ตัวเลข/ขีด 2–20 ตัว");
      if (!fullName) return problem("ไม่มีชื่อ-นามสกุล");
      const first = seen.get(code);
      if (first) return problem(`รหัสซ้ำกับแถว ${first.row} ของชีต ${first.sheet} — ใช้แถวแรกเท่านั้น`);
      seen.set(code, { sheet: name, row: rowNo });
      info.valid += 1;
      out.rows.push({
        code,
        name: fullName,
        title: cleanText(cell("title"), 40) || null,
        nickname: cleanText(cell("nickname"), 60) || null,
        department: cleanText(cell("department"), 120) || null,
        sheet: name,
        row: rowNo,
      });
    });
    if (cols === null) info.note = "ไม่พบหัวคอลัมน์ “รหัสพนักงาน” และ “ชื่อ-นามสกุล” ใน 15 แถวแรก — ข้ามชีตนี้";
  }
  if (!out.sheets.some((s) => s.header_row !== null)) {
    throw new RegistryError("ไม่พบหัวคอลัมน์ “รหัสพนักงาน” และ “ชื่อ-นามสกุล” ใน 15 แถวแรกของชีตใดเลย");
  }
  return out;
}

/** ฝั่งเซิร์ฟเวอร์: ตรวจแถวที่หน้าเว็บส่งมาอีกรอบด้วยกติกาเดียวกัน — ข้อมูลจากเบราว์เซอร์แก้ได้ทุกช่อง
 *  รูปร่างผิดทั้งก้อน = ปฏิเสธทั้งหมด (ไม่ใช่ข้ามบางแถว) เพราะแปลว่าไม่ได้มาจากหน้าเว็บของเรา */
export function sanitizeRegistryRows(input: unknown): RegistryRow[] {
  if (!Array.isArray(input)) throw new RegistryError("ข้อมูลรายชื่อไม่ถูกต้อง — โหลดหน้าใหม่แล้วเลือกไฟล์อีกครั้ง");
  if (input.length > MAX_ROWS) throw new RegistryError(`รายชื่อเกิน ${MAX_ROWS.toLocaleString()} แถว`);
  const seen = new Set<string>();
  const rows: RegistryRow[] = [];
  for (const item of input) {
    if (typeof item !== "object" || item === null) throw new RegistryError("ข้อมูลรายชื่อไม่ถูกต้อง");
    const r = item as Record<string, unknown>;
    const code = normalizeCode(typeof r.code === "string" ? r.code : "");
    const name = cleanText(typeof r.name === "string" ? r.name : "");
    if (!CODE_RE.test(code) || !name || seen.has(code)) continue; // หน้าเว็บกรองแล้ว — ถึงตรงนี้ได้แปลว่าถูกแก้มา
    seen.add(code);
    const text = (v: unknown, limit: number) => (typeof v === "string" ? cleanText(v, limit) || null : null);
    rows.push({
      code,
      name,
      title: text(r.title, 40),
      nickname: text(r.nickname, 60),
      department: text(r.department, 120),
      sheet: cleanText(typeof r.sheet === "string" ? r.sheet : "", 60),
      row: typeof r.row === "number" && Number.isInteger(r.row) && r.row > 0 ? r.row : 0,
    });
  }
  return rows;
}

// ---------------------------------------------------------------- บริษัทตามชื่อชีต

// HR เปลี่ยนชื่อชีตระหว่างรอบ: ก.ย. "Motta / Montipa / P" → ต.ค. "AFV / MTP / บุคคล"
// (ตรวจ 11 ต.ค. 69: กลุ่มรหัสตรงกันทุกคน — Motta = A/AS/MD · Montipa = M/MS · P = P/PS)
// ชีตที่ไม่รู้จัก / "บุคคล" (ทะเบียนเดิมไม่ระบุบริษัท) → null = คงบริษัทเดิมของคนนั้น
const SHEET_COMPANY: Record<string, CompanyCode> = {
  afv: "motta",
  motta: "motta",
  mtp: "montipa",
  montipa: "montipa",
};

export function companyForSheet(sheet: string): CompanyCode | null {
  return SHEET_COMPANY[cleanText(sheet).toLowerCase()] ?? null;
}

// ---------------------------------------------------------------- ฝ่าย: ชื่อชุดของ HR → ชื่อตามผังองค์กร

// ที่มา: "รายงานจับคู่ทะเบียนพนักงาน 2026-10-09.xlsx" ชีต "ตารางชื่อฝ่าย" — ตารางเดียวกับอีก 2 ระบบ
// EXACT = ทุกคนที่มีชื่อนี้ในทะเบียนอยู่ฝ่ายเดียวกันตามผัง → ใช้ได้เสมอ (ทะเบียนเป็นเจ้าของข้อมูล)
const DEPT_EXACT: Record<string, string> = {
  warehouse: "ฝ่ายคลังสินค้า",
  "ฝ่ายขายออฟไลน์": "ฝ่ายขาย",
  "ฝ่าย vm": "ฝ่ายวิชวลเมอร์แชนไดซ์",
  "ฝ่ายบัญชี": "ฝ่ายบัญชีและการเงิน",
  "ฝ่ายไอที": "ฝ่ายเทคโนโลยีสารสนเทศ",
  "ฝ่ายบุคคล": "ฝ่ายทรัพยากรบุคคลและธุรการ",
  "ฝ่าย audit": "ฝ่ายปฏิบัติการและตรวจสอบ",
  product: "ฝ่ายพัฒนาสินค้าและฝึกอบรม",
  "ฝ่ายจัดซื้อ": "ฝ่ายจัดซื้อ",
  training: "ฝ่ายฝึกอบรม",
  "brand image": "ฝ่ายครีเอทีฟและภาพลักษณ์แบรนด์",
  "online sale": "ฝ่ายขายออนไลน์",
};
// GUESS = ชื่อนี้ใช้กับหลายฝ่ายตามผัง (เช่น Marketing 12 ใน 13 คน) → ใช้เฉพาะคนที่ยังไม่มีฝ่าย
// ห้ามทับคนที่จัดฝ่ายไว้แล้ว ไม่งั้นคนที่เหลือถูกย้ายฝ่ายผิดทุกครั้งที่นำเข้า
// ตรวจก่อนชื่อตามผัง: "ฝ่ายคลังสินค้า" ในทะเบียนตรงกับผังแค่ 4 ใน 6 คน แม้จะสะกดเหมือนชื่อในผัง
const DEPT_GUESS: Record<string, string> = {
  marketing: "ฝ่ายการตลาดและพาณิชย์",
  "ฝ่ายบริหาร": "สำนักงานผู้บริหารและกำกับดูแลกิจการ",
  "ฝ่ายคลังสินค้า": "ฝ่ายคลังสินค้า",
  "e-commerce": "ฝ่ายขาย",
  "sales online pc": "ฝ่ายขาย",
};

export type DepartmentHow = "blank" | "exact" | "guess_used" | "guess_kept" | "unknown";

const deptKey = (value: string) => value.split(/\s+/).filter(Boolean).join(" ").toLowerCase();

/** ค่าในไฟล์ → (ค่าที่จะบันทึก, เหตุผล) · known = ชื่อฝ่ายตามผัง (DEPARTMENTS ใน lib/db/employees.ts) */
export function resolveDepartment(
  value: string | null,
  current: string | null,
  known: readonly string[]
): { value: string | null; how: DepartmentHow } {
  if (!value) return { value: current, how: "blank" };
  const key = deptKey(value);
  if (key in DEPT_GUESS) return current ? { value: current, how: "guess_kept" } : { value: DEPT_GUESS[key], how: "guess_used" };
  if (key in DEPT_EXACT) return { value: DEPT_EXACT[key], how: "exact" };
  const org = known.find((d) => deptKey(d) === key);
  if (org) return { value: org, how: "exact" };
  return { value: current, how: "unknown" };
}

export function isMassDeactivation(deactivate: number, activeInScope: number): boolean {
  return deactivate > MASS_MIN && deactivate > activeInScope * MASS_RATIO;
}
