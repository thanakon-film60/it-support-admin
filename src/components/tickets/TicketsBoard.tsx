"use client";

import { useMemo, useState } from "react";
import { useServerRows } from "@/lib/use-server-rows";
import { Pagination, usePaginated } from "@/components/ui/Pagination";
import { useRouter } from "next/navigation";
import type { TicketEvent, TicketStatus, TicketType, TicketView, TicketWithRelations } from "@/lib/types";
import type { TicketViewSummary } from "@/lib/db/ticketViews";
import { TICKET_TYPE_LABEL } from "@/lib/labels";
import { TicketStatusBadge, TICKET_STATUS_LABEL, TICKET_STATUS_ORDER, CompanyBadge } from "@/components/ui/Badge";
import { statusLabel } from "@/lib/ticket-status";
import { Button } from "@/components/ui/Button";
import { formatThaiDateShort, formatThaiDateFull, formatBaht } from "@/lib/utils";
import { todayKeyTH } from "@/lib/date-th";
import { TicketStatusModal } from "./TicketStatusModal";
import { ChatTakeoverCard } from "./ChatTakeoverCard";
import { ItemsHint, LineNameHint, TicketItemsBlock } from "./TicketItems";
import { formatTicketItems, ticketItems, ticketLineName } from "@/lib/ticket-meta";
import { SortMenu, SortableTh, useSort } from "@/components/ui/SortControl";
import { COMPANY_LABEL } from "@/lib/companies";
import type { SortColumn } from "@/lib/sorting";
import {
  RATING_LOW_MAX,
  RATING_MAX,
  closedAt,
  isLowScore,
  readRating,
  starText,
  summarizeRatings,
  type RatingSummary,
} from "@/lib/ticket-feedback";
import { confirmationLeadTimeHours, formatLeadTime } from "@/lib/ticket-confirmation";
import { buildTicketWorkbook, ticketExportFileName, type TicketPart } from "@/lib/ticket-export";
import {
  ClearFiltersButton,
  DateRangeFilter,
  FilterBar,
  SelectFilter,
  countActive,
  dateRangeLabel,
  inDateRange,
  optionsFrom,
  useDateRange,
} from "@/components/ui/Filters";

/* หน้า Tickets — ที่เดียวของงานแจ้งเรื่องทั้งหมด (21 ต.ค. 2026 ผู้ใช้ขอ)
 *
 * รวมหน้า "แก้ไขปัญหาแล้ว" กับ "ประวัติซ่อม" เข้ามาที่นี่ทั้งหมด พร้อมกับยุบสถานะเหลือ 2 ค่า:
 *   แท็บ "แก้ไขแล้ว"  = หน้า log เดิม (สรุปคะแนน · ตัวกรองคะแนน · วิธีแก้ · อะไหล่ · ไทม์ไลน์ · ระยะเวลา)
 *   ประเภท "แจ้งซ่อม" = หน้าประวัติซ่อมเดิม (ค่าซ่อม · ทรัพย์สิน · ยอดรวม)
 * เหตุผลที่รวม: ข้อมูลชุดเดียวกันอยู่สามหน้า ทีมต้องเดาว่าเรื่องหนึ่งไปอยู่หน้าไหน และสามหน้าส่งออกคนละรูปแบบ */

const TYPE_OPTIONS: { value: "all" | TicketType; label: string }[] = [
  { value: "all", label: "ทุกประเภท" },
  { value: "repair", label: TICKET_TYPE_LABEL.repair },
  { value: "withdraw", label: TICKET_TYPE_LABEL.withdraw },
  { value: "return", label: TICKET_TYPE_LABEL.return },
  { value: "it_service", label: TICKET_TYPE_LABEL.it_service },
];

/** ตัวกรองคะแนน — "low" คือเรื่องที่ควรตามไปคุยต่อ เป็นเหตุผลหลักที่มีตัวกรองนี้ */
export type RatingFilter = "all" | "satisfied" | "low" | "unrated";
const RATING_FILTER_OPTIONS: Exclude<RatingFilter, "all">[] = ["low", "satisfied", "unrated"];
const RATING_FILTER_LABEL: Record<Exclude<RatingFilter, "all">, string> = {
  low: `★ 1–${RATING_LOW_MAX} (ต้องปรับปรุง)`,
  satisfied: `★ ${RATING_LOW_MAX + 1}–${RATING_MAX} (พอใจ)`,
  unrated: "ยังไม่ให้คะแนน",
};

/** กรองช่วงวันที่ตามวันไหน — "เดือนนี้มีคนแจ้งกี่เรื่อง" กับ "เดือนนี้ปิดไปกี่เรื่อง" เป็นคนละคำถาม
 *  (หน้าแก้ไขปัญหาแล้วเดิมกรองตามวันปิดงาน · หน้า Tickets เดิมกรองตามวันแจ้ง — ต้องเลือกได้ทั้งสองแบบ) */
type DateField = "created" | "closed";

/** คะแนนมีความหมายเฉพาะเรื่องที่ปิดแล้ว — "ยังไม่ให้คะแนน" ไม่นับเรื่องที่ยังทำไม่เสร็จ (ยังไม่มีการ์ดให้กด) */
function matchesRating(t: TicketWithRelations, filter: RatingFilter): boolean {
  if (filter === "all") return true;
  if (t.status !== "resolved") return false;
  const rating = readRating(t);
  if (filter === "unrated") return rating === null;
  return rating !== null && isLowScore(rating.score) === (filter === "low");
}

/** วันปิดงานของเรื่องที่ปิดอยู่จริง — เรื่องที่ถูกเปิดกลับยังมีวันปิดรอบก่อนค้างใน meta ต้องไม่นับ */
function closedAtOf(t: TicketWithRelations): string | null {
  return t.status === "resolved" ? closedAt(t) : null;
}

/** เวลาที่ยกเลิก — ไม่ใช้ resolved_at เพราะยกเลิกไม่ใช่ "ทำเสร็จ" (ค่านั้นว่างตลอดในเรื่องที่ยกเลิก)
 *  อ่านจากรายการล่าสุดในประวัติที่เปลี่ยนเป็นยกเลิก · ข้อมูลเก่าที่ไม่มีประวัติใช้เวลาที่แก้สถานะล่าสุด */
function cancelledAtOf(t: TicketWithRelations): string | null {
  if (t.status !== "cancelled") return null;
  const history = Array.isArray(t.meta?.status_history) ? (t.meta.status_history as { to?: unknown; at?: unknown }[]) : [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.to === "cancelled" && typeof history[i].at === "string") return history[i].at as string;
  }
  return t.status_updated_at ?? null;
}

function leadHours(t: TicketWithRelations): number | null {
  return confirmationLeadTimeHours(t.created_at, closedAtOf(t));
}

function resolutionNote(t: TicketWithRelations): string | null {
  const v = t.meta?.resolution_note;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function viewCount(summaries: Record<string, TicketViewSummary>, ticketId: string): number {
  return summaries[ticketId]?.count ?? 0;
}

/** คอลัมน์ที่เรียงได้ — key ถูกจำไว้ใน localStorage ห้ามเปลี่ยนชื่อโดยไม่จำเป็น */
function buildSortColumns(summaries: Record<string, TicketViewSummary>): SortColumn<TicketWithRelations>[] {
  return [
    { key: "created_at", label: "วันที่แจ้ง", type: "date", get: (t) => t.created_at },
    { key: "closed_at", label: "วันที่ปิดงาน", type: "date", get: closedAtOf },
    { key: "ticket_code", label: "เลขที่ตั๋ว", type: "text", get: (t) => t.ticket_code },
    { key: "type", label: "ประเภท", type: "text", get: (t) => TICKET_TYPE_LABEL[t.type] },
    { key: "requester", label: "ผู้แจ้ง", type: "text", get: (t) => t.requester?.display_name ?? null },
    { key: "equipment", label: "ทรัพย์สิน", type: "text", get: (t) => t.equipment?.asset_code ?? null },
    { key: "location", label: "สาขา", type: "text", get: (t) => t.location },
    { key: "company", label: "บริษัท", type: "text", get: (t) => t.company_label },
    {
      key: "status",
      label: "สถานะ",
      type: "number",
      firstClick: "asc",
      get: (t) => TICKET_STATUS_ORDER.indexOf(t.status),
      dirText: { asc: "รอดำเนินการ → ยกเลิก", desc: "ยกเลิก → รอดำเนินการ" },
    },
    // ค่าซ่อม/คะแนน/ระยะเวลาเป็น null ได้เยอะ — sortRows ดันค่าว่างไปท้ายให้อยู่แล้ว เรียงมากไปน้อยจึงได้ค่าจริงขึ้นบน
    { key: "repair_cost", label: "ค่าซ่อม", type: "number", get: (t) => t.repair_cost },
    {
      key: "rating",
      label: "คะแนนจากผู้แจ้ง",
      type: "number",
      get: (t) => readRating(t)?.score ?? null,
      dirText: { desc: "คะแนนสูงสุดก่อน", asc: "คะแนนต่ำสุดก่อน" },
    },
    {
      key: "duration",
      label: "ระยะเวลาที่ใช้",
      type: "number",
      get: leadHours,
      dirText: { desc: "ใช้เวลานานสุดก่อน", asc: "เร็วสุดก่อน" },
    },
    {
      key: "views",
      label: "ผู้แจ้งเปิดดู",
      type: "number",
      get: (t) => viewCount(summaries, t.id),
      dirText: { desc: "ดูบ่อยที่สุดก่อน", asc: "ยังไม่ได้ดูขึ้นก่อน" },
    },
  ];
}

export function TicketsBoard({
  initialTickets,
  viewSummaries = {},
  recentViews = {},
  events = {},
  parts = {},
  initialStatus = "all",
  initialType = "all",
  initialRating = "all",
  initialTicketCode = "",
  editors = [],
  notifiable = {},
}: {
  initialTickets: TicketWithRelations[];
  initialStatus?: "all" | TicketStatus;
  initialType?: "all" | TicketType;
  initialRating?: RatingFilter;
  initialTicketCode?: string;
  editors?: string[];
  notifiable?: Record<string, boolean>;
  /** สรุปจำนวนครั้งที่แต่ละ ticket ถูกเปิดดู (คำนวณฝั่งเซิร์ฟเวอร์ครั้งเดียว) */
  viewSummaries?: Record<string, TicketViewSummary>;
  /** log 10 ครั้งล่าสุดต่อ ticket — ใช้แสดงในแผงรายละเอียดเท่านั้น */
  recentViews?: Record<string, TicketView[]>;
  /** ไทม์ไลน์ต่อ ticket (key = ticket id) */
  events?: Record<string, TicketEvent[]>;
  /** อะไหล่ที่เบิกจากสต็อกโดยอ้างเลขที่ตั๋ว (key = ticket id) */
  parts?: Record<string, TicketPart[]>;
}) {
  const router = useRouter();
  const [tickets, setTickets] = useServerRows(initialTickets);
  const [search, setSearch] = useState(initialTicketCode);
  const [typeFilter, setTypeFilter] = useState<"all" | TicketType>(initialType);
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>(initialStatus);
  const [companyFilter, setCompanyFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [requesterFilter, setRequesterFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>(initialRating);
  const [dateField, setDateField] = useState<DateField>("created");
  const dates = useDateRange();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TicketWithRelations | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // ตัวเลือกใน dropdown สร้างจากข้อมูลจริงที่อยู่ในตาราง ไม่ได้ hardcode
  // เรียงตามลำดับในทะเบียน (Montipa → Motta → ส่วนกลาง) ไม่ใช่ ก-ฮ เพราะเป็นลำดับที่คนในองค์กรพูดถึงกันจริง
  const companyOptions = useMemo(() => {
    const order = Object.values(COMPANY_LABEL);
    const present = new Set(tickets.map((t) => t.company_label ?? "ไม่ระบุบริษัท"));
    return [...order.filter((l) => present.has(l)), ...(present.has("ไม่ระบุบริษัท") ? ["ไม่ระบุบริษัท"] : [])];
  }, [tickets]);

  // เลือกบริษัทแล้ว dropdown สาขาต้องเหลือเฉพาะสาขาของบริษัทนั้น
  // ไม่งั้นจะเจอสาขาชื่อเดียวกันสองอันแล้วไม่รู้ว่าอันไหนของใคร
  const branchOptions = useMemo(
    () =>
      optionsFrom(
        tickets
          .filter((t) => companyFilter === "all" || (t.company_label ?? "ไม่ระบุบริษัท") === companyFilter)
          .map((t) => t.location)
      ),
    [tickets, companyFilter]
  );
  const requesterOptions = useMemo(() => optionsFrom(tickets.map((t) => t.requester?.display_name)), [tickets]);

  // ชั้นที่ 1: ทุกตัวกรอง "ยกเว้นสถานะและคะแนน" — ตัวเลขบนแท็บสถานะนับจากชุดนี้
  // (ไม่งั้นกดแท็บ "รอดำเนินการ" แล้วแท็บ "แก้ไขแล้ว" จะขึ้น 0 ทั้งที่มีเรื่องอยู่)
  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      if (companyFilter !== "all" && (t.company_label ?? "ไม่ระบุบริษัท") !== companyFilter) return false;
      // กรองสาขาต้องอยู่หลังกรองบริษัท เพราะมีสาขาชื่อซ้ำกันข้ามบริษัท
      if (branchFilter !== "all" && t.location !== branchFilter) return false;
      if (requesterFilter !== "all" && t.requester?.display_name !== requesterFilter) return false;
      if (!inDateRange(dateField === "closed" ? closedAtOf(t) : t.created_at, dates.range)) return false;
      if (!q) return true;
      return (
        t.ticket_code.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.requester?.display_name.toLowerCase().includes(q) ?? false) ||
        (t.equipment?.asset_code.toLowerCase().includes(q) ?? false) ||
        // ค้นด้วยชื่อ LINE และชื่ออุปกรณ์ที่เบิกได้ด้วย — ทีม IT จำคนจากชื่อในแอป LINE OA บ่อยกว่าชื่อจริง
        (ticketLineName(t)?.toLowerCase().includes(q) ?? false) ||
        formatTicketItems(ticketItems(t)).toLowerCase().includes(q) ||
        (resolutionNote(t)?.toLowerCase().includes(q) ?? false) ||
        (readRating(t)?.comment?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [tickets, search, typeFilter, companyFilter, branchFilter, requesterFilter, dateField, dates.range]);

  const statusCounts = useMemo(() => {
    const counts: Record<TicketStatus | "all", number> = { all: base.length, pending: 0, resolved: 0, cancelled: 0 };
    for (const t of base) counts[t.status] += 1;
    return counts;
  }, [base]);

  const byStatus = useMemo(
    () => (statusFilter === "all" ? base : base.filter((t) => t.status === statusFilter)),
    [base, statusFilter]
  );

  // สรุปคะแนนคิดจากเรื่องที่ปิดแล้ว "ก่อนกรองคะแนน" — ถ้าคิดหลังกรอง พอเลือก "1–3 ดาว"
  // ค่าเฉลี่ยจะดิ่งเหลือ 2 กว่าๆ ซึ่งไม่ได้บอกอะไรเลย
  const resolvedInScope = useMemo(() => byStatus.filter((t) => t.status === "resolved"), [byStatus]);
  const ratingSummary = useMemo(() => summarizeRatings(resolvedInScope), [resolvedInScope]);

  const visible = useMemo(
    () => (ratingFilter === "all" ? byStatus : byStatus.filter((t) => matchesRating(t, ratingFilter))),
    [byStatus, ratingFilter]
  );

  const totalCost = useMemo(() => visible.reduce((sum, t) => sum + (t.repair_cost ?? 0), 0), [visible]);

  // สรุปคะแนน/ตัวกรองคะแนนโชว์เฉพาะแท็บที่มีเรื่องแก้ไขแล้ว — แท็บรอดำเนินการ/ยกเลิกไม่มีอะไรให้คะแนน
  const ratingsApply = statusFilter === "all" || statusFilter === "resolved";

  // ลำดับการทำงาน: กรอง -> เรียง -> ตัดหน้า
  // สลับลำดับไม่ได้ ถ้าตัดหน้าก่อนเรียง จะได้ "เรียงเฉพาะแถวในหน้านี้" ซึ่งดูเหมือนทำงานแต่ผิดสนิท
  const sortColumns = useMemo(() => buildSortColumns(viewSummaries), [viewSummaries]);
  const sort = useSort(visible, sortColumns, {
    defaultKey: "created_at", // ค่าตั้งต้น = วันที่แจ้งล่าสุดก่อน ตามที่ใช้งานจริงบ่อยสุด
    storageKey: "tickets",
  });
  const pager = usePaginated(sort.rows, { storageKey: "tickets", resetOn: `${sort.key}:${sort.dir}` });

  const activeFilters = countActive(companyFilter, branchFilter, requesterFilter, dates.active, typeFilter, ratingFilter);
  function clearFilters() {
    setSearch("");
    setTypeFilter("all");
    setCompanyFilter("all");
    setBranchFilter("all");
    setRequesterFilter("all");
    setRatingFilter("all");
    dates.reset();
  }

  function selectStatus(next: "all" | TicketStatus) {
    setStatusFilter(next);
    // คะแนนมีเฉพาะเรื่องที่แก้ไขแล้ว — ค้างตัวกรองคะแนนไว้ตอนสลับไปแท็บรอดำเนินการ/ยกเลิก = ตารางว่างโดยไม่รู้ว่าทำไม
    if (next !== "all" && next !== "resolved") setRatingFilter("all");
  }

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  /** เงื่อนไขที่ใช้ตอนส่งออก — พิมพ์ลงชีต "สรุป" ให้คนอ่านรายงานรู้ว่าตัวเลขมาจากชุดไหน */
  function describeFilters(): string {
    const parts: string[] = [];
    if (statusFilter !== "all") parts.push(`สถานะ: ${TICKET_STATUS_LABEL[statusFilter]}`);
    if (typeFilter !== "all") parts.push(`ประเภท: ${TICKET_TYPE_LABEL[typeFilter]}`);
    if (companyFilter !== "all") parts.push(`บริษัท: ${companyFilter}`);
    if (branchFilter !== "all") parts.push(`สาขา: ${branchFilter}`);
    if (requesterFilter !== "all") parts.push(`ผู้แจ้ง: ${requesterFilter}`);
    if (ratingFilter !== "all") parts.push(`คะแนน: ${RATING_FILTER_LABEL[ratingFilter]}`);
    if (dates.active) parts.push(`${dateField === "closed" ? "วันที่ปิดงาน" : "วันที่แจ้ง"}: ${dateRangeLabel(dates.range)}`);
    if (search.trim()) parts.push(`ค้นหา: "${search.trim()}"`);
    return parts.join(" · ");
  }

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      // โหลดไลบรารี xlsx ตอนกดเท่านั้น (~400 KB) — คนที่แค่เปิดดูตารางไม่ต้องโหลด
      const XLSX = await import("xlsx");
      // ใช้ sort.rows ไม่ใช่ pager.items — ได้ "ทุกแถวที่ผ่านตัวกรอง" เรียงเหมือนบนจอ ไม่ใช่แค่หน้าที่เปิดอยู่
      const rows = sort.rows.map((t) => ({ ticket: t, parts: parts[t.id] ?? [], views: viewCount(viewSummaries, t.id) }));
      const workbook = buildTicketWorkbook(XLSX, rows, { filters: describeFilters() });
      XLSX.writeFile(workbook, ticketExportFileName(todayKeyTH()));
    } catch {
      setExportError("ส่งออกไฟล์ไม่สำเร็จ — ลองกดอีกครั้ง ถ้ายังไม่ได้ให้รีเฟรชหน้าแล้วลองใหม่");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">Tickets</h1>
          <p className="text-sm text-muted">
            แจ้งซ่อม เบิกอุปกรณ์ คืนอุปกรณ์ และบริการ IT ทั้งหมด — รวมเรื่องที่แก้ไขแล้ว คะแนนความพึงพอใจ และประวัติซ่อม
          </p>
          <p className="mt-1 text-sm text-muted">
            แสดง <span className="font-num text-ink">{visible.length}</span> เรื่อง · ค่าซ่อมรวม{" "}
            <span className="font-num font-semibold text-ink">{formatBaht(totalCost)} บาท</span>
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <Button variant="ghost" onClick={handleExport} disabled={exporting || visible.length === 0}>
            {exporting ? "กำลังสร้างไฟล์…" : `⬇ Export Excel (${visible.length})`}
          </Button>
          {exportError && (
            <p role="alert" className="text-xs text-rose-300">
              {exportError}
            </p>
          )}
        </div>
      </div>

      {ratingsApply && resolvedInScope.length > 0 && (
        <RatingSummaryBar
          summary={ratingSummary}
          lowActive={ratingFilter === "low"}
          onShowLow={() => setRatingFilter(ratingFilter === "low" ? "all" : "low")}
        />
      )}

      <FilterBar>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาเลขที่ตั๋ว, รายละเอียด, ผู้แจ้ง, ชื่อ LINE, รหัสทรัพย์สิน, วิธีแก้, ความเห็น..."
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:w-72"
        />
        <select
          aria-label="ประเภทเรื่อง"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as "all" | TicketType)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <SelectFilter
          value={companyFilter}
          onChange={(v) => {
            setCompanyFilter(v);
            // เปลี่ยนบริษัทแล้วสาขาที่เลือกไว้อาจไม่อยู่ในบริษัทใหม่ — รีเซ็ตไปก่อน
            setBranchFilter("all");
          }}
          options={companyOptions}
          allLabel="ทุกบริษัท"
        />
        <SelectFilter value={branchFilter} onChange={setBranchFilter} options={branchOptions} allLabel="ทุกสาขา" />
        <SelectFilter value={requesterFilter} onChange={setRequesterFilter} options={requesterOptions} allLabel="ผู้แจ้งทุกคน" />
        {ratingsApply && (
          <SelectFilter
            value={ratingFilter}
            onChange={(v) => setRatingFilter(v as RatingFilter)}
            options={RATING_FILTER_OPTIONS}
            labelOf={(v) => RATING_FILTER_LABEL[v as Exclude<RatingFilter, "all">] ?? v}
            allLabel="ทุกคะแนน"
            label="คะแนนจากผู้แจ้ง"
          />
        )}
        <select
          aria-label="กรองช่วงวันที่ตาม"
          value={dateField}
          onChange={(e) => setDateField(e.target.value as DateField)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="created">ตามวันที่แจ้ง</option>
          <option value="closed">ตามวันที่ปิดงาน</option>
        </select>
        <DateRangeFilter
          value={dates.range}
          onChange={dates.setRange}
          label={dateField === "closed" ? "วันที่ปิดงาน" : "วันที่แจ้ง"}
        />
        <ClearFiltersButton count={activeFilters} onClear={clearFilters} />
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SortMenu sort={sort} />
        {visible.length !== tickets.length && (
          <p className="text-xs text-muted">
            ตัวกรองเหลือ <span className="font-num text-ink">{visible.length}</span> จาก {tickets.length} เรื่อง
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line pb-3">
        <StatusTab label={`ทั้งหมด (${statusCounts.all})`} active={statusFilter === "all"} onClick={() => selectStatus("all")} />
        {TICKET_STATUS_ORDER.map((s) => (
          <StatusTab
            key={s}
            label={`${TICKET_STATUS_LABEL[s]} (${statusCounts[s]})`}
            active={statusFilter === s}
            onClick={() => selectStatus(s)}
          />
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <SortableTh sort={sort} columnKey="ticket_code">เลขที่ตั๋ว</SortableTh>
              <SortableTh sort={sort} columnKey="type">ประเภท</SortableTh>
              <SortableTh sort={sort} columnKey="requester">ผู้แจ้ง</SortableTh>
              <SortableTh sort={sort} columnKey="equipment">ทรัพย์สิน</SortableTh>
              <SortableTh sort={sort} columnKey="location">สาขา / บริษัท</SortableTh>
              <SortableTh sort={sort} columnKey="status">สถานะ</SortableTh>
              <SortableTh sort={sort} columnKey="repair_cost">ค่าซ่อม</SortableTh>
              <SortableTh sort={sort} columnKey="rating">คะแนน</SortableTh>
              {/* วันที่แจ้งกับวันปิดงานอยู่คอลัมน์เดียวกัน — แยกสองคอลัมน์แล้วตารางกว้างเกินพื้นที่จริง
                  (วัดแล้ว 1,394px ในกรอบ 1,230px) คอลัมน์ขวาสุดหลุดจอ ต้องเลื่อนตารางทุกครั้ง
                  เรียงตามวันปิดงาน/ระยะเวลายังทำได้จากเมนูเรียงลำดับ */}
              <SortableTh sort={sort} columnKey="created_at">วันที่แจ้ง / ปิดงาน</SortableTh>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((t) => {
              const done = closedAtOf(t);
              const cancelled = cancelledAtOf(t);
              return (
                <tr
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-accent-bg/30"
                >
                  <td className="whitespace-nowrap px-3 py-3 font-num text-accent">{t.ticket_code}</td>
                  <td className="px-3 py-3">
                    <span className="whitespace-nowrap">{TICKET_TYPE_LABEL[t.type]}</span>
                    <ItemsHint ticket={t} />
                  </td>
                  <td className="px-3 py-3">
                    <span className="whitespace-nowrap">{t.requester?.display_name ?? "-"}</span>
                    <LineNameHint ticket={t} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">{t.equipment?.asset_code ?? "-"}</td>
                  {/* บริษัทอยู่ใต้ชื่อสาขา (เดิมแยกคอลัมน์) — ประหยัดความกว้างให้คอลัมน์ค่าซ่อม/คะแนน/ปิดงานที่รวมเข้ามา */}
                  <td className="px-3 py-3">
                    <span className="block whitespace-nowrap">{t.location}</span>
                    <span className="mt-1 block">
                      <CompanyBadge label={t.company_label} />
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <TicketStatusBadge status={t.status} />
                    <ViewedHint summary={viewSummaries[t.id]} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-num text-muted">
                    {t.repair_cost !== null ? `${formatBaht(t.repair_cost)} บ.` : "-"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {t.status === "resolved" ? <RatingCell ticket={t} /> : <span className="text-xs text-muted/50">-</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-num text-muted">
                    <span className="block">{formatThaiDateShort(t.created_at)}</span>
                    {done && (
                      <>
                        <span className="mt-1 block text-[11px] text-emerald-300">ปิด {formatThaiDateShort(done)}</span>
                        <span className="block text-[11px] text-muted/80">ใช้เวลา {formatLeadTime(leadHours(t))}</span>
                      </>
                    )}
                    {cancelled && (
                      <span className="mt-1 block text-[11px] text-rose-300">ยกเลิก {formatThaiDateShort(cancelled)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted">
                  ไม่พบ Ticket ที่ตรงกับเงื่อนไข
                  {activeFilters > 0 && (
                    <>
                      {" · "}
                      <button type="button" onClick={clearFilters} className="text-accent underline underline-offset-2">
                        ล้างตัวกรองทั้งหมด
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination pager={pager} unitLabel="เรื่อง" />

      <TicketStatusModal
        ticket={editing}
        editors={editors}
        canNotify={editing ? notifiable[editing.id] : false}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setTickets((prev) => prev.map((t) => (t.id === saved.id ? { ...t, ...saved } : t)));
          setEditing(null);
          router.refresh();
        }}
      />
      {selected && (
        <TicketDetailPanel
          ticket={selected}
          views={recentViews[selected.id] ?? []}
          totalViews={viewSummaries[selected.id]?.count ?? 0}
          events={events[selected.id] ?? []}
          parts={parts[selected.id] ?? []}
          canChat={Boolean(notifiable[selected.id])}
          onClose={() => setSelectedId(null)}
          onStatusChange={() => setEditing(selected)}
        />
      )}
    </div>
  );
}

function StatusTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
        active ? "bg-accent text-on-accent" : "bg-accent-bg text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

/* ─────────────────────────────────────────── คะแนนความพึงพอใจ */

function RatingSummaryBar({
  summary,
  lowActive,
  onShowLow,
}: {
  summary: RatingSummary;
  lowActive: boolean;
  onShowLow: () => void;
}) {
  const responseRate = summary.total ? Math.round((summary.rated / summary.total) * 100) : 0;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <SummaryCard
        label="คะแนนเฉลี่ย"
        value={summary.average === null ? "-" : `${summary.average.toFixed(1)} / ${RATING_MAX}`}
        hint={summary.average === null ? "ยังไม่มีใครให้คะแนน" : starText(summary.average)}
        hintClass="text-amber-300"
      />
      <SummaryCard
        label={`พึงพอใจ (${RATING_LOW_MAX + 1}–${RATING_MAX} ดาว)`}
        value={summary.csat === null ? "-" : `${Math.round(summary.csat)}%`}
        hint="สัดส่วนจากเรื่องที่ให้คะแนนแล้ว"
      />
      {/* อัตราการตอบต้องโชว์คู่กับค่าเฉลี่ยเสมอ — เฉลี่ย 5.0 จาก 2 คนในร้อยเรื่องไม่ได้แปลว่าบริการดี */}
      <SummaryCard
        label="ตอบแบบประเมิน"
        value={`${summary.rated} / ${summary.total}`}
        hint={`${responseRate}% ของเรื่องที่แก้ไขแล้ว`}
      />
      <button
        type="button"
        onClick={onShowLow}
        disabled={summary.low === 0 && !lowActive}
        aria-pressed={lowActive}
        className={`rounded-xl border px-3 py-2 text-left transition disabled:cursor-default ${
          lowActive ? "border-rose-400/50 bg-rose-500/10" : "border-line bg-surface hover:border-rose-400/40"
        }`}
      >
        <p className="text-[11px] text-muted">{`ต้องปรับปรุง (1–${RATING_LOW_MAX} ดาว)`}</p>
        <p className={`font-num text-lg font-semibold ${summary.low > 0 ? "text-rose-300" : "text-ink"}`}>{summary.low} เรื่อง</p>
        <p className="text-[11px] text-muted">
          {summary.low === 0
            ? "ไม่มีเรื่องที่ได้คะแนนต่ำ"
            : lowActive
              ? "แสดงอยู่ · กดอีกครั้งเพื่อดูทั้งหมด"
              : "กดเพื่อดูเฉพาะเรื่องเหล่านี้"}
        </p>
      </button>
    </div>
  );
}

function SummaryCard({ label, value, hint, hintClass = "text-muted" }: {
  label: string; value: string; hint: string; hintClass?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="font-num text-lg font-semibold text-ink">{value}</p>
      <p className={`text-[11px] ${hintClass}`}>{hint}</p>
    </div>
  );
}

function RatingCell({ ticket }: { ticket: TicketWithRelations }) {
  const rating = readRating(ticket);
  if (!rating) return <span className="text-xs text-muted/50">ยังไม่ให้คะแนน</span>;
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${isLowScore(rating.score) ? "text-rose-300" : "text-amber-300"}`}
      title={rating.comment ?? `${rating.score}/${RATING_MAX}`}
    >
      <span aria-label={`${rating.score} จาก ${RATING_MAX} ดาว`}>{starText(rating.score)}</span>
      {rating.comment && <span aria-label="มีความเห็น">💬</span>}
    </span>
  );
}

function RatingSection({ ticket }: { ticket: TicketWithRelations }) {
  const rating = readRating(ticket);
  return (
    <Section title="ความพึงพอใจของผู้แจ้ง">
      {rating ? (
        <div className="flex flex-col gap-2">
          <p className={`text-lg ${isLowScore(rating.score) ? "text-rose-300" : "text-amber-300"}`}>
            {starText(rating.score)}{" "}
            <span className="font-num text-sm text-ink">
              {rating.score}/{RATING_MAX}
            </span>
          </p>
          <p className="font-num text-xs text-muted">
            {rating.by} · {formatThaiDateFull(rating.at)}
          </p>
          {rating.comment ? (
            <p className="whitespace-pre-wrap rounded-lg bg-page/50 px-2.5 py-1.5 text-sm text-ink">{rating.comment}</p>
          ) : (
            isLowScore(rating.score) && <p className="text-xs text-muted/60">ผู้แจ้งไม่ได้ระบุเหตุผล</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted/60">
          ยังไม่ได้ให้คะแนน — ผู้แจ้งกดดาวได้จากการ์ดที่ได้รับตอนปิดงาน (ถ้าตอนปิดงานไม่ได้ติ๊กส่ง LINE ผู้แจ้งจะไม่มีการ์ดให้กด)
        </p>
      )}
    </Section>
  );
}

/* ─────────────────────────────────────────── แผงรายละเอียด = log ฉบับเต็มของเรื่อง */

const EVENT_ICON: Record<TicketEvent["type"], string> = {
  created: "📝",
  status: "🔄",
  confirmed: "✅",
  rated: "⭐",
  note: "💬",
};

const ROLE_LABEL: Record<TicketEvent["actor_role"], string> = {
  admin: "ทีม IT",
  requester: "ผู้แจ้ง",
  system: "ระบบ",
};

function eventTitle(e: TicketEvent): string {
  if (e.type === "rated") return "ผู้แจ้งให้คะแนนการบริการ";
  if (e.type === "created") return "แจ้งเรื่อง";
  return e.to_status ? statusLabel(e.to_status) : "บันทึกเพิ่มเติม";
}

function TicketDetailPanel({
  ticket,
  views,
  totalViews,
  events,
  parts,
  canChat,
  onClose,
  onStatusChange,
}: {
  ticket: TicketWithRelations;
  views: TicketView[];
  totalViews: number;
  events: TicketEvent[];
  parts: TicketPart[];
  /** ผู้แจ้งมีบัญชี LINE ผูกกับเรื่องนี้ (คำนวณฝั่งเซิร์ฟเวอร์ชุดเดียวกับสวิตช์แจ้ง LINE) */
  canChat: boolean;
  onClose: () => void;
  onStatusChange: () => void;
}) {
  const done = closedAtOf(ticket);
  const cancelled = cancelledAtOf(ticket);
  const note = resolutionNote(ticket);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-lg flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-num text-lg font-bold text-accent">{ticket.ticket_code}</p>
            <p className="text-sm text-muted">
              {TICKET_TYPE_LABEL[ticket.type]} · {ticket.location}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-muted hover:text-ink" aria-label="ปิด">
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TicketStatusBadge status={ticket.status} />
          <CompanyBadge label={ticket.company_label} />
        </div>

        <Button onClick={onStatusChange}>แก้ไขสถานะ / หมายเหตุ</Button>

        {/* key = ticket.id: เปลี่ยนเรื่องแล้วต้องเช็คสถานะแชทของผู้แจ้งคนใหม่ ไม่ใช้ผลของคนก่อนค้างไว้ */}
        {canChat && <ChatTakeoverCard key={ticket.id} ticketId={ticket.id} />}

        {/* สรุป 3 ตัวเลขที่คนเปิดเรื่องที่ปิดแล้วมาดูก่อนเสมอ: ใช้เวลาเท่าไหร่ จ่ายไปเท่าไหร่ ปิดเมื่อไหร่ */}
        {ticket.status === "resolved" && (
          <div className="grid grid-cols-3 gap-2">
            <Stat label="ใช้เวลาทั้งหมด" value={formatLeadTime(leadHours(ticket))} />
            <Stat label="ค่าใช้จ่าย" value={ticket.repair_cost !== null ? `${formatBaht(ticket.repair_cost)} บ.` : "-"} />
            <Stat label="ปิดงานเมื่อ" value={done ? formatThaiDateShort(done) : "-"} />
          </div>
        )}

        <ViewLog views={views} total={totalViews} acknowledgedAt={ticket.meta?.acknowledged_at} />

        <dl className="flex flex-col gap-3 border-t border-line pt-4 text-sm">
          <Row label="ผู้แจ้ง" value={ticket.requester?.display_name ?? "-"} />
          <Row label="ชื่อ LINE (คนที่ส่งเรื่อง)" value={ticketLineName(ticket) ?? "-"} />
          <Row label="แผนก" value={ticket.requester?.department ?? "-"} />
          <Row label="สาขา" value={ticket.location} />
          <Row
            label="ทรัพย์สินที่เกี่ยวข้อง"
            value={ticket.equipment ? `${ticket.equipment.asset_code} — ${ticket.equipment.brand_model ?? ""}` : "-"}
          />
          {ticket.type === "repair" && (
            <Row label="ค่าซ่อม" value={ticket.repair_cost !== null ? `${formatBaht(ticket.repair_cost)} บาท` : "-"} />
          )}
          <Row label="วันที่แจ้ง" value={formatThaiDateShort(ticket.created_at)} />
          {cancelled ? (
            <Row label="วันที่ยกเลิก" value={formatThaiDateShort(cancelled)} />
          ) : (
            <Row label="วันที่ปิดงาน" value={done ? formatThaiDateShort(done) : "-"} />
          )}
        </dl>

        <TicketItemsBlock ticket={ticket} className="border-t border-line pt-4" />

        <Section title="รายละเอียด / อาการที่แจ้ง">
          <p className="whitespace-pre-wrap text-sm text-ink">{ticket.description || "-"}</p>
        </Section>

        <Section title={ticket.status === "cancelled" ? "เหตุผลที่ยกเลิก / หมายเหตุของทีม IT" : "วิธีแก้ไข / หมายเหตุล่าสุดของทีม IT"}>
          {note ? (
            <p className="whitespace-pre-wrap text-sm text-ink">{note}</p>
          ) : (
            <p className="text-sm text-muted/60">
              {ticket.status === "cancelled"
                ? "ไม่ได้บันทึกเหตุผล — ครั้งหน้ากรอกช่อง \"หมายเหตุ\" ตอนเปลี่ยนเป็น \"ยกเลิก\" (เช่น แจ้งซ้ำกับ ITSR...)"
                : "ยังไม่ได้บันทึก — กรอกช่อง \"หมายเหตุ / ผลการแก้ไข\" ตอนเปลี่ยนสถานะเป็น \"แก้ไขแล้ว\""}
            </p>
          )}
        </Section>

        {ticket.status === "resolved" && <RatingSection ticket={ticket} />}

        {parts.length > 0 && (
          <Section title={`อะไหล่ที่เบิกไปใช้ (${parts.length} รายการ)`}>
            <ul className="flex flex-col gap-1 text-sm text-ink">
              {parts.map((p, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{p.name}</span>
                  <span className="font-num text-muted">
                    {p.qty} {p.unit}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <TicketImages ticket={ticket} />

        <Section title={`ไทม์ไลน์ (${events.length} ขั้น)`}>
          {events.length === 0 ? (
            <p className="text-sm text-muted/60">ไม่มีไทม์ไลน์ — เรื่องนี้เกิดก่อนระบบเริ่มบันทึก</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {events.map((e, i) => (
                <li key={e.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="text-sm leading-none">{EVENT_ICON[e.type]}</span>
                    {i < events.length - 1 && <span className="mt-1 w-px flex-1 bg-line" aria-hidden />}
                  </div>
                  <div className="flex-1 pb-1">
                    <p className="text-sm text-ink">
                      {eventTitle(e)}
                      {e.from_status && e.from_status !== e.to_status && (
                        <span className="text-muted"> (จาก {statusLabel(e.from_status)})</span>
                      )}
                    </p>
                    <p className="font-num text-xs text-muted">
                      {formatThaiDateFull(e.created_at)} · {e.actor} ({ROLE_LABEL[e.actor_role]})
                    </p>
                    {e.note && (
                      <p className="mt-1 whitespace-pre-wrap rounded-lg bg-page/50 px-2.5 py-1.5 text-xs text-ink">{e.note}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </div>
  );
}

/** รูปที่ผู้ใช้ส่งมาในแชท LINE ตอนแจ้งเรื่อง (บอทอัปโหลดไว้ที่ /uploads/tickets/)
 *
 *  ใช้ <img> ธรรมดาแทน next/image โดยตั้งใจ — ไฟล์เหล่านี้ถูกเขียนลง volume ตอน runtime
 *  ไม่ได้อยู่ตอน build ซึ่ง next/image จะพยายาม optimize แล้วพังถ้าไฟล์ยังไม่มี
 *  เปิดรูปเต็มในแท็บใหม่ได้เพราะช่างต้องซูมดูข้อความ error บนหน้าจอที่ถ่ายมา */
function TicketImages({ ticket }: { ticket: TicketWithRelations }) {
  const raw = ticket.meta?.image_urls;
  const urls = Array.isArray(raw) ? raw.filter((u): u is string => typeof u === "string") : [];
  if (urls.length === 0) return null;

  return (
    <Section title={`รูปที่ผู้แจ้งส่งมา (${urls.length})`}>
      <div className="grid grid-cols-2 gap-2">
        {urls.map((url) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-lg border border-line transition hover:border-accent"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="รูปที่ผู้แจ้งส่งมา" className="h-28 w-full object-cover" />
          </a>
        ))}
      </div>
    </Section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-page/40 px-3 py-2">
      <p className="text-[10px] text-muted">{label}</p>
      <p className="font-num text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <p className="text-xs font-semibold text-muted">{title}</p>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────── ผู้แจ้งเปิดดูสถานะหรือยัง */

const SOURCE_LABEL: Record<TicketView["source"], string> = {
  "line-bot": "กดปุ่มในแชท LINE",
  "admin-panel": "เปิดจากหน้าแอดมิน",
  liff: "เปิดหน้าเว็บ",
};

/** บรรทัดเล็กใต้ป้ายสถานะ — ตอบคำถามเดียวว่า "ผู้แจ้งเห็นแล้วหรือยัง"
 *  (เดิมเป็นคอลัมน์ของตัวเอง ย้ายมาใต้สถานะเพื่อเว้นที่ให้คอลัมน์ที่รวมมาจากหน้า log/ประวัติซ่อม
 *  เรียงตามจำนวนครั้งยังทำได้จากเมนูเรียงลำดับ) */
function ViewedHint({ summary }: { summary?: TicketViewSummary }) {
  if (!summary || summary.count === 0) {
    return <span className="mt-1 block text-[11px] text-muted/50">ยังไม่ได้ดู</span>;
  }
  return (
    <span
      className="mt-1 block whitespace-nowrap text-[11px] text-emerald-300"
      title={`ล่าสุด ${formatThaiDateFull(summary.last_at)} โดย ${summary.last_viewer}`}
    >
      👁 <span className="font-num">{summary.count}</span> ครั้ง
    </span>
  );
}

/** ประวัติการเปิดดูแบบเต็มในแผงรายละเอียด */
function ViewLog({ views, total, acknowledgedAt }: { views: TicketView[]; total: number; acknowledgedAt?: unknown }) {
  const ackAt = typeof acknowledgedAt === "string" ? acknowledgedAt : null;

  if (total === 0) {
    return (
      <div className="rounded-xl border border-line bg-page/40 p-3">
        <p className="text-xs text-muted">👁 ผู้แจ้งยังไม่ได้เปิดดูสถานะเรื่องนี้เลย</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-emerald-300">
          👁 เปิดดูสถานะแล้ว <span className="font-num">{total}</span> ครั้ง
        </p>
        {views.length < total && <span className="text-[10px] text-muted">แสดง {views.length} ครั้งล่าสุด</span>}
      </div>

      {ackAt && (
        <p className="text-xs text-muted">
          ผู้แจ้งรับทราบครั้งแรกเมื่อ <span className="font-num text-ink">{formatThaiDateFull(ackAt)}</span>
        </p>
      )}

      <ul className="flex flex-col gap-1.5 border-t border-emerald-400/15 pt-2">
        {views.map((v) => (
          <li key={v.id} className="flex flex-col gap-0.5 text-xs">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-num text-ink">{formatThaiDateFull(v.created_at)}</span>
              <span className="text-muted">·</span>
              <span className="text-ink">{v.viewer_name}</span>
              <span className="text-muted">({SOURCE_LABEL[v.source]})</span>
            </div>
            {v.ip && (
              // ⚠️ ต้องเขียนกำกับไว้เสมอว่า IP นี้เป็นของใคร
              // สำหรับปุ่มในแชท LINE มันคือ IP ของเซิร์ฟเวอร์ LINE ไม่ใช่มือถือพนักงาน
              // ถ้าโชว์ตัวเลขเปล่าๆ จะถูกเอาไปใช้ผิดแน่นอน (เช่นอ้างว่าใครอยู่ที่ไหน)
              <span className="font-num text-[10px] text-muted" title={v.ip_note ?? undefined}>
                IP {v.ip}
                {v.ip_note ? ` — ${v.ip_note}` : ""}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
