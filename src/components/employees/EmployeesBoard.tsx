"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Company, User } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { Pagination, usePaginated } from "@/components/ui/Pagination";
import { ConfirmDialog, Field, MODAL_INPUT, Modal } from "@/components/ui/Modal";
import {
  createEmployeeAction,
  deleteEmployeeAction,
  toggleEmployeeAction,
  unlinkEmployeeLineAction,
  updateEmployeeAction,
} from "@/app/actions/employees";

const CONTROL =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";

type Editing = { mode: "new" } | { mode: "edit"; employee: User } | null;

/** ฝ่ายของพนักงาน 1 คนแบบที่เอาไปแสดงได้เลย — คนที่ HR ยังไม่จัดฝ่ายให้จะขึ้นเป็น "อื่นๆ"
 *  อยู่นอกคอมโพเนนต์เพราะถูกใช้ใน useMemo ถ้านิยามข้างในจะกลายเป็นฟังก์ชันใหม่ทุก render
 *  แล้ว memo จะคำนวณใหม่ทุกครั้งโดยไม่ได้อะไรกลับมา (ตรงกับที่ eslint เตือน) */
function departmentOf(user: User, fallback: string): string {
  return user.department?.trim() || fallback;
}

/** หน้าทะเบียนพนักงาน
 *
 *  ทำไมต้องมี: ทะเบียนคือที่มาของ "ผู้แจ้ง" ทุกเรื่องที่เข้ามาทาง LINE ถ้าไม่มีที่แก้
 *  การย้ายฝ่าย 1 คนหรือรับพนักงานใหม่ 1 คนต้องรอแก้ไฟล์ seed แล้ว deploy ใหม่ทั้งระบบ
 *  ซึ่งในบริษัทที่มีพนักงาน 326 คนเกิดสัปดาห์ละหลายครั้ง
 *
 *  รายชื่อ 193 คนจาก HR ยังไม่ถูกจัดฝ่าย (ขึ้นเป็น "อื่นๆ") — หน้านี้คือที่ที่ค่อยๆ เติมให้ครบ
 */
export function EmployeesBoard({
  employees,
  companies,
  departments,
  otherDepartment,
  ticketCounts,
  assetCounts,
}: {
  employees: User[];
  companies: Company[];
  departments: string[];
  otherDepartment: string;
  ticketCounts: Record<string, number>;
  assetCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  const deptOf = (u: User) => departmentOf(u, otherDepartment);

  const visible = useMemo(() => {
    // ตัดช่องว่างทั้งหมดก่อนเทียบ เพราะคนพิมพ์ชื่อไทยเว้นวรรคไม่เหมือนกัน
    // ("ธนากร โฮงทอง" / "ธนากรโฮงทอง") — เหมือนที่ฝั่งบอททำใน ai._normalize_search
    const q = search.replace(/\s+/g, "").toLowerCase();
    return employees
      .filter((u) => {
        if (!showInactive && u.active === false) return false;
        if (deptFilter !== "all" && departmentOf(u, otherDepartment) !== deptFilter) return false;
        if (linkedOnly && !u.line_user_id) return false;
        if (!q) return true;
        const hay = [u.display_name, u.nickname, u.employee_id, u.position]
          .filter(Boolean)
          .join("")
          .replace(/\s+/g, "")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => a.display_name.localeCompare(b.display_name, "th"));
  }, [employees, search, deptFilter, linkedOnly, showInactive, otherDepartment]);

  const pager = usePaginated(visible, {
    storageKey: "employees",
    resetOn: `${search}:${deptFilter}:${linkedOnly}:${showInactive}`,
  });

  const stats = useMemo(() => {
    const active = employees.filter((u) => u.active !== false);
    return {
      total: active.length,
      linked: active.filter((u) => u.line_user_id).length,
      unassigned: active.filter((u) => !u.department?.trim()).length,
    };
  }, [employees]);

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

  const usedCountOf = (u: User) => (ticketCounts[u.id] ?? 0) + (assetCounts[u.id] ?? 0);
  const companyNameOf = (code: string | null | undefined) =>
    code ? companies.find((c) => c.code === code)?.name ?? code : "-";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="พนักงาน"
        description='ทะเบียนที่บอทใช้ถาม "ผู้แจ้งคือใคร" — ปิดใช้งานแล้วจะหายจากเมนูเลือกผู้แจ้งทันที'
        actions={<Button onClick={() => setEditing({ mode: "new" })}>+ เพิ่มพนักงาน</Button>}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatChip label="พนักงานทั้งหมด" value={stats.total} />
        <StatChip label="ผูกบัญชี LINE แล้ว" value={stats.linked} />
        <StatChip label="ยังไม่ระบุฝ่าย" value={stats.unassigned} />
      </div>

      {error && (
        <p className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อ, ชื่อเล่น, รหัสพนักงาน, ตำแหน่ง..."
          className={`${CONTROL} w-full sm:w-80`}
        />
        <select
          aria-label="ฝ่าย"
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className={CONTROL}
        >
          <option value="all">ทุกฝ่าย</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={linkedOnly}
            onChange={(e) => setLinkedOnly(e.target.checked)}
          />
          เฉพาะที่ผูก LINE แล้ว
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          แสดงคนที่ปิดใช้งาน
        </label>
      </div>

      {/* มือถือ = การ์ดต่อคน · จอใหญ่ = ตาราง
          เหตุผลเดียวกับหน้าสาขา: ปุ่มจัดการอยู่คอลัมน์ขวาสุด ถ้าใช้ตารางเลื่อนแนวนอน
          คนใช้มือถือต้องปัดไปจนสุดทุกแถวกว่าจะกดแก้ไขได้ ซึ่งเป็นงานหลักของหน้านี้ */}
      <div className="flex flex-col gap-2 lg:hidden">
        {pager.items.map((u) => (
          <div
            key={u.id}
            className={`rounded-2xl border border-line bg-surface p-4 ${
              u.active === false ? "opacity-60" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  {u.title ?? ""}
                  {u.display_name}
                  {u.nickname ? <span className="text-muted"> ({u.nickname})</span> : null}
                  {u.active === false && <Tag>ปิดใช้งาน</Tag>}
                  {u.line_user_id && <Tag tone="accent">LINE</Tag>}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {u.employee_id ? <span className="font-num">{u.employee_id}</span> : "ไม่มีรหัส"}
                  {" · "}
                  {deptOf(u)}
                  {u.company ? ` · ${companyNameOf(u.company)}` : ""}
                </p>
                {u.position ? (
                  <p className="mt-0.5 text-xs text-muted/80">{u.position}</p>
                ) : null}
              </div>
              <span className="shrink-0 whitespace-nowrap text-right text-xs leading-5 text-muted">
                <span className="font-num text-ink">{ticketCounts[u.id] ?? 0}</span> เรื่อง
                <span className="block opacity-70">
                  <span className="font-num">{assetCounts[u.id] ?? 0}</span> ชิ้น
                </span>
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <RowActions
                employee={u}
                pending={isPending}
                onEdit={() => setEditing({ mode: "edit", employee: u })}
                onToggle={() => run(() => toggleEmployeeAction(u.id, u.active === false))}
                onUnlink={() => run(() => unlinkEmployeeLineAction(u.id))}
                onDelete={() => setDeleting(u)}
              />
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
            ไม่พบพนักงานที่ตรงกับเงื่อนไข
          </p>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface lg:block">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead>
            {/* กำหนดความกว้างให้คอลัมน์ที่ "ต้องอ่านเร็ว" (ชื่อ/ฝ่าย) ไม่ให้ถูกบีบจนตัดกลางคำ
                โดยไม่ใช้ whitespace-nowrap — เคยลองแล้วคอลัมน์ตำแหน่งที่เป็นอังกฤษยาวๆ
                ถูกบีบเหลือคำละบรรทัดแทน คือย้ายปัญหาไปอีกคอลัมน์เฉยๆ */}
            <tr className="border-b border-line text-xs text-muted">
              <th className="w-[6.5rem] px-4 py-3">รหัส</th>
              <th className="min-w-[13rem] px-4 py-3">ชื่อ-นามสกุล</th>
              <th className="min-w-[10.5rem] px-4 py-3">ฝ่าย</th>
              <th className="min-w-[11rem] px-4 py-3">ตำแหน่ง</th>
              <th className="w-[5.5rem] px-4 py-3">LINE</th>
              {/* ย่อหัวคอลัมน์เป็น "เรื่อง / ชิ้น" ให้พอดีความกว้างที่เหลือ — ตัวเลขในช่องอ่านเป็น
                  "จำนวนเรื่องที่แจ้ง / จำนวนทรัพย์สินที่ถืออยู่" ซึ่งบอกตัวเองได้อยู่แล้ว */}
              <th className="w-[6.5rem] px-4 py-3">เรื่อง / ชิ้น</th>
              <th className="px-4 py-3 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((u) => (
              <tr
                key={u.id}
                className={`border-b border-line/60 last:border-0 ${
                  u.active === false ? "opacity-50" : ""
                }`}
              >
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {u.employee_id ?? "-"}
                </td>
                <td className="px-4 py-3 font-medium text-ink">
                  {u.title ?? ""}
                  {u.display_name}
                  {u.nickname ? <span className="text-muted"> ({u.nickname})</span> : null}
                  {u.active === false && <Tag>ปิดใช้งาน</Tag>}
                </td>
                <td className="px-4 py-3 text-muted">{deptOf(u)}</td>
                <td className="px-4 py-3 text-muted">
                  {u.position ?? "-"}
                  {u.level ? <span className="block text-xs opacity-70">{u.level}</span> : null}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {u.line_user_id ? (
                    <span className="text-accent">ผูกแล้ว</span>
                  ) : (
                    <span className="text-muted/60">-</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-num text-muted">
                  {ticketCounts[u.id] ?? 0} / {assetCounts[u.id] ?? 0}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <div className="inline-flex gap-1.5">
                    <RowActions
                      employee={u}
                      pending={isPending}
                      onEdit={() => setEditing({ mode: "edit", employee: u })}
                      onToggle={() => run(() => toggleEmployeeAction(u.id, u.active === false))}
                      onUnlink={() => run(() => unlinkEmployeeLineAction(u.id))}
                      onDelete={() => setDeleting(u)}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  ไม่พบพนักงานที่ตรงกับเงื่อนไข
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination pager={pager} unitLabel="คน" />

      <EmployeeFormModal
        editing={editing}
        companies={companies}
        departments={departments}
        otherDepartment={otherDepartment}
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
          deleting && run(() => deleteEmployeeAction(deleting.id), () => setDeleting(null))
        }
        pending={isPending}
        title="ลบพนักงาน"
        message={
          deleting ? (
            <>
              ต้องการลบ <span className="font-semibold">{deleting.display_name}</span> ออกจากทะเบียนใช่ไหม
            </>
          ) : null
        }
        blockedReason={
          deleting && usedCountOf(deleting) > 0
            ? `คนนี้มี ${ticketCounts[deleting.id] ?? 0} เรื่องที่แจ้งไว้ และถือทรัพย์สินอยู่ ${assetCounts[deleting.id] ?? 0} ชิ้น ลบแล้วประวัติจะอ้างถึงคนที่ไม่มีตัวตน — ใช้ "ปิดใช้งาน" แทน คนนี้จะหายจากเมนูในบอทแต่ประวัติยังอ่านได้ครบ`
            : null
        }
      />
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted">
      {label} · <span className="font-num text-ink">{value}</span>
    </span>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "accent" }) {
  return (
    <span
      className={`ml-2 rounded-full px-2 py-0.5 text-[0.65rem] ${
        tone === "accent" ? "bg-accent-bg text-accent" : "bg-white/[0.06] text-muted"
      }`}
    >
      {children}
    </span>
  );
}

function RowActions({
  employee,
  pending,
  onEdit,
  onToggle,
  onUnlink,
  onDelete,
}: {
  employee: User;
  pending: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onUnlink: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <RowButton onClick={onEdit} disabled={pending}>
        แก้ไข
      </RowButton>
      {employee.line_user_id ? (
        <RowButton onClick={onUnlink} disabled={pending}>
          ถอด LINE
        </RowButton>
      ) : null}
      <RowButton onClick={onToggle} disabled={pending}>
        {employee.active === false ? "เปิดใช้งาน" : "ปิดใช้งาน"}
      </RowButton>
      <RowButton onClick={onDelete} disabled={pending} danger>
        ลบ
      </RowButton>
    </>
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

function EmployeeFormModal({
  editing,
  companies,
  departments,
  otherDepartment,
  onClose,
  onSaved,
}: {
  editing: Editing;
  companies: Company[];
  departments: string[];
  otherDepartment: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const employee = editing?.mode === "edit" ? editing.employee : null;

  // key = id ของคนที่กำลังแก้ ทำให้ React สร้าง form ใหม่ทุกครั้งที่เปลี่ยนแถว
  // ไม่งั้นค่า defaultValue จะค้างเป็นของแถวที่เปิดครั้งแรก (uncontrolled input ไม่อ่าน default ซ้ำ)
  const formKey = employee?.id ?? "new";
  // ฝ่ายจริงเท่านั้นที่เลือกได้ — "อื่นๆ" คือถังของคนที่ยังไม่ถูกจัด ไม่ใช่ฝ่ายที่ตั้งเองได้
  const selectable = departments.filter((d) => d !== otherDepartment);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = employee
        ? await updateEmployeeAction(employee.id, formData)
        : await createEmployeeAction({}, formData);
      if (result.error) setError(result.error);
      else onSaved();
    });
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={employee ? "แก้ไขข้อมูลพนักงาน" : "เพิ่มพนักงาน"}
      description={
        employee
          ? employee.line_user_id
            ? "ผูกบัญชี LINE ไว้แล้ว — แก้ชื่อตรงนี้จะมีผลกับเรื่องที่แจ้งครั้งต่อไปทันที"
            : "ยังไม่ผูกบัญชี LINE — จะผูกเองตอนคนนี้แจ้งเรื่องผ่านบอทครั้งแรก"
          : "คนที่เพิ่มจะค้นเจอในบอททันทีที่ cache ทะเบียนหมดอายุ (ไม่เกิน 5 นาที)"
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
            ยกเลิก
          </Button>
          <Button
            type="submit"
            form="employee-form"
            disabled={isPending}
            className="w-full sm:w-auto"
          >
            {isPending ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </>
      }
    >
      <form
        id="employee-form"
        key={formKey}
        action={handleSubmit}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label="คำนำหน้า">
          <select name="title" defaultValue={employee?.title ?? ""} className={MODAL_INPUT}>
            <option value="">-</option>
            {["นาย", "นาง", "นางสาว"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="ชื่อเล่น" hint="ใช้ค้นหาในบอทได้ และแม่นกว่าชื่อจริงในหลายกรณี">
          <input
            name="nickname"
            maxLength={40}
            defaultValue={employee?.nickname ?? ""}
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="ชื่อ-นามสกุล" required className="sm:col-span-2">
          <input
            name="display_name"
            required
            maxLength={120}
            defaultValue={employee?.display_name ?? ""}
            placeholder="เช่น ธนากร โฮงทอง"
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="รหัสพนักงาน" hint="กุญแจที่ใช้ซิงก์กับทะเบียนของ HR — ห้ามซ้ำ">
          <input
            name="employee_id"
            maxLength={40}
            defaultValue={employee?.employee_id ?? ""}
            placeholder="A69048"
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="ฝ่าย">
          <select
            name="department"
            defaultValue={employee?.department ?? ""}
            className={MODAL_INPUT}
          >
            <option value="">ยังไม่ระบุ ({otherDepartment})</option>
            {selectable.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>

        <Field label="ตำแหน่ง">
          <input
            name="position"
            maxLength={120}
            defaultValue={employee?.position ?? ""}
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="ระดับ" hint="ตามผังองค์กร เช่น DM-2, SF-2">
          <input
            name="level"
            maxLength={20}
            defaultValue={employee?.level ?? ""}
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="บริษัท">
          <select name="company" defaultValue={employee?.company ?? ""} className={MODAL_INPUT}>
            <option value="">-</option>
            {companies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="อีเมล">
          <input
            name="email"
            type="email"
            maxLength={120}
            defaultValue={employee?.email ?? ""}
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
