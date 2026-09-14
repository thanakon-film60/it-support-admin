"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TicketStatus, TicketType, TicketWithRelations } from "@/lib/types";
import { TICKET_TYPE_LABEL } from "@/lib/labels";
import {
  TicketStatusBadge,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_ORDER,
} from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatThaiDateShort, formatBaht, toCsv } from "@/lib/utils";
import { changeTicketStatusAction } from "@/app/actions/tickets";

const TYPE_OPTIONS: { value: "all" | TicketType; label: string }[] = [
  { value: "all", label: "ทุกประเภท" },
  { value: "repair", label: TICKET_TYPE_LABEL.repair },
  { value: "withdraw", label: TICKET_TYPE_LABEL.withdraw },
  { value: "return", label: TICKET_TYPE_LABEL.return },
  { value: "it_service", label: TICKET_TYPE_LABEL.it_service },
];

export function TicketsBoard({
  initialTickets,
}: {
  initialTickets: TicketWithRelations[];
}) {
  const router = useRouter();
  const [tickets, setTickets] = useState(initialTickets);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | TicketType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const typedAndSearched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      if (!q) return true;
      return (
        t.ticket_code.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.requester?.display_name.toLowerCase().includes(q) ?? false) ||
        (t.equipment?.asset_code.toLowerCase().includes(q) ?? false)
      );
    });
  }, [tickets, search, typeFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<TicketStatus | "all", number> = {
      all: typedAndSearched.length,
      pending: 0,
      in_progress: 0,
      waiting_info: 0,
      waiting_delivery: 0,
      resolved: 0,
      closed: 0,
      cancelled: 0,
    };
    typedAndSearched.forEach((t) => {
      counts[t.status] += 1;
    });
    return counts;
  }, [typedAndSearched]);

  const visible = useMemo(
    () =>
      statusFilter === "all"
        ? typedAndSearched
        : typedAndSearched.filter((t) => t.status === statusFilter),
    [typedAndSearched, statusFilter]
  );

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  function handleExportCsv() {
    const csvRows = visible.map((t) => ({
      ticket_code: t.ticket_code,
      type: TICKET_TYPE_LABEL[t.type],
      status: TICKET_STATUS_LABEL[t.status],
      requester: t.requester?.display_name ?? "-",
      location: t.location,
      description: t.description,
      created_at: formatThaiDateShort(t.created_at),
    }));
    const csv = toCsv(csvRows, [
      { key: "ticket_code", header: "เลขที่ตั๋ว" },
      { key: "type", header: "ประเภท" },
      { key: "status", header: "สถานะ" },
      { key: "requester", header: "ผู้แจ้ง" },
      { key: "location", header: "สาขา" },
      { key: "description", header: "รายละเอียด" },
      { key: "created_at", header: "วันที่แจ้ง" },
    ]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleStatusChange(ticketId: string, status: TicketStatus) {
    startTransition(async () => {
      await changeTicketStatusAction(ticketId, status);
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticketId
            ? {
                ...t,
                status,
                resolved_at:
                  status === "resolved" || status === "closed"
                    ? new Date().toISOString()
                    : null,
              }
            : t
        )
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Tickets</h1>
        <p className="text-sm text-muted">
          รายการแจ้งซ่อม เบิกอุปกรณ์ คืนอุปกรณ์ และบริการ IT ทั้งหมด
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาเลขที่ตั๋ว, รายละเอียด, ผู้แจ้ง, รหัสทรัพย์สิน..."
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:max-w-xs"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "all" | TicketType)}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <Button variant="ghost" onClick={handleExportCsv}>
          ⬇ Export CSV ({visible.length})
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line pb-3">
        <StatusTab
          label={`ทั้งหมด (${statusCounts.all})`}
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        />
        {TICKET_STATUS_ORDER.map((s) => (
          <StatusTab
            key={s}
            label={`${TICKET_STATUS_LABEL[s]} (${statusCounts[s]})`}
            active={statusFilter === s}
            onClick={() => setStatusFilter(s)}
          />
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-4 py-3 font-medium">เลขที่ตั๋ว</th>
              <th className="px-4 py-3 font-medium">ประเภท</th>
              <th className="px-4 py-3 font-medium">ผู้แจ้ง</th>
              <th className="px-4 py-3 font-medium">ทรัพย์สิน</th>
              <th className="px-4 py-3 font-medium">สาขา</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
              <th className="px-4 py-3 font-medium">วันที่แจ้ง</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-accent-bg/30"
              >
                <td className="whitespace-nowrap px-4 py-3 font-num text-accent">
                  {t.ticket_code}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{TICKET_TYPE_LABEL[t.type]}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {t.requester?.display_name ?? "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {t.equipment?.asset_code ?? "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{t.location}</td>
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
                  ไม่พบ Ticket ที่ตรงกับเงื่อนไข
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <TicketDetailPanel
          ticket={selected}
          isPending={isPending}
          onClose={() => setSelectedId(null)}
          onStatusChange={(status) => handleStatusChange(selected.id, status)}
        />
      )}
    </div>
  );
}

function StatusTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
        active ? "bg-accent text-slate-900" : "bg-accent-bg text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function TicketDetailPanel({
  ticket,
  isPending,
  onClose,
  onStatusChange,
}: {
  ticket: TicketWithRelations;
  isPending: boolean;
  onClose: () => void;
  onStatusChange: (status: TicketStatus) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-num text-lg font-bold text-accent">{ticket.ticket_code}</p>
            <p className="text-sm text-muted">{TICKET_TYPE_LABEL[ticket.type]}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-muted hover:text-ink"
            aria-label="ปิด"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted">สถานะปัจจุบัน</p>
          <TicketStatusBadge status={ticket.status} />
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted">เปลี่ยนสถานะ</p>
          <div className="flex flex-wrap gap-1.5">
            {TICKET_STATUS_ORDER.map((s) => (
              <button
                key={s}
                disabled={isPending || s === ticket.status}
                onClick={() => onStatusChange(s)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  s === ticket.status
                    ? "border-accent bg-accent-bg text-accent"
                    : "border-line text-muted hover:border-accent hover:text-accent"
                }`}
              >
                {TICKET_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <dl className="flex flex-col gap-3 border-t border-line pt-4 text-sm">
          <Row label="ผู้แจ้ง" value={ticket.requester?.display_name ?? "-"} />
          <Row label="แผนก" value={ticket.requester?.department ?? "-"} />
          <Row label="สาขา" value={ticket.location} />
          <Row
            label="ทรัพย์สินที่เกี่ยวข้อง"
            value={
              ticket.equipment
                ? `${ticket.equipment.asset_code} — ${ticket.equipment.brand_model ?? ""}`
                : "-"
            }
          />
          {ticket.type === "repair" && (
            <Row
              label="ค่าซ่อม"
              value={ticket.repair_cost !== null ? `${formatBaht(ticket.repair_cost)} บาท` : "-"}
            />
          )}
          <Row label="วันที่แจ้ง" value={formatThaiDateShort(ticket.created_at)} />
          <Row
            label="วันที่ปิดงาน"
            value={ticket.resolved_at ? formatThaiDateShort(ticket.resolved_at) : "-"}
          />
        </dl>

        <div className="flex flex-col gap-1.5 border-t border-line pt-4">
          <p className="text-xs text-muted">รายละเอียด</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{ticket.description}</p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}
