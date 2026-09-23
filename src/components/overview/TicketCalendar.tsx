"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { TICKET_TYPE_LABEL } from "@/lib/labels";
import { companyLabel } from "@/lib/companies";
import { TicketStatusBadge } from "@/components/ui/Badge";
import type { TicketStatus, TicketType } from "@/lib/types";
import {
  THAI_WEEKDAYS_SHORT,
  daysBetween,
  daysInMonth,
  firstWeekdayOfMonth,
  makeDayKey,
  monthKeyOf,
  partsOfKey,
  shiftMonth,
  thaiDayLabel,
  thaiMonthLabel,
} from "@/lib/date-th";

/** ข้อมูล ticket เท่าที่ปฏิทินใช้ — คำนวณ dayKey/time มาจากฝั่งเซิร์ฟเวอร์ด้วยเวลาไทยแล้ว
 *  ฝั่งนี้จึงเทียบสตริงล้วนๆ ไม่ต้องแตะ Date อีก (กัน hydration mismatch — ดู lib/date-th.ts) */
export interface CalendarTicket {
  id: string;
  ticket_code: string;
  type: TicketType;
  status: TicketStatus;
  company: string | null;
  location: string;
  requester_name: string | null;
  description: string;
  /** "2026-09-17" ตามเวลาไทย */
  day_key: string;
  /** "15:15" ตามเวลาไทย */
  time: string;
  /** ยังไม่จบเรื่อง (ไม่ใช่ resolved / closed / cancelled) */
  open: boolean;
}

type Mode = "day" | "open";

export function TicketCalendar({
  tickets,
  todayKey,
}: {
  tickets: CalendarTicket[];
  /** "วันนี้" ตามเวลาไทย คำนวณจากฝั่งเซิร์ฟเวอร์ ส่งลงมาเป็นสตริง */
  todayKey: string;
}) {
  const [monthKey, setMonthKey] = useState(() => monthKeyOf(todayKey));
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [mode, setMode] = useState<Mode>("day");

  // จัดกลุ่มตามวันครั้งเดียว แล้วใช้ต่อทั้งตารางปฏิทินและรายการด้านข้าง
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarTicket[]>();
    for (const t of tickets) {
      const bucket = map.get(t.day_key);
      if (bucket) bucket.push(t);
      else map.set(t.day_key, [t]);
    }
    // ในแต่ละวันเรียงเวลาใหม่→เก่า ให้ตรงกับที่หน้า Tickets ใช้
    for (const list of map.values()) list.sort((a, b) => b.time.localeCompare(a.time));
    return map;
  }, [tickets]);

  const openTickets = useMemo(
    // ค้างนานสุดอยู่บนสุด — คำถามแรกของทีม IT คือ "เรื่องไหนดองไว้นานแล้ว" ไม่ใช่ "เรื่องไหนใหม่สุด"
    () =>
      tickets
        .filter((t) => t.open)
        .sort((a, b) => a.day_key.localeCompare(b.day_key) || a.time.localeCompare(b.time)),
    [tickets]
  );

  const todayTickets = byDay.get(todayKey) ?? [];
  const listed = mode === "open" ? openTickets : byDay.get(selectedDay) ?? [];

  const cells = useMemo(() => {
    const lead = firstWeekdayOfMonth(monthKey);
    const total = daysInMonth(monthKey);
    const { year, month } = partsOfKey(`${monthKey}-01`);
    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= total; d += 1) out.push(makeDayKey(year, month, d));
    return out;
  }, [monthKey]);

  function pickDay(key: string) {
    setSelectedDay(key);
    setMode("day");
  }

  function goToday() {
    setMonthKey(monthKeyOf(todayKey));
    pickDay(todayKey);
  }

  return (
    <section className="glass rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-ink">ปฏิทินงาน</h2>
          <p className="text-xs text-muted">
            วันนี้มี <span className="font-num font-semibold text-accent">{todayTickets.length}</span> เรื่องใหม่
            · ค้างอยู่ <span className="font-num font-semibold text-amber-300">{openTickets.length}</span> เรื่อง
          </p>
        </div>
        <button
          type="button"
          onClick={goToday}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-cyan-400/40 hover:text-accent"
        >
          วันนี้
        </button>
      </div>

      {/* มือถือ = เรียงลงมา · แท็บเล็ตขึ้นไป = ปฏิทินซ้าย รายการขวา
          แยกเป็น 2 คอลัมน์ตั้งแต่ md (768px) ไม่ใช่ lg เพราะที่ 768 ปฏิทินคอลัมน์เดียว
          จะกว้างจนช่องวันลอยห่างกันเป็นตารางโล่งๆ ขณะที่รายการถูกดันลงไปใต้จอ
          แบ่ง 1.05fr/1fr แทน 1/1 เพราะช่องวันต้องกว้างพอให้ตัวเลขกับแถบจำนวนอยู่คนละบรรทัดได้ */}
      <div className="mt-4 grid gap-4 md:grid-cols-[1.05fr_1fr]">
        {/* ---------------- ตารางปฏิทิน ---------------- */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setMonthKey(shiftMonth(monthKey, -1))}
              aria-label="เดือนก่อนหน้า"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted transition hover:border-cyan-400/40 hover:text-accent"
            >
              ‹
            </button>
            <p className="text-sm font-semibold text-ink">{thaiMonthLabel(monthKey)}</p>
            <button
              type="button"
              onClick={() => setMonthKey(shiftMonth(monthKey, 1))}
              aria-label="เดือนถัดไป"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted transition hover:border-cyan-400/40 hover:text-accent"
            >
              ›
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[0.65rem] text-muted">
            {THAI_WEEKDAYS_SHORT.map((w) => (
              <span key={w} className="py-1">
                {w}
              </span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((key, index) => {
              if (!key) return <span key={`pad-${index}`} className="h-11 sm:h-12 lg:h-14" />;

              const dayTickets = byDay.get(key) ?? [];
              const openCount = dayTickets.filter((t) => t.open).length;
              const isToday = key === todayKey;
              const isSelected = key === selectedDay && mode === "day";
              const { day } = partsOfKey(key);

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pickDay(key)}
                  aria-pressed={isSelected}
                  // บอก screen reader ว่าช่องไหนคือวันนี้ — สีขอบอย่างเดียวสื่อได้เฉพาะคนที่มองเห็น
                  aria-current={isToday ? "date" : undefined}
                  aria-label={`${thaiDayLabel(key)} — ${dayTickets.length} เรื่อง${
                    openCount > 0 ? ` (ค้าง ${openCount})` : ""
                  }`}
                  className={`flex h-11 flex-col items-center justify-center gap-0.5 rounded-lg border text-xs transition sm:h-12 lg:h-14 ${
                    isSelected
                      ? "border-cyan-400/50 bg-accent-bg text-accent"
                      : isToday
                        ? "border-cyan-400/30 text-ink"
                        : "border-transparent text-muted hover:border-line hover:bg-white/[0.04]"
                  }`}
                >
                  <span className={`font-num ${isToday ? "font-bold text-accent" : ""}`}>
                    {day}
                  </span>
                  {dayTickets.length > 0 ? (
                    // สีบอกว่า "ยังมีงานค้างของวันนั้นไหม" ไม่ได้บอกแค่ว่ามีงานเข้ากี่เรื่อง
                    // เพราะวันที่ปิดงานหมดแล้วไม่ต้องการความสนใจจากทีม IT อีก
                    <span
                      className={`rounded-full px-1.5 text-[0.6rem] font-semibold leading-4 ${
                        openCount > 0
                          ? "bg-amber-400/15 text-amber-300"
                          : "bg-emerald-400/10 text-emerald-300/80"
                      }`}
                    >
                      {dayTickets.length}
                    </span>
                  ) : (
                    <span className="h-4" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.65rem] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-300" aria-hidden /> ยังมีเรื่องค้าง
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-300/80" aria-hidden /> ปิดงานครบแล้ว
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full ring-1 ring-cyan-400/60" aria-hidden /> วันนี้
            </span>
          </div>
        </div>

        {/* ---------------- รายการ ---------------- */}
        <div className="flex min-w-0 flex-col">
          <div className="flex gap-1.5">
            <Tab active={mode === "day"} onClick={() => setMode("day")}>
              {selectedDay === todayKey ? "วันนี้" : thaiDayLabel(selectedDay)} (
              {(byDay.get(selectedDay) ?? []).length})
            </Tab>
            <Tab active={mode === "open"} onClick={() => setMode("open")}>
              ค้างอยู่ ({openTickets.length})
            </Tab>
          </div>

          {/* จำกัดความสูงเฉพาะจอที่แบ่ง 2 คอลัมน์ — บนมือถือปล่อยให้ยาวไปตามเนื้อหา
              เพราะกล่องที่เลื่อนได้ซ้อนในหน้าที่เลื่อนได้ เป็นฝันร้ายบนจอสัมผัส */}
          <div className="mt-3 flex flex-col gap-2 md:max-h-[22rem] md:overflow-y-auto md:pr-1">
            {listed.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-sm text-muted">
                {mode === "open"
                  ? "ไม่มีเรื่องค้าง ปิดงานครบทุกเรื่องแล้ว 🎉"
                  : `ไม่มีเรื่องแจ้งเข้ามาวันที่ ${thaiDayLabel(selectedDay)}`}
              </p>
            ) : (
              listed.map((t) => (
                <TicketRow key={t.id} ticket={t} todayKey={todayKey} showDate={mode === "open"} />
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "bg-accent-bg text-accent ring-1 ring-inset ring-cyan-400/30"
          : "border border-line text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function TicketRow({
  ticket,
  todayKey,
  showDate,
}: {
  ticket: CalendarTicket;
  todayKey: string;
  showDate: boolean;
}) {
  const age = daysBetween(ticket.day_key, todayKey);
  const place = [companyLabel(ticket.company), ticket.location].filter((v) => v && v !== "-").join(" · ");

  return (
    <Link
      // เปิดหน้า Tickets พร้อมกางแผงรายละเอียดของเรื่องนี้ให้เลย ไม่ต้องไปไล่หาในตารางเอง
      href={`/tickets?code=${encodeURIComponent(ticket.ticket_code)}`}
      className="group rounded-xl border border-line bg-white/[0.02] p-3 transition hover:border-cyan-400/30 hover:bg-accent-bg/20"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-num text-sm font-semibold text-accent">{ticket.ticket_code}</span>
        <TicketStatusBadge status={ticket.status} />
      </div>

      <p className="mt-1.5 line-clamp-2 text-sm text-ink">{ticket.description}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-muted">
        <span>{TICKET_TYPE_LABEL[ticket.type]}</span>
        {place ? <span>· {place}</span> : null}
        {ticket.requester_name ? <span>· {ticket.requester_name}</span> : null}
        <span>· {showDate ? `${thaiDayLabel(ticket.day_key)} ${ticket.time}` : ticket.time} น.</span>
        {ticket.open && age > 0 ? (
          // บอกอายุเฉพาะเรื่องที่ยังค้าง — เรื่องที่ปิดแล้วไม่ต้องเร่งใคร
          <span className={age >= 7 ? "text-rose-300" : "text-amber-300"}>· ค้าง {age} วัน</span>
        ) : null}
      </div>
    </Link>
  );
}
