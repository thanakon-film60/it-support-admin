"use client";

import { useState, useTransition } from "react";
import type { FaqCategory, FaqItem } from "@/lib/types";
import { FAQ_CATEGORY_LABEL } from "@/lib/labels";
import { Button } from "@/components/ui/Button";
import { Field, MODAL_INPUT, Modal } from "@/components/ui/Modal";
import { createFaqItemAction, updateFaqItemAction } from "@/app/actions/faq";

const CATEGORY_OPTIONS = Object.entries(FAQ_CATEGORY_LABEL) as [FaqCategory, string][];

/** null = ปิด · "new" = เพิ่มใหม่ · ที่เหลือคือ FAQ ที่กำลังแก้ */
export type FaqEditing = { mode: "new" } | { mode: "edit"; faq: FaqItem } | null;

export function FaqModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: FaqEditing;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const faq = editing?.mode === "edit" ? editing.faq : null;

  // รูปเดิมที่ผู้ใช้กดเอาออกในรอบแก้ไขนี้ — ส่งไปกับฟอร์มให้ฝั่งเซิร์ฟเวอร์ตัดออกตอนบันทึก
  // เก็บเป็น state แยกเพื่อให้กด "เอาออก" แล้วเห็นผลทันที โดยยังไม่แตะข้อมูลจริงจนกว่าจะกดบันทึก
  const [removed, setRemoved] = useState<string[]>([]);
  const remaining = (faq?.image_urls ?? []).filter((u) => !removed.includes(u));

  function close() {
    setRemoved([]);
    setError(null);
    onClose();
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    formData.set("removed_images", removed.join(","));
    startTransition(async () => {
      const result = faq
        ? await updateFaqItemAction(faq.id, {}, formData)
        : await createFaqItemAction({}, formData);
      if (result.error) setError(result.error);
      else {
        setRemoved([]);
        onSaved();
      }
    });
  }

  return (
    <Modal
      open={editing !== null}
      onClose={close}
      title={faq ? "แก้ไข FAQ" : "เพิ่มคำถามที่พบบ่อย"}
      description="บอทใช้ keyword ชุดนี้จับคู่กับข้อความของผู้ใช้ เพื่อเสนอวิธีแก้ก่อนเปิด ticket"
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={close} className="w-full sm:w-auto">
            ยกเลิก
          </Button>
          <Button type="submit" form="faq-form" disabled={isPending} className="w-full sm:w-auto">
            {isPending ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </>
      }
    >
      <form
        id="faq-form"
        key={faq?.id ?? "new"}
        // ไม่ต้องใส่ encType เอง: form ที่ action เป็นฟังก์ชัน React จัดการเข้ารหัสให้ครบ
        // รวมถึงไฟล์แนบ — ใส่เองจะโดน React เตือนว่าค่าถูกเขียนทับอยู่ดี
        action={handleSubmit}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label="หัวข้อ" required>
          <input
            name="title"
            required
            defaultValue={faq?.title ?? ""}
            placeholder="เช่น เครื่องพิมพ์ไม่ทำงาน"
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="หมวดหมู่">
          <select
            name="category"
            defaultValue={faq?.category ?? "general"}
            className={MODAL_INPUT}
          >
            {CATEGORY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Keywords"
          hint="คั่นด้วยจุลภาค — ใส่คำที่คนพิมพ์จริง ไม่ใช่ศัพท์ทางการ"
          className="sm:col-span-2"
        >
          <input
            name="keywords"
            defaultValue={faq?.keywords.join(", ") ?? ""}
            placeholder="ปริ้นไม่ออก, ปริ้นไม่ได้, เครื่องปริ้นเตอร์"
            className={MODAL_INPUT}
          />
        </Field>

        <Field label="เนื้อหา / วิธีแก้ไข" required className="sm:col-span-2">
          <textarea
            name="content"
            required
            rows={6}
            defaultValue={faq?.content ?? ""}
            className={`${MODAL_INPUT} min-h-[8rem] resize-y`}
          />
        </Field>

        {remaining.length > 0 && (
          <Field label="รูปที่แนบอยู่" hint="กด ✕ เพื่อเอาออก จะมีผลเมื่อกดบันทึก" className="sm:col-span-2">
            <div className="flex flex-wrap gap-2">
              {remaining.map((url) => (
                <span key={url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- รูปอัปโหลดขนาดไม่แน่นอน แสดงเป็น thumbnail */}
                  <img
                    src={url}
                    alt=""
                    className="h-20 w-20 rounded-lg border border-line object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setRemoved((prev) => [...prev, url])}
                    aria-label="เอารูปนี้ออก"
                    className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500/90 text-xs text-white"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </Field>
        )}

        <Field
          label={faq ? "เพิ่มรูปใหม่" : "รูปภาพประกอบ"}
          hint="เลือกได้หลายรูป"
          className="sm:col-span-2"
        >
          <input
            name="images"
            type="file"
            accept="image/*"
            multiple
            className="text-sm text-muted file:mr-3 file:min-h-[2.5rem] file:rounded-lg file:border-0 file:bg-accent-bg file:px-3 file:text-accent"
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300 sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
