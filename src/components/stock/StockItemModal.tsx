"use client";

import { useState, useTransition } from "react";
import type { StockItemWithComputed } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Field, MODAL_INPUT, Modal } from "@/components/ui/Modal";
import { createStockItemAction, updateStockItemAction } from "@/app/actions/stock";

/** null = ปิด · "new" = เพิ่มรายการใหม่ · ที่เหลือคือรายการที่กำลังแก้ */
export type StockEditing = { mode: "new" } | { mode: "edit"; item: StockItemWithComputed } | null;

export function StockItemModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: StockEditing;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const item = editing?.mode === "edit" ? editing.item : null;

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = item
        ? await updateStockItemAction(item.id, {}, formData)
        : await createStockItemAction({}, formData);
      if (result.error) setError(result.error);
      else onSaved();
    });
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={item ? "แก้ไขรายการสต็อก" : "เพิ่มรายการสต็อก"}
      description={
        item
          ? `คงเหลือปัจจุบัน ${item.quantity_available} ${item.unit} — แก้จำนวนที่นี่ไม่ได้ ใช้ปุ่ม "รับเข้า / ปรับยอด" แทน`
          : "ตั้งยอดเริ่มต้นได้ครั้งเดียวตอนสร้าง หลังจากนั้นทุกการเปลี่ยนแปลงต้องผ่านการรับเข้า/ปรับยอด"
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
            ยกเลิก
          </Button>
          <Button type="submit" form="stock-item-form" disabled={isPending} className="w-full sm:w-auto">
            {isPending ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </>
      }
    >
      <form
        id="stock-item-form"
        key={item?.id ?? "new"}
        action={handleSubmit}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label="ชื่อรายการ" required className="sm:col-span-2">
          <input
            name="name"
            required
            defaultValue={item?.name ?? ""}
            placeholder="เช่น คีย์บอร์ด, หมึกเครื่อง M3870FW"
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="หมวดหมู่">
          <input name="category" defaultValue={item?.category ?? ""} className={MODAL_INPUT} />
        </Field>

        <Field label="หน่วยนับ">
          <input
            name="unit"
            defaultValue={item?.unit ?? "ชิ้น"}
            placeholder="ชิ้น, กล่อง, เล่ม"
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="สถานที่จัดเก็บ" className="sm:col-span-2">
          <input name="location" defaultValue={item?.location ?? ""} className={MODAL_INPUT} />
        </Field>

        {/* ยอดเริ่มต้นตั้งได้เฉพาะตอนสร้าง — หลังจากนั้นต้องผ่าน transaction เพื่อให้มีประวัติกำกับ
            ว่าใครเพิ่ม/ลดเมื่อไหร่ ไม่งั้นยอดคงเหลือกับประวัติจะเพี้ยนจากกันโดยไล่ย้อนไม่ได้ */}
        {!item && (
          <Field label="จำนวนเริ่มต้น" hint="หลังจากนี้ต้องใช้ปุ่มรับเข้า/ปรับยอด">
            <input
              name="quantity_available"
              type="number"
              min={0}
              defaultValue={0}
              className={MODAL_INPUT}
            />
          </Field>
        )}

        <Field label="Safety Stock" hint="ต่ำกว่านี้จะถูกนับเป็นของใกล้หมด">
          <input
            name="safety_stock"
            type="number"
            min={0}
            defaultValue={item?.safety_stock ?? 0}
            className={MODAL_INPUT}
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300 sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
