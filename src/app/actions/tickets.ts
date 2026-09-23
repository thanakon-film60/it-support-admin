"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { getTicketById, updateTicketStatus, readStatusHistory, recordStatusNotification } from "@/lib/db/tickets";
import { notifyTicketStatusChange, type NotifyResult } from "@/lib/line/notify";
import { STATUS_HEADLINE } from "@/lib/line/status-message";
import { MAX_EDITOR_NAME } from "@/lib/editor-name";
import type { Ticket, TicketStatus } from "@/lib/types";

export interface StatusChangeResult {
  success?: boolean;
  error?: string;
  ticket?: Ticket;
  notify?: NotifyResult | "not_requested";
}
export async function changeTicketStatusAction(
  ticketId: string, status: TicketStatus, editor?: string,
  options: { note?: string; notifyLine?: boolean; expectedUpdatedAt?: string | null } = {}
): Promise<StatusChangeResult> {
  await requireSession();
  if (!editor?.trim()) return { error: "กรุณาระบุชื่อผู้แก้ไข" };
  if (editor.trim().length > MAX_EDITOR_NAME) return { error: "ชื่อผู้แก้ไขยาวเกินไป" };
  if (!Object.hasOwn(STATUS_HEADLINE, status)) return { error: "สถานะไม่ถูกต้อง" };
  const note = options.note?.trim() ?? "";
  if (note.length > 500) return { error: "หมายเหตุยาวเกินไป" };
  const before = getTicketById(ticketId);
  if (!before) return { error: "ไม่พบเรื่องนี้" };
  if (options.expectedUpdatedAt !== undefined && options.expectedUpdatedAt !== (before.status_updated_at ?? null)) {
    return { error: "เรื่องนี้ถูกอัปเดตแล้ว กรุณาเปิดใหม่ก่อนบันทึก" };
  }
  if (status === before.status && !note) return { error: "กรุณาเปลี่ยนสถานะหรือระบุหมายเหตุก่อนบันทึก" };
  let ticket = updateTicketStatus(ticketId, status, editor, { note })!;
  let notify: StatusChangeResult["notify"] = "not_requested";
  if (options.notifyLine) {
    const historyId = readStatusHistory(ticket).at(-1)!.id;
    notify = await notifyTicketStatusChange(ticket, { force: true, note });
    ticket = recordStatusNotification(ticketId, historyId, notify === "sent") ?? ticket;
  }
  for (const path of ["/tickets", "/repair-history", "/resolved", "/completed", "/"]) revalidatePath(path);
  return { success: true, ticket, notify };
}
