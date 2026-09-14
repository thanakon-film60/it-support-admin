import { listRepairHistory } from "@/lib/db/tickets";
import { RepairHistoryBoard } from "@/components/tickets/RepairHistoryBoard";

export default async function RepairHistoryPage() {
  const rows = await listRepairHistory();
  return <RepairHistoryBoard rows={rows} />;
}
