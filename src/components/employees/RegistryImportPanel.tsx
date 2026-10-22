"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  importRegistryAction,
  previewRegistryAction,
  type RegistryPreview,
} from "@/app/actions/employees";
import {
  MAX_FILE_MB,
  parseRegistrySheets,
  RegistryError,
  type ParsedRegistry,
  type RawSheet,
} from "@/lib/employee-import";
import type { RegistryImportResult, RegistryPerson } from "@/lib/db/employees";

/** นำเข้าทะเบียนล่าสุดจาก HR (.xlsx) — เลือกไฟล์ → ดูผล (ยังไม่บันทึก) → ยืนยัน
 *
 *  อ่านไฟล์ในเบราว์เซอร์ (เหตุผลอยู่หัวไฟล์ lib/employee-import.ts) แล้วส่งแค่แถวข้อมูลไปเซิร์ฟเวอร์
 *  xlsx โหลดตอนเลือกไฟล์เท่านั้น — ไลบรารีหลายร้อย KB ไม่ต้องติดมากับหน้า /employees ทุกครั้งที่เปิด */
export function RegistryImportPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedRegistry | null>(null);
  const [preview, setPreview] = useState<RegistryPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [massOk, setMassOk] = useState(false);
  const [needMass, setNeedMass] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setFileName(null);
    setParsed(null);
    setPreview(null);
    setError(null);
    setMassOk(false);
    setNeedMass(false);
    if (input.current) input.current.value = ""; // เลือกไฟล์เดิมซ้ำได้ (onChange ยิงอีกครั้ง)
  }

  async function pick(file: File | undefined) {
    reset();
    setDone(null);
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setError("รองรับเฉพาะไฟล์ .xlsx — ไฟล์ .xls / .csv ให้เปิดใน Excel แล้วบันทึกเป็น .xlsx ก่อน");
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`ไฟล์ใหญ่เกิน ${MAX_FILE_MB} MB — ส่งเฉพาะทะเบียนพนักงาน`);
      return;
    }
    setReading(true);
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheets: RawSheet[] = wb.SheetNames.slice(0, 30).map((name) => {
        const ws = wb.Sheets[name];
        // เลขแถวต้องตรงกับ Excel: ช่วงข้อมูลอาจไม่เริ่มแถว 1 และต้องเก็บแถวว่างไว้ ไม่งั้นเลขแถวที่แจ้ง HR จะเลื่อน
        const firstRow = ws?.["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r + 1 : 1;
        const rows = ws
          ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true })
          : [];
        return { name, first_row: firstRow, rows };
      });
      const result = parseRegistrySheets(sheets);
      setParsed(result);
      if (result.rows.length === 0) {
        setError("ไม่มีรายชื่อที่ใช้ได้ในไฟล์นี้ — ดูแถวที่ถูกข้ามด้านล่าง");
        return;
      }
      const r = await previewRegistryAction(result.rows);
      if (r.error || !r.preview) setError(r.error ?? "ตรวจไฟล์ไม่สำเร็จ");
      else {
        setPreview(r.preview);
        setNeedMass(r.preview.mass);
      }
    } catch (e) {
      setError(e instanceof RegistryError ? e.message : "เปิดไฟล์ไม่ได้ — ไฟล์อาจเสียหรือติดรหัสผ่าน (บันทึกใหม่เป็น .xlsx แบบไม่ใส่รหัส)");
    } finally {
      setReading(false);
    }
  }

  function confirmImport() {
    if (!parsed) return;
    setError(null);
    startTransition(async () => {
      const r = await importRegistryAction(parsed.rows, needMass && massOk);
      if (r.error || !r.result) {
        // ข้อมูลในระบบเปลี่ยนหลังดูผล จนเข้าเกณฑ์ "ปิดจำนวนมาก" → ให้ติ๊กยืนยันก่อนกดอีกครั้ง
        if (r.needConfirm) {
          setNeedMass(true);
          setMassOk(false);
        }
        setError(r.error ?? "นำเข้าไม่สำเร็จ");
        return;
      }
      reset();
      setDone(summary(r.result));
      router.refresh();
    });
  }

  const c = preview?.counts;
  const keep = preview?.keep_prefixes.join(", ") ?? "";

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">นำเข้าทะเบียนล่าสุดจาก HR (.xlsx)</h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            อยู่ในไฟล์ → สถานะ 1 (ใช้งาน) · ไม่อยู่ในไฟล์ → สถานะ 0 (ปิดใช้งาน · ไม่ลบ) ยกเว้นกลุ่มรหัสพนักงานสาขา (คงเดิม)
            · ช่องว่างในไฟล์ = คงข้อมูลเดิม · ไม่แตะการผูก LINE · ระบบแสดงผลให้ตรวจก่อนบันทึกทุกครั้ง
          </p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-sm text-muted hover:text-ink" aria-label="ปิดการนำเข้า">
          ✕
        </button>
      </div>

      {done && <p className="rounded-lg bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">{done}</p>}

      {!preview && (
        <label
          className={`inline-flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-accent/45 hover:text-accent ${
            reading ? "pointer-events-none opacity-50" : ""
          }`}
        >
          {reading ? "กำลังอ่านไฟล์…" : "เลือกไฟล์ทะเบียน .xlsx"}
          <input
            ref={input}
            type="file"
            className="sr-only"
            disabled={reading}
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </label>
      )}

      {error && <p className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</p>}

      {parsed && (
        <p className="text-xs text-muted">
          {fileName && <span className="break-all font-medium text-ink">{fileName}</span>}
          {" — "}
          {parsed.sheets
            .map((s) => (s.header_row ? `ชีต ${s.name}: ${s.valid} คน${s.has_department ? "" : " (ไม่มีคอลัมน์ฝ่าย)"}` : `ชีต ${s.name}: ข้าม`))
            .join(" · ")}
          {preview ? " — ยังไม่บันทึก" : ""}
        </p>
      )}

      {preview && c && (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Count label="คนใหม่ (สถานะ 1)" value={c.inserted} />
            <Count label="แก้ข้อมูล" value={c.updated} hint={c.reactivated ? `ในนี้กลับมาเป็น 1: ${c.reactivated}` : `เท่าเดิม ${c.unchanged}`} />
            <Count label="จะเปลี่ยนเป็น 0" value={c.deactivate} hint="ไม่อยู่ในไฟล์" warn={c.deactivate > 0} />
            <Count label="คงสถานะเดิม" value={c.kept_missing} hint={keep ? `ไม่อยู่ในไฟล์ แต่เป็นกลุ่ม ${keep}` : "ไม่มีกลุ่มยกเว้น"} />
          </div>
          {c.kept_missing > 0 && (
            <p className="text-xs text-muted">
              คงสถานะเดิมตามกลุ่ม:{" "}
              {Object.entries(preview.kept_missing_by_prefix)
                .map(([k, n]) => `${k} ${n}`)
                .join(" · ")}{" "}
              (ทะเบียนชุดนี้ไม่มีพนักงานสาขา — ปิดใช้งานรายคนได้ในรายการด้านล่าง)
            </p>
          )}
          <People title="จะเปลี่ยนเป็น 0 (ปิดใช้งาน)" people={preview.deactivate} total={c.deactivate} open={c.deactivate <= 20} />
          <People title="คนใหม่" people={preview.inserted} total={c.inserted} />
          <People title="กลับมาเป็น 1" people={preview.reactivated} total={c.reactivated} />
          {c.ambiguous > 0 && (
            <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
              รหัสที่มีมากกว่า 1 คนในระบบ ({c.ambiguous}) — ระบบไม่เดาว่าคนไหน จึงข้ามไว้ แก้รหัสในรายการก่อนแล้วนำเข้าอีกครั้ง:{" "}
              {preview.ambiguous.join(", ")}
            </p>
          )}
          {preview.departments.unknown.length > 0 && (
            <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
              ชื่อฝ่ายที่ระบบไม่รู้จัก (คนกลุ่มนี้คงฝ่ายเดิม):{" "}
              {preview.departments.unknown.map((u) => `${u.value} (${u.count})`).join(" · ")}
            </p>
          )}
          {c.without_code > 0 && (
            <p className="text-xs text-muted">
              ในระบบมี {c.without_code} คนที่ไม่มีรหัสพนักงาน (เพิ่มเองจากหน้านี้) — จับคู่กับไฟล์ไม่ได้ จึงไม่แตะสถานะ
            </p>
          )}
        </>
      )}

      {parsed && parsed.problems.length > 0 && (
        <details className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
          <summary className="cursor-pointer font-medium">แถวที่จะถูกข้าม {parsed.problems.length} แถว (ไม่นำเข้า)</summary>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-xs">
            {parsed.problems.slice(0, 100).map((p) => (
              <li key={`${p.sheet}:${p.row}`}>
                ชีต {p.sheet} แถว {p.row}
                {p.code ? ` (${p.code})` : ""}: {p.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {preview && c && (
        <>
          {needMass && (
            <div className="rounded-xl border border-rose-400/40 p-3 text-sm">
              <p className="font-semibold text-rose-300">
                จะเปลี่ยน {c.deactivate} คนเป็นสถานะ 0 — เกิน 30% ของ {preview.active_in_scope} คนที่ใช้งานอยู่
              </p>
              <p className="text-xs text-muted">มักเกิดจากเลือกไฟล์ผิด (ไฟล์บริษัทเดียว / ไฟล์เก่า) — ดูรายชื่อด้านบนก่อน</p>
              <label className="mt-2 flex items-center gap-2 text-ink">
                <input type="checkbox" checked={massOk} onChange={(e) => setMassOk(e.target.checked)} />
                ตรวจแล้ว ไฟล์นี้คือทะเบียนล่าสุดจริง
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={confirmImport} disabled={isPending || (needMass && !massOk)}>
              {isPending ? "กำลังบันทึก..." : `ยืนยันนำเข้า${c.deactivate ? ` (เปลี่ยนเป็น 0: ${c.deactivate} คน)` : ""}`}
            </Button>
            <Button variant="outline" onClick={reset} disabled={isPending}>
              ยกเลิก
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function summary(r: RegistryImportResult): string {
  return [
    `นำเข้าแล้ว ${r.in_file} คน — ใหม่ ${r.inserted}`,
    `แก้ข้อมูล ${r.updated}`,
    `เท่าเดิม ${r.unchanged}`,
    `เปลี่ยนเป็น 0: ${r.deactivated}`,
    `คงสถานะเดิม (กลุ่มยกเว้น): ${r.kept_missing}`,
    ...(r.reactivated ? [`กลับมาเป็น 1: ${r.reactivated}`] : []),
    ...(r.ambiguous ? [`ข้ามรหัสซ้ำในระบบ ${r.ambiguous}`] : []),
  ].join(" · ");
}

function Count({ label, value, hint, warn }: { label: string; value: number; hint?: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${warn ? "border-amber-400/25 bg-amber-400/10" : "border-line"}`}>
      <p className={`text-xs ${warn ? "text-amber-300" : "text-muted"}`}>{label}</p>
      <p className="font-num text-xl font-semibold text-ink">{value}</p>
      {hint && <p className={`text-xs ${warn ? "text-amber-300" : "text-muted"}`}>{hint}</p>}
    </div>
  );
}

function People({ title, people, total, open }: { title: string; people: RegistryPerson[]; total: number; open?: boolean }) {
  if (!total) return null;
  return (
    <details open={open} className="rounded-xl border border-line px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-ink">
        {title} ({total})
      </summary>
      <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto text-muted">
        {people.map((p) => (
          <li key={p.employee_id}>
            <span className="font-num text-xs">{p.employee_id}</span> <span className="text-ink">{p.name}</span>
            {p.department ? ` · ${p.department}` : ""}
          </li>
        ))}
      </ul>
      {total > people.length && <p className="mt-1 text-xs text-muted">แสดง {people.length} จาก {total} คน</p>}
    </details>
  );
}
