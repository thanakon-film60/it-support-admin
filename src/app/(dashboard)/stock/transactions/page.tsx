import { listStockTransactions } from "@/lib/db/stock";
import { StockTransactionsBoard } from "@/components/stock/StockTransactionsBoard";

export default function StockTransactionsPage() {
  const transactions = listStockTransactions();
  return <StockTransactionsBoard transactions={transactions} />;
}
