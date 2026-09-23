import fs from "node:fs";
import path from "node:path";
import { SECURITY_FLAGS } from "@/lib/security";
import { COMPANIES, listBranches } from "@/lib/db/branches";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — บอกว่าแอปที่รันอยู่ "เป็นเวอร์ชันไหน และมีอะไรเปิดอยู่บ้าง"
 *
 * ทำไมต้องมี: ก่อนหน้านี้ไม่มีทางรู้เลยว่า container ที่รันอยู่ใช้โค้ดชุดใหม่หรือเก่า
 * ต้องเดาจากอาการ ซึ่งเคยทำให้เสียเวลาไล่บั๊กที่ "แก้ไปแล้ว" อยู่นาน —
 * ปัญหาจริงคือแก้โค้ดแล้วแต่ลืม build ใหม่ ซึ่งจากภายนอกดูเหมือนโค้ดใหม่ไม่ทำงาน
 *
 * ตัว deploy.ps1 เรียก endpoint นี้เพื่อตรวจว่า build ติดจริงไหม แทนการเดาจากหน้า 404
 * (วิธีเดิมแยกไม่ออก เพราะทั้งแอปเก่าและใหม่ต่างก็ตอบ 404 ให้ไฟล์ที่ไม่มีเหมือนกัน)
 *
 * ไม่มีข้อมูลลับในนี้ — บอกแค่ว่าฟีเจอร์ไหนมีอยู่ ไม่บอกเนื้อข้อมูลหรือค่า secret ใดๆ
 */

const DATA_DIR = path.join(process.cwd(), "data");
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

export async function GET() {
  // อ่านชื่อไฟล์ในโฟลเดอร์ข้อมูลเพื่อดูว่า volume ถูก mount จริงไหม
  // เคยมีเคสที่ /app/data ไม่ได้ mount แล้วข้อมูลหายทุกครั้งที่ build ใหม่โดยไม่มีใครรู้
  let dataStore: "ok" | "empty" | "unreadable" = "unreadable";
  let collections: string[] = [];
  try {
    collections = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();
    dataStore = collections.length > 0 ? "ok" : "empty";
  } catch {
    dataStore = "unreadable";
  }

  let uploadsWritable = false;
  try {
    fs.accessSync(UPLOAD_DIR, fs.constants.W_OK);
    uploadsWritable = true;
  } catch {
    uploadsWritable = false;
  }

  return Response.json({
    ok: true,
    // ฟีเจอร์ชุดที่เพิ่มเข้ามารอบนี้ — ถ้า endpoint นี้ตอบได้ แปลว่าโค้ดชุดใหม่ติดแล้วแน่นอน
    features: {
      // route เสิร์ฟรูปที่อัปโหลดตอน runtime (Next.js อ่าน public/ แค่ตอนสตาร์ท)
      uploads_route: true,
      // endpoint รับรูปจากบอท LINE
      attachments_api: true,
      // สถานะที่จะ push แจ้งผู้แจ้งทาง LINE
      ticket_status_notify: process.env.LINE_NOTIFY_STATUSES ?? "resolved,closed,cancelled",
      // ตั้งค่า LINE ครบไหม (บอกแค่ว่ามี/ไม่มี ไม่เปิดเผยค่า)
      line_token_configured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
      internal_api_key_configured: Boolean(process.env.INTERNAL_API_KEY),
      // บันทึก log ตอนผู้ใช้กดปุ่ม "เช็คสถานะเรื่องนี้" ในแชท
      ticket_view_log: true,
      // บริษัท/สาขาเป็น master data จริงแล้ว (เดิม derive จาก location ของ ticket เก่า)
      // การเรียก listBranches() ตรงนี้ยัง seed data/branches.json ให้ในการ deploy ครั้งแรกด้วย
      // จึงไม่ต้องมีขั้นตอน migrate แยก — แค่ deploy แล้วเปิด /api/health ก็พร้อมใช้
      company_branches: {
        companies: COMPANIES.length,
        branches: listBranches().length,
      },
      // ตั้ง LINE_ADMIN_USER_IDS ไว้หรือยัง — ไม่ตั้ง = ไม่ push แค่ขึ้นในหน้าแอดมิน
      viewed_push_recipients: (process.env.LINE_ADMIN_USER_IDS ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean).length,
    },
    // สวิตช์ความปลอดภัยฝั่งหน้าเว็บ — ตัวคอมโพเนนต์ที่กด Inspect ไม่ได้นั้น "ไม่มีร่องรอยใน DOM"
    // เวลาไม่ทำงาน จึงไม่มีทางตรวจจากหน้าเว็บได้เลยว่าเปิดอยู่จริงหรือลืม deploy
    // เอามาโชว์ตรงนี้แทน จะได้ตรวจด้วย curl ได้ในคำสั่งเดียว
    security: {
      block_devtools: SECURITY_FLAGS.blockDevTools,
      block_context_menu: SECURITY_FLAGS.blockContextMenu,
      devtools_detect: SECURITY_FLAGS.detectDevToolsOpen,
      // หัวข้อความปลอดภัยที่ next.config.ts ใส่ให้ทุก path (ตรวจจริงได้ด้วย curl -I)
      security_headers: true,
      // ⚠️ ค่านี้คือชั้นป้องกันจริงชั้นเดียวที่มี — ที่เหลือแค่กันคนอยากรู้อยากเห็น
      auth_enabled: process.env.AUTH_DISABLED !== "true",
    },
    storage: {
      data_store: dataStore,
      collections,
      uploads_writable: uploadsWritable,
    },
  });
}
