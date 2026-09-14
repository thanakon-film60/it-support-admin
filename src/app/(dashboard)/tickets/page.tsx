import { listTicketsWithRelations } from "@/lib/db/tickets";
import { TicketsBoard } from "@/components/tickets/TicketsBoard";

export default async function TicketsPage() {
  const tickets = await listTicketsWithRelations();
  return <TicketsBoard initialTickets={tickets} />;
}
