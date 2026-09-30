/**
 * POST   /api/internal/requester   — ผูกบัญชี LINE เข้ากับพนักงาน 1 คน
 * DELETE /api/internal/requester   — ถอดการผูก (ผู้ใช้กด "ไม่ใช่ฉัน / เปลี่ยนคน")
 *
 * ทำไมต้องแยกออกมาจาก /lookup: lookup เป็น GET ล้วนและถูกเรียกถี่มาก (บอท cache ผลไว้)
 * การเอา endpoint ที่ "เขียนข้อมูล" ไปปนกับ GET ทำให้เผลอ cache การเขียนได้ง่าย
 * และทำให้อ่าน log แยกไม่ออกว่าครั้งไหนแค่ดู ครั้งไหนแก้ข้อมูลจริง
 */
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyInternalKey, unauthorizedJson } from "@/lib/internal-auth";
import { bindLineUser, getEmployeeByCode, listEmployees, toBound, unbindLineUser } from "@/lib/db/employees";

export const dynamic = "force-dynamic";

interface Payload {
  line_user_id?: string;
  /** ระบุคนด้วย id ของแถว หรือรหัสพนักงานก็ได้ — บอทมี id จากก้อน knowledge อยู่แล้ว */
  user_id?: string;
  employee_code?: string;
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

  const lineUserId = (body.line_user_id ?? "").trim();
  if (!lineUserId || lineUserId.length > 200) {
    return Response.json({ error: "line_user_id จำเป็น" }, { status: 400 });
  }

  const target = body.user_id?.trim()
    ? listEmployees(true).find((u) => u.id === body.user_id!.trim()) ?? null
    : body.employee_code?.trim()
      ? getEmployeeByCode(body.employee_code.trim())
      : null;

  if (!target) {
    return Response.json({ error: "ไม่พบพนักงานที่ระบุ" }, { status: 404 });
  }
  if (target.active === false) {
    return Response.json({ error: "พนักงานคนนี้ถูกปิดใช้งานแล้ว" }, { status: 409 });
  }

  const bound = bindLineUser(lineUserId, target.id);
  if (!bound) return Response.json({ error: "ผูกไม่สำเร็จ" }, { status: 500 });

  revalidatePath("/employees");
  return Response.json({ ok: true, requester: toBound(bound) });
}

export async function DELETE(request: NextRequest) {
  if (!verifyInternalKey(request.headers.get("x-internal-key"))) return unauthorizedJson();

  const lineUserId = (request.nextUrl.searchParams.get("line_user_id") || "").trim();
  if (!lineUserId) return Response.json({ error: "ต้องส่ง line_user_id" }, { status: 400 });

  const removed = unbindLineUser(lineUserId);
  revalidatePath("/employees");
  return Response.json({ ok: true, removed });
}
