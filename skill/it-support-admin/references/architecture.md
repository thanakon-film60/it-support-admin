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
| `app/(dashboard)/` | ภาพรวม · tickets (รวมเรื่องที่แก้ไขแล้ว + ประวัติซ่อม) · notes · files · assets · custodian · employees · branches · stock · faq · (resolved / repair-history / completed = เด้งไป tickets) |
| `app/actions/*.ts` | Server Action ทั้งหมด — `auth · branches · chat · drive · employees · equipment · faq · liff · notes · stock · tickets` |
| `app/api/internal/*` | `lookup` (อ่านทุกอย่าง) · `tickets` (เบิกไม่มีรายการ = 400 `items_required`) · `tickets/confirm` · `tickets/rate` · `requester` · `attachments` · `ticket-views` · `line-staff` (สิทธิ์ทีม IT สั่งบอทจากแชท) |
| `app/api/drive/*` | คลังไฟล์: `uploads` (เริ่ม) · `uploads/[id]` (PUT ท่อน · GET สถานะ · DELETE ยกเลิก) · `uploads/[id]/complete` · `files/[id]` (ดาวน์โหลด) — route handler เพราะ Server Action รับไฟล์ใหญ่ไม่ได้ |
| `app/api/line/webhook` | webhook ฝั่ง Next.js (คนละตัวกับของบอท) — ใช้กับ LIFF/การแจ้งเตือน |
| `app/liff/new-ticket` | ฟอร์มแจ้งเรื่องใน LIFF |
| `app/uploads/[...path]` | เสิร์ฟไฟล์ที่ผู้ใช้อัปโหลด (หลังเซิร์ฟเวอร์เริ่ม) — ตรวจ session + สิทธิ์หน้าตาม `UPLOAD_AREA_PAGES` · ไฟล์ที่มีตอนเริ่มเซิร์ฟเวอร์ Next เสิร์ฟจาก `public/` ตรง ด่านจริงจึงอยู่ที่ `src/proxy.ts` |
| `app/(dashboard)/passwords` · `components/vault/*` | หน้ารหัสผ่าน: ล็อกอยู่ = ส่งแค่จำนวนต่อหมวด · ปลดล็อกแล้ว = รายการไม่มีรหัส (`has_secret` เท่านั้น) · รหัสมาทีละช่องผ่าน `revealVaultSecretAction` (บันทึกประวัติก่อนส่ง) · นำเข้าอ่านไฟล์ในเบราว์เซอร์แล้วเซิร์ฟเวอร์อ่านซ้ำ · ส่งออกสร้าง .xlsx ในเบราว์เซอร์ |
| `app/(dashboard)/no-access` | "ไม่มีสิทธิ์เข้าหน้านี้" + ลิงก์หน้าที่เข้าได้ — `requireSession(หน้า)` เด้งมาที่นี่ (รีเฟรชครั้งเดียวให้เมนูตรงสิทธิ์ล่าสุด) |
| `lib/access.ts` · `lib/pages.json` | ทะเบียนหน้า + `pagesOf` (admin ทุกหน้า · it_staff เฉพาะที่ติ๊ก) · `canAccess` (หลายหน้า = หน้าใดหน้าหนึ่ง) · `landingPath` · `safeRedirectPath` (กัน open redirect) · `pages.json` อ่านร่วมกับ `tools/staff_admin.py` |
| `lib/auth.ts` · `lib/session-token.ts` · `src/proxy.ts` | ล็อกอิน · `getSession` ตรวจ JWT แล้วเปิดไฟล์บัญชีจริงทุก request (`active` · `session_version`) · proxy **ต้องอยู่ใน `src/`** (ที่ราก repo Next ข้ามเงียบๆ) และไม่ครอบ `/api/*` |
| `lib/line/*` | คุยกับ Messaging API ฝั่งเว็บ: `client · notify · rating-card · confirm-card (ระบบเดิม) · card-parts · status-message · verify · id-token · sync-user · faq-bot` + `bot-handoff` (สั่งบอทเงียบตอนเจ้าหน้าที่รับแชท · `postToBot()` ตัวเรียกกลาง) + `bot-control` (หน้า `/line-bot` เปิด/ปิดบอท) · คะแนน/เพดานเปิดกลับอยู่ที่ `lib/ticket-feedback.ts` (client-safe) |
| `lib/drive/*` · `lib/drive-shared.ts` | คลังไฟล์: `storage.ts` แตะดิสก์ (`DRIVE_DIR`) ที่เดียว · `http.ts` เช็กสิทธิ์/header ดาวน์โหลด · `drive-shared.ts` ค่าคงที่ + ฟังก์ชันที่หน้าเว็บใช้ |
| `lib/security.ts` · `components/security/BlockDevTools.tsx` | กันการเปิด DevTools บนหน้าแอดมิน |

### แพตเทิร์นของหน้าเว็บ

ทุกหน้าทำแบบเดียวกัน — ดู `branches` หรือ `employees` เป็นต้นแบบ:

```
page.tsx (server component)
  ├─ await requireSession("<หน้า>")  ← บรรทัดแรกเสมอ (ไม่มีสิทธิ์ → /no-access)
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

**ทำไมคำนวณตัวเลขสรุปฝั่งเซิร์ฟเวอร์:** เช่นหน้า employees ต้องนับ ticket ต่อคน 338 คน
ถ้าให้ client นับเองจะกลายเป็นวนซ้อนกันทุกครั้งที่ re-render

**ชื่อคนทำ (ผู้แก้ไขสถานะ · คนที่สั่งรับแชท) = บัญชีที่ล็อกอินอยู่เสมอ** — `accountEditorName(session)` ใน `lib/editor-name.ts`
ใช้ทั้งตอนแสดง (layout ของ `(dashboard)` ส่งลงไปทาง `CurrentEditorProvider` → `useCurrentEditor()`) และตอนบันทึก
(Server Action อ่านจาก session เอง **ไม่รับชื่อจากหน้าเว็บ** เพราะ action ถูกเรียกตรงได้) · มีแค่ตอนปิดล็อกอิน
(`AUTH_DISABLED`) ที่กลับไปให้พิมพ์ชื่อเอง (ผู้ใช้ขอ 13 ต.ค. 2026) — ฟอร์มใหม่ที่ต้องบันทึกว่าใครทำ ให้ทำแบบเดียวกัน

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
| `main.py` | FastAPI + webhook + `/health` (ดูสถานะ rich menu · step แรก · `chat_mode` ของ OA ได้จากที่นี่) · `_mark_read` สั่งอ่านแล้วให้ข้อความที่บอทจบเอง |
| `flow.py` | state machine — ฟังก์ชันเกือบบริสุทธิ์ ไม่เรียก LINE API เลย จึงเทสต์ได้ทั้งเส้น · ด่าน: `_admin_gate` (คำสั่งทีม IT) → `_off_gate` (ปิดบอท) → `_handoff_gate` (คุยกับเจ้าหน้าที่) |
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

### ทางเข้าจากอินเทอร์เน็ต — ใช้จริงทางเดียว: Cloudflare Tunnel (ตั้งแต่ 7 ต.ค. 2026)

```
LINE / ผู้ใช้ ──▶ Cloudflare ──▶ container "tunnel" (cloudflared) ──▶ http://bot:8000  (^/webhook)   ← ใช้จริง
                it.thanakronpart-time.com                            └▶ http://app:3000  (ที่เหลือ)

Tailscale Funnel ──▶ 127.0.0.1:3000 / :8000                                               ← ทางสำรองเดิม ปิดแล้ว
duckdns + caddy  ──▶ 0.0.0.0:443                                                          ← มีอยู่ ไม่ได้ใช้กับ LINE
```

- Routes ตั้งในหน้า Cloudflare > Tunnels > IT-Support-Admin — **ตัวบนชนะ** `^/webhook` ต้องอยู่บนสุด
- token อยู่ใน `.env` (`CLOUDFLARE_TUNNEL_TOKEN`) · `use-cloudflare.bat` ใส่ token + ย้าย LINE webhook (ทดสอบก่อนเปลี่ยน) + ปิด Funnel
- บัญชี Cloudflare เดียวกันมี tunnel/โดเมนย่อยของงานอื่น (meeting · booking · procurement · api · www) — ห้ามแตะ
- `netstat` เห็นพอร์ต 443 ถูกถือ 2 process (tailscaled · Caddy) ไม่ใช่การชนกัน (เคยวินิจฉัยผิด 2026-09-26)

### สคริปต์

| ไฟล์ | ทำอะไร |
| --- | --- |
| `deploy.bat` → `deploy.ps1` | build + `docker compose up -d --build` + **ตรวจผลปลายทางจริงกว่า 20 ข้อ** |
| `backup.bat` → `backup.ps1` | สำรอง `data/` (volume `app_data`) + `.env` |
| `use-cloudflare.bat` | ทางเข้า: token ของ tunnel (ไม่ขึ้นจอ) → ตรวจจากข้างนอก → ย้าย LINE webhook แบบทดสอบก่อน → ปิด Funnel |
| `install-autostart.bat` | รันเป็น admin ครั้งเดียว — backup รายวัน + เอาตัวเปิด Funnel เดิมออกจาก Startup |
| `enable-funnel.bat` · `startup-funnel.bat` | ทางสำรองเดิม (Funnel) — ไม่มีอะไรเรียกแล้ว ใช้ด้วย `deploy.bat -Funnel` |
| `console-utf8.ps1` | ให้หน้าต่าง cmd แสดงภาษาไทยได้ — สคริปต์อื่น dot-source ตัวนี้ก่อนเสมอ |

container `tunnel` ขึ้นเองพร้อม Docker Desktop (ต้องตั้งให้ Docker Desktop เปิดตอนล็อกอิน)
เรื่อง Funnel ค้างเงียบ (ทางเดิม) อยู่ที่ `LINE_SETUP.md` §3.1
