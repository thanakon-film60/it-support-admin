import "server-only";
import { matchFaqByKeyword } from "@/lib/db/faq";
import type { LineMessage } from "./client";

function liffUrl(): string {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  return liffId ? `https://liff.line.me/${liffId}` : "";
}

export const WELCOME_MESSAGE: LineMessage = {
  type: "text",
  text:
    "สวัสดีครับ/ค่ะ 👋 นี่คือ IT Support Bot\n\n" +
    'พิมพ์อาการหรือปัญหาที่พบ เช่น "ปริ้นเอกสารไม่ได้" บอทจะแนะนำวิธีแก้เบื้องต้นให้ก่อน ' +
    "ถ้ายังแก้ไม่ได้สามารถกดปุ่มเพื่อแจ้งทีม IT ต่อได้เลยครับ/ค่ะ",
};

/** แกนหลักของบอท: จับคู่ข้อความผู้ใช้กับ FAQ ก่อนเสมอ (ตามที่วิเคราะห์จากต้นแบบ — มี FAQ Bot
 *  แนะนำวิธีแก้ก่อนสร้าง ticket) แล้วแนบปุ่มลิงก์ไป LIFF ให้แจ้งปัญหาต่อถ้ายังไม่หาย/ไม่เจอคำตอบ */
export function buildFaqReply(userText: string): LineMessage[] {
  const matches = matchFaqByKeyword(userText);
  const messages: LineMessage[] = [];
  const url = liffUrl();

  if (matches.length > 0) {
    const combined = matches
      .map((f, i) => `${i + 1}. ${f.title}\n${f.content}`)
      .join("\n\n");
    messages.push({
      type: "text",
      text: `พบวิธีแก้ไขที่อาจตรงกับปัญหาของคุณ 👇\n\n${combined}`,
    });
  } else {
    messages.push({
      type: "text",
      text: "ขออภัยครับ/ค่ะ ยังไม่พบคำแนะนำที่ตรงกับปัญหานี้ในระบบ",
    });
  }

  if (url) {
    messages.push({
      type: "template",
      altText: "แจ้งปัญหาให้ทีม IT ดูแลต่อ",
      template: {
        type: "buttons",
        text:
          matches.length > 0
            ? "ลองทำตามขั้นตอนด้านบนแล้วยังไม่หาย? แจ้งทีม IT ได้เลย"
            : "แจ้งปัญหาให้ทีม IT ดูแลต่อได้เลย",
        actions: [{ type: "uri", label: "📝 แจ้งปัญหา / สร้าง Ticket", uri: url }],
      },
    });
  } else {
    messages.push({
      type: "text",
      text: "(แอดมินยังไม่ได้ตั้งค่า NEXT_PUBLIC_LIFF_ID — ดู README.md เพื่อเปิดใช้ปุ่มแจ้งปัญหา)",
    });
  }

  return messages;
}
