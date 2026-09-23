"use client";

import { useMemo, useState } from "react";
import { Pagination, usePaginated } from "@/components/ui/Pagination";
import Link from "next/link";
import type { StockTransaction } from "@/lib/types";
import { STOCK_TXN_TYPE_LABEL } from "@/lib/labels";
import { Button } from "@/components/ui/Button";
import { formatThaiDateShort, toCsv } from "@/lib/utils";
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

type TxnRow = StockTransaction & { item_name: string; item_unit: string };

const SORT_COLUMNS: SortColumn<TxnRow>[] = [
  { key: "created_at", label: "วันที่ทำรายการ", type: "date", get: (t) => t.created_at },
  { key: "item_name", label: "ชื่อรายการ", type: "text", get: (t) => t.item_name },
  { key: "type", label: "ประเภท", type: "text", get: (t) => STOCK_TXN_TYPE_LABEL[t.type] },
  { key: "quantity", label: "จำนวน", type: "number", get: (t) => t.quantity },
  { key: "staff_name", label: "ผู้ทำรายการ", type: "text", get: (t) => t.staff_name },
];

export function StockTransactionsBoard({ transactions }: { transactions: TxnRow[] }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [staffFilter, setStaffFilter] = useState("all");
  const dates = useDateRange();

  const typeOptions = useMemo(
    () => optionsFrom(transactions.map((t) => STOCK_TXN_TYPE_LABEL[t.type])),
    [transactions]
  );
  const staffOptions = useMemo(
    () => optionsFrom(transactions.map((t) => t.staff_name)),
    [transactions]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((t) => {
      if (typeFilter !== "all" && STOCK_TXN_TYPE_LABEL[t.type] !== typeFilter) return false;
      if (staffFilter !== "all" && t.staff_name !== staffFilter) return false;
      if (!inDateRange(t.created_at, dates.range)) return false;
      if (!q) return true;
      return (
        t.item_name.toLowerCase().includes(q) ||
        (t.staff_name?.toLowerCase().includes(q) ?? false) ||
        (t.reference_no?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [transactions, search, typeFilter, staffFilter, dates.range]);

  const sort = useSort(visible, SORT_COLUMNS, {
    defaultKey: "created_at",
    storageKey: "stock-txn",
  });

  const activeFilters = countActive(typeFilter, staffFilter, dates.active);
  function clearFilters() {
    setSearch("");
    setTypeFilter("all");
    setStaffFilter("all");
    dates.reset();
  }

  function handleExportCsv() {
    const rows = sort.rows.map((t) => ({
      item_name: t.item_name,
      type: STOCK_TXN_TYPE_LABEL[t.type],
      quantity: t.quantity,
      staff_name: t.staff_name ?? "-",
      reference_no: t.reference_no ?? "-",
      note: t.note ?? "-",
      created_at: formatThaiDateShort(t.created_at),
    }));
    const csv = toCsv(rows, [
      { key: "item_name", header: "รายการ" },
      { key: "type", header: "ประเภท" },
      { key: "quantity", header: "จำนวน" },
      { key: "staff_name", header: "ผู้ทำรายการ" },
      { key: "reference_no", header: "เลขที่อ้างอิง" },
      { key: "note", header: "หมายเหตุ" },
      { key: "created_at", header: "วันที่ทำรายการ" },
    ]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // แบ่งหน้า — ทำงานบน "รายการที่ผ่านตัวกรองแล้ว" ไม่ใช่ข้อมูลดิบ
  // ค้นหา/กรองจึงยังทำกับข้อมูลทั้งชุดเหมือนเดิม แค่ตัดเป็นหน้าๆ ตอนแสดงผล
  const pager = usePaginated(sort.rows, { storageKey: "stock-txn", resetOn: `${sort.key}:${sort.dir}` });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/stock" className="text-xs text-accent hover:underline">
            ← กลับไปหน้าสต็อก
          </Link>
          <h1 className="text-xl font-bold text-ink">ประวัติ Transaction สต็อก</h1>
          <p className="text-sm text-muted">ทั้งหมด {transactions.length} รายการ</p>
        </div>
        <Button variant="ghost" onClick={handleExportCsv}>
          ⬇ Export CSV ({visible.length})
        </Button>
      </div>

      <FilterBar>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อรายการ, ผู้ทำรายการ, เลขที่อ้างอิง..."
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:w-64"
        />
        <SelectFilter value={typeFilter} onChange={setTypeFilter} options={typeOptions} allLabel="ทุกประเภท" />
        <SelectFilter value={staffFilter} onChange={setStaffFilter} options={staffOptions} allLabel="ผู้ทำรายการทุกคน" />
        <DateRangeFilter value={dates.range} onChange={dates.setRange} />
        <ClearFiltersButton count={activeFilters} onClear={clearFilters} />
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SortMenu sort={sort} />
        {visible.length !== transactions.length && (
          <p className="text-xs text-muted">
            ตัวกรองเหลือ <span className="font-num text-ink">{visible.length}</span> จาก {transactions.length} รายการ
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <SortableTh sort={sort} columnKey="item_name">รายการ</SortableTh>
              <SortableTh sort={sort} columnKey="type">ประเภท</SortableTh>
              <SortableTh sort={sort} columnKey="quantity">จำนวน</SortableTh>
              <SortableTh sort={sort} columnKey="staff_name">ผู้ทำรายการ</SortableTh>
              <SortableTh sort={sort}>เลขที่อ้างอิง</SortableTh>
              <SortableTh sort={sort}>หมายเหตุ</SortableTh>
              <SortableTh sort={sort} columnKey="created_at">วันที่</SortableTh>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((t) => (
              <tr
                key={t.id}
                className="border-b border-line/60 last:border-0 hover:bg-accent-bg/20"
              >
                <td className="whitespace-nowrap px-4 py-3">{t.item_name}</td>
                <td className="whitespace-nowrap px-4 py-3">{STOCK_TXN_TYPE_LABEL[t.type]}</td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-ink">
                  {t.quantity} {t.item_unit}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{t.staff_name ?? "-"}</td>
                <td className="whitespace-nowrap px-4 py-3">{t.reference_no ?? "-"}</td>
                <td className="max-w-xs truncate px-4 py-3">{t.note ?? "-"}</td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {formatThaiDateShort(t.created_at)}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  ยังไม่มีประวัติ transaction
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination pager={pager} unitLabel="รายการ" />
    </div>
  );
}
