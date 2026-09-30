# สถาปัตยกรรม

## 3 ส่วนที่คุยกันผ่าน HTTP

```
พนักงานในสาขา ──แชท LINE──▶ LINE Bot (Python/FastAPI) ──HTTP──▶ Next.js Admin ──▶ data/*.json
                                      ▲                              │
                              line-oa/ (rich menu, รูป OA)           ▼ หน้าเว็บทีม IT
```

**หลักการ:** บอทไม่รู้จักฐานข้อมูลเลย รู้จักแค่ `/api/internal/*`
วันที่ย้ายที่เก็บข้อมูล ฝั่งบอทไม่ต้องแก้แม้แต่บรรทัดเดียว

## Next.js — `src/`

| เส้นทาง | ทำอะไร |
| --- | --- |
| `app/(dashboard)/` | ภาพรวม · tickets · assets · custodian · employees · branches · resolved · repair-history · stock · faq |
| `app/actions/*.ts` | Server Action ทั้งหมด — `auth · branches · employees · equipment · faq · liff · stock · tickets` |
| `app/api/internal/*` | `lookup` (อ่านทุกอย่าง) · `tickets` · `tickets/confirm` · `requester` · `attachments` · `ticket-views` |
| `app/api/line/webhook` | webhook ฝั่ง Next.js (คนละตัวกับของบอท) — ใช้กับ LIFF/การแจ้งเตือน |
| `app/liff/new-ticket` | ฟอร์มแจ้งเรื่องใน LIFF |
| `app/uploads/[...path]` | เสิร์ฟไฟล์ที่ผู้ใช้อัปโหลด |
| `lib/line/*` | คุยกับ Messaging API ฝั่งเว็บ: `client · notify · confirm-card · status-message · verify · id-token · sync-user · faq-bot` |
| `lib/security.ts` · `components/security/BlockDevTools.tsx` | กันการเปิด DevTools บนหน้าแอดมิน |

### แพตเทิร์นของหน้าเว็บ

ทุกหน้าทำแบบเดียวกัน — ดู `branches` หรือ `employees` เป็นต้นแบบ:

```
page.tsx (server component)
  └─ อ่านข้อมูลจาก lib/db/* + คำนวณตัวเลขสรุปให้เสร็จฝั่งเซิร์ฟเวอร์
     └─ ส่งลงเป็น prop ให้ <XxxBoard> (client component)
          ├─ มือถือ/แท็บเล็ต = การ์ดต่อแถว · lg ขึ้นไป = ตาราง
          ├─ ตัวกรอง + ค้นหา + usePaginated
          ├─ Modal เพิ่ม/แก้ไข (ใช้ key = id เพื่อรีเซ็ต defaultValue)
          └─ ConfirmDialog ตอนลบ พร้อม blockedReason ถ้ามีประวัติผูกอยู่
```

**ทำไมต้องแยก layout มือถือกับจอใหญ่ ไม่ใช้ตารางเลื่อนแนวนอนอย่างเดียว:**
ปุ่มจัดการอยู่คอลัมน์ขวาสุด ถ้าเลื่อนแนวนอน คนใช้มือถือต้องปัดจนสุดทุกแถวกว่าจะกดแก้ไขได้
ซึ่งเป็นงานหลักของหน้าพวกนี้

**ทำไมคำนวณตัวเลขสรุปฝั่งเซิร์ฟเวอร์:** เช่นหน้า employees ต้องนับ ticket ต่อคน 326 คน
ถ้าให้ client นับเองจะกลายเป็นวนซ้อนกันทุกครั้งที่ re-render

### ชิ้นส่วนกลาง `components/ui/`

| ไฟล์ | ของที่ export |
| --- | --- |
| `Modal.tsx` | `Modal` · `ConfirmDialog` · `Field` · `MODAL_INPUT` |
| `Pagination.tsx` | `Pagination` · `usePaginated(items, {storageKey, resetOn})` |
| `Card.tsx` | `PageHeader` และการ์ดต่างๆ |
| `Filters.tsx` · `SortControl.tsx` | ตัวกรองและการเรียงที่ใช้ร่วมกัน |

จุดที่ตั้งใจออกแบบไว้ใน `Modal`: backdrop ใช้ `onMouseDown` (ไม่ใช่ `onClick`) เพื่อไม่ให้
การลากเลือกข้อความแล้วปล่อยนอกกล่องกลายเป็นการปิดกล่องทิ้งงานที่พิมพ์ไว้ ·
ปุ่มหลักอยู่ล่างสุดบนมือถือ (`flex-col-reverse sm:flex-row`) · เผื่อ safe area ของ iPhone

## LINE Bot — `line-bot-python/app/`

| ไฟล์ | หน้าที่ |
| --- | --- |
| `main.py` | FastAPI + webhook + `/health` (ดูสถานะ rich menu และ step แรกได้จากที่นี่) |
| `flow.py` | state machine — ฟังก์ชันเกือบบริสุทธิ์ ไม่เรียก LINE API เลย จึงเทสต์ได้ทั้งเส้น |
| `ai.py` | `Knowledge` (cache 5 นาที) · `analyze()` จับ intent + slot · `_fuzzy_best` · TF-IDF |
| `messages.py` | ข้อความตอบกลับทั้งหมด คืน `Reply(text, quick, flex)` |
| `flex.py` | การ์ด Flex + `picker()` ที่เมนูไล่ชั้นทุกตัวใช้ร่วมกัน |
| `store.py` | `Session` + MemoryStore/RedisStore (สลับด้วย env `REDIS_URL` อย่างเดียว) |
| `backend.py` | ตัวเดียวที่รู้จัก HTTP — ทุกเมธอดโยน `BackendError` |
| `events.py` | กัน LINE ส่ง event ซ้ำ + ล็อกต่อผู้ใช้ — **เขียนไว้แล้วแต่ `main.py` ยังไม่ import** ดู `status.md` |
| `richmenu.py` | ติดตั้ง rich menu ตอนสตาร์ท แบบ idempotent |
| `thai_text.py` | ตัดคำ/normalize ภาษาไทย |

## Deploy

ทั้งระบบรันบน **เครื่อง Windows ในออฟฟิศ** ด้วย Docker Desktop ไม่ได้อยู่บนคลาวด์

`docker-compose.yml` มี 6 service: `db` (postgres, **ยังไม่มีโค้ดไหนใช้**) · `app` (Next.js) · `bot` ·
`redis` · `caddy` (reverse proxy + TLS) · `duckdns` (อัปเดต DNS)

### ทางเข้าจากอินเทอร์เน็ตมี 2 ทาง แต่ใช้จริงทางเดียว

```
LINE Platform ──▶ Tailscale ingress ──▶ Funnel ──▶ 127.0.0.1:8000  (บอท, /webhook)   ← ใช้จริง
                                                  └▶ 127.0.0.1:3000  (เว็บแอดมิน)

                  duckdns + caddy ──▶ 0.0.0.0:443                                    ← มีอยู่ ไม่ได้ใช้กับ LINE
```

**อย่าสับสนสองทางนี้** — `netstat` จะเห็นพอร์ต 443 ถูกถือไว้ 2 process พร้อมกัน
(tailscaled ถือ IP ของ tailnet · Caddy ถือ `0.0.0.0`) ซึ่ง **ไม่ใช่การชนกัน** และ
การไปหยุด Caddy ไม่ได้ช่วยแก้ปัญหา Funnel เลย (เคยวินิจฉัยผิดมาแล้ว 2026-09-26)

### สคริปต์

| ไฟล์ | ทำอะไร |
| --- | --- |
| `deploy.bat` → `deploy.ps1` | build + `docker compose up -d --build` + **ตรวจผลปลายทางจริงกว่า 20 ข้อ** |
| `backup.bat` → `backup.ps1` | สำรอง `data/` (volume `app_data`) + `.env` |
| `install-autostart.bat` | รันเป็น admin ครั้งเดียว — Funnel อัตโนมัติหลังล็อกอิน + backup รายวัน |
| `startup-funnel.bat` | ตั้ง Funnel ใหม่ทุกครั้งที่ล็อกอิน (`off` ก่อนแล้วค่อยตั้ง) |
| `console-utf8.ps1` | ให้หน้าต่าง cmd แสดงภาษาไทยได้ — สคริปต์อื่น dot-source ตัวนี้ก่อนเสมอ |

**Funnel ไม่จำค่าข้ามการรีบูต** และเวลาตายจะเงียบสนิทไม่มี error ที่ไหนเลย
วิธีแก้เวลาค้างอยู่ที่ `LINE_SETUP.md` §3.1
