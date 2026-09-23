"use client";

import { useState, useTransition } from "react";
import { updateCustodianAction, type EquipmentFormState } from "@/app/actions/equipment";
import { EQUIPMENT_CATEGORY_LABEL } from "@/lib/labels";
import type { CustodianFormOptions, EquipmentStatus, EquipmentSummary } from "@/lib/types";
import { EquipmentStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, MODAL_INPUT, Modal } from "@/components/ui/Modal";
import { ageFrom, formatThaiDateShort } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────────────────
   Modal แก้ไข "ผู้ครอบครอง" — แก้เรื่องการถือครองกับสถานะเท่านั้น

   รหัสทรัพย์สิน ยี่ห้อ serial ราคา ประกัน แก้ที่หน้าทรัพย์สิน (/assets) ที่เดียว
   ถ้าแก้ได้สองที่ วันหนึ่งสองหน้าจะ validate ไม่เหมือนกัน (เช่นหน้าหนึ่งเตือนรหัสซ้ำ อีกหน้าไม่เตือน)
   แล้วผลลัพธ์จะต่างกันตามหน้าที่บังเอิญเปิดอยู่ ซึ่งอธิบายให้ผู้ใช้เข้าใจไม่ได้
   ───────────────────────────────────────────────────────────────────────────── */

const STATUS_OPTIONS: EquipmentStatus[] = [
  "ว่าง",
  "จองแล้ว",
  "ใช้งานอยู่",
  "ส่งซ่อม",
  "เลิกใช้งาน",
];

const EMPTY_OPTIONS: CustodianFormOptions = { owners: [], departments: [] };

/** แปลง timestamp เป็นค่าที่ <input type="date"> รับได้ ("YYYY-MM-DD")
 *  ตัดจากสตริง ISO ตรงๆ ไม่ผ่าน new Date() เพราะเบราว์เซอร์ของแอดมินอยู่ UTC+7
 *  ส่วนค่าที่เก็บเป็น UTC — แปลงกลับไปมาแล้ววันจะเลื่อนไปมาเองในช่วงหัวค่ำ */
function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function CustodianModal({
  asset,
  options = EMPTY_OPTIONS,
  onClose,
  onSaved,
}: {
  /** null = ปิด modal */
  asset: EquipmentSummary | null;
  options?: CustodianFormOptions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<EquipmentFormState>({});

  function submit(formData: FormData) {
    if (!asset) return;
    setState({});
    startTransition(async () => {
      const result = await updateCustodianAction(asset.id, {}, formData);
      if (result.error) setState(result);
      else onSaved();
    });
  }

  return (
    <Modal
      open={asset !== null}
      onClose={onClose}
      title={asset ? `ผู้ครอบครอง ${asset.asset_code}` : ""}
      description="แก้ไขได้เฉพาะผู้ถือครองและสถานะ · รายละเอียดตัวเครื่องแก้ที่หน้าทรัพย์สิน"
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
            ยกเลิก
          </Button>
          <Button
            type="submit"
            form="custodian-form"
            disabled={isPending}
            className="w-full sm:w-auto"
          >
            {isPending ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </>
      }
    >
      {asset ? (
        <CustodianFormBody
          key={asset.id}
          asset={asset}
          options={options}
          onSubmit={submit}
          error={state.error}
        />
      ) : null}
    </Modal>
  );
}

function CustodianFormBody({
  asset,
  options,
  onSubmit,
  error,
}: {
  asset: EquipmentSummary;
  options: CustodianFormOptions;
  onSubmit: (formData: FormData) => void;
  error?: string;
}) {
  const [released, setReleased] = useState(false);
  const [ownerName, setOwnerName] = useState(asset.owner_name ?? "");
  const [employeeId, setEmployeeId] = useState(
    options.owners.find((o) => o.name === asset.owner_name)?.employee_id ?? ""
  );
  const [department, setDepartment] = useState(asset.owner_department ?? "");
  const [status, setStatus] = useState<EquipmentStatus>(asset.status);

  /** เลือกชื่อที่มีอยู่แล้ว -> เติมรหัสพนักงาน/แผนกของคนนั้นให้ (ยังพิมพ์ทับได้)
   *  กันไม่ให้เกิดคนชื่อเดียวกันแต่แผนกไม่ตรงกันกระจายอยู่ในระบบ */
  function handleOwnerName(value: string) {
    setOwnerName(value);
    const match = options.owners.find(
      (o) => o.name.trim().toLowerCase() === value.trim().toLowerCase()
    );
    if (match) {
      setEmployeeId(match.employee_id ?? "");
      setDepartment(match.department ?? "");
    }
  }

  /** ติ๊ก "คืนเครื่อง" แล้วเสนอสถานะ "ว่าง" ให้ทันที — ของที่ไม่มีคนถือแต่ยังขึ้น "ใช้งานอยู่"
   *  คือสิ่งที่ทำให้ตัวเลขบนหน้าภาพรวมเชื่อถือไม่ได้ (ยังเปลี่ยนกลับเองได้ถ้าเครื่องส่งซ่อมอยู่) */
  function handleRelease(checked: boolean) {
    setReleased(checked);
    if (checked && status === "ใช้งานอยู่") setStatus("ว่าง");
    if (!checked && status === "ว่าง") setStatus(asset.status);
  }

  return (
    <form id="custodian-form" action={onSubmit} className="flex flex-col gap-4">
      {/* ── ส่วนที่แก้ได้ ── */}
      <div className="flex flex-col gap-4 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5 text-sm text-ink transition hover:border-cyan-400/40">
          <input
            type="checkbox"
            name="release"
            checked={released}
            onChange={(e) => handleRelease(e.target.checked)}
            className="h-4 w-4 accent-cyan-400"
          />
          คืนเครื่อง — ไม่มีผู้ครอบครองแล้ว
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="ผู้ครอบครอง"
            required={!released}
            hint={released ? "ถูกปลดออกเมื่อบันทึก" : `มีในระบบ ${options.owners.length} ราย`}
            className="lg:col-span-2"
          >
            <input
              name="owner_name"
              list="custodian-owners"
              required={!released}
              disabled={released}
              value={ownerName}
              onChange={(e) => handleOwnerName(e.target.value)}
              placeholder="เลือกหรือพิมพ์ชื่อใหม่…"
              autoComplete="off"
              className={`${MODAL_INPUT} disabled:opacity-40`}
            />
          </Field>

          <Field label="รหัสพนักงาน">
            <input
              name="owner_employee_id"
              disabled={released}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              autoComplete="off"
              className={`${MODAL_INPUT} font-num disabled:opacity-40`}
            />
          </Field>

          <Field label="แผนก">
            <input
              name="owner_department"
              list="custodian-departments"
              disabled={released}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="เลือกหรือพิมพ์…"
              className={`${MODAL_INPUT} disabled:opacity-40`}
            />
          </Field>

          <Field
            label="วันที่เริ่มถือครอง"
            hint={released ? "ถูกล้างเมื่อคืนเครื่อง" : "เว้นว่าง = นับวันนี้เมื่อเปลี่ยนมือ"}
          >
            <input
              name="holder_since"
              type="date"
              disabled={released}
              max={new Date().toISOString().slice(0, 10)}
              defaultValue={toDateInput(asset.current_holder_since)}
              className={`${MODAL_INPUT} disabled:opacity-40`}
            />
          </Field>

          <Field label="สถานะทรัพย์สิน">
            <select
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as EquipmentStatus)}
              className={MODAL_INPUT}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <datalist id="custodian-owners">
          {options.owners.map((o) => (
            <option key={o.name} value={o.name}>
              {[o.employee_id, o.department].filter(Boolean).join(" · ")}
            </option>
          ))}
        </datalist>
        <datalist id="custodian-departments">
          {options.departments.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>

        {error && (
          <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-inset ring-rose-400/25">
            {error}
          </p>
        )}
      </div>

      {/* ── ส่วนที่อ่านอย่างเดียว ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-muted">ข้อมูลตัวเครื่อง (แก้ที่หน้าทรัพย์สิน)</p>
          <EquipmentStatusBadge status={asset.status} />
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border border-line bg-page/40 p-4 text-sm sm:grid-cols-2">
          <ReadOnlyRow label="รหัสทรัพย์สิน" value={asset.asset_code} mono />
          <ReadOnlyRow label="ประเภท" value={EQUIPMENT_CATEGORY_LABEL[asset.category]} />
          <ReadOnlyRow label="ยี่ห้อ/รุ่น" value={asset.brand_model ?? "-"} />
          <ReadOnlyRow label="Serial Number" value={asset.serial_number ?? "-"} mono />
          <ReadOnlyRow label="สถานที่ติดตั้ง" value={asset.install_location ?? "-"} />
          <ReadOnlyRow label="ส่งซ่อมมาแล้ว" value={`${asset.repair_count} ครั้ง`} mono />
          <ReadOnlyRow
            label="ถือครองมาแล้ว"
            value={
              asset.current_holder_since
                ? `${ageFrom(asset.current_holder_since)} (ตั้งแต่ ${formatThaiDateShort(
                    asset.current_holder_since
                  )})`
                : "-"
            }
          />
          <ReadOnlyRow label="หมายเหตุ" value={asset.notes ?? "-"} />
        </dl>
      </div>
    </form>
  );
}

function ReadOnlyRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-ink ${mono ? "font-num" : ""}`}>{value}</dd>
    </div>
  );
}
