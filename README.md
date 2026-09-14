# IT Admin — ระบบจัดการ IT Support Ticket / ทรัพย์สิน / สต็อก

โปรเจกต์นี้ clone มาจากการวิเคราะห์ UX/UI และโครงสร้างข้อมูลของ `it-support-admin.vercel.app`
(รายละเอียดการวิเคราะห์ทั้งหมดอยู่ใน Project doc `it-support-admin-analysis.md`) โดยขยายขอบเขตเพิ่มจากต้นแบบ 2 จุดตามที่ตกลงกันไว้:

1. **เพิ่มระบบ Login/Auth จริง** (ต้นแบบไม่มีระบบยืนยันตัวตนเลย — เป็นช่องโหว่ด้านความปลอดภัยที่เปิดให้ใครก็เข้าถึงข้อมูลได้)
2. **สร้าง LINE OA Bot + LIFF mini-app แบบเต็มรูปแบบ** สำหรับให้พนักงานแจ้งปัญหา/สร้าง ticket จากภายนอกระบบแอดมิน (ต้นแบบไม่มีปุ่ม "สร้าง Ticket" ในหน้าแอดมินเลย แสดงว่า ticket ทั้งหมดถูกสร้างจากช่องทางอื่น)

สถานะปัจจุบัน: **รันจริงบน PostgreSQL 16 ใน Docker พร้อม HTTPS + โดเมนของตัวเอง** — ดูหัวข้อ
["Deploy ด้วย Docker + โดเมน"](#deploy-ด้วย-docker--โดเมน) ด้านล่าง

## Tech Stack

| ส่วน | เทคโนโลยี |
| --- | --- |
| Framework | Next.js 16 (App Router, React 19, Server Actions) |
| ภาษา | TypeScript |
| Styling | Tailwind CSS v4 (CSS-first config, ไม่มี `tailwind.config.js`) |
| Auth | Session cookie + JWT (`jose`) เซ็นเอง, hash รหัสผ่านด้วย `bcryptjs` |
| Data | PostgreSQL 16 (self-hosted ใน Docker) ผ่าน adapter เดียว (`src/lib/db/store.ts`) |
| Deploy | Docker Compose — Next.js (standalone) + Postgres + Caddy (HTTPS) + DuckDNS |
| LINE Integration | LINE Messaging API (webhook) + LIFF (`@line/liff`) |
| Excel Import | `xlsx` (SheetJS) — ⚠️ ดูหมายเหตุความปลอดภัยด้านล่าง |

> ⚠️ Next.js 16 มี breaking changes จากเวอร์ชันเก่าพอสมควร (เช่น `middleware.ts` → `proxy.ts`) ถ้าจะแก้โค้ด
> เกี่ยวกับ routing/caching/auth ให้อ่าน `node_modules/next/dist/docs/` ก่อนเสมอ (มีคำเตือนไว้ใน `AGENTS.md` แล้ว)

## เริ่มต้นใช้งาน

วิธีที่เร็วที่สุดคือรันทั้งชุดด้วย Docker (ได้ Postgres + HTTPS + โดเมนมาพร้อมกัน) — ดูหัวข้อ
[Deploy ด้วย Docker + โดเมน](#deploy-ด้วย-docker--โดเมน) ด้านล่าง

ถ้าจะพัฒนาแบบ hot-reload บนเครื่องตัวเอง ยังต้องมี Postgres ให้ต่อ วิธีที่ง่ายสุดคือยืมตัวที่รันใน Docker อยู่แล้ว:

```bash
npm install
docker compose up -d db       # เปิดเฉพาะฐานข้อมูล (เปิดที่ 127.0.0.1:5434)
cp .env.example .env.local    # แล้วแก้ค่าตามหัวข้อ "ตัวแปรสภาพแวดล้อม" ด้านล่าง
# ใน .env.local ต้องเปลี่ยน host ของ DATABASE_URL จาก "db" เป็น "localhost:5434"
# เพราะชื่อ "db" รู้จักกันเฉพาะภายใน network ของ compose เท่านั้น
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000) — ระบบจะพาไปหน้า `/login` อัตโนมัติเพราะยังไม่มี session

> ⚠️ `npm run build` ต้องมีอินเทอร์เน็ตเข้าถึง `fonts.googleapis.com` ได้ (โหลดฟอนต์ Sarabun/Space Mono ผ่าน
> `next/font/google`) ถ้า build ในเครื่อง/CI ที่ปิด network ไว้จะ error ตรงจุดนี้ — แก้ได้โดยเปิด network หรือเปลี่ยนไปโหลด
> ฟอนต์ผ่าน `next/font/local` แทน (ดาวน์โหลดไฟล์ฟอนต์มาเก็บในโปรเจกต์เอง) ที่ `src/app/layout.tsx`

**บัญชีทดสอบ:**

| Username | Password |
| --- | --- |
| `admin` | `ITadmin@2026` |

รหัสผ่านนี้ hash ไว้ในข้อมูล seed ที่ `src/lib/db/staff.ts` — **ต้องเปลี่ยนก่อนใช้งานจริงเสมอ** เช่น:

```bash
# สร้าง hash ใหม่
docker compose exec app node -e "console.log(require('bcryptjs').hashSync('รหัสผ่านใหม่', 10))"
# แล้วเอาไปอัปเดตในตาราง
docker compose exec db psql -U itadmin -d itadmin \
  -c "UPDATE staff_accounts SET password_hash = 'ค่า hash ที่ได้' WHERE username = 'admin';"
```

ครั้งแรกที่เปิดแต่ละหน้า ระบบจะ seed ข้อมูลตัวอย่างลงตารางที่ยังว่างให้อัตโนมัติ และจดไว้ในตาราง `_seed_state`
ว่า seed ไปแล้ว — ถ้าแอดมินลบข้อมูลทิ้งเองภายหลัง ข้อมูลตัวอย่างจะ**ไม่**ย้อนกลับมา

## โครงสร้างโปรเจกต์

```
src/
  app/
    (dashboard)/          หน้าแอดมินทั้งหมด (ต้อง login) — layout เดียวคุม TopNav
      page.tsx             ภาพรวม (Overview)
      tickets/              Tickets
      assets/                ทรัพย์สิน
      custodian/             ผู้ครอบครอง (read-only)
      repair-history/        ประวัติซ่อม
      stock/                 สต็อก + stock/transactions
      faq/                   FAQ Bot
    login/                 หน้า login (public)
    liff/new-ticket/       ฟอร์มแจ้ง ticket สำหรับพนักงาน เปิดจาก LINE (public)
    api/line/webhook/      LINE Messaging API webhook (public)
    actions/               Server Actions ทั้งหมด (auth, tickets, equipment, stock, faq, liff)
  components/              UI components แยกตามโมดูล (ui/, nav/, tickets/, assets/, stock/, faq/, liff/)
  lib/
    db/                    Repository ต่อตาราง (users, equipment, tickets, stock, faq, staff)
    db/pg.ts                Postgres connection pool (สร้างแบบ lazy — ดูคอมเมนต์ในไฟล์)
    db/store.ts             Adapter เดียวที่ยิง SQL จริง — repository ตัวอื่นเรียกผ่านไฟล์นี้เท่านั้น
    line/                  LINE client, signature verification, FAQ-bot logic
    auth.ts                Session/JWT helpers
    types.ts                Domain types ทั้งหมด
proxy.ts                  Next.js 16 middleware (เดิมชื่อ middleware.ts) — เช็ค session cookie แบบ optimistic
db/init/001_schema.sql    Schema ของ Postgres — รันอัตโนมัติครั้งเดียวตอนสร้าง DB ใหม่
Dockerfile                Build แอป Next.js เป็น standalone image
caddy/Dockerfile          Build Caddy + ปลั๊กอิน DNS ของ DuckDNS (สำหรับออกใบรับรองแบบ DNS-01)
Caddyfile                 ตั้งค่า reverse proxy + HTTPS
docker-compose.yml        ประกอบ 4 service เข้าด้วยกัน (app, db, caddy, duckdns)
```

## ระบบ Auth ทำงานอย่างไร

- Login ผ่าน Server Action (`src/app/actions/auth.ts`) → เช็ค username/password กับ `staff_accounts` (bcrypt) → เซ็น JWT ใส่ cookie `itadmin_session` (httpOnly, secure ใน production, sameSite=lax, อายุ 7 วัน)
- `proxy.ts` เช็คแค่ว่า "มี cookie อยู่ไหม" (optimistic check) เพื่อ redirect เร็วๆ — **ไม่ได้ verify JWT จริงที่ชั้นนี้** เพราะ Next.js แนะนำให้ตรวจสิทธิ์จริงใกล้จุด access ข้อมูลมากกว่า
- ทุกหน้าใน `(dashboard)/layout.tsx` และทุก Server Action ที่แก้ข้อมูล เรียก `requireSession()` (`src/lib/auth.ts`) ซึ่ง verify JWT จริงอีกชั้น — ถ้า JWT ไม่ถูกต้อง/หมดอายุจะ redirect ไป `/login` ทันที
- หน้า public (ไม่ต้อง login): `/login`, `/liff/*`, `/api/line/webhook` — กำหนดไว้ใน `PUBLIC_PATHS` ของ `proxy.ts`

## การตั้งค่า LINE OA Bot

ขั้นตอนล่าสุดและค่าที่ใช้กับบัญชีนี้อยู่ใน [LINE_SETUP.md](./LINE_SETUP.md) สรุปโครงสร้างคือ:

1. สร้าง LINE OA ใน [OA Manager](https://manager.line.biz/) แล้วเปิด **Messaging API** โดยเลือก Provider ที่ต้องการ
2. จาก Messaging API channel เก็บ `LINE_CHANNEL_SECRET` และออก `LINE_CHANNEL_ACCESS_TOKEN`
3. ตั้ง Webhook URL เป็น `https://<โดเมน>/api/line/webhook` กด **Verify** และเปิด **Use webhook** ปุ่ม Verify จะส่ง `POST` ที่มี `events: []`
4. ปิด Auto-response และ Greeting message ของ OA เพื่อไม่ให้ตอบซ้ำกับบอท
5. สร้าง **LINE Login channel** ใน Provider เดียวกัน ผูก OA ที่ Basic settings แล้วเก็บ `LINE_LOGIN_CHANNEL_ID`
6. สร้าง LIFF app ใน LINE Login channel โดยใช้ scope `openid` + `profile` แล้วใส่ LIFF ID ใน `NEXT_PUBLIC_LIFF_ID`

LIFF app ใหม่ไม่สามารถสร้างใน Messaging API channel ได้ และฝั่ง server จะตรวจ ID token กับ LINE
ก่อนเชื่อ `userId` หรือสร้าง Ticket

**พฤติกรรมของบอท** (`src/lib/line/faq-bot.ts`): เมื่อพนักงานพิมพ์อาการปัญหาเข้ามา บอทจะจับคู่ keyword กับ FAQ
ในระบบก่อนเสมอ (`matchFaqByKeyword`) ถ้าเจอจะตอบวิธีแก้เบื้องต้น พร้อมปุ่มลิงก์ไปหน้า LIFF ให้แจ้งปัญหาต่อถ้ายังไม่หาย
ถ้าไม่เจอ FAQ ที่ตรงกันเลยก็จะส่งปุ่มลิงก์ไปหน้าเดียวกันทันที — **การสร้าง ticket จริงเกิดที่หน้า LIFF เท่านั้น**
(ตั้งใจออกแบบตามที่สังเกตจากต้นแบบ ไม่ให้บอทพยายามแกะรายละเอียด ticket จากข้อความแชทซึ่งแม่นยำน้อยกว่าฟอร์ม)

ถ้ายังไม่ได้ตั้งค่า `NEXT_PUBLIC_LIFF_ID` หน้า `/liff/new-ticket` จะ fallback เป็นฟอร์มกรอกชื่อเพื่อใช้
เฉพาะช่วงพัฒนา เมื่อเริ่มตั้งค่า LIFF แล้ว server จะไม่ยอมรับโหมด manual และต้องยืนยัน ID token จาก LINE

## Deploy ด้วย Docker + โดเมน

`docker compose up -d` เปิด 4 service:

| Service | หน้าที่ | Port ที่เปิดออกจากเครื่อง |
| --- | --- | --- |
| `db` | PostgreSQL 16 — ข้อมูลอยู่ใน volume `pgdata` | `127.0.0.1:5434` (เฉพาะเครื่องนี้ ไว้ debug) |
| `app` | Next.js standalone | `127.0.0.1:3000` (เฉพาะเครื่องนี้ ไว้ทดสอบ) |
| `caddy` | reverse proxy + ออก/ต่ออายุใบรับรอง HTTPS ให้อัตโนมัติ | `443` (TCP+UDP), `8080` |
| `duckdns` | อัปเดต IP สาธารณะของโดเมนให้ทุก 5 นาที (กัน IP บ้าน/ออฟฟิศเปลี่ยน) | — |

```bash
cp .env.example .env    # กรอก DOMAIN, DUCKDNS_*, POSTGRES_PASSWORD, DATABASE_URL, SESSION_SECRET
docker compose up -d --build
docker compose logs -f caddy   # ดูว่าออกใบรับรองสำเร็จไหม
```

**เรื่องใบรับรอง HTTPS:** Caddy ขอใบรับรองแบบ **DNS-01** (สร้าง TXT record ผ่าน DuckDNS API ด้วย
`DUCKDNS_TOKEN`) ไม่ใช่ HTTP-01 แบบ default เพราะ HTTP-01 บังคับว่า Let's Encrypt ต้องต่อเข้า port 80
ของเครื่องนี้จากอินเทอร์เน็ตได้ ซึ่งบน Windows port 80 มักถูก `http.sys` จับไว้อยู่แล้ว — DNS-01
ไม่ต้องเปิด port ขาเข้าเลย ข้อแลกเปลี่ยนคือ image ของ Caddy ต้อง build เองเพื่อใส่ปลั๊กอิน
`caddy-dns/duckdns` เข้าไป (ดู `caddy/Dockerfile`)

**สิ่งที่ต้องตั้งค่าที่เราเตอร์เอง (นอกเหนือจาก Docker):** forward **TCP/UDP port 443** จาก WAN
มาที่ IP ภายในของเครื่องนี้ ถ้าไม่ทำ ระบบจะยังใช้งานได้ปกติจากในวง LAN (และผ่าน VPN เช่น Tailscale)
แต่จะเปิดจากอินเทอร์เน็ตภายนอกไม่ได้ — ตรวจสอบด้วย:

```bash
curl -I https://<โดเมนของคุณ>/login     # ต้องได้ HTTP 200 จากเครือข่ายนอกบ้าน
```

**หมายเหตุเรื่องข้อมูล:** ข้อมูลทั้งหมดอยู่ใน docker volume (`pgdata`, `uploads`) ไม่ได้อยู่ในโฟลเดอร์โปรเจกต์
คำสั่ง `docker compose down -v` จะ**ลบข้อมูลทั้งหมดทิ้ง** ให้ใช้ `docker compose down` เฉยๆ เวลาจะหยุดระบบ
และควรตั้ง backup ด้วย `pg_dump` (ดูหัวข้อ "คำสั่งที่ใช้บ่อย")

### การเปลี่ยน schema ของฐานข้อมูล

`db/init/001_schema.sql` รันอัตโนมัติ**ครั้งเดียว**ตอน volume `pgdata` ยังว่างเท่านั้น — แก้ไฟล์นี้แล้ว
restart เฉยๆ จะไม่มีผล ถ้าต้องแก้ schema ของระบบที่มีข้อมูลอยู่แล้วให้เขียน `ALTER TABLE` แล้วรันเอง
(`docker compose exec db psql -U itadmin -d itadmin -f -`) หรือถ้ายังเป็นช่วงพัฒนาและข้อมูลทิ้งได้
ก็ล้าง volume แล้วขึ้นใหม่ได้เลย

### ไฟล์รูปจากฟอร์ม FAQ

รูปถูกเซฟลงดิสก์จริงที่ `public/uploads/faq/` ซึ่งผูกกับ volume `uploads` ไว้แล้ว จึงไม่หายตอน build image ใหม่
ถ้าจะขยายเป็นหลาย instance ในอนาคต ควรย้ายไป object storage (เช่น S3/MinIO ที่มีอยู่แล้วบนเครื่องนี้)
โดยแก้แค่ `saveImages()` ใน `src/app/actions/faq.ts` จุดเดียว

## ตัวแปรสภาพแวดล้อม

ดู `.env.example` — สรุปสั้นๆ:

| ตัวแปร | จำเป็นตอนไหน | หมายเหตุ |
| --- | --- | --- |
| `DATABASE_URL` | เสมอ | ต่อ Postgres — host คือ `db` เมื่อรันใน compose, `localhost:5434` เมื่อรัน `npm run dev` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | เสมอ | ใช้สร้าง DB ตอน container ขึ้นครั้งแรก ต้องตรงกับ `DATABASE_URL` |
| `SESSION_SECRET` | เสมอ (ก่อน production) | ถ้าไม่ตั้ง จะ fallback เป็นค่า insecure สำหรับ dev เท่านั้น |
| `DOMAIN` | ใช้ Caddy | โดเมนที่จะออกใบรับรอง HTTPS ให้ เช่น `xxx.duckdns.org` |
| `DUCKDNS_SUBDOMAIN` | ใช้ Caddy/DuckDNS | ส่วนหน้า `.duckdns.org` — ใช้อัปเดต IP ให้โดเมน |
| `DUCKDNS_TOKEN` | ใช้ Caddy/DuckDNS | token จาก duckdns.org ใช้ทั้งอัปเดต IP และตอบ DNS-01 challenge |
| `LINE_CHANNEL_SECRET` | ใช้ LINE Bot | verify signature ของ webhook |
| `LINE_CHANNEL_ACCESS_TOKEN` | ใช้ LINE Bot | เรียก LINE Messaging API (reply/push/profile) |
| `LINE_LOGIN_CHANNEL_ID` | ใช้ LIFF | ตรวจ ID token ฝั่ง server ต้องเป็น Channel ID ของ LINE Login ไม่ใช่ Messaging API |
| `NEXT_PUBLIC_LIFF_ID` | ใช้ LIFF auto-login | build-time env — ต้อง rebuild หลังแก้ |

## สิ่งที่ควรทำต่อก่อนขึ้น production (ติเพื่อก่อ)

รายการนี้คือช่องว่างที่รู้ตัวและตั้งใจปล่อยไว้ ไม่ใช่ของที่ลืมทำ:

1. **ยังไม่มีระบบ backup อัตโนมัติ** — ข้อมูลอยู่ใน docker volume `pgdata` บนเครื่องเดียว ถ้าดิสก์เสียคือหายหมด ควรตั้ง `pg_dump` แบบตั้งเวลา (Task Scheduler) แล้วส่งไฟล์ออกไปเก็บนอกเครื่อง
2. **`xlsx` (SheetJS) มีช่องโหว่ระดับ High ที่ยังไม่มี patch บน npm** (Prototype Pollution + ReDoS — `npm audit` เห็นได้) ความเสี่ยงจำกัดเพราะเป็นฟีเจอร์ Import Excel ที่ใช้ได้เฉพาะแอดมินที่ login แล้ว แต่ถ้าจะขึ้น production จริงควรพิจารณาย้ายไป `exceljs` หรือ sanitize ไฟล์ก่อน parse
3. **`stock_items.category` ยังเป็น free text** (ไม่ใช่ enum เหมือน `equipment.category`) ตามที่สังเกตจากต้นแบบ — ปล่อยให้เหมือนต้นแบบไว้ก่อนตามที่ตกลง scope "เหมือนทุกรูปแบบ" แต่ถ้าจะแก้ในอนาคตควร normalize เป็น enum/lookup table
4. **โหมด manual ของ LIFF มีไว้ทดสอบก่อนตั้งค่า LINE เท่านั้น** — เมื่อมี `NEXT_PUBLIC_LIFF_ID` หรือ `LINE_LOGIN_CHANNEL_ID` แล้ว server จะบังคับใช้ ID token จาก LINE
5. **รหัสผ่านบัญชีทดสอบยังเป็นค่า default ที่รู้กันทั่วไป** (`ITadmin@2026`) — เปลี่ยนก่อน deploy จริงเสมอ และควรมีหน้า "จัดการบัญชีแอดมิน" เพิ่มถ้ามีผู้ใช้หลายคน (ตอนนี้ seed ไว้แค่ 1 บัญชี)
6. **ยังไม่มี rate limiting / retry queue บน webhook** — ถ้า LINE ยิง event รัวๆ (เช่น broadcast) endpoint นี้ประมวลผล sync ทั้งหมด ถ้าจะรับโหลดสูงควรใส่ queue (เช่น Upstash QStash) คั่นกลาง

## คำสั่งที่ใช้บ่อย

```bash
npm run dev      # dev server (Turbopack)
npm run build    # production build — ควรรันก่อน deploy ทุกครั้งเพื่อจับ type error/route error
npm run start    # รัน production build ที่ build ไว้แล้ว
npm run lint     # ESLint
```

Docker:

```bash
docker compose up -d --build      # build + รันทั้งระบบ
docker compose ps                 # ดูสถานะทุก service
docker compose logs -f app        # ดู log ของแอป (caddy / db / duckdns ก็ได้)
docker compose restart app        # restart เฉพาะแอป (ใช้เมื่อแก้ env ที่ไม่ใช่ NEXT_PUBLIC_*)
docker compose build app && docker compose up -d app   # หลังแก้โค้ด หรือแก้ NEXT_PUBLIC_LIFF_ID
docker compose down               # หยุดระบบ (ข้อมูลยังอยู่)

# เข้า psql
docker compose exec db psql -U itadmin -d itadmin

# backup / restore
docker compose exec -T db pg_dump -U itadmin itadmin > backup-$(date +%F).sql
docker compose exec -T db psql -U itadmin -d itadmin < backup-2026-09-14.sql
```
