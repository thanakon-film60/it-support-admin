/**
 * สร้างข้อมูล "สต็อก" ใหม่ทั้งชุดจากไฟล์ CSV — ลบของเดิมออกหมด ใส่ของใหม่เข้าไปแทน
 *
 *   docker compose cp db/imports/stock-import-2026-09-15.json app:/tmp/stock.json
 *   docker compose cp db/imports/rebuild_stock.js app:/tmp/stock.js
 *   docker compose exec -T app node /tmp/stock.js /tmp/stock.json
 *   docker compose restart bot
 *
 * ไม่นำเข้าคอลัมน์ "สถานะ" จาก CSV เพราะระบบคำนวณเอง (ปกติ / ถึงขั้นต่ำ / ต่ำกว่า)
 * จากการเทียบ คงเหลือ กับ Safety Stock — ถ้ายัดค่าคงที่เข้าไปจะเพี้ยนทันทีที่มีคนเบิกของ
 *
 * stock_transactions ที่อ้างถึงของเดิมจะถูกลบไปด้วย เพราะ item ต้นทางไม่มีอยู่แล้ว
 * (ปล่อยไว้หน้า "ประวัติเบิก-รับเข้า" จะขึ้นรายการที่ชี้ไปยัง id ที่หายไป)
 */
const fs = require("fs");
const crypto = require("crypto");

const ITEMS = "/app/data/stock_items.json";
const TXNS = "/app/data/stock_transactions.json";
const SUFFIX = ".bak-stock-2026-09-15";
const SRC = process.argv[2] || "/tmp/stock.json";

function backup(f) {
  if (fs.existsSync(f) && !fs.existsSync(f + SUFFIX)) fs.copyFileSync(f, f + SUFFIX);
}
function writeAtomic(f, d) {
  fs.writeFileSync(f + ".tmp", JSON.stringify(d, null, 2) + "\n", "utf8");
  fs.renameSync(f + ".tmp", f);
}

const incoming = JSON.parse(fs.readFileSync(SRC, "utf8"));
const oldItems = fs.existsSync(ITEMS) ? JSON.parse(fs.readFileSync(ITEMS, "utf8")) : [];
const oldTxns = fs.existsSync(TXNS) ? JSON.parse(fs.readFileSync(TXNS, "utf8")) : [];
[ITEMS, TXNS].forEach(backup);

const now = new Date().toISOString();
const items = incoming.map((r) => ({
  name: r.name,
  category: r.category,
  unit: r.unit,
  location: r.location,
  quantity_available: r.quantity_available,
  safety_stock: r.safety_stock,
  id: crypto.randomUUID(),
  created_at: now,
}));

const liveIds = new Set(items.map((i) => i.id));
const txns = oldTxns.filter((t) => liveIds.has(t.stock_item_id));

writeAtomic(ITEMS, items);
writeAtomic(TXNS, txns);

const low = items.filter((i) => i.quantity_available < i.safety_stock);
console.log(`ลบสต็อกเดิมออก      : ${oldItems.length} รายการ`);
console.log(`ใส่ของใหม่เข้าไป     : ${items.length} รายการ`);
console.log(`ลบประวัติเบิก-รับเข้าที่อ้างของเดิม: ${oldTxns.length - txns.length} รายการ`);
console.log(`\nต่ำกว่า Safety Stock ${low.length} รายการ:`);
for (const i of low) console.log(`  - ${i.name}: เหลือ ${i.quantity_available} / ขั้นต่ำ ${i.safety_stock} ${i.unit}`);
