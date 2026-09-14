import { listCustodianRows } from "@/lib/db/equipment";
import { CustodianBoard } from "@/components/assets/CustodianBoard";

export default async function CustodianPage() {
  const rows = await listCustodianRows();
  return <CustodianBoard rows={rows} />;
}
