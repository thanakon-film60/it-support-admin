"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FaqItem } from "@/lib/types";
import { FAQ_CATEGORY_LABEL } from "@/lib/labels";
import { Card } from "@/components/ui/Card";
import { FaqForm } from "./FaqForm";
import { deleteFaqItemAction } from "@/app/actions/faq";

export function FaqBoard({ items }: { items: FaqItem[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (f) =>
        f.title.toLowerCase().includes(q) ||
        f.keywords.some((k) => k.toLowerCase().includes(q)) ||
        f.content.toLowerCase().includes(q)
    );
  }, [items, search]);

  function handleDelete(id: string) {
    if (!window.confirm("ยืนยันการลบ FAQ นี้?")) return;
    setDeletingId(id);
    startTransition(async () => {
      await deleteFaqItemAction(id);
      router.refresh();
      setDeletingId(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">FAQ Bot</h1>
        <p className="text-sm text-muted">
          ฐานความรู้ที่ LINE Bot ใช้จับคู่ Keyword เพื่อแนะนำวิธีแก้ก่อนสร้าง Ticket · ทั้งหมด{" "}
          {items.length} รายการ
        </p>
      </div>

      <FaqForm />

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="ค้นหาหัวข้อ, keyword, เนื้อหา..."
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:max-w-xs"
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((faq) => (
          <Card key={faq.id} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="rounded-full bg-accent-bg px-2.5 py-1 text-xs font-semibold text-accent">
                  {FAQ_CATEGORY_LABEL[faq.category]}
                </span>
                <h3 className="mt-2 text-sm font-semibold text-ink">{faq.title}</h3>
              </div>
              <button
                onClick={() => handleDelete(faq.id)}
                disabled={isPending && deletingId === faq.id}
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                aria-label="ลบ"
              >
                🗑
              </button>
            </div>

            {faq.image_urls.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {faq.image_urls.map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element -- รูปอัปโหลดขนาดไม่แน่นอน แสดงเป็น thumbnail เล็กในการ์ด
                  <img
                    key={url}
                    src={url}
                    alt={faq.title}
                    className="h-20 w-20 shrink-0 rounded-lg border border-line object-cover"
                  />
                ))}
              </div>
            )}

            <p className="whitespace-pre-wrap text-sm text-muted">{faq.content}</p>

            {faq.keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {faq.keywords.map((k, i) => (
                  <span
                    key={`${faq.id}-${i}-${k}`}
                    className="rounded-full border border-line px-2 py-0.5 text-xs text-muted"
                  >
                    #{k}
                  </span>
                ))}
              </div>
            )}
          </Card>
        ))}
        {visible.length === 0 && (
          <p className="col-span-full py-10 text-center text-muted">
            ไม่พบ FAQ ที่ตรงกับเงื่อนไข
          </p>
        )}
      </div>
    </div>
  );
}
