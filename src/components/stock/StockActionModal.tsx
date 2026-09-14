"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { StockItemWithComputed } from "@/lib/types";
import { Button } from "@/components/ui/Button";
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
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-line bg-surface p-5"
      >
        <div>
          <p className="text-sm font-semibold text-ink">{TITLE[action]}</p>
          <p className="text-xs text-muted">
            {item.name} — คงเหลือปัจจุบัน {item.quantity_available} {item.unit}
          </p>
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">
            {action === "in"
              ? "จำนวนที่รับเข้า"
              : action === "adjust"
                ? "จำนวนคงเหลือใหม่"
                : "Safety Stock ใหม่"}
          </span>
          <input
            type="number"
            min={0}
            required
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </label>

        {action === "in" && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">เลขที่ PO / อ้างอิง</span>
            <input
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              className="rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
        )}

        {action !== "safety" && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">หมายเหตุ</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </div>
      </form>
    </div>
  );
}
