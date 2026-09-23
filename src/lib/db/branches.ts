import type { Branch, CompanyCode } from "../types";
import { readCollection, upsertOne, patchOne, writeCollection } from "./store";
import { newId } from "../utils";
import { COMPANY_LABEL } from "../companies";
export { COMPANIES, COMPANY_LABEL, isCompanyCode } from "../companies";

/* ─────────────────────────────────────────────────────────────────────────────
   ทะเบียนสาขาของทั้งกลุ่มบริษัท — แหล่งข้อมูลจริงที่เดียวของระบบ

   ที่มาของข้อมูล:
     • Montipa — ใบประกาศ "สาขาเปิดให้บริการ" อัปเดต 1/9/69 (30 สาขา แบ่งตามภูมิภาค)
     • Motta   — ตารางโครงสร้าง Sale Manager / Area Manager (69 สาขา แบ่งตามทีม)
     • ส่วนกลาง — สำนักงานและคลังของบริษัท ไม่ใช่หน้าร้าน

   ตารางนี้ใช้สร้าง data/branches.json ครั้งแรกเท่านั้น หลังจากนั้นจัดการสาขาผ่านหน้าเว็บ
   เมนู LINE และฟอร์มแจ้งเรื่องอ่านจากทะเบียนเดียวกัน รวมถึงสถานะเปิด/ปิดใช้งาน
   ───────────────────────────────────────────────────────────────────────────── */

export interface BranchGroup {
  /** ใช้เป็นค่าใน postback / query string — ห้ามเปลี่ยนพร่ำเพรื่อ */
  key: string;
  label: string;
  branches: string[];
}

export interface CompanyEntry {
  company: CompanyCode;
  label: string;
  /** คำอธิบายว่ากลุ่มย่อยคืออะไร ต่างกันในแต่ละบริษัท (ภูมิภาค vs ทีมขาย) */
  groupLabel: string;
  groups: BranchGroup[];
}

export const BRANCH_DIRECTORY: CompanyEntry[] = [
  {
    company: "montipa",
    label: "Montipa",
    groupLabel: "ภูมิภาค",
    groups: [
      {
        key: "bkk",
        label: "กรุงเทพฯ และปริมณฑล",
        branches: [
          "เซ็นทรัล พระราม 2",
          "เซ็นทรัล พระราม 9",
          "เดอะมอลล์ไลฟ์สโตร์ บางกะปิ",
          "เซ็นทรัล มหาชัย",
          "เซ็นทรัล แจ้งวัฒนะ",
          "เซ็นทรัล ศาลายา",
          "เซ็นทรัล นครปฐม",
          "โรบินสัน สมุทรปราการ",
          "อิมพีเรียลเวิลด์ สำโรง",
          "เซ็นทรัล เวสต์เกต",
          "โรบินสัน สุวรรณภูมิ",
          "แฟชั่นไอซ์แลนด์",
        ],
      },
      {
        key: "central",
        label: "ภาคกลาง",
        branches: ["เซ็นทรัล อยุธยา", "โรบินสัน สระบุรี", "เซ็นทรัล นครสวรรค์"],
      },
      {
        key: "east",
        label: "ภาคตะวันออก",
        branches: [
          "เซ็นทรัล ชลบุรี",
          "โรบินสัน ฉะเชิงเทรา",
          "โรบินสัน ชลบุรี อมตะนคร",
          "เซ็นทรัล จันทบุรี",
        ],
      },
      { key: "north", label: "ภาคเหนือ", branches: ["เซ็นทรัล เชียงราย", "เซ็นทรัล ลำปาง"] },
      {
        key: "northeast",
        label: "ภาคตะวันออกเฉียงเหนือ",
        branches: [
          "เซ็นทรัล อุบล",
          "เซ็นทรัล โคราช",
          "เซ็นทรัล อุดร",
          "เซ็นทรัล ขอนแก่น",
          "โรบินสัน บุรีรัมย์",
        ],
      },
      {
        key: "south",
        label: "ภาคใต้",
        branches: [
          "เซ็นทรัล นครศรี",
          "เซ็นทรัล หาดใหญ่",
          "เซ็นทรัล สุราษฎร์ธานี",
          "โรบินสัน ตรัง",
        ],
      },
    ],
  },
  {
    company: "motta",
    label: "Motta",
    // Motta ไม่มีการแบ่งภูมิภาคในเอกสารต้นทาง มีแต่โครงสร้างทีมขาย
    // จึงใช้ทีม (Area Manager) เป็นกลุ่มย่อย — ใช้ข้อมูลจากเอกสารของบริษัทตรงๆ ไม่เดาภูมิภาคเอง
    groupLabel: "ทีม (Area Manager)",
    groups: [
      {
        key: "por",
        label: "ทีมปอ",
        branches: [
          "ลาดพร้าว",
          "เวสเกต",
          "ภูเก็ต",
          "หาดใหญ่",
          "นครศรี",
          "ท่าพระ",
          "ตรัง",
          "สุราษฎร์ธานี",
          "กระบี่",
          "ถลาง",
        ],
      },
      {
        key: "aum",
        label: "ทีมอุ้ม",
        branches: [
          "ศาลายา",
          "นครปฐม",
          "ราชบุรี",
          "พระราม 2",
          "บางแค",
          "มหาชัย",
          "ปิ่นเกล้า",
          "กาญจนบุรี",
          "สามย่าน 1/9",
        ],
      },
      { key: "em", label: "ทีมเอ็ม", branches: ["ซีคอน", "บางกะปิ", "อิสวิล", "งามวงศ์วาน"] },
      {
        key: "ann",
        label: "ทีมแอน",
        branches: [
          "เชียงใหม่เฟส",
          "เชียงราย",
          "ลำปาง",
          "พิษณุโลก",
          "นครสวรรค์",
          "อยุธยา",
          "แอร์พอร์ต",
          "กำแพงเพชร",
          "แม่สอด",
        ],
      },
      {
        key: "beam",
        label: "ทีมบีม",
        branches: [
          "ขอนแก่น",
          "อุดรธานี",
          "นครราชสีมา",
          "เดอะมอลล์โคราช",
          "บุรีรัมย์",
          "ขอนแก่นแคมปัส",
          "อิมพีเรียล",
          "แฟชั่น",
          "เซ็นทรัลเวิลด์",
        ],
      },
      {
        key: "may",
        label: "ทีมเมย์",
        branches: [
          "อุบลราชธานี",
          "ร้อยเอ็ด",
          "สกลนคร",
          "มุกดาหาร",
          "เสริมไทย",
          "สุรินทร์",
          "แจ้งวัฒนะ",
        ],
      },
      {
        key: "por-new",
        label: "ทีมปอ New",
        branches: ["สุพรรณบุรี", "ฟิวเจอร์", "สระบุรี", "พระราม 9", "ศรีสมาน"],
      },
      { key: "mali", label: "ทีมมะลิ", branches: ["บ่อวิน", "ปราจีน", "แพชชั่น", "ระยอง"] },
      {
        key: "nan",
        label: "ทีมแนน",
        branches: [
          "ฉะเชิงเทรา",
          "ศรีราชา",
          "ชลบุรี",
          "สมุทรปราการ",
          "ลพบุรี",
          "ทรูดิจิตอล",
        ],
      },
      {
        key: "baitong",
        label: "ทีมใบตอง",
        branches: [
          "พัทยา",
          "อมตะ",
          "สุวรรณภูมิ",
          "นอร์ทวิลล์",
          "จันทบุรี",
          "บ้านฉาง",
        ],
      },
    ],
  },
  {
    company: "central",
    label: COMPANY_LABEL.central,
    groupLabel: "หน่วยงาน",
    groups: [
      {
        key: "hq",
        label: "สำนักงานและคลัง",
        branches: ["สำนักงานใหญ่", "คลัง IT", "ห้องเซิร์ฟเวอร์"],
      },
    ],
  },
];


// The directory seeds new stores; subsequent edits live in the shared data volume.
function seedBranches(): Branch[] {
  return BRANCH_DIRECTORY.flatMap(c => c.groups.flatMap(g => g.branches.map(name => ({
    id: newId(), company: c.company, name, group: g.label, floor: null,
    sale_manager: null, area_manager: c.company === "motta" ? g.label : null,
    active: true, created_at: new Date().toISOString(),
  }))));
}
export function listAllBranches(): Branch[] {
  return readCollection<Branch>("branches", seedBranches);
}
export function listBranches(company?: CompanyCode): Branch[] {
  return listAllBranches().filter(b => b.active !== false && (!company || b.company === company));
}
function normalize(name: string): string { return name.replace(/\s+/g, "").toLowerCase(); }
export function findBranchesByName(name: string, company?: CompanyCode): Branch[] {
  return listAllBranches().filter(b => normalize(b.name) === normalize(name) && (!company || b.company === company));
}
export function getBranchById(id: string): Branch | null {
  return listAllBranches().find(b => b.id === id) ?? null;
}
type BranchInput = Pick<Branch, "company" | "name"> & Partial<Pick<Branch, "group" | "floor" | "sale_manager" | "area_manager">>;
export function createBranch(input: BranchInput): Branch {
  return upsertOne<Branch>("branches", {
    id: newId(), company: input.company, name: input.name.trim(),
    group: input.group?.trim() || null, floor: input.floor?.trim() || null,
    sale_manager: input.sale_manager?.trim() || null, area_manager: input.area_manager?.trim() || null,
    active: true, created_at: new Date().toISOString(),
  }, seedBranches);
}
export function updateBranch(id: string, patch: Partial<Pick<Branch, "name" | "group" | "floor" | "sale_manager" | "area_manager" | "active">>): Branch | null {
  return patchOne<Branch>("branches", id, patch, seedBranches);
}
export function activateBranch(id: string) { return updateBranch(id, { active: true }); }
export function deactivateBranch(id: string) { return updateBranch(id, { active: false }); }
export function deleteBranch(id: string): boolean {
  const rows = listAllBranches();
  if (!rows.some(b => b.id === id)) return false;
  writeCollection("branches", rows.filter(b => b.id !== id));
  return true;
}
export interface BranchResolution {
  branch: string; company: CompanyCode; companyLabel: string; groupKey: string; groupLabel: string;
}
function groupKey(branch: Branch): string {
  return BRANCH_DIRECTORY.find(c => c.company === branch.company)?.groups.find(g => g.label === branch.group)?.key ?? branch.group ?? "other";
}
export function resolveBranch(name: string | null | undefined): BranchResolution | null {
  if (!name) return null;
  const matches = findBranchesByName(name);
  if (matches.length !== 1) return null;
  const hit = matches[0];
  return { branch: hit.name, company: hit.company, companyLabel: COMPANY_LABEL[hit.company],
    groupKey: groupKey(hit), groupLabel: hit.group ?? "อื่นๆ" };
}
export function companiesWithBranch(name: string): CompanyCode[] {
  return [...new Set(findBranchesByName(name).filter(b => b.active !== false).map(b => b.company))];
}
export interface BranchOption { value: string; label: string; sub: string | null; count: number; }
export function listBranchOptions(input: {
  level: "company" | "group" | "branch"; company?: string | null; group?: string | null;
}): { options: BranchOption[]; total: number } {
  const rows = listBranches();
  let options: BranchOption[];
  if (input.level === "company") {
    options = BRANCH_DIRECTORY.map(c => ({ value: c.company, label: c.label, sub: null,
      count: rows.filter(b => b.company === c.company).length }));
  } else {
    const branches = rows.filter(b => b.company === input.company);
    if (input.level === "group") {
      options = [...new Set(branches.map(groupKey))].map(key => ({ value: key,
        label: branches.find(b => groupKey(b) === key)?.group ?? "อื่นๆ", sub: null,
        count: branches.filter(b => groupKey(b) === key).length }));
    } else {
      options = branches.filter(b => groupKey(b) === input.group).map(b => ({ value: b.name, label: b.name, sub: null, count: 1 }));
    }
  }
  return { options, total: options.reduce((n, o) => n + o.count, 0) };
}
