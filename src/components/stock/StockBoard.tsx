"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { StockItemWithComputed } from "@/lib/types";
import { StockStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { toCsv } from "@/lib/utils";
import { StockItemForm } from "./StockItemForm";
import { StockActionModal, type StockActionKind } from "./StockActionModal";

export function StockBoard({
  items,
  staffName,
}: {
  items: StockItemWithComputed[];
  staffName: string;
}) {
  const [search, setSearch] = useState("");
  const [modalState, setModalState] = useState<{
    item: StockItemWithComputed;
    action: StockActionKind;
  } | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.category?.toLowerCase().includes(q) ?? false) ||
        (i.location?.toLowerCase().includes(q) ?? false)
    );
  }, [items, search]);

  function handleExportCsv() {
    const rows = visible.map((i) => ({
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
        </div>
      </div>

      <StockItemForm />

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="ค้นหาชื่อรายการ, หมวดหมู่, สถานที่จัดเก็บ..."
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:max-w-xs"
      />

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-4 py-3 font-medium">ชื่อรายการ</th>
              <th className="px-4 py-3 font-medium">หมวดหมู่</th>
              <th className="px-4 py-3 font-medium">สถานที่จัดเก็บ</th>
              <th className="px-4 py-3 font-medium">คงเหลือ</th>
              <th className="px-4 py-3 font-medium">Safety Stock</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
              <th className="px-4 py-3 font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
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

      {modalState && (
        <StockActionModal
          item={modalState.item}
          action={modalState.action}
          staffName={staffName}
          onClose={() => setModalState(null)}
        />
      )}
    </div>
  );
}

function MenuButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        onClick();
        const details = e.currentTarget.closest("details");
        if (details) details.open = false;
      }}
      className="rounded-md px-3 py-2 text-left text-xs text-ink hover:bg-accent-bg hover:text-accent"
    >
      {children}
    </button>
  );
}
