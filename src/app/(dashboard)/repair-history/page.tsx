import { listRepairHistory } from "@/lib/db/tickets";
import { RepairHistoryBoard } from "@/components/tickets/RepairHistoryBoard";

export default function RepairHistoryPage() {
  const rows = listRepairHistory();
  return <RepairHistoryBoard rows={rows} />;
}
