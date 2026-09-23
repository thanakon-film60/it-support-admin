import { listStockItemsWithStatus } from "@/lib/db/stock";
import { getSession } from "@/lib/auth";
import { StockBoard } from "@/components/stock/StockBoard";

// searchParams ของ Next.js 16 เป็น Promise — ดูหมายเหตุเดียวกันที่หน้า tickets
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  // "low" = ใกล้หมดทั้งสองระดับ (ถึงขั้นต่ำ + ต่ำกว่า) ให้ตรงกับตัวเลขบนการ์ดหน้าภาพรวม
  const initialStatus = ["low", "ปกติ", "ถึงขั้นต่ำ", "ต่ำกว่า"].includes(raw ?? "")
    ? (raw as string)
    : "all";

  const items = listStockItemsWithStatus();
  const session = await getSession();
  return (
    <StockBoard
      items={items}
      staffName={session?.displayName ?? "ไม่ระบุ"}
      initialStatus={initialStatus}
    />
  );
}
