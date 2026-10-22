"use client";

import { useEffect, useState } from "react";
import { revealVaultSecretAction } from "@/app/actions/vault";
import { OFFLINE, REVEAL_SECONDS } from "./vault-ui";

/** ช่องรหัสผ่านในตาราง: ปกติเป็น •••••••• · กด "ดู" = ขอรหัสจากเซิร์ฟเวอร์ (ถูกบันทึก) โชว์ 30 วินาทีแล้วซ่อนเอง
 *  หน้าเว็บไม่เคยได้รหัสมาก่อนกด — รหัสไม่อยู่ใน HTML/ข้อมูลหน้า ต่อให้ใครเปิด DevTools ก็ไม่เห็น */
export function SecretCell({
  entryId,
  hasSecret,
  onLocked,
  onError,
}: {
  entryId: string;
  hasSecret: boolean;
  onLocked: () => void;
  onError: (message: string) => void;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState<null | "view" | "copy">(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (revealed === null) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= expiresAt) setRevealed(null);
    }, 500);
    return () => window.clearInterval(timer);
  }, [revealed, expiresAt]);

  if (!hasSecret) return <span className="text-xs text-muted/70">— ไม่มีรหัส —</span>;

  function show(secret: string) {
    const t = Date.now();
    setRevealed(secret);
    setNow(t);
    setExpiresAt(t + REVEAL_SECONDS * 1000);
  }

  async function fetchSecret(purpose: "view" | "copy"): Promise<string | null> {
    setBusy(purpose);
    try {
      const result = await revealVaultSecretAction(entryId, purpose);
      if (result.locked) {
        onLocked();
        return null;
      }
      if (result.error) {
        onError(result.error);
        return null;
      }
      return result.secret ?? "";
    } catch {
      onError(OFFLINE);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function toggleView() {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    const secret = await fetchSecret("view");
    if (secret !== null) show(secret);
  }

  async function copy() {
    let secret: string | null = null;
    // ส่ง Promise ให้คลิปบอร์ดตั้งแต่ตอนกด — Safari ยอมให้เขียนคลิปบอร์ดเฉพาะ "ระหว่างการกด"
    // ถ้ารอรหัสจากเซิร์ฟเวอร์เสร็จก่อนค่อยเขียน จะถูกปฏิเสธว่าไม่ได้เกิดจากการกดของผู้ใช้
    const blob = fetchSecret("copy").then((value) => {
      if (value === null) throw new Error("no-secret");
      secret = value;
      return new Blob([value], { type: "text/plain" });
    });
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      } else {
        await navigator.clipboard.writeText(await (await blob).text());
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      if (secret !== null) {
        show(secret);
        onError(`คัดลอกอัตโนมัติไม่ได้ในเบราว์เซอร์นี้ — รหัสแสดงอยู่ ${REVEAL_SECONDS} วินาที คัดลอกเองได้`);
      }
    }
  }

  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000));

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <code
        className={`min-w-0 break-all rounded-md px-2 py-1 font-num text-sm ${
          revealed !== null ? "bg-amber-400/10 text-amber-200 ring-1 ring-inset ring-amber-400/30" : "text-muted"
        }`}
        // ข้อความที่โชว์อยู่ไม่ให้โปรแกรมอ่านหน้าจออ่านออกเสียงซ้ำๆ ทุกครั้งที่นับถอยหลัง
        aria-live="off"
      >
        {revealed !== null ? revealed || "(รหัสว่าง)" : "••••••••"}
      </code>
      <SmallButton onClick={toggleView} disabled={busy !== null} label={revealed !== null ? "ซ่อนรหัส" : "ดูรหัส"}>
        {busy === "view" ? "…" : revealed !== null ? `ซ่อน (${left})` : "ดู"}
      </SmallButton>
      <SmallButton onClick={copy} disabled={busy !== null} label="คัดลอกรหัส">
        {busy === "copy" ? "…" : copied ? "คัดลอกแล้ว ✓" : "คัดลอก"}
      </SmallButton>
    </div>
  );
}

export function SmallButton({
  onClick,
  disabled,
  danger,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      // min-h 36px — เล็กกว่านี้แล้วกดพลาดบนมือถือ (ปุ่มติดกันหลายปุ่ม)
      className={`min-h-[2.25rem] shrink-0 rounded-lg border border-line px-2.5 text-xs text-muted transition disabled:opacity-40 ${
        danger ? "hover:border-rose-400/40 hover:text-rose-300" : "hover:border-accent/40 hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}
