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

/** ไฟล์อ่านไม่ออก — readCollectionStrict โยนตัวนี้แทนการแกล้งทำเป็นว่า "ยังไม่มีข้อมูล" */
export class CollectionReadError extends Error {
  constructor(name: string) {
    super(`อ่านไฟล์ ${name}.json ไม่ออก (ไฟล์เสีย)`);
    this.name = "CollectionReadError";
  }
}

/**
 * อ่าน collection แบบไม่กลืน error — ไฟล์ที่มีอยู่แต่อ่านไม่ออกจะ throw แทนการคืน []
 *
 * readCollection ข้างบนคืน [] เมื่อ JSON พัง ซึ่งพอรับได้กับข้อมูลที่ seed กลับมาเองได้
 * แต่อันตรายมากกับข้อมูลที่คนพิมพ์เอง (หน้าฝากข้อความ): หน้าเว็บจะเห็นว่า "ว่าง" แล้วการบันทึก
 * ครั้งถัดไปจะเขียน [ข้อความใหม่ 1 อัน] ทับไฟล์เดิมทั้งไฟล์ ข้อความเก่าทั้งหมดหายโดยไม่มีอะไรฟ้อง
 * ไฟล์ยังไม่มี = ยังไม่เคยบันทึก -> คืน [] ได้ตามปกติ และไม่สร้างไฟล์จนกว่าจะเขียนจริง
 * ไฟล์ว่าง 0 ไบต์ถือว่าเสีย เพราะ writeCollection เขียนอย่างน้อย "[]" เสมอ
 */
export function readCollectionStrict<T>(name: string): T[] {
  const p = filePath(name);
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CollectionReadError(name);
  }
  if (!Array.isArray(parsed)) throw new CollectionReadError(name);
  return parsed as T[];
}

export function writeCollection<T>(name: string, data: T[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const target = filePath(name);
  const body = JSON.stringify(data, null, 2);
  // เขียนลงไฟล์ชั่วคราวก่อนแล้วค่อย rename ทับ — rename ในระบบไฟล์เดียวกันเป็น atomic
  // ถ้าโปรเซสตายกลางทาง (container restart / ไฟดับ) ไฟล์จริงยังเป็นชุดเดิมครบ ไม่ใช่ครึ่งไฟล์
  // ไฟล์ครึ่งไฟล์อันตรายกว่าที่เห็น: readCollection อ่านไม่ออกจะคืน [] แล้วการเขียนครั้งถัดไปทับของเดิมหมด
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, "utf-8");
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ลบไฟล์ชั่วคราวไม่ได้ก็ไม่เสียหาย — ไม่มีโค้ดไหนอ่านไฟล์ .tmp
    }
    // Windows (ตอนรัน npm run dev) rename ทับไฟล์ที่โปรแกรมอื่นเปิดค้างอยู่ไม่ได้ เช่น antivirus
    // กำลังสแกน — ถอยไปเขียนตรงแบบเดิม ดีกว่าทำให้การบันทึกล้มทั้งที่เมื่อก่อนบันทึกได้
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw err;
    fs.writeFileSync(target, body, "utf-8");
  }
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
