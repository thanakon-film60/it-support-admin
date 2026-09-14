"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createEquipmentAction, type EquipmentFormState } from "@/app/actions/equipment";
import { EQUIPMENT_CATEGORY_LABEL } from "@/lib/labels";
import type { EquipmentCategory, EquipmentStatus } from "@/lib/types";
import { Button } from "@/components/ui/Button";

const CATEGORY_OPTIONS = Object.entries(EQUIPMENT_CATEGORY_LABEL) as [
  EquipmentCategory,
  string,
][];
const STATUS_OPTIONS: EquipmentStatus[] = [
  "ว่าง",
  "จองแล้ว",
  "ใช้งานอยู่",
  "ส่งซ่อม",
  "เลิกใช้งาน",
];

const inputClass =
  "rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-accent";

const initialState: EquipmentFormState = {};

export function AssetForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hasOwner, setHasOwner] = useState(false);
  const [state, formAction, pending] = useActionState(createEquipmentAction, initialState);

  useEffect(() => {
    if (state.success) {
      setHasOwner(false);
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
        <span>➕ เพิ่มทรัพย์สินใหม่</span>
        <span className="text-muted">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <form
          action={formAction}
          key={state.success ? "reset" : "form"}
          className="flex flex-col gap-4 border-t border-line p-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="รหัสทรัพย์สิน *">
              <input name="asset_code" required className={inputClass} />
            </Field>
            <Field label="ยี่ห้อ/รุ่น">
              <input name="brand_model" className={inputClass} />
            </Field>
            <Field label="Serial Number">
              <input name="serial_number" className={inputClass} />
            </Field>
            <Field label="ประเภท">
              <select name="category" defaultValue="notebook" className={inputClass}>
                {CATEGORY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="สถานะ">
              <select name="status" defaultValue="ว่าง" className={inputClass}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ราคาซื้อ (บาท)">
              <input name="purchase_price" type="number" min="0" step="0.01" className={inputClass} />
            </Field>
            <Field label="สถานที่ติดตั้ง">
              <input name="install_location" className={inputClass} />
            </Field>
            <Field label="วันที่ซื้อ">
              <input name="purchase_date" type="date" className={inputClass} />
            </Field>
            <Field label="วันหมดประกัน">
              <input name="warranty_expiry" type="date" className={inputClass} />
            </Field>
          </div>

          <Field label="หมายเหตุ">
            <textarea name="notes" rows={2} className={inputClass} />
          </Field>

          <label className="flex w-fit items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="has_owner"
              checked={hasOwner}
              onChange={(e) => setHasOwner(e.target.checked)}
              className="h-4 w-4 rounded border-line accent-sky-400"
            />
            มีผู้ครอบครอง
          </label>

          {hasOwner && (
            <div className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-page/40 p-4 sm:grid-cols-3">
              <Field label="ชื่อผู้ครอบครอง *">
                <input name="owner_name" required={hasOwner} className={inputClass} />
              </Field>
              <Field label="รหัสพนักงาน">
                <input name="owner_employee_id" className={inputClass} />
              </Field>
              <Field label="แผนก">
                <input name="owner_department" className={inputClass} />
              </Field>
            </div>
          )}

          {state.error && (
            <p className="rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-400">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "กำลังบันทึก..." : "บันทึกทรัพย์สิน"}
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
