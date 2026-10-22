/* ─────────────────────────────────────────────────────────────────────────────
   หน้า "รหัสผ่าน" (/passwords) — ส่วนที่ "ไม่แตะไฟล์และไม่แตะกุญแจ" ใช้ได้ทั้งหน้าเว็บและเซิร์ฟเวอร์

   หน้าเว็บใช้: ป้ายชื่อหมวด/ช่อง · ตรวจฟอร์มทันทีที่พิมพ์ · อ่านไฟล์ CSV/Excel เพื่อโชว์ตัวอย่างก่อนนำเข้า ·
              จัดหน้าไฟล์ Excel ตอนส่งออก · สุ่มรหัสผ่าน
   เซิร์ฟเวอร์ใช้: ตัวตรวจ/ตัวอ่านไฟล์ "ตัวเดียวกัน" ซ้ำอีกรอบ — ไม่เชื่อผลจากหน้าเว็บ (ใครก็ส่งข้อมูลแต่งมาได้)

   รูปแบบไฟล์ที่อ่านได้ = ไฟล์ "Account and Password for AT FAVOURITE" ของทีม IT: หลายตารางในชีตเดียว
   วางข้างกัน/ต่อกัน แต่ละตารางมีชื่อตาราง (เช่น "Wi-Fi") อยู่เหนือแถวหัวคอลัมน์ที่มี "รหัสผ่าน"
   ตัวอ่านจึงหา "หัวคอลัมน์รหัสผ่าน" ก่อน แล้วขยายซ้าย-ขวาเป็นตาราง ไม่ผูกกับตำแหน่งคอลัมน์ตายตัว —
   ทีมย้าย/เพิ่มคอลัมน์ในไฟล์เมื่อไหร่ก็ยังอ่านได้ (คอลัมน์ที่ไม่รู้จักถูกต่อท้ายหมายเหตุ ไม่ทิ้ง)
   ───────────────────────────────────────────────────────────────────────────── */

export const VAULT_CATEGORIES = ["account", "network", "wifi", "apple_id"] as const;
export type VaultCategory = (typeof VAULT_CATEGORIES)[number];

export type VaultField = "username" | "url" | "band" | "location" | "note";

export interface VaultCategoryInfo {
  key: VaultCategory;
  label: string;
  /** ชื่อตารางในไฟล์ต้นฉบับ — ใช้ตอนส่งออกด้วย ไฟล์ที่ส่งออกจึงนำเข้ากลับได้ทันที */
  title: string;
  /** ป้ายของช่องชื่อ (ช่องบังคับ) — Wi-Fi คือชื่อการเชื่อมต่อ, Apple ID คือตัว Apple ID */
  nameLabel: string;
  /** หัวคอลัมน์ของช่องชื่อตอนส่งออก — ตรงกับไฟล์ต้นฉบับ */
  nameHeader: string;
  fields: VaultField[];
}

export const VAULT_CATEGORY_INFO: Record<VaultCategory, VaultCategoryInfo> = {
  account: {
    key: "account", label: "บัญชีระบบ", title: "ALL Account & Password",
    nameLabel: "ชื่อรายการ", nameHeader: "ชื่อรายการ", fields: ["username", "url", "note"],
  },
  network: {
    key: "network", label: "Network & Server", title: "Network & Server Account",
    nameLabel: "ชื่อรายการ", nameHeader: "ชื่อรายการ", fields: ["username", "url", "note"],
  },
  wifi: {
    key: "wifi", label: "Wi-Fi", title: "Wi-Fi",
    nameLabel: "ชื่อการเชื่อมต่อ (SSID)", nameHeader: "ชื่อการเชื่อมต่อ", fields: ["band", "location", "url", "note"],
  },
  apple_id: {
    key: "apple_id", label: "Apple ID", title: "Apple ID Account",
    nameLabel: "Apple ID (อีเมล)", nameHeader: "ชื่อผู้ใช้", fields: ["note"],
  },
};

export const VAULT_FIELD_LABELS: Record<VaultField, string> = {
  username: "ชื่อผู้ใช้",
  url: "URL / IP",
  band: "GHz",
  location: "Location",
  note: "หมายเหตุ",
};

/** หัวคอลัมน์ตอนส่งออก (ตรงกับไฟล์ต้นฉบับ เพื่อให้นำเข้ากลับด้วยตัวอ่านเดียวกันได้) */
const EXPORT_FIELD_HEADERS: Record<VaultField, string> = {
  username: "ชื่อผู้ใช้",
  url: "URL",
  band: "GHz",
  location: "Location",
  note: "หมายเหตุ",
};

/** เพดานแต่ละช่อง — กันไฟล์ข้อมูลบวมจากการวางข้อความยาวผิดที่ และกันฟอร์มถูกใช้เป็นที่เก็บของอื่น */
export const VAULT_LIMITS = {
  name: 200,
  username: 200,
  url: 500,
  band: 30,
  location: 200,
  note: 2000,
  secret: 500,
} as const;

/** นำเข้าครั้งละไม่เกินเท่านี้ — ไฟล์จริงมีไม่ถึง 50 รายการ เกินนี้แปลว่าเลือกไฟล์ผิด */
export const VAULT_IMPORT_MAX_ENTRIES = 1000;
export const VAULT_IMPORT_MAX_ROWS = 2000;
export const VAULT_IMPORT_MAX_COLS = 40;
export const VAULT_IMPORT_MAX_CELL = 2000;
export const VAULT_IMPORT_MAX_FILE_MB = 2;

export interface VaultInput {
  category: VaultCategory;
  name: string;
  username: string;
  url: string;
  band: string;
  location: string;
  note: string;
}

export type VaultInputCheck = { ok: true; input: VaultInput } | { ok: false; error: string };

export function isVaultCategory(value: unknown): value is VaultCategory {
  return typeof value === "string" && (VAULT_CATEGORIES as readonly string[]).includes(value);
}

/** ตัดตัวควบคุมทิ้ง (ยกเว้นขึ้นบรรทัดในหมายเหตุ) — ข้อความพวกนี้ไปอยู่ในไฟล์ Excel ที่ส่งออกและในหน้าเว็บ */
function cleanText(raw: unknown, multiline = false): string {
  if (typeof raw !== "string") return "";
  let text = raw.normalize("NFC").replace(/\r\n?/g, "\n");
  text = multiline ? text : text.replace(/\n+/g, " ");
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if ((code < 0x20 && !(multiline && ch === "\n")) || code === 0x7f) continue;
    out += ch;
  }
  return out.trim();
}

/** ตรวจ + ทำความสะอาดข้อมูลหนึ่งรายการ (ไม่รวมรหัสผ่าน — ตรวจแยกที่ checkVaultSecret) */
export function checkVaultInput(raw: Partial<Record<keyof VaultInput, unknown>>): VaultInputCheck {
  if (!isVaultCategory(raw.category)) return { ok: false, error: "เลือกหมวดของรายการก่อน" };
  const info = VAULT_CATEGORY_INFO[raw.category];
  const input: VaultInput = {
    category: raw.category,
    name: cleanText(raw.name),
    username: info.fields.includes("username") ? cleanText(raw.username) : "",
    url: info.fields.includes("url") ? cleanText(raw.url) : "",
    band: info.fields.includes("band") ? cleanText(raw.band) : "",
    location: info.fields.includes("location") ? cleanText(raw.location) : "",
    note: cleanText(raw.note, true),
  };
  if (!input.name) return { ok: false, error: `กรอก${info.nameLabel}` };
  for (const field of ["name", "username", "url", "band", "location", "note"] as const) {
    if (input[field].length > VAULT_LIMITS[field]) {
      const label = field === "name" ? info.nameLabel : VAULT_FIELD_LABELS[field];
      return { ok: false, error: `${label}ยาวเกิน ${VAULT_LIMITS[field]} ตัวอักษร` };
    }
  }
  return { ok: true, input };
}

/** รหัสผ่านเก็บตามที่พิมพ์ทุกตัวอักษร (รวมช่องว่างหัวท้าย — รหัส Wi-Fi บางตัวมีจริง)
 *  ตัดแค่ตัวขึ้นบรรทัด/ตัวควบคุมที่มักติดมาจากการคัดลอก ซึ่งไม่มีระบบไหนใช้เป็นรหัสได้ */
export function checkVaultSecret(raw: unknown): { ok: true; secret: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, secret: "" };
  if (typeof raw !== "string") return { ok: false, error: "รหัสผ่านไม่ถูกต้อง" };
  let secret = "";
  for (const ch of raw.normalize("NFC")) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) continue;
    secret += ch;
  }
  if (secret.length > VAULT_LIMITS.secret) return { ok: false, error: `รหัสผ่านยาวเกิน ${VAULT_LIMITS.secret} ตัวอักษร` };
  return { ok: true, secret };
}

/** คีย์ตรวจรายการซ้ำตอนนำเข้า: หมวด + ชื่อ + ชื่อผู้ใช้ (ไม่สนตัวพิมพ์/ช่องว่างซ้อน) */
export function vaultDuplicateKey(input: Pick<VaultInput, "category" | "name" | "username">): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return `${input.category}\u0000${norm(input.name)}\u0000${norm(input.username)}`;
}

/** สุ่มรหัสผ่านใหม่ (ปุ่ม "สุ่ม" ในฟอร์ม) — crypto.getRandomValues ไม่ใช่ Math.random ที่เดาได้
 *  ตัดตัวที่อ่านสับสน (0/O, 1/l/I) เพราะรหัสพวกนี้มักต้องอ่านออกเสียง/พิมพ์ตามบนเครื่องอื่น */
export function generateVaultSecret(length = 16): string {
  const pools = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#%+=?-_"];
  const all = pools.join("");
  const pick = (set: string) => {
    // ตัดเศษส่วนที่ทำให้บางตัวอักษรออกบ่อยกว่าตัวอื่น (modulo bias)
    const limit = Math.floor(256 / set.length) * set.length;
    const buf = new Uint8Array(1);
    for (;;) {
      globalThis.crypto.getRandomValues(buf);
      if (buf[0] < limit) return set[buf[0] % set.length];
    }
  };
  const chars = pools.map(pick);
  while (chars.length < Math.max(12, length)) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/* ─────────────────────────────── อ่านไฟล์ ─────────────────────────────── */

/** CSV ตามมาตรฐาน RFC 4180 (ช่องที่มี , " หรือขึ้นบรรทัดถูกครอบด้วย ") — ไม่ใช้ไลบรารี xlsx กับ CSV
 *  เพราะ xlsx รุ่นที่มีใน npm มีช่องโหว่ตอนอ่านไฟล์ที่ถูกแต่งมา ส่วน CSV อ่านเองได้ง่ายและปลอดภัยกว่า */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // BOM จาก Excel
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export interface VaultGrid {
  /** ชื่อชีต (Excel) หรือชื่อไฟล์ (CSV) — ใช้บอกตำแหน่งแถวที่มีปัญหา */
  name: string;
  /** เลขแถวใน Excel ของแถวแรกในตาราง (นับ 1) */
  first_row: number;
  rows: string[][];
}

export interface ParsedVaultEntry {
  input: VaultInput;
  secret: string;
  sheet: string;
  row: number;
}

export interface ParsedVaultSection {
  sheet: string;
  title: string;
  category: VaultCategory;
  row: number;
  count: number;
}

export interface VaultImportProblem {
  sheet: string;
  row: number;
  message: string;
}

export interface ParsedVaultImport {
  entries: ParsedVaultEntry[];
  sections: ParsedVaultSection[];
  problems: VaultImportProblem[];
}

export class VaultImportError extends Error {}

type ColumnRole = "order" | "name" | "username" | "secret" | "url" | "band" | "location" | "note";

const HEADER_ROLES: [ColumnRole, string[]][] = [
  ["order", ["ลำดับที่", "ลำดับ", "no", "no.", "#"]],
  ["name", ["ชื่อรายการ", "ชื่อระบบ", "รายการ", "ระบบ", "name", "system", "ชื่อการเชื่อมต่อ", "ssid", "ชื่อ wi-fi", "ชื่อ wifi"]],
  ["username", ["ชื่อผู้ใช้", "username", "user", "user name", "login", "บัญชี", "account", "apple id", "อีเมล", "email", "e-mail"]],
  ["secret", ["รหัสผ่าน", "password", "pass", "รหัส"]],
  ["url", ["url", "ลิงก์", "link", "ip", "ip address", "เว็บไซต์", "website"]],
  ["band", ["ghz", "band", "ย่านความถี่", "คลื่น"]],
  ["location", ["location", "ที่ตั้ง", "สถานที่", "จุดติดตั้ง", "ชั้น"]],
  ["note", ["หมายเหตุ", "note", "notes", "remark", "remarks"]],
];

const norm = (s: unknown) => (typeof s === "string" ? s : s == null ? "" : String(s)).trim().toLowerCase().replace(/\s+/g, " ");

function roleOf(header: string): ColumnRole | null {
  const h = norm(header);
  for (const [role, names] of HEADER_ROLES) if (names.includes(h)) return role;
  return null;
}

/** ค่าที่ทีมใช้แทน "ไม่มี" ในไฟล์ — ถือเป็นช่องว่าง ไม่ใช่ข้อความ "-" ที่ต้องเก็บ */
const PLACEHOLDERS = new Set(["-", "–", "—", "n/a", "na", "none", "null", "ไม่มี"]);

function cellText(raw: unknown): string {
  const text = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  return PLACEHOLDERS.has(norm(text)) ? "" : text.trim();
}

/** แถวหัวตาราง = มีหัว "รหัสผ่าน" + (ลำดับที่ หรือ ชื่อรายการ) และรู้จักอย่างน้อย 3 ช่อง
 *  เกณฑ์ต้องเข้มพอ เพราะ "ข้อมูล" ก็มีคำเดียวกันได้จริง — รหัสเราเตอร์ตั้งต้นมักเป็น password / ชื่อผู้ใช้ user
 *  ถ้าแถวข้อมูลแบบนั้นถูกมองเป็นหัวตาราง รายการที่เหลือจะถูกตัดหรืออ่านซ้ำแบบเงียบๆ */
function isHeaderRow(roles: (ColumnRole | null)[]): boolean {
  const known = roles.filter(Boolean);
  return roles.includes("secret") && (roles.includes("order") || roles.includes("name")) && known.length >= 3;
}

function categoryFor(title: string, roles: (ColumnRole | null)[], headers: string[]): VaultCategory {
  const t = norm(title);
  if (/wi-?fi|wireless/.test(t) || roles.includes("band") || headers.some((h) => ["ชื่อการเชื่อมต่อ", "ssid"].includes(norm(h)))) {
    return "wifi";
  }
  if (t.includes("apple")) return "apple_id";
  if (/network|server|router|switch|firewall|nas/.test(t)) return "network";
  return "account";
}

/** อ่านทุกตารางในทุกชีต → รายการที่พร้อมบันทึก + ปัญหารายแถว (ไม่โยน error เพราะแถวเดียวเสีย) */
export function parseVaultGrids(grids: VaultGrid[]): ParsedVaultImport {
  const result: ParsedVaultImport = { entries: [], sections: [], problems: [] };
  for (const grid of grids) {
    const rows = grid.rows.map((r) => (Array.isArray(r) ? r.map((c) => (typeof c === "string" ? c : c == null ? "" : String(c))) : []));
    const width = Math.max(0, ...rows.map((r) => r.length));
    const cell = (r: number, c: number) => (rows[r]?.[c] ?? "").trim();
    const excelRow = (r: number) => grid.first_row + r;

    const seen = new Set<string>();
    const headerAt = (r: number, c0: number, c1: number) =>
      r < rows.length && isHeaderRow(rows[r].slice(c0, c1 + 1).map((h) => roleOf(h ?? "")));

    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < width; c++) {
        if (roleOf(cell(r, c)) !== "secret") continue;
        // ขยายจากหัว "รหัสผ่าน" ไปซ้าย-ขวาจนเจอช่องหัวที่ว่าง = ขอบของตารางนี้
        let c0 = c;
        while (c0 > 0 && cell(r, c0 - 1)) c0--;
        let c1 = c;
        while (c1 + 1 < width && cell(r, c1 + 1)) c1++;
        if (seen.has(`${r}:${c0}`)) continue; // หัวตารางเดียวกันที่มีคำว่ารหัสผ่าน 2 ช่อง
        seen.add(`${r}:${c0}`);
        const headers = rows[r].slice(c0, c1 + 1).map((h) => h.trim());
        const roles = headers.map(roleOf);
        if (!isHeaderRow(roles)) continue; // แถวข้อมูลที่บังเอิญมีคำว่า password — ไม่ใช่หัวตาราง

        // ชื่อตาราง = แถวเหนือหัวคอลัมน์ที่มีข้อความช่องเดียวในช่วงคอลัมน์นี้ (ดูขึ้นไปไม่เกิน 3 แถว)
        let title = "";
        for (let up = r - 1; up >= Math.max(0, r - 3); up--) {
          const texts = rows[up].slice(c0, c1 + 1).map((x) => x.trim()).filter(Boolean);
          if (texts.length === 1) {
            title = texts[0];
            break;
          }
          if (texts.length > 1) break;
        }
        const category = categoryFor(title, roles, headers);
        const section: ParsedVaultSection = { sheet: grid.name, title: title || VAULT_CATEGORY_INFO[category].title, category, row: excelRow(r), count: 0 };

        for (let d = r + 1; d < rows.length; d++) {
          const values = rows[d].slice(c0, c1 + 1).map((x) => (x ?? "").trim());
          const filled = values.filter(Boolean);
          if (filled.length === 0) break; // แถวว่างทั้งแถว = จบตาราง
          if (headerAt(d, c0, c1)) break; // หัวตารางถัดไปติดกันเลย
          // ชื่อตารางถัดไป = ข้อความช่องเดียวที่ "ตามด้วยหัวตาราง" — แค่ช่องเดียวยังไม่พอ เพราะรายการที่กรอกแค่ชื่อก็มีได้
          if (filled.length === 1 && values[0] === filled[0] && !/^\d+$/.test(filled[0]) && headerAt(d + 1, c0, c1)) break;

          const fields: Record<ColumnRole, string> = { order: "", name: "", username: "", secret: "", url: "", band: "", location: "", note: "" };
          const extras: string[] = [];
          values.forEach((raw, i) => {
            const role = roles[i];
            if (role === "secret") {
              // รหัสผ่านไม่ trim ข้อความจริง แต่ถือช่องว่างล้วน/เครื่องหมาย "ไม่มี" เป็นค่าว่าง
              fields.secret = cellText(raw) ? (rows[d][c0 + i] ?? "") : "";
            } else if (role) {
              const text = cellText(raw);
              if (text) fields[role] = fields[role] ? `${fields[role]} ${text}` : text;
            } else if (cellText(raw)) {
              extras.push(`${headers[i] || "คอลัมน์"}: ${cellText(raw)}`);
            }
          });
          if (extras.length) fields.note = [fields.note, ...extras].filter(Boolean).join("\n");

          const meaningful = [fields.name, fields.username, fields.secret, fields.url, fields.band, fields.location, fields.note].some(Boolean);
          if (!meaningful) continue; // แถวที่มีแค่เลขลำดับ (ตารางเผื่อไว้กรอกต่อ)

          if (category === "apple_id" && !fields.name && fields.username) {
            fields.name = fields.username;
            fields.username = "";
          }
          if (!fields.name && fields.username) fields.name = fields.username;
          if (!fields.name) {
            // มีรหัส/ข้อมูลแต่ไม่มีชื่อ — ไม่ทิ้ง (ทิ้งแล้วรหัสหายไปเงียบๆ) ตั้งชื่อชั่วคราวแล้วบอกให้ไปแก้
            fields.name = `ไม่มีชื่อ (แถว ${excelRow(d)})`;
            result.problems.push({ sheet: grid.name, row: excelRow(d), message: "ไม่มีชื่อรายการ — นำเข้าด้วยชื่อชั่วคราว แก้ชื่อทีหลังได้" });
          }
          const checked = checkVaultInput({ category, ...fields });
          const secret = checkVaultSecret(fields.secret);
          if (!checked.ok || !secret.ok) {
            result.problems.push({ sheet: grid.name, row: excelRow(d), message: !checked.ok ? checked.error : (secret as { error: string }).error });
            continue;
          }
          result.entries.push({ input: checked.input, secret: secret.secret, sheet: grid.name, row: excelRow(d) });
          section.count++;
        }
        result.sections.push(section);
      }
    }
  }
  return result;
}

/** ตรวจรูปร่างข้อมูลที่หน้าเว็บส่งมา (เซิร์ฟเวอร์เรียกก่อน parseVaultGrids) — ขนาด/ชนิด ไม่เชื่อหน้าเว็บ */
export function sanitizeVaultGrids(raw: unknown): VaultGrid[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 30) throw new VaultImportError("ข้อมูลไฟล์ไม่ถูกต้อง");
  let totalRows = 0;
  return raw.map((g) => {
    const grid = g as Partial<VaultGrid> | null;
    if (!grid || typeof grid !== "object" || !Array.isArray(grid.rows)) throw new VaultImportError("ข้อมูลไฟล์ไม่ถูกต้อง");
    totalRows += grid.rows.length;
    if (totalRows > VAULT_IMPORT_MAX_ROWS) throw new VaultImportError(`ไฟล์ยาวเกิน ${VAULT_IMPORT_MAX_ROWS} แถว — เลือกไฟล์ผิดหรือเปล่า`);
    const rows = grid.rows.map((row) => {
      if (!Array.isArray(row)) return [];
      if (row.length > VAULT_IMPORT_MAX_COLS) throw new VaultImportError(`ไฟล์กว้างเกิน ${VAULT_IMPORT_MAX_COLS} คอลัมน์`);
      return row.map((c) => {
        const text = typeof c === "string" ? c : typeof c === "number" || typeof c === "boolean" ? String(c) : "";
        if (text.length > VAULT_IMPORT_MAX_CELL) throw new VaultImportError("มีช่องที่ข้อความยาวผิดปกติ — เลือกไฟล์ผิดหรือเปล่า");
        return text;
      });
    });
    const name = typeof grid.name === "string" ? grid.name.slice(0, 100) : "ไฟล์";
    const first = Number.isSafeInteger(grid.first_row) && (grid.first_row as number) > 0 ? (grid.first_row as number) : 1;
    return { name, first_row: first, rows };
  });
}

/* ─────────────────────────────── ส่งออก ─────────────────────────────── */

export interface VaultExportRow extends VaultInput {
  secret: string;
}

/** จัดหน้าแบบเดียวกับไฟล์ต้นฉบับ (ชื่อตาราง → หัวคอลัมน์ → ข้อมูล) ชีตละหมวด
 *  ไฟล์ที่ส่งออกจึงเปิดอ่านง่ายเหมือนเดิม และนำเข้ากลับด้วยตัวอ่านเดียวกันได้ (รายการซ้ำถูกข้าม) */
export function vaultExportGrids(rows: VaultExportRow[]): VaultGrid[] {
  return VAULT_CATEGORIES.map((category) => {
    const info = VAULT_CATEGORY_INFO[category];
    const fields = info.fields;
    const header = ["ลำดับที่", info.nameHeader, ...fields.flatMap((f) => (f === "username" ? [EXPORT_FIELD_HEADERS[f], "รหัสผ่าน"] : []))];
    if (!fields.includes("username")) header.push("รหัสผ่าน");
    for (const f of fields) if (f !== "username") header.push(EXPORT_FIELD_HEADERS[f]);
    const data = rows
      .filter((r) => r.category === category)
      .map((r, i) => {
        const out = [String(i + 1), r.name];
        if (fields.includes("username")) out.push(r.username, r.secret);
        else out.push(r.secret);
        for (const f of fields) if (f !== "username") out.push(r[f]);
        return out;
      });
    return { name: info.label, first_row: 1, rows: [[info.title], header, ...data] };
  });
}
