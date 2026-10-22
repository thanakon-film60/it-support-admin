import "server-only";

/**
 * สั่งบอท LINE (Python) ให้ "เงียบ" กับผู้แจ้งคนหนึ่ง ระหว่างที่เจ้าหน้าที่คุยเองในแอป LINE Official Account
 *
 * ทำไมต้องสั่งจากฝั่งนี้: LINE ไม่ส่ง webhook ตอนเจ้าหน้าที่ตอบแชท — บอทเห็นแค่ข้อความฝั่งผู้ใช้
 * จึงรู้เองไม่ได้ว่ามีคนกำลังคุยอยู่ แล้วโผล่มาตอบแทรก (เช่นตีความคำตอบของผู้ใช้เป็นเรื่องใหม่แล้วถามสาขา)
 *
 * สถานะ "เงียบถึงเมื่อไหร่" อยู่ใน session ของบอท (Redis) ที่เดียว ฝั่งนี้แค่สั่งและถาม ไม่เก็บซ้ำ
 * — ถ้าเก็บสองที่ จะไม่ตรงกันในวันที่ผู้ใช้กด "กลับไปใช้บอท" เอง (ฝั่งนี้ไม่มีทางรู้) แล้วหน้าเว็บโชว์สถานะผิด
 *
 * ปลายทางคือ LINE_BOT_INTERNAL_URL (ใน compose = http://bot:8000) ไม่ตั้ง = ฟีเจอร์นี้ปิด ไม่ใช่ error
 */

/** รอบอทได้นานสุดเท่านี้ — ถูกเรียกระหว่างที่แอดมินกดปุ่ม/บันทึกสถานะ ห้ามค้างหน้าเว็บ */
const BOT_TIMEOUT_MS = 5_000;

export interface BotHandoffState {
  /** บอทกำลังเงียบกับคนนี้ (เจ้าหน้าที่คุยอยู่ หรือทีม IT ปิดบอทกับคนนี้ไว้) */
  active: boolean;
  /** เงียบถึงเมื่อไหร่ (ISO) — ผู้ใช้พิมพ์มาเมื่อไหร่ บอทต่อเวลาให้เองนับจากข้อความล่าสุด */
  until: string | null;
  /** ทีม IT ปิดบอทกับคนนี้ไว้จากการ์ดควบคุมบอทในแชท / หน้า "บอท LINE" — ไม่มีเวลาสิ้นสุด จนกว่าจะสั่งเปิด */
  pinned: boolean;
  /** ปิดบอททั้งระบบอยู่ — ทุกแชทให้เจ้าหน้าที่ตอบเอง */
  allOff: boolean;
  /** Chat ใน OA Manager: chat = เปิด · bot = ปิด (เจ้าหน้าที่มองไม่เห็นแชท) */
  chatMode: "chat" | "bot" | "unknown";
}

export type BotHandoffFailure = "not_configured" | "chat_off" | "unreachable" | "rejected";

export type BotHandoffResult = { ok: true; state: BotHandoffState } | { ok: false; reason: BotHandoffFailure };

/** ผลดิบของการเรียก API ภายในของบอท — ใช้ร่วมกับ bot-control.ts (หน้า "บอท LINE") */
export type BotCallResult = { ok: true; data: Record<string, unknown> } | { ok: false; reason: BotHandoffFailure };

function botUrl(path: string): string | null {
  const base = process.env.LINE_BOT_INTERNAL_URL?.trim();
  return base ? `${base.replace(/\/+$/, "")}${path}` : null;
}

/** POST ไปที่ API ภายในของบอท พร้อม key — ตัวเรียกเดียวของทุกคำสั่งที่เว็บส่งให้บอท */
export async function postToBot(path: string, body: Record<string, unknown>): Promise<BotCallResult> {
  const url = botUrl(path);
  const key = process.env.INTERNAL_API_KEY;
  if (!url || !key) return { ok: false, reason: "not_configured" };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-key": key },
      // user id อยู่ใน body ไม่ใช่ query — access log ของ uvicorn พิมพ์ query string ออกมาเต็มๆ
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(BOT_TIMEOUT_MS),
      cache: "no-store",
      // ห้ามตาม redirect — ไม่งั้น key จะถูกส่งต่อไปปลายทางที่เราไม่ได้ตั้งใจ
      redirect: "error",
    });
  } catch (error) {
    console.error("[bot] เรียกบอทไม่สำเร็จ:", path, error instanceof Error ? error.message : error);
    return { ok: false, reason: "unreachable" };
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.status === 409 && data?.reason === "chat_off") return { ok: false, reason: "chat_off" };
  if (!res.ok || !data) {
    console.error("[bot] บอทปฏิเสธคำสั่ง:", path, res.status);
    return { ok: false, reason: "rejected" };
  }
  return { ok: true, data };
}

async function callBot(path: string, body: Record<string, unknown>): Promise<BotHandoffResult> {
  const result = await postToBot(path, body);
  if (!result.ok) return result;
  const data = result.data;
  return {
    ok: true,
    state: {
      active: data.active === true,
      until: typeof data.until === "number" ? new Date(data.until * 1000).toISOString() : null,
      // บอทรุ่นก่อนไม่ส่งสองช่องนี้ = ไม่มีการปิดบอท (ค่าที่ถูกต้องสำหรับบอทที่ยังไม่มีฟีเจอร์นี้)
      pinned: data.bot_off_user === true,
      allOff: data.bot_off_all === true,
      chatMode: data.chat_mode === "chat" || data.chat_mode === "bot" ? data.chat_mode : "unknown",
    },
  };
}

/** เจ้าหน้าที่รับแชทต่อ — ไม่ส่ง hours = ใช้ HANDOFF_HOURS ของบอท (ชุดเดียวกับปุ่ม "คุยกับเจ้าหน้าที่") */
export function startBotHandoff(lineUserId: string, hours?: number): Promise<BotHandoffResult> {
  return callBot("/internal/handoff", { line_user_id: lineUserId, ...(hours ? { hours } : {}) });
}

/** คืนแชทให้บอทตอบตามปกติ — เปิดบอทกับคนนี้ด้วย ถ้าทีม IT ปิดไว้จากการ์ดในแชท */
export function endBotHandoff(lineUserId: string): Promise<BotHandoffResult> {
  return callBot("/internal/handoff/end", { line_user_id: lineUserId });
}

export function getBotHandoff(lineUserId: string): Promise<BotHandoffResult> {
  return callBot("/internal/handoff/status", { line_user_id: lineUserId });
}
