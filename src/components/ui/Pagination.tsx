"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
   แบ่งหน้าแบบ client-side — ข้อมูลทั้งชุดถูกส่งมาจากเซิร์ฟเวอร์อยู่แล้ว
   (หน้าเหล่านี้เรนเดอร์ฝั่งเซิร์ฟเวอร์แล้วส่ง array เต็มลงมา ไม่ได้ยิง API ทีละหน้า)
   การตัดหน้าในเบราว์เซอร์จึงไม่มีรอบวิ่งเน็ตเพิ่ม และ "ค้นหา/กรอง" ยังทำงานกับข้อมูล
   ทั้งชุดเหมือนเดิม ไม่ใช่ค้นเฉพาะหน้าที่เห็น ซึ่งเป็นกับดักคลาสสิกของ pagination
   ───────────────────────────────────────────────────────────────────────────── */

/** 0 = แสดงทั้งหมด (ไม่แบ่งหน้า) */
export const PAGE_SIZE_OPTIONS = [20, 50, 100, 0] as const;
const DEFAULT_SIZE = 20;

/** ต่ำกว่านี้ไม่ต้องโชว์แถบแบ่งหน้าเลย — 20 แถวยังกวาดตาอ่านรวดเดียวได้ */
const HIDE_BELOW = 20;

export interface Pager<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
  totalPages: number;
  /** ลำดับแถวแรก/แถวสุดท้ายที่แสดงอยู่ (นับจาก 1) ไว้โชว์ว่า "แสดง 1–20 จาก 251" */
  from: number;
  to: number;
  setPage: (p: number) => void;
  setSize: (s: number) => void;
}

/** localStorage ไม่ยิง event ให้แท็บที่เขียนเอง จึงไม่มีอะไรให้ subscribe จริงๆ
 *  ค่าจะเปลี่ยนได้ทางเดียวคือผู้ใช้กดเลือกในหน้านี้ ซึ่งจัดการด้วย state แยกอยู่แล้ว */
const subscribeNoop = () => () => {};

export function usePaginated<T>(
  rows: T[],
  options?: { storageKey?: string; defaultSize?: number; resetOn?: string }
): Pager<T> {
  const storageKey = options?.storageKey ? `itadmin:pageSize:${options.storageKey}` : null;
  const fallbackSize = options?.defaultSize ?? DEFAULT_SIZE;
  const [sizeOverride, setSizeOverride] = useState<number | null>(null);
  const [page, setPageState] = useState(1);

  // อ่านขนาดหน้าที่เคยเลือกไว้ผ่าน useSyncExternalStore ไม่ใช่ useEffect + setState
  //
  // เดิมอ่านใน useEffect แล้ว setState ทันที ซึ่ง (1) ทำให้เรนเดอร์ซ้ำทุกครั้งที่ mount
  // (2) โดน react-hooks/set-state-in-effect ของ React 19 ตีตกตอน lint
  // useSyncExternalStore ออกแบบมาสำหรับเคสนี้โดยตรง: ค่าตอนเซิร์ฟเวอร์เรนเดอร์คือ null
  // (จึงได้ค่าตั้งต้นเหมือนกันทั้งสองฝั่ง ไม่มี hydration mismatch) แล้วค่อยอ่านของจริงในเบราว์เซอร์
  const readStored = useCallback((): number | null => {
    if (!storageKey) return null;
    try {
      // ต้องเช็ค null ก่อนแปลงเป็นตัวเลข — Number(null) ได้ 0 ซึ่งบังเอิญตรงกับตัวเลือก
      // "ทั้งหมด" พอดี ผลคือผู้ใช้ที่ไม่เคยเลือกอะไรเลยจะโดนบังคับให้แสดงทั้ง 251 แถว
      const raw = window.localStorage.getItem(storageKey);
      if (raw === null) return null;
      const saved = Number(raw);
      return Number.isFinite(saved) &&
        PAGE_SIZE_OPTIONS.includes(saved as (typeof PAGE_SIZE_OPTIONS)[number])
        ? saved
        : null;
    } catch {
      /* โหมดส่วนตัว/ปิด storage ไว้ — ใช้ค่าเริ่มต้นไปตามปกติ */
      return null;
    }
  }, [storageKey]);

  const storedSize = useSyncExternalStore(subscribeNoop, readStored, () => null);
  // ที่ผู้ใช้เพิ่งเลือกในหน้านี้ ต้องชนะค่าที่อ่านจาก storage เสมอ
  const size = sizeOverride ?? storedSize ?? fallbackSize;

  const total = rows.length;
  const totalPages = size === 0 ? 1 : Math.max(1, Math.ceil(total / size));

  // เด้งกลับหน้า 1 เมื่อ "สิ่งที่กำลังดูอยู่เปลี่ยนความหมาย" มี 2 กรณี:
  //   1. จำนวนแถวเปลี่ยน = เพิ่งค้นหา/กรองใหม่
  //      ถ้าไม่ทำ ผู้ใช้ที่อยู่หน้า 8 แล้วพิมพ์ค้นหาจะเจอตารางว่างเปล่าโดยไม่รู้สาเหตุ
  //   2. resetOn เปลี่ยน = เพิ่งสลับการเรียง (จำนวนแถวเท่าเดิมเป๊ะ จึงจับจากข้อ 1 ไม่ได้)
  //      ถ้าไม่ทำ คนที่กด "ค่าซ่อมมากไปน้อย" ตอนอยู่หน้า 5 จะไม่เห็นรายการที่แพงที่สุดเลย
  //      เพราะมันไปอยู่หน้า 1 ที่ตัวเองไม่ได้ดูอยู่ — ดูเหมือนปุ่มเรียงไม่ทำงาน
  const resetOn = options?.resetOn ?? "";
  const prevReset = useRef({ total, resetOn });
  useEffect(() => {
    if (prevReset.current.total !== total || prevReset.current.resetOn !== resetOn) {
      prevReset.current = { total, resetOn };
      setPageState(1);
    }
  }, [total, resetOn]);

  // กันหน้าเกินขอบเขตทุกกรณี (เช่น เปลี่ยนขนาดหน้าจาก 20 เป็น 100 ตอนอยู่หน้า 9)
  const safePage = Math.min(page, totalPages);

  const items = useMemo(() => {
    if (size === 0) return rows;
    const start = (safePage - 1) * size;
    return rows.slice(start, start + size);
  }, [rows, safePage, size]);

  function setSize(next: number) {
    setSizeOverride(next);
    setPageState(1);
    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        /* เขียนไม่ได้ก็ไม่เป็นไร แค่จำค่าไม่ได้ข้ามรอบ */
      }
    }
  }

  return {
    items,
    page: safePage,
    size,
    total,
    totalPages,
    from: total === 0 ? 0 : (safePage - 1) * (size === 0 ? total : size) + 1,
    to: size === 0 ? total : Math.min(safePage * size, total),
    setPage: (p) => setPageState(Math.min(Math.max(1, p), totalPages)),
    setSize,
  };
}

/** เลขหน้าที่จะแสดง: หน้าแรก, หน้าสุดท้าย, หน้าปัจจุบัน ±1 และใส่ "…" คั่นช่วงที่ข้าม
 *  เช่น 251 แถว หน้าละ 20 ตอนอยู่หน้า 7 -> 1 … 6 7 8 … 13 (ปุ่มไม่ล้นจอแม้มี 100 หน้า) */
function pageWindow(current: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set<number>([1, totalPages, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out;
}

const btn =
  "flex h-9 min-w-9 items-center justify-center rounded-lg px-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-35";

export function Pagination<T>({
  pager,
  unitLabel = "รายการ",
}: {
  pager: Pager<T>;
  /** คำนับหน่วยท้ายข้อความ เช่น "ชิ้น" / "เรื่อง" / "รายการ" */
  unitLabel?: string;
}) {
  const { page, size, total, totalPages, from, to, setPage, setSize } = pager;

  // ข้อมูลน้อยกว่าเกณฑ์ -> ไม่ต้องมีแถบนี้ให้รกหน้าจอ
  if (total <= HIDE_BELOW) return null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-white/[0.02] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>
          แสดง <span className="font-num text-ink">{from}</span>–
          <span className="font-num text-ink">{to}</span> จาก{" "}
          <span className="font-num text-ink">{total}</span> {unitLabel}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end sm:gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          <span className="hidden sm:inline">แสดงหน้าละ</span>
          <select
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="px-2 py-1.5 text-xs"
            aria-label="จำนวนรายการต่อหน้า"
          >
            {PAGE_SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? "ทั้งหมด" : `${s} แถว`}
              </option>
            ))}
          </select>
        </label>

        {size !== 0 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className={`${btn} border border-line text-muted hover:border-cyan-400/40 hover:text-ink`}
              aria-label="หน้าก่อนหน้า"
            >
              ‹
            </button>

            {/* จอเล็กโชว์แค่ "หน้า x / y" — ปุ่มเลขหน้าเต็มชุดกินพื้นที่เกินไปบนมือถือ */}
            <span className="font-num px-2 text-xs text-muted sm:hidden">
              {page} / {totalPages}
            </span>

            <div className="hidden items-center gap-1 sm:flex">
              {pageWindow(page, totalPages).map((p, i) =>
                p === "gap" ? (
                  <span key={`gap-${i}`} className="px-1 text-xs text-muted">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    aria-current={p === page ? "page" : undefined}
                    className={`${btn} font-num ${
                      p === page
                        ? "bg-accent-bg text-accent ring-1 ring-inset ring-cyan-400/35"
                        : "border border-line text-muted hover:border-cyan-400/40 hover:text-ink"
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            </div>

            <button
              type="button"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className={`${btn} border border-line text-muted hover:border-cyan-400/40 hover:text-ink`}
              aria-label="หน้าถัดไป"
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
