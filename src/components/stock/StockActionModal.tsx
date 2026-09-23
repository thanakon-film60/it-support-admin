"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { StockItemWithComputed } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Field, MODAL_INPUT, Modal } from "@/components/ui/Modal";
import {
  stockInAction,
  adjustStockQuantityAction,
  updateSafetyStockAction,
} from "@/app/actions/stock";

export type StockActionKind = "in" | "adjust" | "safety";

const TITLE: Record<StockActionKind, string> = {
  in: "รับเข้าสต็อก",
  adjust: "ปรับแก้จำนวนคงเหลือ",
  safety: "แก้ไข Safety Stock",
};

export function StockActionModal({
  item,
  action,
  staffName,
  onClose,
}: {
  item: StockItemWithComputed;
  action: StockActionKind;
  staffName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState(
    action === "adjust" ? item.quantity_available : action === "safety" ? item.safety_stock : 0
  );
  const [referenceNo, setReferenceNo] = useState("");
  const [note, setNote] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      if (action === "in") {
        await stockInAction(item.id, quantity, referenceNo, note, staffName);
      } else if (action === "adjust") {
        await adjustStockQuantityAction(item.id, quantity, note, staffName);
      } else {
        await updateSafetyStockAction(item.id, quantity);
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={TITLE[action]}
      size="sm"
      description={`${item.name} — คงเหลือปัจจุบัน ${item.quantity_available} ${item.unit}`}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
            ยกเลิก
          </Button>
          <Button
            type="submit"
            form="stock-action-form"
            disabled={isPending}
            className="w-full sm:w-auto"
          >
            {isPending ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </>
      }
    >
      <form id="stock-action-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label={
            action === "in"
              ? "จำนวนที่รับเข้า"
              : action === "adjust"
                ? "จำนวนคงเหลือใหม่"
                : "Safety Stock ใหม่"
          }
          required
        >
          <input
            type="number"
            min={0}
            required
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className={`${MODAL_INPUT} font-num`}
          />
        </Field>

        {action === "in" && (
          <Field label="เลขที่ PO / อ้างอิง">
            <input
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              className={MODAL_INPUT}
            />
          </Field>
        )}

        {action !== "safety" && (
          <Field label="หมายเหตุ" hint="จะถูกบันทึกไว้ในประวัติ transaction">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={MODAL_INPUT}
            />
          </Field>
        )}
      </form>
    </Modal>
  );
}
