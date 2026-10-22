import "server-only";

/** ปกติยิงไป https://api.line.me
 *
 *  ตั้ง LINE_API_BASE ชี้ไปเซิร์ฟเวอร์จำลองได้ตอนทดสอบ เพื่อดูว่าข้อความแจ้งเตือนหน้าตาเป็นยังไง
 *  และยิงถูกคนไหม โดยไม่ต้องส่งของจริงเข้าไลน์พนักงาน และไม่กินโควตา 300 ข้อความ/เดือน
 *  (แนวคิดเดียวกับ LINE_API_HOST ของบอท Python ที่ tests/e2e ใช้อยู่แล้ว)
 *  ⚠️ ต้องเว้นว่างเสมอตอนใช้งานจริง ไม่งั้นข้อความจะไม่ถึงผู้ใช้ */
const LINE_API_BASE = (process.env.LINE_API_BASE || "https://api.line.me").replace(/\/+$/, "") + "/v2/bot";

function getAccessToken(): string {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "ไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN — ดูวิธีตั้งค่าใน .env.example / README.md"
    );
  }
  return token;
}

/** ปุ่มลัดที่ปักอยู่เหนือแป้นพิมพ์ (quick reply) — ตอนนี้การ์ดแจ้งผลใช้ปุ่มในตัวการ์ดแทน
 *  (confirm-card.ts / rating-card.ts) ชนิดนี้เหลือไว้ให้ข้อความ text ที่อยากแนบปุ่มลัด
 */
export interface LineQuickReply {
  items: {
    type: "action";
    action: { type: "postback"; label: string; data: string; displayText?: string };
  }[];
}

export type LineMessage =
  | { type: "flex"; altText: string; contents: Record<string, unknown> }
  | { type: "text"; text: string; quickReply?: LineQuickReply }
  | {
      type: "template";
      altText: string;
      template: {
        type: "buttons";
        text: string;
        actions: { type: "uri"; label: string; uri: string }[];
      };
    };

/** ตอบกลับด้วย reply token (ใช้ได้ครั้งเดียว ภายในเวลาจำกัดหลัง event เข้ามา) */
export async function replyMessage(replyToken: string, messages: LineMessage[]): Promise<void> {
  const res = await fetch(`${LINE_API_BASE}/message/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAccessToken()}`,
    },
    body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) }),
  });
  if (!res.ok) {
    console.error("[LINE] replyMessage failed:", res.status, await res.text());
  }
}

/** รอ LINE ได้นานสุดเท่านี้ต่อครั้ง
 *
 *  push ถูกเรียกระหว่างที่แอดมินกด "บันทึกและส่ง LINE" — fetch ที่ไม่มีเพดานเวลา ถ้า LINE ค้าง
 *  หน้าต่างแอดมินจะหมุนค้างไปเรื่อยๆ โดยที่สถานะบันทึกไปแล้ว ตัดที่ 10 วินาทีแล้วรายงาน "ส่งไม่สำเร็จ"
 *  ให้คนตัดสินใจเอง ดีกว่าให้รอโดยไม่รู้ว่าเกิดอะไรขึ้น */
const LINE_PUSH_TIMEOUT_MS = 10_000;

/** ส่งข้อความแบบ push (ไม่ผูกกับ reply token — ใช้ยิงหาผู้ใช้ตอนไหนก็ได้ เช่นแจ้งอัปเดตสถานะ ticket) */
export async function pushMessage(to: string, messages: LineMessage[]): Promise<void> {
  const res = await fetch(`${LINE_API_BASE}/message/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAccessToken()}`,
    },
    body: JSON.stringify({ to, messages: messages.slice(0, 5) }),
    signal: AbortSignal.timeout(LINE_PUSH_TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error("[LINE] pushMessage failed:", res.status, await res.text());
    throw new Error(`LINE push failed (${res.status})`);
  }
}

export interface LineProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

export async function getProfile(userId: string): Promise<LineProfile | null> {
  try {
    const res = await fetch(`${LINE_API_BASE}/profile/${userId}`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as LineProfile;
  } catch (err) {
    console.error("[LINE] getProfile failed:", err);
    return null;
  }
}
