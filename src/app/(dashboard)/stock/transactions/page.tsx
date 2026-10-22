import { listStockTransactions } from "@/lib/db/stock";
import { StockTransactionsBoard } from "@/components/stock/StockTransactionsBoard";
import { requireSession } from "@/lib/auth";

export default async function StockTransactionsPage() {
  await requireSession("stock");
  const transactions = listStockTransactions();
  return <StockTransactionsBoard transactions={transactions} />;
}
