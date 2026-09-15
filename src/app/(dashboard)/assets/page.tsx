import { listEquipmentSummary } from "@/lib/db/equipment";
import { AssetsBoard } from "@/components/assets/AssetsBoard";

export default function AssetsPage() {
  const equipment = listEquipmentSummary();
  return <AssetsBoard equipment={equipment} />;
}
