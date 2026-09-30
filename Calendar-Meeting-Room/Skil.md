---
name: massage-welfare-booking
description: ใช้เมื่อพัฒนา แก้บั๊ก รีวิว หรือขึ้นระบบโปรเจ็ค IT-Check-Calandar (ระบบจองคิวสวัสดิการนวดของพนักงาน · FastAPI + PostgreSQL + React · LINE Login/OA) — บอกกติกาที่ห้ามพัง ขั้นตอนทำงาน และวิธีทดสอบ
---

# ระบบจองคิวสวัสดิการนวด — คู่มือการทำงานกับโค้ด

ระบบจองคิวนวดสวัสดิการของพนักงาน 2 บริษัท (ATF/Motta · MTP/Montipa) ตามประกาศ HR 14 ก.ย. 2569
พุธ 09–12 · 13–17 · 15 นาที/คน · 21 คน/วัน · **1 สิทธิ์/คน/เดือน** · เข้าระบบด้วย LINE · แจ้งเตือนทาง LINE OA

## 1. ก่อนเริ่มงานทุกครั้ง

1. อ่าน `CONTEXT.md` หัวข้อ 1–8 (สถานะ · **สิ่งที่ห้ามทำ** · ตาราง · งานค้าง) — หัวข้อ 9 คือ changelog อ่านเฉพาะที่เกี่ยว
2. ถ้าแตะกติกาการจอง อ่าน `docs/WELFARE-RULES.md` ก่อนเสมอ
3. ถ้าแตะ LINE อ่าน `docs/LINE-SETUP.md` / `docs/LINE-OPENCHAT.md`
4. เช็ก `git status` — โฟลเดอร์นี้มักมีงานที่ยังไม่ commit ห้ามทับ

## 2. แผนที่โค้ด

| อยากแก้ | ไปที่ |
|---------|-------|
| คำนวณรอบว่าง / ปิดทั้งวัน | `apps/api/app/services/availability.py` → `_work_windows()` |
| จอง · ยกเลิก · เลื่อนรอบ · idempotency | `services/booking.py` (`_RETRYABLE_CONFLICTS`) |
| โควตา · งดสิทธิ์ · วันให้บริการ | `services/welfare.py` |
| เช็คอิน · ตัดสิทธิ์คนมาสาย | `services/attendance.py` (`sweep_no_shows`) |
| LINE Login · ผูกรหัสพนักงาน | `services/line_login.py` · `routers/line_auth.py` · เว็บ `pages/LineLink.tsx` |
| รายชื่อ HR (Excel) | `services/employee_directory.py` · `routers/admin_directory.py` · `admin/pages/EmployeeDirectoryPage.tsx` |
| แผนก/ฝ่าย · ฝ่ายตามผังองค์กร | `services/departments.py` (`apply_department`) · `admin/pages/DepartmentsPage.tsx` |
| โปรไฟล์พนักงาน · ช่องที่ล็อก | `routers/auth.py` (`_locked_fields`, `update_me`) · `pages/Profile.tsx` |
| ข้อความ LINE · ประกาศในห้อง | `services/line_messages.py` · `services/line_roster.py` (`short_name`) · `services/announcements.py` |
| ส่งแจ้งเตือน (outbox) | ตาราง `notifications` + `scripts/notify_worker.py` |
| error code ภาษาไทย | `app/core/errors.py` |
| ค่าตั้งจาก `.env` | `app/core/config.py` |
| migration | `apps/api/sql/NNN_*.sql` (ล่าสุด `012`) |
| หน้าเว็บ API client/types | `apps/web/src/api.ts` `types.ts` · `admin/api.ts` `admin/types.ts` (เขียนมือ — แก้ให้ตรง backend เอง) |

## 3. กติกาที่ห้ามพัง (สรุป — ฉบับเต็มใน CONTEXT.md หัวข้อ 2)

- **ด่านฐานข้อมูล 2 ด่าน:** `bookings_no_overlap` (EXCLUDE gist) และ `uq_bookings_monthly_quota` (partial unique) ห้ามลบ/แก้
  · ตรวจด้วย `python scripts/init_db.py --check`
- **เงื่อนไขสถานะคู่กัน:** SQL `('pending','confirmed')` ↔ `BookingStatus.blocking()` · SQL `('pending','confirmed','completed','no_show')` ↔ `quota_consuming()`
- **`quota_month`** ใช้ `timezone(INTERVAL '+07:00', starts_at)` เท่านั้น (IMMUTABLE)
- **เพิ่ม constraint ใหม่ที่ชนตอนจอง** → เพิ่มใน `_RETRYABLE_CONFLICTS` (Postgres ตรวจ EXCLUDE ก่อน unique)
- **กฎปิดทั้งวัน** อยู่ใน `_work_windows()` ไม่ใช่แค่ validate
- **`reschedule()`** ติด `cancel_cutoff_minutes` เหมือน `cancel()`
- **เวลา:** ปฏิเสธ `starts_at` ที่ไม่มี offset · หน้าเว็บใช้ `lib/date.ts` ห้าม `.slice()` สตริงเวลา
- **แจ้งเตือน:** เขียน outbox ใน transaction ห้ามส่งตรง · LINE push ต้องมี retry key คงที่ต่อแถว
- **ความปลอดภัย:** ไม่มีหน้าสมัครบัญชีหลังบ้าน · ห้ามถอด `X-Requested-With` · ห้ามปิดตรวจลายเซ็น webhook บน production
  · ห้ามเปิด `COPILOT_ENABLED` · ห้ามคลายด่านผูกรหัส (นับทุกครั้งที่ค้น · ตอบแค่ชื่อย่อ · ผูกได้เฉพาะรหัสที่เพิ่งค้นเจอ)
- **ข้อมูลส่วนบุคคล:** ประกาศในห้อง LINE มีได้แค่ `short_name()` + รอบเวลา · ลิงก์ห้องส่งเฉพาะคนล็อกอิน
  · **ห้าม commit ไฟล์รายชื่อพนักงานจริง** (ใช้ `Claude outputs/` ที่ gitignore) · เทสต์ใช้ชื่อสมมติ
- **ไฟล์ HR:** ไม่มีคอลัมน์ฝ่าย = ไม่ล้างฝ่ายเดิม · ค่าที่อ่านไม่ได้ห้ามทิ้งทั้งแถว (คนนั้นจะถูกปิดสิทธิ์ตอน deactivate)
- **หลังบ้าน:** ห้ามเพิ่ม timer โหลดข้อมูลอัตโนมัติ (ต่ออายุเซสชันไม่รู้จบ) · "โพสต์แล้ว" บันทึกชุดที่ HR เห็น

## 4. ขั้นตอนงานที่พบบ่อย

### เพิ่ม/แก้โครงสร้างฐานข้อมูล
1. สร้าง `sql/0NN_<ชื่อ>.sql` ใหม่ **ห้ามแก้ไฟล์ที่รันไปแล้ว** · เขียนแบบรันซ้ำได้ (`IF NOT EXISTS` · `ON CONFLICT DO NOTHING`)
2. หัวไฟล์อธิบายที่มา · กติกา · ผลต่อข้อมูลเดิม
3. แก้ `app/models.py` ให้ตรง
4. ถ้าเปลี่ยนข้อมูลตั้งต้น (เช่น จำนวนฝ่าย) ตรวจเทสต์ที่นับจำนวน · `tests/conftest.py` คืนค่าตั้งต้นจากสำเนาหลังรัน SQL ครบ

### เพิ่มช่องในโปรไฟล์ที่มาจากรายชื่อ HR
- ซิงก์ใน `_sync_linked_customers` (อ่านด้วย `populate_existing=True` เพราะแถวถูก upsert ด้วย SQL ตรง)
- ตั้งค่าตอนผูก LINE ใน `link_employee()` · ล็อกด้วย `_locked_fields` · หน้าเว็บใช้ `locked.has(...)`

### เพิ่มคอลัมน์ในไฟล์ Excel ของ HR
- เพิ่ม alias ใน `_ALIASES` (คีย์หัวคอลัมน์ตัดช่องว่าง/เครื่องหมายแล้ว เช่น "แผนก / ฝ่าย" → `แผนกฝ่าย`)
- ใส่ flag `has_<col>` ใน `SheetResult` · upsert แยกชุดตาม flag · ใส่ใน preview + `_same()`

### เพิ่ม error ใหม่
- class ใน `core/errors.py` (code + ข้อความไทย + HTTP status) · หน้าเว็บจัดการตาม `code` ไม่ใช่ข้อความ

### แก้หน้าเว็บ
- คอมโพเนนต์ shadcn/ui อยู่ใน `src/components/ui/` แก้ได้ตรงๆ · สี/ฟอนต์ที่ `src/styles.css`
- Select ของ Radix ไม่รองรับ `required` — ตรวจเองก่อนส่ง · ข้อความยาวบนมือถือใช้ `max-w-(--radix-select-trigger-width)` + `whitespace-normal`

## 5. ทดสอบ

```bash
cd apps/api
export TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/massage_test   # Windows: set
export DATABASE_URL=postgresql+asyncpg://postgres@127.0.0.1:5432/massage_test  # ให้ /health ผ่าน
python -m pytest -q                        # ต้องผ่านทั้งหมด (ล่าสุด 387)
python -m pytest tests/test_welfare_rules.py tests/test_no_double_booking.py -v

cd apps/web && npm run typecheck && npm run build
```

- เทสต์ใช้ **Postgres จริง ห้าม mock** · LINE ใช้ `tests/line_fake.py` · อีเมล dry-run อัตโนมัติ
- บั๊กทุกตัวที่แก้ต้องมีเทสต์ที่พังก่อนแก้
- งาน UI ตรวจด้วย Playwright บน build จริง (desktop + มือถือ 390px) และไม่มี console error

## 6. ขึ้นระบบ

- Server ใช้ `docker-up.bat` (build + migrate อัตโนมัติ) · API ที่ `localhost:8020` (**ห้ามพอร์ต 8000** ชนบริการอื่น)
- ngrok static domain ใน `.env` · เปลี่ยนโดเมน = แก้ Callback/Webhook URL ใน LINE Developers
- บัญชีหลังบ้าน: `docker compose exec api python scripts/create_admin.py create <u> --name "..."`
- ล้างบัญชีทดสอบ: `scripts/dev/reset_customer.sql` (dry run ก่อน · `-v confirm=1` ลบจริง)
- ความลับอยู่ใน `.env` เท่านั้น ห้ามวางในแชต/git/เอกสาร

## 7. เมื่อทำงานเสร็จ

1. อัปเดต `CONTEXT.md`: บรรทัด "อัปเดตล่าสุด" · ตาราง (หัวข้อ 4) · ✅/⬜ (หัวข้อ 5–6) · changelog หัวข้อ 9
   (ที่มา · สิ่งที่เปลี่ยน · บั๊กที่เจอ · จำนวนเทสต์ · สิ่งที่ต้องทำบน Server)
2. ถ้าเพิ่ม "สิ่งที่ห้ามทำ" ใส่ในหัวข้อ 2 พร้อมเหตุผลและเหตุการณ์ที่เคยพลาด
3. แก้ `README.md` / `HANDOFF.md` ถ้าคำสั่งหรือขั้นตอนเปลี่ยน
4. บอกผู้ใช้ให้ชัดว่าต้องรัน `docker-up.bat` บน Server หรือไม่ และ HR ต้องทำอะไรต่อ
