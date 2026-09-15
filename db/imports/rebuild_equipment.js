/**
 * สร้างทะเบียนทรัพย์สินใหม่ทั้งตาราง = เอา "ทุกแถวใน CSV" เข้าไปตรงๆ (รวมแถวซ้ำ ไม่ตัดอะไรเลย)
 * และลบข้อมูลตัวอย่าง 24 รายการที่ติดมาตั้งแต่ตอนสร้างระบบออกให้หมด
 *
 *   docker compose cp db/imports/equipment-import-2026-09-15-all.json app:/tmp/eq-all.json
 *   docker compose cp db/imports/rebuild_equipment.js app:/tmp/rebuild.js
 *   docker compose exec -T app node /tmp/rebuild.js /tmp/eq-all.json
 *   docker compose restart bot
 *
 * "ข้อมูลตัวอย่าง 24 รายการ" ระบุจากไฟล์สำรองก่อนนำเข้ารอบแรก (equipment.json.bak-import-2026-09-15)
 * ซึ่งเก็บสภาพตารางตอนที่ยังมีแต่ seed อยู่ — แม่นกว่าการเดาจากรูปแบบ serial
 *
 * ticket ที่อ้างถึงทรัพย์สินตัวอย่างที่ถูกลบ จะถูกเคลียร์ equipment_id เป็น null
 * (ถ้าปล่อยไว้ หน้า ticket จะชี้ไปยัง id ที่ไม่มีอยู่จริง)
 *
 * รันซ้ำได้ — เพราะเป็นการเขียนทับทั้งตารางจากไฟล์ CSV ทุกครั้ง ไม่ใช่การ append
 */
const fs = require("fs");
const crypto = require("crypto");

const EQ = "/app/data/equipment.json";
const USERS = "/app/data/users.json";
const TICKETS = "/app/data/tickets.json";
const SEED_BACKUP = EQ + ".bak-import-2026-09-15";
const SUFFIX = ".bak-rebuild-2026-09-15";
const SRC = process.argv[2] || "/tmp/eq-all.json";

const norm = (s) => (s == null ? "" : String(s).trim().replace(/\s+/g, " "));

function backup(f) {
  if (fs.existsSync(f) && !fs.existsSync(f + SUFFIX)) {
    fs.copyFileSync(f, f + SUFFIX);
    console.log("สำรอง " + f + SUFFIX);
  }
}
function writeAtomic(f, data) {
  fs.writeFileSync(f + ".tmp", JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(f + ".tmp", f);
}

const incoming = JSON.parse(fs.readFileSync(SRC, "utf8"));
const users = JSON.parse(fs.readFileSync(USERS, "utf8"));
const tickets = fs.existsSync(TICKETS) ? JSON.parse(fs.readFileSync(TICKETS, "utf8")) : [];

if (!fs.existsSync(SEED_BACKUP)) {
  console.error("ไม่พบ " + SEED_BACKUP + " — หยุดไว้ก่อน เพราะจะไม่รู้ว่า 24 รายการตัวอย่างคืออันไหน");
  process.exit(1);
}
const seedIds = new Set(JSON.parse(fs.readFileSync(SEED_BACKUP, "utf8")).map((e) => e.id));
console.log("ข้อมูลตัวอย่างที่จะลบ: " + seedIds.size + " รายการ");

backup(EQ);
backup(USERS);
backup(TICKETS);

// ---- ผู้ครอบครอง: ใช้ของเดิมถ้ามีอยู่แล้ว ไม่สร้างซ้ำ ----
const byName = new Map();
for (const u of users) byName.set(norm(u.display_name).toLowerCase(), u);
let createdUsers = 0;
function holderId(name, dept) {
  if (!name) return null;
  const k = norm(name).toLowerCase();
  let u = byName.get(k);
  if (!u) {
    u = {
      display_name: norm(name),
      employee_id: null,
      department: dept || null,
      line_user_id: null,
      email: null,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    users.push(u);
    byName.set(k, u);
    createdUsers++;
  } else if (!u.department && dept) {
    u.department = dept;
  }
  return u.id;
}

const now = new Date().toISOString();
const equipment = incoming.map((row) => {
  const hid = holderId(row.holder_name, row.holder_department);
  return {
    asset_code: row.asset_code,
    brand_model: row.brand_model,
    serial_number: row.serial_number,
    category: row.category,
    status: row.status,
    purchase_price: null,
    install_location: row.install_location,
    notes: null,
    purchase_date: null,
    warranty_expiry: null,
    current_holder_id: hid,
    current_holder_since: hid ? now : null,
    id: crypto.randomUUID(),
    created_at: now,
  };
});

// ---- เคลียร์ ticket ที่ชี้ไปยังทรัพย์สินที่ถูกลบ ----
let orphaned = 0;
for (const t of tickets) {
  if (t.equipment_id && seedIds.has(t.equipment_id)) {
    t.equipment_id = null;
    orphaned++;
  }
}

writeAtomic(USERS, users);
writeAtomic(EQ, equipment);
if (tickets.length) writeAtomic(TICKETS, tickets);

const count = (f) => equipment.reduce((a, e) => ((a[f(e)] = (a[f(e)] || 0) + 1), a), {});
const codes = new Set(equipment.map((e) => norm(e.asset_code).toUpperCase()));
console.log(`\nแถวใน CSV            : ${incoming.length}  (ใส่ครบทุกแถว ไม่ตัดซ้ำ)`);
console.log(`ทรัพย์สินในระบบตอนนี้ : ${equipment.length}`);
console.log(`ลบข้อมูลตัวอย่างออก   : ${seedIds.size} รายการ`);
console.log(`ticket ที่เคยอ้างของตัวอย่าง -> เคลียร์เป็นว่าง: ${orphaned} ใบ`);
console.log(`ผู้ครอบครองที่สร้างเพิ่มรอบนี้: ${createdUsers} (รวม ${users.length})`);
console.log(`รหัสทรัพย์สินที่ไม่ซ้ำกัน: ${codes.size} จาก ${equipment.length} แถว`);
console.log("แยกตามประเภท        :", JSON.stringify(count((e) => e.category)));
console.log("แยกตามสถานะ         :", JSON.stringify(count((e) => e.status)));
