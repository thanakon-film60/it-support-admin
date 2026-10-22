// ค่าคงที่และฟังก์ชันของหน้าฝากข้อความ (/notes) ที่ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และฝั่งเบราว์เซอร์
//
// แยกออกจาก db/notes.ts ด้วยเหตุผลเดียวกับ lib/companies.ts: db/notes.ts เรียก store.ts ซึ่ง import
// node:fs — client component แตะเมื่อไหร่ next build ล้มทั้งหน้า (tests/client-bundle.test.cjs กันไว้)
// ไฟล์นี้จึงมีแต่ของที่ไม่ต้องอ่านดิสก์: กฎตรวจข้อความ · รูปแบบวันที่ · เนื้อไฟล์ .txt ที่ดาวน์โหลด

import { dayKeyTH, stampTH } from "./date-th";
import type { Note } from "./types";

/** ความยาวสูงสุดต่อ 1 ข้อความ
 *
 *  กันไม่ให้ใครวางเอกสารทั้งเล่มลงมาในข้อความเดียว — store.ts อ่านทั้งไฟล์ทุกครั้งที่เปิดหน้า
 *  ข้อความยักษ์ไม่กี่อันทำให้หน้านี้ช้าลงทุกเครื่อง 5,000 ตัวอักษรยังเท่ากับข้อความยาวราว 2 หน้ากระดาษ */
export const NOTE_MAX_LENGTH = 5000;

export type NoteBodyCheck = { ok: true; body: string } | { ok: false; error: string };

/** ตรวจและจัดรูปข้อความก่อนบันทึก — ใช้ตัวเดียวกันทั้งปุ่มบนหน้าเว็บและ Server Action
 *
 *  ฝั่งเว็บใช้เพื่อบอกผู้ใช้ทันทีโดยไม่ต้องรอเซิร์ฟเวอร์ ฝั่งเซิร์ฟเวอร์ต้องตรวจซ้ำเสมอ เพราะ
 *  Server Action ถูกเรียกตรงๆ ได้โดยไม่ผ่านหน้าเว็บ · ขึ้นบรรทัดแบบ Windows (\r\n) ถูกแปลงเป็น \n
 *  ให้เหมือนกันทุกเครื่อง ไม่งั้นข้อความเดียวกันที่พิมพ์จากคอมกับมือถือจะเก็บไม่เหมือนกัน */
export function checkNoteBody(raw: unknown): NoteBodyCheck {
  if (typeof raw !== "string") return { ok: false, error: "ข้อความไม่ถูกต้อง" };
  const body = raw.replace(/\r\n?/g, "\n").trim();
  if (!body) return { ok: false, error: "พิมพ์ข้อความก่อนกดบันทึก" };
  if (body.length > NOTE_MAX_LENGTH) {
    return {
      ok: false,
      error: `ยาวเกิน ${NOTE_MAX_LENGTH.toLocaleString("en-US")} ตัวอักษร (ตอนนี้ ${body.length.toLocaleString("en-US")}) — แบ่งเป็นหลายข้อความแทน`,
    };
  }
  return { ok: true, body };
}

/** "7 ต.ค. 2569 · 10:45" ตามเวลาไทย
 *
 *  ใช้ date-th (ระบุ Asia/Bangkok ตรงๆ) ไม่ใช้เวลาเครื่อง — เซิร์ฟเวอร์รัน UTC ส่วนเบราว์เซอร์อยู่ UTC+7
 *  ถ้าต่างคนต่างคิด ข้อความที่เรนเดอร์จากเซิร์ฟเวอร์กับในเบราว์เซอร์จะขึ้นเวลาไม่ตรงกัน (hydration mismatch) */
export function noteStamp(iso: string | null | undefined): string {
  return stampTH(iso);
}

/** ค้นหาแบบไม่สนช่องว่างและตัวพิมพ์ — คนพิมพ์ภาษาไทยเว้นวรรคไม่เหมือนกัน (เหมือนหน้าพนักงาน) */
export function noteMatches(note: Note, query: string): boolean {
  const q = query.replace(/\s+/g, "").toLowerCase();
  if (!q) return true;
  return `${note.body}${note.author}`.replace(/\s+/g, "").toLowerCase().includes(q);
}

/** ชื่อไฟล์ดาวน์โหลด — ใช้ตัวอักษรอังกฤษล้วน เพราะชื่อไฟล์ภาษาไทยเพี้ยนได้ในบางเบราว์เซอร์/บางแอป */
export function notesFileName(exportedAt: string): string {
  return `notes-${dayKeyTH(exportedAt) || "export"}.txt`;
}

/** เนื้อไฟล์ .txt ของปุ่ม "ดาวน์โหลด" — เรียงใหม่สุดก่อนตามที่เห็นบนหน้าเว็บ
 *
 *  ใส่ BOM และขึ้นบรรทัดแบบ \r\n: Notepad/Excel รุ่นเก่าบน Windows เปิดไฟล์ UTF-8 ที่ไม่มี BOM
 *  เป็นภาษาไทยอ่านไม่ออก และไม่ขึ้นบรรทัดใหม่ถ้าเป็น \n ล้วน ส่วนมือถือกับเครื่องอื่นอ่านได้ทั้งสองแบบ */
export function notesToText(notes: Note[], exportedAt: string): string {
  const rule = "-".repeat(48);
  const lines = [
    "บันทึกข้อความ — ระบบ IT Support",
    `ส่งออกเมื่อ ${noteStamp(exportedAt)} · ทั้งหมด ${notes.length} ข้อความ`,
    "=".repeat(48),
    "",
  ];
  for (const note of notes) {
    lines.push(`[${noteStamp(note.created_at)}] ${note.author}`);
    lines.push(note.body);
    if (note.updated_at) {
      lines.push(`(แก้ไขล่าสุด ${noteStamp(note.updated_at)}${note.updated_by ? ` โดย ${note.updated_by}` : ""})`);
    }
    lines.push(rule, "");
  }
  return "﻿" + lines.join("\n").replace(/\n/g, "\r\n");
}
