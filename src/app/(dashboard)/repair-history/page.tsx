import { redirect } from "next/navigation";

/** หน้า "ประวัติซ่อม" เดิม — รวมเข้าหน้า Tickets แล้ว (21 ต.ค. 2026 ผู้ใช้ขอ)
 *
 *  ประวัติซ่อม = Tickets ที่กรองประเภท "แจ้งซ่อม" (ค่าซ่อม/ทรัพย์สิน/ยอดรวมอยู่ในหน้า Tickets ครบ)
 *  เก็บเส้นทางไว้ให้ลิงก์/บุ๊กมาร์กเก่ายังใช้ได้ — หน้านี้ไม่อ่านข้อมูลเอง จึงไม่ต้องตรวจสิทธิ์ */
export default function RepairHistoryPage() {
  redirect("/tickets?type=repair");
}
