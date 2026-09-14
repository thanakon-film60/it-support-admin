"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createStockItemAction, type StockFormState } from "@/app/actions/stock";
import { Button } from "@/components/ui/Button";

const inputClass =
  "rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-accent";

const initialState: StockFormState = {};

export function StockItemForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createStockItemAction, initialState);

  useEffect(() => {
    if (state.success) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  return (
    <div className="rounded-2xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3 text-left text-sm font-semibold text-ink"
      >
        <span>➕ เพิ่มรายการสต็อกใหม่</span>
        <span className="text-muted">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <form
          action={formAction}
          key={state.success ? "reset" : "form"}
          className="flex flex-col gap-4 border-t border-line p-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="ชื่อรายการ *">
              <input name="name" required className={inputClass} />
            </Field>
            <Field label="หมวดหมู่">
              <input
                name="category"
                className={inputClass}
                placeholder="เช่น hardware, อุปกรณ์ต่อพ่วง"
              />
            </Field>
            <Field label="หน่วยนับ">
              <input name="unit" defaultValue="ชิ้น" className={inputClass} />
            </Field>
            <Field label="สถานที่จัดเก็บ">
              <input name="location" defaultValue="IT" className={inputClass} />
            </Field>
            <Field label="จำนวนเริ่มต้น">
              <input
                name="quantity_available"
                type="number"
                min="0"
                defaultValue={0}
                className={inputClass}
              />
            </Field>
            <Field label="Safety Stock">
              <input
                name="safety_stock"
                type="number"
                min="0"
                defaultValue={0}
                className={inputClass}
              />
            </Field>
          </div>

          {state.error && (
            <p className="rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-400">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "กำลังบันทึก..." : "บันทึกรายการ"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}
