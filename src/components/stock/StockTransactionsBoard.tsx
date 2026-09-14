"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { StockTransaction } from "@/lib/types";
import { STOCK_TXN_TYPE_LABEL } from "@/lib/labels";
import { Button } from "@/components/ui/Button";
import { formatThaiDateShort, toCsv } from "@/lib/utils";

type TxnRow = StockTransaction & { item_name: string; item_unit: string };

export function StockTransactionsBoard({ transactions }: { transactions: TxnRow[] }) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter(
      (t) =>
        t.item_name.toLowerCase().includes(q) ||
        (t.staff_name?.toLowerCase().includes(q) ?? false) ||
        (t.reference_no?.toLowerCase().includes(q) ?? false)
    );
  }, [transactions, search]);

  function handleExportCsv() {
    const rows = visible.map((t) => ({
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

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="ค้นหาชื่อรายการ, ผู้ทำรายการ, เลขที่อ้างอิง..."
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:max-w-xs"
      />

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-4 py-3 font-medium">รายการ</th>
              <th className="px-4 py-3 font-medium">ประเภท</th>
              <th className="px-4 py-3 font-medium">จำนวน</th>
              <th className="px-4 py-3 font-medium">ผู้ทำรายการ</th>
              <th className="px-4 py-3 font-medium">เลขที่อ้างอิง</th>
              <th className="px-4 py-3 font-medium">หมายเหตุ</th>
              <th className="px-4 py-3 font-medium">วันที่</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
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
    </div>
  );
}
