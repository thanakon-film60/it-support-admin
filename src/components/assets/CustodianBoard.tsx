"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pagination, usePaginated } from "@/components/ui/Pagination";
import type { CustodianFormOptions, EquipmentSummary } from "@/lib/types";
import { EQUIPMENT_CATEGORY_LABEL } from "@/lib/labels";
import { EquipmentStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ageFrom, toCsv } from "@/lib/utils";
import { CustodianModal } from "@/components/assets/CustodianModal";
import { SortMenu, SortableTh, useSort } from "@/components/ui/SortControl";
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

const SORT_COLUMNS: SortColumn<EquipmentSummary>[] = [
  // "ถือครองมาแล้ว" เรียงตามวันที่เริ่มถือครอง ไม่ใช่ตามข้อความที่แสดง ("3 เดือน", "1 ปี")
  // ถ้าเรียงตามข้อความ "10 เดือน" จะมาก่อน "2 ปี" เพราะเทียบตัวอักษร ซึ่งผิดความหมายสิ้นเชิง
  // ค่าตั้งต้น = เพิ่งรับไปล่าสุดก่อน (desc) ตรงกับที่คนถามบ่อยว่า "ใครเพิ่งรับเครื่องไป"
  {
    key: "since",
    label: "วันที่เริ่มถือครอง",
    type: "date",
    get: (e) => e.current_holder_since,
    dirText: { desc: "เพิ่งรับไปล่าสุด", asc: "ถือครองนานที่สุด" },
  },
  { key: "asset_code", label: "รหัสทรัพย์สิน", type: "text", get: (e) => e.asset_code },
  { key: "category", label: "ประเภท", type: "text", get: (e) => EQUIPMENT_CATEGORY_LABEL[e.category] },
  { key: "brand_model", label: "ยี่ห้อ/รุ่น", type: "text", get: (e) => e.brand_model },
  { key: "owner_name", label: "ผู้ครอบครอง", type: "text", get: (e) => e.owner_name },
  { key: "owner_department", label: "แผนก", type: "text", get: (e) => e.owner_department },
  { key: "status", label: "สถานะ", type: "text", get: (e) => e.status },
];

const EMPTY_OPTIONS: CustodianFormOptions = { owners: [], departments: [] };

export function CustodianBoard({
  rows,
  options = EMPTY_OPTIONS,
}: {
  rows: EquipmentSummary[];
  /** ตัวเลือกผู้ครอบครอง/แผนก — ประกอบฝั่งเซิร์ฟเวอร์แล้วส่งลงมา (client แตะ lib/db เองไม่ได้) */
  options?: CustodianFormOptions;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const dates = useDateRange();

  const ownerOptions = useMemo(() => optionsFrom(rows.map((e) => e.owner_name)), [rows]);
  const deptOptions = useMemo(() => optionsFrom(rows.map((e) => e.owner_department)), [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((e) => {
      if (ownerFilter !== "all" && e.owner_name !== ownerFilter) return false;
      if (deptFilter !== "all" && e.owner_department !== deptFilter) return false;
      if (!inDateRange(e.current_holder_since, dates.range)) return false;
      if (!q) return true;
      return (
        e.asset_code.toLowerCase().includes(q) ||
        (e.owner_name?.toLowerCase().includes(q) ?? false) ||
        (e.owner_department?.toLowerCase().includes(q) ?? false) ||
        (e.brand_model?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [rows, search, ownerFilter, deptFilter, dates.range]);

  const sort = useSort(visible, SORT_COLUMNS, { defaultKey: "since", storageKey: "custodian" });

  const activeFilters = countActive(ownerFilter, deptFilter, dates.active);
  function clearFilters() {
    setSearch("");
    setOwnerFilter("all");
    setDeptFilter("all");
    dates.reset();
  }

  function handleExportCsv() {
    const csvRows = sort.rows.map((e) => ({
      asset_code: e.asset_code,
      category: EQUIPMENT_CATEGORY_LABEL[e.category],
      brand_model: e.brand_model ?? "-",
      owner_name: e.owner_name ?? "-",
      owner_department: e.owner_department ?? "-",
      current_holder_since: e.current_holder_since ? ageFrom(e.current_holder_since) : "-",
      status: e.status,
    }));
    const csv = toCsv(csvRows, [
      { key: "asset_code", header: "รหัสทรัพย์สิน" },
      { key: "category", header: "ประเภท" },
      { key: "brand_model", header: "ยี่ห้อ/รุ่น" },
      { key: "owner_name", header: "ผู้ครอบครอง" },
      { key: "owner_department", header: "แผนก" },
      { key: "current_holder_since", header: "ถือครองมาแล้ว" },
      { key: "status", header: "สถานะ" },
    ]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `custodian-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // แบ่งหน้า — ทำงานบน "รายการที่ผ่านตัวกรองแล้ว" ไม่ใช่ข้อมูลดิบ
  // ค้นหา/กรองจึงยังทำกับข้อมูลทั้งชุดเหมือนเดิม แค่ตัดเป็นหน้าๆ ตอนแสดงผล
  const pager = usePaginated(sort.rows, { storageKey: "custodian", resetOn: `${sort.key}:${sort.dir}` });

  const editing = useMemo(() => rows.find((e) => e.id === editingId) ?? null, [rows, editingId]);

  /** ไม่ทำ optimistic update ที่นี่โดยตั้งใจ — การคืนเครื่องทำให้แถวนั้น "หายไปจากหน้านี้"
   *  (หน้านี้แสดงเฉพาะของที่มีผู้ถือครอง) การเดาผลลัพธ์เองจึงเสี่ยงกว่าการดึงของจริงมาใหม่ */
  function handleSaved() {
    setEditingId(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">ผู้ครอบครอง</h1>
          <p className="text-sm text-muted">
            ทรัพย์สินที่มีผู้ถือครองอยู่ในปัจจุบัน {rows.length} รายการ · คลิกที่แถวเพื่อแก้ไขผู้ครอบครอง
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
          placeholder="ค้นหารหัสทรัพย์สิน, ผู้ครอบครอง, แผนก..."
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:w-64"
        />
        <SelectFilter value={ownerFilter} onChange={setOwnerFilter} options={ownerOptions} allLabel="ผู้ครอบครองทุกคน" />
        <SelectFilter value={deptFilter} onChange={setDeptFilter} options={deptOptions} allLabel="ทุกแผนก" />
        <DateRangeFilter value={dates.range} onChange={dates.setRange} label="วันที่เริ่มถือครอง" />
        <ClearFiltersButton count={activeFilters} onClear={clearFilters} />
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SortMenu sort={sort} />
        {visible.length !== rows.length && (
          <p className="text-xs text-muted">
            ตัวกรองเหลือ <span className="font-num text-ink">{visible.length}</span> จาก {rows.length} ชิ้น
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <SortableTh sort={sort} columnKey="asset_code">รหัสทรัพย์สิน</SortableTh>
              <SortableTh sort={sort} columnKey="category">ประเภท</SortableTh>
              <SortableTh sort={sort} columnKey="brand_model">ยี่ห้อ/รุ่น</SortableTh>
              <SortableTh sort={sort} columnKey="owner_name">ผู้ครอบครอง</SortableTh>
              <SortableTh sort={sort} columnKey="owner_department">แผนก</SortableTh>
              <SortableTh sort={sort} columnKey="since">ถือครองมาแล้ว</SortableTh>
              <SortableTh sort={sort} columnKey="status">สถานะ</SortableTh>
              <SortableTh sort={sort}>จัดการ</SortableTh>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((e) => (
              <tr
                key={e.id}
                onClick={() => setEditingId(e.id)}
                className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-accent-bg/20"
              >
                <td className="whitespace-nowrap px-4 py-3 font-num text-accent">
                  {e.asset_code}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {EQUIPMENT_CATEGORY_LABEL[e.category]}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{e.brand_model ?? "-"}</td>
                <td className="whitespace-nowrap px-4 py-3">{e.owner_name ?? "-"}</td>
                <td className="whitespace-nowrap px-4 py-3">{e.owner_department ?? "-"}</td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {e.current_holder_since ? ageFrom(e.current_holder_since) : "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <EquipmentStatusBadge status={e.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <button
                    type="button"
                    // กัน event ไม่ให้วิ่งต่อไปถึงแถว ไม่งั้น handler ของแถวจะถูกเรียกซ้ำอีกรอบ
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditingId(e.id);
                    }}
                    className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-accent"
                  >
                    ✎ แก้ไข
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  ไม่พบข้อมูล
                  {activeFilters > 0 && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="text-accent underline underline-offset-2"
                      >
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

      <Pagination pager={pager} unitLabel="ชิ้น" />

      <CustodianModal
        asset={editing}
        options={options}
        onClose={() => setEditingId(null)}
        onSaved={handleSaved}
      />
    </div>
  );
}
