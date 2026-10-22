// ค่าคงที่และฟังก์ชันของคลังไฟล์ (/files) ที่ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และฝั่งเบราว์เซอร์
//
// แยกจาก db/drive.ts และ lib/drive/storage.ts ด้วยเหตุผลเดียวกับ lib/companies.ts — สองไฟล์นั้น import
// node:fs ถ้า client component แตะเมื่อไหร่ next build ล้มทั้งหน้า (tests/client-bundle.test.cjs กันไว้)
// กฎตรวจชื่อ/ขนาดอยู่ที่นี่ที่เดียว หน้าเว็บจึงบอกผู้ใช้ได้ทันทีด้วยกฎเดียวกับที่เซิร์ฟเวอร์ใช้ตัดสินจริง

import type { DriveFile, DriveFolder } from "./types";

/** ขนาดสูงสุดต่อไฟล์ — ตกลงกับผู้ใช้ไว้ที่ 500 MB (พอสำหรับไฟล์ติดตั้งโปรแกรม/ไดรเวอร์ส่วนใหญ่)
 *  ไฟล์อยู่บนดิสก์เครื่องในออฟฟิศที่รันระบบ ถ้าเพดานสูงกว่านี้ไม่กี่ไฟล์ก็กินพื้นที่จนระบบอื่นเขียนข้อมูลไม่ได้ */
export const DRIVE_MAX_FILE_BYTES = 500 * 1024 * 1024;

/** ขนาดท่อนที่ส่งต่อ 1 request — ต้องต่ำกว่า 10 MB เสมอ
 *
 *  1. ถ้า proxy.ts ของ Next ทำงาน มันบัฟเฟอร์ body ได้แค่ 10 MB แล้ว "ตัดทิ้งเงียบๆ" ไม่ error
 *     (ดู node_modules/next/dist/docs/.../proxyClientMaxBodySize.md) ไฟล์จะเสียโดยไม่มีใครรู้
 *  2. Node ตัด request ที่ส่งไม่จบใน 5 นาที (server.requestTimeout) — ไฟล์ 500 MB ผ่านเน็ตออฟฟิศ
 *     ส่งทีเดียวไม่ทันแน่ แต่ท่อนละ 8 MB ใช้เวลาไม่กี่วินาที และล้มแล้วส่งซ้ำเฉพาะท่อนนั้นได้ */
export const DRIVE_CHUNK_BYTES = 8 * 1024 * 1024;

export const DRIVE_NAME_MAX = 200;
export const DRIVE_NOTE_MAX = 2000;

/** header ที่ทุกคำขอเปลี่ยนข้อมูลต้องมี — เว็บอื่นส่ง header แปลกๆ ข้ามโดเมนไม่ได้ถ้าไม่ผ่าน CORS
 *  จึงกันการแอบสั่งอัปโหลด/ลบจากหน้าเว็บอื่นที่แอดมินเปิดอยู่ (CSRF) อีกชั้นนอกจาก cookie SameSite=Lax */
export const DRIVE_HEADER = "x-drive-client";

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/** ทำความสะอาดชื่อไฟล์/โฟลเดอร์ — ชื่อนี้ไปอยู่ทั้งในหน้าเว็บและในชื่อไฟล์ตอนดาวน์โหลด
 *  ตัวคั่น path (/ \) กลายเป็น "-" ไม่ใช่ปฏิเสธ เพราะชื่อไฟล์จริงมีได้ เช่น "ใบเสนอราคา 1/2" */
export function cleanDriveName(raw: unknown, what: "ไฟล์" | "โฟลเดอร์" = "ไฟล์"): NameCheck {
  if (typeof raw !== "string") return { ok: false, error: `ชื่อ${what}ไม่ถูกต้อง` };
  // ช่องว่างทุกแบบ (รวมขึ้นบรรทัด/แท็บ) กลายเป็นเว้นวรรคเดียวก่อน แล้วค่อยตัดตัวควบคุมที่เหลือ
  // ถ้าสลับลำดับ คำที่ถูกคั่นด้วยการขึ้นบรรทัดจะติดกันเป็นคำเดียว
  const name = raw
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "-")
    .trim();
  if (!name || name === "." || name === "..") return { ok: false, error: `ตั้งชื่อ${what}ก่อน` };
  if (name.length > DRIVE_NAME_MAX) {
    return { ok: false, error: `ชื่อ${what}ยาวเกิน ${DRIVE_NAME_MAX} ตัวอักษร` };
  }
  return { ok: true, name };
}

/** ข้อความกำกับไฟล์ — ว่าง = null · ยาวเกินถือว่าผิด (ไม่ตัดทิ้งเงียบๆ ให้ผู้ใช้เลือกเองว่าจะเก็บส่วนไหน) */
export function cleanDriveNote(raw: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, note: null };
  if (typeof raw !== "string") return { ok: false, error: "ข้อความกำกับไม่ถูกต้อง" };
  const note = raw.replace(/\r\n?/g, "\n").trim();
  if (note.length > DRIVE_NOTE_MAX) {
    return { ok: false, error: `ข้อความกำกับยาวเกิน ${DRIVE_NOTE_MAX.toLocaleString("en-US")} ตัวอักษร` };
  }
  return { ok: true, note: note || null };
}

/** "12.5 MB" — ใช้ toFixed ไม่ใช้ toLocaleString เพื่อให้เซิร์ฟเวอร์กับเบราว์เซอร์ได้สตริงเดียวกันเป๊ะ */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const KINDS: { icon: string; label: string; ext: string[] }[] = [
  { icon: "⚙️", label: "โปรแกรม", ext: ["exe", "msi", "msix", "bat", "cmd", "ps1", "apk", "dmg", "pkg", "deb", "rpm", "appimage", "reg"] },
  { icon: "💿", label: "อิมเมจดิสก์", ext: ["iso", "img", "vhd", "vhdx"] },
  { icon: "🗜️", label: "ไฟล์บีบอัด", ext: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "cab"] },
  { icon: "📕", label: "PDF", ext: ["pdf"] },
  { icon: "📄", label: "เอกสาร", ext: ["doc", "docx", "odt", "rtf"] },
  { icon: "📊", label: "ตาราง", ext: ["xls", "xlsx", "xlsm", "csv", "ods"] },
  { icon: "📽️", label: "สไลด์", ext: ["ppt", "pptx", "odp"] },
  { icon: "🖼️", label: "รูปภาพ", ext: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "tif", "tiff"] },
  { icon: "🎞️", label: "วิดีโอ", ext: ["mp4", "mov", "avi", "mkv", "webm", "wmv"] },
  { icon: "🎵", label: "เสียง", ext: ["mp3", "wav", "m4a", "flac", "ogg", "aac"] },
  { icon: "📝", label: "ข้อความ", ext: ["txt", "md", "log", "json", "xml", "ini", "cfg", "conf", "yaml", "yml"] },
];

/** ไอคอนตามนามสกุล — ให้กวาดตาหาไฟล์ติดตั้งโปรแกรมกับเอกสารในโฟลเดอร์เดียวกันได้เร็ว */
export function fileKind(name: string): { icon: string; label: string } {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return KINDS.find((k) => k.ext.includes(ext)) ?? { icon: "📎", label: "ไฟล์" };
}

/** เส้นทางจากชั้นบนสุดถึงโฟลเดอร์นี้ (ใช้ทำ breadcrumb) — กันวนซ้ำไม่รู้จบถ้าข้อมูลเพี้ยนจนพ่อชี้หาลูก */
export function folderTrail(folders: DriveFolder[], folderId: string | null): DriveFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const trail: DriveFolder[] = [];
  const seen = new Set<string>();
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && !seen.has(current.id) && trail.length < 64) {
    seen.add(current.id);
    trail.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return trail;
}

/** ชื่อเต็มของโฟลเดอร์แบบ "โปรแกรม / ไดรเวอร์" — ใช้ในผลค้นหาและเมนูย้ายไฟล์ */
export function folderLabel(folders: DriveFolder[], folderId: string | null): string {
  const trail = folderTrail(folders, folderId);
  return trail.length ? trail.map((f) => f.name).join(" / ") : "คลังไฟล์";
}

/** ค้นหาไม่สนช่องว่างและตัวพิมพ์ — ค้นทั้งชื่อไฟล์และข้อความกำกับ */
export function driveMatches(file: Pick<DriveFile, "name" | "note">, query: string): boolean {
  const q = query.replace(/\s+/g, "").toLowerCase();
  if (!q) return true;
  return `${file.name}${file.note ?? ""}`.replace(/\s+/g, "").toLowerCase().includes(q);
}
