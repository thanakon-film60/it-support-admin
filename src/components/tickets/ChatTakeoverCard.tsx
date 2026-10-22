"use client";

import { useEffect, useState, useTransition } from "react";
import { getChatTakeoverAction, setChatTakeoverAction, type ChatTakeoverResult } from "@/app/actions/chat";
import { Button } from "@/components/ui/Button";
import { formatThaiDateShort } from "@/lib/utils";
import { useLastEditor } from "@/lib/use-last-editor";
import { useCurrentEditor } from "@/components/auth/CurrentEditor";

/**
 * แชท LINE กับผู้แจ้ง: ให้บอทตอบ หรือเจ้าหน้าที่รับไปคุยเองในแอป LINE Official Account
 *
 * ต้องกดจากที่นี่เพราะ LINE ไม่บอกบอทตอนเจ้าหน้าที่ตอบแชท — ถ้าไม่กดก่อนตอบ บอทจะยังทำงานกับผู้แจ้งคนนั้น
 * แล้วตีความคำตอบที่เขาพิมพ์กลับมาเป็นเรื่องใหม่ (ถามสาขา/ประเภท) แทรกกลางงานที่เจ้าหน้าที่กำลังประสาน
 */

const FAILURE_TEXT: Record<Exclude<ChatTakeoverResult, { ok: true }>["reason"], string> = {
  not_configured: "ยังไม่ได้ตั้งค่า LINE_BOT_INTERNAL_URL ฝั่งเว็บแอดมิน — สั่งบอทจากหน้านี้ไม่ได้",
  chat_off: "Chat ใน LINE OA ปิดอยู่ — เปิดที่ OA Manager > Response settings ก่อน ไม่งั้นไม่มีใครเห็นแชทของผู้แจ้ง",
  unreachable: "ติดต่อบอทไม่ได้ (บอทไม่ได้รันอยู่?) — ลองใหม่อีกครั้ง",
  rejected: "บอทไม่รับคำสั่ง — ตรวจว่า INTERNAL_API_KEY ของเว็บกับบอทตรงกัน",
  not_found: "ไม่พบเรื่องนี้",
  no_line_user: "ผู้แจ้งไม่ได้แจ้งผ่าน LINE — ไม่มีแชทให้รับต่อ",
};

export function ChatTakeoverCard({ ticketId }: { ticketId: string }) {
  // ล็อกอินอยู่ = ไม่ต้องส่งชื่อ (Server Action ใช้ชื่อบัญชีเอง) · ปิดล็อกอิน = ส่งชื่อที่เคยพิมพ์จำไว้ในเครื่อง
  const accountName = useCurrentEditor();
  const lastEditor = useLastEditor();
  const [result, setResult] = useState<ChatTakeoverResult | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getChatTakeoverAction(ticketId)
      .then((r) => { if (!cancelled) setResult(r); })
      .catch(() => { if (!cancelled) setResult({ ok: false, reason: "unreachable" }); });
    return () => { cancelled = true; };
  }, [ticketId]);

  function toggle(take: boolean) {
    startTransition(async () => {
      try {
        setResult(await setChatTakeoverAction(ticketId, take, accountName ? undefined : lastEditor));
      } catch {
        setResult({ ok: false, reason: "unreachable" });
      }
    });
  }

  const active = result?.ok === true && result.state.active;
  const until = result?.ok === true ? result.state.until : null;
  // ปิดจากการ์ดควบคุมบอทในแชท / หน้า "บอท LINE" — ไม่มีเวลาสิ้นสุด และผู้แจ้งเปิดเองไม่ได้ ข้อความต้องบอกต่างกัน
  const pinned = result?.ok === true && result.state.pinned;
  const allOff = result?.ok === true && result.state.allOff;

  return (
    <section
      aria-label="แชท LINE กับผู้แจ้ง"
      className={`flex flex-col gap-2 rounded-xl border p-3 ${active ? "border-emerald-400/30 bg-emerald-400/[0.05]" : "border-line bg-page/40"}`}
    >
      <div className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#06C755] text-[9px] font-black text-white" aria-hidden>LINE</span>
        <div className="min-w-0 flex-1" role="status" aria-live="polite">
          <p className="text-sm font-semibold text-ink">
            {result === null ? "กำลังเช็คสถานะแชท…"
              : active && pinned ? "🔒 ทีม IT ปิดบอทกับผู้แจ้งคนนี้ไว้"
              : active ? "👤 เจ้าหน้าที่คุยอยู่ — บอทหยุดตอบผู้แจ้งคนนี้"
              : result.ok ? "🤖 บอทตอบผู้แจ้งคนนี้ตามปกติ"
              : "สถานะแชท LINE"}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-muted">
            {result === null ? " "
              : !result.ok ? FAILURE_TEXT[result.reason]
              : active && pinned ? "บอทเงียบกับคนนี้จนกว่าจะกดเปิด (สั่งจากการ์ดควบคุมบอทในแชท LINE หรือหน้า \"บอท LINE\") — ผู้แจ้งกดเมนูเองก็ไม่ทำให้บอทกลับมา"
              : active ? `บอทเงียบถึง ${until ? formatThaiDateShort(until) : "-"} (ต่อเวลาเองทุกครั้งที่ผู้แจ้งพิมพ์) — ผู้แจ้งกดเมนู/กลับไปใช้บอทเมื่อไหร่ บอทกลับมาเอง`
              : result.state.chatMode === "bot" ? FAILURE_TEXT.chat_off
              : "จะตอบผู้แจ้งในแอป LINE OA ให้กด \"รับแชทต่อเอง\" ก่อน — LINE ไม่บอกบอทตอนเจ้าหน้าที่ตอบ บอทจึงอาจตอบแทรก"}
          </p>
          {allOff && (
            <p className="mt-1 text-xs leading-5 text-amber-200">
              ⛔ ตอนนี้ปิดบอททั้งระบบอยู่ — ทุกแชทให้เจ้าหน้าที่ตอบเอง (เปิดกลับได้ที่หน้า &quot;บอท LINE&quot; หรือการ์ดควบคุมบอทในแชท)
            </p>
          )}
        </div>
      </div>
      {result?.ok && (
        active ? (
          <Button type="button" variant="outline" disabled={isPending} onClick={() => toggle(false)}>
            {isPending ? "กำลังสั่งบอท…" : "🤖 คืนให้บอทตอบ"}
          </Button>
        ) : (
          <Button type="button" variant="ghost" disabled={isPending || result.state.chatMode === "bot"} onClick={() => toggle(true)}>
            {isPending ? "กำลังสั่งบอท…" : "👤 รับแชทต่อเอง (บอทหยุดตอบ)"}
          </Button>
        )
      )}
      {result && !result.ok && ["unreachable", "chat_off"].includes(result.reason) && (
        <Button type="button" variant="outline" disabled={isPending} onClick={() => toggle(true)}>
          {isPending ? "กำลังลองใหม่…" : "ลองรับแชทอีกครั้ง"}
        </Button>
      )}
    </section>
  );
}
