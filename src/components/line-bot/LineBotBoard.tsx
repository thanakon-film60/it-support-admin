"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LineStaff } from "@/lib/types";
import type { BotControlResult } from "@/lib/line/bot-control";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/Modal";
import {
  approveLineStaffAction,
  removeLineStaffAction,
  resumeBotUserAction,
  setBotGlobalAction,
  type LineStaffActionResult,
} from "@/app/actions/lineBot";
import { formatThaiDateShort } from "@/lib/utils";

/**
 * หน้า "บอท LINE" — สถานะเปิด/ปิดบอท + ทะเบียนบัญชี LINE ของทีม IT ที่สั่งบอทจากแชทได้
 *
 * ทางหลักของการเปิด/ปิดคือการ์ดในแชท LINE (ทีม IT พิมพ์ "แอดมิน" หาบอท) เพราะต้องทำตอนกำลังตอบแชท
 * อยู่ในแอป LINE OA — หน้านี้มีไว้อนุมัติสิทธิ์ ดูภาพรวมว่าปิดใครไว้บ้าง และเป็นทางสำรองตอนไม่มีมือถือ
 */

type BotFailure = Extract<BotControlResult, { ok: false }>["reason"];

const BOT_FAILURE: Record<BotFailure, string> = {
  not_configured: "ยังไม่ได้ตั้งค่า LINE_BOT_INTERNAL_URL ฝั่งเว็บแอดมิน — ดู/สั่งบอทจากหน้านี้ไม่ได้ (การ์ดในแชท LINE ยังใช้ได้)",
  chat_off: "Chat ใน LINE OA ปิดอยู่ — ปิดบอทไม่ได้ เพราะจะไม่มีใครเห็นข้อความของผู้ใช้ (เปิดที่ OA Manager > Response settings ก่อน)",
  unreachable: "ติดต่อบอทไม่ได้ (บอทไม่ได้รันอยู่?) — ลองรีเฟรชหน้านี้อีกครั้ง",
  rejected: "บอทไม่รับคำสั่ง — ตรวจว่า INTERNAL_API_KEY ของเว็บกับบอทตรงกัน",
};

const OFFLINE = "ติดต่อเซิร์ฟเวอร์ไม่ได้ — เช็กอินเทอร์เน็ตแล้วลองใหม่";

function when(iso: string | null): string {
  return iso ? formatThaiDateShort(iso) : "-";
}

export function LineBotBoard({
  staff,
  loadError,
  bot,
}: {
  staff: LineStaff[];
  loadError: string | null;
  bot: BotControlResult;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [removing, setRemoving] = useState<LineStaff | null>(null);

  const pending = staff.filter((s) => s.status === "pending");
  const approved = staff.filter((s) => s.status === "approved");

  /** เรียก Server Action แล้วดึงสถานะใหม่จากเซิร์ฟเวอร์ — ผลจากแชท LINE ของคนอื่นจะมาในรอบนี้ด้วย */
  function run(fn: () => Promise<LineStaffActionResult | BotControlResult>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if ("ok" in result && result.ok === false) setError(BOT_FAILURE[result.reason]);
        else if ("error" in result && result.error) setError(result.error);
        else onDone?.();
      } catch {
        setError(OFFLINE);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="บอท LINE"
        description="เปิด/ปิดบอทตอบอัตโนมัติ และอนุมัติบัญชี LINE ของทีม IT ที่สั่งบอทจากแชทได้"
      />

      {error && (
        <p role="alert" className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200 ring-1 ring-inset ring-rose-400/25">
          {error}
        </p>
      )}

      {/* ───────────── สถานะบอท ───────────── */}
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink">สถานะบอท</h2>
          <p className="mt-0.5 text-xs text-muted">
            ปิดบอทแล้ว ผู้ใช้จะได้ข้อความแจ้ง 1 ครั้งต่อวันว่าเจ้าหน้าที่จะตอบเอง จากนั้นบอทเงียบ — ทีม IT ตอบในแอป LINE OA / chat.line.biz
          </p>
        </div>

        {!bot.ok ? (
          <p className="rounded-xl bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-200 ring-1 ring-inset ring-amber-400/25">
            {BOT_FAILURE[bot.reason]}
          </p>
        ) : (
          <>
            {bot.state.chatMode === "bot" && (
              <p className="rounded-xl bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-200 ring-1 ring-inset ring-amber-400/25">
                {BOT_FAILURE.chat_off}
              </p>
            )}

            <div
              className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
                bot.state.botOff ? "border-rose-400/30 bg-rose-500/5" : "border-emerald-400/25 bg-emerald-400/5"
              }`}
            >
              <div>
                <p className="text-sm font-semibold text-ink">
                  {bot.state.botOff ? "⛔ ปิดบอททั้งระบบอยู่" : "🟢 บอทตอบผู้ใช้ทุกคนตามปกติ"}
                </p>
                {bot.state.botOff && (
                  <p className="mt-0.5 text-xs text-muted">
                    ปิดเมื่อ {when(bot.state.botOff.since)}
                    {bot.state.botOff.by ? ` โดย ${bot.state.botOff.by}` : ""}
                  </p>
                )}
              </div>
              {bot.state.botOff ? (
                <Button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => setBotGlobalAction(false))}
                >
                  {isPending ? "กำลังสั่งบอท…" : "✅ เปิดบอททั้งระบบ"}
                </Button>
              ) : confirmOff ? (
                <div className="flex flex-col gap-2 sm:items-end">
                  <p className="text-xs text-rose-200">ทุกแชทจะให้เจ้าหน้าที่ตอบเอง — ยืนยัน?</p>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" disabled={isPending} onClick={() => setConfirmOff(false)}>
                      ไม่ปิด
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={isPending}
                      onClick={() => run(() => setBotGlobalAction(true), () => setConfirmOff(false))}
                    >
                      {isPending ? "กำลังสั่งบอท…" : "⛔ ยืนยันปิดบอท"}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="danger"
                  disabled={isPending || bot.state.chatMode === "bot"}
                  onClick={() => setConfirmOff(true)}
                >
                  ⛔ ปิดบอททั้งระบบ
                </Button>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted">
                ผู้ใช้ที่ปิดบอทไว้รายคน ({bot.state.usersOff.length})
              </p>
              {bot.state.usersOff.length === 0 ? (
                <p className="text-sm text-muted">
                  ไม่มี — ปิดรายคนได้จากการ์ดควบคุมบอทในแชท LINE (ทีม IT พิมพ์ &quot;แอดมิน&quot; หาบอท แล้วแตะชื่อคนนั้น)
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {bot.state.usersOff.map((u) => (
                    <li
                      key={u.lineUserId}
                      className="flex flex-col gap-2 rounded-xl border border-line bg-page/40 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">
                          🔒 {u.name ?? `ไม่ทราบชื่อ (…${u.lineUserId.slice(-4)})`}
                        </p>
                        <p className="text-xs text-muted">
                          ปิดเมื่อ {when(u.since)}
                          {u.by ? ` โดย ${u.by}` : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => run(() => resumeBotUserAction(u.lineUserId))}
                      >
                        🤖 เปิดบอทกับคนนี้
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </Card>

      {/* ───────────── ทีม IT ที่สั่งบอทจากแชทได้ ───────────── */}
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink">ทีม IT ที่สั่งบอทจากแชท LINE ได้</h2>
          <p className="mt-0.5 text-xs text-muted">
            บัญชีที่อนุมัติแล้วพิมพ์ &quot;แอดมิน&quot; หาบอท จะได้การ์ดปิด/เปิดบอททั้งระบบหรือรายคน (เลือกจากชื่อ LINE ของคนที่ทักมาล่าสุด)
          </p>
        </div>

        {loadError ? (
          <p className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200 ring-1 ring-inset ring-rose-400/25">
            {loadError}
          </p>
        ) : (
          <>
            {pending.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-amber-200">รออนุมัติ ({pending.length})</p>
                <ul className="flex flex-col gap-2">
                  {pending.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-col gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{s.display_name ?? "ไม่ทราบชื่อ LINE"}</p>
                        <p className="text-xs text-muted">ขอสิทธิ์เมื่อ {when(s.requested_at)}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" disabled={isPending} onClick={() => setRemoving(s)}>
                          ปฏิเสธ
                        </Button>
                        <Button type="button" disabled={isPending} onClick={() => run(() => approveLineStaffAction(s.id))}>
                          อนุมัติ
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted">อนุมัติแล้ว ({approved.length})</p>
              {approved.length === 0 ? (
                <p className="text-sm text-muted">ยังไม่มี — ทำตามวิธีด้านล่างเพื่อเพิ่มคนแรก</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {approved.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-col gap-2 rounded-xl border border-line bg-page/40 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">✅ {s.display_name ?? "ไม่ทราบชื่อ LINE"}</p>
                        <p className="text-xs text-muted">
                          อนุมัติเมื่อ {when(s.approved_at)}
                          {s.approved_by ? ` โดย ${s.approved_by}` : ""} · ใช้คำสั่งล่าสุด {when(s.last_seen_at)}
                        </p>
                      </div>
                      <Button type="button" variant="danger" disabled={isPending} onClick={() => setRemoving(s)}>
                        ถอดสิทธิ์
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </Card>

      {/* ───────────── วิธีใช้ ───────────── */}
      <Card className="flex flex-col gap-2 text-sm leading-6 text-ink">
        <h2 className="text-base font-semibold">วิธีใช้</h2>
        <ol className="list-decimal space-y-1 pl-5 text-muted">
          <li>ทีม IT แอดเพื่อน LINE OA (IT-Support-Admin) แล้วพิมพ์ <b className="text-ink">ขอสิทธิ์แอดมิน</b> ในแชท</li>
          <li>คำขอจะขึ้นในหน้านี้ — กด <b className="text-ink">อนุมัติ</b></li>
          <li>พิมพ์ <b className="text-ink">แอดมิน</b> ในแชทเมื่อไหร่ก็ได้ จะได้การ์ดควบคุมบอท: แตะชื่อคนเพื่อปิด/เปิดบอทกับคนนั้น หรือปิดทั้งระบบ</li>
          <li>คนที่ไม่ได้รับสิทธิ์พิมพ์ &quot;แอดมิน&quot; = ขอคุยกับเจ้าหน้าที่ตามปกติ (ไม่เห็นการ์ดควบคุม)</li>
        </ol>
      </Card>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          if (!target) return;
          run(() => removeLineStaffAction(target.id), () => setRemoving(null));
        }}
        title={removing?.status === "pending" ? "ปฏิเสธคำขอสิทธิ์" : "ถอดสิทธิ์ควบคุมบอท"}
        confirmLabel={removing?.status === "pending" ? "ปฏิเสธ" : "ถอดสิทธิ์"}
        pending={isPending}
        message={
          <p>
            {removing?.display_name ?? "บัญชีนี้"} จะสั่งบอทจากแชทไม่ได้อีก — การ์ดที่ค้างอยู่ในแชทของเขากดไม่ได้ทันที
            (ถ้าต้องการสิทธิ์อีก ให้พิมพ์ &quot;ขอสิทธิ์แอดมิน&quot; ใหม่)
          </p>
        }
      />
    </div>
  );
}
