import { listFaqItems } from "@/lib/db/faq";
import { FaqBoard } from "@/components/faq/FaqBoard";

export default function FaqPage() {
  const items = listFaqItems();
  return <FaqBoard items={items} />;
}
