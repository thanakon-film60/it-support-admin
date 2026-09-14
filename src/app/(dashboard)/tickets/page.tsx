import { listTicketsWithRelations } from "@/lib/db/tickets";
import { TicketsBoard } from "@/components/tickets/TicketsBoard";

export default function TicketsPage() {
  const tickets = listTicketsWithRelations();
  return <TicketsBoard initialTickets={tickets} />;
}
