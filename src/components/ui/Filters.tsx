"use client";

import { useState } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
   ตัวกรองที่ใช้ร่วมกันทุกตาราง

   หลักที่ยึด:
     • ตัวเลือกใน dropdown สร้างจากข้อมูลจริงที่อยู่ในตารางเสมอ ไม่ hardcode
       (เพิ่มสาขาใหม่ในระบบ รอบหน้าสาขานั้นจะโผล่ในตัวกรองเอง ไม่ต้องแก้โค้ด)
     • ทุกตัวกรองมีค่าตั้งต้นเป็น "ทั้งหมด" — เปิดหน้ามาต้องเห็นข้อมูลครบก่อนเสมอ
       ตัวกรองที่จำค่าไว้ข้ามรอบเคยทำให้คนคิดว่าข้อมูลหาย จึงจงใจไม่จำ
     • มีปุ่มล้างตัวกรองโผล่ทันทีที่มีตัวกรองทำงานอยู่ พร้อมบอกจำนวน
   ───────────────────────────────────────────────────────────────────────────── */

export type DatePreset = "all" | "7d" | "30d" | "month" | "custom";

export interface DateRangeValue {
  preset: DatePreset;
  /** ใช้เฉพาะตอน preset = "custom" (รูปแบบ YYYY-MM-DD จาก <input type="date">) */
  from: string;
  to: string;
}

export const ALL_DATES: DateRangeValue = { preset: "all", from: "", to: "" };

const PRESET_LABEL: Record<DatePreset, string> = {
  all: "ทุกช่วงเวลา",
  "7d": "7 วันล่าสุด",
  "30d": "30 วันล่าสุด",
  month: "เดือนนี้",
  custom: "กำหนดเอง",
};

/** แปลงช่วงที่เลือกเป็นขอบเขตเวลาจริง — คำนวณฝั่งเบราว์เซอร์จึงได้เวลาไทยตามเครื่องผู้ใช้
 *  (ถ้าไปคำนวณฝั่งเซิร์ฟเวอร์ใน container ที่ตั้ง TZ เป็น UTC วันจะเหลื่อมไป 7 ชั่วโมง) */
function bounds(range: DateRangeValue): { min: number; max: number } | null {
  if (range.preset === "all") return null;

  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (range.preset === "7d" || range.preset === "30d") {
    const days = range.preset === "7d" ? 7 : 30;
    // นับ "7 วันล่าสุด" แบบรวมวันนี้ด้วย = ย้อนกลับไป 6 วันแล้วเริ่มที่เที่ยงคืน
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
    return { min: start.getTime(), max: endOfToday.getTime() };
  }

  if (range.preset === "month") {
    return { min: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), max: endOfToday.getTime() };
  }

  // custom — กรอกด้านเดียวได้ อีกด้านถือว่าไม่จำกัด
  const min = range.from ? new Date(`${range.from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const max = range.to ? new Date(`${range.to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
  return { min, max };
}

export function inDateRange(iso: string | null | undefined, range: DateRangeValue): boolean {
  const b = bounds(range);
  if (!b) return true;
  if (!iso) return false; // ไม่มีวันที่ = ตอบไม่ได้ว่าอยู่ในช่วงไหม จึงไม่นับเข้าช่วงที่เจาะจง
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= b.min && t <= b.max;
}

export function isDateRangeActive(range: DateRangeValue): boolean {
  if (range.preset === "all") return false;
  if (range.preset === "custom") return Boolean(range.from || range.to);
  return true;
}

/* ---------------------------------------------------------------- ตัวช่วยทำตัวเลือก */

/** ตัดค่าว่าง/ขีด ตัดซ้ำ เรียงแบบไทย — ใช้สร้าง dropdown จากข้อมูลจริงในตาราง */
export function optionsFrom(values: (string | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const t = (v ?? "").trim();
    if (t && t !== "-") set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "th"));
}

/** hook เล็กๆ ให้แต่ละตารางเรียกครั้งเดียว ได้ทั้ง state และตัวเลือก */
export function useDateRange() {
  const [range, setRange] = useState<DateRangeValue>(ALL_DATES);
  return { range, setRange, active: isDateRangeActive(range), reset: () => setRange(ALL_DATES) };
}

/* ---------------------------------------------------------------- คอมโพเนนต์ */

const CONTROL =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";

export function DateRangeFilter({
  value,
  onChange,
  label = "ช่วงวันที่",
}: {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  label?: string;
}) {
  return (
    <>
      <select
        aria-label={label}
        value={value.preset}
        onChange={(e) => onChange({ ...value, preset: e.target.value as DatePreset })}
        className={CONTROL}
      >
        {(Object.keys(PRESET_LABEL) as DatePreset[]).map((p) => (
          <option key={p} value={p}>
            {PRESET_LABEL[p]}
          </option>
        ))}
      </select>

      {value.preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="ตั้งแต่วันที่"
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            className={`${CONTROL} font-num`}
          />
          <span className="text-xs text-muted">ถึง</span>
          <input
            type="date"
            aria-label="ถึงวันที่"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className={`${CONTROL} font-num`}
          />
        </div>
      )}
    </>
  );
}

export function SelectFilter({
  value,
  onChange,
  options,
  allLabel,
  label,
  labelOf,
}: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  /** ข้อความของตัวเลือก "ทั้งหมด" เช่น "ทุกสาขา" */
  allLabel: string;
  label?: string;
  /** แปลงค่าเป็นข้อความที่คนอ่าน — ใช้กับตัวเลือกที่เป็นรหัส (เช่น "low" -> "ใกล้หมด")
   *  ค่าตั้งต้นคือแสดงค่าตรงๆ ซึ่งถูกแล้วสำหรับตัวกรองที่สร้างจากข้อมูลจริง */
  labelOf?: (value: string) => string;
}) {
  // ตัวกรองที่มีตัวเลือกเดียวไม่ได้ช่วยอะไร แถมกินที่ — ซ่อนไปเลย
  if (options.length < 2) return null;
  return (
    <select
      aria-label={label ?? allLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${CONTROL} max-w-[12rem]`}
    >
      <option value="all">{allLabel}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {labelOf ? labelOf(o) : o}
        </option>
      ))}
    </select>
  );
}

/** แถวตัวกรอง — ห่อให้ตัดบรรทัดเองบนจอแคบ ไม่ล้นจอ */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function ClearFiltersButton({
  count,
  onClear,
}: {
  /** จำนวนตัวกรองที่ทำงานอยู่ — 0 แปลว่าไม่ต้องแสดงปุ่มนี้ */
  count: number;
  onClear: () => void;
}) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-line/60 px-2.5 py-2 text-xs text-muted outline-none transition-colors hover:border-rose-500/50 hover:text-rose-300 focus-visible:border-rose-500/50"
    >
      ✕ ล้างตัวกรอง ({count})
    </button>
  );
}

/** นับว่ามีตัวกรองทำงานอยู่กี่ตัว ใช้ตัดสินใจว่าจะโชว์ปุ่มล้างไหม */
export function countActive(...flags: (boolean | string)[]): number {
  return flags.filter((f) => (typeof f === "string" ? f !== "all" && f !== "" : f)).length;
}

