import "server-only";

// เข้ารหัสข้อมูลหน้า "รหัสผ่าน" (/passwords) — AES-256-GCM ด้วยกุญแจจาก env VAULT_KEY
//
// ทำไมต้องเข้ารหัสทั้งที่ไฟล์อยู่ในเครื่องเราเอง:
//   backup.bat คัดลอก data/ ทั้งโฟลเดอร์เข้า backups/ ซึ่ง "อยู่ใน git" — ถ้าเก็บรหัสผ่านเป็นข้อความธรรมดา
//   ทุกรหัสของบริษัทจะไปอยู่ในประวัติ git ตลอดกาล (ลบทีหลังก็ยังอยู่ ต้องเปลี่ยนรหัสทุกตัวอย่างเดียว)
//   เข้ารหัสแล้ว ไฟล์ใน backup/git เปิดอ่านไม่ได้ถ้าไม่มี VAULT_KEY ซึ่งอยู่ใน .env (ไม่ขึ้น git)
//
// รูปแบบที่เก็บ: "v1.<iv>.<tag>.<ciphertext>" (base64url) — มีเลขรุ่นนำหน้าไว้ เผื่อวันหนึ่งต้องเปลี่ยนกุญแจ
// AAD (ข้อมูลประกอบที่ไม่ได้เข้ารหัสแต่ถูกตรวจ) = id ของแถว + ชื่อช่อง ทำให้ย้ายก้อนรหัสของแถวหนึ่ง
// ไปแปะอีกแถวไม่ได้ — ถอดไม่ออกทันที แทนที่จะโชว์รหัสผิดตัวให้คนเอาไปใช้

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12; // ขนาดที่ GCM ออกแบบมา — ขนาดอื่นทำให้ความปลอดภัยลดลง
const TAG_BYTES = 16;

/** ยังไม่ได้ตั้ง VAULT_KEY หรือตั้งผิดรูปแบบ — หน้าเว็บบอกวิธีตั้ง ไม่ใช่พังทั้งหน้า */
export class VaultKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultKeyError";
  }
}

/** ถอดรหัสไม่ออก = กุญแจไม่ตรงกับที่ใช้เข้ารหัส หรือข้อมูลถูกแก้ — ห้ามเขียนอะไรทับจนกว่าจะแก้ */
export class VaultDecryptError extends Error {
  constructor() {
    super("ถอดรหัสข้อมูลไม่ได้ — VAULT_KEY ไม่ตรงกับที่ใช้ตอนบันทึก หรือไฟล์ข้อมูลถูกแก้ไข");
    this.name = "VaultDecryptError";
  }
}

/** กุญแจหลัก 32 ไบต์จาก VAULT_KEY (base64) — อ่านใหม่ทุกครั้ง เปลี่ยน .env แล้ว restart ก็มีผล
 *  ไม่มี fallback เด็ดขาด (ต่างจาก SESSION_SECRET): กุญแจตั้งต้นที่อยู่ในซอร์สโค้ด = ไม่ได้เข้ารหัสเลย */
function masterKey(): Buffer {
  const raw = process.env.VAULT_KEY?.trim();
  if (!raw) throw new VaultKeyError("ยังไม่ได้ตั้งค่า VAULT_KEY ใน .env");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) {
    throw new VaultKeyError("VAULT_KEY ต้องเป็น base64 ของข้อมูลสุ่ม 32 ไบต์");
  }
  const key = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (key.length !== 32) {
    throw new VaultKeyError(`VAULT_KEY ต้องยาว 32 ไบต์ (ตอนนี้ ${key.length} ไบต์) — สร้างใหม่ด้วยคำสั่งใน .env.example`);
  }
  return key;
}

export function vaultKeyProblem(): string | null {
  try {
    masterKey();
    return null;
  } catch (err) {
    return err instanceof VaultKeyError ? err.message : "อ่าน VAULT_KEY ไม่ได้";
  }
}

/** แตกกุญแจย่อยตามหน้าที่ (HKDF) — กุญแจเข้ารหัสข้อมูลกับกุญแจเซ็น cookie ปลดล็อกเป็นคนละดอก
 *  ถ้าใช้ดอกเดียวกันสองงาน ช่องโหว่ในงานหนึ่งจะลามไปอีกงานได้ */
export function vaultSubKey(purpose: "data" | "unlock"): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey(), Buffer.alloc(0), `it-support-admin/vault/${purpose}/v1`, 32));
}

const b64 = (buf: Buffer) => buf.toString("base64url");

export function encryptText(plain: string, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", vaultSubKey("data"), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(body)].join(".");
}

export function decryptText(token: string, aad: string): string {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 4 || parts[0] !== VERSION) throw new VaultDecryptError();
  const [, ivText, tagText, bodyText] = parts;
  try {
    const iv = Buffer.from(ivText, "base64url");
    const tag = Buffer.from(tagText, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new VaultDecryptError();
    const decipher = createDecipheriv("aes-256-gcm", vaultSubKey("data"), iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(bodyText, "base64url")), decipher.final()]).toString("utf8");
  } catch (err) {
    if (err instanceof VaultKeyError) throw err;
    throw new VaultDecryptError();
  }
}
