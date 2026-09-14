"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { bulkImportEquipmentAction } from "@/app/actions/equipment";
import type { Equipment, EquipmentCategory, EquipmentStatus } from "@/lib/types";

const CATEGORY_VALUES: EquipmentCategory[] = [
  "notebook", "desktop", "monitor", "mouse", "keyboard", "phone", "headset",
  "printer", "scanner", "router", "projector", "ups", "server", "tablet", "other",
];
const STATUS_VALUES: EquipmentStatus[] = ["ว่าง", "จองแล้ว", "ใช้งานอยู่", "ส่งซ่อม", "เลิกใช้งาน"];

// รองรับหัวคอลัมน์ได้หลายแบบ (ไทย/อังกฤษ) แมพเข้าชื่อฟิลด์จริงใน Equipment
const HEADER_ALIASES: Record<string, string> = {
  "รหัสทรัพย์สิน": "asset_code",
  "asset_code": "asset_code",
  "asset code": "asset_code",
  "ยี่ห้อ/รุ่น": "brand_model",
  "ยี่ห้อ": "brand_model",
  "brand_model": "brand_model",
  "รุ่น": "brand_model",
  "serial number": "serial_number",
  "serial_number": "serial_number",
  "s/n": "serial_number",
  "ประเภท": "category",
  "category": "category",
  "สถานะ": "status",
  "status": "status",
  "ราคาซื้อ": "purchase_price",
  "purchase_price": "purchase_price",
  "สถานที่ติดตั้ง": "install_location",
  "install_location": "install_location",
  "หมายเหตุ": "notes",
  "notes": "notes",
  "วันที่ซื้อ": "purchase_date",
  "purchase_date": "purchase_date",
  "วันหมดประกัน": "warranty_expiry",
  "warranty_expiry": "warranty_expiry",
};

function normalizeRow(raw: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const mapped = HEADER_ALIASES[key.trim().toLowerCase()];
    if (mapped) row[mapped] = value;
  }
  return row;
}

export function ImportExcelButton() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const buf = await file.arrayBuffer();
      const workbook = XLSX.read(buf, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      const equipmentRows = rawRows
        .map(normalizeRow)
        .map((r) => {
          const categoryRaw = String(r.category ?? "");
          const statusRaw = String(r.status ?? "");
          const category = (CATEGORY_VALUES as string[]).includes(categoryRaw)
            ? (categoryRaw as EquipmentCategory)
            : "other";
          const status = (STATUS_VALUES as string[]).includes(statusRaw)
            ? (statusRaw as EquipmentStatus)
            : "ว่าง";
          const priceRaw = r.purchase_price;
          const priceNum = Number(priceRaw);
          const purchase_price =
            priceRaw !== "" && priceRaw !== undefined && !Number.isNaN(priceNum)
              ? priceNum
              : null;

          return {
            asset_code: String(r.asset_code ?? "").trim(),
            brand_model: r.brand_model ? String(r.brand_model).trim() : null,
            serial_number: r.serial_number ? String(r.serial_number).trim() : null,
            category,
            status,
            purchase_price,
            install_location: r.install_location ? String(r.install_location).trim() : null,
            notes: r.notes ? String(r.notes).trim() : null,
            purchase_date: r.purchase_date ? String(r.purchase_date).trim() : null,
            warranty_expiry: r.warranty_expiry ? String(r.warranty_expiry).trim() : null,
          } as Omit<Equipment, "id" | "created_at" | "current_holder_id" | "current_holder_since">;
        })
        .filter((r) => r.asset_code);

      const result = await bulkImportEquipmentAction(equipmentRows);
      setMessage(
        `นำเข้าสำเร็จ ${result.importedCount ?? 0} รายการ` +
          (result.skippedCount ? ` (ข้าม ${result.skippedCount} แถวที่ไม่มีรหัสทรัพย์สิน)` : "")
      );
      router.refresh();
    } catch {
      setMessage("ไม่สามารถอ่านไฟล์ได้ กรุณาตรวจสอบรูปแบบไฟล์ (.xlsx, .xls, .csv)");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "กำลังนำเข้า..." : "⬆ Import Excel"}
      </Button>
      {message && <p className="max-w-[240px] text-right text-xs text-muted">{message}</p>}
    </div>
  );
}
