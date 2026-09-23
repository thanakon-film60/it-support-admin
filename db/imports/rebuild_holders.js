/**
 * สร้างข้อมูล "ผู้ครอบครอง" ใหม่ทั้งชุดจากไฟล์ holders CSV
 *   - ล้างผู้ครอบครองเดิมออก (ทั้งที่สร้างอัตโนมัติตอนนำเข้าทรัพย์สิน และของตัวอย่าง)
 *   - สร้างใหม่จากไฟล์ พร้อมรหัสพนักงาน/แผนก
 *   - ผูกกลับเข้าทรัพย์สินทีละเครื่องด้วย asset_code แล้วใส่วันที่ครอบครองจริงจากไฟล์
 *
 *   docker compose cp db/imports/holders-import-2026-09-15.json app:/tmp/holders.json
 *   docker compose cp db/imports/rebuild_holders.js app:/tmp/holders.js
 *   docker compose exec -T app node /tmp/holders.js /tmp/holders.json
 *   docker compose restart bot
 *
 * สิ่งที่ "ไม่ลบ" แม้จะไม่อยู่ในไฟล์ใหม่ (ลบแล้วข้อมูลอื่นพังตาม):
 *   - user ที่เป็นผู้แจ้งใน ticket (tickets.requester_id) — ลบแล้วหน้า ticket จะไม่รู้ว่าใครแจ้ง
 *   - user ที่มี line_user_id — คือคนที่เคยคุยกับบอทจริง บอทใช้ id นี้จับคู่ "เรื่องที่ฉันแจ้ง"
 *
 * รหัสทรัพย์สินที่ซ้ำกันหลายเครื่อง: จับคู่ตามลำดับที่เจอในไฟล์ (เครื่องที่ 1 ได้ผู้ครอบครองแถวแรก
 * เครื่องที่ 2 ได้แถวถัดไป) เพราะไฟล์ไม่มี serial ให้ระบุเจาะจงว่าแถวไหนคือเครื่องไหน
 */
const fs = require("fs");
const crypto = require("crypto");

const EQ = "/app/data/equipment.json";
const USERS = "/app/data/users.json";
const TICKETS = "/app/data/tickets.json";
const SUFFIX = ".bak-holders-2026-09-15";
const SRC = process.argv[2] || "/tmp/holders.json";

const norm = (s) => (s == null ? "" : String(s).trim().replace(/\s+/g, " "));
const lc = (s) => norm(s).toLowerCase();

function backup(f) {
  if (fs.existsSync(f) && !fs.existsSync(f + SUFFIX)) fs.copyFileSync(f, f + SUFFIX);
}
function writeAtomic(f, d) {
  fs.writeFileSync(f + ".tmp", JSON.stringify(d, null, 2) + "\n", "utf8");
  fs.renameSync(f + ".tmp", f);
}

const incoming = JSON.parse(fs.readFileSync(SRC, "utf8"));
const equipment = JSON.parse(fs.readFileSync(EQ, "utf8"));
const oldUsers = JSON.parse(fs.readFileSync(USERS, "utf8"));
const tickets = fs.existsSync(TICKETS) ? JSON.parse(fs.readFileSync(TICKETS, "utf8")) : [];
[EQ, USERS].forEach(backup);

// ---- user ที่ห้ามลบ ----
const usedByTickets = new Set(tickets.map((t) => t.requester_id).filter(Boolean));
const keep = oldUsers.filter((u) => usedByTickets.has(u.id) || u.line_user_id);
const removed = oldUsers.length - keep.length;

const users = [...keep];
const byName = new Map(users.map((u) => [lc(u.display_name), u]));
let createdUsers = 0;
function upsertUser(row) {
  let u = byName.get(lc(row.holder_name));
  if (!u) {
    u = {
      display_name: norm(row.holder_name),
      employee_id: row.employee_id,
      department: row.department,
      line_user_id: null,
      email: row.email,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    users.push(u);
    byName.set(lc(u.display_name), u);
    createdUsers++;
  } else {
    if (row.employee_id) u.employee_id = row.employee_id;
    if (row.department) u.department = row.department;
    if (row.email) u.email = row.email;
  }
  return u;
}

// ---- ล้างผู้ครอบครองเดิมออกจากทรัพย์สินทุกชิ้นก่อน แล้วค่อยผูกใหม่ ----
for (const e of equipment) {
  e.current_holder_id = null;
  e.current_holder_since = null;
}

const freeByCode = new Map(); // asset_code -> คิวเครื่องที่ยังไม่ถูกจับคู่
for (const e of equipment) {
  const k = norm(e.asset_code).toUpperCase();
  if (!freeByCode.has(k)) freeByCode.set(k, []);
  freeByCode.get(k).push(e);
}

let linked = 0;
const unmatched = [];
for (const row of incoming) {
  const user = upsertUser(row);
  const queue = freeByCode.get(row.asset_code);
  const target = queue && queue.shift();
  if (!target) {
    unmatched.push(row);
    continue;
  }
  target.current_holder_id = user.id;
  target.current_holder_since = row.since || new Date().toISOString();
  linked++;
}

writeAtomic(USERS, users);
writeAtomic(EQ, equipment);

const held = equipment.filter((e) => e.current_holder_id).length;
console.log(`แถวผู้ครอบครองในไฟล์   : ${incoming.length}`);
console.log(`ผูกเข้ากับทรัพย์สินสำเร็จ : ${linked}`);
console.log(`หาเครื่องไม่เจอ         : ${unmatched.length}` +
  (unmatched.length ? " -> " + unmatched.map((u) => `${u.asset_code}(แถว ${u.row})`).join(", ") : ""));
console.log(`\nผู้ครอบครองเดิมที่ลบออก  : ${removed}`);
console.log(`เก็บไว้เพราะยังถูกอ้างถึง : ${keep.length} (ผู้แจ้ง ticket / ผู้ใช้ LINE)`);
console.log(`สร้างใหม่จากไฟล์         : ${createdUsers}`);
console.log(`ผู้ใช้ในระบบรวม          : ${users.length}`);
console.log(`\nทรัพย์สินทั้งหมด ${equipment.length} ชิ้น · มีผู้ครอบครอง ${held} · ว่าง ${equipment.length - held}`);
