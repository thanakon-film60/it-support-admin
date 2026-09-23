import { listCustodianRows } from "@/lib/db/equipment";
import { listUsers } from "@/lib/db/users";
import type { CustodianFormOptions } from "@/lib/types";
import { CustodianBoard } from "@/components/assets/CustodianBoard";

export default function CustodianPage() {
  const rows = listCustodianRows();
  const users = listUsers();

  // ประกอบตัวเลือกฝั่งเซิร์ฟเวอร์แล้วส่งลงเป็น prop — client component import lib/db ไม่ได้
  // (จะลาก node:fs เข้า bundle ของเบราว์เซอร์แล้ว next build ล้ม ดู tests/client-bundle.test.cjs)
  const options: CustodianFormOptions = {
    owners: users
      .map((u) => ({
        name: u.display_name.trim(),
        employee_id: u.employee_id,
        department: u.department,
      }))
      .filter((u) => u.name)
      .sort((a, b) => a.name.localeCompare(b.name, "th")),
    departments: [
      ...new Set(users.map((u) => (u.department ?? "").trim()).filter((d) => d && d !== "-")),
    ].sort((a, b) => a.localeCompare(b, "th")),
  };

  return <CustodianBoard rows={rows} options={options} />;
}
