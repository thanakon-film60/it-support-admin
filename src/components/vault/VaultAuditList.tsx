"use client";

import { useMemo, useState } from "react";
import type { VaultAuditAction, VaultAuditView } from "@/lib/db/vault";
import { stampTH } from "@/lib/date-th";
import { CONTROL } from "./vault-ui";

const ACTION_LABEL: Record<VaultAuditAction, { text: string; tone: string }> = {
  unlock: { text: "ปลดล็อก", tone: "text-muted" },
  unlock_failed: { text: "ใส่รหัสปลดล็อกผิด", tone: "text-rose-300" },
  lock: { text: "ล็อก", tone: "text-muted" },
  view: { text: "ดูรหัส", tone: "text-amber-200" },
  copy: { text: "คัดลอกรหัส", tone: "text-amber-200" },
  create: { text: "เพิ่ม", tone: "text-emerald-300" },
  update: { text: "แก้ไข", tone: "text-cyan-300" },
  delete: { text: "ลบ", tone: "text-rose-300" },
  import: { text: "นำเข้าไฟล์", tone: "text-cyan-300" },
  export: { text: "ส่งออก Excel", tone: "text-rose-300" },
};

type Filter = "all" | "secret" | "change" | "access";

const FILTERS: { key: Filter; label: string; actions: VaultAuditAction[] | null }[] = [
  { key: "all", label: "ทั้งหมด", actions: null },
  { key: "secret", label: "ดู/คัดลอก/ส่งออก", actions: ["view", "copy", "export"] },
  { key: "change", label: "เพิ่ม/แก้/ลบ/นำเข้า", actions: ["create", "update", "delete", "import"] },
  { key: "access", label: "ปลดล็อก/ล็อก", actions: ["unlock", "unlock_failed", "lock"] },
];

/** ประวัติการเข้าถึง — ตอบคำถาม "ใครเปิดดูรหัสอะไรไปเมื่อไหร่" ได้ทันที (เช่นตอนต้องตัดสินใจว่ารหัสไหนต้องเปลี่ยน
 *  หลังพนักงานลาออก) · ข้อมูลมาจากเซิร์ฟเวอร์ แก้/ลบจากหน้าเว็บไม่ได้ */
export function VaultAuditList({ rows }: { rows: VaultAuditView[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);
  const visible = useMemo(() => {
    const allowed = FILTERS.find((f) => f.key === filter)?.actions;
    return allowed ? rows.filter((r) => allowed.includes(r.action)) : rows;
  }, [rows, filter]);
  const shown = expanded ? visible : visible.slice(0, 15);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">ประวัติการเข้าถึง</h2>
        <select aria-label="กรองประวัติ" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className={CONTROL}>
          {FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">ยังไม่มีประวัติ</p>
      ) : (
        <ul className="divide-y divide-line/60 text-sm">
          {shown.map((r) => {
            const a = ACTION_LABEL[r.action] ?? { text: r.action, tone: "text-muted" };
            return (
              <li key={r.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="shrink-0 font-num text-xs text-muted sm:w-36">{stampTH(r.at)}</span>
                <span className="shrink-0 text-ink sm:w-40 sm:truncate">{r.staff_name}</span>
                <span className={`shrink-0 sm:w-32 ${a.tone}`}>{a.text}</span>
                <span className="min-w-0 break-words text-muted">
                  {r.label ?? ""}
                  {r.detail ? <span className="opacity-80">{r.label ? " · " : ""}{r.detail}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {visible.length > 15 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="self-start text-xs text-accent hover:underline">
          {expanded ? "ย่อ" : `แสดงทั้งหมด ${visible.length} รายการ`}
        </button>
      )}
    </section>
  );
}
