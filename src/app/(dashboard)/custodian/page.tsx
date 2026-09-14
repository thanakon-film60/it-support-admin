import { listCustodianRows } from "@/lib/db/equipment";
import { CustodianBoard } from "@/components/assets/CustodianBoard";

export default function CustodianPage() {
  const rows = listCustodianRows();
  return <CustodianBoard rows={rows} />;
}
