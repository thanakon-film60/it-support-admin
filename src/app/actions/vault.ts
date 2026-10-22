"use server";

// Server Action ของหน้า "รหัสผ่าน" (/passwords)
//
// ด่านของทุก action เรียงตามนี้เสมอ:
//   1. requireSession("passwords") — ล็อกอินอยู่ และได้รับสิทธิ์หน้านี้ (ไม่มี = เด้ง /no-access)
//   2. หน้านี้ใช้ได้ไหม — ปิดล็อกอินอยู่ (AUTH_DISABLED) หรือยังไม่ได้ตั้ง VAULT_KEY = ปฏิเสธ
//   3. ปลดล็อกอยู่ไหม (ใส่รหัสผ่านตัวเองซ้ำภายใน 15 นาที) — ทุกอย่างยกเว้นการปลดล็อกเอง
// การดู/คัดลอก/แก้/ลบ/นำเข้า/ส่งออก ทุกครั้งถูกบันทึกในประวัติ (ใคร · ทำอะไร · กับรายการไหน · เมื่อไหร่)

import { revalidatePath } from "next/cache";
import { requireSession, type SessionPayload } from "@/lib/auth";
import { CollectionReadError } from "@/lib/db/store";
import {
  appendVaultAudit,
  createVaultEntry,
  deleteVaultEntry,
  exportVaultEntries,
  getVaultSecret,
  importVaultEntries,
  updateVaultEntry,
} from "@/lib/db/vault";
import { VaultDecryptError, VaultKeyError } from "@/lib/vault/crypto";
import { lockVault, unlockVault, vaultBlockedState, vaultUnlockedUntil } from "@/lib/vault/unlock";
import {
  checkVaultInput,
  checkVaultSecret,
  parseVaultGrids,
  sanitizeVaultGrids,
  vaultExportGrids,
  VaultImportError,
  VAULT_IMPORT_MAX_ENTRIES,
  type VaultGrid,
  type VaultInput,
} from "@/lib/vault-shared";

export interface VaultActionResult {
  error?: string;
  /** true = หมดเวลาปลดล็อกแล้ว หน้าเว็บควรรีเฟรชไปหน้าล็อก */
  locked?: boolean;
}

const writerOf = (session: SessionPayload) => session.displayName?.trim() || session.username;

function audit(session: SessionPayload, action: Parameters<typeof appendVaultAudit>[0]["action"], extra: {
  entry_id?: string | null; label?: string | null; detail?: string | null;
} = {}) {
  appendVaultAudit({ staff_id: session.staffId, staff_name: writerOf(session), action, ...extra });
}

/** แปลง error เป็นข้อความที่บอกผู้ใช้ว่าต้องทำอะไรต่อ — ห้ามมีข้อมูลลับในข้อความ (ไปโผล่บนหน้าจอ) */
function failure(err: unknown, action: string): VaultActionResult {
  if (err instanceof VaultDecryptError) {
    console.error(`[vault] ${action}: ถอดรหัสไม่ได้`);
    return { error: "ถอดรหัสข้อมูลเดิมไม่ได้ — VAULT_KEY ใน .env ไม่ตรงกับที่ใช้ตอนบันทึก จึงยังไม่เขียนอะไรทับ (ใส่กุญแจเดิมกลับแล้ว deploy ใหม่)" };
  }
  if (err instanceof VaultKeyError) return { error: err.message };
  if (err instanceof CollectionReadError) {
    console.error(`[vault] ${action}: ไฟล์ข้อมูลอ่านไม่ออก`);
    return { error: "อ่านไฟล์ข้อมูลรหัสผ่าน (data/vault.json) ไม่ออก จึงยังไม่บันทึกทับ — กู้ไฟล์จาก backup ก่อน" };
  }
  // ไม่ log ตัว error เต็มๆ — stack/ข้อความของบางไลบรารีอาจมีค่าที่ส่งเข้ามา (เช่นรหัสผ่าน)
  console.error(`[vault] ${action}ไม่สำเร็จ`, err instanceof Error ? err.name : typeof err);
  return { error: `${action}ไม่สำเร็จ — ลองอีกครั้ง` };
}

/** ด่าน 2 + 3 — คืน null เมื่อผ่าน */
async function gate(session: SessionPayload): Promise<VaultActionResult | null> {
  const blocked = vaultBlockedState(session);
  if (blocked) {
    return { error: blocked.status === "no_key" ? blocked.problem : "หน้ารหัสผ่านใช้ได้เฉพาะตอนเปิดระบบล็อกอิน (AUTH_DISABLED=false)" };
  }
  if (!(await vaultUnlockedUntil(session))) {
    return { error: "หมดเวลาปลดล็อกแล้ว — ใส่รหัสผ่านอีกครั้ง", locked: true };
  }
  return null;
}

export async function unlockVaultAction(password: string): Promise<VaultActionResult & { until?: number }> {
  const session = await requireSession("passwords");
  try {
    const result = await unlockVault(session, password);
    if (!result.ok) {
      if (result.failed) audit(session, "unlock_failed");
      return { error: result.error };
    }
    audit(session, "unlock");
    revalidatePath("/passwords");
    return { until: result.until };
  } catch (err) {
    return failure(err, "ปลดล็อก");
  }
}

export async function lockVaultAction(): Promise<VaultActionResult> {
  const session = await requireSession("passwords");
  await lockVault();
  try {
    if (!vaultBlockedState(session)) audit(session, "lock");
  } catch {
    // บันทึกประวัติไม่ได้ก็ต้องล็อกให้ได้ — ล็อกคือทางที่ปลอดภัยกว่าเสมอ
  }
  revalidatePath("/passwords");
  return {};
}

/** purpose: view = กดดู · copy = กดคัดลอก (แยกในประวัติ เพราะคัดลอกแปลว่ารหัสออกไปนอกหน้าจอแล้ว) */
export async function revealVaultSecretAction(
  id: string,
  purpose: "view" | "copy"
): Promise<VaultActionResult & { secret?: string }> {
  const session = await requireSession("passwords");
  const denied = await gate(session);
  if (denied) return denied;
  if (typeof id !== "string" || !id) return { error: "ไม่พบรายการ" };
  try {
    const found = getVaultSecret(id);
    if (!found) return { error: "รายการนี้ถูกลบไปแล้ว (อาจลบจากอีกเครื่อง)" };
    // บันทึกก่อนส่งรหัสออกไป — ถ้าบันทึกไม่ได้ ต้องไม่ได้รหัส (ประวัติคือเงื่อนไขของการเปิดดู)
    audit(session, purpose === "copy" ? "copy" : "view", { entry_id: id, label: found.label });
    return { secret: found.secret };
  } catch (err) {
    return failure(err, "เปิดดูรหัส");
  }
}

type RawEntry = Partial<Record<keyof VaultInput, unknown>>;

export async function createVaultEntryAction(raw: RawEntry, secret: string): Promise<VaultActionResult & { id?: string }> {
  const session = await requireSession("passwords");
  const denied = await gate(session);
  if (denied) return denied;
  const checked = checkVaultInput(raw ?? {});
  if (!checked.ok) return { error: checked.error };
  const pw = checkVaultSecret(secret);
  if (!pw.ok) return { error: pw.error };
  try {
    const entry = createVaultEntry(checked.input, pw.secret, writerOf(session));
    audit(session, "create", { entry_id: entry.id, label: entry.name });
    revalidatePath("/passwords");
    return { id: entry.id };
  } catch (err) {
    return failure(err, "บันทึก");
  }
}

/** secret: null = คงรหัสเดิม · สตริง = ตั้งรหัสใหม่ (สตริงว่าง = รายการนี้ไม่มีรหัส) */
export async function updateVaultEntryAction(id: string, raw: RawEntry, secret: string | null): Promise<VaultActionResult> {
  const session = await requireSession("passwords");
  const denied = await gate(session);
  if (denied) return denied;
  if (typeof id !== "string" || !id) return { error: "ไม่พบรายการที่จะแก้" };
  const checked = checkVaultInput(raw ?? {});
  if (!checked.ok) return { error: checked.error };
  let nextSecret: string | undefined;
  if (secret !== null && secret !== undefined) {
    const pw = checkVaultSecret(secret);
    if (!pw.ok) return { error: pw.error };
    nextSecret = pw.secret;
  }
  try {
    const result = updateVaultEntry(id, checked.input, nextSecret, writerOf(session));
    if (!result) return { error: "รายการนี้ถูกลบไปแล้ว (อาจลบจากอีกเครื่อง)" };
    if (result.changed) {
      audit(session, "update", {
        entry_id: id,
        label: result.entry.name,
        detail: nextSecret !== undefined ? "เปลี่ยนรหัสผ่าน" : null,
      });
      revalidatePath("/passwords");
    }
    return {};
  } catch (err) {
    return failure(err, "บันทึกการแก้ไข");
  }
}

export async function deleteVaultEntryAction(id: string): Promise<VaultActionResult> {
  const session = await requireSession("passwords");
  const denied = await gate(session);
  if (denied) return denied;
  if (typeof id !== "string" || !id) return { error: "ไม่พบรายการที่จะลบ" };
  try {
    const label = deleteVaultEntry(id);
    // ลบไม่เจอ = ถูกลบจากอีกเครื่องไปแล้ว ผลที่ต้องการเป็นจริงอยู่แล้ว
    if (label !== null) audit(session, "delete", { entry_id: id, label });
    revalidatePath("/passwords");
    return {};
  } catch (err) {
    return failure(err, "ลบ");
  }
}

/** รับ "ตารางดิบ" จากไฟล์ที่หน้าเว็บเปิด แล้วอ่านซ้ำเองด้วยตัวอ่านเดียวกัน — ไม่เชื่อผลที่หน้าเว็บอ่านมา */
export async function importVaultAction(
  grids: VaultGrid[]
): Promise<VaultActionResult & { result?: { added: number; duplicates: number; problems: number } }> {
  const session = await requireSession("passwords");
  const denied = await gate(session);
  if (denied) return denied;
  let parsed;
  try {
    parsed = parseVaultGrids(sanitizeVaultGrids(grids));
  } catch (err) {
    if (err instanceof VaultImportError) return { error: err.message };
    return { error: "อ่านข้อมูลไฟล์ไม่ได้" };
  }
  if (parsed.entries.length === 0) return { error: "ไม่พบรายการที่นำเข้าได้ในไฟล์นี้ (ต้องมีหัวคอลัมน์ \"รหัสผ่าน\")" };
  if (parsed.entries.length > VAULT_IMPORT_MAX_ENTRIES) {
    return { error: `ไฟล์มี ${parsed.entries.length} รายการ เกินเพดาน ${VAULT_IMPORT_MAX_ENTRIES} — เลือกไฟล์ผิดหรือเปล่า` };
  }
  try {
    const result = importVaultEntries(parsed.entries, writerOf(session));
    audit(session, "import", { detail: `เพิ่ม ${result.added} · ซ้ำ ${result.duplicates} · แถวมีปัญหา ${parsed.problems.length}` });
    revalidatePath("/passwords");
    return { result: { ...result, problems: parsed.problems.length } };
  } catch (err) {
    return failure(err, "นำเข้า");
  }
}

/** ข้อมูลสำหรับไฟล์ Excel (หน้าเว็บสร้างไฟล์เอง) — ไฟล์ที่ได้ไม่เข้ารหัส จึงบันทึกประวัติทุกครั้ง */
export async function exportVaultAction(): Promise<VaultActionResult & { grids?: VaultGrid[]; count?: number }> {
  const session = await requireSession("passwords");
  const denied = await gate(session);
  if (denied) return denied;
  try {
    const rows = exportVaultEntries();
    audit(session, "export", { detail: `${rows.length} รายการ` });
    return { grids: vaultExportGrids(rows), count: rows.length };
  } catch (err) {
    return failure(err, "ส่งออก");
  }
}
