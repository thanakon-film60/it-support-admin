"use client";

import { useMemo, useState } from "react";
import { useServerRows } from "@/lib/use-server-rows";
import { TicketStatusModal } from "./TicketStatusModal";
import { Pagination, usePaginated } from "@/components/ui/Pagination";
import type { TicketWithRelations } from "@/lib/types";
import { TicketStatusBadge, TICKET_STATUS_ORDER, CompanyBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatThaiDateShort, formatBaht, toCsv } from "@/lib/utils";
import { SortMenu, SortableTh, useSort } from "@/components/ui/SortControl";
import { COMPANY_LABEL } from "@/lib/companies";
import type { SortColumn } from "@/lib/sorting";
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

const SORT_COLUMNS: SortColumn<TicketWithRelations>[] = [
  { key: "created_at", label: "วันที่แจ้ง", type: "date", get: (t) => t.created_at },
  // ค่าซ่อมเป็น null ได้เยอะ (เรื่องที่ยังไม่ปิด) sortRows ดันค่าว่างไปท้ายให้อยู่แล้ว
  // เรียง "มากไปน้อย" จึงได้เรื่องที่แพงที่สุดขึ้นบน ไม่ใช่แถวว่างกองอยู่ข้างบน
  { key: "repair_cost", label: "ค่าซ่อม", type: "number", get: (t) => t.repair_cost },
  { key: "ticket_code", label: "เลขที่ตั๋ว", type: "text", get: (t) => t.ticket_code },
  { key: "equipment", label: "ทรัพย์สิน", type: "text", get: (t) => t.equipment?.asset_code ?? null },
  { key: "requester", label: "ผู้แจ้ง", type: "text", get: (t) => t.requester?.display_name ?? null },
  {
    key: "status",
    label: "สถานะ",
    type: "number",
    firstClick: "asc",
    get: (t) => TICKET_STATUS_ORDER.indexOf(t.status),
    dirText: { asc: "รอดำเนินการ → ยกเลิก", desc: "ยกเลิก → รอดำเนินการ" },
  },
];

export function RepairHistoryBoard({ rows: initialRows, editors = [], notifiable = {} }: { rows: TicketWithRelations[]; editors?: string[]; notifiable?: Record<string, boolean> }) {
  const [rows, setRows] = useServerRows(initialRows);
  const [editing, setEditing] = useState<TicketWithRelations | null>(null);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [requesterFilter, setRequesterFilter] = useState("all");
  const dates = useDateRange();

  // เรียงตามลำดับในทะเบียน (Montipa → Motta → ส่วนกลาง) ไม่ใช่ ก-ฮ
  // เพราะเป็นลำดับที่คนในองค์กรพูดถึงกันจริง
  const companyOptions = useMemo(() => {
    const order = Object.values(COMPANY_LABEL);
    const present = new Set(rows.map((t) => t.company_label ?? "ไม่ระบุบริษัท"));
    return [...order.filter((l) => present.has(l)), ...(present.has("ไม่ระบุบริษัท") ? ["ไม่ระบุบริษัท"] : [])];
  }, [rows]);

  // เลือกบริษัทแล้ว dropdown สาขาต้องเหลือเฉพาะสาขาของบริษัทนั้น
  // ไม่งั้นจะเจอสาขาชื่อเดียวกันสองอันแล้วไม่รู้ว่าอันไหนของใคร
  const branchOptions = useMemo(
    () =>
      optionsFrom(
        rows
          .filter((t) => companyFilter === "all" || (t.company_label ?? "ไม่ระบุบริษัท") === companyFilter)
          .map((t) => t.location)
      ),
    [rows, companyFilter]
  );
  const requesterOptions = useMemo(
    () => optionsFrom(rows.map((t) => t.requester?.display_name)),
    [rows]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((t) => {
      if (companyFilter !== "all" && (t.company_label ?? "ไม่ระบุบริษัท") !== companyFilter)
        return false;
      // กรองสาขาต้องอยู่หลังกรองบริษัท เพราะมีสาขาชื่อซ้ำกันข้ามบริษัท
      if (branchFilter !== "all" && t.location !== branchFilter) return false;
      if (requesterFilter !== "all" && t.requester?.display_name !== requesterFilter) return false;
      if (!inDateRange(t.created_at, dates.range)) return false;
      if (!q) return true;
      return (
        t.ticket_code.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.requester?.display_name.toLowerCase().includes(q) ?? false) ||
        (t.equipment?.asset_code.toLowerCase().includes(q) ?? false)
      );
    });
  }, [rows, search, companyFilter, branchFilter, requesterFilter, dates.range]);

  const sort = useSort(visible, SORT_COLUMNS, {
    defaultKey: "created_at",
    storageKey: "repair",
  });

  const activeFilters = countActive(companyFilter, branchFilter, requesterFilter, dates.active);
  function clearFilters() {
    setSearch("");
    setCompanyFilter("all");
    setBranchFilter("all");
    setRequesterFilter("all");
    dates.reset();
  }

  const totalCost = useMemo(
    () => visible.reduce((sum, t) => sum + (t.repair_cost ?? 0), 0),
    [visible]
  );

  function handleExportCsv() {
    const csvRows = sort.rows.map((t) => ({
      ticket_code: t.ticket_code,
      asset_code: t.equipment?.asset_code ?? "-",
      requester: t.requester?.display_name ?? "-",
      description: t.description,
      repair_cost: t.repair_cost !== null ? formatBaht(t.repair_cost) : "-",
      status: t.status,
      created_at: formatThaiDateShort(t.created_at),
    }));
    const csv = toCsv(csvRows, [
      { key: "ticket_code", header: "เลขที่ตั๋ว" },
      { key: "asset_code", header: "รหัสทรัพย์สิน" },
      { key: "requester", header: "ผู้แจ้ง" },
      { key: "description", header: "รายละเอียด" },
      { key: "repair_cost", header: "ค่าซ่อม" },
      { key: "status", header: "สถานะ" },
      { key: "created_at", header: "วันที่แจ้ง" },
    ]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `repair-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // แบ่งหน้า — ทำงานบน "รายการที่ผ่านตัวกรองแล้ว" ไม่ใช่ข้อมูลดิบ
  // ค้นหา/กรองจึงยังทำกับข้อมูลทั้งชุดเหมือนเดิม แค่ตัดเป็นหน้าๆ ตอนแสดงผล
  const pager = usePaginated(sort.rows, { storageKey: "repair", resetOn: `${sort.key}:${sort.dir}` });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">ประวัติซ่อม</h1>
          <p className="text-sm text-muted">
            รายการแจ้งซ่อมทั้งหมด {rows.length} รายการ · ยอดค่าซ่อมรวม{" "}
            <span className="font-num font-semibold text-ink">
              {formatBaht(totalCost)} บาท
            </span>
          </p>
        </div>
        <Button variant="ghost" onClick={handleExportCsv}>
          ⬇ Export CSV ({visible.length})
        </Button>
      </div>

      <FilterBar>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาเลขที่ตั๋ว, รายละเอียด, ผู้แจ้ง, รหัสทรัพย์สิน..."
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:w-64"
        />
        <SelectFilter
          value={companyFilter}
          onChange={(v) => {
            setCompanyFilter(v);
            setBranchFilter("all");
          }}
          options={companyOptions}
          allLabel="ทุกบริษัท"
        />
        <SelectFilter value={branchFilter} onChange={setBranchFilter} options={branchOptions} allLabel="ทุกสาขา" />
        <SelectFilter
          value={requesterFilter}
          onChange={setRequesterFilter}
          options={requesterOptions}
          allLabel="ผู้แจ้งทุกคน"
        />
        <DateRangeFilter value={dates.range} onChange={dates.setRange} />
        <ClearFiltersButton count={activeFilters} onClear={clearFilters} />
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SortMenu sort={sort} />
        {visible.length !== rows.length && (
          <p className="text-xs text-muted">
            ตัวกรองเหลือ <span className="font-num text-ink">{visible.length}</span> จาก {rows.length} รายการ
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[870px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <SortableTh sort={sort} columnKey="ticket_code">เลขที่ตั๋ว</SortableTh>
              <SortableTh sort={sort} columnKey="equipment">ทรัพย์สิน</SortableTh>
              <SortableTh sort={sort} columnKey="requester">ผู้แจ้ง</SortableTh>
              <SortableTh sort={sort} columnKey="company">บริษัท</SortableTh>
              <SortableTh sort={sort}>รายละเอียด</SortableTh>
              <SortableTh sort={sort} columnKey="repair_cost">ค่าซ่อม</SortableTh>
              <SortableTh sort={sort} columnKey="status">สถานะ</SortableTh>
              <SortableTh sort={sort} columnKey="created_at">วันที่แจ้ง</SortableTh>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((t) => (
              <tr
                key={t.id}
                className="border-b border-line/60 last:border-0 hover:bg-accent-bg/20"
              >
                <td className="whitespace-nowrap px-4 py-3 font-num text-accent">
                  {t.ticket_code}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {t.equipment?.asset_code ?? "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {t.requester?.display_name ?? "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <CompanyBadge label={t.company_label} />
                </td>
                <td className="max-w-xs truncate px-4 py-3" title={t.description}>
                  {t.description}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {t.repair_cost !== null ? `${formatBaht(t.repair_cost)} บ.` : "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <button type="button" onClick={() => setEditing(t)} aria-label={`แก้ไขสถานะ ${t.ticket_code}`}><TicketStatusBadge status={t.status} /></button>
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {formatThaiDateShort(t.created_at)}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  ไม่พบข้อมูล
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination pager={pager} unitLabel="เรื่อง" />
      <TicketStatusModal ticket={editing} editors={editors} canNotify={editing ? notifiable[editing.id] : false}
        onClose={() => setEditing(null)} onSaved={saved => {
          setRows(prev => prev.map(t => t.id === saved.id ? { ...t, ...saved } : t)); setEditing(null);
        }} />
    </div>
  );
}
