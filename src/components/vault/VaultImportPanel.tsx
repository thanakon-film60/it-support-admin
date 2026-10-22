"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { importVaultAction } from "@/app/actions/vault";
import {
  VAULT_CATEGORY_INFO,
  VAULT_IMPORT_MAX_FILE_MB,
  parseCsv,
  parseVaultGrids,
  vaultDuplicateKey,
  type ParsedVaultImport,
  type VaultGrid,
} from "@/lib/vault-shared";
import { CATEGORY_BADGE, OFFLINE } from "./vault-ui";

/** CSV ที่บันทึกจาก Excel ภาษาไทยรุ่นเก่าเป็น ANSI (windows-874) ไม่ใช่ UTF-8
 *  ลอง UTF-8 แบบเข้มก่อน (เจอไบต์ที่ไม่ใช่ UTF-8 = โยน) แล้วค่อยถอยไป windows-874 — หัวคอลัมน์ไทยจะได้ไม่เพี้ยน */
function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-874").decode(buf);
  }
}

async function readGrids(file: File): Promise<VaultGrid[]> {
  const buf = await file.arrayBuffer();
  if (/\.csv$/i.test(file.name)) {
    return [{ name: file.name, first_row: 1, rows: parseCsv(decodeText(buf)) }];
  }
  // xlsx หนักหลายร้อย KB — โหลดตอนเลือกไฟล์ Excel เท่านั้น ไม่ติดมากับหน้าทุกครั้งที่เปิด
  // อ่านในเบราว์เซอร์ไม่ใช่ที่เซิร์ฟเวอร์: xlsx รุ่นที่มีใน npm มีช่องโหว่ตอนอ่านไฟล์ที่ถูกแต่งมา (ดู lib/employee-import.ts)
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  return wb.SheetNames.slice(0, 30).map((name) => {
    const ws = wb.Sheets[name];
    const firstRow = ws?.["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r + 1 : 1;
    const raw = ws ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "", blankrows: true }) : [];
    // ตัวเลขล้วน (เช่นรหัส Wi-Fi 8 หลัก) Excel เก็บเป็นตัวเลข — แปลงกลับเป็นข้อความตรงๆ ไม่ผ่านรูปแบบแสดงผล
    // (รูปแบบแสดงผลอาจเป็น 1.23E+11 แล้วรหัสเพี้ยนทั้งตัว)
    const rows = raw.map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? "" : String(c))) : []));
    return { name, first_row: firstRow, rows };
  });
}

export function VaultImportPanel({
  existingKeys,
  onClose,
  onDone,
  onLocked,
}: {
  existingKeys: Set<string>;
  onClose: () => void;
  onDone: (message: string) => void;
  onLocked: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [grids, setGrids] = useState<VaultGrid[] | null>(null);
  const [parsed, setParsed] = useState<ParsedVaultImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [isPending, startTransition] = useTransition();

  /** ล้างทุกอย่างที่อ่านจากไฟล์ — ในนั้นมีรหัสผ่านเป็นข้อความธรรมดา ไม่ควรค้างในหน้าเว็บหลังใช้เสร็จ */
  function reset() {
    setFileName(null);
    setGrids(null);
    setParsed(null);
    setError(null);
    if (input.current) input.current.value = "";
  }

  async function pick(file: File | undefined) {
    reset();
    if (!file) return;
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setError("รองรับเฉพาะไฟล์ .csv หรือ .xlsx — ไฟล์ .xls ให้เปิดใน Excel แล้วบันทึกเป็น .xlsx ก่อน");
      return;
    }
    if (file.size > VAULT_IMPORT_MAX_FILE_MB * 1024 * 1024) {
      setError(`ไฟล์ใหญ่เกิน ${VAULT_IMPORT_MAX_FILE_MB} MB — ไฟล์รหัสผ่านจริงมีไม่กี่ KB เลือกไฟล์ผิดหรือเปล่า`);
      return;
    }
    setReading(true);
    setFileName(file.name);
    try {
      const g = await readGrids(file);
      const result = parseVaultGrids(g);
      if (result.entries.length === 0) {
        setError("ไม่พบรายการในไฟล์นี้ — ต้องมีแถวหัวคอลัมน์ที่มี \"ลำดับที่\" หรือ \"ชื่อรายการ\" และ \"รหัสผ่าน\"");
        return;
      }
      setGrids(g);
      setParsed(result);
    } catch {
      setError("เปิดไฟล์ไม่ได้ — ไฟล์อาจเสียหรือติดรหัสผ่าน (บันทึกใหม่แบบไม่ใส่รหัส)");
    } finally {
      setReading(false);
    }
  }

  // ตัวอย่างฝั่งหน้าเว็บ: ซ้ำกับที่มีอยู่ หรือซ้ำกันเองในไฟล์ = ข้าม (เซิร์ฟเวอร์ตัดสินซ้ำอีกรอบตอนบันทึกจริง)
  const preview = useMemo(() => {
    if (!parsed) return null;
    const seen = new Set(existingKeys);
    return parsed.entries.map((e) => {
      const key = vaultDuplicateKey(e.input);
      const duplicate = seen.has(key);
      seen.add(key);
      return { ...e, duplicate };
    });
  }, [parsed, existingKeys]);
  const newCount = preview?.filter((p) => !p.duplicate).length ?? 0;
  const dupCount = (preview?.length ?? 0) - newCount;

  function confirm() {
    if (!grids || isPending) return;
    setError(null);
    startTransition(async () => {
      let r;
      try {
        r = await importVaultAction(grids);
      } catch {
        r = { error: OFFLINE };
      }
      if (r.locked) {
        onLocked();
        return;
      }
      if (r.error || !r.result) {
        setError(r.error ?? "นำเข้าไม่สำเร็จ");
        return;
      }
      reset();
      onDone(
        `นำเข้าแล้ว ${r.result.added} รายการ` +
          (r.result.duplicates ? ` · ข้ามรายการที่มีอยู่แล้ว ${r.result.duplicates}` : "") +
          " — ลบไฟล์ต้นฉบับ (ไม่ได้เข้ารหัส) ออกจากเครื่องได้แล้ว"
      );
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">นำเข้าจากไฟล์ CSV / Excel</h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            รูปแบบเดียวกับไฟล์ &quot;Account and Password&quot; ของทีม (หลายตารางในชีตเดียวได้ — ระบบหาแถวหัวคอลัมน์ที่มี
            &quot;รหัสผ่าน&quot; เอง) · รายการที่ชื่อ + ชื่อผู้ใช้ซ้ำกับที่มีอยู่จะถูกข้าม ไม่เขียนทับ · ดูตัวอย่างก่อน ยังไม่บันทึกจนกว่าจะกดยืนยัน
          </p>
        </div>
        <button type="button" onClick={() => { reset(); onClose(); }} className="shrink-0 rounded-lg px-2 py-1 text-sm text-muted hover:text-ink" aria-label="ปิดการนำเข้า">
          ✕
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={reading || isPending} onClick={() => input.current?.click()}>
          {reading ? "กำลังอ่านไฟล์…" : "เลือกไฟล์ .csv / .xlsx"}
        </Button>
        {fileName && <span className="min-w-0 truncate text-sm text-muted">{fileName}</span>}
        <input
          ref={input}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>

      {error && <p role="alert" className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</p>}

      {parsed && preview && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {parsed.sections.map((s) => (
              <span key={`${s.sheet}:${s.row}:${s.title}`} className={`rounded-full px-2.5 py-1 ring-1 ring-inset ${CATEGORY_BADGE[s.category]}`}>
                {s.title} → {VAULT_CATEGORY_INFO[s.category].label} · {s.count}
              </span>
            ))}
          </div>
          <p className="text-sm text-ink">
            จะเพิ่ม <span className="font-num font-semibold text-emerald-300">{newCount}</span> รายการ
            {dupCount > 0 && (
              <>
                {" "}· ข้ามที่มีอยู่แล้ว <span className="font-num">{dupCount}</span>
              </>
            )}
            {parsed.problems.length > 0 && (
              <>
                {" "}· แถวที่มีปัญหา <span className="font-num text-amber-300">{parsed.problems.length}</span>
              </>
            )}
          </p>

          {parsed.problems.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs text-amber-200">
              {parsed.problems.slice(0, 50).map((p, i) => (
                <li key={i}>
                  {p.sheet} แถว {p.row}: {p.message}
                </li>
              ))}
            </ul>
          )}

          {/* ตัวอย่างไม่โชว์รหัสผ่าน — บอกแค่ว่ามีหรือไม่มี (คนที่ยืนดูจอข้างหลังไม่ควรได้รหัสจากหน้านี้) */}
          <div className="max-h-80 overflow-auto rounded-xl border border-line">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-xs text-muted">
                  <th className="px-3 py-2">แถว</th>
                  <th className="px-3 py-2">หมวด</th>
                  <th className="px-3 py-2">ชื่อ</th>
                  <th className="px-3 py-2">ชื่อผู้ใช้</th>
                  <th className="px-3 py-2">รหัส</th>
                  <th className="px-3 py-2">ผล</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={`${p.sheet}:${p.row}:${p.input.name}`} className={`border-b border-line/60 last:border-0 ${p.duplicate ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2 font-num text-muted">{p.row}</td>
                    <td className="px-3 py-2 text-muted">{VAULT_CATEGORY_INFO[p.input.category].label}</td>
                    <td className="px-3 py-2 text-ink">{p.input.name}</td>
                    <td className="px-3 py-2 text-muted">{p.input.username || "-"}</td>
                    <td className="px-3 py-2 text-muted">{p.secret ? "มี" : "-"}</td>
                    <td className="px-3 py-2 text-xs">{p.duplicate ? "มีอยู่แล้ว (ข้าม)" : <span className="text-emerald-300">ใหม่</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={reset} disabled={isPending}>
              เลือกไฟล์ใหม่
            </Button>
            <Button type="button" onClick={confirm} disabled={isPending || newCount === 0}>
              {isPending ? "กำลังนำเข้า…" : newCount === 0 ? "ไม่มีรายการใหม่" : `ยืนยันนำเข้า ${newCount} รายการ`}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
