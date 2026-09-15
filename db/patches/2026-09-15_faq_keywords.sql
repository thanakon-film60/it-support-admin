-- เพิ่มคำพ้องให้ FAQ ที่มีอยู่ ไม่ได้เพิ่ม/ลบข้อ FAQ และไม่แตะ title/content
-- ⚠️ ไฟล์นี้ "ยังไม่มีผลกับระบบที่รันอยู่ตอนนี้" — ตรวจเมื่อ 2026-09-15 พบว่าแอปอ่าน/เขียน
--    /app/data/*.json ไม่ได้อ่านจาก Postgres เลย (DATABASE_URL ตั้งไว้แต่ยังไม่มีโค้ดใช้)
--    ตัวที่มีผลจริงคือ 2026-09-15_faq_keywords.js — เก็บไฟล์ SQL นี้ไว้ใช้ตอนย้ายไป Postgres/Supabase
--
--
-- ที่มา: รัน line-bot-python/check_ai.py กับข้อมูลจริงแล้วพบว่าคำที่คนพูดจริงหลายคำ
-- ไม่แมตช์กับคีย์เวิร์ดชุดเดิม เช่น "เครื่องพิมพ์กระดาษติด" ได้ intent=unknown
-- ทั้งที่มี FAQ "ปริ้นเอกสารไม่ได้" อยู่ (ปัญหานี้ถูกบันทึกไว้ใน line-bot-python/README.md ข้อ 5)
--
-- รันซ้ำได้ปลอดภัย (distinct + unnest จึงไม่มีคำซ้ำสะสม):
--   docker compose cp db/patches/2026-09-15_faq_keywords.sql db:/tmp/p.sql
--   docker compose exec -T db psql -U itadmin -d itadmin -f /tmp/p.sql

BEGIN;

UPDATE faq_items SET keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
  'เครื่องพิมพ์', 'ปริ้นเตอร์', 'พริ้นเตอร์', 'กระดาษติด', 'หมึกหมด', 'ปริ้นงานไม่ออก', 'print'
])) WHERE title = 'ปริ้นเอกสารไม่ได้';

UPDATE faq_items SET keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
  'เน็ตไม่ได้', 'อินเทอร์เน็ตไม่ได้', 'เข้าเน็ตไม่ได้', 'เน็ตช้า', 'ไวไฟ', 'wifi ไม่ติด', 'ต่อ wifi ไม่ได้'
])) WHERE title = 'Wifi หลุดบ่อย สัญญาณอ่อน';

UPDATE faq_items SET keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
  'รีเซ็ตรหัส', 'เปลี่ยนรหัสผ่าน', 'ขอรหัสใหม่', 'รหัสหมดอายุ', 'login ไม่ได้'
])) WHERE title = 'ลืมรหัสผ่าน';

UPDATE faq_items SET keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
  'เมลไม่เข้า', 'รับเมลไม่ได้', 'outlook', 'อีเมลเข้าไม่ได้', 'ส่งไฟล์แนบไม่ได้'
])) WHERE title = 'ไม่สามารถส่งอีเมลได้';

UPDATE faq_items SET keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
  'ยิงบาร์โค้ดไม่ติด', 'สแกนไม่ติด', 'ปริ้นสติกเกอร์ไม่ออก', 'เครื่องยิงบาร์โค้ด', 'ป้ายราคาไม่ออก'
])) WHERE title = 'เครื่องพิมพ์บาร์โค้ด/สแกนเนอร์ไม่ทำงาน';

UPDATE faq_items SET keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
  'เครื่องช้า', 'คอมช้า', 'กดอะไรไม่ได้', 'จอค้าง', 'เครื่องแฮงค์'
])) WHERE title = 'คอมพิวเตอร์ค้าง หน้าจอไม่ตอบสนอง';

UPDATE faq_items SET keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
  'กล้องวงจรปิด', 'cctv', 'ดูกล้องย้อนหลังไม่ได้', 'กล้องดับ'
])) WHERE title = 'กล้องหน้าสาขาไม่สามารถดูได้';

UPDATE faq_items SET keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
  'pos', 'โปรแกรมขาย', 'ขายของไม่ได้', 'เปิดบิลไม่ได้', 'แคชเชียร์ใช้ไม่ได้'
])) WHERE title = 'โปรแกรมขายหน้าร้านเข้าใช้งานไม่ได้';

UPDATE faq_items SET keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
  'ไลน์เข้าไม่ได้', 'ไลน์ล่ม', 'line login ไม่ได้'
])) WHERE title = 'ไม่สามารถเข้า LINE ได้';

COMMIT;

SELECT title, array_length(keywords, 1) AS จำนวนคีย์เวิร์ด FROM faq_items ORDER BY title;
