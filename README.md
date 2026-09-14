# IT Admin — ระบบจัดการ IT Support Ticket / ทรัพย์สิน / สต็อก

โปรเจกต์นี้ clone มาจากการวิเคราะห์ UX/UI และโครงสร้างข้อมูลของ `it-support-admin.vercel.app`
(รายละเอียดการวิเคราะห์ทั้งหมดอยู่ใน Project doc `it-support-admin-analysis.md`) โดยขยายขอบเขตเพิ่มจากต้นแบบ 2 จุดตามที่ตกลงกันไว้:

1. **เพิ่มระบบ Login/Auth จริง** (ต้นแบบไม่มีระบบยืนยันตัวตนเลย — เป็นช่องโหว่ด้านความปลอดภัยที่เปิดให้ใครก็เข้าถึงข้อมูลได้)
2. **สร้าง LINE OA Bot + LIFF mini-app แบบเต็มรูปแบบ** สำหรับให้พนักงานแจ้งปัญหา/สร้าง ticket จากภายนอกระบบแอดมิน (ต้นแบบไม่มีปุ่ม "สร้าง Ticket" ในหน้าแอดมินเลย แสดงว่า ticket ทั้งหมดถูกสร้างจากช่องทางอื่น)

สถานะปัจจุบัน: **รันด้วย mock data (ไฟล์ JSON ในโฟลเดอร์ `data/`) ยังไม่ได้ต่อ Supabase จริง** — ดูหัวข้อ
["ย้ายจาก mock data ไป Supabase"](#ย้ายจาก-mock-data-ไป-supabase) ด้านล่างเพื่อ migrate ต่อ

## Tech Stack

| ส่วน | เทคโนโลยี |
| --- | --- |
| Framework | Next.js 16 (App Router, React 19, Server Actions) |
| ภาษา | TypeScript |
| Styling | Tailwind CSS v4 (CSS-first config, ไม่มี `tailwind.config.js`) |
| Auth | Session cookie + JWT (`jose`) เซ็นเอง, hash รหัสผ่านด้วย `bcryptjs` |
| Data (ปัจจุบัน) | Mock data เก็บเป็นไฟล์ JSON ผ่าน adapter เดียว (`src/lib/db/store.ts`) |
| Data (เป้าหมาย) | Supabase (Postgres + Auth + Storage) — schema พร้อมอยู่ใน Project doc |
| LINE Integration | LINE Messaging API (webhook) + LIFF (`@line/liff`) |
| Excel Import | `xlsx` (SheetJS) — ⚠️ ดูหมายเหตุความปลอดภัยด้านล่าง |

> ⚠️ Next.js 16 มี breaking changes จากเวอร์ชันเก่าพอสมควร (เช่น `middleware.ts` → `proxy.ts`) ถ้าจะแก้โค้ด
> เกี่ยวกับ routing/caching/auth ให้อ่าน `node_modules/next/dist/docs/` ก่อนเสมอ (มีคำเตือนไว้ใน `AGENTS.md` แล้ว)

## เริ่มต้นใช้งาน

```bash
npm install
cp .env.example .env.local   # แล้วแก้ค่าตามหัวข้อ "ตัวแปรสภาพแวดล้อม" ด้านล่าง
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

รหัสผ่านนี้ hash ไว้ในข้อมูล seed ที่ `src/lib/db/staff.ts` — **ต้องเปลี่ยนก่อนใช้งานจริงเสมอ**
(ลบไฟล์ `data/staff_accounts.json` แล้วแก้ `SEED_PASSWORD` ในไฟล์นั้น หรือเพิ่ม flow "เปลี่ยนรหัสผ่าน" เพิ่มเติม)

ครั้งแรกที่รัน ระบบจะสร้างโฟลเดอร์ `data/` และ seed ข้อมูลตัวอย่างให้อัตโนมัติ (ดูใน `.gitignore` — โฟลเดอร์นี้ไม่ถูก commit)

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
    db/                    Repository ต่อ collection (users, equipment, tickets, stock, faq, staff)
    db/store.ts             Adapter เดียวที่แตะไฟล์ JSON จริง — จุดเดียวที่ต้องแก้ตอนย้ายไป Supabase
    line/                  LINE client, signature verification, FAQ-bot logic
    auth.ts                Session/JWT helpers
    types.ts                Domain types ทั้งหมด
proxy.ts                  Next.js 16 middleware (เดิมชื่อ middleware.ts) — เช็ค session cookie แบบ optimistic
data/                     Mock data (JSON) — สร้างอัตโนมัติ, ไม่ commit
```

## ระบบ Auth ทำงานอย่างไร

- Login ผ่าน Server Action (`src/app/actions/auth.ts`) → เช็ค username/password กับ `staff_accounts` (bcrypt) → เซ็น JWT ใส่ cookie `itadmin_session` (httpOnly, secure ใน production, sameSite=lax, อายุ 7 วัน)
- `proxy.ts` เช็คแค่ว่า "มี cookie อยู่ไหม" (optimistic check) เพื่อ redirect เร็วๆ — **ไม่ได้ verify JWT จริงที่ชั้นนี้** เพราะ Next.js แนะนำให้ตรวจสิทธิ์จริงใกล้จุด access ข้อมูลมากกว่า
- ทุกหน้าใน `(dashboard)/layout.tsx` และทุก Server Action ที่แก้ข้อมูล เรียก `requireSession()` (`src/lib/auth.ts`) ซึ่ง verify JWT จริงอีกชั้น — ถ้า JWT ไม่ถูกต้อง/หมดอายุจะ redirect ไป `/login` ทันที
- หน้า public (ไม่ต้อง login): `/login`, `/liff/*`, `/api/line/webhook` — กำหนดไว้ใน `PUBLIC_PATHS` ของ `proxy.ts`

## การตั้งค่า LINE OA Bot

ต้องมี LINE Business Account + LINE Developers Console (ฟรี) ทำตามนี้:

1. ไปที่ [LINE Developers Console](https://developers.line.biz/console/) → สร้าง Provider (ถ้ายังไม่มี) → สร้าง **Messaging API Channel**
2. ในหน้า channel ที่สร้าง: แท็บ "Basic settings" จะมี **Channel secret** และแท็บ "Messaging API" จะมีปุ่มออก **Channel access token (long-lived)** — copy ทั้งสองค่าไปใส่ใน `.env.local` (`LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`)
3. Deploy โปรเจกต์นี้ให้มี URL จริง (เช่น Vercel) แล้วนำ URL ไปตั้งใน "Webhook URL" ของแท็บ Messaging API เป็น `https://<โดเมน>/api/line/webhook` แล้วกด **Verify** (ปุ่มนี้จะยิง GET เข้ามา — route รองรับไว้แล้ว) จากนั้นเปิด **Use webhook**
4. ปิด "Auto-reply messages" และ "Greeting messages" ของ LINE Official Account เริ่มต้น (ในหน้า [OA Manager](https://manager.line.biz/)) ไม่งั้นจะชนกับข้อความที่บอทของเราตอบเอง
5. สร้าง **LIFF app** ในแท็บ "LIFF" ของ channel เดียวกัน: Size = `Full`, Endpoint URL = `https://<โดเมน>/liff/new-ticket` → copy **LIFF ID** ไปใส่ `NEXT_PUBLIC_LIFF_ID` ใน `.env.local` (ต้อง rebuild หลังแก้ค่านี้ เพราะเป็น build-time env)

**พฤติกรรมของบอท** (`src/lib/line/faq-bot.ts`): เมื่อพนักงานพิมพ์อาการปัญหาเข้ามา บอทจะจับคู่ keyword กับ FAQ
ในระบบก่อนเสมอ (`matchFaqByKeyword`) ถ้าเจอจะตอบวิธีแก้เบื้องต้น พร้อมปุ่มลิงก์ไปหน้า LIFF ให้แจ้งปัญหาต่อถ้ายังไม่หาย
ถ้าไม่เจอ FAQ ที่ตรงกันเลยก็จะส่งปุ่มลิงก์ไปหน้าเดียวกันทันที — **การสร้าง ticket จริงเกิดที่หน้า LIFF เท่านั้น**
(ตั้งใจออกแบบตามที่สังเกตจากต้นแบบ ไม่ให้บอทพยายามแกะรายละเอียด ticket จากข้อความแชทซึ่งแม่นยำน้อยกว่าฟอร์ม)

ถ้ายังไม่ได้ตั้งค่า `NEXT_PUBLIC_LIFF_ID` หน้า `/liff/new-ticket` จะ**ไม่ล่ม** — ระบบ fallback เป็นฟอร์มให้กรอกชื่อผู้แจ้งเอง
แทนการดึงชื่อจาก LINE Profile อัตโนมัติ ทำให้ทดสอบฟอร์มได้แม้ยังไม่มี LINE channel จริง (เปิด URL ตรงๆ ในเบราว์เซอร์ปกติได้เลย)

## ย้ายจาก Mock Data ไป Supabase

ทุกไฟล์ใน `src/lib/db/*.ts` (ยกเว้น `store.ts`) เรียกผ่านฟังก์ชันของ `store.ts` เท่านั้น ไม่แตะ `fs` ตรงๆ
ดังนั้นตอนย้ายจริงแค่เขียน adapter ใหม่ที่ implement signature เดียวกัน (`readCollection`, `writeCollection`, `upsertOne`, `patchOne`)
โดยคุยกับ Supabase client แทนไฟล์ JSON แล้วสลับ import — **ไม่ต้องแก้โค้ดฝั่ง UI/Server Action เลย**

SQL schema ที่ออกแบบไว้ให้ตรงกับ mock data ทุกตาราง (รวม `equipment_summary` view) อยู่ใน Project doc
`it-support-admin-analysis.md` — สร้างตารางใน Supanse ตาม schema นั้น แล้วเพิ่ม RLS policy ผูกกับ role ทีม IT ก่อนขึ้น production เสมอ (ต้นแบบไม่มี Auth/RLS เลย เป็นความเสี่ยงหลักที่พบตอนวิเคราะห์)

ไฟล์รูปที่อัปโหลดจากฟอร์ม FAQ ตอนนี้เซฟลง `public/uploads/faq/` ตรงๆ (ไม่ใช่ base64 ในไฟล์ JSON) —
ตอนย้ายไป Supabase ให้เปลี่ยนไปใช้ Supabase Storage bucket แทน (โครงสร้าง URL คล้ายกัน ปรับ `saveImages()` ใน
`src/app/actions/faq.ts` จุดเดียว)

## ตัวแปรสภาพแวดล้อม

ดู `.env.example` — สรุปสั้นๆ:

| ตัวแปร | จำเป็นตอนไหน | หมายเหตุ |
| --- | --- | --- |
| `SESSION_SECRET` | เสมอ (ก่อน production) | ถ้าไม่ตั้ง จะ fallback เป็นค่า insecure สำหรับ dev เท่านั้น |
| `LINE_CHANNEL_SECRET` | ใช้ LINE Bot | verify signature ของ webhook |
| `LINE_CHANNEL_ACCESS_TOKEN` | ใช้ LINE Bot | เรียก LINE Messaging API (reply/push/profile) |
| `NEXT_PUBLIC_LIFF_ID` | ใช้ LIFF auto-login | build-time env — ต้อง rebuild หลังแก้ |

## สิ่งที่ควรทำต่อก่อนขึ้น production (ติเพื่อก่อ)

รายการนี้คือช่องว่างที่รู้ตัวและตั้งใจปล่อยไว้ตามสโคปที่ตกลงกัน (mock data + POC) ไม่ใช่ของที่ลืมทำ:

1. **ยังไม่ได้ต่อ Supabase จริง** — ข้อมูลทั้งหมดอยู่ในไฟล์ JSON local ห้ามใช้ deploy จริงแบบนี้ (deploy บน serverless เช่น Vercel แล้ว filesystem จะไม่ persist ข้ามแต่ละ request/instance ด้วย)
2. **`xlsx` (SheetJS) มีช่องโหว่ระดับ High ที่ยังไม่มี patch บน npm** (Prototype Pollution + ReDoS — `npm audit` เห็นได้) ความเสี่ยงจำกัดเพราะเป็นฟีเจอร์ Import Excel ที่ใช้ได้เฉพาะแอดมินที่ login แล้ว แต่ถ้าจะขึ้น production จริงควรพิจารณาย้ายไป `exceljs` หรือ sanitize ไฟล์ก่อน parse
3. **`stock_items.category` ยังเป็น free text** (ไม่ใช่ enum เหมือน `equipment.category`) ตามที่สังเกตจากต้นแบบ — ปล่อยให้เหมือนต้นแบบไว้ก่อนตามที่ตกลง scope "เหมือนทุกรูปแบบ" แต่ถ้าจะแก้ในอนาคตควร normalize เป็น enum/lookup table
4. **การผูกผู้ครอบครองทรัพย์สิน/ผู้แจ้งจาก LIFF (โหมด manual) ยังเป็นการพิมพ์ชื่ออิสระ** (`findOrCreateUserByName`) เหมือนต้นแบบ — เสี่ยงสร้าง user ซ้ำถ้าพิมพ์ชื่อไม่ตรงกันทุกตัวอักษร ควรทำ autocomplete จาก users ที่มีอยู่ในอนาคต
5. **รหัสผ่านบัญชีทดสอบยังเป็นค่า default ที่รู้กันทั่วไป** (`ITadmin@2026`) — เปลี่ยนก่อน deploy จริงเสมอ และควรมีหน้า "จัดการบัญชีแอดมิน" เพิ่มถ้ามีผู้ใช้หลายคน (ตอนนี้ seed ไว้แค่ 1 บัญชี)
6. **ยังไม่มี rate limiting / retry queue บน webhook** — ถ้า LINE ยิง event รัวๆ (เช่น broadcast) endpoint นี้ประมวลผล sync ทั้งหมด ถ้าจะรับโหลดสูงควรใส่ queue (เช่น Upstash QStash) คั่นกลาง

## คำสั่งที่ใช้บ่อย

```bash
npm run dev      # dev server (Turbopack)
npm run build    # production build — ควรรันก่อน deploy ทุกครั้งเพื่อจับ type error/route error
npm run start    # รัน production build ที่ build ไว้แล้ว
npm run lint     # ESLint
```
