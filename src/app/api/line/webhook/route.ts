import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyLineSignature } from "@/lib/line/verify";
import { replyMessage } from "@/lib/line/client";
import { buildFaqReply, WELCOME_MESSAGE } from "@/lib/line/faq-bot";
import { ensureLineUser } from "@/lib/line/sync-user";
import type { LineWebhookBody } from "@/lib/line/types";

// Webhook ของ LINE Messaging API — endpoint นี้ต้องเป็น public (ไม่ผ่าน auth ของแอดมิน)
// ดู proxy.ts: PUBLIC_PATHS มี "/api/line/webhook" อยู่แล้ว
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");

  if (!verifyLineSignature(rawBody, signature)) {
    console.warn("[LINE webhook] signature ไม่ถูกต้อง — ปฏิเสธ request");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // ตอบแต่ละ event แบบขนาน แต่ดัก error รายอีเวนต์ไว้ ไม่ให้ event หนึ่งพังแล้วทำให้ทั้ง request ล้ม
  // (LINE จะ retry webhook ถ้าไม่ได้ 200 กลับไปภายในเวลาที่กำหนด)
  await Promise.all(
    (body.events ?? []).map(async (event) => {
      try {
        if (event.type === "follow" && event.replyToken) {
          await replyMessage(event.replyToken, [WELCOME_MESSAGE]);
          return;
        }

        if (
          event.type === "message" &&
          event.message?.type === "text" &&
          event.replyToken &&
          event.source.userId
        ) {
          // sync ผู้ใช้ LINE เข้า users table ก่อนเสมอ (ผูกด้วย line_user_id) เพื่อให้ ticket
          // ที่สร้างจาก LIFF ในภายหลังอ้างถึง requester คนเดียวกัน
          await ensureLineUser(event.source.userId);
          const messages = await buildFaqReply(event.message.text ?? "");
          await replyMessage(event.replyToken, messages);
        }
      } catch (err) {
        console.error("[LINE webhook] event handling failed:", err);
      }
    })
  );

  return NextResponse.json({ ok: true });
}

// Health check สำหรับเปิดทดสอบจาก browser/curl; ปุ่ม Verify ของ LINE จะส่ง POST events: []
export async function GET() {
  return NextResponse.json({ ok: true, service: "line-webhook" });
}
