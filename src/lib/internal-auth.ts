import { timingSafeEqual } from "node:crypto";

/**
 * ตรวจสิทธิ์ของ "internal API" — endpoint ชุด /api/internal/* ที่เปิดให้ LINE Bot service
 * (Python) เรียกเข้ามาสร้าง ticket ได้ โดยไม่ต้องผ่าน session cookie ของแอดมิน
 *
 * ทำไมต้องมี key แยก ไม่ใช้ session ของแอดมิน:
 *   bot ไม่ใช่ "คน" จะ login ไม่ได้ และเราไม่อยากฝัง credential ของแอดมินไว้ในอีก service หนึ่ง
 *   การใช้ shared secret ต่างหากทำให้ revoke ได้อิสระ และจำกัด scope ได้ว่าทำได้แค่ไม่กี่อย่าง
 *
 * ข้อควรระวังก่อนขึ้น production:
 *   - endpoint ชุดนี้ต้องไม่ถูกเปิดออก public internet ตรงๆ ถ้าเลี่ยงได้ (ให้อยู่หลัง VPC/firewall
 *     หรืออย่างน้อยจำกัด IP ของ bot service)
 *   - INTERNAL_API_KEY ต้องยาวพอ (แนะนำ openssl rand -hex 32) และห้าม commit ลง git
 */
export function verifyInternalKey(headerValue: string | null): boolean {
  const expected = process.env.INTERNAL_API_KEY;

  // ถ้ายังไม่ตั้งค่า key เลย ให้ปฏิเสธทุก request — ปลอดภัยกว่าการปล่อยผ่าน (fail closed)
  if (!expected || !headerValue) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(headerValue);

  // เทียบความยาวก่อน เพราะ timingSafeEqual จะ throw ถ้าความยาวไม่เท่ากัน
  // (การรู้ว่า "ความยาวไม่ตรง" ไม่ได้ช่วยผู้โจมตีมากพอจะเป็นปัญหาในบริบทนี้)
  if (a.length !== b.length) return false;

  // เทียบแบบ constant-time กัน timing attack — ห้ามใช้ === เฉยๆ กับ secret
  return timingSafeEqual(a, b);
}

export function unauthorizedJson() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
