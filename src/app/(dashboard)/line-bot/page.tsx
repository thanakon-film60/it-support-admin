import { requireSession } from "@/lib/auth";
import { listLineStaff } from "@/lib/db/lineStaff";
import { getBotControl } from "@/lib/line/bot-control";
import { LineBotBoard } from "@/components/line-bot/LineBotBoard";
import type { LineStaff } from "@/lib/types";

// สถานะบอทกับคำขอสิทธิ์เปลี่ยนจากแชท LINE ได้ตลอด -> ห้าม prerender เป็น static
export const dynamic = "force-dynamic";

export default async function LineBotPage() {
  await requireSession("line-bot");
  let staff: LineStaff[] = [];
  let loadError: string | null = null;
  try {
    staff = listLineStaff();
  } catch (err) {
    // ไฟล์เสีย -> บอกตรงๆ ห้ามแสดงเป็น "ยังไม่มีใคร" เพราะแอดมินจะอนุมัติใหม่ทับไฟล์ที่ยังกู้ได้
    console.error("[line-bot] อ่านทะเบียนทีม IT ไม่สำเร็จ", err);
    loadError =
      "อ่านไฟล์ทะเบียนทีม IT (data/line_staff.json) ไม่ออก — สิทธิ์เดิมยังไม่ได้ถูกลบ แต่ต้องกู้ไฟล์จาก backup ก่อนจึงจะใช้ส่วนนี้ได้";
  }
  // ถามบอทตอนเปิดหน้า (รอได้ไม่เกิน 5 วินาที) — บอทล่มแล้วหน้านี้ยังต้องเปิดได้เพื่อจัดการสิทธิ์
  const bot = await getBotControl();
  return <LineBotBoard staff={staff} loadError={loadError} bot={bot} />;
}
