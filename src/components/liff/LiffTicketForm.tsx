"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createLiffTicketAction, type LiffTicketInput } from "@/app/actions/liff";
import { TICKET_TYPE_LABEL } from "@/lib/labels";
import { Button } from "@/components/ui/Button";
import type { TicketType } from "@/lib/types";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID;

const inputClass =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";

interface LineProfile {
  userId: string;
  displayName: string;
}

export function LiffTicketForm({
  equipmentOptions,
}: {
  equipmentOptions: { id: string; label: string }[];
}) {
  const [liffState, setLiffState] = useState<"loading" | "liff" | "manual">("loading");
  const [profile, setProfile] = useState<LineProfile | null>(null);

  const [type, setType] = useState<TicketType>("it_service");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [items, setItems] = useState([{ name: "", qty: 1 }]);
  const [manualName, setManualName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultCode, setResultCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initLiff() {
      if (!LIFF_ID) {
        if (!cancelled) setLiffState("manual");
        return;
      }
      try {
        const liffModule = await import("@line/liff");
        const liff = liffModule.default;
        await liff.init({ liffId: LIFF_ID });
        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }
        const p = await liff.getProfile();
        if (!cancelled) {
          setProfile({ userId: p.userId, displayName: p.displayName });
          setLiffState("liff");
        }
      } catch (err) {
        console.error("[LIFF] init ไม่สำเร็จ ใช้โหมดกรอกเองแทน:", err);
        if (!cancelled) setLiffState("manual");
      }
    }

    initLiff();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateItem(index: number, patch: Partial<{ name: string; qty: number }>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!description.trim()) {
      setError("กรุณากรอกรายละเอียดปัญหา");
      return;
    }
    if (liffState === "manual" && !manualName.trim()) {
      setError("กรุณากรอกชื่อผู้แจ้ง");
      return;
    }

    const input: LiffTicketInput = {
      type,
      location: location.trim(),
      description: description.trim(),
      equipmentId: type === "repair" && equipmentId ? equipmentId : null,
      items: type === "withdraw" ? items.filter((it) => it.name.trim() && it.qty > 0) : undefined,
      identity:
        liffState === "liff" && profile
          ? { mode: "liff", lineUserId: profile.userId }
          : { mode: "manual", name: manualName.trim() },
    };

    setSubmitting(true);
    const result = await createLiffTicketAction(input);
    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    setResultCode(result.ticketCode ?? null);
  }

  if (resultCode) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface p-6 text-center">
        <span className="text-3xl">✅</span>
        <p className="text-lg font-bold text-ink">แจ้งเรื่องสำเร็จ</p>
        <p className="font-num text-accent">{resultCode}</p>
        <p className="text-sm text-muted">ทีม IT จะดำเนินการและอัปเดตสถานะให้เร็วที่สุด</p>
        <Button type="button" onClick={() => window.location.reload()}>
          แจ้งเรื่องใหม่
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-ink">📝 แจ้งปัญหา / ขอความช่วยเหลือ IT</h1>
        <p className="text-sm text-muted">
          {liffState === "loading" && "กำลังเชื่อมต่อ LINE..."}
          {liffState === "liff" &&
            profile &&
            `แจ้งในนาม: ${profile.displayName} (เชื่อมต่อผ่าน LINE)`}
          {liffState === "manual" && "กรอกข้อมูลผู้แจ้งด้านล่าง"}
        </p>
      </div>

      {liffState === "manual" && (
        <Field label="ชื่อผู้แจ้ง *">
          <input
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            required
            className={inputClass}
          />
        </Field>
      )}

      <Field label="ประเภทเรื่องที่แจ้ง">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as TicketType)}
          className={inputClass}
        >
          {(Object.entries(TICKET_TYPE_LABEL) as [TicketType, string][]).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            )
          )}
        </select>
      </Field>

      <Field label="สาขา / สถานที่">
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="เช่น สำนักงานใหญ่, สาขาเซ็นทรัล"
          className={inputClass}
        />
      </Field>

      {type === "repair" && (
        <Field label="ทรัพย์สินที่เกี่ยวข้อง (ถ้ามี)">
          <select
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value)}
            className={inputClass}
          >
            <option value="">-- ไม่ระบุ --</option>
            {equipmentOptions.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {type === "withdraw" && (
        <div className="flex flex-col gap-2">
          <span className="text-sm text-muted">รายการที่ต้องการเบิก</span>
          {items.map((it, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={it.name}
                onChange={(e) => updateItem(i, { name: e.target.value })}
                placeholder="ชื่ออุปกรณ์"
                className={`${inputClass} flex-1`}
              />
              <input
                type="number"
                min={1}
                value={it.qty}
                onChange={(e) => updateItem(i, { qty: Number(e.target.value) })}
                className={`${inputClass} w-20`}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, { name: "", qty: 1 }])}
            className="self-start text-xs text-accent hover:underline"
          >
            + เพิ่มรายการ
          </button>
        </div>
      )}

      <Field label="รายละเอียด *">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          required
          className={inputClass}
        />
      </Field>

      {error && (
        <p className="rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      <Button type="submit" disabled={submitting || liffState === "loading"}>
        {submitting ? "กำลังส่ง..." : "ส่งเรื่อง"}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}
