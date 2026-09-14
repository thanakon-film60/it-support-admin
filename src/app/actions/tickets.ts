"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { updateTicketStatus } from "@/lib/db/tickets";
import type { TicketStatus } from "@/lib/types";

// หมายเหตุ: การ "สร้าง" ticket ไม่ได้อยู่ในไฟล์นี้เพราะแอดมินไม่ใช่ผู้สร้าง ticket เอง
// (ตามข้อสังเกตในต้นแบบ — ไม่มีปุ่ม "สร้าง Ticket" ในหน้าแอดมินเลย) ดู src/app/actions/liff.ts
// ซึ่งเป็นจุดเดียวที่สร้าง ticket ได้จริง (เรียกจาก LIFF mini-app ที่พนักงานใช้แจ้งเรื่อง)

export async function changeTicketStatusAction(
  ticketId: string,
  status: TicketStatus
) {
  await requireSession();
  const updated = await updateTicketStatus(ticketId, status);
  revalidatePath("/tickets");
  revalidatePath("/repair-history");
  revalidatePath("/");
  return updated;
}
