"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Field, MODAL_INPUT, Modal } from "@/components/ui/Modal";
import { createVaultEntryAction, updateVaultEntryAction } from "@/app/actions/vault";
import type { VaultEntryView } from "@/lib/db/vault";
import {
  VAULT_CATEGORIES,
  VAULT_CATEGORY_INFO,
  VAULT_FIELD_LABELS,
  VAULT_LIMITS,
  checkVaultInput,
  generateVaultSecret,
  type VaultCategory,
} from "@/lib/vault-shared";
import { NO_AUTOFILL, OFFLINE } from "./vault-ui";

export type VaultEditing = { mode: "new"; category: VaultCategory } | { mode: "edit"; entry: VaultEntryView } | null;

const PLACEHOLDER: Record<string, string> = {
  url: "เช่น https://admin.example.com หรือ 192.168.1.1",
  band: "เช่น 2.4G / 5G",
  location: "เช่น ชั้น 3 ห้องประชุม",
};

/** ฟอร์มเพิ่ม/แก้รายการ — แก้ไขแล้วช่องรหัสผ่าน "ว่างไว้ = ใช้รหัสเดิม"
 *  ฟอร์มแก้ไขไม่ได้รับรหัสเดิมมาเลย (ไม่ต้องถอดรหัสเพื่อเปิดฟอร์ม และไม่มีรหัสค้างใน state ของหน้า) */
export function VaultEntryModal({
  editing,
  onClose,
  onSaved,
  onLocked,
}: {
  editing: VaultEditing;
  onClose: () => void;
  onSaved: (message: string) => void;
  onLocked: () => void;
}) {
  const entry = editing?.mode === "edit" ? editing.entry : null;
  // key = รายการที่เปิดอยู่ → สร้างฟอร์มใหม่ทุกครั้งที่เปลี่ยนแถว (ค่าเริ่มต้นไม่ค้างจากแถวก่อน)
  const formKey = editing?.mode === "edit" ? editing.entry.id : editing?.mode === "new" ? `new:${editing.category}` : "closed";
  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      size="lg"
      title={entry ? "แก้ไขรายการ" : "เพิ่มรายการ"}
      description={
        entry
          ? `${VAULT_CATEGORY_INFO[entry.category].label} · ช่องรหัสผ่านว่างไว้ = ใช้รหัสเดิม`
          : "รหัสผ่านถูกเข้ารหัสก่อนบันทึก และทุกการเปิดดูจะถูกบันทึกในประวัติ"
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
            ยกเลิก
          </Button>
          <Button type="submit" form="vault-entry-form" className="w-full sm:w-auto">
            บันทึก
          </Button>
        </>
      }
    >
      {editing && <EntryForm key={formKey} editing={editing} onSaved={onSaved} onLocked={onLocked} />}
    </Modal>
  );
}

function EntryForm({
  editing,
  onSaved,
  onLocked,
}: {
  editing: NonNullable<VaultEditing>;
  onSaved: (message: string) => void;
  onLocked: () => void;
}) {
  const entry = editing.mode === "edit" ? editing.entry : null;
  const [category, setCategory] = useState<VaultCategory>(entry ? entry.category : editing.mode === "new" ? editing.category : "account");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [clearSecret, setClearSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const info = VAULT_CATEGORY_INFO[category];

  function submit(formData: FormData) {
    if (isPending) return;
    const raw = {
      category,
      name: String(formData.get("name") ?? ""),
      username: String(formData.get("username") ?? ""),
      url: String(formData.get("url") ?? ""),
      band: String(formData.get("band") ?? ""),
      location: String(formData.get("location") ?? ""),
      note: String(formData.get("note") ?? ""),
    };
    const checked = checkVaultInput(raw);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = entry
          ? await updateVaultEntryAction(entry.id, raw, clearSecret ? "" : secret === "" ? null : secret)
          : await createVaultEntryAction(raw, secret);
      } catch {
        result = { error: OFFLINE };
      }
      if (result.locked) {
        onLocked();
        return;
      }
      if (result.error) {
        setError(result.error);
        return;
      }
      setSecret("");
      onSaved(entry ? `บันทึกการแก้ไข "${checked.input.name}" แล้ว` : `เพิ่ม "${checked.input.name}" แล้ว`);
    });
  }

  const text = (field: "url" | "band" | "location", maxLength: number) => (
    <Field label={VAULT_FIELD_LABELS[field]}>
      <input
        name={field}
        defaultValue={entry?.[field] ?? ""}
        maxLength={maxLength}
        placeholder={PLACEHOLDER[field]}
        className={MODAL_INPUT}
        {...NO_AUTOFILL}
      />
    </Field>
  );

  return (
    <form id="vault-entry-form" action={submit} className="grid gap-4 sm:grid-cols-2" autoComplete="off">
      <Field label="หมวด" required className="sm:col-span-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as VaultCategory)}
          className={MODAL_INPUT}
        >
          {VAULT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {VAULT_CATEGORY_INFO[c].label}
            </option>
          ))}
        </select>
      </Field>

      <Field label={info.nameLabel} required className="sm:col-span-2">
        <input
          name="name"
          required
          maxLength={VAULT_LIMITS.name}
          defaultValue={entry?.name ?? ""}
          className={MODAL_INPUT}
          {...NO_AUTOFILL}
        />
      </Field>

      {info.fields.includes("username") && (
        <Field label={VAULT_FIELD_LABELS.username} className="sm:col-span-2">
          <input
            name="username"
            maxLength={VAULT_LIMITS.username}
            defaultValue={entry?.username ?? ""}
            className={MODAL_INPUT}
            {...NO_AUTOFILL}
          />
        </Field>
      )}

      <Field
        label={entry ? "รหัสผ่านใหม่" : "รหัสผ่าน"}
        hint={entry ? (entry.has_secret ? "ว่างไว้ = ใช้รหัสเดิม" : "ตอนนี้ยังไม่มีรหัส") : undefined}
        className="sm:col-span-2"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type={showSecret ? "text" : "password"}
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
              if (e.target.value) setClearSecret(false);
            }}
            maxLength={VAULT_LIMITS.secret}
            disabled={clearSecret}
            className={`${MODAL_INPUT} font-num`}
            {...NO_AUTOFILL}
            // new-password = บอกเบราว์เซอร์ว่าไม่ใช่รหัสล็อกอินของเว็บนี้ อย่าเติมให้และอย่าเสนอบันทึก
            autoComplete="new-password"
          />
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSecret(generateVaultSecret());
                setShowSecret(true);
                setClearSecret(false);
              }}
            >
              สุ่ม
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowSecret((v) => !v)}>
              {showSecret ? "ซ่อน" : "แสดง"}
            </Button>
          </div>
        </div>
        {entry?.has_secret && (
          <label className="mt-2 flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={clearSecret}
              onChange={(e) => {
                setClearSecret(e.target.checked);
                if (e.target.checked) setSecret("");
              }}
            />
            รายการนี้ไม่มีรหัสผ่านแล้ว (ลบรหัสเดิมทิ้ง)
          </label>
        )}
      </Field>

      {info.fields.includes("band") && text("band", VAULT_LIMITS.band)}
      {info.fields.includes("location") && text("location", VAULT_LIMITS.location)}
      {info.fields.includes("url") && <div className="sm:col-span-2">{text("url", VAULT_LIMITS.url)}</div>}

      <Field label={VAULT_FIELD_LABELS.note} className="sm:col-span-2">
        <textarea
          name="note"
          rows={3}
          maxLength={VAULT_LIMITS.note}
          defaultValue={entry?.note ?? ""}
          className={`${MODAL_INPUT} resize-y`}
          {...NO_AUTOFILL}
        />
      </Field>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300 sm:col-span-2">
          {error}
        </p>
      )}
      {isPending && <p className="text-sm text-muted sm:col-span-2">กำลังบันทึก…</p>}
    </form>
  );
}
