"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pagination, usePaginated } from "@/components/ui/Pagination";
import Link from "next/link";
import type { StockItemWithComputed } from "@/lib/types";
import { StockStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { toCsv } from "@/lib/utils";
import { StockActionModal, type StockActionKind } from "./StockActionModal";
import { StockItemModal, type StockEditing } from "./StockItemModal";
import { ConfirmDialog } from "@/components/ui/Modal";
import { deleteStockItemAction } from "@/app/actions/stock";
import { SortMenu, SortableTh, useSort } from "@/components/ui/SortControl";
import type { SortColumn } from "@/lib/sorting";
import {
  ClearFiltersButton,
  FilterBar,
  SelectFilter,
  countActive,
} from "@/components/ui/Filters";

/** ความเร่งด่วนของสถานะสต็อก — ใช้เรียงแทนตัวอักษร
 *  ต้องการให้ "ต่ำกว่าขั้นต่ำ" (ของใกล้หมด ต้องสั่งซื้อ) ลอยขึ้นบนสุด ไม่ใช่เรียงตาม ก-ฮ */
// ผูกกับ union type ตรงๆ ไม่ใช่ Record<string, number> — ถ้าวันหน้ามีสถานะใหม่หรือ
// เปลี่ยนคำ TypeScript จะฟ้องทันที แทนที่จะเงียบแล้วเรียงผิดโดยไม่มีใครรู้
const STATUS_URGENCY: Record<StockItemWithComputed["stock_status"], number> = {
  ต่ำกว่า: 0,
  ถึงขั้นต่ำ: 1,
  ปกติ: 2,
};

const SORT_COLUMNS: SortColumn<StockItemWithComputed>[] = [
  // ค่าตั้งต้นของหน้านี้ยังเป็น "ชื่อ ก→ฮ" ไม่ใช่วันที่ เพราะตารางนี้ไม่มีคอลัมน์วันที่
  // และคนใช้หน้านี้เพื่อ "หาของชิ้นที่รู้ชื่ออยู่แล้ว" การเรียงตามวันจะทำให้หายาก
  { key: "name", label: "ชื่อรายการ", type: "text", get: (i) => i.name },
  {
    key: "stock_status",
    label: "ความเร่งด่วน",
    type: "number",
    firstClick: "asc",
    get: (i) => STATUS_URGENCY[i.stock_status],
    dirText: { asc: "ของใกล้หมดขึ้นก่อน", desc: "ของที่ปกติขึ้นก่อน" },
  },
  { key: "quantity_available", label: "คงเหลือ", type: "number", get: (i) => i.quantity_available },
  { key: "category", label: "หมวดหมู่", type: "text", get: (i) => i.category },
  { key: "location", label: "สถานที่จัดเก็บ", type: "text", get: (i) => i.location },
  { key: "created_at", label: "วันที่เพิ่มเข้าระบบ", type: "date", get: (i) => i.created_at },
];

/** ค่าพิเศษของตัวกรองสถานะ = "ถึงขั้นต่ำ + ต่ำกว่า" รวมกัน
 *
 *  จำเป็นเพราะการ์ด "สต็อกใกล้หมด" บนหน้าภาพรวมนับสองสถานะนี้รวมกัน
 *  ถ้าลิงก์ไปที่สถานะเดียว ผู้ใช้จะกดเลข 7 แล้วเจอ 3 แถว — พอเลขไม่ตรง
 *  ความเชื่อถือในตัวเลขทั้งหน้าแดชบอร์ดก็หายไปด้วย */
const LOW_STOCK_FILTER = "low";

export function StockBoard({
  items,
  staffName,
  initialStatus = "all",
}: {
  items: StockItemWithComputed[];
  staffName: string;
  /** สถานะที่ให้เลือกไว้ตั้งแต่เปิดหน้า — "low" = ใกล้หมดทั้งสองระดับ */
  initialStatus?: string;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [modalState, setModalState] = useState<{
    item: StockItemWithComputed;
    action: StockActionKind;
  } | null>(null);
  const [editing, setEditing] = useState<StockEditing>(null);
  const [deleting, setDeleting] = useState<StockItemWithComputed | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function confirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteStockItemAction(deleting.id);
      if (result.error) setDeleteError(result.error);
      else {
        setDeleting(null);
        router.refresh();
      }
    });
  }

  const categoryOptions = useMemo(
    () => [...new Set(items.map((i) => (i.category ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th")),
    [items]
  );
  const locationOptions = useMemo(
    () => [...new Set(items.map((i) => (i.location ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th")),
    [items]
  );
  const statusOptions = useMemo(
    () => [
      LOW_STOCK_FILTER,
      ...[...new Set(items.map((i) => i.stock_status))].sort(
        (a, b) => STATUS_URGENCY[a] - STATUS_URGENCY[b]
      ),
    ],
    [items]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (categoryFilter !== "all" && i.category !== categoryFilter) return false;
      if (locationFilter !== "all" && i.location !== locationFilter) return false;
      if (statusFilter === LOW_STOCK_FILTER) {
        if (i.stock_status === "ปกติ") return false;
      } else if (statusFilter !== "all" && i.stock_status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        (i.category?.toLowerCase().includes(q) ?? false) ||
        (i.location?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [items, search, categoryFilter, locationFilter, statusFilter]);

  const sort = useSort(visible, SORT_COLUMNS, { defaultKey: "name", storageKey: "stock" });

  const activeFilters = countActive(categoryFilter, locationFilter, statusFilter);
  function clearFilters() {
    setSearch("");
    setCategoryFilter("all");
    setLocationFilter("all");
    setStatusFilter("all");
  }

  function handleExportCsv() {
    const rows = sort.rows.map((i) => ({
      name: i.name,
      category: i.category ?? "-",
      unit: i.unit,
      location: i.location ?? "-",
      quantity_available: i.quantity_available,
      safety_stock: i.safety_stock,
      stock_status: i.stock_status,
    }));
    const csv = toCsv(rows, [
      { key: "name", header: "ชื่อรายการ" },
      { key: "category", header: "หมวดหมู่" },
      { key: "unit", header: "หน่วยนับ" },
      { key: "location", header: "สถานที่จัดเก็บ" },
      { key: "quantity_available", header: "คงเหลือ" },
      { key: "safety_stock", header: "Safety Stock" },
      { key: "stock_status", header: "สถานะ" },
    ]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // แบ่งหน้า — ทำงานบน "รายการที่ผ่านตัวกรองแล้ว" ไม่ใช่ข้อมูลดิบ
  // ค้นหา/กรองจึงยังทำกับข้อมูลทั้งชุดเหมือนเดิม แค่ตัดเป็นหน้าๆ ตอนแสดงผล
  const pager = usePaginated(sort.rows, { storageKey: "stock", resetOn: `${sort.key}:${sort.dir}` });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">สต็อก</h1>
          <p className="text-sm text-muted">อุปกรณ์สิ้นเปลืองทั้งหมด {items.length} รายการ</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/stock/transactions"
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent"
          >
            📜 ประวัติ Transaction
          </Link>
          <Button variant="ghost" onClick={handleExportCsv}>
            ⬇ Export CSV ({visible.length})
          </Button>
          <Button onClick={() => setEditing({ mode: "new" })}>+ เพิ่มรายการ</Button>
        </div>
      </div>

      <FilterBar>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อรายการ, หมวดหมู่, สถานที่จัดเก็บ..."
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:w-64"
        />
        <SelectFilter value={categoryFilter} onChange={setCategoryFilter} options={categoryOptions} allLabel="ทุกหมวดหมู่" />
        <SelectFilter value={locationFilter} onChange={setLocationFilter} options={locationOptions} allLabel="ทุกสถานที่จัดเก็บ" />
        <SelectFilter
          value={statusFilter}
          onChange={setStatusFilter}
          options={statusOptions}
          allLabel="ทุกสถานะ"
          labelOf={(v) => (v === LOW_STOCK_FILTER ? "⚠️ ใกล้หมด (ถึงขั้นต่ำ + ต่ำกว่า)" : v)}
        />
        <ClearFiltersButton count={activeFilters} onClear={clearFilters} />
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SortMenu sort={sort} />
        {visible.length !== items.length && (
          <p className="text-xs text-muted">
            ตัวกรองเหลือ <span className="font-num text-ink">{visible.length}</span> จาก {items.length} รายการ
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <SortableTh sort={sort} columnKey="name">ชื่อรายการ</SortableTh>
              <SortableTh sort={sort} columnKey="category">หมวดหมู่</SortableTh>
              <SortableTh sort={sort} columnKey="location">สถานที่จัดเก็บ</SortableTh>
              <SortableTh sort={sort} columnKey="quantity_available">คงเหลือ</SortableTh>
              <SortableTh sort={sort}>Safety Stock</SortableTh>
              <SortableTh sort={sort} columnKey="stock_status">สถานะ</SortableTh>
              <SortableTh sort={sort}>จัดการ</SortableTh>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((item) => (
              <tr
                key={item.id}
                className="border-b border-line/60 last:border-0 hover:bg-accent-bg/20"
              >
                <td className="whitespace-nowrap px-4 py-3">{item.name}</td>
                <td className="whitespace-nowrap px-4 py-3">{item.category ?? "-"}</td>
                <td className="whitespace-nowrap px-4 py-3">{item.location ?? "-"}</td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-ink">
                  {item.quantity_available} {item.unit}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {item.safety_stock} {item.unit}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StockStatusBadge status={item.stock_status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <details className="relative inline-block">
                    <summary className="cursor-pointer list-none rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent hover:text-accent">
                      จัดการ ▾
                    </summary>
                    <div className="absolute right-0 z-10 mt-1 flex w-44 flex-col gap-0.5 rounded-lg border border-line bg-page p-1 shadow-xl">
                      <MenuButton onClick={() => setModalState({ item, action: "in" })}>
                        📥 รับเข้าสต็อก
                      </MenuButton>
                      <MenuButton onClick={() => setModalState({ item, action: "adjust" })}>
                        ✏️ ปรับแก้จำนวน
                      </MenuButton>
                      <MenuButton onClick={() => setModalState({ item, action: "safety" })}>
                        🛡️ แก้ Safety Stock
                      </MenuButton>
                      <span className="my-0.5 block h-px bg-line" aria-hidden />
                      <MenuButton onClick={() => setEditing({ mode: "edit", item })}>
                        📝 แก้ไขรายการ
                      </MenuButton>
                      <MenuButton onClick={() => setDeleting(item)} danger>
                        🗑 ลบรายการ
                      </MenuButton>
                    </div>
                  </details>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  ไม่พบข้อมูล
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination pager={pager} unitLabel="รายการ" />

      {modalState && (
        <StockActionModal
          item={modalState.item}
          action={modalState.action}
          staffName={staffName}
          onClose={() => setModalState(null)}
        />
      )}

      <StockItemModal
        editing={editing}
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
        title="ลบรายการสต็อก"
        message={
          deleting ? (
            <>
              ต้องการลบ <span className="font-semibold">{deleting.name}</span> ออกจากสต็อกใช่ไหม
            </>
          ) : null
        }
        blockedReason={deleteError}
      />
    </div>
  );
}

function MenuButton({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        onClick();
        const details = e.currentTarget.closest("details");
        if (details) details.open = false;
      }}
      // min-h 40px — เมนูนี้เปิดบนมือถือด้วย ตัวเลือกที่สูงแค่ตามข้อความจะกดพลาดข้ามอัน
      className={`min-h-[2.5rem] rounded-md px-3 py-2 text-left text-xs transition ${
        danger
          ? "text-rose-300 hover:bg-rose-500/10"
          : "text-ink hover:bg-accent-bg hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}
