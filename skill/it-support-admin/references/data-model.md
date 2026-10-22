# ชั้นข้อมูล

## store.ts — adapter ชั้นเดียวที่แตะ filesystem

```ts
readCollection<T>(name, seedFn?): T[]      // ไม่มีไฟล์ -> รัน seedFn แล้วเขียนลงดิสก์ · ไฟล์เสีย -> คืน []
readCollectionStrict<T>(name): T[]         // ไม่มีไฟล์ -> [] · ไฟล์เสีย/ว่าง -> throw CollectionReadError
writeCollection<T>(name, data): void       // atomic: เขียนไฟล์ชั่วคราวแล้ว rename ทับ
upsertOne<T>(name, item, seedFn?): T
patchOne<T>(name, id, patch, seedFn?): T | null
```

อ่าน/เขียน `data/<name>.json` แบบ sync โดยตั้งใจ (ข้อมูลชุดเล็ก + ไม่ต้องกังวล race ระหว่าง request)
**โมดูลอื่นห้ามแตะ `fs` ตรงๆ** เพื่อให้ย้ายไป Postgres ได้โดยเขียน adapter ใหม่ตัวเดียว

### กับดักที่สำคัญที่สุดของชั้นนี้

`seedFn` รันเฉพาะตอน **"ยังไม่มีไฟล์"** — เครื่องที่ใช้งานอยู่จริงมีไฟล์แล้วเสมอ (อยู่บน docker
volume ที่ไม่ถูกลบตอน deploy) **การแก้ `seed()` เฉยๆ จึงไม่มีผลกับใครเลยสักคน**
อาการคือ "อัปเดตโค้ดแล้วแต่ข้อมูลยังเป็นชุดเดิม" ซึ่งหาสาเหตุยากมากเพราะโค้ดดูถูกทุกบรรทัด

ถ้าต้องการให้ข้อมูลใหม่ไปถึงเครื่องที่รันอยู่ ต้องเขียน "ซิงก์" แยก —
ต้นแบบคือ `ensureEmployeeRegistry()` ใน `lib/db/employees.ts` (เทียบเวอร์ชันจาก
`data/registry_meta.json` แล้วรวมข้อมูลเข้าของเดิมครั้งเดียวต่อเวอร์ชัน) · ตัวที่สองคือ `ensureBranchRegistry()` ใน
`lib/db/branches.ts` (เขต Motta 13 ต.ค. 2026 — จับคู่ชื่อ/ชื่อเดิม `MOTTA_RENAMED` แก้แถวเดิม ไม่สร้างซ้ำ)

## Postgres — เตรียมไว้แล้วแต่ยังไม่ได้ใช้

- `docker-compose.yml` มี service `db` (postgres:16-alpine) เปิดพอร์ต `127.0.0.1:5434`
- schema อยู่ที่ `db/init/001_schema.sql` (รันอัตโนมัติตอน volume ยังว่าง)
- `src/lib/db/pg.ts` มี connection pool พร้อมใช้ **แต่ยังไม่มีโมดูลไหน import มัน**
- `id` เป็น `text` เพราะฝั่ง JS สร้างเอง (`randomUUID()` ใน `lib/utils.ts`) ไม่พึ่ง default ของ DB

การย้าย: เขียน adapter ที่ implement 4 signature ของ `store.ts` แล้วสลับ import — UI/Server Action ไม่ต้องแก้

## โดเมนหลัก

### บริษัท — `lib/companies.ts`

3 ค่าคงที่ hardcode โดยตั้งใจ: `montipa` · `motta` · `central`
เหตุผล: ค่านี้ถูกเก็บลงทุก ticket และใช้เป็นตัวกรองในรายงาน ถ้าลบ/เปลี่ยนรหัสได้จากหน้าเว็บ
ticket เก่าจะชี้ไปบริษัทที่ไม่มีอยู่ทันที การเพิ่มบริษัทเกิดปีละครั้ง แก้โค้ดคุ้มกว่าความเสี่ยงนั้น

> **แยกไฟล์นี้ออกจาก `db/branches.ts` โดยตั้งใจ** — client component import จากที่นี่ได้
> เพราะเป็นข้อมูลล้วน ไม่เรียก `store.ts` (ซึ่ง import `node:fs`)

### สาขา — `lib/db/branches.ts`

**104 สาขาในไฟล์ seed**: Montipa 30 (7 เขตของ Area Manager ใต้ ROM 2 คน — ตารางทีมขาย ต.ค. 2026 · เดิมแบ่งตามภูมิภาค · ลำปาง `closed`) · Motta 71 (10 เขตของ Area Manager ใต้ Sale Manager 4 คน — ตาราง 13 ต.ค. 2026) · ส่วนกลาง 3 (สำนักงานใหญ่ · คลัง IT · ห้องเซิร์ฟเวอร์)
· เขตมี `saleManager` (Motta = Sale Manager · Montipa = ROM ดู `managerTitle`)/`areaManager` ในตาราง · ซิงก์ลงเครื่องจริงด้วย `syncCompanyAreas()` แยกเวอร์ชันต่อบริษัท · ป้ายเขตห้ามซ้ำในบริษัท (`groupKey()` หา key จากป้าย — ปอสองเขตจึงเป็น "ทีมปอ" กับ "ทีมปอ New")

> เครื่องที่ใช้งานจริงอาจไม่ตรงกับตัวเลขนี้ — `deploy.ps1` รายงาน **99 สาขา** เมื่อ 2026-09-26
> เพราะ `data/branches.json` บน docker volume ถูกสร้างจาก seed รุ่นก่อนแล้วไม่ถูกเขียนทับ
> (`readCollection` รัน seed เฉพาะตอนยังไม่มีไฟล์) ตัวเลขจากหน้า `/branches` คือตัวเลขจริงเสมอ

**ชื่อสาขาซ้ำกันข้ามบริษัทจริง** (ศาลายา · นครปฐม · มหาชัย) จึงต้องเลือกบริษัทก่อนสาขาเสมอ
`companiesWithBranch(name)` คืนหลายค่าได้ — ผู้เรียก **ต้องถามผู้ใช้** ห้ามหยิบตัวแรก

`listBranchOptions({level, company, group})` คืนตัวเลือกของเมนูไล่ชั้นให้บอท — เรียงตามตาราง (ไม่ใช่ลำดับในไฟล์) ·
ระดับเขตมี `sub` = "Sale Manager: X · สาขาตัวอย่าง 3 แห่ง"

### ทีม IT ที่สั่งบอทจากแชทได้ — `lib/db/lineStaff.ts`

`data/line_staff.json` (อ่านแบบ strict) · `pending` → แอดมินอนุมัติที่หน้า `/line-bot` → `approved` · คำขอค้างไม่เกิน 30 ·
บอทถามผ่าน `POST /api/internal/line-staff` ทุกครั้งที่ใช้คำสั่ง (ไม่ cache)

### พนักงาน — `lib/db/employees.ts` + `employees.seed.json`

326 คนจากทะเบียน HR (ผังองค์กร H2-2026) — 133 มีฝ่ายตามผัง · 193 ยังไม่ถูกจัด (`department = null`
แสดงเป็น "อื่นๆ") ใช้ตาราง `users` ร่วมกับผู้ครอบครองทรัพย์สิน

| ฟังก์ชัน | ใช้ทำอะไร |
| --- | --- |
| `ensureEmployeeRegistry()` | ซิงก์ทะเบียนเข้า `users` ครั้งเดียวต่อ `EMPLOYEE_REGISTRY_VERSION` |
| `listEmployees(includeInactive?)` | รายชื่อ (ซิงก์ให้ก่อนอัตโนมัติ) |
| `departmentSummary()` | ฝ่ายที่มีคนอยู่จริง เรียงตามผัง · "อื่นๆ" ท้ายสุดเสมอ |
| `searchEmployees(q)` | ค้นด้วยรหัส/ชื่อ/ชื่อเล่น คืนคะแนน 3/2/1 |
| `bindLineUser` / `unbindLineUser` | ผูก/ถอดบัญชี LINE (1 บัญชี = 1 คนเสมอ) |
| `planRegistryImport` / `applyRegistryImport` (020) | นำเข้าทะเบียนล่าสุดจาก HR ที่หน้า `/employees`: ไม่อยู่ในไฟล์ → `active: false` (สถานะ 0) ยกเว้นกลุ่ม `EMPLOYEE_SYNC_KEEP_PREFIXES` (AS,MS,PS) · ช่องว่าง = คงเดิม · รหัสซ้ำในระบบ = ข้าม · อ่านไฟล์ในเบราว์เซอร์ด้วย `lib/employee-import.ts` (client-safe) — กติกาเต็มใน README |
| `createEmployee` / `updateEmployee` / `setEmployeeActive` / `deleteEmployee` | CRUD จากหน้าแอดมิน |

**กติกาการเขียนทับตอนซิงก์** (สำคัญมาก):

| ช่อง | ใครชนะ |
| --- | --- |
| ทะเบียนมีค่า (ชื่อ/ฝ่าย/ตำแหน่ง/ระดับ/บริษัท) | ทะเบียน — HR เป็นเจ้าของ |
| ทะเบียนเป็น `null` | ของเดิมในระบบ — ไม่งั้นฝ่ายที่แอดมินเติมให้ 193 คนจะถูกล้างทุกครั้ง |
| `line_user_id` / `email` / `id` / `created_at` | ระบบ — ทะเบียนไม่แตะเด็ดขาด |

> **แก้ `employees.seed.json` แล้วต้องขยับ `EMPLOYEE_REGISTRY_VERSION` ด้วยเสมอ**
> ไม่งั้นเครื่องที่ซิงก์ไปแล้วจะข้ามรอบใหม่ไปเงียบๆ

### ทรัพย์สิน — `lib/db/equipment.ts`

**รหัสทรัพย์สินซ้ำกันอยู่ 28 แถว** (คนละเครื่อง คนละสาขา เช่น PC2306001 ใช้กับ 4 เครื่อง)
`findEquipmentByAssetCode()` จึงคืน **ลิสต์** ไม่ใช่ตัวเดียว — ทุกที่ที่รับรหัสต้องถามว่า
"เครื่องไหน" และส่ง `equipment_id` ไปกับ ticket ไม่ใช่แค่ `asset_code`

### Ticket — `lib/db/tickets.ts`

`company` เป็นฟิลด์จริงบน ticket ไม่ได้อยู่ใน `meta`
`meta` เก็บ: `source` · `request_id` · `requester_name/department` · `initial_message` ·
`items` · `image_urls` · `line_user_id` · `line_display_name` · `asset_code_input`
· `status_history[]` (`{id, from, to, by, at, note, notified, role?}` — `role` admin/requester/system มีตั้งแต่ 12 ต.ค. 2026)
· `resolution_note` · `completed_at/by` (= ปิดงานรอบล่าสุด · ชื่อมาจากระบบเดิม) · `confirmation` (การ์ดยืนยันรุ่นเก่า)
· `rating` `{score 1-5, comment, by, line_user_id, at}` (12 ต.ค. 2026 — อ่านผ่าน `lib/ticket-feedback.ts` เท่านั้น)

**สถานะมี 3 ค่า (21 ต.ค. 2026):** `pending` รอดำเนินการ · `resolved` แก้ไขแล้ว (= ทีม IT ปิดงาน + การ์ดให้คะแนน)
· `cancelled` ยกเลิก (ปิดโดยไม่ได้แก้ · `resolved_at` ว่าง · ไม่มีการ์ดดาว · เปิดกลับจากการ์ดไม่ได้ · วันที่ยกเลิกอ่านจาก `status_history`)
— ค่าคงที่/ชื่อที่แสดงอยู่ `lib/ticket-status.ts` · ผู้แจ้งกด "ยังมีปัญหาอยู่" ภายใน 14 วัน → pending และ `meta.rating`
ถูกถอด (ประวัติคะแนนอยู่ใน `ticket_events` type `rated`) · เจ้าของปุ่มบนการ์ด = `ticketOwnerLineId()` ที่เดียว
· **ข้อมูลเก่ายังมีสถานะเดิม** (in_progress / waiting_* / completed / closed) ได้ 2 ที่: (1) ticket ที่ยังไม่ถูกอ่าน
— `listTickets()` แปลงให้ทันทีผ่าน `migrateLegacyStatuses()` แล้วเขียนกลับ (2) `status_history` /
`ticket_events` ของเรื่องเก่า — **แสดงผลด้วย `statusLabel()` เสมอ** ห้ามใช้ `TICKET_STATUS_LABEL[code]` ตรงๆ (ได้ undefined)
· ห้ามเพิ่มสถานะใหม่โดยไม่ถามผู้ใช้ — การยุบสถานะและเพิ่มยกเลิกกลับเป็นคำขอโดยตรง · เพิ่มสถานะ = แก้ `TICKET_STATUS_ORDER`
แล้วตาม `Record<TicketStatus, …>` ที่ tsc ฟ้อง (ป้ายสี · ข้อความ LINE · ตัวนับ) ส่วนชีตสรุปของ Excel/แท็บ Tickets วนจากลำดับนี้เอง

`POST /api/internal/tickets` กันคำขอซ้ำด้วยคู่ **`(request_id, line_user_id)`** — เจอซ้ำคืน ticket เดิม
พร้อม `duplicate: true` แทนการสร้างใหม่ (กันทั้ง ticket ซ้ำและการตัดสต็อกซ้ำ)

### ไฟล์เสียแล้วถูกเขียนทับ — กับดักอันดับสอง

`readCollection` คืน `[]` เมื่อ JSON อ่านไม่ออก แล้ว `upsertOne`/`patchOne` จะเขียน `[แถวใหม่]` ทับทั้งไฟล์
ข้อมูลเดิมหายหมดโดยไม่มี error — พอรับได้กับข้อมูลที่ seed กลับมาเองได้ แต่ **ข้อมูลที่คนพิมพ์เองต้องใช้
`readCollectionStrict`** แล้วปฏิเสธการบันทึกเมื่อไฟล์เสีย (ต้นแบบ: `lib/db/notes.ts`)
`writeCollection` เป็น atomic แล้ว จึงไม่เกิดไฟล์ครึ่งไฟล์จากโปรเซสตายกลางทางอีก

### ข้อความ (ฝากข้อความ) — `lib/db/notes.ts` + `lib/notes-shared.ts`

หน้า `/notes` ต้องล็อกอิน · `data/notes.json` · `Note { id, body, author, created_at, updated_at, updated_by }`
`author` เก็บเป็นชื่อที่แสดง ไม่เก็บ id ของบัญชี (บัญชีถูกลบ/เปลี่ยนชื่อได้ แต่ข้อความเก่าต้องบอกได้ว่าใครเขียน)
กฎตรวจข้อความ (`checkNoteBody`, ยาวสุด 5,000) · วันที่ไทย (`noteStamp`) · เนื้อไฟล์ .txt (`notesToText`:
BOM + `\r\n`) อยู่ใน `notes-shared.ts` เพราะหน้าเว็บกับ Server Action ใช้ตัวเดียวกัน
ร่างที่ยังไม่กดบันทึกอยู่ใน localStorage ของเครื่องนั้น (`itadmin:notes:draft`) — ตัวข้อความจริงอยู่บนเซิร์ฟเวอร์เสมอ

### คลังไฟล์ — `lib/db/drive.ts` + `lib/drive/*` + `lib/drive-shared.ts`

หน้า `/files` ต้องล็อกอิน · 3 collection อ่านด้วย `readCollectionStrict` ทั้งหมด:
`drive_folders` = `DriveFolder { id, name, parent_id, created_at, created_by }` ·
`drive_files` = `DriveFile { id, folder_id, name, size, mime, note, sha256, uploaded_at, uploaded_by, updated_at, updated_by }` ·
`drive_uploads` = การอัปโหลดที่ยังไม่จบ `DriveUpload { id, folder_id, name, size, mime, created_at, created_by }`
ตัวไฟล์อยู่นอก JSON: `DRIVE_DIR/blobs/<id>` (เสร็จแล้ว) · `DRIVE_DIR/parts/<id>.part` (กำลังส่ง) — ใน docker คือ volume `drive`
**แยกจาก `app_data` โดยตั้งใจ** เพราะ backup.bat คัดลอก app_data ลง `backups/` ในโปรเจกต์ → backup.bat ไม่รวมคลังไฟล์
กติกา: ชื่อห้ามซ้ำในโฟลเดอร์เดียวกัน (ไม่สนตัวพิมพ์เล็กใหญ่) · ลบโฟลเดอร์ได้เฉพาะโฟลเดอร์ว่าง ·
พื้นที่ที่จองแล้ว = ไฟล์ที่เสร็จ + การอัปโหลดที่ค้าง (`reservedBytes`) เทียบกับ `DRIVE_QUOTA_GB` ·
id ต้องผ่าน `isDriveId` (UUID) ก่อนเอาไปต่อเป็น path เสมอ · `deploy.ps1` ตรวจ `/api/health` → `storage.drive_writable`

### อื่นๆ

`stock.ts` (ตัดสต็อกตอน withdraw) · `faq.ts` · `ticketEvents.ts` (ไทม์ไลน์) ·
`ticketViews.ts` (log การเปิดดู)

### หน้ารหัสผ่าน — `lib/db/vault.ts` (`data/vault.json` · `data/vault_audit.json`)

แถว = `{ id, category, fields, secret, has_secret, created_at/by, updated_at/by, secret_updated_at }`
`fields`/`secret` = `"v1.<iv>.<tag>.<ct>"` (AES-256-GCM · AAD `"<id>:fields"` / `"<id>:secret"`) — กุญแจจาก `VAULT_KEY` ผ่าน HKDF
หมวด: `account` · `network` · `wifi` · `apple_id` (ช่องที่ใช้ต่อหมวดอยู่ที่ `VAULT_CATEGORY_INFO` ใน `vault-shared.ts`)

- อ่านด้วย `readCollectionStrict` · ก่อนเขียนต้องถอดของเดิมได้ครบ (`assertReadable`) — กุญแจผิด = ไม่เขียน
- `listVaultEntries()` ไม่แตะก้อน `secret` เลย · `getVaultSecret()` ใช้เฉพาะตอนกดดู/คัดลอก (ผู้เรียกต้องบันทึกประวัติก่อนคืนค่า)
- ซ้ำ = หมวด + ชื่อ + ชื่อผู้ใช้ (ไม่สนตัวพิมพ์) → นำเข้าข้าม ไม่เขียนทับ
- ประวัติ: `{ at, staff_id, staff_name, action, entry_id, label(เข้ารหัส), detail }` ล่าสุด 5,000 รายการ

### บัญชีเจ้าหน้าที่ — `lib/db/staff.ts` (`data/staff_accounts.json`)

`StaffAccount { id, username, password_hash, display_name, role, created_at, pages?, active?, session_version?, updated_at? }`
สร้าง/แก้ด้วย `tools/staff_admin.py` (`staff-admin.bat`) เท่านั้น — เว็บไม่มีเมนูจัดการบัญชีโดยตั้งใจ

- `role`: `admin` = ทุกหน้า · `it_staff` = เฉพาะ key ใน `pages` (ค่าที่ไม่รู้จักถูกตัดทิ้ง · ไม่มีช่องนี้ = ไม่มีสิทธิ์สักหน้า)
- `active: false` = ล็อกอินไม่ได้ + cookie ที่ค้างใช้ไม่ได้ทันที · ไม่มีช่องนี้ = ใช้งานได้ (บัญชีรุ่นก่อน)
- `session_version` ต้องเท่ากับ `sv` ใน cookie — โปรแกรมเพิ่มเลขตอนเปลี่ยนรหัส / ปิดใช้งาน / บังคับออก · ไม่มีช่องนี้ = 0
- `password_hash` = bcrypt cost 10 (`$2b$`) — Python `bcrypt` กับ `bcryptjs` ตรวจกันได้ (มีเทสต์ข้ามภาษา) · รหัส ≤ 72 ไบต์
- ชื่อผู้ใช้ซ้ำแบบไม่สนตัวพิมพ์ = `getStaffByUsername` คืน null ทั้งคู่ (ไม่หยิบอันแรก)
- ไฟล์ไม่มีอยู่ = `readCollection` สร้าง seed `admin` + `SEED_PASSWORD` (อยู่ในซอร์สโค้ด — **ต้องเปลี่ยนก่อนใช้จริง**)
- ประวัติการแก้บัญชี: `data/staff_admin_log.json` (โปรแกรม .py เขียน · ล่าสุด 2,000 รายการ · ไม่มีรหัสผ่าน) ·
  สำรองรุ่นก่อนหน้า 1 รุ่นที่ `staff_accounts.json.bak`

## วันที่และเขตเวลา — `lib/date-th.ts`

container รัน UTC ผู้ใช้อยู่ UTC+7 → คำนวณวันที่ด้วย `Asia/Bangkok` แล้วทำเป็น **string key**
(`dayKeyTH`, `todayKeyTH`, `monthKeyOf`) เพื่อไม่ให้ค่าที่เรนเดอร์ฝั่งเซิร์ฟเวอร์กับฝั่ง client ต่างกัน
(hydration mismatch)

> `formatThaiDateShort` / `formatThaiDateFull` ใน `lib/utils.ts` **ยังใช้เวลาเครื่องอยู่** (เพี้ยน 7 ชม.
> เมื่อเรนเดอร์ฝั่งเซิร์ฟเวอร์) — งานค้างที่ควรย้ายมาใช้ `date-th.ts`
