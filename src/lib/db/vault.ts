// หน้า "รหัสผ่าน" (/passwords) — data/vault.json + ประวัติการเข้าถึง data/vault_audit.json
//
// ทุกช่องที่เป็นข้อมูลจริงถูกเข้ารหัส (ดู lib/vault/crypto.ts ว่าทำไม) แยกเป็น 2 ก้อนต่อแถว:
//   fields = ชื่อ · ชื่อผู้ใช้ · URL · GHz · Location · หมายเหตุ  → ถอดตอนโชว์รายการ
//   secret = รหัสผ่าน                                          → ถอด "เฉพาะ" ตอนกดดู/คัดลอก (ถูกบันทึกทุกครั้ง)
// แยกกันเพื่อให้โค้ดที่โชว์รายการไม่มีวันได้รหัสผ่านเป็นข้อความธรรมดาเลย — พลาดส่ง prop ผิดก็ไม่หลุด
//
// อ่านด้วย readCollectionStrict ทุกที่ (เหมือน notes.ts): ไฟล์เสีย = ไม่ยอมเขียนทับ ข้อมูลนี้สร้างคืนไม่ได้
// ก่อนเขียนทุกครั้งต้องถอดของเดิมได้ทั้งหมด (assertReadable) — กันกรณี VAULT_KEY ถูกเปลี่ยน แล้วรายการใหม่
// ถูกเข้ารหัสด้วยกุญแจใหม่ปนกับของเก่า ซึ่งจะทำให้ "ไม่มีกุญแจดอกไหนเปิดได้ครบ" อีกต่อไป

import { newId } from "../utils";
import { readCollectionStrict, writeCollection } from "./store";
import { decryptText, encryptText } from "../vault/crypto";
import { vaultDuplicateKey, type VaultCategory, type VaultInput } from "../vault-shared";

const COLLECTION = "vault";
const AUDIT_COLLECTION = "vault_audit";
/** ประวัติเก็บล่าสุดเท่านี้ — พอสำหรับย้อนดูหลายเดือน และไฟล์ไม่บวมจนอ่านช้า */
export const VAULT_AUDIT_LIMIT = 5000;

interface VaultRecord {
  id: string;
  category: VaultCategory;
  /** AES-GCM ของ JSON VaultFields — AAD "<id>:fields" */
  fields: string;
  /** AES-GCM ของรหัสผ่าน — AAD "<id>:secret" */
  secret: string;
  /** เก็บแยกเป็นค่าธรรมดา เพื่อให้หน้ารายการโชว์ •••• / "ไม่มีรหัส" ได้โดยไม่ต้องถอดรหัสผ่านเลย
   *  (รู้แค่ว่า "มีรหัสไหม" ไม่ได้ช่วยใครเดารหัส) */
  has_secret: boolean;
  created_at: string;
  created_by: string;
  updated_at: string | null;
  updated_by: string | null;
  secret_updated_at: string | null;
}

type VaultFields = Pick<VaultInput, "name" | "username" | "url" | "band" | "location" | "note">;

/** สิ่งที่หน้าเว็บได้รับ — ไม่มีรหัสผ่านโดยโครงสร้าง (มีแค่ "มีรหัสไหม") */
export interface VaultEntryView extends VaultFields {
  id: string;
  category: VaultCategory;
  has_secret: boolean;
  created_at: string;
  created_by: string;
  updated_at: string | null;
  updated_by: string | null;
  secret_updated_at: string | null;
}

export type VaultAuditAction =
  | "unlock" | "unlock_failed" | "lock" | "view" | "copy"
  | "create" | "update" | "delete" | "import" | "export";

export interface VaultAuditEntry {
  id: string;
  at: string;
  staff_id: string;
  staff_name: string;
  action: VaultAuditAction;
  entry_id: string | null;
  /** ชื่อรายการตอนเกิดเหตุ (เข้ารหัส — ชื่อระบบ/ชื่อ Wi-Fi ก็เป็นข้อมูลภายใน) อ่านได้แม้รายการถูกลบไปแล้ว */
  label: string | null;
  /** รายละเอียดสั้นๆ ที่ไม่ใช่ข้อมูลลับ เช่น "นำเข้า 32 · ซ้ำ 3" */
  detail: string | null;
}

export interface VaultAuditView extends Omit<VaultAuditEntry, "label"> {
  label: string | null;
}

const fieldsAad = (id: string) => `${id}:fields`;
const secretAad = (id: string) => `${id}:secret`;
const auditAad = (id: string) => `audit:${id}`;

function readRecords(): VaultRecord[] {
  return readCollectionStrict<VaultRecord>(COLLECTION);
}

function openFields(record: VaultRecord): VaultFields {
  const parsed = JSON.parse(decryptText(record.fields, fieldsAad(record.id))) as Partial<VaultFields>;
  return {
    name: parsed.name ?? "",
    username: parsed.username ?? "",
    url: parsed.url ?? "",
    band: parsed.band ?? "",
    location: parsed.location ?? "",
    note: parsed.note ?? "",
  };
}

function sealFields(id: string, input: VaultFields): string {
  const fields: VaultFields = {
    name: input.name, username: input.username, url: input.url,
    band: input.band, location: input.location, note: input.note,
  };
  return encryptText(JSON.stringify(fields), fieldsAad(id));
}

function toView(record: VaultRecord): VaultEntryView {
  const fields = openFields(record);
  return {
    id: record.id,
    category: record.category,
    ...fields,
    has_secret: record.has_secret === true,
    created_at: record.created_at,
    created_by: record.created_by,
    updated_at: record.updated_at,
    updated_by: record.updated_by,
    secret_updated_at: record.secret_updated_at ?? null,
  };
}

/** ถอดทุกแถวได้ไหม — ไม่ได้แม้แถวเดียว = กุญแจไม่ตรง/ไฟล์ถูกแก้ → โยน VaultDecryptError ห้ามเขียนต่อ */
function assertReadable(records: VaultRecord[]): void {
  for (const record of records) {
    decryptText(record.fields, fieldsAad(record.id));
    decryptText(record.secret, secretAad(record.id));
  }
}

/** ชื่อก่อน (เรียงแบบไทย) — หมวดเรียงตามแท็บอยู่แล้วที่หน้าเว็บ */
export function listVaultEntries(): VaultEntryView[] {
  return readRecords()
    .map(toView)
    .sort((a, b) => a.name.localeCompare(b.name, "th") || a.id.localeCompare(b.id));
}

export function countVaultEntries(): Record<VaultCategory, number> {
  const counts: Record<VaultCategory, number> = { account: 0, network: 0, wifi: 0, apple_id: 0 };
  for (const record of readRecords()) counts[record.category] = (counts[record.category] ?? 0) + 1;
  return counts;
}

/** null = ไม่พบรายการ (อาจถูกลบจากอีกเครื่อง) */
export function getVaultSecret(id: string): { secret: string; label: string } | null {
  const record = readRecords().find((r) => r.id === id);
  if (!record) return null;
  return { secret: decryptText(record.secret, secretAad(record.id)), label: openFields(record).name };
}

/** รายการทั้งหมดพร้อมรหัส — ใช้ตอนส่งออก Excel เท่านั้น (ผู้เรียกต้องบันทึกประวัติ "export" เสมอ) */
export function exportVaultEntries(): (VaultInput & { secret: string })[] {
  return readRecords()
    .map((record) => ({
      category: record.category,
      ...openFields(record),
      secret: decryptText(record.secret, secretAad(record.id)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "th"));
}

export function createVaultEntry(input: VaultInput, secret: string, by: string): VaultEntryView {
  const all = readRecords();
  assertReadable(all);
  const id = newId();
  const now = new Date().toISOString();
  const record: VaultRecord = {
    id,
    category: input.category,
    fields: sealFields(id, input),
    secret: encryptText(secret, secretAad(id)),
    has_secret: secret !== "",
    created_at: now,
    created_by: by,
    updated_at: null,
    updated_by: null,
    secret_updated_at: secret ? now : null,
  };
  writeCollection(COLLECTION, [...all, record]);
  return toView(record);
}

/** secret = undefined → คงรหัสเดิม (ฟอร์มแก้ไขไม่ส่งรหัสเดิมกลับมาที่หน้าเว็บเลย ช่องว่าง = ไม่เปลี่ยน)
 *  คืน null เมื่อไม่พบ · กดบันทึกโดยไม่ได้แก้อะไร = ไม่แตะไฟล์ ไม่ติดป้าย "แก้ไขแล้ว" */
export function updateVaultEntry(
  id: string,
  input: VaultInput,
  secret: string | undefined,
  by: string
): { entry: VaultEntryView; changed: boolean } | null {
  const all = readRecords();
  assertReadable(all);
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const old = all[idx];
  const oldFields = openFields(old);
  const oldSecret = decryptText(old.secret, secretAad(id));
  const fieldsChanged =
    old.category !== input.category ||
    (["name", "username", "url", "band", "location", "note"] as const).some((k) => oldFields[k] !== input[k]);
  const secretChanged = secret !== undefined && secret !== oldSecret;
  if (!fieldsChanged && !secretChanged) return { entry: toView(old), changed: false };
  const now = new Date().toISOString();
  const next: VaultRecord = {
    ...old,
    category: input.category,
    fields: sealFields(id, input),
    secret: secretChanged ? encryptText(secret as string, secretAad(id)) : old.secret,
    has_secret: secretChanged ? secret !== "" : old.has_secret === true,
    updated_at: now,
    updated_by: by,
    secret_updated_at: secretChanged ? now : old.secret_updated_at ?? null,
  };
  all[idx] = next;
  writeCollection(COLLECTION, all);
  return { entry: toView(next), changed: true };
}

/** คืนชื่อรายการที่ลบ (ไว้บันทึกประวัติ) หรือ null เมื่อไม่มีอยู่แล้ว */
export function deleteVaultEntry(id: string): string | null {
  const all = readRecords();
  const target = all.find((r) => r.id === id);
  if (!target) return null;
  const label = openFields(target).name;
  writeCollection(COLLECTION, all.filter((r) => r.id !== id));
  return label;
}

/** นำเข้าทีละหลายรายการ — รายการที่ "หมวด + ชื่อ + ชื่อผู้ใช้" ตรงกับที่มีอยู่แล้วถูกข้าม (ไม่เขียนทับ)
 *  นำเข้าไฟล์เดิมซ้ำจึงปลอดภัย และไม่มีรหัสผ่านไหนถูกแทนที่แบบไม่มีใครเห็น */
export function importVaultEntries(
  items: { input: VaultInput; secret: string }[],
  by: string
): { added: number; duplicates: number } {
  const all = readRecords();
  assertReadable(all);
  const existing = new Set(all.map((r) => vaultDuplicateKey({ category: r.category, ...openFields(r) })));
  const now = new Date().toISOString();
  let duplicates = 0;
  const added: VaultRecord[] = [];
  for (const item of items) {
    const key = vaultDuplicateKey(item.input);
    if (existing.has(key)) {
      duplicates++;
      continue;
    }
    existing.add(key);
    const id = newId();
    added.push({
      id,
      category: item.input.category,
      fields: sealFields(id, item.input),
      secret: encryptText(item.secret, secretAad(id)),
      has_secret: item.secret !== "",
      created_at: now,
      created_by: by,
      updated_at: null,
      updated_by: null,
      secret_updated_at: item.secret ? now : null,
    });
  }
  if (added.length) writeCollection(COLLECTION, [...all, ...added]);
  return { added: added.length, duplicates };
}

export function existingVaultKeys(): Set<string> {
  return new Set(readRecords().map((r) => vaultDuplicateKey({ category: r.category, ...openFields(r) })));
}

/* ─────────────────────────────── ประวัติการเข้าถึง ─────────────────────────────── */

export function appendVaultAudit(entry: {
  staff_id: string;
  staff_name: string;
  action: VaultAuditAction;
  entry_id?: string | null;
  label?: string | null;
  detail?: string | null;
}): void {
  const all = readCollectionStrict<VaultAuditEntry>(AUDIT_COLLECTION);
  const id = newId();
  all.push({
    id,
    at: new Date().toISOString(),
    staff_id: entry.staff_id,
    staff_name: entry.staff_name,
    action: entry.action,
    entry_id: entry.entry_id ?? null,
    label: entry.label ? encryptText(entry.label, auditAad(id)) : null,
    detail: entry.detail ?? null,
  });
  writeCollection(AUDIT_COLLECTION, all.slice(-VAULT_AUDIT_LIMIT));
}

/** ใหม่สุดก่อน · ชื่อรายการที่ถอดไม่ได้ (กุญแจเปลี่ยน) แสดงเป็น "(อ่านไม่ได้)" ไม่ทำให้ทั้งหน้าพัง */
export function listVaultAudit(limit = 200): VaultAuditView[] {
  return readCollectionStrict<VaultAuditEntry>(AUDIT_COLLECTION)
    .slice(-limit)
    .reverse()
    .map((row) => {
      let label: string | null = null;
      if (row.label) {
        try {
          label = decryptText(row.label, auditAad(row.id));
        } catch {
          label = "(อ่านไม่ได้)";
        }
      }
      return { ...row, label };
    });
}
