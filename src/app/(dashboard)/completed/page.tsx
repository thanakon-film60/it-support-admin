import { redirect } from "next/navigation";

/** เส้นทางเก่าของหน้า "เรื่องที่ยืนยันแล้ว" (รวมเข้า /resolved ก่อน แล้ว /resolved รวมเข้า Tickets 21 ต.ค. 2026)
 *  เด้งตรงไปปลายทางสุดท้ายเลย ไม่เด้งสองต่อ — ลิงก์เก่าที่เคยส่งให้กันยังใช้ได้ */
export default function CompletedPage() {
  redirect("/tickets?status=resolved");
}
