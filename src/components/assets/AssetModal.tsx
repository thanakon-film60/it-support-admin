"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createEquipmentAction,
  updateEquipmentAction,
  type EquipmentFormState,
} from "@/app/actions/equipment";
import { EQUIPMENT_CATEGORY_LABEL } from "@/lib/labels";
import type {
  AssetFormOptions,
  EquipmentCategory,
  EquipmentStatus,
  EquipmentSummary,
} from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Field, MODAL_INPUT, Modal } from "@/components/ui/Modal";

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

const EMPTY_OPTIONS: AssetFormOptions = {
  brands: [],
  locations: [],
  departments: [],
  owners: [],
  assetCodes: [],
};

/** null = ปิด · "new" = เพิ่มใหม่ · ที่เหลือคือทรัพย์สินที่กำลังแก้ */
export type AssetEditing =
  | { mode: "new" }
  | { mode: "edit"; asset: EquipmentSummary }
  | null;

export function AssetModal({
  editing,
  options = EMPTY_OPTIONS,
  onClose,
  onSaved,
}: {
  editing: AssetEditing;
  options?: AssetFormOptions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const asset = editing?.mode === "edit" ? editing.asset : null;

  // สถานะการบันทึกอยู่ที่นี่ ไม่ใช่ในตัวฟอร์ม เพราะปุ่ม "บันทึก" อยู่ใน footer ของ Modal
  // ซึ่งเป็นคนละ subtree กับฟอร์ม — ถ้าเก็บไว้ข้างในปุ่มจะไม่รู้ว่ากำลังบันทึกอยู่
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<EquipmentFormState>({});

  function submit(formData: FormData) {
    setState({});
    startTransition(async () => {
      const result = asset
        ? await updateEquipmentAction(asset.id, {}, formData)
        : await createEquipmentAction({}, formData);
      if (result.error) setState(result);
      else onSaved();
    });
  }

  // ช่องที่ต้องคุมค่าเอง: รหัส (ไว้เตือนตอนซ้ำ) และชุดผู้ครอบครอง (เลือกชื่อแล้วเติมรหัส/แผนกให้)
  // key ของ <AssetFormBody> ผูกกับ id ของแถว ทำให้ state ชุดนี้ถูกสร้างใหม่ทุกครั้งที่เปลี่ยนแถว
  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={asset ? `แก้ไข ${asset.asset_code}` : "เพิ่มทรัพย์สินใหม่"}
      description={
        asset
          ? `${asset.brand_model ?? "ไม่ระบุรุ่น"} · เพิ่มเมื่อ ${asset.created_at.slice(0, 10)}`
          : "รหัสทรัพย์สินคือสิ่งที่ผู้ใช้พิมพ์เข้ามาในบอท ตั้งให้ตรงกับที่ติดไว้บนตัวเครื่อง"
      }
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
            ยกเลิก
          </Button>
          <Button type="submit" form="asset-form" disabled={isPending} className="w-full sm:w-auto">
            {isPending ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </>
      }
    >
      {editing ? (
        <AssetFormBody
          key={asset?.id ?? "new"}
          asset={asset}
          options={options}
          onSubmit={submit}
          error={state.error}
        />
      ) : null}
    </Modal>
  );
}

function AssetFormBody({
  asset,
  options,
  onSubmit,
  error,
}: {
  asset: EquipmentSummary | null;
  options: AssetFormOptions;
  onSubmit: (formData: FormData) => void;
  error?: string;
}) {
  const [assetCode, setAssetCode] = useState(asset?.asset_code ?? "");
  const [hasOwner, setHasOwner] = useState(Boolean(asset?.owner_name));
  const [ownerName, setOwnerName] = useState(asset?.owner_name ?? "");
  const [ownerEmployeeId, setOwnerEmployeeId] = useState("");
  const [ownerDepartment, setOwnerDepartment] = useState(asset?.owner_department ?? "");

  const codeTaken = useMemo(() => {
    const c = assetCode.trim().toUpperCase();
    if (!c) return false;
    // ตอนแก้ไข รหัสเดิมของตัวเองไม่นับว่าซ้ำ
    if (asset && c === asset.asset_code.trim().toUpperCase()) return false;
    return options.assetCodes.includes(c);
  }, [assetCode, options.assetCodes, asset]);

  /** เลือกชื่อที่มีอยู่แล้ว -> เติมรหัสพนักงาน/แผนกของคนนั้นให้ (ยังพิมพ์ทับได้)
   *  กันไม่ให้เกิดคนชื่อเดียวกันแต่แผนกไม่ตรงกันเต็มระบบ */
  function handleOwnerName(value: string) {
    setOwnerName(value);
    const match = options.owners.find(
      (o) => o.name.trim().toLowerCase() === value.trim().toLowerCase()
    );
    if (match) {
      setOwnerEmployeeId(match.employee_id ?? "");
      setOwnerDepartment(match.department ?? "");
    }
  }

  return (
    <form id="asset-form" action={onSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="รหัสทรัพย์สิน"
          required
          hint={codeTaken ? "⚠ รหัสนี้ถูกใช้กับเครื่องอื่นแล้ว" : undefined}
        >
          <input
            name="asset_code"
            required
            value={assetCode}
            onChange={(e) => setAssetCode(e.target.value)}
            placeholder="เช่น NB2608008"
            autoComplete="off"
            className={`${MODAL_INPUT} ${codeTaken ? "border-amber-400/50" : ""}`}
          />
        </Field>

        <Field label="ยี่ห้อ/รุ่น" hint="พิมพ์เอง หรือเลือกจากที่เคยใช้">
          <input
            name="brand_model"
            list="asset-brands"
            defaultValue={asset?.brand_model ?? ""}
            placeholder="เลือกหรือพิมพ์…"
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="Serial Number">
          <input
            name="serial_number"
            defaultValue={asset?.serial_number ?? ""}
            autoComplete="off"
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="ประเภท">
          <select
            name="category"
            defaultValue={asset?.category ?? "notebook"}
            className={MODAL_INPUT}
          >
            {CATEGORY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="สถานะ">
          <select name="status" defaultValue={asset?.status ?? "ว่าง"} className={MODAL_INPUT}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        <Field label="ราคาซื้อ (บาท)">
          <input
            name="purchase_price"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            defaultValue={asset?.purchase_price ?? ""}
            className={`${MODAL_INPUT} font-num`}
          />
        </Field>

        <Field label="สถานที่ติดตั้ง" hint="พิมพ์เอง หรือเลือกจากที่เคยใช้">
          <input
            name="install_location"
            list="asset-locations"
            defaultValue={asset?.install_location ?? ""}
            placeholder="เลือกหรือพิมพ์…"
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="วันที่ซื้อ">
          <input
            name="purchase_date"
            type="date"
            defaultValue={asset?.purchase_date ?? ""}
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="วันหมดประกัน">
          <input
            name="warranty_expiry"
            type="date"
            defaultValue={asset?.warranty_expiry ?? ""}
            className={MODAL_INPUT}
          />
        </Field>
      </div>

      <Field label="หมายเหตุ">
        <textarea
          name="notes"
          rows={2}
          defaultValue={asset?.notes ?? ""}
          className={`${MODAL_INPUT} resize-y`}
        />
      </Field>

      <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5 text-sm text-ink transition hover:border-cyan-400/40">
        <input
          type="checkbox"
          name="has_owner"
          checked={hasOwner}
          onChange={(e) => setHasOwner(e.target.checked)}
          className="h-4 w-4 accent-cyan-400"
        />
        มีผู้ครอบครอง
      </label>

      {hasOwner && (
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-page/40 p-4 sm:grid-cols-3">
          <Field label="ชื่อผู้ครอบครอง" required hint={`มีในระบบ ${options.owners.length} ราย`}>
            <input
              name="owner_name"
              list="asset-owners"
              required={hasOwner}
              value={ownerName}
              onChange={(e) => handleOwnerName(e.target.value)}
              placeholder="เลือกหรือพิมพ์ชื่อใหม่…"
              autoComplete="off"
              className={MODAL_INPUT}
            />
          </Field>
          <Field label="รหัสพนักงาน">
            <input
              name="owner_employee_id"
              value={ownerEmployeeId}
              onChange={(e) => setOwnerEmployeeId(e.target.value)}
              autoComplete="off"
              className={`${MODAL_INPUT} font-num`}
            />
          </Field>
          <Field label="แผนก">
            <input
              name="owner_department"
              list="asset-departments"
              value={ownerDepartment}
              onChange={(e) => setOwnerDepartment(e.target.value)}
              placeholder="เลือกหรือพิมพ์…"
              className={MODAL_INPUT}
            />
          </Field>
        </div>
      )}

      {/* รายการตัวเลือกของช่องแบบ "พิมพ์ได้ด้วย เลือกได้ด้วย" — ใช้ <datalist> ของ HTML
          จึงใช้ได้ทั้งบนมือถือและเดสก์ท็อปโดยไม่ต้องพึ่งไลบรารีเพิ่ม */}
      <datalist id="asset-brands">
        {options.brands.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <datalist id="asset-locations">
        {options.locations.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <datalist id="asset-departments">
        {options.departments.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <datalist id="asset-owners">
        {options.owners.map((o) => (
          <option key={o.name} value={o.name}>
            {[o.employee_id, o.department].filter(Boolean).join(" · ")}
          </option>
        ))}
      </datalist>

      {error && (
        <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-inset ring-rose-400/25">
          {error}
        </p>
      )}
    </form>
  );
}
