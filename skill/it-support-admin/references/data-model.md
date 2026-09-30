# ชั้นข้อมูล

## store.ts — adapter ชั้นเดียวที่แตะ filesystem

```ts
readCollection<T>(name, seedFn?): T[]      // ไม่มีไฟล์ -> รัน seedFn แล้วเขียนลงดิสก์
writeCollection<T>(name, data): void
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
`data/registry_meta.json` แล้วรวมข้อมูลเข้าของเดิมครั้งเดียวต่อเวอร์ชัน)

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

**102 สาขาในไฟล์ seed**: Montipa 30 (แบ่งตามภูมิภาค) · Motta 69 (แบ่งตามทีม Sale/Area Manager) · ส่วนกลาง 3 (สำนักงานใหญ่ · คลัง IT · ห้องเซิร์ฟเวอร์)

> เครื่องที่ใช้งานจริงอาจไม่ตรงกับตัวเลขนี้ — `deploy.ps1` รายงาน **99 สาขา** เมื่อ 2026-09-26
> เพราะ `data/branches.json` บน docker volume ถูกสร้างจาก seed รุ่นก่อนแล้วไม่ถูกเขียนทับ
> (`readCollection` รัน seed เฉพาะตอนยังไม่มีไฟล์) ตัวเลขจากหน้า `/branches` คือตัวเลขจริงเสมอ

**ชื่อสาขาซ้ำกันข้ามบริษัทจริง** (ศาลายา · นครปฐม · มหาชัย) จึงต้องเลือกบริษัทก่อนสาขาเสมอ
`companiesWithBranch(name)` คืนหลายค่าได้ — ผู้เรียก **ต้องถามผู้ใช้** ห้ามหยิบตัวแรก

`listBranchOptions({level, company, group})` คืนตัวเลือกของเมนูไล่ชั้นให้บอท

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

`POST /api/internal/tickets` กันคำขอซ้ำด้วยคู่ **`(request_id, line_user_id)`** — เจอซ้ำคืน ticket เดิม
พร้อม `duplicate: true` แทนการสร้างใหม่ (กันทั้ง ticket ซ้ำและการตัดสต็อกซ้ำ)

### อื่นๆ

`stock.ts` (ตัดสต็อกตอน withdraw) · `faq.ts` · `ticketEvents.ts` (ไทม์ไลน์) ·
`ticketViews.ts` (log การเปิดดู) · `staff.ts` (บัญชีทีม IT + bcrypt — **เปลี่ยน `SEED_PASSWORD` ก่อนใช้จริง**)

## วันที่และเขตเวลา — `lib/date-th.ts`

container รัน UTC ผู้ใช้อยู่ UTC+7 → คำนวณวันที่ด้วย `Asia/Bangkok` แล้วทำเป็น **string key**
(`dayKeyTH`, `todayKeyTH`, `monthKeyOf`) เพื่อไม่ให้ค่าที่เรนเดอร์ฝั่งเซิร์ฟเวอร์กับฝั่ง client ต่างกัน
(hydration mismatch)

> `formatThaiDateShort` / `formatThaiDateFull` ใน `lib/utils.ts` **ยังใช้เวลาเครื่องอยู่** (เพี้ยน 7 ชม.
> เมื่อเรนเดอร์ฝั่งเซิร์ฟเวอร์) — งานค้างที่ควรย้ายมาใช้ `date-th.ts`
