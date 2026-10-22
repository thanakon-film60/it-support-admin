import type { Branch, CompanyCode } from "../types";
import { readCollection, upsertOne, patchOne, writeCollection } from "./store";
import { newId } from "../utils";
import { COMPANY_LABEL } from "../companies";
export { COMPANIES, COMPANY_LABEL, isCompanyCode } from "../companies";

/* ─────────────────────────────────────────────────────────────────────────────
   ทะเบียนสาขาของทั้งกลุ่มบริษัท — แหล่งข้อมูลจริงที่เดียวของระบบ

   ที่มาของข้อมูล:
     • Montipa — ตาราง "สาขาที่รับผิดชอบของทีมขาย MONTIPA เดือน ตุลาคม 2026" (30 สาขา 7 เขต Area Manager ใต้ ROM 2 คน
                 — อัปเดต 15 ต.ค. 2026 · ชื่อสาขามาจากใบประกาศ "สาขาเปิดให้บริการ" 1/9/69 ซึ่งเดิมแบ่งตามภูมิภาค)
     • Motta   — ตารางโครงสร้าง Sale Manager / Area Manager (71 สาขา 10 เขต — อัปเดต 13 ต.ค. 2026)
     • ส่วนกลาง — สำนักงานและคลังของบริษัท ไม่ใช่หน้าร้าน

   ตารางนี้ใช้สร้าง data/branches.json ครั้งแรกเท่านั้น หลังจากนั้นจัดการสาขาผ่านหน้าเว็บ
   เมนู LINE และฟอร์มแจ้งเรื่องอ่านจากทะเบียนเดียวกัน รวมถึงสถานะเปิด/ปิดใช้งาน

   ⚠️ แก้ตารางนี้อย่างเดียว เครื่องที่ใช้งานอยู่แล้วจะไม่เห็นอะไรเปลี่ยน (seed ทำงานแค่ตอนยังไม่มีไฟล์)
   โครงสร้างเขตที่ต้องลงไปถึงข้อมูลจริงให้ทำผ่าน syncCompanyAreas() แล้วขยับเวอร์ชันของบริษัทนั้น (ดู AREA_SYNCS)
   ───────────────────────────────────────────────────────────────────────────── */

export interface BranchGroup {
  /** ใช้เป็นค่าใน postback / query string — ห้ามเปลี่ยนพร่ำเพรื่อ */
  key: string;
  /** ห้ามซ้ำกันในบริษัทเดียวกัน — groupKey() หา key จากป้ายนี้ */
  label: string;
  /** ผู้จัดการตามตารางโครงสร้างทีมขาย (เหนือ AM: Motta = Sale Manager · Montipa = ROM) — แสดงในเมนูเลือกเขตของบอท และหน้า "สาขา" */
  saleManager?: string;
  areaManager?: string;
  branches: string[];
  /** สาขาในเขตนี้ที่ตารางบอกว่าปิดแล้ว — seed เป็นปิดใช้งาน และซิงก์ปิดให้ครั้งเดียวตอนย้ายเข้าเขตนี้
   *  (แอดมินเปิดกลับเองได้ที่หน้า "สาขา" — ซิงก์รอบหลังไม่ปิดซ้ำ เพราะสาขาอยู่เขตนี้แล้ว) */
  closed?: string[];
}

export interface CompanyEntry {
  company: CompanyCode;
  label: string;
  /** คำอธิบายว่ากลุ่มย่อยคืออะไร (เขตของ Area Manager · หน่วยงาน) */
  groupLabel: string;
  /** ตำแหน่งของคนที่อยู่เหนือ AM (ช่อง sale_manager) — บรรทัดรองในเมนูเลือกเขตของบอทใช้คำนี้ (ไม่ใส่ = "Sale Manager") */
  managerTitle?: string;
  groups: BranchGroup[];
}

export const BRANCH_DIRECTORY: CompanyEntry[] = [
  {
    company: "montipa",
    label: "Montipa",
    // แบ่งตามเขตของ Area Manager ตามตาราง "สาขาที่รับผิดชอบของทีมขาย MONTIPA เดือน ตุลาคม 2026"
    // (ผู้ใช้ส่งมา 15 ต.ค. 2026 ขอให้แยกตามผู้ดูแลแทนการแบ่งตามภาค) — พนักงานหน้าร้านรู้ว่าตัวเองอยู่ทีม AM คนไหน
    // แม่นกว่ารู้ว่าสาขาอยู่ภาคไหน และเป็นแบบเดียวกับ Motta
    //   • เหนือ AM คือ ROM 2 คน (ทีม 1 คุณปุ้มปุ้ย · ทีม 2 คุณมิ้นท์) — เก็บในช่อง sale_manager แบบ Sale Manager ของ Motta
    //   • ROM รักษาการ AM เองด้วย ("Area manager - Acting") จึงมีเขตชื่อ ROM อยู่ด้วย
    //   • ชื่อสาขาคงตามทะเบียนเดิม (ตารางใช้ชื่อย่อ เช่น "อมตะ" = โรบินสัน ชลบุรี อมตะนคร) — ticket เก่าอ้างชื่อเหล่านี้อยู่
    //   • Event ชั่วคราวในตาราง (ร้อยเอ็ด 22/9–22/12/69 · รังสิต 15–26/10/69 ทีมจอย) ไม่ใช่สาขา จึงไม่ใส่ —
    //     ถ้าทีม event ต้องแจ้งเรื่องได้ ให้เพิ่มเองที่หน้า "สาขา" ใส่กลุ่ม "ทีมจอย" แล้วปิดใช้งานเมื่อจบงาน
    groupLabel: "เขต (Area Manager)",
    managerTitle: "ROM",
    groups: [
      {
        key: "pui",
        label: "ทีมปุ้ย",
        saleManager: "ปุ้มปุ้ย",
        areaManager: "ปุ้ย (ROM รักษาการ)",
        branches: [
          "เซ็นทรัล หาดใหญ่",
          "โรบินสัน ตรัง",
          "เดอะมอลล์ไลฟ์สโตร์ บางกะปิ",
          "เซ็นทรัล นครศรี",
          "เซ็นทรัล เวสต์เกต",
          "เซ็นทรัล พระราม 2",
          "เซ็นทรัล แจ้งวัฒนะ",
          "เซ็นทรัล อุดร",
          "เซ็นทรัล นครปฐม",
          "โรบินสัน สระบุรี",
          "เซ็นทรัล ศาลายา",
        ],
      },
      { key: "ket", label: "ทีมเกตุ", saleManager: "ปุ้มปุ้ย", areaManager: "เกตุ", branches: ["เซ็นทรัล สุราษฎร์ธานี"] },
      {
        key: "koy",
        label: "ทีมก้อย",
        saleManager: "ปุ้มปุ้ย",
        areaManager: "ก้อย",
        branches: ["เซ็นทรัล โคราช", "เซ็นทรัล ขอนแก่น", "เซ็นทรัล อุบล", "โรบินสัน บุรีรัมย์"],
      },
      { key: "joy", label: "ทีมจอย", saleManager: "ปุ้มปุ้ย", areaManager: "จอย", branches: ["แฟชั่นไอซ์แลนด์", "เซ็นทรัล มหาชัย"] },
      {
        key: "mint",
        label: "ทีมมิ้นท์",
        saleManager: "มิ้นท์",
        areaManager: "มิ้นท์ (ROM รักษาการ)",
        branches: [
          "อิมพีเรียลเวิลด์ สำโรง",
          "เซ็นทรัล อยุธยา",
          "เซ็นทรัล ชลบุรี",
          "โรบินสัน ชลบุรี อมตะนคร",
          "โรบินสัน สุวรรณภูมิ",
          "เซ็นทรัล จันทบุรี",
          "โรบินสัน สมุทรปราการ",
          "โรบินสัน ฉะเชิงเทรา",
          "เซ็นทรัล ลำปาง",
        ],
        // ตารางเขียนว่า "ลำปาง (ปิด 10/10/69)" — ยังอยู่ในเขตนี้ให้ประวัติบอกได้ว่าเคยอยู่ทีมไหน แต่ไม่โผล่ในเมนูแจ้งเรื่อง
        closed: ["เซ็นทรัล ลำปาง"],
      },
      { key: "pop", label: "ทีมป๊อป", saleManager: "มิ้นท์", areaManager: "ป๊อป", branches: ["เซ็นทรัล พระราม 9"] },
      {
        key: "tubtim",
        label: "ทีมทับทิม",
        saleManager: "มิ้นท์",
        areaManager: "ทับทิม",
        branches: ["เซ็นทรัล เชียงราย", "เซ็นทรัล นครสวรรค์"],
      },
    ],
  },
  {
    company: "motta",
    label: "Motta",
    // Motta ไม่มีการแบ่งภูมิภาคในเอกสารต้นทาง มีแต่โครงสร้างทีมขาย — ใช้ "เขตของ Area Manager" เป็นกลุ่มย่อย
    // ตามตาราง Sale Manager / Area Manager ของบริษัทตรงๆ (F:\GitHub\Area-office\S__146137128.jpg, ต.ค. 2026)
    // พนักงานหน้าร้านรู้ว่าตัวเองอยู่เขตของ AM คนไหน จึงเลือกเขตก่อนแล้วค่อยเลือกสาขาในบอท
    groupLabel: "เขต (Area Manager)",
    groups: [
      {
        key: "por",
        label: "ทีมปอ",
        saleManager: "ต่อ",
        areaManager: "ปอ",
        branches: [
          "ลาดพร้าว",
          "เวสต์เกสต์",
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
        saleManager: "นัน",
        areaManager: "อุ้ม",
        branches: ["อีสวิลล์", "สามย่าน", "บางแค", "ปิ่นเกล้า", "ราชบุรี", "กาญจนบุรี"],
      },
      {
        key: "em",
        label: "ทีมเอ็ม",
        saleManager: "นัน",
        areaManager: "เอ็ม",
        branches: [
          "บางกะปิ",
          "ซีคอนศรีนครินทร์",
          "พระราม 2",
          "งามวงศ์วาน",
          "มหาชัย",
          "ศาลายา",
          "นครปฐม",
          "The Street", // สาขาใหม่ เปิด 16 ต.ค. 2026
        ],
      },
      {
        key: "ann",
        label: "ทีมแอน",
        saleManager: "อีฟ",
        areaManager: "แอน",
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
        saleManager: "อีฟ",
        areaManager: "บีม",
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
          "ชัยภูมิ", // สาขาใหม่ เปิด 8 ต.ค. 2026
        ],
      },
      {
        key: "may",
        label: "ทีมเมย์",
        saleManager: "อีฟ",
        areaManager: "เมย์",
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
        // AM ชื่อปอเหมือนเขตแรก แต่อยู่ใต้ Sale Manager คนละคน (อีฟ) — ป้ายต้องไม่ซ้ำกัน ไม่งั้นเมนูมี
        // "ทีมปอ" สองแถวที่แยกไม่ออก และ groupKey() ที่หา key จากป้ายจะชี้ไปเขตแรกทั้งคู่
        key: "por-new",
        label: "ทีมปอ New",
        saleManager: "อีฟ",
        areaManager: "ปอ",
        branches: ["สุพรรณบุรี", "ฟิวเจอร์", "สระบุรี", "พระราม 9", "ศรีสมาน"],
      },
      {
        key: "mali",
        label: "ทีมมะลิ",
        saleManager: "มะลิ",
        areaManager: "มะลิ",
        branches: ["บ่อวิน", "ปราจีน", "แพชชั่น", "ระยอง"],
      },
      {
        key: "nan",
        label: "ทีมแนน",
        saleManager: "มะลิ",
        areaManager: "แนน",
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
        saleManager: "มะลิ",
        areaManager: "ใบตอง",
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
    sale_manager: g.saleManager ?? null, area_manager: g.areaManager ?? null,
    active: !isClosedIn(g, name), created_at: new Date().toISOString(),
  }))));
}

/** ตารางบอกว่าสาขานี้ปิดแล้ว (BranchGroup.closed) */
function isClosedIn(g: BranchGroup, name: string): boolean {
  return (g.closed ?? []).some((n) => normalize(n) === normalize(name));
}

/* ─────────────────────────────────────────────────────────────────────────────
   ซิงก์โครงสร้างเขต (Motta · Montipa) ลงข้อมูลจริง — ครั้งเดียวต่อ 1 เวอร์ชันของแต่ละบริษัท (แบบเดียวกับ ensureEmployeeRegistry)

   ทำไมต้องมี: เครื่องที่ใช้งานอยู่มี data/branches.json แล้ว seed จึงไม่ทำงานอีก ตารางเขตใหม่ของบริษัท
   (13 ต.ค. 2026 Motta: ย้ายสาขาระหว่างเขตอุ้ม/เอ็ม · ระบุ Sale Manager ครบ · เพิ่มชัยภูมิ + The Street ·
    15 ต.ค. 2026 Montipa: เลิกแบ่งตามภูมิภาค มาแบ่งตามเขตของ Area Manager · ลำปางปิด)
   จะไม่ไปถึงเมนูในบอทเลย ถ้าไม่มีตัวซิงก์นี้

   หลักที่ยึด:
     • จับคู่ด้วยชื่อ (ไม่สนช่องว่าง/ตัวพิมพ์) + ชื่อเดิมใน MOTTA_RENAMED — แก้แถวเดิม (id เดิม) ไม่สร้างแถวใหม่ซ้ำ
     • แตะเฉพาะสาขาของบริษัทนั้นที่อยู่ในตาราง: ชื่อ · เขต (group) · Area/Sale Manager (ROM) — ไม่แตะชั้น และไม่แตะ
       เปิด/ปิดใช้งาน ยกเว้นสาขาที่ตารางบอกว่าปิดแล้ว (closed) ซึ่งปิดให้ครั้งเดียวตอนย้ายเข้าเขต
       สาขาที่แอดมินเพิ่มเองนอกตารางปล่อยไว้ตามเดิม
     • ticket เก่าเก็บชื่อสาขาเป็นข้อความ + รหัสบริษัทของมันเอง การเปลี่ยนชื่อสาขาจึงไม่ทำให้ ticket เก่าเสีย
   ───────────────────────────────────────────────────────────────────────────── */

/** ขยับค่านี้ทุกครั้งที่แก้โครงสร้างเขต Motta ใน BRANCH_DIRECTORY ที่ต้องลงไปถึงเครื่องที่ใช้งานอยู่ */
export const BRANCH_REGISTRY_VERSION = "2026-10-13";
/** แบบเดียวกันของ Montipa — แยกเวอร์ชันกัน ขยับตารางบริษัทหนึ่งแล้วไม่ไปซิงก์อีกบริษัทซ้ำ */
export const MONTIPA_AREAS_VERSION = "2026-10-15";

/** ชื่อเดิมในทะเบียน -> ชื่อตามตารางเขตล่าสุด ("สามย่าน 1/9" คือวันที่เปิดสาขาที่ติดมากับตารางรุ่นก่อน) */
export const MOTTA_RENAMED: Readonly<Record<string, string>> = {
  "เวสเกต": "เวสต์เกสต์",
  "อิสวิล": "อีสวิลล์",
  "ซีคอน": "ซีคอนศรีนครินทร์",
  "สามย่าน 1/9": "สามย่าน",
};

const META_COLLECTION = "registry_meta";

interface BranchRegistryMeta {
  id: string;
  version: string;
  synced_at: string;
  added: number;
  updated: number;
}

/** ปรับแถวสาขาของบริษัทหนึ่งให้ตรงตารางเขตใน BRANCH_DIRECTORY — คืนจำนวนที่เพิ่ม/แก้ (rows ถูกแก้ในที่) */
export function syncCompanyAreas(
  rows: Branch[],
  company: CompanyCode,
  renamed: Readonly<Record<string, string>> = {},
): { added: number; updated: number } {
  const entry = BRANCH_DIRECTORY.find((c) => c.company === company);
  if (!entry) return { added: 0, updated: 0 };
  const oldNamesOf = (name: string) =>
    Object.entries(renamed).filter(([, now]) => normalize(now) === normalize(name)).map(([old]) => normalize(old));
  const used = new Set<string>();
  let added = 0;
  let updated = 0;
  for (const g of entry.groups) {
    for (const name of g.branches) {
      const mine = (b: Branch) => b.company === company && !used.has(b.id);
      const hit =
        rows.find((b) => mine(b) && normalize(b.name) === normalize(name)) ??
        rows.find((b) => mine(b) && oldNamesOf(name).includes(normalize(b.name)));
      const want = { name, group: g.label, area_manager: g.areaManager ?? null, sale_manager: g.saleManager ?? null };
      const closed = isClosedIn(g, name);
      if (!hit) {
        rows.push({ id: newId(), company, floor: null, active: !closed, created_at: new Date().toISOString(), ...want });
        added += 1;
        continue;
      }
      used.add(hit.id);
      // ชื่อที่ต่างแค่ช่องว่าง (เช่น "พระราม2" กับ "พระราม 2") คงของเดิมไว้ — ไม่ต้องเปลี่ยนชื่อให้ ticket เก่าดูไม่ตรง
      const patch: Partial<Branch> = { ...want, name: normalize(hit.name) === normalize(name) ? hit.name : name };
      // สาขาที่ตารางบอกว่าปิดแล้ว: ปิดใช้งานเฉพาะตอนย้ายเข้าเขตนี้ครั้งแรก
      // แอดมินเปิดกลับเองทีหลัง (เช่นกลับมาเปิดใหม่) ซิงก์รอบหน้าจะไม่ปิดซ้ำ เพราะตอนนั้นสาขาอยู่เขตนี้แล้ว
      if (closed && hit.group !== g.label) patch.active = false;
      if (Object.entries(patch).some(([k, v]) => hit[k as keyof Branch] !== v)) {
        Object.assign(hit, patch);
        updated += 1;
      }
    }
  }
  return { added, updated };
}

/** Motta: ตาราง Sale Manager / Area Manager (13 ต.ค. 2026) */
export function syncMottaAreas(rows: Branch[]): { added: number; updated: number } {
  return syncCompanyAreas(rows, "motta", MOTTA_RENAMED);
}

/** Montipa: ย้ายจากภูมิภาคไปเขตของ Area Manager ตามตารางทีมขาย ต.ค. 2026 (15 ต.ค. 2026) */
export function syncMontipaAreas(rows: Branch[]): { added: number; updated: number } {
  return syncCompanyAreas(rows, "montipa");
}

/** ตารางเขตที่ต้องซิงก์ลงข้อมูลจริง — เวอร์ชัน (และแถวใน registry_meta) แยกต่อบริษัท
 *  ขยับตาราง Montipa แล้วต้องไม่ไปซิงก์ Motta ซ้ำ: ซิงก์ซ้ำ = เขียนทับเขต/ผู้จัดการที่แอดมินแก้เองในหน้าเว็บหลังรอบก่อน
 *  (id "branches" คือของ Motta มาตั้งแต่ก่อนแยก — คงไว้ เครื่องที่ซิงก์ Motta ไปแล้วจะได้ไม่ซิงก์ซ้ำ) */
const AREA_SYNCS = [
  { id: "branches", version: BRANCH_REGISTRY_VERSION, sync: syncMottaAreas },
  { id: "branches-montipa", version: MONTIPA_AREAS_VERSION, sync: syncMontipaAreas },
] as const;

/** ซิงก์ให้เองครั้งเดียวต่อ 1 เวอร์ชัน — เรียกได้ทุก request (อ่านไฟล์เล็ก 1 ไฟล์ + เทียบสตริง) */
export function ensureBranchRegistry(): void {
  const meta = readCollection<BranchRegistryMeta>(META_COLLECTION, () => []);
  const pending = AREA_SYNCS.filter((s) => meta.find((m) => m.id === s.id)?.version !== s.version);
  if (pending.length === 0) return;
  const rows = readCollection<Branch>("branches", seedBranches);
  const results = pending.map((s) => ({ id: s.id, version: s.version, result: s.sync(rows) }));
  if (results.some(({ result }) => result.added > 0 || result.updated > 0)) writeCollection("branches", rows);
  for (const { id, version, result } of results) {
    upsertOne<BranchRegistryMeta>(
      META_COLLECTION,
      { id, version, synced_at: new Date().toISOString(), ...result },
      () => []
    );
  }
}

export function listAllBranches(): Branch[] {
  ensureBranchRegistry();
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

/** ลำดับตามตารางของบริษัท (ไม่ใช่ลำดับในไฟล์ข้อมูล) — สาขาที่ย้ายเขตหรือเพิ่มทีหลังจะไปต่อท้ายไฟล์
 *  ถ้าเรียงตามไฟล์ เมนูในบอทจะสลับลำดับไปเรื่อยๆ ทุกครั้งที่มีการแก้ — ของที่ไม่อยู่ในตารางไปอยู่ท้ายสุด */
function directoryRank(company: string | null | undefined, groupKeyValue: string, branchName?: string): number {
  const groups = BRANCH_DIRECTORY.find(c => c.company === company)?.groups ?? [];
  const gi = groups.findIndex(g => g.key === groupKeyValue);
  if (branchName === undefined) return gi === -1 ? Number.MAX_SAFE_INTEGER : gi;
  const bi = gi === -1 ? -1 : groups[gi].branches.findIndex(n => normalize(n) === normalize(branchName));
  return bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
}

/** บรรทัดรองใต้ชื่อเขตในเมนูของบอท: ผู้จัดการเหนือ AM (Sale Manager / ROM) + สาขาตัวอย่าง
 *  — คนจำสาขาตัวเองได้แม่นกว่าจำชื่อเขต */
function groupSub(company: string | null | undefined, branches: Branch[]): string | null {
  const names = branches.map(b => b.name);
  const sample = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
  const managers = [...new Set(branches.map(b => b.sale_manager?.trim()).filter((m): m is string => Boolean(m)))];
  const title = BRANCH_DIRECTORY.find(c => c.company === company)?.managerTitle ?? "Sale Manager";
  const head = managers.length === 1 ? `${title}: ${managers[0]}` : null;
  return [head, sample].filter(Boolean).join(" · ") || null;
}

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
    const byRank = (key: string) => (a: Branch, b: Branch) =>
      directoryRank(input.company, key, a.name) - directoryRank(input.company, key, b.name);
    if (input.level === "group") {
      const keys = [...new Set(branches.map(groupKey))]
        .sort((a, b) => directoryRank(input.company, a) - directoryRank(input.company, b));
      options = keys.map(key => {
        const members = branches.filter(b => groupKey(b) === key).sort(byRank(key));
        return { value: key, label: members[0]?.group ?? "อื่นๆ", sub: groupSub(input.company, members), count: members.length };
      });
    } else {
      const group = input.group ?? "";
      options = branches.filter(b => groupKey(b) === group).sort(byRank(group))
        .map(b => ({ value: b.name, label: b.name, sub: null, count: 1 }));
    }
  }
  return { options, total: options.reduce((n, o) => n + o.count, 0) };
}
