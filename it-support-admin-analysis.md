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

## อัปเดต (2026-09-14 ช่วงบ่าย) — ตรวจสอบสถานะจริง + เชื่อมต่อ LINE OA จริง

Session นี้เป็นการ "ต่อยอด" ไม่ใช่เริ่มใหม่ — สิ่งที่ทำไปมีดังนี้:

1. **ตรวจสอบพบว่าบอท Python (`line-bot-python/`) ถูกสร้างไว้ครบสมบูรณ์แล้ว** ตรงกับ flow ที่ผู้ใช้ต้องการ
   ทุกขั้นตอน (สาขา → ประเภท → รหัสทรัพย์สิน → [เบิก: เลือกของ+จำนวน] → ผู้แจ้ง → รายละเอียด → ออกเลข ticket)
   รวมความสามารถเสริม (ตอบคำถามสต็อก/ทรัพย์สิน/สถานะ ticket จากข้อมูลจริง, จับ intent จากประโยคเดียว, FAQ ด้วย
   TF-IDF + fuzzy) มีชุดเทสต์ 51+48 เคสอยู่แล้ว (`pytest`, `tests/e2e/run_e2e.py`) — ดูรายละเอียดสถาปัตยกรรมและ
   คำอธิบายชั้น AI ทั้งหมดใน `line-bot-python/README.md`
2. **พบว่า Webhook URL จริงใน LINE Developers Console (channel "IT-Support-Admin", ID `2011597498`) ยังชี้ไปที่
   บอท TypeScript เดิม (`/api/line/webhook`, ตอบแค่ FAQ) ไม่ใช่บอท Python** — โค้ดพร้อมแล้วแต่ยังไม่ได้ "สลับสวิตช์"
   ให้ใช้งานจริง เป็นช่องว่างหลักที่ต้องปิดต่อ (ดูขั้นตอนที่เหลือใน `line-bot-python/README.md` หัวข้อ "เชื่อมกับ LINE
   Official Account")
3. **แก้ `package.json`**: เพิ่ม `pg` + `@types/pg` เข้า dependencies/devDependencies ให้ตรงกับที่ติดตั้งจริงใน
   `node_modules` (ใช้จริงใน `src/lib/db/pg.ts` ซึ่งเตรียมไว้สำหรับย้ายไป Supabase แต่ยังไม่ได้ใช้งาน) — เดิมไฟล์นี้
   ไม่ได้ประกาศไว้ ถ้า `npm install` ใหม่บนเครื่องอื่น/CI จะพังตอน build ทันที พบ `@line/bot-sdk` ติดตั้งไว้ด้วยแต่ไม่มี
   โค้ด TS ที่ไหนเรียกใช้เลย (ฝั่ง Python ใช้ `line-bot-sdk` ของ PyPI คนละตัวกัน) — คาดว่าเป็นของเหลือตอนทดลอง ยังไม่ได้ลบ
4. **สร้าง `.env.local` (Next.js) และ `line-bot-python/.env` จริง** — ดึง Channel Secret / Channel Access Token
   จาก LINE Developers Console ของ channel นี้ตรงๆ, สุ่ม `SESSION_SECRET` และ `INTERNAL_API_KEY` ใหม่ (ให้ตรงกัน
   ทั้งสองไฟล์) ทั้งสองไฟล์อยู่ใน `.gitignore` แล้วจึงไม่หลุดเข้า git
5. **ยังไม่ได้รัน `npm run build` / `pytest` เพื่อยืนยันจริงในรอบนี้** — sandbox ฝั่ง Claude ใช้งานไม่ได้ชั่วคราว
   (VM service down) ต้องรันยืนยันอีกครั้งก่อนขึ้นใช้งานจริง
6. **สิ่งที่เหลือ ต้องทำบนเครื่องจริงของผู้ใช้เท่านั้น** (Claude ไม่มีเครื่องมือรันโปรเซสค้างบนเครื่อง Windows นี้ได้):
   รัน `npm run dev` + `uvicorn app.main:app --port 8000` พร้อมกัน, ตั้งค่า Tailscale ให้ path `/webhook` ชี้ไป
   port 8000 (ตอนนี้โดเมน `win-qrb8cpgc62i.taila97ec8.ts.net` ชี้ไป Next.js ที่ port 3000 อย่างเดียว), แล้วค่อยแก้
   Webhook URL ใน Developers Console เป็น `/webhook` + กด Verify

> **⚠️ แก้ไขบันทึกข้างบน (ข้อ 6):** สมมติฐานที่ว่า "รัน `npm run dev` + `uvicorn` ตรงๆ บนเครื่อง" **ผิด** — ตรวจ
> เจอภายหลังว่าโปรเจกต์นี้รันจริงผ่าน **docker-compose** (มี `docker-compose.yml` ที่ root อยู่แล้ว, container
> `app` จับ port 3000 อยู่ก่อนแล้ว) ดูหัวข้อถัดไปซึ่งเป็นข้อมูลที่ถูกต้องแทน

## อัปเดต (2026-09-14 ช่วงเย็น) — พบว่าระบบรันจริงผ่าน docker-compose, เจอบั๊กจริง 3 ตัว, แก้ไปแล้ว 2 ตัว

ผู้ใช้แจ้งว่า "docker desktop เอาไปใส่ไม่ได้" — ตรวจสอบผ่าน shell จริงบนเครื่อง (ไม่ใช่ sandbox) แล้วพบว่าเครื่องนี้
รันทุกอย่างผ่าน `docker compose` อยู่แล้ว (`db`, `app`, `caddy`, `duckdns`) ต่างจากที่บันทึกไว้ในหัวข้อก่อนหน้าโดยสิ้นเชิง
เลยตรวจสอบ stack จริงทั้งหมดใหม่ และทดสอบแบบ end-to-end จริง (ไม่ใช่แค่อ่านโค้ดแล้วเดา) พบบั๊กที่ยังไม่เคยมีใครรู้มาก่อน
3 ตัว:

### บั๊กที่ 1 (แก้แล้ว) — `LINE_CHANNEL_SECRET` ใน `.env` เก่าค้าง ไม่ตรงกับ LINE Developers Console จริง
ผลคือ **webhook ทุก request จาก LINE จะตรวจ HMAC signature ไม่ผ่านตลอด** (บอทเงียบสนิทแม้ตั้งค่าถูกทุกอย่างอื่น)
ตรวจสอบข้ามกับหน้า Developers Console ของ channel "IT-Support-Admin" (ID `2011597498`) ตรงๆ แล้วแก้ค่าใน
`.env` ให้ตรง (`LINE_CHANNEL_ACCESS_TOKEN` เดิมถูกอยู่แล้ว ไม่ต้องแก้)

### บั๊กที่ 2 (แก้แล้ว) — `INTERNAL_API_KEY` ไม่เคยถูกส่งเข้า container `app` เลย
`docker-compose.yml` เดิมไม่มีบรรทัด `INTERNAL_API_KEY` ใน `environment:` ของ service `app` เลยแม้แต่บรรทัดเดียว
ผลคือ `verifyInternalKey()` (fail-closed ถ้าไม่ตั้งค่า) จะ**ปฏิเสธทุก request ที่ยิงเข้า `/api/internal/*` ด้วย 401
เสมอ** — ต่อให้บอทตัวไหนก็ตามยิงเข้ามาก็ใช้งานไม่ได้ ไม่เกี่ยวกับบอท Python เลย เป็นบั๊กเดิมของ infra แก้โดยเพิ่ม
`INTERNAL_API_KEY: ${INTERNAL_API_KEY}` เข้า `environment:` ของ service `app` ใน `docker-compose.yml`

### บั๊กที่ 3 (แก้แล้ว ระหว่างรอ verify) — `next.config.ts` ไม่เคยตั้ง `output: "standalone"`
พบระหว่างพยายาม rebuild image `app` เพื่อแก้ปัญหา E2E test ล้มเหลว (ดูหัวข้อ "การ containerize บอท Python"
ด้านล่าง) — `npm run build` ผ่านสมบูรณ์ทุกครั้ง (compile/TypeScript/generate pages ไม่มี error เลย) แต่
`docker build` พังตอน `COPY --from=builder /app/.next/standalone ./` เพราะโฟลเดอร์นั้นไม่เคยถูกสร้างขึ้นมาจริง —
สาเหตุคือ `next.config.ts` ไม่มี `output: "standalone"` ซึ่ง Dockerfile (multi-stage, runner stage) ต้องพึ่งพา
ค่านี้โดยตรง แก้แล้วโดยเพิ่มบรรทัดนี้เข้า `next.config.ts` — **กำลังรอยืนยันผล rebuild รอบใหม่อยู่** (เครื่องมือ
shell ฝั่ง Claude หน่วงชั่วคราวระหว่างเซสชันนี้ ยังไม่เห็นผล build รอบล่าสุด ต้อง verify ต่อก่อนถือว่าจบงาน)

### การ containerize บอท Python เข้า docker-compose (โครงสร้างเสร็จ ทดสอบหน่วยผ่านแล้ว)
- เพิ่ม service `bot` (build จาก `line-bot-python/Dockerfile` ใหม่) และ service `redis` (`redis:8-alpine`) เข้า
  `docker-compose.yml` — `bot` เชื่อม `app` ผ่าน `http://app:3000` (ชื่อ service ใน network ของ compose เอง
  **ไม่ใช่** `localhost` — ข้อผิดพลาดคลาสสิกเวลาย้ายจาก dev ตรงๆ เข้า compose) และเชื่อม `redis` ผ่าน
  `redis://redis:6379/0` (อัปเกรดจาก in-memory state ตามที่ README ของบอทแนะนำไว้เอง)
- `line-bot-python/Dockerfile` ใหม่: image เดียว (ไม่ต้อง multi-stage เหมือนฝั่ง Next.js เพราะ pip ไม่มีขั้นตอน
  build แยก), รันด้วย non-root user `bot`
- **เจอบั๊กจริงระหว่างทดสอบ**: `PermissionError: [Errno 13] Permission denied: '/nonexistent'` ตอน import
  PyThaiNLP ครั้งแรก — สาเหตุคือ user ที่สร้างด้วย `adduser --system` เฉยๆ จะได้ `HOME=/nonexistent` แล้ว
  PyThaiNLP พยายามสร้างโฟลเดอร์ cache ข้อมูลใต้ home directory ตอน import แล้วเขียนไม่ได้ แก้โดยสร้าง
  `/home/bot` จริงพร้อม `chown` แล้วตั้ง `ENV HOME=/home/bot` ก่อน `USER bot` — ทดสอบซ้ำแล้วผ่าน (import
  สำเร็จ, ไม่มี warning "ไม่พบ pythainlp" ตอนบอทสตาร์ท)
- ทดสอบหน่วย (`pytest`) รันบน host จริง (venv แยก เพราะ image production ไม่ copy โฟลเดอร์ `tests/` เข้าไปโดย
  ตั้งใจ ให้ image เล็ก): **ผ่านทั้ง 51/51 เคส**

### ชุดทดสอบ End-to-End (`tests/e2e/run_e2e.py`) — เจอบั๊ก logic จริงในบอทระหว่างทดสอบกับ backend จริง
รันชุด e2e จริงกับ `app` + `bot` ที่รันอยู่จริง (ไม่ใช่ mock ทั้งหมด) แล้วพบว่าหลายเคสล้มเหลว **สาเหตุไม่ได้อยู่ที่
โค้ดบอท (`flow.py`) แต่อยู่ที่บั๊กที่ 2 ข้างบน** (`INTERNAL_API_KEY` ไม่ถูกส่ง) ทำให้ `/api/internal/lookup` และ
`/api/internal/tickets` ตอบ 401 → บอทเก็บ error แล้ว fail แบบเงียบ ระหว่างนี้เจอจุดที่ควรแก้เพิ่มใน `flow.py` (ยัง
**ไม่ได้แก้** เพราะรอ verify บั๊กที่ 2/3 ก่อน — ถ้าแก้แล้วยังพังอยู่ค่อยกลับมาดูจุดนี้ต่อ):
- `_resolve_branch()` มี fallback แบบ fail-open: ถ้า `backend.list_branches()` โยน `BackendError` จะ set
  `branches = []` แล้ว**ยอมรับข้อความอะไรก็ได้ที่ผู้ใช้พิมพ์มาเป็นชื่อสาขาทันที** โดยไม่ validate เลย — ควรจะ
  ตอบกลับว่า "ระบบขัดข้อง ลองใหม่อีกครั้ง" แทนที่จะเดินหน้าต่อด้วยข้อมูลที่ไม่ผ่านการตรวจสอบ
- `_advance()` ในสาขา `ASK_ITEM` เรียก `await backend.list_stock_items()` โดยไม่มี `try/except` ล้อมเลย —
  ถ้า backend ล่มตรงนี้ exception จะหลุดขึ้นไปโดน handler กลางของ `main.py` ดักไว้เงียบๆ (ผู้ใช้ไม่ได้รับข้อความ
  ตอบกลับใดๆ เลย ไม่รู้ด้วยซ้ำว่าเกิดอะไรขึ้น)

### สถานะล่าสุด ณ ตอนบันทึก (ยังไม่จบงาน — ห้ามถือว่าใช้งานได้จริงจนกว่าจะ verify ผ่าน)
- ✅ บั๊กที่ 1, 2 แก้แล้วและยืนยันจากไฟล์ config
- ✅ บั๊กที่ 3 แก้ที่ต้นเหตุแล้ว (`next.config.ts`) แต่ **ยังไม่ได้ verify ว่า `docker compose build app` ผ่าน
  จริงรอบใหม่** — ต้องรันซ้ำแล้วดู log จนจบ
- ⏳ ยังไม่ได้รัน E2E ซ้ำหลังแก้บั๊กที่ 2/3 — ต้องรันให้ผ่านครบทุกเคสก่อนถือว่า backend integration ใช้งานได้จริง
- ⏳ `flow.py` 2 จุดข้างบน (fail-open branch validation, unhandled BackendError ใน ASK_ITEM) ยังไม่ได้แก้ —
  รอดูว่าจำเป็นไหมหลัง E2E รอบใหม่
- ⏳ ยังไม่ได้เปิด path `/webhook` ผ่าน Tailscale Serve ไปยัง `bot` (port 8000) และยังไม่ได้สลับ Webhook URL ใน
  LINE Developers Console จาก `/api/line/webhook` (บอท TypeScript เดิม) เป็น `/webhook` (บอท Python) — งานนี้
  เป็นขั้นตอนสุดท้ายที่ทำให้ผู้ใช้จริงคุยกับบอท Python ได้ ยังไม่ได้ทำเลย

## อัปเดต (2026-09-14 ค่ำ) — rebuild ผ่านแล้ว, เจอบั๊กที่ 4 เพิ่ม, E2E ผ่านครบ 41/41

### บั๊กที่ 3 — ยืนยันแล้วว่า rebuild ผ่านจริง
`docker compose build app` ผ่าน (exit 0) หลังเพิ่ม `output: "standalone"` ใน `next.config.ts`

### บั๊กที่ 4 (ใหม่ พบตอน verify บั๊กที่ 3 — แก้แล้ว) — `/app/data` เขียนไม่ได้ + ไม่เคยมี volume เก็บถาวร
หลัง rebuild แล้ว recreate container `app` พบว่าแอป**พังทันทีทุก request ที่แตะข้อมูล** ด้วย
`Error: EACCES: permission denied, mkdir '/app/data'` — สาเหตุ: `src/lib/db/store.ts` (mock data store ที่
ใช้งานจริงอยู่ตอนนี้ เก็บ ticket/user/stock/equipment **ทั้งหมด** เป็นไฟล์ JSON ใต้ `process.cwd()/data`)
ไม่เคยถูกจัดการเรื่อง permission ใน `Dockerfile` เลย ทั้งที่ `./public/uploads` ได้รับการจัดการถูกต้องอยู่แล้ว
(mkdir + chown ให้ user `nextjs` ก่อน volume mount ทับ — ดูคอมเมนต์เดิมในบรรทัดนั้น) แก้โดยทำแบบเดียวกันกับ
`/app/data`:
- `Dockerfile`: เพิ่ม `RUN mkdir -p ./data && chown -R nextjs:nodejs ./data` ใน runner stage
- `docker-compose.yml`: เพิ่ม named volume `app_data:/app/data` ให้ service `app` (เดิมไม่มีเลย)

**⚠️ ข้อมูลที่อาจสูญหาย:** ก่อนแก้บั๊กนี้ `/app/data` ไม่เคยถูก mount เป็น volume ถาวร แปลว่าข้อมูลใดๆ ที่เคยเขียน
ลงไปในคอนเทนเนอร์ `app` ตัวก่อนหน้า (ถ้ามี) อยู่ในชั้น filesystem ของคอนเทนเนอร์นั้นเท่านั้น และคอนเทนเนอร์เก่าถูก
ลบไปแล้วตอน recreate (ตรวจสอบแล้วด้วย `docker images -f dangling=true` — ไม่มี image เก่าเหลือให้กู้คืน) จึง
**กู้คืนไม่ได้แล้ว ณ ตอนนี้** อย่างไรก็ตาม เนื่องจาก bug ที่ 1 (LINE_CHANNEL_SECRET เก่าค้าง) ทำให้ webhook จริงไม่
เคยผ่านการตรวจสอบมาก่อนหน้านี้เลย จึงไม่น่าจะมี ticket จริงจากลูกค้าทาง LINE สูญหายไป — ความเสี่ยงหลักคือถ้ามีการ
สร้าง ticket/ทรัพย์สิน/สต็อกทดสอบผ่านหน้าเว็บแอดมินไว้ก่อนหน้านี้ **กรุณาเข้าไปดูหน้า Tickets/Assets/Stock ในเว็บ
ตอนนี้ว่าข้อมูลตรงกับที่คาดไว้หรือไม่** ถ้าเห็นข้อมูลที่ไม่คุ้นเคย (เช่น seed data ตัวอย่าง) แจ้งกลับมาได้ จากนี้ไป
ข้อมูลจะถูกเก็บถาวรใน volume แล้ว ไม่หายอีกต่อไปแม้ build image ใหม่

### แก้ `flow.py` — จุดที่ไม่มี try/except ล้อม backend call (เจอตอนไล่บั๊ก E2E ก่อนพบว่าต้นเหตุจริงคือบั๊ก 1-4)
`_advance()` ในสาขา `ASK_ITEM` เป็นจุดเดียวในทั้งไฟล์ที่เรียก `backend.*()` โดยไม่มี `try/except BackendError`
ล้อม (ทุกจุดอื่นในไฟล์มีหมด) แก้ให้ตรงกับ pattern เดิมของไฟล์เอง: ถ้า backend ล่มตรงนี้ ตอบ `M.backend_error()`
กลับไปแทนที่จะปล่อยให้ exception หลุดขึ้นไปโดน handler กลางใน `main.py` ดักเงียบๆ (ผู้ใช้ไม่ได้รับข้อความใดๆ เลย)
รัน `pytest` ซ้ำหลังแก้ — **51/51 ผ่านเหมือนเดิม** ไม่กระทบ logic เดิม

**หมายเหตุ (ไม่ได้แก้ เป็นการตัดสินใจเชิง UX ไม่ใช่บั๊ก):** `_resolve_branch()` ที่ยอมรับข้อความใดๆ เป็นชื่อสาขา
ถ้าดึงรายชื่อสาขาจริงไม่ได้เลย (มีคอมเมนต์ในโค้ดอธิบายเหตุผลชัดเจนอยู่แล้ว: "ยอมรับไปก่อนดีกว่าทำให้ผู้ใช้ติดตาย")
เป็น tradeoff ที่ตั้งใจทำ ไม่ใช่ oversight — ถ้าต้องการเปลี่ยนเป็น fail-closed (ปฏิเสธแทนที่จะเดา) แจ้งได้ เป็นเรื่อง
การตัดสินใจ ไม่ใช่การแก้บั๊ก

### แก้ path hardcode ใน `tests/e2e/run_e2e.py`
เดิม step 11 เปิดไฟล์ตรงๆ ที่ `/home/claude/it-support-admin/data/tickets.json` (path เฉพาะเครื่อง dev ตอน
เขียนสคริปต์ครั้งแรก) พังทันทีบนเครื่องนี้ แก้ให้คำนวณ path จากตำแหน่งไฟล์สคริปต์เอง (override ด้วย env
`TICKETS_FILE` ได้) และเพิ่ม try/except ให้ข้ามการเช็คนี้อย่างมีเหตุผลถ้าไฟล์ไม่อยู่บน host จริง (กรณีปกติเวลา
Next.js รันในคอนเทนเนอร์ที่ data อยู่ใน named volume ไม่ได้ bind mount ออกมา) — ยืนยันด้วยมือแทนผ่าน
`docker compose exec app cat /app/data/tickets.json` แล้วเทียบ field ทั้งหมดตรงตามที่คาดไว้

### ผลการรัน E2E สุดท้าย (รันกับ backend `app` จริงในคอนเทนเนอร์ที่แก้บั๊กครบแล้ว)
**✅ ผ่านทั้งหมด 41/41 ข้อ** ครอบคลุมทุก flow หลัก: ลายเซ็นปลอมถูกปฏิเสธ, follow, เลือกสาขา (ทั้งปฏิเสธสาขาไม่มีจริง
และยอมรับสาขาจริง), เลือกประเภท, ข้ามรหัสทรัพย์สิน→ได้รายการสต็อกจริงจาก DB, เลือกของ+จำนวน, กรอกผู้เบิก, สร้าง
ticket จริง (`ITRQ2026090008` เป็นต้น) พร้อมข้อความสรุปตรงกับต้นแบบทุกตัวอักษร, ตัดสต็อกจริงในฐานข้อมูล, ตอบคำถาม
FAQ, ถามสถานะ ticket ของตัวเอง, ถามประวัติ ticket ที่เคยแจ้ง — รันด้วยบอทตัวสำรอง (local, ชี้ไปยัง backend จริง
ใน container ผ่าน `http://localhost:3000`) เพื่อไม่กระทบสถานะของ container `bot` จริงที่กำลังใช้งานอยู่

### rebuild + recreate container `bot` จริงให้ใช้ flow.py เวอร์ชันล่าสุด
รัน `docker compose build bot` + `docker compose up -d bot` แล้ว — container `bot` (port 8000, ตัวที่
Tailscale จะชี้มาจริง) รันด้วยโค้ดล่าสุดแล้ว ยืนยัน `/health` ตอบ `{"ok":true,"state_backend":"redis"}` ถูกต้อง
(ใช้ Redis เก็บ session ไม่ใช่ in-memory fallback)

### สรุปสถานะล่าสุด — พร้อมสำหรับขั้นตอนสุดท้าย (task #7)
บั๊กที่พบและแก้ครบทั้ง 4 ตัว + ยืนยันด้วย automated test จริง (unit 51/51 + e2e 41/41) เหลือแค่ขั้นตอนเปิด
`/webhook` สู่อินเทอร์เน็ตผ่าน Tailscale แล้วสลับ Webhook URL ใน LINE Developers Console เท่านั้น

## เส้นทางสู่อินเทอร์เน็ตของเครื่องนี้ (ตรวจสอบจริง 2026-09-14 — อ่านก่อนคิดจะเปลี่ยนวิธี expose)

สรุปผลการตรวจสอบทุกเส้นทางที่มีบนเครื่องนี้ เพื่อไม่ให้ใครเสียเวลาไล่ทางที่ตันซ้ำอีก:

| เส้นทาง | สถานะจริง | ใช้เป็น LINE webhook ได้ไหม |
| --- | --- | --- |
| **Tailscale Funnel** (`win-qrb8cpgc62i.taila97ec8.ts.net`) | ใช้งานได้จริง ทะลุ NAT ได้โดยไม่ต้อง forward port | ✅ **ใช่ — เส้นทางเดียวที่ใช้ได้ของระบบนี้** |
| **DuckDNS + Caddy** (`it-support-admin.duckdns.org`) | DNS ชี้ IP สาธารณะถูกต้อง (27.130.2.119 = IP จริงของเครื่อง ไม่ติด CGNAT), cert Let's Encrypt ออกสำเร็จ **แต่เข้าจากอินเทอร์เน็ตไม่ได้** — ยิงทดสอบจากภายนอก 2 ครั้ง ไม่มี request ถึง Caddy เลยสักรายการ (access log มีแต่ `172.21.0.1` = จากเครื่องตัวเอง) | ❌ ไม่ได้ จนกว่าจะตั้ง port forwarding 443 ที่เราเตอร์ |
| **Cloudflare Tunnel** (`Film_Part-Time`) | รันอยู่จริงและทะลุ NAT ได้ **แต่เป็นของโปรเจกต์อื่น** (`checkin-system` / `thanakronpart-time.com` → IIS:80 + uvicorn:8001) | ⚠️ ทำได้แต่ไม่ควร — ต้อง restart tunnel ของ production คนละระบบ และ URL บอทจะไปอยู่ใต้โดเมนคนละโปรเจกต์ |

**เหตุผลที่ cert ออกได้ทั้งที่เข้าจากภายนอกไม่ได้:** Caddyfile ใช้ DNS-01 challenge (ตอบผ่าน DuckDNS API)
ซึ่งไม่ต้องการ inbound connection เลย — ดูคอมเมนต์ในไฟล์ `Caddyfile` ที่เขียนเหตุผลไว้แล้ว การมี cert จึง
**ไม่ได้แปลว่าโดเมนนั้นเข้าถึงได้จากอินเทอร์เน็ต** เป็นกับดักที่หลงได้ง่ายมาก

### บันทึกเหตุการณ์: Funnel ถูกปิดโดยไม่ตั้งใจระหว่างตั้งค่า (แก้แล้วด้วยคำสั่งใหม่)
คำสั่ง `tailscale serve --bg --set-path=/webhook 8000` สร้าง path mapping ได้ถูกต้อง **แต่มีผลข้างเคียงคือ
ปิด Funnel** ของ hostname นี้ไปด้วย (เปลี่ยนจาก `Funnel on` เป็น `tailnet only`) ทำให้ webhook เดิมที่ LINE
ใช้อยู่เข้าไม่ถึงชั่วคราว

สาเหตุเชิงโครงสร้าง: CLI เวอร์ชันนี้แยก `tailscale serve` (แชร์เฉพาะใน tailnet) ออกจาก `tailscale funnel`
(แชร์สู่อินเทอร์เน็ต) เป็นคนละคำสั่งที่เขียนทับ config เดียวกัน — ใช้ `serve` เมื่อไหร่ visibility จะกลายเป็น
tailnet-only ทันที และ syntax เก่าอย่าง `tailscale funnel 443 on` **ใช้ไม่ได้แล้ว** (ขึ้น error
"the CLI for serve and funnel has changed")

**คำสั่งที่ถูกต้องสำหรับ CLI เวอร์ชันนี้** (ต้องใช้ `funnel` ทั้งสองบรรทัด ห้ามใช้ `serve` ปนเด็ดขาด):

```powershell
tailscale funnel --bg 3000                          # /        -> เว็บแอดมิน Next.js
tailscale funnel --bg --set-path=/webhook 8000      # /webhook -> บอท Python
```

ผลที่ถูกต้องเมื่อรัน `tailscale funnel status` ต้องขึ้น `(Funnel on)` ไม่ใช่ `(tailnet only)`

## ✅ ขึ้นใช้งานจริงแล้ว (2026-09-14 ค่ำ) — Webhook สลับมาที่บอท Python สำเร็จ

### บั๊กที่ 5 — Tailscale `--set-path` ตัด prefix ทิ้ง ทำให้บอทตอบ 404
กด Verify ครั้งแรกแล้วได้ `404 Not Found` ดู log บอทพบ `POST / HTTP/1.1 404` — สาเหตุคือ
`tailscale funnel --set-path=/webhook` **ตัด `/webhook` ออกก่อน forward** บอทจึงได้รับเป็น `POST /`
ซึ่งไม่มี route รองรับ

แก้ที่ `app/main.py` โดยให้ route เดิมรับที่ `/` ด้วย (ซ้อน decorator `@app.post("/")` และ `@app.get("/")`)
ไม่ได้ลดความปลอดภัยเพราะด่านจริงคือการตรวจลายเซ็น HMAC ไม่ใช่ path — และทำให้ย้ายไป proxy แบบไหน
ก็ไม่พังอีก (ทางเลือกที่สะอาดกว่าคือตั้ง target เป็น `http://127.0.0.1:8000/webhook` ให้ proxy ส่ง path เดิมมา)

### กับดัก: ห้ามใช้ `Resolve-DnsName -Server 1.1.1.1` ตรวจ DNS บนเครื่องที่มี MagicDNS
ระหว่างไล่ปัญหา ตรวจ DNS บนเครื่องนี้แล้วได้ `100.92.152.56` (IP ในวง Tailscale) ทำให้เกือบสรุปผิดว่า
Funnel ไม่ได้ประกาศ DNS สาธารณะ — **ความจริงคือ MagicDNS ดักตอบเอง** แม้จะระบุ `-Server 1.1.1.1` ก็ตาม

วิธีตรวจมุมมองจากภายนอกจริงบนเครื่องที่รัน Tailscale ให้ถาม resolver ผ่าน HTTPS แทน:

```powershell
$h=@{accept='application/dns-json'}
Invoke-RestMethod -Uri "https://cloudflare-dns.com/dns-query?name=<host>&type=A" -Headers $h
```

ผลจริงที่ได้ = `103.84.155.153`, `103.84.155.217` (IPv4 ingress) และ
`2403:2500:400:20::25a`, `::e8e` (IPv6 ingress) — ถูกต้องทุกอย่าง

ยืนยันซ้ำด้วยการบังคับยิงผ่าน ingress สาธารณะจริง (ไม่ผ่าน MagicDNS):

```powershell
curl.exe --resolve <host>:443:103.84.155.153 https://<host>/webhook     # -> 200
curl.exe -X POST --resolve <host>:443:103.84.155.153 ... /webhook       # -> 401 (ลายเซ็นปลอม = ถูกต้อง)
```

**หมายเหตุสำคัญ:** หลัง `docker compose up -d bot` (recreate container) Funnel จะส่ง request ไม่ถึงบอท
ชั่วคราวประมาณ 1-2 นาที กด Verify ช่วงนั้นจะได้ error "An error occurred when sending the webhook event
object" ทั้งที่ config ถูกหมด — **รอสักครู่แล้วกดใหม่ได้เลย ไม่ต้องแก้อะไร**

### ผลสุดท้าย: Verify = Success ✅
- Webhook URL: `https://win-qrb8cpgc62i.taila97ec8.ts.net/webhook`
- LINE Developers Console กด Verify → **Success**
- log ฝั่งบอทยืนยัน: `POST / HTTP/1.1 200 OK` (ผ่านการตรวจลายเซ็น = channel secret ตรงกันแล้วจริง)

### ตรวจ LINE OA Manager (`manager.line.biz/account/@891ujhzo`) — ถูกต้องครบ
| การตั้งค่า | สถานะ | เหตุผล |
| --- | --- | --- |
| Webhooks | **ON** | จำเป็น ถ้าปิดบอทจะไม่ได้รับ event ใดๆ เลยแม้ webhook URL ถูก |
| Chat | OFF | ถ้าเปิดจะกลายเป็นโหมดแชทคนตอบ แย่งกับบอท |
| Greeting message | OFF | ถูกแล้ว เพราะบอทส่งข้อความต้อนรับเองจาก `follow` event |
| Auto-response messages | OFF | ถูกแล้ว ไม่งั้นจะมีข้อความอัตโนมัติมาตอบทับบอท |

### สรุปบั๊กทั้งหมดที่พบและแก้ในรอบนี้ (5 ตัว)
1. `LINE_CHANNEL_SECRET` เก่าค้างใน `.env` → signature ไม่ผ่านตลอด
2. `INTERNAL_API_KEY` ไม่เคยถูกส่งเข้า container `app` → `/api/internal/*` ตอบ 401 เสมอ
3. `next.config.ts` ขาด `output: "standalone"` → `docker compose build app` พังตลอด
4. `/app/data` เขียนไม่ได้ (EACCES) + ไม่มี named volume → แอปพังทุก request ที่แตะข้อมูล และข้อมูลหายทุก build
5. Tailscale `--set-path` ตัด prefix → บอทตอบ 404 ให้ LINE

บวกกับการแก้เชิงคุณภาพอีก 2 จุด: `flow.py` เพิ่ม try/except ที่ `ASK_ITEM` และ `run_e2e.py` เลิก hardcode
path เฉพาะเครื่อง

### ทดสอบเพิ่มเติมกับ LINE API จริง (ไม่ผ่าน mock)
```
GET https://api.line.me/v2/bot/info
-> {"basicId":"@891ujhzo","displayName":"IT-Support-Admin","chatMode":"bot","markAsReadMode":"auto"}
```
`chatMode: "bot"` คือจุดที่ต้องเช็คเสมอ ถ้าเป็น `"chat"` webhook จะไม่ยิงตอนมีคนทัก แม้ตั้ง URL ถูกทุกอย่าง

**โควตาข้อความ:** `{"type":"limited","value":300}` = ส่งได้ 300 ข้อความ/เดือน (แพลนฟรี) — ถ้าเปิดใช้ทั้งบริษัท
ต้องประเมินแพลนใหม่ ข้อความที่บอทตอบกลับแบบ reply ไม่นับโควตา แต่ push message นับ

**ข้อจำกัดที่เจอ:** `GET /v2/bot/followers/ids` ตอบ `Access to this API is not available for your account`
(ต้องเป็น OA ที่ verified ก่อน) จึงดึงรายชื่อผู้ติดตามมาทดสอบส่งข้อความจริงไม่ได้

## ชุดไฟล์ QR สำหรับให้พนักงานแอด (โฟลเดอร์ `qr/`)

| ไฟล์ | ใช้ทำอะไร |
| --- | --- |
| `make_qr.py` | สคริปต์สร้าง QR (ใช้ `segno` — pure-python ไม่ต้องลง Pillow) แก้ `OA_ID` บรรทัดเดียวถ้าเปลี่ยน OA แล้วรันใหม่ |
| `line-oa-qr.svg` | เวกเตอร์ ขยายเท่าไหร่ก็คม ใช้กับงานพิมพ์ทุกขนาด |
| `line-oa-qr.png` | 820×820 px ใช้แปะในไลน์กลุ่ม/อีเมล/สไลด์ |
| `poster-a4.html` | โปสเตอร์ A4 พร้อมพิมพ์ (เปิดแล้วกด Ctrl+P) ฝัง QR เป็นเวกเตอร์ในไฟล์เดียว ไม่ต้องแนบรูปแยก |

เนื้อหาที่ QR เข้ารหัส: `https://line.me/R/ti/p/@891ujhzo` (ลิงก์เพิ่มเพื่อนมาตรฐานของ LINE ตรวจแล้วตอบ HTTP 200)
ตรวจสอบแล้วว่า path data ใน `poster-a4.html` ตรงกับที่ segno สร้างแบบ byte ต่อ byte

**หมายเหตุเรื่อง encoding:** สคริปต์ Python ที่ print ภาษาไทยบนเครื่องนี้ต้อง
`sys.stdout.reconfigure(encoding="utf-8")` เสมอ ไม่งั้นพังด้วย `UnicodeEncodeError: 'charmap' codec`
เพราะ PowerShell ตั้ง stdout ของโปรเซสลูกเป็น cp1252 (เจอซ้ำ 3 ครั้งในโปรเจกต์นี้แล้ว)
## อัปเดต (2026-09-15 บ่าย) — แต่งหน้าร้าน LINE OA: rich menu 6 ปุ่ม + รูปโปรไฟล์/หน้าปก

ระบบหลังบ้านขึ้นใช้งานจริงแล้วตั้งแต่รอบก่อน (webhook ผ่าน Verify, unit 51/51, e2e 41/41) รอบนี้จึงเป็นงาน
"หน้าร้าน" ล้วน — สิ่งที่พนักงานเห็นตอนแอดเพื่อนและตอนเปิดห้องแชท ซึ่งเดิมว่างเปล่าทั้งหมด (ไม่มี rich menu,
ไม่มีรูปโปรไฟล์/หน้าปก, ไม่มีคำอธิบายบัญชี) ผลคือคนที่แอดเข้ามาไม่รู้ว่าบอทตัวนี้ทำอะไรได้บ้างถ้าไม่อ่าน
ข้อความต้อนรับจนจบ

**ของใหม่ทั้งหมดอยู่ที่โฟลเดอร์ `line-oa/`** (รายละเอียดครบใน `line-oa/README.md`)

### สิ่งที่สร้าง
- `assets/richmenu-main.png` — rich menu 2500×1686 หกปุ่ม (แจ้งซ่อม / เบิกอุปกรณ์ / คืนอุปกรณ์ /
  ขอใช้บริการ IT / เรื่องที่ฉันแจ้ง / คำถามที่พบบ่อย) ขนาดไฟล์ ~210 KB อยู่ใต้ลิมิต 1 MB ของ LINE
  ไอคอนทั้งหมดวาดด้วยโค้ด (PIL) ไม่ได้พึ่ง emoji font ซึ่งไม่มีติดตั้งในหลายเครื่องและเรนเดอร์ไม่เหมือนกัน
- `assets/oa-profile-640.png` / `assets/oa-cover-1080x878.jpg` — ทำจากโลโก้และภาพทีม IT ที่ผู้ใช้สร้างไว้
  (ไฟล์ `ChatGPT Image ....png` ที่ root) ตัดขอบโปร่งใส + ครอปเข้าขนาดที่ LINE กำหนดเป๊ะ
- `setup_richmenu.py` — ติดตั้งเมนูผ่าน Messaging API ด้วยคำสั่งเดียว (`python setup_richmenu.py`)
  ใช้แค่ `urllib` ของ Python มาตรฐาน ไม่ต้อง pip install, มี `--list` / `--remove` สำหรับตรวจและย้อนกลับ
- `make_assets.py` — สร้างรูปใหม่ทั้งชุดได้ตลอด แก้ข้อความ/สีปุ่มที่ตัวแปร `TILES` แล้วรันซ้ำ

### จุดตัดสินใจที่สำคัญ: ไม่แก้โค้ดบอทเลยแม้แต่บรรทัดเดียว
ห้าปุ่มแรกใช้ action แบบ `message` (ส่งข้อความธรรมดาแทนผู้ใช้) ไม่ใช่ `postback` เพราะบอทมีชั้นจับ intent
อยู่แล้ว (`ai.py` → `INTENT_KEYWORDS`) ถ้าใช้ postback จะต้องไปเพิ่ม action ใหม่ใน `flow.py` ทุกปุ่ม
ซึ่งเพิ่มโค้ดที่ต้องดูแลโดยไม่ได้อะไรกลับมา — ตรวจยืนยันด้วยการเรียก `ai.analyze()` จริงกับข้อความทั้ง 5 ประโยค:

| ปุ่ม | ข้อความที่ส่ง | intent ที่บอทตีความได้ | confidence |
| --- | --- | --- | --- |
| แจ้งซ่อม | `แจ้งซ่อม` | `repair` | 0.60 |
| เบิกอุปกรณ์ | `เบิกอุปกรณ์` | `withdraw` | 0.60 |
| คืนอุปกรณ์ | `คืนอุปกรณ์` | `return` | 0.60 |
| ขอใช้บริการ IT | `ขอใช้บริการ IT` | `it_service` | 0.85 |
| เรื่องที่ฉันแจ้ง | `เรื่องที่ฉันแจ้ง` | `my_tickets_query` | 0.85 |

ผลพลอยได้: ผู้ใช้เห็นคำที่ "ตัวเอง" ส่งอยู่ในแชท จึงเรียนรู้เองว่าพิมพ์ถามตรงๆ ก็ได้ ไม่ติดอยู่กับการกดปุ่ม
ส่วนปุ่ม FAQ ใช้ `postback a=faq_menu` เพราะ `flow.py` รองรับอยู่แล้วและไม่ควรให้ข้อความโผล่ในห้องแชท

### ข้อจำกัดของ LINE ที่ต้องรู้ (กันเสียเวลาไล่ซ้ำ)
- **`chatBarText` ยาวได้ไม่เกิน 14 ตัวอักษร** — "เมนู IT Support" (15) ถูกปฏิเสธทั้ง request ต้องใช้ "เมนู IT"
- **อัปโหลดรูป rich menu ใช้คนละโดเมน** (`api-data.line.me`) กับตอนสร้างเมนู (`api.line.me`) ยิงผิด = 404
- **รูปโปรไฟล์ / ภาพหน้าปก / คำอธิบายบัญชี ไม่มี Messaging API ให้เรียก** ต้องอัปโหลดเองใน OA Manager
  เป็นงานที่เหลือให้ทำด้วยมือเท่านั้น (มีตารางบอกว่าช่องไหนใส่อะไรใน `line-oa/README.md`)
- ยังต้องคง `Chat` / `Greeting message` / `Auto-response` ปิดไว้ตามเดิม ไม่งั้นจะมีข้อความมาตอบทับบอท

### สิ่งที่ยังค้าง (ต้องทำบนเครื่องผู้ใช้)
1. รัน `python line-oa/setup_richmenu.py` หนึ่งครั้ง — Claude รันแทนไม่ได้เพราะเครือข่ายของ cloud container
   ถูกบล็อกไม่ให้ออก `api.line.me` และ Linux workspace ฝั่งเครื่องผู้ใช้สตาร์ทไม่ขึ้นในเซสชันนี้
2. อัปโหลดรูปโปรไฟล์/หน้าปก + วางข้อความคำอธิบายใน LINE OA Manager
3. ใส่ที่อยู่/เว็บไซต์/เบอร์โทรของบริษัทเอง — ตั้งใจไม่เดาให้ เพราะเป็นข้อมูลที่ผิดแล้วเสียหายจริง

### ตรวจสถานะจริงทั้งระบบ (2026-09-15 บ่าย) — ผ่านเชลล์บนเครื่องจริง ไม่ใช่การอ่านโค้ดแล้วเดา

| จุด | ผลจริง |
| --- | --- |
| `docker compose ps` | ครบ 6 service: `app` / `bot` (up 15 ชม.), `caddy` / `db` (healthy) / `duckdns` (up 23 ชม.), `redis` (up 19 ชม.) |
| เว็บแอดมิน (ภายใน) | `http://127.0.0.1:3000/login` → **200** |
| เว็บแอดมิน (จากอินเทอร์เน็ตจริง) | `https://win-qrb8cpgc62i.taila97ec8.ts.net/` → **307** (redirect เข้าหน้า login ตามที่ควรเป็น) |
| บอท | `/health` → `{"ok":true,"state_backend":"redis"}` (ใช้ Redis จริง ไม่ใช่ in-memory fallback) |
| Tailscale | `Funnel on` — `/` → :3000, `/webhook` → :8000 |
| Webhook ที่ LINE ถืออยู่ | `GET /v2/bot/channel/webhook/endpoint` → `{"endpoint":".../webhook","active":true}` |
| ลายเซ็นปลอมยิงเข้า `/webhook` | **401** (ด่าน HMAC ยังทำงานถูกต้อง) |
| pythainlp ในคอนเทนเนอร์ bot | ติดตั้งแล้ว (ไม่มี warning "ไม่พบ pythainlp" ใน log เลย) |

**ชั้น LLM ปิดอยู่** — ไม่มี `AI_PROVIDER` ใน environment ของ service `bot` จึงตกเป็นค่า default `none`
แปลว่า "AI" ที่ทำงานอยู่ตอนนี้คือชั้นตัดคำไทย + TF-IDF + fuzzy + keyword intent ล้วนๆ ไม่มีการเรียกโมเดลภาษา
ข้อดีคือคำตอบทุกคำมาจาก FAQ/ฐานข้อมูลจริงเท่านั้น ไม่มีโอกาสแต่งเรื่องเอง ข้อเสียคือถ้าคนถามด้วยคำที่ไม่มี
ในคีย์เวิร์ด จะได้ `unknown` แทนที่จะเดาความหมายให้

### ชุดตรวจความพร้อมของชั้น AI (`line-bot-python/check_ai.py` — ไฟล์ใหม่ อ่านอย่างเดียว)

```powershell
docker compose cp line-bot-python\check_ai.py bot:/tmp/check_ai.py
docker compose exec -T -e PYTHONPATH=/app bot python /tmp/check_ai.py
```

ผลจริงกับข้อมูลในระบบ (สาขา 5 · สต็อก 11 · ทรัพย์สิน 24 · FAQ 9 · ดัชนี TF-IDF พร้อม) — **ถูก 14 จาก 15 ประโยค**

| ประโยคที่ทดสอบ | intent ที่ได้ | หมายเหตุ |
| --- | --- | --- |
| ปริ้นเอกสารไม่ได้ | `faq` 0.95 | ตรง FAQ "ปริ้นเอกสารไม่ได้" คะแนน 0.799 |
| wifi หลุดบ่อย | `faq` 0.95 | ตรง FAQ Wifi คะแนน 0.675 |
| ลืมรหัสผ่านอีเมล | `it_service` | เสนอ FAQ "ลืมรหัสผ่าน" (0.66) ก่อนเปิดเรื่อง |
| เข้าอินเทอร์เน็ตไม่ได้ | `faq` 0.714 | แมตช์ FAQ "เข้า LINE ไม่ได้" แค่ 0.214 — ตรงข้าม ควรไปเข้า FAQ Wifi |
| คีย์บอร์ดเหลือกี่อัน | `stock_query` | ดึงยอดคงเหลือสดมาตอบ |
| NB2501001 ใครถืออยู่ | `asset_query` | |
| เรื่องที่ฉันแจ้งถึงไหนแล้ว | `my_tickets_query` | |
| ขอเบิกเมาส์ 2 อัน | `withdraw` | จับของ + จำนวนได้จากประโยคเดียว |
| ปุ่ม rich menu ทั้ง 5 | ถูกทุกปุ่ม | repair / withdraw / return / it_service / my_tickets_query |
| **เครื่องพิมพ์กระดาษติด** | **`unknown`** | ช่องโหว่เดิมที่ README บันทึกไว้ ยังไม่ถูกแก้ |

### แก้ช่องว่างคำพ้องของ FAQ — `db/patches/2026-09-15_faq_keywords.sql` (เขียนไว้แล้ว ยังไม่ได้รัน)
เพิ่มคำพ้องให้ FAQ ทั้ง 9 ข้อ (เช่น "เครื่องพิมพ์/ปริ้นเตอร์/กระดาษติด/หมึกหมด" เข้า FAQ ปริ้น,
"เน็ตไม่ได้/อินเทอร์เน็ตไม่ได้/ไวไฟ" เข้า FAQ Wifi, "pos/เปิดบิลไม่ได้" เข้า FAQ โปรแกรมขายหน้าร้าน)
เขียนแบบ `DISTINCT unnest(keywords || ARRAY[...])` จึงรันซ้ำได้ไม่มีคำซ้ำสะสม และไม่แตะ title/content

```powershell
docker compose cp db\patches\2026-09-15_faq_keywords.sql db:/tmp/p.sql
docker compose exec -T db psql -U itadmin -d itadmin -f /tmp/p.sql
# แล้วรัน check_ai.py ซ้ำเพื่อดูว่า "เครื่องพิมพ์กระดาษติด" เปลี่ยนจาก unknown เป็น faq
```

(แก้ผ่านหน้า FAQ Bot ในแอดมินก็ได้ผลเดียวกัน — ไฟล์ SQL มีไว้ให้ทำทีเดียวครบ 9 ข้อเร็วกว่า)

### ⚠️ ค้นพบสำคัญ (2026-09-15) — แอปที่รันอยู่ "ไม่ได้ใช้ Postgres" แม้ container `db` จะรันอยู่

รัน patch SQL เข้าตาราง `faq_items` ใน Postgres สำเร็จ (UPDATE 1 ครบ 9 แถว) แต่รัน `check_ai.py` ซ้ำแล้ว
**ผลไม่เปลี่ยนเลยแม้แต่ทศนิยมเดียว** — คะแนน FAQ เท่าเดิมเป๊ะทุกบรรทัด ซึ่งเป็นสัญญาณว่าไม่ได้อ่านจากที่เดียวกัน
ไล่ต่อจนเจอว่า:

```
/app/data/  equipment.json  faq_items.json  stock_items.json
            stock_transactions.json  tickets.json  users.json
```

แอปอ่าน/เขียน JSON ชุดนี้เป็นคลังข้อมูลจริง ส่วน `DATABASE_URL` ถูกส่งเข้า container อยู่แต่ยังไม่มีโค้ดเรียกใช้
(ตรงกับที่ README บันทึกไว้ว่า `src/lib/db/pg.ts` "เตรียมไว้สำหรับย้ายไป Supabase แต่ยังไม่ได้ใช้งาน")
ยืนยันอีกชั้นว่า id ของ FAQ ใน Postgres กับใน JSON เป็นคนละชุดกันโดยสิ้นเชิง

**บทเรียน:** container `db` ที่ขึ้น healthy ไม่ได้แปลว่าแอปใช้มัน — และการที่ SQL รันผ่านไม่ได้แปลว่าแก้ถูกที่
ต้องวัดผลปลายทาง (รัน `check_ai.py` ซ้ำ) ทุกครั้ง ไม่ใช่ดูแค่ว่าคำสั่งไม่ error

### แก้ที่ถูกที่แล้ว — `db/patches/2026-09-15_faq_keywords.js` (รันแล้ว ได้ผลจริง)
Node script แก้ `/app/data/faq_items.json` โดยตรง: สำรองไฟล์เดิมเป็น `.bak-2026-09-15` ก่อนเขียน,
เทียบคำซ้ำแบบ trim+lowercase จึงรันซ้ำได้ไม่มีคำบวม, เขียนไฟล์ชั่วคราวแล้ว rename (atomic) กันไฟล์พังกลางคัน

ผลที่รันจริง — เพิ่มคำพ้องครบทั้ง 9 ข้อ (ปริ้น 3→11, Wifi 3→11, ลืมรหัสผ่าน 3→8, POS 3→8, ฯลฯ)
จากนั้น `docker compose restart bot` เพื่อล้าง knowledge cache (TTL 5 นาที)

**ผลหลังแก้ — ถูก 15/15 ประโยค (เดิม 14/15)**

| ประโยค | ก่อน | หลัง |
| --- | --- | --- |
| เครื่องพิมพ์กระดาษติด | `unknown` (ไม่ตอบ) | `faq` 0.869 → FAQ "ปริ้นเอกสารไม่ได้" (0.369) |
| เข้าอินเทอร์เน็ตไม่ได้ | ไปเข้า FAQ "เข้า LINE ไม่ได้" (ผิดข้อ) | ไปเข้า FAQ "Wifi หลุดบ่อย" (ถูกข้อ) |
| คอมเปิดไม่ติด | `repair` ไม่มี FAQ ประกอบ | `repair` + เสนอ FAQ "คอมพิวเตอร์ค้าง" ให้ลองแก้เองก่อน |

ที่เหลือคงเดิมทั้งหมด (stock_query / asset_query / my_tickets_query / ปุ่ม rich menu ทั้ง 5 ยังถูกครบ)

ย้อนกลับได้ทันทีถ้าต้องการ:
```powershell
docker compose exec -T app sh -lc "cp /app/data/faq_items.json.bak-2026-09-15 /app/data/faq_items.json"
docker compose restart bot
```

## อัปเดต (2026-09-15 เย็น) — QR ชุดใหม่ + ปิดระบบล็อกอินตามที่เจ้าของระบบสั่ง

### QR (`qr/`) — สร้างใหม่ด้วย `make_qr.py` ที่เขียนใหม่ทั้งไฟล์
| ไฟล์ | ใช้ทำอะไร |
| --- | --- |
| `line-oa-qr.svg` | เวกเตอร์ สำหรับงานพิมพ์ทุกขนาด |
| `line-oa-qr.png` | QR ล้วน 820px |
| `line-oa-qr-logo.png` | QR + โลโก้ตรงกลาง 1024px (ระดับแก้ความผิดพลาด H รับการบังได้ ~30%) |
| `qr-card.png` | การ์ด 1080×1350 พร้อมข้อความ+เบอร์โทร โพสต์ลงไลน์กลุ่มได้เลย |

**ตรวจแล้วว่าสแกนออกจริง** ไม่ใช่แค่ดูแล้วเหมือนใช้ได้ — ถอดรหัสด้วย `zxing-cpp` ทั้ง 3 ไฟล์ PNG
ได้ `https://line.me/R/ti/p/@891ujhzo` ตรงกันทุกไฟล์ (การใส่โลโก้ทับ QR ทำให้สแกนไม่ออกได้ง่ายมาก
ถ้าไม่ได้ใช้ระดับ H หรือโลโก้ใหญ่เกิน จึงต้องถอดรหัสทดสอบทุกครั้งที่แก้ขนาด)

### ปิดระบบล็อกอิน (`AUTH_DISABLED=true`) — ตัดสินใจโดยเจ้าของระบบ
เสนอทางเลือกที่ปลอดภัยกว่าไปแล้ว (ปิด login แต่ให้เว็บเข้าได้เฉพาะในวง Tailscale / ยืดอายุ session 30 วัน)
เจ้าของระบบเลือก **"เอาออกจริงๆ ทั้งที่เปิดสู่เน็ต"** หลังรับทราบว่าใครก็ตามที่มี URL จะเห็นข้อมูลพนักงาน
ค่าซ่อม ทรัพย์สิน และสต็อกทั้งหมด — บันทึกไว้ตรงนี้เพื่อให้คนที่มาอ่านทีหลังรู้ว่าเป็นการตัดสินใจ ไม่ใช่บั๊ก

**ทำเป็นสวิตช์ ไม่ได้ลบโค้ด auth ทิ้ง** เพื่อให้กลับมาเปิดใหม่ได้ด้วยการเปลี่ยนค่าตัวเดียว:

| ไฟล์ | สิ่งที่แก้ |
| --- | --- |
| `src/lib/auth.ts` | `AUTH_DISABLED` + `GUEST_SESSION`; `getSession()` คืน guest ทันทีเมื่อปิด (จึงไม่ต้องแก้ `requireSession()` และทุกหน้า/Server Action ที่เรียกมันเลยสักจุด) |
| `proxy.ts` | ปล่อยผ่านทุก path เมื่อปิด |
| `src/app/login/page.tsx` | เด้งเข้า `/` ถ้ามีคนเปิด `/login` ตรงๆ |
| `(dashboard)/layout.tsx` + `TopNav.tsx` | ซ่อนปุ่ม "ออกจากระบบ" |
| `Dockerfile` + `docker-compose.yml` | ส่ง `AUTH_DISABLED` **ทั้ง build arg และ environment** |

เหตุผลที่ต้องส่งทั้งสองทาง: `proxy.ts` คือ middleware ของ Next ซึ่ง **inline ค่า env ตั้งแต่ตอน build**
ไม่ได้อ่านตอน runtime เสมอไป ถ้าใส่แค่ใน `environment:` ของ compose แล้ว restart เฉยๆ หน้าเว็บจะยัง
เด้งไป `/login` เหมือนเดิมทั้งที่ env ในคอนเทนเนอร์ถูกต้อง — เป็นกับดักที่หลงได้ง่าย

**ผลตรวจจริงหลัง `docker compose build app` + `up -d app`:**

| ทดสอบ | ผล |
| --- | --- |
| `http://127.0.0.1:3000/` | 200 (ไม่เด้ง login แล้ว) |
| `/login` | 307 → เด้งกลับหน้าแรก |
| จากอินเทอร์เน็ตจริง `/`, `/tickets`, `/assets` | **200 ทั้งหมด ไม่ต้องล็อกอิน** |
| บอท `/health` | `{"ok":true,"state_backend":"redis"}` ไม่กระทบ |
| `/webhook` ลายเซ็นปลอม | 401 — ด่าน HMAC ของบอทยังทำงานเหมือนเดิม |

กลับมาเปิดล็อกอินใหม่: แก้ `AUTH_DISABLED=false` ใน `.env` แล้ว `docker compose up -d --build app`
(ต้อง build ใหม่ ไม่ใช่แค่ restart ด้วยเหตุผลข้างบน)

### สถานะ pipeline "แจ้งเรื่อง → ticket" (ตอบคำถามที่ถามไว้)
ticket ในระบบตอนนี้ 29 ใบ — 4 ใบถูกสร้างผ่านบอทจริง (`meta.source = "line-bot"`) แต่ทั้ง 4 ใบเป็นของ
ชุดทดสอบ e2e (`line_user_id` ขึ้นต้น `U_e2e`) **ยังไม่มีพนักงานจริงสักคนที่ทักเข้ามาแล้วได้ ticket**
สอดคล้องกับ log ของบอทที่ไม่มี webhook เข้ามาเลยตั้งแต่ 2026-09-14 17:21 — แปลว่าเส้นทางทำงานได้จริง
พิสูจน์แล้ว แต่ยังไม่เคยมีคนใช้ รอแจก QR ให้พนักงานแอดเท่านั้น

## นำเข้าทะเบียนทรัพย์สินจริง (2026-09-15) — 250 เครื่องจาก CSV

ไฟล์ทั้งชุดอยู่ที่ `db/imports/` (เก็บ CSV ต้นฉบับไว้ด้วยเพื่อให้ย้อนดูได้ว่าข้อมูลมาจากไหน)

| ไฟล์ | คืออะไร |
| --- | --- |
| `equipment_2026-09-15.csv` | CSV ต้นฉบับที่ผู้ใช้ส่งมา (251 แถว) |
| `equipment-import-2026-09-15.json` | ข้อมูลที่ parse + normalize แล้ว พร้อมนำเข้า (250 รายการ) |
| `import_equipment.js` | สคริปต์นำเข้า รันซ้ำได้ สำรองไฟล์เดิมก่อนเขียนเสมอ |
| `equipment-import-conflicts.csv` | รายงานปัญหาข้อมูลที่ต้องให้คนตัดสินใจ ไม่ได้แก้ให้เอง |

### ผลจริง
```
เพิ่มใหม่ 248 · อัปเดตของเดิม 2 · สร้างผู้ครอบครองใหม่ 167 · ทรัพย์สินรวม 272
desktop 135 · notebook 51 · scanner 46 · printer 19 · tablet 11 · (ที่เหลือคือ 22 แถวตัวอย่างเดิม)
ใช้งานอยู่ 211 · ว่าง 50 · ส่งซ่อม 6 · จองแล้ว 4 · เลิกใช้งาน 1
```
ยืนยันปลายทางแล้ว: `/api/internal/lookup?kind=knowledge` ตอบ 272 ชิ้น และบอทเห็น "ทรัพย์สิน 272 ชิ้น"
หลัง `docker compose restart bot` · สุ่มค้น `NB2608005` / `SC2606001` / `PC2606009` ได้ผู้ครอบครองกับแผนกถูกต้อง

### การตัดสินใจที่ต้องอธิบาย
1. **ตัดแถวซ้ำแค่ 1 แถว** — `NB2502006` serial `PF115A8E` ซ้ำเป๊ะทั้งรหัสและ serial (บรรทัด 113 กับ 132)
   นอกนั้นไม่ตัด เพราะ "รหัสซ้ำ" ที่เหลือเป็นคนละเครื่องจริงๆ (serial ต่างกัน) ถ้าตัดจะเท่ากับทำทรัพย์สินหาย
2. **ผู้ครอบครองต้องสร้างเป็น user ก่อน** — ตาราง equipment ผูกด้วย `current_holder_id` ไม่ใช่ข้อความอิสระ
   จึงสร้าง user 167 ราย (ทั้งชื่อคนและชื่อสาขา ตามที่ CSV ใส่มาในคอลัมน์นั้น) แล้วผูก id ให้
   ถ้าไม่ทำแบบนี้ หน้า "ผู้ครอบครอง" จะว่างเปล่าทั้งหน้าแม้ข้อมูลจะเข้าครบ
3. **ไม่นำเข้า "ซ่อมทั้งหมด (ครั้ง)"** — ระบบคำนวณเองจากจำนวน ticket ซ่อมของเครื่องนั้น ถ้ายัดตัวเลขจาก CSV
   เข้าไปจะขัดกับของจริงทันทีที่มีคนแจ้งซ่อมเพิ่ม (คอลัมน์ "ค่าซ่อมรวม" เป็น 0 ทุกแถว และ "อายุ (วัน)"
   เป็นค่าที่คำนวณมาแล้ว จึงข้ามทั้งคู่)
4. **ทับแถวตัวอย่างเดิม 2 แถว** (`PC2501001`, `PC2504003` ที่ serial เป็น `SN-…`) ด้วยของจริง โดยคง `id` เดิมไว้
   เพื่อไม่ให้ ticket ที่อ้างถึงเครื่องนั้นกลายเป็นอ้างถึงของที่ไม่มีอยู่

### ปัญหาข้อมูลที่ยังค้าง (อยู่ใน `equipment-import-conflicts.csv`)
- **21 รหัสทรัพย์สินถูกใช้ซ้ำกับคนละเครื่อง รวม 48 เครื่อง** เช่น `PC2306001` ใช้กับ 4 เครื่อง
  (ถลางภูเก็ต / อยุธยา / บางกะปิ / สำนักงานใหญ่) — นำเข้าครบทุกเครื่องแล้วเพื่อไม่ให้ข้อมูลหาย
  แต่ **การค้นด้วยรหัสในบอทจะเจอแค่เครื่องแรก** ต้องแก้รหัสให้ไม่ซ้ำถึงจะใช้งานได้ถูกต้อง
- **7 serial ซ้ำข้ามรหัส** เช่น `25301010552857` อยู่ทั้ง `SC2605003` และ `SC2605002`,
  `MP1Z9EW2` อยู่ทั้ง `PC2106001` และ `PC2306004` — อย่างน้อยหนึ่งฝั่งคีย์ผิด
- ยังเหลือ **22 แถวข้อมูลตัวอย่าง** จากตอนสร้างระบบ (serial `SN-A1001` ฯลฯ) ปนอยู่ ยังไม่ได้ลบ
  เพราะมี ticket ตัวอย่างอ้างถึงอยู่ ถ้าจะลบควรลบ ticket ตัวอย่างพร้อมกัน

ย้อนกลับทั้งหมด:
```powershell
docker compose exec -T app sh -lc "cp /app/data/equipment.json.bak-import-2026-09-15 /app/data/equipment.json; cp /app/data/users.json.bak-import-2026-09-15 /app/data/users.json"
docker compose restart bot
```
