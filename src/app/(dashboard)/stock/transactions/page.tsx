import { listStockTransactions } from "@/lib/db/stock";
import { StockTransactionsBoard } from "@/components/stock/StockTransactionsBoard";

export default async function StockTransactionsPage() {
  const transactions = await listStockTransactions();
  return <StockTransactionsBoard transactions={transactions} />;
}
