// Postgres adapter — เก็บ signature เดิมทุกตัว (readCollection/writeCollection/upsertOne/
// patchOne) ของ mock JSON store เดิมไว้ทั้งหมด แต่เปลี่ยนไปคุยกับ Postgres จริงแทน fs
// ทำให้ src/lib/db/*.ts ไฟล์อื่น (equipment.ts, tickets.ts, ...) ไม่ต้องแก้ logic ภายใน
// เปลี่ยนแค่ต้อง await เพราะทุกฟังก์ชันกลายเป็น async (ดู README.md หัวข้อ "ย้ายจาก Mock
// Data ไป Supabase" — แนวคิดเดียวกัน แค่ปลายทางเป็น self-hosted Postgres ใน Docker แทน)
//
// สำคัญ: ฟังก์ชันทุกตัวเป็น async เพราะ query DB คือ I/O ข้ามเครือข่ายจริง (ต่างจาก
// fs.readFileSync เดิมที่ sync ได้เพราะอ่านไฟล์ในเครื่อง) — ทุกจุดที่เรียกใช้ต้อง await

import "server-only";
import type { PoolClient } from "pg";
import { getPool } from "./pg";

interface TableMeta {
  jsonColumns: string[];
  arrayColumns: string[];
}

// ชื่อ collection ในโค้ดเดิม (COLLECTION / ITEMS_COLLECTION / TXN_COLLECTION ในแต่ละ
// repository) ตรงกับชื่อตาราง Postgres พอดีทุกตัว (ดู db/init/001_schema.sql) — allowlist นี้
// ทำหน้าที่กัน SQL injection ผ่านชื่อ table ด้วย เป็นนิสัยที่ดีเวลา interpolate identifier
// ลง SQL แม้ปัจจุบัน name จะมาจาก constant ในโค้ดเราเอง ไม่ใช่ user input ก็ตาม
const TABLES: Record<string, TableMeta> = {
  users: { jsonColumns: [], arrayColumns: [] },
  equipment: { jsonColumns: [], arrayColumns: [] },
  tickets: { jsonColumns: ["meta"], arrayColumns: [] },
  stock_items: { jsonColumns: [], arrayColumns: [] },
  stock_transactions: { jsonColumns: [], arrayColumns: [] },
  faq_items: { jsonColumns: [], arrayColumns: ["keywords", "image_urls"] },
  staff_accounts: { jsonColumns: [], arrayColumns: [] },
};

function tableMeta(name: string): TableMeta {
  const meta = TABLES[name];
  if (!meta) {
    throw new Error(`[db/store] ไม่รู้จัก collection "${name}" — เพิ่มใน TABLES ก่อนใช้งาน`);
  }
  return meta;
}

function toParam(meta: TableMeta, col: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (value !== null && meta.jsonColumns.includes(col)) {
    return JSON.stringify(value);
  }
  return value;
}

async function isSeeded(name: string): Promise<boolean> {
  const { rows } = await getPool().query(
    "SELECT 1 FROM _seed_state WHERE collection = $1",
    [name]
  );
  return rows.length > 0;
}

// กัน seed เดียวกันถูกสั่งพร้อมกันหลายรอบภายใน process เดียว — หน้าแรกเรียก
// ticketCountsByStatus() / listEquipment() / listStockItemsWithStatus() แบบขนาน และ seed ของ
// tickets กับ equipment ต่างก็เรียก listUsers() ต่ออีกที ทำให้ ensureSeeded("users") ถูกยิง
// พร้อมกันหลายเส้นทาง ถ้าไม่รวบให้เหลือ promise เดียว ทุกเส้นจะเห็น _seed_state ว่างพร้อมกัน
// แล้วแย่งกัน insert ข้อมูลชุดเดียวกันจนชน unique constraint (เช่น users.line_user_id)
const seedingInFlight = new Map<string, Promise<void>>();

/**
 * seed ให้อัตโนมัติครั้งแรกที่เรียกเท่านั้น (เช็คจาก _seed_state ไม่ใช่เช็คว่าตอนนี้มีข้อมูล
 * กี่แถว) — พฤติกรรมเดียวกับตอนที่ยังเป็นไฟล์ JSON คือเช็ค "ไฟล์มีอยู่ไหม" ไม่ใช่ "ไฟล์ว่าง
 * ไหม" เพื่อไม่ให้ seed ข้อมูลตัวอย่างย้อนกลับมาถ้าแอดมินลบข้อมูลทิ้งเองจริงๆ ภายหลัง
 */
async function ensureSeeded<T>(
  name: string,
  seedFn?: () => T[] | Promise<T[]>
): Promise<void> {
  if (!seedFn) return;
  if (await isSeeded(name)) return;

  const inFlight = seedingInFlight.get(name);
  if (inFlight) return inFlight;

  const task = runSeed(name, seedFn).finally(() => seedingInFlight.delete(name));
  seedingInFlight.set(name, task);
  return task;
}

async function runSeed<T>(
  name: string,
  seedFn: () => T[] | Promise<T[]>
): Promise<void> {
  const meta = tableMeta(name);

  // เรียก seedFn() ให้เสร็จก่อนเปิด transaction เสมอ — seed ของบางตาราง (tickets) ไปอ่าน
  // ตารางอื่นต่อ ซึ่งจะยืม connection ตัวใหม่จาก pool ถ้าเราถือ transaction ค้างไว้ระหว่างนั้น
  // และ pool เต็มพอดี จะค้างรอกันเอง
  const seed = await seedFn();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // ล็อกข้าม process/ข้าม container ด้วย (in-flight map ข้างบนกันได้แค่ใน process เดียว)
    // advisory lock แบบ xact ปลดให้เองตอน COMMIT/ROLLBACK ไม่มีทางค้างถ้า request พัง
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [name]);

    // เช็คซ้ำ "หลัง" ได้ล็อกแล้ว — ถ้ามีอีก process ชิงไป seed เสร็จตอนเรารอล็อกอยู่ ก็ไม่ต้องทำซ้ำ
    const { rows } = await client.query(
      "SELECT 1 FROM _seed_state WHERE collection = $1",
      [name]
    );
    if (rows.length === 0) {
      for (const item of seed) {
        await insertRow(client, name, meta, item as Record<string, unknown>);
      }
      await client.query("INSERT INTO _seed_state (collection) VALUES ($1)", [name]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function insertRow(
  client: PoolClient,
  name: string,
  meta: TableMeta,
  item: Record<string, unknown>
): Promise<void> {
  const cols = Object.keys(item);
  const values = cols.map((c) => toParam(meta, c, item[c]));
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  await client.query(
    `INSERT INTO ${name} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`,
    values
  );
}

export async function readCollection<T>(
  name: string,
  seedFn?: () => T[] | Promise<T[]>
): Promise<T[]> {
  tableMeta(name);
  await ensureSeeded(name, seedFn);
  const { rows } = await getPool().query(`SELECT * FROM ${name} ORDER BY created_at ASC`);
  return rows as T[];
}

export async function writeCollection<T extends Record<string, unknown>>(
  name: string,
  data: T[]
): Promise<void> {
  const meta = tableMeta(name);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM ${name}`);
    for (const item of data) {
      await insertRow(client, name, meta, item);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function upsertOne<T extends { id: string }>(
  name: string,
  item: T,
  seedFn?: () => T[] | Promise<T[]>
): Promise<T> {
  const meta = tableMeta(name);
  await ensureSeeded(name, seedFn);

  const record = item as unknown as Record<string, unknown>;
  const cols = Object.keys(record);
  const values = cols.map((c) => toParam(meta, c, record[c]));
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const updates = cols.filter((c) => c !== "id").map((c) => `${c} = EXCLUDED.${c}`);

  const sql = updates.length
    ? `INSERT INTO ${name} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})
       ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}`
    : `INSERT INTO ${name} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})
       ON CONFLICT (id) DO NOTHING`;

  await getPool().query(sql, values);
  return item;
}

/** ลบทีละแถวด้วย SQL ตรงๆ — ตอนเป็นไฟล์ JSON การลบต้องอ่านทั้ง collection มา filter แล้ว
 *  เขียนทับทั้งไฟล์ แต่กับ Postgres การ DELETE ทั้งตารางแล้ว insert กลับทุกแถวเพื่อลบแถวเดียว
 *  ทั้งเปลืองและเสี่ยงชน foreign key ของแถวอื่นที่ไม่เกี่ยวข้อง */
export async function deleteOne(name: string, id: string): Promise<void> {
  tableMeta(name);
  await getPool().query(`DELETE FROM ${name} WHERE id = $1`, [id]);
}

export async function patchOne<T extends { id: string }>(
  name: string,
  id: string,
  patch: Partial<T>,
  seedFn?: () => T[] | Promise<T[]>
): Promise<T | null> {
  const meta = tableMeta(name);
  await ensureSeeded(name, seedFn);

  const record = patch as Record<string, unknown>;
  const cols = Object.keys(record);

  if (cols.length === 0) {
    const { rows } = await getPool().query(`SELECT * FROM ${name} WHERE id = $1`, [id]);
    return (rows[0] as T) ?? null;
  }

  const values = cols.map((c) => toParam(meta, c, record[c]));
  const setClause = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
  const { rows } = await getPool().query(
    `UPDATE ${name} SET ${setClause} WHERE id = $${cols.length + 1} RETURNING *`,
    [...values, id]
  );
  return (rows[0] as T) ?? null;
}
