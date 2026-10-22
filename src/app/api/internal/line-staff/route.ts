/**
 * POST /api/internal/line-staff — บอทถามว่าบัญชี LINE นี้เป็นทีม IT ที่สั่งเปิด/ปิดบอทได้ไหม
 *
 * body: { line_user_id, display_name?, action: "check" | "request" }
 *   check   = แค่ถาม (ตอนพิมพ์ "แอดมิน" และทุกครั้งที่กดปุ่มบนการ์ดควบคุมบอท)
 *   request = ขอสิทธิ์ (ตอนพิมพ์ "ขอสิทธิ์แอดมิน") — สร้างคำขอรออนุมัติในหน้า "บอท LINE"
 * ตอบ: { ok, status: "approved" | "pending" | "none", name }
 *
 * สิทธิ์ตัดสินที่นี่ที่เดียว ไม่ cache ฝั่งบอท — แอดมินถอดสิทธิ์ในหน้าเว็บแล้วต้องมีผลกับการ์ดที่ค้างในแชททันที
 */
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyInternalKey, unauthorizedJson } from "@/lib/internal-auth";
import { checkLineStaff, isLineUserId, requestLineStaff } from "@/lib/db/lineStaff";
import { CollectionReadError } from "@/lib/db/store";

export const dynamic = "force-dynamic";

interface Payload {
  line_user_id?: unknown;
  display_name?: unknown;
  action?: unknown;
}

export async function POST(request: NextRequest) {
  if (!verifyInternalKey(request.headers.get("x-internal-key"))) return unauthorizedJson();

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "ต้องส่ง JSON object" }, { status: 400 });
  }
  if (!isLineUserId(body.line_user_id)) {
    return Response.json({ error: "line_user_id ไม่ถูกต้อง" }, { status: 400 });
  }
  const action = body.action ?? "check";
  if (action !== "check" && action !== "request") {
    return Response.json({ error: "action ต้องเป็น check | request" }, { status: 400 });
  }
  const displayName = typeof body.display_name === "string" ? body.display_name : null;

  try {
    if (action === "request") {
      const result = requestLineStaff(body.line_user_id, displayName);
      revalidatePath("/line-bot");
      return Response.json({ ok: true, ...result });
    }
    return Response.json({ ok: true, ...checkLineStaff(body.line_user_id, displayName) });
  } catch (err) {
    // ไฟล์ทะเบียนเสีย = ตอบ error (บอทถือว่า "ไม่ใช่ทีม IT") ห้ามตอบ none แล้วปล่อยให้คำขอใหม่เขียนทับไฟล์
    console.error("[line-staff] อ่านทะเบียนทีม IT ไม่สำเร็จ", err);
    const status = err instanceof CollectionReadError ? 503 : 500;
    return Response.json({ error: "อ่านทะเบียนทีม IT ไม่ได้" }, { status });
  }
}
