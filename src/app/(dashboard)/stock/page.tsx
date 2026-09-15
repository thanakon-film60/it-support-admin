import { listStockItemsWithStatus } from "@/lib/db/stock";
import { getSession } from "@/lib/auth";
import { StockBoard } from "@/components/stock/StockBoard";

export default async function StockPage() {
  const items = listStockItemsWithStatus();
  const session = await getSession();
  return <StockBoard items={items} staffName={session?.displayName ?? "ไม่ระบุ"} />;
}
