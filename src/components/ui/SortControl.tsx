"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  dirLabel,
  firstClickDir,
  sortRows,
  type SortColumn,
  type SortDir,
} from "@/lib/sorting";

/* ─────────────────────────────────────────────────────────────────────────────
   การเรียงลำดับตารางแบบใช้ร่วมทุกหน้า — มี 2 ทางให้ผู้ใช้เลือก โดยตั้งใจ

   1. คลิกที่หัวคอลัมน์ — เร็วสำหรับคนที่ชินกับ Excel คลิกซ้ำเพื่อสลับขึ้น/ลง
   2. ปุ่ม "เรียงตาม ..." ข้างช่องค้นหา — จำเป็นเพราะบนมือถือตารางต้องเลื่อนแนวนอน
      หัวคอลัมน์ที่อยากเรียงอาจอยู่นอกจอ คนจึงไม่มีทางรู้เลยว่าคลิกหัวตารางได้

   เรียงฝั่งเบราว์เซอร์ล้วน เพราะเซิร์ฟเวอร์ส่งข้อมูลทั้งชุดลงมาอยู่แล้ว
   (เหตุผลเดียวกับ Pagination.tsx) สลับการเรียงจึงไม่มีรอบวิ่งเน็ตเลย
   ───────────────────────────────────────────────────────────────────────────── */

export interface SortState<T> {
  /** แถวที่เรียงแล้ว — เอาไปส่งต่อให้ usePaginated */
  rows: T[];
  key: string;
  dir: SortDir;
  column: SortColumn<T> | null;
  columns: SortColumn<T>[];
  /** คลิกหัวคอลัมน์: คอลัมน์เดิม = สลับทิศ, คอลัมน์ใหม่ = เริ่มที่ทิศตั้งต้นของคอลัมน์นั้น */
  toggle: (key: string) => void;
  setKey: (key: string) => void;
  flip: () => void;
  isDefault: boolean;
  reset: () => void;
}

/* ---------------------------------------------------------------- จำค่าที่เลือก

   อ่าน localStorage ผ่าน useSyncExternalStore ไม่ใช่ useEffect + setState

   เหตุผล: ค่าที่จำไว้ต้อง "ไม่" ถูกใช้ตอนเรนเดอร์ฝั่งเซิร์ฟเวอร์ ไม่งั้น HTML สองฝั่ง
   ไม่ตรงกัน (hydration mismatch) แต่ถ้าแก้ด้วย useEffect + setState จะไปชน
   กฎ react-hooks/set-state-in-effect ของ eslint ชุดนี้ useSyncExternalStore แก้ได้
   ทั้งสองข้อพร้อมกัน เพราะมันมี getServerSnapshot แยกไว้ให้ตอน SSR อยู่แล้ว
   (Pagination.tsx ยังใช้แบบเดิมอยู่ ย้ายมาใช้วิธีนี้ได้ถ้าจะแก้ warning นั้นวันหลัง) */

const PREFIX = "itadmin:sort:";
/** ไม่ต้องรับสัญญาณจากที่อื่น — เราเขียนเองแล้ว setState เองทุกครั้ง */
const subscribeNoop = () => () => {};

function readStored(key: string | null): string | null {
  if (!key) return null;
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null; // โหมดส่วนตัว / ปิด storage ไว้
  }
}

function writeStored(key: string | null, value: string) {
  if (!key) return;
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    /* จำไม่ได้ก็ไม่เป็นไร ไม่ควรทำให้หน้าพัง */
  }
}

export function useSort<T>(
  rows: T[],
  columns: SortColumn<T>[],
  options: { defaultKey: string; defaultDir?: SortDir; storageKey?: string }
): SortState<T> {
  const { defaultKey, storageKey = null } = options;
  const defaultDir =
    options.defaultDir ??
    firstClickDir(columns.find((c) => c.key === defaultKey) ?? columns[0]);

  const stored = useSyncExternalStore(
    subscribeNoop,
    useCallback(() => readStored(storageKey), [storageKey]),
    () => null // ตอน SSR ยังไม่รู้ค่าที่จำไว้ ใช้ค่าตั้งต้นเสมอ
  );

  // ค่าที่ผู้ใช้เพิ่งเลือกในรอบนี้ ทับค่าที่จำไว้เสมอ
  const [override, setOverride] = useState<string | null>(null);

  const current = useMemo(() => {
    const raw = override ?? stored;
    if (raw) {
      const [k, d] = raw.split(":");
      // คอลัมน์ที่จำไว้อาจถูกลบไปแล้วหลังแก้โค้ด — ต้องตกกลับค่าตั้งต้น ไม่ใช่ไม่เรียงเลย
      if (columns.some((c) => c.key === k) && (d === "asc" || d === "desc")) {
        return { key: k, dir: d as SortDir };
      }
    }
    return { key: defaultKey, dir: defaultDir };
  }, [override, stored, columns, defaultKey, defaultDir]);

  const column = columns.find((c) => c.key === current.key) ?? null;
  const sorted = useMemo(() => sortRows(rows, column, current.dir), [rows, column, current.dir]);

  const apply = useCallback(
    (key: string, dir: SortDir) => {
      const value = `${key}:${dir}`;
      setOverride(value);
      writeStored(storageKey, value);
    },
    [storageKey]
  );

  return {
    rows: sorted,
    key: current.key,
    dir: current.dir,
    column,
    columns,
    toggle: (key) => {
      if (key === current.key) {
        apply(key, current.dir === "asc" ? "desc" : "asc");
      } else {
        const col = columns.find((c) => c.key === key);
        apply(key, col ? firstClickDir(col) : "desc");
      }
    },
    setKey: (key) => {
      const col = columns.find((c) => c.key === key);
      apply(key, col ? firstClickDir(col) : "desc");
    },
    flip: () => apply(current.key, current.dir === "asc" ? "desc" : "asc"),
    isDefault: current.key === defaultKey && current.dir === defaultDir,
    reset: () => apply(defaultKey, defaultDir),
  };
}

/* ---------------------------------------------------------------- หัวคอลัมน์คลิกได้ */

export function SortableTh<T>({
  sort,
  columnKey,
  children,
  className = "",
}: {
  sort: SortState<T>;
  /** ไม่ใส่ = คอลัมน์นี้เรียงไม่ได้ (เช่น ช่องปุ่มจัดการ) แสดงเป็นหัวธรรมดา */
  columnKey?: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (!columnKey) {
    return <th className={`px-4 py-3 font-medium ${className}`}>{children}</th>;
  }

  const active = sort.key === columnKey;
  const col = sort.columns.find((c) => c.key === columnKey);
  const nextDir = active ? (sort.dir === "asc" ? "desc" : "asc") : firstClickDir(col ?? { key: "", label: "", get: () => null });

  return (
    <th className={`px-4 py-3 font-medium ${className}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => sort.toggle(columnKey)}
        // title บอกผลของการกด ไม่ใช่สถานะปัจจุบัน — คนกดเพราะอยากได้ผลลัพธ์
        title={col ? `เรียง ${col.label}: ${dirLabel(col, nextDir)}` : undefined}
        className={`group inline-flex items-center gap-1 whitespace-nowrap rounded outline-none transition-colors hover:text-ink focus-visible:text-ink ${
          active ? "text-ink" : ""
        }`}
      >
        {children}
        <span
          aria-hidden
          className={`font-num text-[10px] leading-none ${
            active ? "text-accent" : "text-muted/40 group-hover:text-muted"
          }`}
        >
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </button>
    </th>
  );
}

/* ---------------------------------------------------------------- ปุ่มเลือกการเรียง */

export function SortMenu<T>({ sort, className = "" }: { sort: SortState<T>; className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <label className="sr-only" htmlFor="sort-field">
        เรียงตาม
      </label>
      <select
        id="sort-field"
        value={sort.key}
        onChange={(e) => sort.setKey(e.target.value)}
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      >
        {sort.columns.map((c) => (
          <option key={c.key} value={c.key}>
            เรียงตาม: {c.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={sort.flip}
        // ปุ่มนี้บอก "สถานะตอนนี้" ไม่ใช่ปลายทาง เพราะมันคือป้ายกำกับของตารางที่เห็นอยู่
        title="กดเพื่อสลับทิศทางการเรียง"
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors hover:border-accent focus-visible:border-accent"
      >
        <span className="font-num text-xs text-accent">{sort.dir === "asc" ? "↑" : "↓"}</span>
        {dirLabel(sort.column ?? undefined, sort.dir)}
      </button>
    </div>
  );
}
