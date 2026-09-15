/**
 * นำเข้าทะเบียนทรัพย์สินจริงเข้าคลังข้อมูลที่แอปใช้อยู่ (/app/data/*.json)
 *
 *   docker compose cp db/imports/equipment-import-2026-09-15.json app:/tmp/eq.json
 *   docker compose cp db/imports/import_equipment.js app:/tmp/import.js
 *   docker compose exec -T app node /tmp/import.js
 *
 * รันซ้ำได้ปลอดภัย — จับคู่ของเดิมด้วย (asset_code + serial) ก่อนเสมอ รันกี่รอบก็ได้จำนวนเท่าเดิม
 * สำรองไฟล์เดิมให้ก่อนเขียนทุกครั้ง (*.bak-import-2026-09-15)
 *
 * สิ่งที่ "ไม่" นำเข้า และเหตุผล:
 *   - คอลัมน์ "ซ่อมทั้งหมด (ครั้ง)" — ระบบคำนวณเองจากจำนวน ticket ประเภทซ่อมของเครื่องนั้น
 *     ถ้ายัดตัวเลขจาก CSV เข้าไปจะขัดกับของจริงทันทีที่มีคนแจ้งซ่อมเพิ่ม
 *   - "ค่าซ่อมรวม" (เป็น 0 ทุกแถว) และ "อายุ (วัน)" (เป็นค่าที่คำนวณมาแล้ว ไม่ใช่ข้อมูลดิบ)
 */
const fs = require("fs");
const crypto = require("crypto");

const EQ_FILE = "/app/data/equipment.json";
const USER_FILE = "/app/data/users.json";
const SRC = process.argv[2] || "/tmp/eq.json";
const SUFFIX = ".bak-import-2026-09-15";

const norm = (s) => (s == null ? "" : String(s).trim().replace(/\s+/g, " "));
const key = (code, serial) => `${norm(code).toUpperCase()}||${norm(serial).toUpperCase()}`;

function backup(file) {
  if (!fs.existsSync(file + SUFFIX)) {
    fs.copyFileSync(file, file + SUFFIX);
    console.log("สำรอง " + file + " -> " + file + SUFFIX);
  }
}
function writeAtomic(file, data) {
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(file + ".tmp", file);
}

const incoming = JSON.parse(fs.readFileSync(SRC, "utf8"));
const equipment = JSON.parse(fs.readFileSync(EQ_FILE, "utf8"));
const users = JSON.parse(fs.readFileSync(USER_FILE, "utf8"));
backup(EQ_FILE);
backup(USER_FILE);

// ---- ผู้ครอบครอง: ระบบผูกด้วย current_holder_id ไม่ใช่ข้อความอิสระ จึงต้องมี user ให้ผูกก่อน ----
const userByName = new Map();
for (const u of users) userByName.set(norm(u.display_name).toLowerCase(), u);

let createdUsers = 0;
function resolveHolder(name, department) {
  if (!name) return null;
  const k = norm(name).toLowerCase();
  const found = userByName.get(k);
  if (found) {
    // เติมแผนกให้ของเดิมถ้าเดิมว่างอยู่ ไม่ทับของที่มีอยู่แล้ว
    if (!found.department && department) found.department = department;
    return found.id;
  }
  const created = {
    display_name: norm(name),
    employee_id: null,
    department: department || null,
    line_user_id: null,
    email: null,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  users.push(created);
  userByName.set(k, created);
  createdUsers++;
  return created.id;
}

// ---- ดัชนีของเดิม ----
const byKey = new Map();
const byCode = new Map();
for (const e of equipment) {
  byKey.set(key(e.asset_code, e.serial_number), e);
  if (!byCode.has(norm(e.asset_code).toUpperCase())) byCode.set(norm(e.asset_code).toUpperCase(), e);
}

let updated = 0, inserted = 0, replacedDemo = 0;
for (const row of incoming) {
  const holderId = resolveHolder(row.holder_name, row.holder_department);
  const fields = {
    asset_code: row.asset_code,
    brand_model: row.brand_model,
    serial_number: row.serial_number,
    category: row.category,
    status: row.status,
    install_location: row.install_location,
    current_holder_id: holderId,
  };

  const exact = byKey.get(key(row.asset_code, row.serial_number));
  // รหัสตรงกับแถวเดิมที่เป็นข้อมูลตัวอย่าง (serial ว่าง หรือขึ้นต้น "SN-" ซึ่งเป็นรูปแบบของ seed
  // ใน src/lib/db/equipment.ts) -> ทับด้วยของจริง แทนที่จะสร้างแถวใหม่ให้รหัสซ้ำกันเอง
  const sameCode = byCode.get(norm(row.asset_code).toUpperCase());
  const isDemo = (e) => !norm(e.serial_number) || /^SN-/i.test(norm(e.serial_number));
  const target = exact || (sameCode && isDemo(sameCode) ? sameCode : null);

  if (target) {
    const wasDemo = !exact;
    Object.assign(target, fields);
    if (holderId && !target.current_holder_since) target.current_holder_since = new Date().toISOString();
    if (!holderId) target.current_holder_since = null;
    byKey.set(key(target.asset_code, target.serial_number), target);
    updated++;
    if (wasDemo) replacedDemo++;
    continue;
  }

  const created = {
    ...fields,
    purchase_price: null,
    notes: null,
    purchase_date: null,
    warranty_expiry: null,
    current_holder_since: holderId ? new Date().toISOString() : null,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  equipment.push(created);
  byKey.set(key(created.asset_code, created.serial_number), created);
  if (!byCode.has(norm(created.asset_code).toUpperCase())) byCode.set(norm(created.asset_code).toUpperCase(), created);
  inserted++;
}

writeAtomic(USER_FILE, users);
writeAtomic(EQ_FILE, equipment);

const byCat = equipment.reduce((a, e) => ((a[e.category] = (a[e.category] || 0) + 1), a), {});
const byStatus = equipment.reduce((a, e) => ((a[e.status] = (a[e.status] || 0) + 1), a), {});
console.log(`\nแถวใน CSV ที่ส่งเข้ามา : ${incoming.length}`);
console.log(`เพิ่มใหม่              : ${inserted}`);
console.log(`อัปเดตของเดิม          : ${updated} (ในนั้นทับแถวตัวอย่างเดิม ${replacedDemo})`);
console.log(`สร้างผู้ครอบครองใหม่    : ${createdUsers} คน/สาขา (รวมทั้งหมด ${users.length})`);
console.log(`\nทรัพย์สินรวมตอนนี้      : ${equipment.length}`);
console.log("แยกตามประเภท          :", JSON.stringify(byCat, null, 0));
console.log("แยกตามสถานะ           :", JSON.stringify(byStatus, null, 0));
console.log("\nอย่าลืม: docker compose restart bot  (บอท cache ข้อมูลไว้ 5 นาที)");
