"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createFaqItemAction, type FaqFormState } from "@/app/actions/faq";
import { FAQ_CATEGORY_LABEL } from "@/lib/labels";
import type { FaqCategory } from "@/lib/types";
import { Button } from "@/components/ui/Button";

const CATEGORY_OPTIONS = Object.entries(FAQ_CATEGORY_LABEL) as [FaqCategory, string][];
const inputClass =
  "rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-accent";
const initialState: FaqFormState = {};

export function FaqForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createFaqItemAction, initialState);

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
        <span>➕ เพิ่มคำถามที่พบบ่อย (FAQ)</span>
        <span className="text-muted">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <form
          action={formAction}
          key={state.success ? "reset" : "form"}
          encType="multipart/form-data"
          className="flex flex-col gap-4 border-t border-line p-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="หัวข้อ *">
              <input name="title" required className={inputClass} />
            </Field>
            <Field label="หมวดหมู่">
              <select name="category" defaultValue="general" className={inputClass}>
                {CATEGORY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Keywords (คั่นด้วยจุลภาค ,)">
            <input
              name="keywords"
              placeholder="เช่น ปริ้นไม่ออก, ปริ้นไม่ได้, เครื่องปริ้นเตอร์"
              className={inputClass}
            />
          </Field>

          <Field label="เนื้อหา / วิธีแก้ไข *">
            <textarea name="content" required rows={4} className={inputClass} />
          </Field>

          <Field label="รูปภาพประกอบ (เลือกได้หลายรูป)">
            <input
              name="images"
              type="file"
              accept="image/*"
              multiple
              className="text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-accent-bg file:px-3 file:py-2 file:text-accent"
            />
          </Field>

          {state.error && (
            <p className="rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-400">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "กำลังบันทึก..." : "บันทึก FAQ"}
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
