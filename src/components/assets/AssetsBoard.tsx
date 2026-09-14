"use client";

import { useMemo, useState } from "react";
import type { EquipmentCategory, EquipmentStatus, EquipmentSummary } from "@/lib/types";
import { EQUIPMENT_CATEGORY_LABEL } from "@/lib/labels";
import { EquipmentStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatBaht, toCsv } from "@/lib/utils";
import { AssetForm } from "./AssetForm";
import { ImportExcelButton } from "./ImportExcelButton";

const STATUS_VALUES: EquipmentStatus[] = [
  "ว่าง",
  "จองแล้ว",
  "ใช้งานอยู่",
  "ส่งซ่อม",
  "เลิกใช้งาน",
];

export function AssetsBoard({ equipment }: { equipment: EquipmentSummary[] }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | EquipmentCategory>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | EquipmentStatus>("all");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return equipment.filter((e) => {
      if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (!q) return true;
      return (
        e.asset_code.toLowerCase().includes(q) ||
        (e.brand_model?.toLowerCase().includes(q) ?? false) ||
        (e.serial_number?.toLowerCase().includes(q) ?? false) ||
        (e.owner_name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [equipment, search, categoryFilter, statusFilter]);

  function handleExportCsv() {
    const rows = visible.map((e) => ({
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
        </div>
      </div>

      <AssetForm />

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหารหัสทรัพย์สิน, ยี่ห้อ/รุ่น, S/N, ผู้ครอบครอง..."
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:max-w-xs"
        />
        <select
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
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[840px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-4 py-3 font-medium">รหัสทรัพย์สิน</th>
              <th className="px-4 py-3 font-medium">ประเภท</th>
              <th className="px-4 py-3 font-medium">ยี่ห้อ/รุ่น</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
              <th className="px-4 py-3 font-medium">ผู้ครอบครอง</th>
              <th className="px-4 py-3 font-medium">สถานที่ติดตั้ง</th>
              <th className="px-4 py-3 font-medium">ราคาซื้อ</th>
              <th className="px-4 py-3 font-medium">ซ่อมมาแล้ว</th>
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
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  ไม่พบทรัพย์สินที่ตรงกับเงื่อนไข
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
