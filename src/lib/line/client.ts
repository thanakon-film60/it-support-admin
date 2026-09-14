import "server-only";

const LINE_API_BASE = "https://api.line.me/v2/bot";

function getAccessToken(): string {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "ไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN — ดูวิธีตั้งค่าใน .env.example / README.md"
    );
  }
  return token;
}

export type LineMessage =
  | { type: "text"; text: string }
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

/** ส่งข้อความแบบ push (ไม่ผูกกับ reply token — ใช้ยิงหาผู้ใช้ตอนไหนก็ได้ เช่นแจ้งอัปเดตสถานะ ticket) */
export async function pushMessage(to: string, messages: LineMessage[]): Promise<void> {
  const res = await fetch(`${LINE_API_BASE}/message/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAccessToken()}`,
    },
    body: JSON.stringify({ to, messages: messages.slice(0, 5) }),
  });
  if (!res.ok) {
    console.error("[LINE] pushMessage failed:", res.status, await res.text());
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
