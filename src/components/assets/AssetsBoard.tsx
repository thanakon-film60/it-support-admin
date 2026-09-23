"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pagination, usePaginated } from "@/components/ui/Pagination";
import type {
  AssetFormOptions,
  EquipmentCategory,
  EquipmentStatus,
  EquipmentSummary,
} from "@/lib/types";
import { EQUIPMENT_CATEGORY_LABEL } from "@/lib/labels";
import { EquipmentStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatBaht, toCsv } from "@/lib/utils";
import { AssetModal, type AssetEditing } from "./AssetModal";
import { ImportExcelButton } from "./ImportExcelButton";
import { ConfirmDialog } from "@/components/ui/Modal";
import { deleteEquipmentAction } from "@/app/actions/equipment";
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

const STATUS_VALUES: EquipmentStatus[] = [
  "ว่าง",
  "จองแล้ว",
  "ใช้งานอยู่",
  "ส่งซ่อม",
  "เลิกใช้งาน",
];

const SORT_COLUMNS: SortColumn<EquipmentSummary>[] = [
  // ค่าตั้งต้นของหน้านี้ = "เพิ่มเข้าระบบล่าสุด" ไม่ใช่รหัสทรัพย์สิน
  // เพราะสิ่งที่คนเปิดหน้านี้มาดูบ่อยสุดคือ "ของที่เพิ่งลงทะเบียน/เพิ่ง import เข้ามา"
  { key: "created_at", label: "วันที่เพิ่มเข้าระบบ", type: "date", get: (e) => e.created_at },
  { key: "asset_code", label: "รหัสทรัพย์สิน", type: "text", get: (e) => e.asset_code },
  { key: "category", label: "ประเภท", type: "text", get: (e) => EQUIPMENT_CATEGORY_LABEL[e.category] },
  { key: "brand_model", label: "ยี่ห้อ/รุ่น", type: "text", get: (e) => e.brand_model },
  { key: "status", label: "สถานะ", type: "text", get: (e) => e.status },
  { key: "owner_name", label: "ผู้ครอบครอง", type: "text", get: (e) => e.owner_name },
  { key: "install_location", label: "สถานที่ติดตั้ง", type: "text", get: (e) => e.install_location },
  { key: "purchase_price", label: "ราคาซื้อ", type: "number", get: (e) => e.purchase_price },
  { key: "repair_count", label: "จำนวนครั้งที่ซ่อม", type: "number", get: (e) => e.repair_count },
];

export function AssetsBoard({
  equipment,
  options,
  initialStatus = "all",
}: {
  equipment: EquipmentSummary[];
  options?: AssetFormOptions;
  /** สถานะที่ให้เลือกไว้ตั้งแต่เปิดหน้า — มาจาก ?status= ที่การ์ดบนหน้าภาพรวมลิงก์มา */
  initialStatus?: "all" | EquipmentStatus;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<AssetEditing>(null);
  const [deleting, setDeleting] = useState<EquipmentSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | EquipmentCategory>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | EquipmentStatus>(initialStatus);
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const dates = useDateRange();

  const ownerOptions = useMemo(() => optionsFrom(equipment.map((e) => e.owner_name)), [equipment]);
  const locationOptions = useMemo(
    () => optionsFrom(equipment.map((e) => e.install_location)),
    [equipment]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return equipment.filter((e) => {
      if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (ownerFilter !== "all" && e.owner_name !== ownerFilter) return false;
      if (locationFilter !== "all" && e.install_location !== locationFilter) return false;
      if (!inDateRange(e.created_at, dates.range)) return false;
      if (!q) return true;
      return (
        e.asset_code.toLowerCase().includes(q) ||
        (e.brand_model?.toLowerCase().includes(q) ?? false) ||
        (e.serial_number?.toLowerCase().includes(q) ?? false) ||
        (e.owner_name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [equipment, search, categoryFilter, statusFilter, ownerFilter, locationFilter, dates.range]);

  const sort = useSort(visible, SORT_COLUMNS, {
    defaultKey: "created_at",
    storageKey: "assets",
  });

  const activeFilters = countActive(
    categoryFilter,
    statusFilter,
    ownerFilter,
    locationFilter,
    dates.active
  );
  function clearFilters() {
    setSearch("");
    setCategoryFilter("all");
    setStatusFilter("all");
    setOwnerFilter("all");
    setLocationFilter("all");
    dates.reset();
  }

  function confirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteEquipmentAction(deleting.id);
      if (result.error) setDeleteError(result.error);
      else {
        setDeleting(null);
        router.refresh();
      }
    });
  }

  function handleExportCsv() {
    const rows = sort.rows.map((e) => ({
      asset_code: e.asset_code,
      category: EQUIPMENT_CATEGORY_LABEL[e.category],
      brand_model: e.brand_model ?? "-",
      serial_number: e.serial_number ?? "-",
      status: e.status,
      owner_name: e.owner_name ?? "-",
      install_location: e.install_location ?? "-",
      purchase_price: e.purchase_price !== null ? formatBaht(e.purchase_price) : "-",
      purchase_date: e.purchase_date ?? "-",
      repair_count: e.repair_count,
    }));
    const csv = toCsv(rows, [
      { key: "asset_code", header: "รหัสทรัพย์สิน" },
      { key: "category", header: "ประเภท" },
      { key: "brand_model", header: "ยี่ห้อ/รุ่น" },
      { key: "serial_number", header: "Serial Number" },
      { key: "status", header: "สถานะ" },
      { key: "owner_name", header: "ผู้ครอบครอง" },
      { key: "install_location", header: "สถานที่ติดตั้ง" },
      { key: "purchase_price", header: "ราคาซื้อ" },
      { key: "purchase_date", header: "วันที่ซื้อ" },
      { key: "repair_count", header: "จำนวนครั้งที่ซ่อม" },
    ]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `equipment-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // แบ่งหน้า — ทำงานบน "รายการที่ผ่านตัวกรองแล้ว" ไม่ใช่ข้อมูลดิบ
  // ค้นหา/กรองจึงยังทำกับข้อมูลทั้งชุดเหมือนเดิม แค่ตัดเป็นหน้าๆ ตอนแสดงผล
  const pager = usePaginated(sort.rows, { storageKey: "assets", resetOn: `${sort.key}:${sort.dir}` });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">ทรัพย์สิน</h1>
          <p className="text-sm text-muted">
            ครุภัณฑ์และอุปกรณ์ IT ทั้งหมด {equipment.length} รายการ
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <ImportExcelButton />
          <Button variant="ghost" onClick={handleExportCsv}>
            ⬇ Export CSV ({visible.length})
          </Button>
          <Button onClick={() => setEditing({ mode: "new" })}>+ เพิ่มทรัพย์สิน</Button>
        </div>
      </div>

      <FilterBar>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหารหัสทรัพย์สิน, ยี่ห้อ/รุ่น, S/N, ผู้ครอบครอง..."
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:w-64"
        />
        <select
          aria-label="ประเภททรัพย์สิน"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as "all" | EquipmentCategory)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="all">ทุกประเภท</option>
          {Object.entries(EQUIPMENT_CATEGORY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="สถานะทรัพย์สิน"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | EquipmentStatus)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="all">ทุกสถานะ</option>
          {STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <SelectFilter value={ownerFilter} onChange={setOwnerFilter} options={ownerOptions} allLabel="ผู้ครอบครองทุกคน" />
        <SelectFilter
          value={locationFilter}
          onChange={setLocationFilter}
          options={locationOptions}
          allLabel="ทุกสถานที่"
        />
        <DateRangeFilter value={dates.range} onChange={dates.setRange} label="วันที่เพิ่มเข้าระบบ" />
        <ClearFiltersButton count={activeFilters} onClear={clearFilters} />
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SortMenu sort={sort} />
        {visible.length !== equipment.length && (
          <p className="text-xs text-muted">
            ตัวกรองเหลือ <span className="font-num text-ink">{visible.length}</span> จาก {equipment.length} ชิ้น
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <SortableTh sort={sort} columnKey="asset_code">รหัสทรัพย์สิน</SortableTh>
              <SortableTh sort={sort} columnKey="category">ประเภท</SortableTh>
              <SortableTh sort={sort} columnKey="brand_model">ยี่ห้อ/รุ่น</SortableTh>
              <SortableTh sort={sort} columnKey="status">สถานะ</SortableTh>
              <SortableTh sort={sort} columnKey="owner_name">ผู้ครอบครอง</SortableTh>
              <SortableTh sort={sort} columnKey="install_location">สถานที่ติดตั้ง</SortableTh>
              <SortableTh sort={sort} columnKey="purchase_price">ราคาซื้อ</SortableTh>
              <SortableTh sort={sort} columnKey="repair_count">ซ่อมมาแล้ว</SortableTh>
              <th className="px-4 py-3 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((e) => (
              <tr
                key={e.id}
                className="border-b border-line/60 last:border-0 hover:bg-accent-bg/20"
              >
                <td className="whitespace-nowrap px-4 py-3 font-num text-accent">
                  {e.asset_code}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {EQUIPMENT_CATEGORY_LABEL[e.category]}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{e.brand_model ?? "-"}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <EquipmentStatusBadge status={e.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">{e.owner_name ?? "-"}</td>
                <td className="whitespace-nowrap px-4 py-3">{e.install_location ?? "-"}</td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {e.purchase_price !== null ? `${formatBaht(e.purchase_price)} บ.` : "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {e.repair_count}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <div className="inline-flex gap-1.5">
                    <RowButton onClick={() => setEditing({ mode: "edit", asset: e })} disabled={isPending}>
                      แก้ไข
                    </RowButton>
                    <RowButton onClick={() => setDeleting(e)} disabled={isPending} danger>
                      ลบ
                    </RowButton>
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted">
                  ไม่พบทรัพย์สินที่ตรงกับเงื่อนไข
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

      <AssetModal
        editing={editing}
        options={options}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
        onConfirm={confirmDelete}
        pending={isPending}
        title="ลบทรัพย์สิน"
        message={
          deleting ? (
            <>
              ต้องการลบ <span className="font-num font-semibold">{deleting.asset_code}</span>
              {deleting.brand_model ? ` (${deleting.brand_model})` : ""} ออกจากระบบใช่ไหม
            </>
          ) : null
        }
        blockedReason={deleteError}
      />
    </div>
  );
}

function RowButton({
  onClick,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[2.25rem] rounded-lg border border-line px-3 text-xs text-muted transition disabled:opacity-40 ${
        danger
          ? "hover:border-rose-400/40 hover:text-rose-300"
          : "hover:border-cyan-400/40 hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}
