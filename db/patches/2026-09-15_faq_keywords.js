/**
 * เพิ่มคำพ้องให้ FAQ ใน "คลังข้อมูลที่แอปใช้จริง" คือไฟล์ JSON ใต้ /app/data ของคอนเทนเนอร์ app
 *
 * ทำไมไม่ใช่ SQL: ตรวจเมื่อ 2026-09-15 พบว่าแอปที่รันอยู่อ่าน/เขียน /app/data/*.json
 * ไม่ได้อ่านจาก Postgres เลย (มี DATABASE_URL ตั้งไว้แต่ยังไม่มีโค้ดใช้ — ดู src/lib/db/store.ts)
 * แก้ที่ตาราง faq_items ใน Postgres จึงไม่มีผลกับบอท ไฟล์นี้คือตัวที่มีผลจริง
 *
 * รันซ้ำได้ปลอดภัย (ใส่ซ้ำไม่เพิ่มคำซ้ำ) และสำรองไฟล์เดิมไว้ก่อนเขียนเสมอ:
 *   docker compose cp db/patches/2026-09-15_faq_keywords.js app:/tmp/faq.js
 *   docker compose exec -T app node /tmp/faq.js
 *   docker compose restart bot      # ล้าง knowledge cache (TTL 5 นาที) ให้เห็นผลทันที
 *
 * ย้อนกลับ: docker compose exec -T app sh -lc "cp /app/data/faq_items.json.bak-2026-09-15 /app/data/faq_items.json"
 */
const fs = require("fs");

const FILE = "/app/data/faq_items.json";
const BACKUP = FILE + ".bak-2026-09-15";

// คำพ้องที่คนพูดจริงแต่ไม่มีในคีย์เวิร์ดเดิม — ที่มาจากการรัน line-bot-python/check_ai.py
const EXTRA = {
  "ปริ้นเอกสารไม่ได้": [
    "เครื่องพิมพ์", "เครื่องพิมพ์กระดาษติด", "ปริ้นเตอร์", "พริ้นเตอร์",
    "กระดาษติด", "หมึกหมด", "ปริ้นงานไม่ออก", "print",
  ],
  "Wifi หลุดบ่อย สัญญาณอ่อน": [
    "เน็ตไม่ได้", "อินเทอร์เน็ตไม่ได้", "เข้าอินเทอร์เน็ตไม่ได้", "เข้าเน็ตไม่ได้",
    "เน็ตช้า", "ไวไฟ", "wifi ไม่ติด", "ต่อ wifi ไม่ได้",
  ],
  "ลืมรหัสผ่าน": [
    "รีเซ็ตรหัส", "เปลี่ยนรหัสผ่าน", "ขอรหัสใหม่", "รหัสหมดอายุ", "login ไม่ได้",
  ],
  "ไม่สามารถส่งอีเมลได้": [
    "เมลไม่เข้า", "รับเมลไม่ได้", "outlook", "อีเมลเข้าไม่ได้", "ส่งไฟล์แนบไม่ได้",
  ],
  "เครื่องพิมพ์บาร์โค้ด/สแกนเนอร์ไม่ทำงาน": [
    "ยิงบาร์โค้ดไม่ติด", "สแกนไม่ติด", "ปริ้นสติกเกอร์ไม่ออก", "เครื่องยิงบาร์โค้ด", "ป้ายราคาไม่ออก",
  ],
  "คอมพิวเตอร์ค้าง หน้าจอไม่ตอบสนอง": [
    "เครื่องช้า", "คอมช้า", "กดอะไรไม่ได้", "จอค้าง", "เครื่องแฮงค์",
  ],
  "กล้องหน้าสาขาไม่สามารถดูได้": [
    "กล้องวงจรปิด", "cctv", "ดูกล้องย้อนหลังไม่ได้", "กล้องดับ",
  ],
  "โปรแกรมขายหน้าร้านเข้าใช้งานไม่ได้": [
    "pos", "โปรแกรมขาย", "ขายของไม่ได้", "เปิดบิลไม่ได้", "แคชเชียร์ใช้ไม่ได้",
  ],
  "ไม่สามารถเข้า LINE ได้": [
    "ไลน์เข้าไม่ได้", "ไลน์ล่ม", "line login ไม่ได้",
  ],
};

const items = JSON.parse(fs.readFileSync(FILE, "utf8"));
if (!fs.existsSync(BACKUP)) {
  fs.copyFileSync(FILE, BACKUP);
  console.log("สำรองไฟล์เดิมไว้ที่ " + BACKUP);
}

let touched = 0;
for (const item of items) {
  const extra = EXTRA[item.title];
  if (!extra) continue;
  const before = (item.keywords || []).length;
  // เทียบแบบ trim + lowercase เพื่อไม่ให้ได้คำซ้ำที่ต่างกันแค่ตัวพิมพ์/ช่องว่าง
  const seen = new Set((item.keywords || []).map((k) => k.trim().toLowerCase()));
  for (const word of extra) {
    if (!seen.has(word.trim().toLowerCase())) {
      item.keywords.push(word);
      seen.add(word.trim().toLowerCase());
    }
  }
  const added = item.keywords.length - before;
  if (added > 0) touched++;
  console.log(`${item.title}: ${before} -> ${item.keywords.length} (+${added})`);
}

// เขียนลงไฟล์ชั่วคราวก่อนแล้วค่อย rename — ถ้าเครื่องดับกลางคัน ไฟล์จริงจะไม่พังครึ่งๆ กลางๆ
const tmp = FILE + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(items, null, 2) + "\n", "utf8");
fs.renameSync(tmp, FILE);
console.log(`\nแก้ไขแล้ว ${touched} ข้อ จากทั้งหมด ${items.length} ข้อ`);
console.log("อย่าลืม: docker compose restart bot  (บอท cache knowledge ไว้ 5 นาที)");
