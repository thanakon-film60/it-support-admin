"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { MODAL_INPUT } from "@/components/ui/Modal";
import { unlockVaultAction } from "@/app/actions/vault";
import type { VaultLockState } from "@/lib/vault/unlock";
import { VAULT_CATEGORIES, VAULT_CATEGORY_INFO, type VaultCategory } from "@/lib/vault-shared";
import { OFFLINE } from "./vault-ui";

/** หน้าตอนล็อกอยู่ / ใช้ไม่ได้ — ไม่มีข้อมูลรายการใดๆ ส่งมาที่เบราว์เซอร์เลย มีแค่จำนวนต่อหมวด */
export function VaultLockScreen({
  state,
  counts,
  loadError,
  unlockMinutes,
  maxFails,
}: {
  state: Exclude<VaultLockState, { status: "unlocked" }>;
  counts: Record<VaultCategory, number> | null;
  loadError: string | null;
  unlockMinutes: number;
  maxFails: number;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function unlock(event: React.FormEvent) {
    event.preventDefault();
    if (!password || isPending) return;
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await unlockVaultAction(password);
      } catch {
        result = { error: OFFLINE };
      }
      // ล้างช่องทุกครั้ง ไม่ว่าผ่านหรือไม่ — รหัสไม่ควรค้างอยู่ในหน่วยความจำของหน้าเว็บนานกว่าจำเป็น
      setPassword("");
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  const total = counts ? VAULT_CATEGORIES.reduce((sum, c) => sum + (counts[c] ?? 0), 0) : 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="รหัสผ่าน" description="บัญชีและรหัสผ่านของระบบ · Network & Server · Wi-Fi · Apple ID" />

      {loadError && (
        <p role="alert" className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{loadError}</p>
      )}

      <section className="mx-auto flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-xl ring-1 ring-inset ring-amber-400/30">
            🔒
          </span>
          {state.status === "locked" ? (
            <div>
              <h2 className="font-semibold text-ink">ล็อกอยู่ — ยืนยันตัวตนอีกครั้ง</h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                ใส่รหัสผ่านที่ใช้ล็อกอิน เพื่อเปิดดูได้ {unlockMinutes} นาที แล้วจะล็อกเองอัตโนมัติ ·
                ทุกการเปิดดูและคัดลอกรหัสถูกบันทึกชื่อผู้ใช้และเวลา
              </p>
            </div>
          ) : state.status === "no_key" ? (
            <div>
              <h2 className="font-semibold text-ink">ยังไม่ได้ตั้งกุญแจเข้ารหัส</h2>
              <p className="mt-1 text-sm leading-6 text-muted">{state.problem}</p>
            </div>
          ) : (
            <div>
              <h2 className="font-semibold text-ink">ใช้หน้านี้ไม่ได้ตอนปิดระบบล็อกอิน</h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                ตอนนี้ตั้ง <code>AUTH_DISABLED=true</code> ไว้ ทุกคนที่เปิดเว็บได้เป็น &quot;ผู้ใช้ทั่วไป&quot; ซึ่งไม่มีรหัสผ่านให้ยืนยันตัวตน —
                เปิดระบบล็อกอิน (<code>AUTH_DISABLED=false</code>) ก่อนจึงจะใช้หน้ารหัสผ่านได้
              </p>
            </div>
          )}
        </div>

        {state.status === "locked" && (
          <form onSubmit={unlock} className="flex flex-col gap-3" autoComplete="off">
            {/* current-password = ให้เบราว์เซอร์เติมรหัสล็อกอินเดิมได้ (เป็นรหัสเดียวกัน) ไม่เสนอ "บันทึกรหัสใหม่" */}
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted">รหัสผ่านของคุณ</span>
              <input
                type="password"
                name="vault-unlock"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                className={MODAL_INPUT}
              />
            </label>
            {error && <p role="alert" className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</p>}
            <Button type="submit" disabled={!password || isPending} className="w-full">
              {isPending ? "กำลังตรวจ…" : `ปลดล็อก ${unlockMinutes} นาที`}
            </Button>
            <p className="text-xs text-muted/80">ใส่ผิดเกิน {maxFails} ครั้ง ต้องรอ 15 นาทีจึงลองใหม่ได้</p>
          </form>
        )}

        {state.status === "no_key" && (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6 text-muted">
            <li>
              สร้างกุญแจ (ในโฟลเดอร์โปรเจกต์):{" "}
              <code className="break-all text-ink">node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;</code>
            </li>
            <li>ใส่ใน <code>.env</code> เป็น <code>VAULT_KEY=&lt;ค่าที่ได้&gt;</code> แล้วรัน <code>deploy.bat</code></li>
            <li>
              <strong className="text-amber-200">เก็บสำเนากุญแจไว้นอกเครื่องนี้</strong> (เช่นพิมพ์เก็บในตู้เซฟ) — กุญแจหาย = ข้อมูลในหน้านี้เปิดไม่ได้อีกเลย
            </li>
          </ol>
        )}

        {counts && total > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {VAULT_CATEGORIES.map((c) => (
              <span key={c} className="rounded-xl border border-line px-3 py-1.5 text-xs text-muted">
                {VAULT_CATEGORY_INFO[c].label} · <span className="font-num text-ink">{counts[c] ?? 0}</span>
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
