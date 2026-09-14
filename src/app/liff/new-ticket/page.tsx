import { listEquipment } from "@/lib/db/equipment";
import { LiffTicketForm } from "@/components/liff/LiffTicketForm";

// สำคัญ: ห้ามให้ Next.js prerender หน้านี้เป็น static ตอน build เพราะ listEquipment() อ่านจาก
// mock data ที่เปลี่ยนแปลงได้ตลอด (และภายหลังจะเป็น query ไป Supabase) ถ้าไม่บังคับ dynamic ไว้
// รายการทรัพย์สินในฟอร์มจะถูก "แช่แข็ง" ไว้ที่ตอน build แทนที่จะเป็นข้อมูลล่าสุดทุกครั้งที่มีคนเปิดหน้านี้
export const dynamic = "force-dynamic";

export default async function NewTicketLiffPage() {
  const allEquipment = await listEquipment();
  const equipmentOptions = allEquipment
    .filter((e) => e.status !== "เลิกใช้งาน")
    .map((e) => ({ id: e.id, label: `${e.asset_code} — ${e.brand_model ?? ""}` }));

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 px-4 py-6">
      <LiffTicketForm equipmentOptions={equipmentOptions} />
    </div>
  );
}
