import { randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

/** ตั้งชื่อ ticket_code ให้ตรงรูปแบบต้นแบบ: PREFIX + YYYYMM (พ.ศ.) + running number 3 หลัก */
const TICKET_PREFIX: Record<string, string> = {
  repair: "ITSR",
  withdraw: "ITRQ",
  return: "ITRT",
  it_service: "ITSV",
};

export function generateTicketCode(
  type: keyof typeof TICKET_PREFIX,
  existingCodesOfType: string[]
): string {
  const now = new Date();
  const buddhistYear = now.getFullYear() + 543;
  const yyyymm = `${buddhistYear}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = TICKET_PREFIX[type];
  const stem = `${prefix}${yyyymm}`;
  const runningNumbers = existingCodesOfType
    .filter((c) => c.startsWith(stem))
    .map((c) => parseInt(c.slice(stem.length), 10))
    .filter((n) => !Number.isNaN(n));
  const next = (runningNumbers.length ? Math.max(...runningNumbers) : 0) + 1;
  return `${stem}${String(next).padStart(3, "0")}`;
}

/** แปลง Date/ISO string เป็นรูปแบบวันที่ไทย (พ.ศ.) แบบสั้น เช่น "11 ก.ย. 69 18:51" ให้ตรงต้นแบบ */
const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

export function formatThaiDateShort(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const month = THAI_MONTHS_SHORT[d.getMonth()];
  const yy = String((d.getFullYear() + 543) % 100).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${yy} ${hh}:${mm}`;
}

export function formatThaiDateFull(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const month = THAI_MONTHS_SHORT[d.getMonth()];
  const yyyy = d.getFullYear() + 543;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${day}/${d.getMonth() + 1}/${yyyy} ${hh}:${mm}:${ss}`;
}

/** อายุแบบ "0ปี 1ด." นับจากวันที่ที่ระบุถึงวันนี้ */
export function ageFrom(iso: string | null): string {
  if (!iso) return "-";
  const start = new Date(iso);
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return `${years}ปี ${months}ด.`;
}

export function formatBaht(n: number | null): string {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

/** แปลง array ของ object เป็น CSV string (ใช้ฝั่ง client เพื่อ export ปุ่ม "Export CSV") */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; header: string }[]
): string {
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = columns.map((c) => escape(c.header)).join(",");
  const body = rows
    .map((r) => columns.map((c) => escape(r[c.key])).join(","))
    .join("\n");
  return `﻿${header}\n${body}`; // BOM นำหน้าให้ Excel เปิดภาษาไทยไม่เพี้ยน
}
