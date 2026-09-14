// Mock data store: อ่าน/เขียนเป็นไฟล์ JSON ใน /data (root ของโปรเจกต์)
//
// นี่คือ "adapter" ชั้นเดียวที่แตะ filesystem ตรงๆ — โมดูลอื่นทั้งหมด (users.ts, tickets.ts, ...)
// เรียกผ่านฟังก์ชันนี้เท่านั้น ไม่ยุ่งกับ fs โดยตรง เพื่อให้วันที่ย้ายไป Supabase จริง
// เราแค่เขียน adapter ใหม่ที่ implement signature เดียวกัน (อ่าน "PROJECT.md" หัวข้อ
// "ย้ายจาก mock data ไป Supabase" ประกอบ) แล้วสลับ import ในไฟล์ repo แต่ละตัว
//
// หมายเหตุ: ใช้ fs แบบ sync เจตนา เพราะข้อมูลเป็นชุดเล็ก (mock/dev only) และทำให้ไม่ต้อง
// กังวลเรื่อง race condition ระหว่าง request ที่ทับกัน — โปรดอย่านำ pattern นี้ไปใช้กับ
// ข้อมูลจริงขนาดใหญ่ใน production

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");

function filePath(name: string) {
  return path.join(DATA_DIR, `${name}.json`);
}

/**
 * อ่านทั้ง collection จากไฟล์ JSON ชื่อ `${name}.json`
 * ถ้ายังไม่มีไฟล์ (รันครั้งแรก) จะสร้างจาก seedFn แล้วเขียนลงดิสก์ให้อัตโนมัติ
 */
export function readCollection<T>(name: string, seedFn?: () => T[]): T[] {
  const p = filePath(name);
  if (!fs.existsSync(p)) {
    const seed = seedFn ? seedFn() : [];
    writeCollection(name, seed);
    return seed;
  }
  const raw = fs.readFileSync(p, "utf-8");
  if (!raw.trim()) return [];
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

export function writeCollection<T>(name: string, data: T[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), "utf-8");
}

export function upsertOne<T extends { id: string }>(
  name: string,
  item: T,
  seedFn?: () => T[]
): T {
  const all = readCollection<T>(name, seedFn);
  const idx = all.findIndex((x) => x.id === item.id);
  if (idx === -1) all.push(item);
  else all[idx] = item;
  writeCollection(name, all);
  return item;
}

export function patchOne<T extends { id: string }>(
  name: string,
  id: string,
  patch: Partial<T>,
  seedFn?: () => T[]
): T | null {
  const all = readCollection<T>(name, seedFn);
  const idx = all.findIndex((x) => x.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...patch };
  writeCollection(name, all);
  return all[idx];
}
