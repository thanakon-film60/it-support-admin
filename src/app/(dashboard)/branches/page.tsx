import { COMPANIES, listAllBranches } from "@/lib/db/branches";
import { listTickets } from "@/lib/db/tickets";
import { BranchesBoard } from "@/components/branches/BranchesBoard";

// อ่าน master data ที่แอดมินแก้ได้ตลอด -> ห้าม prerender เป็น static
export const dynamic = "force-dynamic";

export default function BranchesPage() {
  const branches = listAllBranches();

  // นับจำนวนเรื่องต่อสาขาไว้ล่วงหน้าฝั่งเซิร์ฟเวอร์ครั้งเดียว
  // เพื่อให้หน้าเว็บบอกได้ว่าสาขาไหนลบไม่ได้ (มีประวัติผูกอยู่) ก่อนที่แอดมินจะกดลบแล้วเจอ error
  const ticketCounts: Record<string, number> = {};
  for (const t of listTickets()) {
    const key = `${t.company ?? ""}|${t.location.trim()}`;
    ticketCounts[key] = (ticketCounts[key] ?? 0) + 1;
  }

  return (
    <BranchesBoard branches={branches} companies={COMPANIES} ticketCounts={ticketCounts} />
  );
}
