// รายชื่อบริษัท + ตัวช่วยที่ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และฝั่งเบราว์เซอร์
//
// ทำไมต้องแยกไฟล์นี้ออกจาก db/branches.ts:
// db/branches.ts เรียกผ่าน db/store.ts ซึ่ง import `node:fs` — โมดูลที่มีอยู่แต่ฝั่งเซิร์ฟเวอร์
// พอ client component ("use client") import อะไรก็ตามจากไฟล์นั้น bundler จะลาก fs เข้ามาใน
// bundle ของเบราว์เซอร์ด้วย แล้ว build ล้มทั้งหน้าด้วย
//   "the chunking context does not support external modules (request: node:fs)"
//
// ค่าคงที่พวกนี้เป็นข้อมูลล้วนๆ ไม่ต้องอ่านไฟล์ จึงอยู่ตรงนี้ได้ และหน้าเว็บฝั่ง client
// (ตัวกรองบริษัทในหน้า Tickets) import จากที่นี่แทน ส่วน db/branches.ts re-export ต่อ
// เพื่อให้โค้ดฝั่งเซิร์ฟเวอร์ที่ import จากที่เดิมอยู่แล้วไม่ต้องแก้

import type { Company, CompanyCode } from "./types";

/** บริษัททั้งหมดในระบบ — จงใจ hardcode ไม่ให้แก้จากหน้าเว็บ
 *
 *  เหตุผล: ค่า company ถูกเก็บลงทุก ticket และใช้เป็นตัวกรองในรายงาน
 *  ถ้าปล่อยให้ลบ/เปลี่ยนรหัสบริษัทได้ ticket เก่าจะชี้ไปยังบริษัทที่ไม่มีอยู่แล้วทันที
 *  การเพิ่มบริษัทใหม่เป็นเรื่องที่เกิดไม่บ่อย (ระดับปีละครั้ง) แก้โค้ดตรงนี้คุ้มกว่าความเสี่ยงนั้น */
export const COMPANIES: Company[] = [
  { code: "montipa", name: "Montipa", short_name: "Montipa" },
  { code: "motta", name: "Motta", short_name: "Motta" },
  { code: "central", name: "สำนักงานใหญ่", short_name: "สำนักงานใหญ่" },
];

export const COMPANY_CODES = COMPANIES.map((c) => c.code);

export function isCompanyCode(value: unknown): value is CompanyCode {
  return typeof value === "string" && COMPANY_CODES.includes(value as CompanyCode);
}

/** ชื่อบริษัทสำหรับแสดงผล — คืน "-" เมื่อ ticket เก่าที่ยังไม่มีข้อมูลบริษัท */
export function companyLabel(code: string | null | undefined): string {
  if (!code) return "-";
  return COMPANIES.find((c) => c.code === code)?.name ?? code;
}

export const COMPANY_LABEL: Record<CompanyCode, string> = { montipa: "Montipa", motta: "Motta", central: "สำนักงานใหญ่" };
