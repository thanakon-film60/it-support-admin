import { StatCard } from "@/components/ui/Card";
import { ticketCountsByStatus } from "@/lib/db/tickets";
import { listEquipment } from "@/lib/db/equipment";
import { listStockItemsWithStatus } from "@/lib/db/stock";

export default function OverviewPage() {
  const ticketCounts = ticketCountsByStatus();
  const equipment = listEquipment();
  const stockItems = listStockItemsWithStatus();

  const inRepairCount = equipment.filter((e) => e.status === "ส่งซ่อม").length;
  const lowStockCount = stockItems.filter((s) => s.stock_status !== "ปกติ").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-ink">ภาพรวม</h1>
        <p className="text-sm text-muted">สรุปสถานะระบบ IT Support ทั้งหมด</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon="🎫" label="Ticket ทั้งหมด" value={ticketCounts.all} />
        <StatCard
          icon="⏳"
          label="รอดำเนินการ"
          value={ticketCounts.pending}
          tone="warning"
        />
        <StatCard icon="💻" label="ทรัพย์สินทั้งหมด" value={equipment.length} />
        <StatCard
          icon="🔧"
          label="อุปกรณ์ในการซ่อม"
          value={inRepairCount}
          tone="warning"
        />
        <StatCard
          icon="📦"
          label="สต็อกใกล้หมด"
          value={lowStockCount}
          tone={lowStockCount > 0 ? "danger" : "default"}
        />
      </div>
    </div>
  );
}
