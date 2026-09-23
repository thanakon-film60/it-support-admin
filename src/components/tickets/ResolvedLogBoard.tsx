"use client";

import { useMemo, useState } from "react";
import { Pagination, usePaginated } from "@/components/ui/Pagination";
import type { TicketEvent, TicketWithRelations } from "@/lib/types";
import { TICKET_TYPE_LABEL } from "@/lib/labels";
import { TicketStatusBadge, TICKET_STATUS_LABEL, CompanyBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatThaiDateShort, formatThaiDateFull, formatBaht, toCsv } from "@/lib/utils";
import { SortMenu, SortableTh, useSort } from "@/components/ui/SortControl";
import type { SortColumn } from "@/lib/sorting";
import { COMPANY_LABEL } from "@/lib/companies";
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

export interface ResolvedLogRow {
  ticket: TicketWithRelations;
  events: TicketEvent[];
  parts: { name: string; qty: number; unit: string }[];
}

/** ระยะเวลาแบบอ่านง่าย — log การแก้ปัญหาที่ไม่บอก "ใช้เวลาเท่าไหร่" แทบไม่มีประโยชน์
 *  เพราะคำถามแรกที่หัวหน้าถามเสมอคือ "เรื่องนี้ค้างนานแค่ไหน" */
function duration(fromIso: string | null, toIso: string | null): string {
  if (!fromIso || !toIso) return "-";
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} นาที`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ชม. ${mins % 60} นาที`;
  const days = Math.floor(hours / 24);
  return `${days} วัน ${hours % 24} ชม.`;
}

function completedAt(t: TicketWithRelations): string | null {
  const v = t.meta?.completed_at;
  return typeof v === "string" ? v : null;
}

function resolutionNote(t: TicketWithRelations): string | null {
  const v = t.meta?.resolution_note;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function imageUrls(t: TicketWithRelations): string[] {
  const v = t.meta?.image_urls;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

const SORT_COLUMNS: SortColumn<ResolvedLogRow>[] = [
  { key: "completed_at", label: "วันที่ปิดเรื่อง", type: "date", get: (r) => completedAt(r.ticket) },
  { key: "created_at", label: "วันที่แจ้ง", type: "date", get: (r) => r.ticket.created_at },
  {
    key: "duration",
    label: "ระยะเวลาที่ใช้",
    type: "number",
    get: (r) => {
      const a = new Date(r.ticket.created_at).getTime();
      const b = new Date(completedAt(r.ticket) ?? r.ticket.resolved_at ?? "").getTime();
      return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
    },
    dirText: { desc: "ใช้เวลานานสุดก่อน", asc: "เร็วสุดก่อน" },
  },
  { key: "ticket_code", label: "เลขที่ตั๋ว", type: "text", get: (r) => r.ticket.ticket_code },
  { key: "requester", label: "ผู้แจ้ง", type: "text", get: (r) => r.ticket.requester?.display_name ?? null },
  { key: "location", label: "สาขา", type: "text", get: (r) => r.ticket.location },
  { key: "company", label: "บริษัท", type: "text", get: (r) => r.ticket.company_label },
  { key: "repair_cost", label: "ค่าใช้จ่าย", type: "number", get: (r) => r.ticket.repair_cost },
];

export function ResolvedLogBoard({ rows }: { rows: ResolvedLogRow[] }) {
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const dates = useDateRange();
  const [openId, setOpenId] = useState<string | null>(null);

  const companyOptions = useMemo(() => {
    const order = Object.values(COMPANY_LABEL);
    const present = new Set(rows.map((r) => r.ticket.company_label ?? "ไม่ระบุบริษัท"));
    return [
      ...order.filter((l) => present.has(l)),
      ...(present.has("ไม่ระบุบริษัท") ? ["ไม่ระบุบริษัท"] : []),
    ];
  }, [rows]);

  const branchOptions = useMemo(
    () =>
      optionsFrom(
        rows
          .filter(
            (r) =>
              companyFilter === "all" ||
              (r.ticket.company_label ?? "ไม่ระบุบริษัท") === companyFilter
          )
          .map((r) => r.ticket.location)
      ),
    [rows, companyFilter]
  );

  const typeOptions = useMemo(
    () => optionsFrom(rows.map((r) => TICKET_TYPE_LABEL[r.ticket.type])),
    [rows]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const t = r.ticket;
      if (companyFilter !== "all" && (t.company_label ?? "ไม่ระบุบริษัท") !== companyFilter)
        return false;
      if (branchFilter !== "all" && t.location !== branchFilter) return false;
      if (typeFilter !== "all" && TICKET_TYPE_LABEL[t.type] !== typeFilter) return false;
      // กรองตาม "วันที่ปิดเรื่อง" ไม่ใช่วันที่แจ้ง — หน้านี้คือสมุดบันทึกงานที่ทำเสร็จ
      // คำถามที่คนถามคือ "เดือนนี้ปิดไปกี่เรื่อง" ไม่ใช่ "เดือนนี้มีคนแจ้งมากี่เรื่อง"
      if (!inDateRange(completedAt(t) ?? t.resolved_at, dates.range)) return false;
      if (!q) return true;
      return (
        t.ticket_code.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (resolutionNote(t)?.toLowerCase().includes(q) ?? false) ||
        (t.requester?.display_name.toLowerCase().includes(q) ?? false) ||
        (t.equipment?.asset_code.toLowerCase().includes(q) ?? false)
      );
    });
  }, [rows, search, companyFilter, branchFilter, typeFilter, dates.range]);

  const sort = useSort(visible, SORT_COLUMNS, {
    defaultKey: "completed_at",
    storageKey: "resolved",
  });
  const pager = usePaginated(sort.rows, {
    storageKey: "resolved",
    resetOn: `${sort.key}:${sort.dir}`,
  });

  const activeFilters = countActive(companyFilter, branchFilter, typeFilter, dates.active);
  function clearFilters() {
    setSearch("");
    setCompanyFilter("all");
    setBranchFilter("all");
    setTypeFilter("all");
    dates.reset();
  }

  const totalCost = useMemo(
    () => visible.reduce((sum, r) => sum + (r.ticket.repair_cost ?? 0), 0),
    [visible]
  );

  function handleExportCsv() {
    const csvRows = sort.rows.map((r) => ({
      ticket_code: r.ticket.ticket_code,
      type: TICKET_TYPE_LABEL[r.ticket.type],
      requester: r.ticket.requester?.display_name ?? "-",
      company: r.ticket.company_label ?? "-",
      location: r.ticket.location,
      asset: r.ticket.equipment?.asset_code ?? "-",
      description: r.ticket.description,
      resolution: resolutionNote(r.ticket) ?? "-",
      parts: r.parts.map((p) => `${p.name} x${p.qty}${p.unit}`).join(", ") || "-",
      cost: r.ticket.repair_cost !== null ? formatBaht(r.ticket.repair_cost) : "-",
      created_at: formatThaiDateShort(r.ticket.created_at),
      completed_at: completedAt(r.ticket) ? formatThaiDateShort(completedAt(r.ticket)!) : "-",
      duration: duration(r.ticket.created_at, completedAt(r.ticket)),
    }));
    const csv = toCsv(csvRows, [
      { key: "ticket_code", header: "เลขที่ตั๋ว" },
      { key: "type", header: "ประเภท" },
      { key: "requester", header: "ผู้แจ้ง" },
      { key: "company", header: "บริษัท" },
      { key: "location", header: "สาขา" },
      { key: "asset", header: "ทรัพย์สิน" },
      { key: "description", header: "อาการที่แจ้ง" },
      { key: "resolution", header: "วิธีแก้ไข" },
      { key: "parts", header: "อะไหล่ที่เบิก" },
      { key: "cost", header: "ค่าใช้จ่าย" },
      { key: "created_at", header: "วันที่แจ้ง" },
      { key: "completed_at", header: "วันที่ปิดเรื่อง" },
      { key: "duration", header: "ระยะเวลาที่ใช้" },
    ]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resolved-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const open = rows.find((r) => r.ticket.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">รายการแก้ไขปัญหาแล้ว</h1>
          <p className="text-sm text-muted">
            เรื่องที่ทีม IT แก้ไขเสร็จและผู้แจ้งกดยืนยันแล้ว {rows.length} เรื่อง · ค่าใช้จ่ายรวม{" "}
            <span className="font-num font-semibold text-ink">{formatBaht(totalCost)} บาท</span>
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
          placeholder="ค้นหาเลขที่ตั๋ว, อาการ, วิธีแก้ไข, ผู้แจ้ง..."
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:w-72"
        />
        <SelectFilter
          value={companyFilter}
          onChange={(v) => {
            setCompanyFilter(v);
            setBranchFilter("all");
          }}
          options={companyOptions}
          allLabel="ทุกบริษัท"
        />
        <SelectFilter value={branchFilter} onChange={setBranchFilter} options={branchOptions} allLabel="ทุกสาขา" />
        <SelectFilter value={typeFilter} onChange={setTypeFilter} options={typeOptions} allLabel="ทุกประเภท" />
        <DateRangeFilter value={dates.range} onChange={dates.setRange} label="วันที่ปิดเรื่อง" />
        <ClearFiltersButton count={activeFilters} onClear={clearFilters} />
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SortMenu sort={sort} />
        {visible.length !== rows.length && (
          <p className="text-xs text-muted">
            ตัวกรองเหลือ <span className="font-num text-ink">{visible.length}</span> จาก {rows.length} เรื่อง
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <SortableTh sort={sort} columnKey="ticket_code">เลขที่ตั๋ว</SortableTh>
              <SortableTh sort={sort} columnKey="requester">ผู้แจ้ง</SortableTh>
              <SortableTh sort={sort} columnKey="company">บริษัท</SortableTh>
              <SortableTh sort={sort} columnKey="location">สาขา</SortableTh>
              <SortableTh sort={sort}>วิธีแก้ไข</SortableTh>
              <SortableTh sort={sort} columnKey="repair_cost">ค่าใช้จ่าย</SortableTh>
              <SortableTh sort={sort} columnKey="duration">ใช้เวลา</SortableTh>
              <SortableTh sort={sort} columnKey="completed_at">ปิดเรื่องเมื่อ</SortableTh>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((r) => (
              <tr
                key={r.ticket.id}
                onClick={() => setOpenId(r.ticket.id)}
                className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-accent-bg/30"
              >
                <td className="whitespace-nowrap px-4 py-3 font-num text-accent">
                  {r.ticket.ticket_code}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {r.ticket.requester?.display_name ?? "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <CompanyBadge label={r.ticket.company_label} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">{r.ticket.location}</td>
                <td className="max-w-xs truncate px-4 py-3" title={resolutionNote(r.ticket) ?? ""}>
                  {resolutionNote(r.ticket) ?? (
                    <span className="text-muted/50">ไม่ได้บันทึกวิธีแก้</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {r.ticket.repair_cost !== null ? `${formatBaht(r.ticket.repair_cost)} บ.` : "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {duration(r.ticket.created_at, completedAt(r.ticket))}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {completedAt(r.ticket) ? formatThaiDateShort(completedAt(r.ticket)!) : "-"}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  {rows.length === 0
                    ? "ยังไม่มีเรื่องที่ปิดสมบูรณ์ — เรื่องจะมาอยู่ที่นี่เมื่อผู้แจ้งกด \"ตกลง\" ในแชท LINE"
                    : "ไม่พบเรื่องที่ตรงกับเงื่อนไข"}
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

      <Pagination pager={pager} unitLabel="เรื่อง" />

      {open && <ResolvedDetailPanel row={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/* ─────────────────────────────────────────── แผงรายละเอียด = log ฉบับเต็ม */

const EVENT_ICON: Record<TicketEvent["type"], string> = {
  created: "📝",
  status: "🔄",
  confirmed: "✅",
  note: "💬",
};

const ROLE_LABEL: Record<TicketEvent["actor_role"], string> = {
  admin: "ทีม IT",
  requester: "ผู้แจ้ง",
  system: "ระบบ",
};

function ResolvedDetailPanel({ row, onClose }: { row: ResolvedLogRow; onClose: () => void }) {
  const t = row.ticket;
  const images = imageUrls(t);
  const done = completedAt(t);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-lg flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-num text-lg font-bold text-accent">{t.ticket_code}</p>
            <p className="text-sm text-muted">
              {TICKET_TYPE_LABEL[t.type]} · {t.location}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-muted hover:text-ink" aria-label="ปิด">
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TicketStatusBadge status={t.status} />
          <CompanyBadge label={t.company_label} />
        </div>

        {/* สรุป 3 ตัวเลขที่คนเปิด log มาดูก่อนเสมอ: ใช้เวลาเท่าไหร่ จ่ายไปเท่าไหร่ ปิดเมื่อไหร่ */}
        <div className="grid grid-cols-3 gap-2">
          <Stat label="ใช้เวลาทั้งหมด" value={duration(t.created_at, done)} />
          <Stat
            label="ค่าใช้จ่าย"
            value={t.repair_cost !== null ? `${formatBaht(t.repair_cost)} บ.` : "-"}
          />
          <Stat label="ปิดเรื่องเมื่อ" value={done ? formatThaiDateShort(done) : "-"} />
        </div>

        <Section title="อาการที่แจ้ง">
          <p className="text-sm text-ink">{t.description || "-"}</p>
        </Section>

        <Section title="วิธีแก้ไข / หมายเหตุของช่าง">
          {resolutionNote(t) ? (
            <p className="whitespace-pre-wrap text-sm text-ink">{resolutionNote(t)}</p>
          ) : (
            <p className="text-sm text-muted/60">
              ไม่ได้บันทึกไว้ — ครั้งหน้ากรอกช่อง &quot;วิธีแก้ไข&quot; ตอนเปลี่ยนสถานะเป็น
              &quot;แก้ไขแล้ว&quot; ในหน้า Tickets
            </p>
          )}
        </Section>

        {row.parts.length > 0 && (
          <Section title={`อะไหล่ที่เบิกไปใช้ (${row.parts.length} รายการ)`}>
            <ul className="flex flex-col gap-1 text-sm text-ink">
              {row.parts.map((p, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{p.name}</span>
                  <span className="font-num text-muted">
                    {p.qty} {p.unit}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {images.length > 0 && (
          <Section title={`รูปที่ผู้แจ้งส่งมา (${images.length})`}>
            <div className="grid grid-cols-2 gap-2">
              {images.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-lg border border-line transition hover:border-accent"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="รูปที่ผู้แจ้งส่งมา" className="h-28 w-full object-cover" />
                </a>
              ))}
            </div>
          </Section>
        )}

        <Section title={`ไทม์ไลน์ (${row.events.length} ขั้น)`}>
          {row.events.length === 0 ? (
            <p className="text-sm text-muted/60">
              ไม่มีไทม์ไลน์ — เรื่องนี้เกิดก่อนระบบเริ่มบันทึก
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {row.events.map((e, i) => (
                <li key={e.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="text-sm leading-none">{EVENT_ICON[e.type]}</span>
                    {i < row.events.length - 1 && (
                      <span className="mt-1 w-px flex-1 bg-line" aria-hidden />
                    )}
                  </div>
                  <div className="flex-1 pb-1">
                    <p className="text-sm text-ink">
                      {e.to_status ? TICKET_STATUS_LABEL[e.to_status] : "บันทึกเพิ่มเติม"}
                      {e.from_status && e.from_status !== e.to_status && (
                        <span className="text-muted">
                          {" "}
                          (จาก {TICKET_STATUS_LABEL[e.from_status]})
                        </span>
                      )}
                    </p>
                    <p className="font-num text-xs text-muted">
                      {formatThaiDateFull(e.created_at)} · {e.actor} ({ROLE_LABEL[e.actor_role]})
                    </p>
                    {e.note && (
                      <p className="mt-1 whitespace-pre-wrap rounded-lg bg-page/50 px-2.5 py-1.5 text-xs text-ink">
                        {e.note}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-page/40 px-3 py-2">
      <p className="text-[10px] text-muted">{label}</p>
      <p className="font-num text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <p className="text-xs font-semibold text-muted">{title}</p>
      {children}
    </div>
  );
}
