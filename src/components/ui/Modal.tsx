"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

/* ─────────────────────────────────────────────────────────────────────────────
   Modal ที่ใช้ร่วมกันทุกหน้า (ทรัพย์สิน / สต็อก / สาขา / FAQ)

   รูปแบบต่างกันตามอุปกรณ์โดยตั้งใจ ไม่ใช่แค่ย่อ-ขยายกล่องเดียวกัน:

     มือถือ  -> bottom sheet เต็มความกว้าง ดันขึ้นมาจากขอบล่าง
               เพราะปุ่มยืนยันต้องอยู่ในระยะนิ้วโป้ง กล่องลอยกลางจอทำให้ปุ่มไปอยู่กลางจอ
               ซึ่งต้องขยับมือจับเครื่องใหม่ และหัวข้อจะถูกคีย์บอร์ดดันหายเวลาพิมพ์
     จอใหญ่ -> กล่องลอยกลางจอตามปกติ เพราะเมาส์ไปถึงทุกจุดเท่ากันหมด

   ทั้งสองแบบใช้ header/footer แบบ sticky และให้เนื้อหาตรงกลางเลื่อนเอง
   ฟอร์มยาวๆ (เช่นเพิ่มทรัพย์สินที่มี 12 ช่อง) จึงไม่ดันปุ่ม "บันทึก" หายไปใต้จอ
   ───────────────────────────────────────────────────────────────────────────── */

const SIZE = {
  sm: "sm:max-w-md",
  md: "sm:max-w-xl",
  lg: "sm:max-w-3xl",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  size?: keyof typeof SIZE;
  /** แถบปุ่มล่างสุด — ติดขอบไว้เสมอ ไม่เลื่อนหายไปกับเนื้อหา */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // จำว่าโฟกัสอยู่ที่ไหนก่อนเปิด เพื่อคืนให้ตอนปิด — ไม่งั้นคนใช้คีย์บอร์ดจะหลุดไปต้นหน้า
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    returnFocusRef.current = document.activeElement as HTMLElement | null;

    // ล็อกไม่ให้หน้าหลังเลื่อนตาม — บนมือถือถ้าไม่ล็อก การปัดใน modal จะไปเลื่อนหน้าข้างหลังแทน
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      // กักโฟกัสไว้ใน modal — ไม่งั้น Tab จะหลุดไปโดนปุ่มข้างหลังที่มองไม่เห็นและกดไม่ได้
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input:not([type="hidden"]), select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    // โฟกัสช่องแรกให้เลย คนกรอกฟอร์มจะได้พิมพ์ต่อได้ทันทีไม่ต้องคลิกก่อน
    // (ข้ามบนจอสัมผัส เพราะการโฟกัส input จะเด้งคีย์บอร์ดขึ้นมาบังทั้งจอตั้งแต่ยังไม่ทันอ่านหัวข้อ)
    const canHover = window.matchMedia("(hover: hover)").matches;
    const target = panelRef.current?.querySelector<HTMLElement>(
      canHover ? "input, select, textarea, button" : "[data-modal-close]"
    );
    target?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      returnFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => {
        // ปิดเมื่อคลิก "พื้นหลัง" เท่านั้น — เช็คที่ mousedown ไม่ใช่ click
        // ไม่งั้นการลากเลือกข้อความจากในกล่องแล้วปล่อยเมาส์นอกกล่องจะนับเป็นคลิกพื้นหลังและปิดทิ้งงานที่กรอกไว้
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:max-h-[86vh] sm:rounded-2xl ${SIZE[size]}`}
      >
        {/* ขีดจับด้านบน — สัญญาณว่า "นี่คือแผ่นที่เลื่อนขึ้นมา ปิดได้" ตามที่คนคุ้นบนมือถือ */}
        <div className="flex justify-center pt-2 sm:hidden" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-white/15" />
        </div>

        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-ink">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            data-modal-close
            aria-label="ปิด"
            className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-white/[0.06] hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>

        {footer ? (
          // pb ที่เผื่อ safe-area ไว้ — บน iPhone ที่ไม่มีปุ่มโฮม แถบขีดล่างจะทับปุ่มพอดีถ้าไม่เผื่อ
          <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** กล่องยืนยันก่อนทำสิ่งที่ย้อนกลับไม่ได้ — ใช้ร่วมกันทุกหน้าแทน window.confirm()
 *
 *  ทำไมไม่ใช้ confirm() ของเบราว์เซอร์: มันบอกได้แค่ข้อความบรรทัดเดียว ใส่ชื่อของที่จะลบ
 *  กับเหตุผลว่าทำไมลบไม่ได้ลงไปด้วยกันไม่ได้ และหน้าตาหลุดจากธีมทั้งระบบ
 *  ที่สำคัญกว่านั้นคือมันบล็อกทั้งหน้าจนกดอะไรไม่ได้เลยระหว่างนั้น */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "ลบ",
  pending = false,
  /** เหตุผลที่ทำรายการนี้ไม่ได้ — มีค่าเมื่อไหร่ ปุ่มยืนยันจะถูกปิดและแสดงเหตุผลแทน */
  blockedReason,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  pending?: boolean;
  blockedReason?: string | null;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
            {blockedReason ? "ปิด" : "ยกเลิก"}
          </Button>
          {blockedReason ? null : (
            <Button
              type="button"
              variant="danger"
              onClick={onConfirm}
              disabled={pending}
              className="w-full sm:w-auto"
            >
              {pending ? "กำลังดำเนินการ..." : confirmLabel}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-ink">
        <div>{message}</div>
        {blockedReason ? (
          <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-200 ring-1 ring-inset ring-amber-400/25">
            {blockedReason}
          </p>
        ) : (
          <p className="text-xs text-muted">การลบย้อนกลับไม่ได้</p>
        )}
      </div>
    </Modal>
  );
}

/** ช่องกรอกในฟอร์ม modal — จัด label/ช่อง/ข้อความช่วยให้เหมือนกันทุกหน้า */
export function Field({
  label,
  hint,
  required,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm ${className}`}>
      <span className="text-muted">
        {label}
        {required ? <span className="text-rose-300"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="text-[0.7rem] leading-4 text-muted/80">{hint}</span> : null}
    </label>
  );
}

/** คลาสของ input/select/textarea ใน modal — ความสูง 44px ตามขนาดเป้าสัมผัสขั้นต่ำ
 *  และ text-base (16px) บนมือถือ เพราะ Safari จะซูมหน้าเข้าเองถ้าตัวอักษรเล็กกว่านั้น */
export const MODAL_INPUT =
  "min-h-[2.75rem] w-full rounded-lg border border-line bg-page px-3 py-2 text-base text-ink outline-none transition focus:border-accent sm:text-sm";
