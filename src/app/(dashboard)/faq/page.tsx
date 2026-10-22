import { listFaqItems } from "@/lib/db/faq";
import { FaqBoard } from "@/components/faq/FaqBoard";
import { requireSession } from "@/lib/auth";

export default async function FaqPage() {
  await requireSession("faq");
  const items = listFaqItems();
  return <FaqBoard items={items} />;
}
