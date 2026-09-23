import { listEquipment } from "@/lib/db/equipment";
import { COMPANIES, listBranches } from "@/lib/db/branches";
import { LiffTicketForm } from "@/components/liff/LiffTicketForm";

// สำคัญ: ห้ามให้ Next.js prerender หน้านี้เป็น static ตอน build เพราะ listEquipment() อ่านจาก
// mock data ที่เปลี่ยนแปลงได้ตลอด (และภายหลังจะเป็น query ไป Supabase) ถ้าไม่บังคับ dynamic ไว้
// รายการทรัพย์สินในฟอร์มจะถูก "แช่แข็ง" ไว้ที่ตอน build แทนที่จะเป็นข้อมูลล่าสุดทุกครั้งที่มีคนเปิดหน้านี้
// เหตุผลเดียวกันนี้ใช้กับรายชื่อสาขาด้วย — สาขาเปิดใหม่ต้องโผล่ในฟอร์มทันทีโดยไม่ต้อง build ใหม่
export const dynamic = "force-dynamic";

export default function NewTicketLiffPage() {
  const equipmentOptions = listEquipment()
    .filter((e) => e.status !== "เลิกใช้งาน")
    .map((e) => ({ id: e.id, label: `${e.asset_code} — ${e.brand_model ?? ""}` }));

  // ส่งเฉพาะฟิลด์ที่ฟอร์มใช้จริง ไม่ส่งทั้งแถว (id/created_at/ผู้จัดการ ไม่ได้ใช้ในฟอร์ม
  // และไม่ควรหลุดออกไปหน้า public ที่ไม่ต้อง login)
  const branches = listBranches().map((b) => ({
    company: b.company,
    name: b.name,
    group: b.group,
    floor: b.floor,
  }));

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 px-4 py-6">
      <LiffTicketForm
        equipmentOptions={equipmentOptions}
        companies={COMPANIES}
        branches={branches}
      />
    </div>
  );
}
