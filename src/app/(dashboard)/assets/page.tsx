import { listEquipment, listEquipmentSummary } from "@/lib/db/equipment";
import { listUsers } from "@/lib/db/users";
import type { AssetFormOptions, EquipmentStatus } from "@/lib/types";
import { AssetsBoard } from "@/components/assets/AssetsBoard";

/** ตัดค่าว่าง/ขีด ตัดช่องว่างหัวท้าย ตัดตัวซ้ำ แล้วเรียงแบบภาษาไทย */
function uniqSorted(values: (string | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const t = (v ?? "").trim();
    if (t && t !== "-") set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "th"));
}

/** สถานะทรัพย์สินที่ยอมรับจาก URL — ต้องตรงกับ EquipmentStatus ใน types.ts */
const EQUIPMENT_STATUSES: EquipmentStatus[] = [
  "ว่าง",
  "จองแล้ว",
  "ใช้งานอยู่",
  "ส่งซ่อม",
  "เลิกใช้งาน",
];

// searchParams ของ Next.js 16 เป็น Promise — ดูหมายเหตุเดียวกันที่หน้า tickets
export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const initialStatus: "all" | EquipmentStatus = EQUIPMENT_STATUSES.includes(
    raw as EquipmentStatus
  )
    ? (raw as EquipmentStatus)
    : "all";

  const equipment = listEquipmentSummary();
  const all = listEquipment();
  const users = listUsers();

  // สร้างตัวเลือก dropdown จากข้อมูลจริงในระบบ ไม่ได้ hardcode ไว้ในฟอร์ม
  // เพิ่มทรัพย์สินใหม่ที่มียี่ห้อ/สถานที่ที่ยังไม่เคยมี รอบหน้าค่านั้นจะโผล่ในตัวเลือกเอง
  const options: AssetFormOptions = {
    brands: uniqSorted(all.map((e) => e.brand_model)),
    locations: uniqSorted(all.map((e) => e.install_location)),
    departments: uniqSorted(users.map((u) => u.department)),
    owners: users
      .map((u) => ({
        name: u.display_name.trim(),
        employee_id: u.employee_id,
        department: u.department,
      }))
      .filter((u) => u.name)
      .sort((a, b) => a.name.localeCompare(b.name, "th")),
    assetCodes: uniqSorted(all.map((e) => e.asset_code.toUpperCase())),
  };

  return <AssetsBoard equipment={equipment} options={options} initialStatus={initialStatus} />;
}
