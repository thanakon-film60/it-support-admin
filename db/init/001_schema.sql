-- 001_schema.sql — สร้างตารางหลักของระบบ IT Admin
-- อิงจาก schema ที่ออกแบบไว้ใน it-support-admin-analysis.md (ต้นแบบ Supabase) แต่ id เป็น text
-- เพราะแอปฝั่ง JS เป็นคนสร้าง id เอง (randomUUID() ใน src/lib/utils.ts) ไม่ได้พึ่ง default ของ DB
--
-- ไฟล์นี้รันอัตโนมัติโดย postgres image ตอน container เริ่มครั้งแรกเท่านั้น (เมื่อ data
-- directory ว่างเปล่า) ผ่าน /docker-entrypoint-initdb.d/ — ดู docker-compose.yml

CREATE TABLE users (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  employee_id text,
  department text,
  line_user_id text UNIQUE,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE equipment (
  id text PRIMARY KEY,
  asset_code text UNIQUE NOT NULL,
  brand_model text,
  serial_number text,
  category text NOT NULL,
  status text NOT NULL DEFAULT 'ว่าง',
  purchase_price numeric,
  install_location text,
  notes text,
  purchase_date date,
  warranty_expiry date,
  current_holder_id text REFERENCES users(id) ON DELETE SET NULL,
  current_holder_since timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_equipment_status ON equipment(status);
CREATE INDEX idx_equipment_holder ON equipment(current_holder_id);

CREATE TABLE tickets (
  id text PRIMARY KEY,
  ticket_code text UNIQUE NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  location text,
  requester_id text REFERENCES users(id) ON DELETE SET NULL,
  equipment_id text REFERENCES equipment(id) ON DELETE SET NULL,
  description text,
  repair_cost numeric,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_type ON tickets(type);
CREATE INDEX idx_tickets_equipment ON tickets(equipment_id);

CREATE TABLE stock_items (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text,
  unit text NOT NULL DEFAULT 'ชิ้น',
  location text,
  quantity_available integer NOT NULL DEFAULT 0,
  safety_stock integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_transactions (
  id text PRIMARY KEY,
  stock_item_id text REFERENCES stock_items(id) ON DELETE SET NULL,
  type text NOT NULL,
  quantity integer NOT NULL,
  staff_name text,
  reference_no text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_txn_item ON stock_transactions(stock_item_id);

CREATE TABLE faq_items (
  id text PRIMARY KEY,
  title text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  content text,
  category text NOT NULL DEFAULT 'general',
  image_urls text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staff_accounts (
  id text PRIMARY KEY,
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'it_staff',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- บอกว่า collection ไหน seed ไปแล้วบ้าง (เทียบเท่า "ไฟล์ JSON มีอยู่แล้วหรือยัง" ของ mock store เดิม)
-- เช็คจากตารางนี้แทนการเช็คว่า "ตอนนี้มีข้อมูลกี่แถว" เพื่อไม่ให้ seed ข้อมูลตัวอย่างย้อนกลับมา
-- ถ้าแอดมินลบข้อมูลทิ้งจริงๆ ภายหลัง (เช่น ลบ FAQ ทั้งหมด)
CREATE TABLE _seed_state (
  collection text PRIMARY KEY,
  seeded_at timestamptz NOT NULL DEFAULT now()
);

-- View สรุปทรัพย์สิน เทียบเท่า equipment_summary ของต้นแบบ — ไว้ query ตรงๆ ด้วย SQL/BI
-- ภายนอกได้สะดวก (ตัวแอปเองยังคำนวณ summary ใน JS ที่ src/lib/db/equipment.ts เหมือนเดิม ไม่ได้พึ่ง view นี้)
CREATE VIEW equipment_summary AS
SELECT e.*,
       u.display_name AS owner_name,
       u.department AS owner_department,
       (SELECT count(*) FROM tickets t WHERE t.equipment_id = e.id AND t.type = 'repair') AS repair_count
FROM equipment e
LEFT JOIN users u ON u.id = e.current_holder_id;
