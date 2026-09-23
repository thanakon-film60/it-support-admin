"use client";

import { useMemo, useState } from "react";
import { useServerRows } from "@/lib/use-server-rows";
import { Pagination, usePaginated } from "@/components/ui/Pagination";
import { useRouter } from "next/navigation";
import type { TicketStatus, TicketType, TicketView, TicketWithRelations } from "@/lib/types";
import type { TicketViewSummary } from "@/lib/db/ticketViews";
import { TICKET_TYPE_LABEL } from "@/lib/labels";
import {
  TicketStatusBadge,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_ORDER,
  CompanyBadge,
} from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatThaiDateShort, formatThaiDateFull, formatBaht, toCsv } from "@/lib/utils";
import { TicketStatusModal } from "./TicketStatusModal";
import { SortMenu, SortableTh, useSort } from "@/components/ui/SortControl";
import { COMPANY_LABEL } from "@/lib/companies";
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

const TYPE_OPTIONS: { value: "all" | TicketType; label: string }[] = [
  { value: "all", label: "ทุกประเภท" },
  { value: "repair", label: TICKET_TYPE_LABEL.repair },
  { value: "withdraw", label: TICKET_TYPE_LABEL.withdraw },
  { value: "return", label: TICKET_TYPE_LABEL.return },
  { value: "it_service", label: TICKET_TYPE_LABEL.it_service },
];

/** คอลัมน์ที่เรียงได้ — key ถูกจำไว้ใน localStorage ห้ามเปลี่ยนชื่อโดยไม่จำเป็น
 *  สถานะเรียงตาม "ลำดับขั้นการทำงาน" ไม่ใช่ตามตัวอักษร เพราะ "ยกเลิก" ควรอยู่ท้ายสุด
 *  ไม่ใช่อยู่ต้นๆ เพราะขึ้นต้นด้วย ย */
function viewCount(
  summaries: Record<string, TicketViewSummary>,
  ticketId: string
): number {
  return summaries[ticketId]?.count ?? 0;
}

function buildSortColumns(
  summaries: Record<string, TicketViewSummary>
): SortColumn<TicketWithRelations>[] {
  return [
  { key: "created_at", label: "วันที่แจ้ง", type: "date", get: (t) => t.created_at },
  { key: "ticket_code", label: "เลขที่ตั๋ว", type: "text", get: (t) => t.ticket_code },
  { key: "type", label: "ประเภท", type: "text", get: (t) => TICKET_TYPE_LABEL[t.type] },
  { key: "requester", label: "ผู้แจ้ง", type: "text", get: (t) => t.requester?.display_name ?? null },
  { key: "equipment", label: "ทรัพย์สิน", type: "text", get: (t) => t.equipment?.asset_code ?? null },
  { key: "location", label: "สาขา", type: "text", get: (t) => t.location },
  { key: "company", label: "บริษัท", type: "text", get: (t) => t.company_label },
  {
    key: "status",
    label: "สถานะ",
    type: "number",
    firstClick: "asc",
    get: (t) => TICKET_STATUS_ORDER.indexOf(t.status),
    dirText: { asc: "รอดำเนินการ → ยกเลิก", desc: "ยกเลิก → รอดำเนินการ" },
  },
    {
      key: "views",
      label: "ผู้แจ้งเปิดดู",
      type: "number",
      get: (t) => viewCount(summaries, t.id),
      dirText: { desc: "ดูบ่อยที่สุดก่อน", asc: "ยังไม่ได้ดูขึ้นก่อน" },
    },
  ];
}

/** เรื่องที่ผู้แจ้งยืนยันแล้วถือว่าจบ — ย้ายไปอยู่หน้า "แก้ไขปัญหาแล้ว" ทั้งหมด
 *  หน้านี้จึงเหลือเฉพาะงานที่ยังต้องทำอะไรต่อ ซึ่งเป็นสิ่งที่ทีม IT เปิดมาดูจริงๆ */
const DONE_STATUS: TicketStatus = "completed";

export function TicketsBoard({
  initialTickets,
  viewSummaries = {},
  recentViews = {},
  initialStatus = "all", initialTicketCode = "", editors = [], notifiable = {},
}: {
  initialTickets: TicketWithRelations[];
  initialStatus?: "all" | TicketStatus;
  initialTicketCode?: string;
  editors?: string[];
  notifiable?: Record<string, boolean>;
  /** สรุปจำนวนครั้งที่แต่ละ ticket ถูกเปิดดู (คำนวณฝั่งเซิร์ฟเวอร์ครั้งเดียว) */
  viewSummaries?: Record<string, TicketViewSummary>;
  /** log 10 ครั้งล่าสุดต่อ ticket — ใช้แสดงในแผงรายละเอียดเท่านั้น */
  recentViews?: Record<string, TicketView[]>;
}) {
  const router = useRouter();
  const [allTickets, setTickets] = useServerRows(initialTickets);
  const tickets = useMemo(() => allTickets.filter(t => t.status !== DONE_STATUS), [allTickets]);
  const [search, setSearch] = useState(initialTicketCode);
  const [typeFilter, setTypeFilter] = useState<"all" | TicketType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>(initialStatus);
  const [companyFilter, setCompanyFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [requesterFilter, setRequesterFilter] = useState("all");
  const dates = useDateRange();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TicketWithRelations | null>(null);

  // ตัวเลือกใน dropdown สร้างจากข้อมูลจริงที่อยู่ในตาราง ไม่ได้ hardcode
  // เพิ่มสาขาใหม่ในระบบแล้วสาขานั้นจะโผล่ในตัวกรองเองรอบหน้า
  // เรียงตามลำดับในทะเบียน (Montipa → Motta → ส่วนกลาง) ไม่ใช่ ก-ฮ
  // เพราะเป็นลำดับที่คนในองค์กรพูดถึงกันจริง
  const companyOptions = useMemo(() => {
    const order = Object.values(COMPANY_LABEL);
    const present = new Set(tickets.map((t) => t.company_label ?? "ไม่ระบุบริษัท"));
    return [...order.filter((l) => present.has(l)), ...(present.has("ไม่ระบุบริษัท") ? ["ไม่ระบุบริษัท"] : [])];
  }, [tickets]);

  // เลือกบริษัทแล้ว dropdown สาขาต้องเหลือเฉพาะสาขาของบริษัทนั้น
  // ไม่งั้นจะเจอสาขาชื่อเดียวกันสองอันแล้วไม่รู้ว่าอันไหนของใคร
  const branchOptions = useMemo(
    () =>
      optionsFrom(
        tickets
          .filter((t) => companyFilter === "all" || (t.company_label ?? "ไม่ระบุบริษัท") === companyFilter)
          .map((t) => t.location)
      ),
    [tickets, companyFilter]
  );
  const requesterOptions = useMemo(
    () => optionsFrom(tickets.map((t) => t.requester?.display_name)),
    [tickets]
  );

  const typedAndSearched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      if (companyFilter !== "all" && (t.company_label ?? "ไม่ระบุบริษัท") !== companyFilter)
        return false;
      // กรองสาขาต้องอยู่หลังกรองบริษัท เพราะมีสาขาชื่อซ้ำกันข้ามบริษัท
      if (branchFilter !== "all" && t.location !== branchFilter) return false;
      if (requesterFilter !== "all" && t.requester?.display_name !== requesterFilter) return false;
      if (!inDateRange(t.created_at, dates.range)) return false;
      if (!q) return true;
      return (
        t.ticket_code.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.requester?.display_name.toLowerCase().includes(q) ?? false) ||
        (t.equipment?.asset_code.toLowerCase().includes(q) ?? false)
      );
    });
  }, [tickets, search, typeFilter, companyFilter, branchFilter, requesterFilter, dates.range]);

  const statusCounts = useMemo(() => {
    const counts: Record<TicketStatus | "all", number> = {
      all: typedAndSearched.length,
      pending: 0,
      in_progress: 0,
      waiting_info: 0,
      waiting_delivery: 0,
      resolved: 0,
      completed: 0,
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

  // ลำดับการทำงาน: กรอง -> เรียง -> ตัดหน้า
  // สลับลำดับไม่ได้ ถ้าตัดหน้าก่อนเรียง จะได้ "เรียงเฉพาะแถวในหน้านี้" ซึ่งดูเหมือนทำงาน
  // แต่ผิดสนิท (หน้า 1 เรียงกันเอง หน้า 2 เรียงกันเอง)
  const sortColumns = useMemo(() => buildSortColumns(viewSummaries), [viewSummaries]);
  const sort = useSort(visible, sortColumns, {
    defaultKey: "created_at", // ค่าตั้งต้น = วันที่แจ้งล่าสุดก่อน ตามที่ใช้งานจริงบ่อยสุด
    storageKey: "tickets",
  });
  const pager = usePaginated(sort.rows, { storageKey: "tickets", resetOn: `${sort.key}:${sort.dir}` });

  const activeFilters = countActive(companyFilter, branchFilter, requesterFilter, dates.active, typeFilter);
  function clearFilters() {
    setSearch("");
    setTypeFilter("all");
    setCompanyFilter("all");
    setBranchFilter("all");
    setRequesterFilter("all");
    dates.reset();
  }

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  function handleExportCsv() {
    // ใช้ sort.rows ไม่ใช่ visible — ไฟล์ที่ได้จะเรียงเหมือนที่เห็นบนหน้าจอเป๊ะ
    const csvRows = sort.rows.map((t) => ({
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


  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Tickets</h1>
        <p className="text-sm text-muted">
          รายการแจ้งซ่อม เบิกอุปกรณ์ คืนอุปกรณ์ และบริการ IT ทั้งหมด
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <FilterBar>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาเลขที่ตั๋ว, รายละเอียด, ผู้แจ้ง, รหัสทรัพย์สิน..."
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:w-64"
          />
          <select
            aria-label="ประเภทเรื่อง"
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
          <SelectFilter
            value={companyFilter}
            onChange={(v) => {
              setCompanyFilter(v);
              // เปลี่ยนบริษัทแล้วสาขาที่เลือกไว้อาจไม่อยู่ในบริษัทใหม่ — รีเซ็ตไปก่อน
              setBranchFilter("all");
            }}
            options={companyOptions}
            allLabel="ทุกบริษัท"
          />
          <SelectFilter
            value={branchFilter}
            onChange={setBranchFilter}
            options={branchOptions}
            allLabel="ทุกสาขา"
          />
          <SelectFilter
            value={requesterFilter}
            onChange={setRequesterFilter}
            options={requesterOptions}
            allLabel="ผู้แจ้งทุกคน"
          />
          <DateRangeFilter value={dates.range} onChange={dates.setRange} />
          <ClearFiltersButton count={activeFilters} onClear={clearFilters} />
        </FilterBar>
        <Button variant="ghost" onClick={handleExportCsv}>
          ⬇ Export CSV ({visible.length})
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SortMenu sort={sort} />
        {visible.length !== tickets.length && (
          <p className="text-xs text-muted">
            ตัวกรองเหลือ <span className="font-num text-ink">{visible.length}</span> จาก {tickets.length} เรื่อง
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line pb-3">
        <StatusTab
          label={`ทั้งหมด (${statusCounts.all})`}
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        />
        {/* ตัด "ดำเนินการเสร็จสิ้น" ออกจากแท็บ — เรื่องพวกนั้นย้ายไปหน้า log แล้ว
            ถ้าปล่อยไว้จะเป็นแท็บที่ขึ้น (0) ตลอดกาล ซึ่งทำให้คนคิดว่าระบบนับผิด */}
        {TICKET_STATUS_ORDER.filter((s) => s !== DONE_STATUS).map((s) => (
          <StatusTab
            key={s}
            label={`${TICKET_STATUS_LABEL[s]} (${statusCounts[s]})`}
            active={statusFilter === s}
            onClick={() => setStatusFilter(s)}
          />
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[930px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <SortableTh sort={sort} columnKey="ticket_code">เลขที่ตั๋ว</SortableTh>
              <SortableTh sort={sort} columnKey="type">ประเภท</SortableTh>
              <SortableTh sort={sort} columnKey="requester">ผู้แจ้ง</SortableTh>
              <SortableTh sort={sort} columnKey="equipment">ทรัพย์สิน</SortableTh>
              <SortableTh sort={sort} columnKey="location">สาขา</SortableTh>
              <SortableTh sort={sort} columnKey="company">บริษัท</SortableTh>
              <SortableTh sort={sort} columnKey="status">สถานะ</SortableTh>
              <SortableTh sort={sort} columnKey="views">ผู้แจ้งดู</SortableTh>
              <SortableTh sort={sort} columnKey="created_at">วันที่แจ้ง</SortableTh>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((t) => (
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
                  <CompanyBadge label={t.company_label} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <TicketStatusBadge status={t.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <ViewedCell summary={viewSummaries[t.id]} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {formatThaiDateShort(t.created_at)}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted">
                  ไม่พบ Ticket ที่ตรงกับเงื่อนไข
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

      <TicketStatusModal ticket={editing} editors={editors} canNotify={editing ? notifiable[editing.id] : false}
        onClose={() => setEditing(null)} onSaved={(saved) => {
          setTickets(prev => prev.map(t => t.id === saved.id ? { ...t, ...saved } : t).filter(t => t.status !== DONE_STATUS));
          setEditing(null); router.refresh();
        }} />
      {selected && (
        <TicketDetailPanel
          ticket={selected}
          views={recentViews[selected.id] ?? []}
          totalViews={viewSummaries[selected.id]?.count ?? 0}
          onClose={() => setSelectedId(null)}
          onStatusChange={() => setEditing(selected)}
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
  views,
  totalViews,
  onClose,
  onStatusChange,
}: {
  ticket: TicketWithRelations;
  views: TicketView[];
  totalViews: number;
  onClose: () => void;
  onStatusChange: () => void;
}) {
  // ช่อง "วิธีแก้ไข" — เนื้อหาหลักของ log การแก้ปัญหา
  // ถ้าไม่บังคับให้กรอกตรงจังหวะที่กดเปลี่ยนสถานะ จะไม่มีใครย้อนกลับมากรอกทีหลังเลย
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

        <Button onClick={onStatusChange}>แก้ไขสถานะ / หมายเหตุ</Button>

        <ViewLog views={views} total={totalViews} acknowledgedAt={ticket.meta?.acknowledged_at} />

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

        <TicketImages ticket={ticket} />
      </div>
    </div>
  );
}

/** รูปที่ผู้ใช้ส่งมาในแชท LINE ตอนแจ้งเรื่อง (บอทอัปโหลดไว้ที่ /uploads/tickets/)
 *
 *  ใช้ <img> ธรรมดาแทน next/image โดยตั้งใจ — ไฟล์เหล่านี้ถูกเขียนลง volume ตอน runtime
 *  ไม่ได้อยู่ตอน build ซึ่ง next/image จะพยายาม optimize แล้วพังถ้าไฟล์ยังไม่มี
 *  เปิดรูปเต็มในแท็บใหม่ได้เพราะช่างต้องซูมดูข้อความ error บนหน้าจอที่ถ่ายมา */
function TicketImages({ ticket }: { ticket: TicketWithRelations }) {
  const raw = ticket.meta?.image_urls;
  const urls = Array.isArray(raw) ? raw.filter((u): u is string => typeof u === "string") : [];
  if (urls.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <p className="text-xs text-muted">รูปที่แนบมา ({urls.length})</p>
      <div className="grid grid-cols-2 gap-2">
        {urls.map((url) => (
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


/* ─────────────────────────────────────────── ผู้แจ้งเปิดดูสถานะหรือยัง */

const SOURCE_LABEL: Record<TicketView["source"], string> = {
  "line-bot": "กดปุ่มในแชท LINE",
  "admin-panel": "เปิดจากหน้าแอดมิน",
  liff: "เปิดหน้าเว็บ",
};

/** เซลล์เล็กๆ ในตาราง — ตอบคำถามเดียวว่า "ผู้แจ้งเห็นแล้วหรือยัง"
 *  ใช้สีบอกทันทีโดยไม่ต้องอ่านตัวเลข: เขียว = เห็นแล้ว, จางๆ = ยังเงียบอยู่ */
function ViewedCell({ summary }: { summary?: TicketViewSummary }) {
  if (!summary || summary.count === 0) {
    return <span className="text-xs text-muted/50">ยังไม่ได้ดู</span>;
  }
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-emerald-300"
      title={`ล่าสุด ${formatThaiDateFull(summary.last_at)} โดย ${summary.last_viewer}`}
    >
      👁 <span className="font-num">{summary.count}</span> ครั้ง
    </span>
  );
}

/** ประวัติการเปิดดูแบบเต็มในแผงรายละเอียด */
function ViewLog({
  views,
  total,
  acknowledgedAt,
}: {
  views: TicketView[];
  total: number;
  acknowledgedAt?: unknown;
}) {
  const ackAt = typeof acknowledgedAt === "string" ? acknowledgedAt : null;

  if (total === 0) {
    return (
      <div className="rounded-xl border border-line bg-page/40 p-3">
        <p className="text-xs text-muted">
          👁 ผู้แจ้งยังไม่ได้เปิดดูสถานะเรื่องนี้เลย
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-emerald-300">
          👁 เปิดดูสถานะแล้ว <span className="font-num">{total}</span> ครั้ง
        </p>
        {views.length < total && (
          <span className="text-[10px] text-muted">แสดง {views.length} ครั้งล่าสุด</span>
        )}
      </div>

      {ackAt && (
        <p className="text-xs text-muted">
          ผู้แจ้งรับทราบครั้งแรกเมื่อ{" "}
          <span className="font-num text-ink">{formatThaiDateFull(ackAt)}</span>
        </p>
      )}

      <ul className="flex flex-col gap-1.5 border-t border-emerald-400/15 pt-2">
        {views.map((v) => (
          <li key={v.id} className="flex flex-col gap-0.5 text-xs">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-num text-ink">{formatThaiDateFull(v.created_at)}</span>
              <span className="text-muted">·</span>
              <span className="text-ink">{v.viewer_name}</span>
              <span className="text-muted">({SOURCE_LABEL[v.source]})</span>
            </div>
            {v.ip && (
              // ⚠️ ต้องเขียนกำกับไว้เสมอว่า IP นี้เป็นของใคร
              // สำหรับปุ่มในแชท LINE มันคือ IP ของเซิร์ฟเวอร์ LINE ไม่ใช่มือถือพนักงาน
              // ถ้าโชว์ตัวเลขเปล่าๆ จะถูกเอาไปใช้ผิดแน่นอน (เช่นอ้างว่าใครอยู่ที่ไหน)
              <span className="font-num text-[10px] text-muted" title={v.ip_note ?? undefined}>
                IP {v.ip}
                {v.ip_note ? ` — ${v.ip_note}` : ""}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
