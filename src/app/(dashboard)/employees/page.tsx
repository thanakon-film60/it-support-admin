import { COMPANIES } from "@/lib/companies";
import { DEPARTMENTS, listEmployees, OTHER_DEPARTMENT } from "@/lib/db/employees";
import { listEquipment } from "@/lib/db/equipment";
import { listTickets } from "@/lib/db/tickets";
import { EmployeesBoard } from "@/components/employees/EmployeesBoard";
import { requireSession } from "@/lib/auth";

// อ่านทะเบียนที่แอดมินแก้ได้ตลอด -> ห้าม prerender เป็น static
export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  await requireSession("employees");
  const employees = listEmployees(true);

  // นับประวัติต่อคนไว้ล่วงหน้าฝั่งเซิร์ฟเวอร์ครั้งเดียว (พนักงาน 338 คน × ticket ทั้งหมด
  // ถ้าให้หน้าเว็บนับเองจะกลายเป็นวนซ้อนกันทุกครั้งที่ re-render)
  // หน้าเว็บใช้ตัวเลขนี้บอกว่า "คนไหนลบไม่ได้" ก่อนที่แอดมินจะกดลบแล้วเจอ error
  const ticketCounts: Record<string, number> = {};
  for (const t of listTickets()) {
    ticketCounts[t.requester_id] = (ticketCounts[t.requester_id] ?? 0) + 1;
  }
  const assetCounts: Record<string, number> = {};
  for (const e of listEquipment()) {
    if (!e.current_holder_id) continue;
    assetCounts[e.current_holder_id] = (assetCounts[e.current_holder_id] ?? 0) + 1;
  }

  return (
    <EmployeesBoard
      employees={employees}
      companies={COMPANIES}
      departments={[...DEPARTMENTS, OTHER_DEPARTMENT]}
      otherDepartment={OTHER_DEPARTMENT}
      ticketCounts={ticketCounts}
      assetCounts={assetCounts}
    />
  );
}
