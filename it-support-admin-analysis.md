# วิเคราะห์ it-support-admin.vercel.app (เพื่อสร้างระบบ Clone)

อ้างอิง: https://it-support-admin.vercel.app/ (tenant label ที่เห็น: "ATFAVOURITE")
วันที่วิเคราะห์: 2026-09-14
วิธีวิเคราะห์: ไล่ทุกหน้าจริงผ่าน browser + อ่าน network request ที่ยิงไป Supabase REST API (PostgREST) เพื่อดึงชื่อ table/column จริงที่ frontend query

## Tech Stack ที่ตรวจพบ
- Frontend: Vite + SPA (bundle `index-*.js`), client-side routing (เปลี่ยนหน้าไม่ reload)
- Font: Google Fonts — Sarabun (ภาษาไทย) + Space Mono (ตัวเลข/โค้ด)
- Backend: **Supabase** (Postgres + PostgREST + Storage) — โปรเจกต์ `hbgeklogulgppvqyjxdg.supabase.co`
- Storage: bucket `faq-images` (public) สำหรับรูปแนบ FAQ
- Hosting: Vercel
- Theme: Dark theme ล้วน, การ์ด/ตารางแบบ minimal, badge สีตามสถานะ
- **ไม่มีระบบ Login/Auth ใดๆ** — เข้าถึง dashboard ได้ตรงๆ ไม่ต้องยืนยันตัวตน

## โครงสร้างเมนู (7 โมดูล)
1. 📊 ภาพรวม (Overview) — stat card 5 ใบ: Ticket ทั้งหมด, รอดำเนินการ, ทรัพย์สินทั้งหมด, อุปกรณ์ในการซ่อม, สต็อกใกล้หมด
2. 🎫 Tickets — ตาราง + search + filter ประเภท + status-tab bar (7 สถานะ) + export CSV + side-panel รายละเอียด (คลิกแถว) พร้อมปุ่มเปลี่ยนสถานะแบบ inline
3. 💻 ทรัพย์สิน (Assets) — ตาราง + ฟอร์ม "เพิ่มทรัพย์สินใหม่" แบบ inline (ไม่ใช่ modal) + filter ประเภท/สถานะ + Import Excel + Export CSV
4. 👤 ผู้ครอบครอง (Custodian) — read-only view ของ equipment ที่มีผู้ถือครองอยู่ปัจจุบัน
5. 🔧 ประวัติซ่อม (Repair History) — tickets ประเภท "repair" อย่างเดียว + ยอดค่าซ่อมรวม
6. 📦 สต็อก (Stock) — ตาราง stock + ฟอร์มเพิ่มรายการ + ปุ่ม "จัดการ" ต่อแถว (รับเข้าสต็อก / ปรับแก้จำนวน / แก้ Safety Stock) + ลิงก์ดูประวัติ transaction ทั้งหมด
7. 🤖 FAQ Bot — รายการ FAQ (คำถามที่พบบ่อย) มี keyword tag สำหรับให้ bot จับคู่ก่อนแนะนำให้สร้าง ticket, รองรับรูปแนบหลายรูป

**ข้อสังเกตสำคัญ:** ไม่มีปุ่ม "สร้าง Ticket" ในหน้า Tickets เลย → ticket ทั้งหมดถูกสร้างจากภายนอกระบบนี้ (ชื่อผู้แจ้งเป็น LINE display name ที่มี emoji ประดับแบบฉบับ LINE, และ query ที่เห็นมี `line_user_id`) แปลว่ามี LINE OA Bot/LIFF แยกต่างหากทำหน้าที่รับเรื่องจากพนักงาน แล้วเขียนลง Supabase เดียวกัน — เว็บที่เห็นเป็นแค่ฝั่ง "แอดมิน" สำหรับทีม IT จัดการเรื่องเท่านั้น

## Database Schema ที่สร้างใหม่จากการสังเกต Query จริง

```sql
-- ผู้ใช้/พนักงานที่แจ้งเรื่องหรือถือครองทรัพย์สิน
create table users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  employee_id text,
  department text,
  line_user_id text unique,      -- ผูกกับ LINE OA
  email text,
  created_at timestamptz default now()
);

-- ทรัพย์สิน/ครุภัณฑ์ IT
create table equipment (
  id uuid primary key default gen_random_uuid(),
  asset_code text unique not null,      -- เช่น PC2608002, NB2502002
  brand_model text,
  serial_number text,
  category text not null,   -- enum: notebook, desktop, monitor, mouse, keyboard,
                             --       phone, headset, printer, scanner, router,
                             --       projector, ups, server, tablet, other
  status text not null default 'ว่าง',  -- enum: ว่าง, จองแล้ว, ใช้งานอยู่, ส่งซ่อม, เลิกใช้งาน
  purchase_price numeric,
  install_location text,
  notes text,
  purchase_date date,
  warranty_expiry date,
  current_holder_id uuid references users(id),
  current_holder_since timestamptz,
  created_at timestamptz default now()
);

-- ตั๋วงาน (ครอบคลุมทั้ง 4 ประเภท)
create table tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text unique not null,     -- ITSR/ITRQ/ITRT/ITSV + YYYYMM + running no.
  type text not null,        -- enum: repair, withdraw, return, it_service
  status text not null default 'pending',
  -- enum: pending, in_progress, waiting_info, waiting_delivery, resolved, closed, cancelled
  location text,             -- สาขา
  requester_id uuid references users(id),
  equipment_id uuid references equipment(id),
  description text,
  repair_cost numeric,       -- ใช้เฉพาะ type=repair
  created_at timestamptz default now(),
  resolved_at timestamptz
);

-- สต็อกอุปกรณ์สิ้นเปลือง
create table stock_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,             -- free text ในต้นแบบ (ควร normalize เป็น enum)
  unit text default 'ชิ้น',
  location text,
  quantity_available integer not null default 0,
  safety_stock integer not null default 0,
  created_at timestamptz default now()
);
-- สถานะ "ปกติ/ถึงขั้นต่ำ/ต่ำกว่า" = คำนวณจาก quantity_available เทียบ safety_stock ไม่ได้เก็บเป็นคอลัมน์

create table stock_transactions (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid references stock_items(id),
  type text not null,        -- enum: in, adjust, out
  quantity integer not null,
  staff_name text,
  reference_no text,         -- เลข PO
  note text,
  created_at timestamptz default now()
);

-- ฐานความรู้ให้ bot แนะนำก่อนสร้าง ticket
create table faq_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  keywords text[],           -- ค้นด้วยจุลภาค
  content text,
  category text default 'general',  -- enum: general, hardware, software, network, printer, account
  image_urls text[],         -- เก็บใน storage bucket faq-images
  created_at timestamptz default now()
);

-- View สำหรับหน้าทรัพย์สิน (list เร็วขึ้น ไม่ join ฝั่ง client)
create view equipment_summary as
select e.*, 
       u.display_name as owner_name, u.department,
       (select count(*) from tickets t where t.equipment_id = e.id and t.type='repair') as repair_count,
       age(now(), e.purchase_date) as age
from equipment e
left join users u on u.id = e.current_holder_id;
```

## จุดที่ควรปรับปรุงจากต้นแบบ (ติเพื่อก่อ)
1. **ไม่มี Auth เลย** — ข้อมูลพนักงาน, ทรัพย์สิน, ค่าซ่อม เปิดให้ใครก็เข้าถึงได้ถ้ารู้ URL. ถ้าจะสร้างของจริงต้องมี login (แนะนำ Supabase Auth + RLS policy ผูกกับ role ทีม IT) → **แก้แล้วในระบบที่สร้างใหม่ (ดูหัวข้อ "สถานะงาน" ด้านล่าง)**
2. **stock_items.category เป็น free text** ไม่ใช่ enum เหมือน equipment.category → ข้อมูลจะเพี้ยน/สะกดไม่ตรงกันในระยะยาว ควร normalize
3. **การผูกผู้ครอบครองทรัพย์สินเป็นการพิมพ์ชื่อ/รหัสพนักงานอิสระ** ไม่ได้เลือกจาก users ที่มีอยู่ → เสี่ยงสร้าง user ซ้ำ ควรทำเป็น autocomplete/lookup แทน
4. **Business logic (ตัดสต็อกเมื่อ ticket เบิกของถูกปิด, บวกค่าซ่อมสะสม)** ควรอยู่ฝั่ง backend (Postgres function/trigger หรือ Edge Function) ไม่ใช่ client คำนวณเอง เพื่อความถูกต้องของข้อมูล
5. รูปแบบเลข ticket มี 2 ยุค (`IT2026-0001` แบบเก่า กับ `ITSR2026090100` แบบใหม่) — ของใหม่ควรใช้ scheme เดียวตั้งแต่ต้น

## สถานะงาน — ✅ สร้างเสร็จสมบูรณ์ (2026-09-14)

Scope ที่ตกลงกัน (ตอบผ่าน AskUserQuestion): **Admin Panel + LINE OA Bot เต็มรูปแบบ**, เริ่มจาก mock data,
เพิ่ม Login จริง, ใช้ชื่อ "IT Admin" ต่อไปก่อน — สร้างครบทั้งหมดแล้ว ดังนี้:

- **Admin Panel ครบทั้ง 7 โมดูล** (Overview / Tickets / ทรัพย์สิน / ผู้ครอบครอง / ประวัติซ่อม / สต็อก / FAQ Bot) หน้าตา สี badge ตาม status, layout ตาราง/ฟอร์ม inline, Export CSV (BOM UTF-8 เปิด Excel ภาษาไทยไม่เพี้ยน) ทำตามที่สำรวจจากต้นแบบทุกจุด รวมฟีเจอร์ "Import Excel" ของหน้าทรัพย์สินด้วย (ใช้ SheetJS/`xlsx`)
- **ระบบ Login/Auth จริง** — JWT session (`jose`) + bcrypt, cookie httpOnly, Next.js 16 `proxy.ts` เช็ค optimistic + `requireSession()` verify จริงทุกหน้า/ทุก Server Action (แก้ช่องโหว่ข้อ 1 ด้านบน)
- **LINE OA Bot** (`/api/line/webhook`) — verify HMAC signature จริง, จับคู่ FAQ ด้วย keyword ก่อนแนะนำสร้าง ticket, sync ผู้ใช้ LINE เข้า `users` table อัตโนมัติ
- **LIFF mini-app** (`/liff/new-ticket`) — ฟอร์มแจ้ง ticket ให้พนักงาน ดึงชื่อจาก LINE Profile อัตโนมัติเมื่อมี `LIFF_ID` จริง, fallback เป็นกรอกชื่อเองถ้ายังไม่ได้ตั้งค่า (ทดสอบได้ทันทีแม้ไม่มี LINE channel จริง)
- **Mock data layer แบบ swappable** — adapter เดียว (`src/lib/db/store.ts`) ทุก repository เรียกผ่านนี้ทั้งหมด พร้อม migrate ไป Supabase (schema ด้านบนตรงกับ mock data ทุกตาราง)
- **ตรวจสอบจริงแล้ว ไม่ใช่แค่ type-check**: รัน `next build` (production) สำเร็จ, รัน `next start` จริงแล้วทดสอบด้วย Playwright ทั้ง 7 หน้าแอดมิน + login/logout + LINE webhook (ทั้ง signature ผ่าน/ไม่ผ่าน) + LIFF submit ticket ครบ — 0 console error
- ส่งมอบเป็นไฟล์ `it-support-admin.zip` (source code, ไม่รวม `node_modules`) พร้อม `README.md` ละเอียด (setup, ตั้งค่า LINE, migrate Supabase, รายการสิ่งที่ควรทำต่อก่อน production) และ `.env.example`

**ยังไม่ได้ทำ (ตั้งใจปล่อยตาม scope มี mock data ก่อน):** ต่อ Supabase จริง, RLS policy, เปลี่ยนรหัสผ่านบัญชีทดสอบ,
normalize `stock_items.category`, autocomplete ผู้ครอบครองแทนพิมพ์ชื่ออิสระ — รายละเอียดครบใน README.md หัวข้อ
"สิ่งที่ควรทำต่อก่อนขึ้น production"