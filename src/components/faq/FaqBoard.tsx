"use client";

import { useMemo, useState, useTransition } from "react";
import { Pagination, usePaginated } from "@/components/ui/Pagination";
import { useRouter } from "next/navigation";
import type { FaqItem } from "@/lib/types";
import { FAQ_CATEGORY_LABEL } from "@/lib/labels";
import { Card, PageHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { FaqModal, type FaqEditing } from "./FaqModal";
import { deleteFaqItemAction } from "@/app/actions/faq";

export function FaqBoard({ items }: { items: FaqItem[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<FaqEditing>(null);
  const [deleting, setDeleting] = useState<FaqItem | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  function confirmDelete() {
    if (!deleting) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteFaqItemAction(deleting.id);
      if (result?.error) setError(result.error);
      else {
        setDeleting(null);
        router.refresh();
      }
    });
  }

  // แบ่งหน้า — ทำงานบน "รายการที่ผ่านตัวกรองแล้ว" ไม่ใช่ข้อมูลดิบ
  // ค้นหา/กรองจึงยังทำกับข้อมูลทั้งชุดเหมือนเดิม แค่ตัดเป็นหน้าๆ ตอนแสดงผล
  const pager = usePaginated(visible, { storageKey: "faq" });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="FAQ Bot"
        description={`ฐานความรู้ที่ LINE Bot ใช้จับคู่ Keyword เพื่อแนะนำวิธีแก้ก่อนสร้าง Ticket · ทั้งหมด ${items.length} รายการ`}
        actions={<Button onClick={() => setEditing({ mode: "new" })}>+ เพิ่ม FAQ</Button>}
      />

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="ค้นหาหัวข้อ, keyword, เนื้อหา..."
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:max-w-xs"
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {pager.items.map((faq) => (
          <Card key={faq.id} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="rounded-full bg-accent-bg px-2.5 py-1 text-xs font-semibold text-accent">
                  {FAQ_CATEGORY_LABEL[faq.category]}
                </span>
                <h3 className="mt-2 text-sm font-semibold text-ink">{faq.title}</h3>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => setEditing({ mode: "edit", faq })}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-xs text-muted transition hover:bg-accent-bg hover:text-accent"
                  aria-label={`แก้ไข ${faq.title}`}
                >
                  ✏️
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(faq)}
                  disabled={isPending}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-xs text-muted transition hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
                  aria-label={`ลบ ${faq.title}`}
                >
                  🗑
                </button>
              </div>
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
      <Pagination pager={pager} unitLabel="ข้อ" />

      <FaqModal
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => {
          setDeleting(null);
          setError(null);
        }}
        onConfirm={confirmDelete}
        pending={isPending}
        title="ลบ FAQ"
        message={
          deleting ? (
            <>
              ต้องการลบ <span className="font-semibold">{deleting.title}</span> ใช่ไหม
              <span className="mt-1 block text-xs text-muted">
                บอทจะไม่เสนอวิธีแก้ข้อนี้ให้ผู้ใช้อีก
              </span>
            </>
          ) : null
        }
        blockedReason={error}
      />
    </div>
  );
}
