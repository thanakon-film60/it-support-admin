import { listRepairHistory, listStatusEditors } from "@/lib/db/tickets";
import { RepairHistoryBoard } from "@/components/tickets/RepairHistoryBoard";
import { canNotifyOnLine } from "@/lib/line/notify";

export default function RepairHistoryPage() {
  const rows = listRepairHistory();
  // ประกอบรายชื่อผู้แก้ไขฝั่งเซิร์ฟเวอร์แล้วส่งลงเป็น prop — client component แตะ lib/db เองไม่ได้
  // (จะลาก node:fs เข้า bundle ของเบราว์เซอร์แล้ว next build ล้ม ดู tests/client-bundle.test.cjs)
  const editors = listStatusEditors();
  const notifiable = Object.fromEntries(rows.map((ticket) => [ticket.id, canNotifyOnLine(ticket)]));
  return <RepairHistoryBoard rows={rows} editors={editors} notifiable={notifiable} />;
}
