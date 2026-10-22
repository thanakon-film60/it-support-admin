import "server-only";
import { postToBot, type BotHandoffFailure } from "./bot-handoff";

/**
 * สถานะเปิด/ปิดบอท LINE สำหรับหน้า "บอท LINE" — ทางหลักของการเปิด/ปิดคือการ์ดในแชท (พิมพ์ "แอดมิน")
 * หน้านี้มีไว้ดูภาพรวม และเป็นทางสำรองตอนไม่มีมือถืออยู่ใกล้ตัว
 *
 * สถานะจริงอยู่ใน Redis ของบอทที่เดียว ฝั่งนี้แค่ถามและสั่ง ไม่เก็บซ้ำ (เหตุผลเดียวกับ bot-handoff.ts)
 */

export interface BotOffInfo {
  /** ISO — ปิดไว้ตั้งแต่เมื่อไหร่ */
  since: string | null;
  /** ใครสั่งปิด (ชื่อ LINE ของทีม IT / ชื่อบัญชีหน้าเว็บ) */
  by: string | null;
}

export interface BotUserOff extends BotOffInfo {
  lineUserId: string;
  /** ชื่อ LINE ล่าสุดที่บอทเห็น */
  name: string | null;
}

export interface BotControlState {
  botOff: BotOffInfo | null;
  usersOff: BotUserOff[];
  chatMode: "chat" | "bot" | "unknown";
}

export type BotControlResult = { ok: true; state: BotControlState } | { ok: false; reason: BotHandoffFailure };

function toIso(epoch: unknown): string | null {
  return typeof epoch === "number" && Number.isFinite(epoch) ? new Date(epoch * 1000).toISOString() : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function offInfo(raw: unknown): BotOffInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const info = raw as Record<string, unknown>;
  return { since: toIso(info.since), by: text(info.by) };
}

async function call(path: string, body: Record<string, unknown>): Promise<BotControlResult> {
  const result = await postToBot(path, body);
  if (!result.ok) return result;
  const data = result.data;
  const users = Array.isArray(data.users_off) ? data.users_off : [];
  return {
    ok: true,
    state: {
      botOff: offInfo(data.bot_off),
      usersOff: users.flatMap((raw): BotUserOff[] => {
        if (!raw || typeof raw !== "object") return [];
        const row = raw as Record<string, unknown>;
        const lineUserId = text(row.line_user_id);
        if (!lineUserId) return [];
        return [{ lineUserId, name: text(row.name), since: toIso(row.since), by: text(row.by) }];
      }),
      chatMode: data.chat_mode === "chat" || data.chat_mode === "bot" ? data.chat_mode : "unknown",
    },
  };
}

export function getBotControl(): Promise<BotControlResult> {
  return call("/internal/bot/status", {});
}

/** off=true ปิดบอททั้งระบบ · off=false เปิดกลับ */
export function setBotGlobal(off: boolean, by: string): Promise<BotControlResult> {
  return call("/internal/bot/global", { off, by });
}

/** off=true ปิดบอทกับคนนี้ · off=false เปิดกลับ (ล้างโหมดคุยกับเจ้าหน้าที่ที่ค้างอยู่ด้วย) */
export function setBotUser(lineUserId: string, off: boolean, by: string): Promise<BotControlResult> {
  return call("/internal/bot/user", { line_user_id: lineUserId, off, by });
}
