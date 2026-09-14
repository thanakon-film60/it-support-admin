import { listEquipmentSummary } from "@/lib/db/equipment";
import { AssetsBoard } from "@/components/assets/AssetsBoard";

export default async function AssetsPage() {
  const equipment = await listEquipmentSummary();
  return <AssetsBoard equipment={equipment} />;
}
