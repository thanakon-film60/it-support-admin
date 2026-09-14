"use client";

import { useMemo, useState } from "react";
import type { TicketWithRelations } from "@/lib/types";
import { TicketStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatThaiDateShort, formatBaht, toCsv } from "@/lib/utils";

export function RepairHistoryBoard({ rows }: { rows: TicketWithRelations[] }) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (t) =>
        t.ticket_code.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.requester?.display_name.toLowerCase().includes(q) ?? false) ||
        (t.equipment?.asset_code.toLowerCase().includes(q) ?? false)
    );
  }, [rows, search]);

  const totalCost = useMemo(
    () => visible.reduce((sum, t) => sum + (t.repair_cost ?? 0), 0),
    [visible]
  );

  function handleExportCsv() {
    const csvRows = visible.map((t) => ({
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

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="ค้นหาเลขที่ตั๋ว, รายละเอียด, ผู้แจ้ง, รหัสทรัพย์สิน..."
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:max-w-xs"
      />

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-4 py-3 font-medium">เลขที่ตั๋ว</th>
              <th className="px-4 py-3 font-medium">ทรัพย์สิน</th>
              <th className="px-4 py-3 font-medium">ผู้แจ้ง</th>
              <th className="px-4 py-3 font-medium">รายละเอียด</th>
              <th className="px-4 py-3 font-medium">ค่าซ่อม</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
              <th className="px-4 py-3 font-medium">วันที่แจ้ง</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
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
                <td className="max-w-xs truncate px-4 py-3" title={t.description}>
                  {t.description}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {t.repair_cost !== null ? `${formatBaht(t.repair_cost)} บ.` : "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <TicketStatusBadge status={t.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {formatThaiDateShort(t.created_at)}
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
