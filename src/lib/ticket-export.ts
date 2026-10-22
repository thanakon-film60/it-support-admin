// ส่งออกรายการ Tickets เป็นไฟล์ .xlsx — ใช้ได้ทั้งฝั่ง client (ปุ่มในหน้าเว็บ) และ node (เทสต์) ไม่แตะ db
//
// ทำไม .xlsx ไม่ใช่ CSV แบบเดิม: ทีมพิมพ์/แนบรายงานส่ง และเปิดด้วย Excel ทุกครั้ง — CSV ภาษาไทยเพี้ยนเป็นอักษรต่างดาว
// ถ้าเครื่องไม่ได้ตั้ง UTF-8 · วันที่เป็นแค่ข้อความ เรียง/กรองตามเดือนไม่ได้ · ค่าซ่อมเป็นข้อความ "1,200" รวมยอดไม่ได้
// ไฟล์นี้จึงเขียนวันที่เป็น "วันที่จริงของ Excel" และตัวเลขเป็นตัวเลขจริงทุกช่อง
//
// รับโมดูล xlsx เป็นพารามิเตอร์ ไม่ import เอง: หน้าเว็บโหลด xlsx (~400 KB) ตอนกดปุ่มส่งออกเท่านั้น
// (dynamic import) ถ้า import ตรงนี้ ทุกคนที่เปิดหน้า Tickets ต้องโหลดไลบรารีทั้งก้อนทั้งที่ไม่ได้ส่งออก

import type * as XLSXModule from "xlsx";
import type { TicketWithRelations } from "./types";
import { TICKET_TYPE_LABEL } from "./labels";
import { TICKET_STATUS_LABEL, TICKET_STATUS_ORDER } from "./ticket-status";
import { formatTicketItems, ticketItems, ticketLineName } from "./ticket-meta";
import { RATING_LOW_MAX, RATING_MAX, closedAt, readRating, summarizeRatings } from "./ticket-feedback";
import { confirmationLeadTimeHours, formatLeadTime, readResolvedBy } from "./ticket-confirmation";

export interface TicketPart {
  name: string;
  qty: number;
  unit: string;
}

export interface TicketExportRow {
  ticket: TicketWithRelations;
  /** อะไหล่ที่เบิกจากสต็อกโดยอ้างเลขที่ตั๋วนี้ */
  parts: TicketPart[];
  /** ผู้แจ้งเปิดดูสถานะกี่ครั้ง */
  views: number;
}

type CellKind = "text" | "date" | "money" | "number";
type CellValue = string | number | null;

interface Column {
  header: string;
  /** ความกว้างเป็นจำนวนตัวอักษร — ภาษาไทยมีสระบน/ล่างไม่กินที่ จึงใช้ค่าน้อยกว่าที่นับได้นิดหน่อย */
  width: number;
  kind: CellKind;
  value: (row: TicketExportRow) => CellValue;
}

const DATE_FORMAT = "dd/mm/yyyy hh:mm";
const MONEY_FORMAT = "#,##0.00";

/** ISO → เลขวันที่ของ Excel ตามเวลาไทย (UTC+7 ไม่มีเวลาออมแสง)
 *  ทำเองแทนการส่ง Date ให้ xlsx: ไลบรารีแปลงตามเขตเวลาของเครื่องที่กดส่งออก — โน้ตบุ๊กที่ตั้งเวลาเป็น UTC
 *  จะได้ไฟล์ที่ทุกเรื่องเร็วไป 7 ชั่วโมง และเรื่องที่แจ้งหลังเที่ยงคืนไทยตกไปอยู่วันก่อนหน้า */
export function excelSerialTH(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return (ms + 7 * 3_600_000) / 86_400_000 + 25_569;
}

function leadHours(t: TicketWithRelations): number | null {
  return t.status === "resolved" ? confirmationLeadTimeHours(t.created_at, closedAt(t)) : null;
}

function resolutionNote(t: TicketWithRelations): string | null {
  const v = t.meta?.resolution_note;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const COLUMNS: Column[] = [
  { header: "เลขที่ตั๋ว", width: 16, kind: "text", value: (r) => r.ticket.ticket_code },
  { header: "ประเภท", width: 12, kind: "text", value: (r) => TICKET_TYPE_LABEL[r.ticket.type] ?? r.ticket.type },
  { header: "สถานะ", width: 12, kind: "text", value: (r) => TICKET_STATUS_LABEL[r.ticket.status] ?? r.ticket.status },
  { header: "วันที่แจ้ง", width: 16, kind: "date", value: (r) => excelSerialTH(r.ticket.created_at) },
  {
    header: "วันที่ปิดงาน",
    width: 16,
    kind: "date",
    // เรื่องที่ถูกเปิดกลับยังมีวันปิดรอบก่อนค้างอยู่ — โชว์เฉพาะเรื่องที่ปิดอยู่จริง ไม่งั้นรายงานบอกว่าปิดแล้วทั้งที่ยังทำอยู่
    value: (r) => (r.ticket.status === "resolved" ? excelSerialTH(closedAt(r.ticket)) : null),
  },
  { header: "ระยะเวลาที่ใช้", width: 14, kind: "text", value: (r) => (leadHours(r.ticket) === null ? null : formatLeadTime(leadHours(r.ticket))) },
  {
    header: "ระยะเวลา (ชม.)",
    width: 12,
    kind: "number",
    // ตัวเลขล้วนคู่กับช่องข้อความด้านซ้าย — คนเปิดไฟล์เอาไปหาค่าเฉลี่ย/ทำกราฟต่อได้เลย
    value: (r) => {
      const h = leadHours(r.ticket);
      return h === null ? null : Math.round(h * 10) / 10;
    },
  },
  { header: "ผู้แจ้ง", width: 22, kind: "text", value: (r) => r.ticket.requester?.display_name ?? null },
  { header: "ชื่อ LINE", width: 16, kind: "text", value: (r) => ticketLineName(r.ticket) },
  { header: "แผนก", width: 18, kind: "text", value: (r) => r.ticket.requester?.department ?? null },
  { header: "บริษัท", width: 12, kind: "text", value: (r) => r.ticket.company_label ?? null },
  { header: "สาขา", width: 20, kind: "text", value: (r) => r.ticket.location || null },
  {
    header: "ทรัพย์สิน",
    width: 24,
    kind: "text",
    value: (r) => (r.ticket.equipment ? [r.ticket.equipment.asset_code, r.ticket.equipment.brand_model].filter(Boolean).join(" — ") : null),
  },
  { header: "รายการเบิก", width: 24, kind: "text", value: (r) => formatTicketItems(ticketItems(r.ticket)) || null },
  { header: "อาการ / รายละเอียด", width: 40, kind: "text", value: (r) => r.ticket.description || null },
  { header: "วิธีแก้ไข / หมายเหตุล่าสุด", width: 40, kind: "text", value: (r) => resolutionNote(r.ticket) },
  { header: "อะไหล่ที่เบิก", width: 24, kind: "text", value: (r) => r.parts.map((p) => `${p.name} x${p.qty} ${p.unit}`.trim()).join(", ") || null },
  { header: "ค่าซ่อม (บาท)", width: 12, kind: "money", value: (r) => r.ticket.repair_cost },
  { header: `คะแนน (1-${RATING_MAX})`, width: 10, kind: "number", value: (r) => readRating(r.ticket)?.score ?? null },
  { header: "ความเห็นผู้แจ้ง", width: 30, kind: "text", value: (r) => readRating(r.ticket)?.comment ?? null },
  { header: "ผู้ปิดงาน", width: 16, kind: "text", value: (r) => (r.ticket.status === "resolved" ? readResolvedBy(r.ticket)?.by ?? null : null) },
  { header: "ผู้แจ้งเปิดดู (ครั้ง)", width: 12, kind: "number", value: (r) => r.views },
];

export const TICKET_EXPORT_HEADERS = COLUMNS.map((c) => c.header);

/** ตารางหลัก: แถวแรกเป็นหัวตาราง แถวถัดไปเป็นข้อมูลตามลำดับที่ส่งมา (= ลำดับบนหน้าจอ) */
export function ticketSheetRows(rows: TicketExportRow[]): CellValue[][] {
  return [TICKET_EXPORT_HEADERS, ...rows.map((row) => COLUMNS.map((c) => c.value(row)))];
}

export interface ExportSummaryInput {
  /** ตัวกรองที่ใช้ตอนส่งออก เช่น "สถานะ: แก้ไขแล้ว · ประเภท: แจ้งซ่อม" — กระดาษที่ไม่บอกเงื่อนไข อ่านตัวเลขผิดได้ */
  filters: string;
  exportedAt?: string;
}

const COST_LABEL = "ค่าซ่อมรวม (บาท)";

function summaryRows(rows: TicketExportRow[], input: ExportSummaryInput): CellValue[][] {
  const tickets = rows.map((r) => r.ticket);
  const resolved = tickets.filter((t) => t.status === "resolved");
  const ratings = summarizeRatings(resolved);
  const cost = tickets.reduce((sum, t) => sum + (t.repair_cost ?? 0), 0);
  return [
    ["รายงาน Tickets — ระบบ IT Support"],
    ["ส่งออกเมื่อ", excelSerialTH(input.exportedAt ?? new Date().toISOString())],
    ["ตัวกรองที่ใช้", input.filters || "ทั้งหมด (ไม่ได้กรอง)"],
    [],
    ["จำนวนเรื่องทั้งหมด", tickets.length],
    // นับแยกทีละสถานะ — ห้ามคิด "รอดำเนินการ" จากทั้งหมดลบที่เหลือ ไม่งั้นเพิ่มสถานะเมื่อไหร่ตัวเลขผิดเงียบๆ
    ...TICKET_STATUS_ORDER.map((s) => [TICKET_STATUS_LABEL[s], tickets.filter((t) => t.status === s).length]),
    [COST_LABEL, cost],
    [],
    ["คะแนนเฉลี่ย (เฉพาะเรื่องที่ให้คะแนน)", ratings.average === null ? "-" : Math.round(ratings.average * 100) / 100],
    // อัตราการตอบต้องอยู่คู่ค่าเฉลี่ยเสมอ — เฉลี่ย 5.0 จาก 2 คนในร้อยเรื่องไม่ได้แปลว่าบริการดี
    ["ตอบแบบประเมิน", `${ratings.rated} จาก ${resolved.length} เรื่องที่แก้ไขแล้ว`],
    [`ต้องปรับปรุง (1-${RATING_LOW_MAX} ดาว)`, ratings.low],
  ];
}

/** สร้าง workbook 2 ชีต: "Tickets" (ทุกแถวที่ผ่านตัวกรอง) + "สรุป" */
export function buildTicketWorkbook(
  XLSX: typeof XLSXModule,
  rows: TicketExportRow[],
  input: ExportSummaryInput
): XLSXModule.WorkBook {
  const data = ticketSheetRows(rows);
  // ข้อความทุกช่องเป็นชนิด "s" (ข้อความ) — ค่าที่ขึ้นต้นด้วย = + - @ จึงไม่ถูก Excel รันเป็นสูตร
  // (CSV เดิมต้องเติม ' นำหน้ากันเอง · .xlsx ไม่ต้อง เพราะชนิดของช่องถูกบอกไว้ในไฟล์ตรงๆ)
  const sheet = XLSX.utils.aoa_to_sheet(data);
  COLUMNS.forEach((col, c) => {
    if (col.kind !== "date" && col.kind !== "money") return;
    for (let r = 1; r < data.length; r++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n") cell.z = col.kind === "date" ? DATE_FORMAT : MONEY_FORMAT;
    }
  });
  sheet["!cols"] = COLUMNS.map((c) => ({ wch: c.width }));
  // ปุ่มกรองบนหัวตาราง — คนที่ได้ไฟล์ไปกรองต่อใน Excel ได้ทันทีโดยไม่ต้องกด Data > Filter เอง
  if (sheet["!ref"]) sheet["!autofilter"] = { ref: sheet["!ref"] };

  const summaryData = summaryRows(rows, input);
  const summary = XLSX.utils.aoa_to_sheet(summaryData);
  const exportedCell = summary["B2"];
  if (exportedCell && exportedCell.t === "n") exportedCell.z = DATE_FORMAT;
  // หาแถวค่าซ่อมจากชื่อ ไม่ฟิกเป็น "B8" — จำนวนแถวสถานะข้างบนเปลี่ยนได้ (เพิ่มสถานะ "ยกเลิก" แล้วแถวเลื่อน)
  const costRow = summaryData.findIndex((r) => r[0] === COST_LABEL);
  const costCell = costRow >= 0 ? summary[XLSX.utils.encode_cell({ r: costRow, c: 1 })] : undefined;
  if (costCell && costCell.t === "n") costCell.z = MONEY_FORMAT;
  summary["!cols"] = [{ wch: 34 }, { wch: 40 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Tickets");
  XLSX.utils.book_append_sheet(workbook, summary, "สรุป");
  return workbook;
}

/** ชื่อไฟล์ตามวันที่ไทย — ส่งออกหลังเที่ยงคืนต้องได้วันที่ของวันใหม่ ไม่ใช่วันก่อนหน้าตาม UTC */
export function ticketExportFileName(todayKey: string): string {
  return `tickets-${todayKey}.xlsx`;
}
