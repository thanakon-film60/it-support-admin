"use client";

import { useMemo, useState } from "react";
import type { EquipmentSummary } from "@/lib/types";
import { EQUIPMENT_CATEGORY_LABEL } from "@/lib/labels";
import { EquipmentStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ageFrom, toCsv } from "@/lib/utils";

export function CustodianBoard({ rows }: { rows: EquipmentSummary[] }) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (e) =>
        e.asset_code.toLowerCase().includes(q) ||
        (e.owner_name?.toLowerCase().includes(q) ?? false) ||
        (e.owner_department?.toLowerCase().includes(q) ?? false) ||
        (e.brand_model?.toLowerCase().includes(q) ?? false)
    );
  }, [rows, search]);

  function handleExportCsv() {
    const csvRows = visible.map((e) => ({
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">ผู้ครอบครอง</h1>
          <p className="text-sm text-muted">
            ทรัพย์สินที่มีผู้ถือครองอยู่ในปัจจุบัน {rows.length} รายการ (read-only)
          </p>
        </div>
        <Button variant="ghost" onClick={handleExportCsv}>
          ⬇ Export CSV ({visible.length})
        </Button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="ค้นหารหัสทรัพย์สิน, ผู้ครอบครอง, แผนก..."
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:max-w-xs"
      />

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-4 py-3 font-medium">รหัสทรัพย์สิน</th>
              <th className="px-4 py-3 font-medium">ประเภท</th>
              <th className="px-4 py-3 font-medium">ยี่ห้อ/รุ่น</th>
              <th className="px-4 py-3 font-medium">ผู้ครอบครอง</th>
              <th className="px-4 py-3 font-medium">แผนก</th>
              <th className="px-4 py-3 font-medium">ถือครองมาแล้ว</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
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
                <td className="whitespace-nowrap px-4 py-3">{e.owner_name ?? "-"}</td>
                <td className="whitespace-nowrap px-4 py-3">{e.owner_department ?? "-"}</td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {e.current_holder_since ? ageFrom(e.current_holder_since) : "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <EquipmentStatusBadge status={e.status} />
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
    </div>
  );
}
