import { listFaqItems } from "@/lib/db/faq";
import { FaqBoard } from "@/components/faq/FaqBoard";

export default async function FaqPage() {
  const items = await listFaqItems();
  return <FaqBoard items={items} />;
}
