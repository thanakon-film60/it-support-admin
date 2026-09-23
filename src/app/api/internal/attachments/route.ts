import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { verifyInternalKey, unauthorizedJson } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/attachments
 * รับไฟล์รูปจาก LINE Bot (Python) แล้วเซฟลงดิสก์ คืน URL สาธารณะกลับไป
 *
 * ทำไมบอทไม่เซฟไฟล์เอง: บอทรันคนละ container และไม่ได้ mount volume `uploads` ของแอป
 * ถ้าให้บอทเขียนเอง จะต้อง mount volume ร่วมกัน 2 service แล้วผูกเรื่อง permission/ownership
 * เพิ่มอีก — ส่งผ่าน HTTP มาให้ฝั่งที่เป็นเจ้าของ volume เขียนเองง่ายกว่าและย้ายไป
 * Supabase Storage ทีหลังก็แก้ที่นี่ที่เดียว (เหมือน saveImages() ของ FAQ)
 *
 * รับ body เป็นไบต์ดิบ (ไม่ใช่ multipart) เพราะบอทได้ไบต์มาจาก LINE Content API อยู่แล้ว
 * การห่อเป็น multipart จะเพิ่มขั้นตอนโดยไม่ได้อะไรกลับมา
 *
 * ส่ง header มาด้วย:
 *   content-type      : image/jpeg | image/png | image/gif | image/webp
 *   x-internal-key    : INTERNAL_API_KEY
 */

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "tickets");

/** รับเฉพาะรูปภาพ และเฉพาะชนิดที่เบราว์เซอร์แสดงได้ตรงๆ
 *  ไม่รับ svg โดยตั้งใจ — SVG รันสคริปต์ได้ถ้าเปิดตรงจาก URL จะกลายเป็นช่องโหว่ XSS
 *  ในโดเมนเดียวกับหน้าแอดมิน (LINE ไม่ส่ง svg มาอยู่แล้ว แต่ endpoint นี้ไม่ควรเชื่อ input) */
const ALLOWED: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

// รูปจากกล้องมือถือปกติ 1-4 MB — ตั้ง 10 MB เผื่อไว้ แต่ไม่ปล่อยไม่จำกัด
// เพราะ endpoint นี้เขียนลงดิสก์จริง ปล่อยฟรีคือเปิดทางให้ถมดิสก์จนเต็ม
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  if (!verifyInternalKey(request.headers.get("x-internal-key"))) {
    return unauthorizedJson();
  }

  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = ALLOWED[contentType];
  if (!ext) {
    return Response.json(
      { error: `content-type ไม่รองรับ: ${contentType || "(ว่าง)"} — รับเฉพาะ ${Object.keys(ALLOWED).join(", ")}` },
      { status: 415 }
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await request.arrayBuffer());
  } catch {
    return Response.json({ error: "อ่าน body ไม่สำเร็จ" }, { status: 400 });
  }

  if (buffer.length === 0) {
    return Response.json({ error: "ไฟล์ว่าง" }, { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    return Response.json(
      { error: `ไฟล์ใหญ่เกิน ${Math.round(MAX_BYTES / 1024 / 1024)} MB` },
      { status: 413 }
    );
  }

  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const filename = `${randomUUID()}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
    return Response.json({ ok: true, url: `/uploads/tickets/${filename}`, bytes: buffer.length });
  } catch (err) {
    console.error("[attachments] เซฟไฟล์ไม่สำเร็จ:", err);
    return Response.json({ error: "เซฟไฟล์ไม่สำเร็จ" }, { status: 500 });
  }
}
