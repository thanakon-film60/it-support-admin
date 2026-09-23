"use client";

import { useMemo, useState } from "react";
import { useServerRows } from "@/lib/use-server-rows";
import { useRouter } from "next/navigation";
import { Pagination, usePaginated } from "@/components/ui/Pagination";
import type { Ticket, TicketWithRelations } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { TICKET_TYPE_LABEL } from "@/lib/labels";
import { formatThaiDateShort, formatBaht, toCsv } from "@/lib/utils";
import {
  readConfirmation,
  readResolvedBy,
  confirmationLeadTimeHours,
  formatLeadTime,
} from "@/lib/ticket-confirmation";
import { SortMenu, SortableTh, useSort } from "@/components/ui/SortControl";
import type { SortColumn } from "@/lib/sorting";
import { TicketStatusModal } from "@/components/tickets/TicketStatusModal";
import {
  ClearFiltersButton,
  DateRangeFilter,
  FilterBar,
  SelectFilter,
  countActive,
  inDateRange,
  optionsFrom,
  useDateRange,
} from "@/components/ui/Filters";

/** ข้อมูลหนึ่งแถว = ticket + ส่วนที่ถอดออกมาจาก meta แล้ว
 *
 *  คำนวณครั้งเดียวตอนรับ props แล้วใช้ซ้ำทั้งตาราง/ตัวกรอง/การเรียง/CSV
 *  ไม่งั้นทุกครั้งที่พิมพ์ในช่องค้นหาจะต้องไล่ parse meta ของทุกแถวใหม่หมด
 */
interface CompletedRow {
  ticket: TicketWithRelations;
  confirmedBy: string;
  confirmedAt: string | null;
  confirmNote: string | null;
  resolvedBy: string;
  leadTimeHours: number | null;
}

function toRow(ticket: TicketWithRelations): CompletedRow {
  const confirmation = readConfirmation(ticket);
  const resolver = readResolvedBy(ticket);
  return {
    ticket,
    confirmedBy: confirmation?.by ?? ticket.requester?.display_name ?? "ผู้แจ้ง",
    confirmedAt: confirmation?.at ?? ticket.resolved_at,
    confirmNote: confirmation?.note ?? null,
    resolvedBy: resolver?.by ?? ticket.status_updated_by ?? "-",
    leadTimeHours: confirmationLeadTimeHours(
      ticket.created_at,
      confirmation?.at ?? ticket.resolved_at
    ),
  };
}

const SORT_COLUMNS: SortColumn<CompletedRow>[] = [
  {
    key: "confirmed_at",
    label: "วันที่ยืนยัน",
    type: "date",
    get: (r) => r.confirmedAt,
    dirText: { desc: "เพิ่งยืนยันล่าสุดก่อน", asc: "ยืนยันไว้นานแล้วก่อน" },
  },
  { key: "created_at", label: "วันที่แจ้ง", type: "date", get: (r) => r.ticket.created_at },
  {
    key: "lead_time",
    label: "เวลาที่ใช้",
    type: "number",
    firstClick: "desc",
    get: (r) => r.leadTimeHours,
    dirText: { desc: "ใช้เวลานานที่สุดก่อน", asc: "เร็วที่สุดก่อน" },
  },
  { key: "ticket_code", label: "เลขที่ตั๋ว", type: "text", get: (r) => r.ticket.ticket_code },
  { key: "location", label: "สาขา", type: "text", get: (r) => r.ticket.location },
  { key: "requester", label: "ผู้แจ้ง", type: "text", get: (r) => r.ticket.requester?.display_name ?? null },
  { key: "resolver", label: "ทีม IT", type: "text", get: (r) => r.resolvedBy },
  { key: "repair_cost", label: "ค่าซ่อม", type: "number", get: (r) => r.ticket.repair_cost },
];

/** ค่ากลาง ไม่ใช่ค่าเฉลี่ย — เรื่องเดียวที่ค้างไว้เป็นเดือนดึงค่าเฉลี่ยเพี้ยนได้ทั้งหน้า
 *  ตัวเลขที่เอาไปคุยกับหัวหน้าได้ต้องทนต่อ outlier แบบนั้น */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function CompletedBoard({
  rows,
  editors = [],
  notifiable = {},
}: {
  rows: TicketWithRelations[];
  editors?: string[];
  notifiable?: Record<string, boolean>;
}) {
  const router = useRouter();
  const [tickets, setTickets] = useServerRows(rows);
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const dates = useDateRange();

  const allRows = useMemo(() => tickets.map(toRow), [tickets]);

  const branchOptions = useMemo(() => optionsFrom(tickets.map((t) => t.location)), [tickets]);
  const typeOptions = useMemo(
    () => optionsFrom(tickets.map((t) => TICKET_TYPE_LABEL[t.type] ?? t.type)),
    [tickets]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      const t = r.ticket;
      if (branchFilter !== "all" && t.location !== branchFilter) return false;
      if (typeFilter !== "all" && (TICKET_TYPE_LABEL[t.type] ?? t.type) !== typeFilter) return false;
      // กรองด้วย "วันที่ยืนยัน" ไม่ใช่วันที่แจ้ง — หน้านี้ตอบคำถามว่าเดือนนี้ปิดงานไปกี่เรื่อง
      if (!inDateRange(r.confirmedAt ?? t.created_at, dates.range)) return false;
      if (!q) return true;
      return (
        t.ticket_code.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.location.toLowerCase().includes(q) ||
        r.resolvedBy.toLowerCase().includes(q) ||
        r.confirmedBy.toLowerCase().includes(q) ||
        (r.confirmNote?.toLowerCase().includes(q) ?? false) ||
        (t.requester?.display_name.toLowerCase().includes(q) ?? false) ||
        (t.equipment?.asset_code.toLowerCase().includes(q) ?? false)
      );
    });
  }, [allRows, search, branchFilter, typeFilter, dates.range]);

  const sort = useSort(visible, SORT_COLUMNS, { defaultKey: "confirmed_at", storageKey: "completed" });

  const activeFilters = countActive(branchFilter, typeFilter, dates.active);
  function clearFilters() {
    setSearch("");
    setBranchFilter("all");
    setTypeFilter("all");
    dates.reset();
  }

  const medianLead = useMemo(
    () => median(visible.map((r) => r.leadTimeHours).filter((h): h is number => h !== null)),
    [visible]
  );

  const editing = useMemo(
    () => tickets.find((t) => t.id === editingId) ?? null,
    [tickets, editingId]
  );

  /** เรื่องที่ถูกย้ายออกจากสถานะ "สำเร็จแล้ว" ต้องหายจากหน้านี้ทันที
   *  ถ้าปล่อยให้ค้างอยู่จนกว่าจะรีเฟรช คนจะเผลอกดซ้ำแล้วงงว่าทำไมไม่มีอะไรเกิดขึ้น */
  function handleSaved(saved: Ticket) {
    setEditingId(null);
    setTickets((prev) =>
      prev
        .map((ticket) => (ticket.id === saved.id ? { ...ticket, ...saved } : ticket))
        .filter((ticket) => ticket.status === "completed")
    );
    router.refresh();
  }

  function handleExportCsv() {
    const csvRows = sort.rows.map((r) => ({
      ticket_code: r.ticket.ticket_code,
      type: TICKET_TYPE_LABEL[r.ticket.type] ?? r.ticket.type,
      location: r.ticket.location,
      requester: r.ticket.requester?.display_name ?? "-",
      asset_code: r.ticket.equipment?.asset_code ?? "-",
      description: r.ticket.description,
      repair_cost: r.ticket.repair_cost !== null ? formatBaht(r.ticket.repair_cost) : "-",
      resolved_by: r.resolvedBy,
      confirmed_by: r.confirmedBy,
      confirmed_at: r.confirmedAt ? formatThaiDateShort(r.confirmedAt) : "-",
      lead_time: formatLeadTime(r.leadTimeHours),
      confirm_note: r.confirmNote ?? "-",
      created_at: formatThaiDateShort(r.ticket.created_at),
    }));
    const csv = toCsv(csvRows, [
      { key: "ticket_code", header: "เลขที่ตั๋ว" },
      { key: "type", header: "ประเภท" },
      { key: "location", header: "สาขา" },
      { key: "requester", header: "ผู้แจ้ง" },
      { key: "asset_code", header: "รหัสทรัพย์สิน" },
      { key: "description", header: "รายละเอียด" },
      { key: "repair_cost", header: "ค่าซ่อม" },
      { key: "resolved_by", header: "ทีม IT ที่แก้" },
      { key: "confirmed_by", header: "ผู้ยืนยัน" },
      { key: "confirmed_at", header: "ยืนยันเมื่อ" },
      { key: "lead_time", header: "ใช้เวลา" },
      { key: "confirm_note", header: "หมายเหตุจากผู้แจ้ง" },
      { key: "created_at", header: "วันที่แจ้ง" },
    ]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `completed-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pager = usePaginated(sort.rows, { storageKey: "completed", resetOn: `${sort.key}:${sort.dir}` });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
            <span aria-hidden>🎉</span> งานที่สำเร็จแล้ว
          </h1>
          <p className="text-sm text-muted">
            เฉพาะเรื่องที่ <span className="text-emerald-300">ผู้แจ้งกดยืนยันเองในไลน์</span> ว่าใช้งานได้จริง
            — ไม่ใช่เรื่องที่ทีม IT กดปิดเอง
          </p>
        </div>
        <Button variant="ghost" onClick={handleExportCsv}>
          ⬇ Export CSV ({visible.length})
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="ยืนยันแล้ว" value={`${visible.length}`} unit="เรื่อง" />
        <StatCard
          label="เวลาจากแจ้งถึงยืนยัน"
          value={formatLeadTime(medianLead)}
          unit="ค่ากลาง"
        />
        <StatCard
          label="ค่าซ่อมรวม"
          value={formatBaht(visible.reduce((sum, r) => sum + (r.ticket.repair_cost ?? 0), 0))}
          unit="บาท"
        />
      </div>

      <FilterBar>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาเลขที่ตั๋ว, รายละเอียด, ผู้แจ้ง, ชื่อช่าง..."
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:w-64"
        />
        <SelectFilter value={branchFilter} onChange={setBranchFilter} options={branchOptions} allLabel="ทุกสาขา" />
        <SelectFilter value={typeFilter} onChange={setTypeFilter} options={typeOptions} allLabel="ทุกประเภท" />
        <DateRangeFilter value={dates.range} onChange={dates.setRange} />
        <ClearFiltersButton count={activeFilters} onClear={clearFilters} />
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SortMenu sort={sort} />
        {visible.length !== allRows.length && (
          <p className="text-xs text-muted">
            ตัวกรองเหลือ <span className="font-num text-ink">{visible.length}</span> จาก {allRows.length} รายการ
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <SortableTh sort={sort} columnKey="ticket_code">เลขที่ตั๋ว</SortableTh>
              <SortableTh sort={sort} columnKey="location">สาขา</SortableTh>
              <SortableTh sort={sort} columnKey="requester">ผู้แจ้ง</SortableTh>
              <SortableTh sort={sort}>รายละเอียด</SortableTh>
              <SortableTh sort={sort} columnKey="resolver">ทีม IT ที่แก้</SortableTh>
              <SortableTh sort={sort} columnKey="confirmed_at">ผู้แจ้งยืนยัน</SortableTh>
              <SortableTh sort={sort} columnKey="lead_time">ใช้เวลา</SortableTh>
              <SortableTh sort={sort} columnKey="created_at">วันที่แจ้ง</SortableTh>
              <SortableTh sort={sort}>จัดการ</SortableTh>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((r) => (
              <tr
                key={r.ticket.id}
                onClick={() => setEditingId(r.ticket.id)}
                className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-accent-bg/20"
              >
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="font-num text-accent">{r.ticket.ticket_code}</span>
                  <span className="mt-0.5 block text-[10px] text-muted">
                    {TICKET_TYPE_LABEL[r.ticket.type] ?? r.ticket.type}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3">{r.ticket.location || "-"}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {r.ticket.requester?.display_name ?? "-"}
                </td>
                <td className="max-w-xs px-4 py-3">
                  <span className="block truncate" title={r.ticket.description}>
                    {r.ticket.description}
                  </span>
                  {r.confirmNote && (
                    <span className="mt-0.5 block truncate text-[11px] text-emerald-300/80" title={r.confirmNote}>
                      💬 {r.confirmNote}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted">{r.resolvedBy}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="flex flex-col leading-tight">
                    <span className="text-ink">{r.confirmedBy}</span>
                    {r.confirmedAt && (
                      <span className="font-num text-[10px] text-emerald-300/80">
                        {formatThaiDateShort(r.confirmedAt)}
                      </span>
                    )}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {formatLeadTime(r.leadTimeHours)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {formatThaiDateShort(r.ticket.created_at)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(r.ticket.id);
                    }}
                    className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-accent"
                  >
                    ✎ เปลี่ยนสถานะ
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted">
                  {allRows.length === 0
                    ? "ยังไม่มีเรื่องที่ผู้แจ้งกดยืนยัน — เรื่องจะเข้ามาที่นี่เองเมื่อผู้แจ้งกดปุ่มยืนยันในไลน์"
                    : "ไม่พบข้อมูลตามตัวกรองที่เลือก"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination pager={pager} unitLabel="เรื่อง" />

      <TicketStatusModal
        ticket={editing}
        canNotify={editing ? notifiable[editing.id] ?? false : false}
        editors={editors}
        onClose={() => setEditingId(null)}
        onSaved={handleSaved}
      />
    </div>
  );
}

function StatCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-num text-lg font-semibold text-ink">
        {value} <span className="text-xs font-normal text-muted">{unit}</span>
      </p>
    </div>
  );
}
