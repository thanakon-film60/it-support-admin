"use server";

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createFaqItem, deleteFaqItem } from "@/lib/db/faq";
import type { FaqCategory } from "@/lib/types";

export interface FaqFormState {
  error?: string;
  success?: boolean;
}

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "faq");

/** เซฟไฟล์รูปลง /public/uploads/faq จริง แล้วคืน URL สาธารณะ (path เดียวกับที่จะใช้เป็น
 *  Supabase Storage public URL ในอนาคต — ดู PROJECT.md หัวข้อย้ายไป Supabase) */
async function saveImages(files: File[]): Promise<string[]> {
  const valid = files.filter((f) => f && f.size > 0);
  if (valid.length === 0) return [];

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const urls: string[] = [];
  for (const file of valid) {
    const ext = path.extname(file.name) || ".jpg";
    const filename = `${randomUUID()}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
    urls.push(`/uploads/faq/${filename}`);
  }
  return urls;
}

export async function createFaqItemAction(
  _prev: FaqFormState,
  formData: FormData
): Promise<FaqFormState> {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!title || !content) {
    return { error: "กรุณากรอกหัวข้อและเนื้อหาวิธีแก้ไข" };
  }

  const keywords = String(formData.get("keywords") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const files = formData.getAll("images").filter((f): f is File => f instanceof File);
  const image_urls = await saveImages(files);

  createFaqItem({
    title,
    keywords,
    content,
    category: String(formData.get("category") ?? "general") as FaqCategory,
    image_urls,
  });

  revalidatePath("/faq");
  return { success: true };
}

export async function deleteFaqItemAction(id: string) {
  await requireSession();
  deleteFaqItem(id);
  revalidatePath("/faq");
}
