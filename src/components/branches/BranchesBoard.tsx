"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Branch, Company, CompanyCode } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { Pagination, usePaginated } from "@/components/ui/Pagination";
import { ConfirmDialog, Field, MODAL_INPUT, Modal } from "@/components/ui/Modal";
import {
  createBranchAction,
  deleteBranchAction,
  toggleBranchAction,
  updateBranchAction,
} from "@/app/actions/branches";

const CONTROL =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";

/** ฟอร์มที่กำลังเปิดอยู่ — null = ปิด, "new" = เพิ่มใหม่, ที่เหลือคือสาขาที่กำลังแก้ */
type Editing = { mode: "new" } | { mode: "edit"; branch: Branch } | null;

/** หน้าจัดการสาขา
 *
 *  ทำไมต้องมี: รายชื่อสาขาคือสิ่งแรกที่ผู้ใช้เจอในบอท ถ้าไม่มีที่แก้ ทีม IT ต้องรอ deploy
 *  ทุกครั้งที่มีสาขาเปิด/ปิด ซึ่งในธุรกิจค้าปลีกเกิดเดือนละหลายครั้ง */
export function BranchesBoard({
  branches,
  companies,
  ticketCounts,
}: {
  branches: Branch[];
  companies: Company[];
  /** จำนวน ticket ต่อสาขา key = "<company>|<ชื่อสาขา>" */
  ticketCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [companyFilter, setCompanyFilter] = useState<"all" | CompanyCode>("all");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Branch | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return branches
      .filter((b) => {
        if (companyFilter !== "all" && b.company !== companyFilter) return false;
        if (!showInactive && b.active === false) return false;
        if (!q) return true;
        return (
          b.name.toLowerCase().includes(q) ||
          (b.group ?? "").toLowerCase().includes(q) ||
          (b.area_manager ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.company !== b.company) return a.company.localeCompare(b.company);
        if ((a.group ?? "") !== (b.group ?? "")) {
          return (a.group ?? "").localeCompare(b.group ?? "", "th");
        }
        return a.name.localeCompare(b.name, "th");
      });
  }, [branches, companyFilter, search, showInactive]);

  const pager = usePaginated(visible, {
    storageKey: "branches",
    resetOn: `${companyFilter}:${search}:${showInactive}`,
  });

  const countsByCompany = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of branches) {
      if (b.active === false) continue;
      map[b.company] = (map[b.company] ?? 0) + 1;
    }
    return map;
  }, [branches]);

  function run(fn: () => Promise<{ error?: string }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result?.error) setError(result.error);
      else {
        onDone?.();
        router.refresh();
      }
    });
  }

  const companyNameOf = (code: string) =>
    companies.find((c) => c.code === code)?.name ?? code;
  const usedCountOf = (b: Branch) => ticketCounts[`${b.company}|${b.name}`] ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="สาขา / บริษัท"
        description="รายชื่อสาขาที่ใช้ในปุ่มเลือกสาขาของ LINE OA และฟอร์มแจ้งเรื่อง — ปิดสาขาแล้วจะหายจากปุ่มทันที"
        actions={
          <Button onClick={() => setEditing({ mode: "new" })}>+ เพิ่มสาขา</Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {companies.map((c) => (
          <span
            key={c.code}
            className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted"
          >
            {c.name} · <span className="font-num text-ink">{countsByCompany[c.code] ?? 0}</span> สาขา
          </span>
        ))}
      </div>

      {error && (
        <p className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อสาขา, กลุ่ม, Area Manager..."
          className={`${CONTROL} w-full sm:w-72`}
        />
        <select
          aria-label="บริษัท"
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value as "all" | CompanyCode)}
          className={CONTROL}
        >
          <option value="all">ทุกบริษัท</option>
          {companies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          แสดงสาขาที่ปิดแล้ว
        </label>
      </div>

      {/* มือถือ = การ์ดต่อสาขา · จอใหญ่ = ตาราง
          ไม่ใช้ตารางเดียวแล้วให้เลื่อนแนวนอนบนมือถือ เพราะปุ่ม "จัดการ" อยู่คอลัมน์ขวาสุด
          คนใช้มือถือจะต้องปัดไปจนสุดทุกครั้งกว่าจะกดแก้ไขได้ ซึ่งเป็นงานหลักของหน้านี้ */}
      <div className="flex flex-col gap-2 lg:hidden">
        {pager.items.map((b) => {
          const used = usedCountOf(b);
          return (
            <div
              key={b.id}
              className={`rounded-2xl border border-line bg-surface p-4 ${
                b.active === false ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {b.name}
                    {b.active === false && (
                      <span className="ml-2 rounded-full bg-white/[0.06] px-2 py-0.5 text-[0.65rem] text-muted">
                        ปิดใช้งาน
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {companyNameOf(b.company)}
                    {b.group ? ` · ${b.group}` : ""}
                    {b.floor ? ` · ชั้น ${b.floor}` : ""}
                  </p>
                  {b.area_manager ? (
                    <p className="mt-0.5 text-xs text-muted/80">AM: {b.area_manager}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-muted">
                  <span className="font-num text-ink">{used}</span> เรื่อง
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <RowButton onClick={() => setEditing({ mode: "edit", branch: b })} disabled={isPending}>
                  แก้ไข
                </RowButton>
                <RowButton
                  onClick={() => run(() => toggleBranchAction(b.id, b.active === false))}
                  disabled={isPending}
                >
                  {b.active === false ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                </RowButton>
                <RowButton onClick={() => setDeleting(b)} disabled={isPending} danger>
                  ลบ
                </RowButton>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
            ไม่พบสาขาที่ตรงกับเงื่อนไข
          </p>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface lg:block">
        <table className="w-full min-w-[840px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-4 py-3">บริษัท</th>
              <th className="px-4 py-3">สาขา</th>
              <th className="px-4 py-3">กลุ่ม / ทีม</th>
              <th className="px-4 py-3">ชั้น</th>
              <th className="px-4 py-3">Area / Sale Manager</th>
              <th className="px-4 py-3">เรื่องที่แจ้ง</th>
              <th className="px-4 py-3 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((b) => (
              <tr
                key={b.id}
                className={`border-b border-line/60 last:border-0 ${
                  b.active === false ? "opacity-50" : ""
                }`}
              >
                <td className="whitespace-nowrap px-4 py-3 text-muted">
                  {companyNameOf(b.company)}
                </td>
                <td className="px-4 py-3 font-medium text-ink">
                  {b.name}
                  {b.active === false && (
                    <span className="ml-2 rounded-full bg-white/[0.06] px-2 py-0.5 text-[0.65rem] text-muted">
                      ปิดใช้งาน
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted">{b.group ?? "-"}</td>
                <td className="px-4 py-3 font-num text-muted">{b.floor ?? "-"}</td>
                <td className="px-4 py-3 text-muted">
                  {b.area_manager ?? "-"}
                  {b.sale_manager ? (
                    <span className="block text-xs opacity-70">SM: {b.sale_manager}</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 font-num text-muted">{usedCountOf(b)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <div className="inline-flex gap-1.5">
                    <RowButton
                      onClick={() => setEditing({ mode: "edit", branch: b })}
                      disabled={isPending}
                    >
                      แก้ไข
                    </RowButton>
                    <RowButton
                      onClick={() => run(() => toggleBranchAction(b.id, b.active === false))}
                      disabled={isPending}
                    >
                      {b.active === false ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                    </RowButton>
                    <RowButton onClick={() => setDeleting(b)} disabled={isPending} danger>
                      ลบ
                    </RowButton>
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  ไม่พบสาขาที่ตรงกับเงื่อนไข
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination pager={pager} unitLabel="สาขา" />

      <BranchFormModal
        editing={editing}
        companies={companies}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting && run(() => deleteBranchAction(deleting.id), () => setDeleting(null))
        }
        pending={isPending}
        title="ลบสาขา"
        message={
          deleting ? (
            <>
              ต้องการลบสาขา <span className="font-semibold">{deleting.name}</span> ของ
              {" "}
              {companyNameOf(deleting.company)} ใช่ไหม
            </>
          ) : null
        }
        blockedReason={
          deleting && usedCountOf(deleting) > 0
            ? `สาขานี้มี ${usedCountOf(deleting)} เรื่องที่แจ้งไว้ ลบแล้วประวัติจะอ้างถึงสาขาที่ไม่มีข้อมูลกำกับอีกต่อไป — ใช้ "ปิดใช้งาน" แทน สาขาจะหายจากปุ่มในบอทแต่ประวัติยังอ่านได้ครบ`
            : null
        }
      />
    </div>
  );
}

function RowButton({
  onClick,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // min-h 36px + px-3 — เล็กกว่านี้แล้วกดพลาดบนมือถือ (ปุ่มติดกัน 3 ปุ่ม)
      className={`min-h-[2.25rem] rounded-lg border border-line px-3 text-xs text-muted transition disabled:opacity-40 ${
        danger
          ? "hover:border-rose-400/40 hover:text-rose-300"
          : "hover:border-cyan-400/40 hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}

function BranchFormModal({
  editing,
  companies,
  onClose,
  onSaved,
}: {
  editing: Editing;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const branch = editing?.mode === "edit" ? editing.branch : null;

  // key = id ของสาขาที่กำลังแก้ ทำให้ React สร้าง form ใหม่ทุกครั้งที่เปลี่ยนแถว
  // ไม่งั้นค่า defaultValue จะค้างเป็นของแถวที่เปิดครั้งแรก (uncontrolled input ไม่อ่าน default ซ้ำ)
  const formKey = branch?.id ?? "new";

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = branch
        ? await updateBranchAction(branch.id, {
            name: String(formData.get("name") ?? ""),
            group: String(formData.get("group") ?? ""),
            floor: String(formData.get("floor") ?? ""),
            area_manager: String(formData.get("area_manager") ?? ""),
            sale_manager: String(formData.get("sale_manager") ?? ""),
          })
        : await createBranchAction({}, formData);
      if (result.error) setError(result.error);
      else onSaved();
    });
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={branch ? "แก้ไขสาขา" : "เพิ่มสาขา"}
      description={
        branch
          ? `${companies.find((c) => c.code === branch.company)?.name ?? branch.company} — ย้ายบริษัทไม่ได้`
          : "สาขาที่เพิ่มจะโผล่ในปุ่มเลือกสาขาของบอททันที"
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
            ยกเลิก
          </Button>
          <Button type="submit" form="branch-form" disabled={isPending} className="w-full sm:w-auto">
            {isPending ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </>
      }
    >
      <form id="branch-form" key={formKey} action={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field label="บริษัท" required className="sm:col-span-2">
          {branch ? (
            // ย้ายสาขาข้ามบริษัทไม่ได้: ticket เก่าบันทึกบริษัทไว้แล้ว ถ้าย้ายจะขัดกับ master data
            // ต้องปิดสาขาเดิมแล้วสร้างใหม่ในบริษัทที่ถูก ประวัติจึงยังอ่านได้ถูกต้อง
            <input
              value={companies.find((c) => c.code === branch.company)?.name ?? branch.company}
              disabled
              className={`${MODAL_INPUT} opacity-60`}
            />
          ) : (
            <select name="company" required defaultValue="" className={MODAL_INPUT}>
              <option value="" disabled>
                -- เลือกบริษัท --
              </option>
              {companies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="ชื่อสาขา" required className="sm:col-span-2">
          <input
            name="name"
            required
            maxLength={100}
            defaultValue={branch?.name ?? ""}
            placeholder="เช่น เซ็นทรัล พระราม 9"
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="กลุ่ม / ทีม" hint="ใช้จัดชั้นเมนูเลือกสาขาในบอท">
          <input
            name="group"
            defaultValue={branch?.group ?? ""}
            placeholder="เช่น ภาคใต้ หรือ ทีม ปอ"
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="ชั้น" hint="เฉพาะสาขาในห้าง">
          <input
            name="floor"
            defaultValue={branch?.floor ?? ""}
            placeholder="G, 1, 2, M"
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="Area Manager">
          <input name="area_manager" defaultValue={branch?.area_manager ?? ""} className={MODAL_INPUT} />
        </Field>

        <Field label="Sale Manager">
          <input name="sale_manager" defaultValue={branch?.sale_manager ?? ""} className={MODAL_INPUT} />
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
