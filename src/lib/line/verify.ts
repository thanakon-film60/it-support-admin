import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** ตรวจลายเซ็น webhook ของ LINE (HMAC-SHA256 ด้วย Channel Secret, เทียบแบบ base64)
 *  ตาม spec ของ LINE Messaging API — ต้องเช็คทุกครั้งก่อนประมวลผล event ใดๆ
 *  เพื่อป้องกันไม่ให้ใครก็ได้ยิง POST ปลอมมาเป็น LINE server (ดู .env.example: LINE_CHANNEL_SECRET) */
export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
