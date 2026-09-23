# ตั้งค่า LINE Official Account ให้พนักงานใช้งานได้จริง

คู่มือนี้ใช้กับโปรเจกต์ `it-support-admin` และบัญชี LINE OA **IT-Support-Admin** (`@891ujhzo`)

> **อ่านก่อน:** เอกสารฉบับก่อนหน้าล้าสมัยไปแล้ว มันบอกว่า Webhook URL คือ `/api/line/webhook`
> (บอท TypeScript) และบอกว่ายังไม่ได้ออก access token ซึ่งทั้งสองข้อไม่จริงแล้ว
> ระบบที่รันอยู่จริงใช้ **บอท Python** ที่ `/webhook` และมี token ครบแล้ว

---

## 1. สถานะจริง ณ ตอนนี้

### ✅ ทำงานแล้ว (ตรวจสอบจริงแล้ว ไม่ใช่แค่อ่านโค้ด)

| รายการ | สถานะ |
| --- | --- |
| Messaging API Channel | `2011597498` · basicId `@891ujhzo` · `chatMode: bot` |
| Webhook URL | `https://win-qrb8cpgc62i.taila97ec8.ts.net/webhook` → บอท Python (Verify = Success) |
| ตรวจลายเซ็น HMAC | ลายเซ็นปลอมได้ 401 ถูกต้อง |
| บทสนทนาสร้าง ticket | จบในแชทได้ ไม่ต้องเปิด LIFF |
| ตอบคำถามข้อมูล | สต็อกคงเหลือ / ทรัพย์สินอยู่กับใคร / สถานะ ticket / เรื่องที่ฉันแจ้ง |
| OA Manager | Webhooks เปิด · Chat ปิด · Greeting ปิด · Auto-response ปิด (ถูกต้องทั้งหมด) |
| เทสต์ | unit 51/51 · e2e 41/41 |

### ⏳ ยังไม่ได้ทำ — ต้องทำบนเครื่องคุณเอง

| # | เรื่อง | ผลถ้าไม่ทำ |
| --- | --- | --- |
| 1 | ~~ยังไม่ได้ติดตั้ง rich menu~~ → **อัตโนมัติแล้ว** แค่ `docker compose up -d --build bot` | (แก้แล้ว) |
| 2 | **ยังไม่ได้อัปโหลดรูปโปรไฟล์/หน้าปก/คำอธิบาย** | OA ดูเหมือนบัญชีร้าง คนไม่กล้าทัก |
| 3 | **ยังไม่ได้ Reissue channel secret** | secret เคยปรากฏในภาพ/แชตแล้ว ถือว่ารั่ว |
| 4 | **ยังไม่มีพนักงานจริงใช้เลยสักคน** | ticket 4 ใบที่มาจากบอทเป็นของชุดเทส e2e ทั้งหมด |

### ⚠️ ข้อจำกัดที่ต้องรู้ก่อนเปิดใช้ทั้งบริษัท

- **โควตาแพ็กเกจฟรี = push 300 ข้อความ/เดือน** (ข้อความ *reply* ไม่นับ)
  การแจ้งเตือนสถานะ ticket ใช้โควตานี้ — ค่าตั้งต้นส่งเฉพาะตอนจบเรื่องจึงอยู่ที่ ~1 ข้อความ/ticket
  ดู `LINE_NOTIFY_STATUSES` ใน `.env.example`
- **ระบบอยู่ได้ด้วยเครื่องเดียว** เครื่องนี้ปิด/หลับ = บอทตายทันที (Tailscale Funnel เป็นทางเดียวที่ใช้ได้จริง
  ส่วน DuckDNS+Caddy ยังเข้าจากอินเทอร์เน็ตไม่ได้เพราะยังไม่ได้ forward port 443 ที่เราเตอร์)
- **`AUTH_DISABLED=true`** — หน้าแอดมินเปิดสู่อินเทอร์เน็ตโดยไม่ต้องล็อกอิน ใครมี URL ก็เห็นข้อมูล
  พนักงาน 182 คน ทรัพย์สิน ค่าซ่อม และสต็อกทั้งหมด (เป็นการตัดสินใจของเจ้าของระบบ ไม่ใช่บั๊ก)

---

## 2. ทำให้พร้อมใช้จริง — 3 ขั้นตอน

### ขั้นที่ 1 — rich menu (อัตโนมัติแล้ว ไม่ต้องทำอะไร)

บอทติดตั้ง rich menu ให้เองตอนสตาร์ท แค่รัน:

```powershell
docker compose up -d --build bot
```

ตรวจผลที่ `/health`:

```powershell
curl.exe http://127.0.0.1:8000/health
```

| ค่าที่ได้ในฟิลด์ `richmenu` | แปลว่า |
| --- | --- |
| `installed (richmenu-xxxx)` | เพิ่งติดตั้งสำเร็จ |
| `ok (มีอยู่แล้ว: richmenu-xxxx)` | มีอยู่แล้ว เลยข้าม (ปกติหลัง restart) |
| `ล้มเหลว: ...` | ข้อความต่อท้ายบอกสาเหตุตรงๆ |

> ติดตั้งแล้วยังไม่เห็นเมนู? **ปิดห้องแชทแล้วเปิดใหม่ 1 ครั้ง** — LINE แคชเมนูไว้ฝั่งเครื่อง

**ทำไมถึงย้ายมาทำอัตโนมัติ:** เดิมต้องรัน `python setup_richmenu.py` ด้วยมือ ซึ่งลืมได้ง่าย
และอาการเวลาลืมคือพนักงานแอด OA เข้ามาแล้วเจอห้องแชทเปล่าๆ ไม่มีปุ่มอะไรให้กด —
ดูเหมือนระบบพังสนิททั้งที่บอททำงานปกติ

**ปลอดภัยต่อการ restart:** ถ้าเมนูที่เป็น default อยู่แล้วชื่อตรงกัน จะข้ามไปเลย ไม่สร้างใหม่
(สำคัญเพราะ LINE ให้ 1 แชนแนลมีเมนูได้ 1,000 อัน การสร้างใหม่ทุก restart จะถมจนเต็มโดยไม่มีใครสังเกต)

**เปลี่ยนรูปหรือปุ่ม:** แก้ `line-oa/make_assets.py` → `python make_assets.py` → ตั้ง
`RICHMENU_FORCE_REINSTALL=true` ใน `.env` → `docker compose up -d bot` → เอากลับเป็น `false`

**จัดการด้วยมือ** (ยังใช้ได้เหมือนเดิม):

```powershell
cd F:\GitHub\it-support-admin\line-oa
python setup_richmenu.py --list     # ดูเมนูที่มีอยู่จริง
python setup_richmenu.py --remove   # ถอดออกทั้งหมด
```
(ถ้าจะจัดการเองล้วน ตั้ง `RICHMENU_AUTO_INSTALL=false` ใน `.env` ด้วย)

### ขั้นที่ 2 — หน้าร้านใน OA Manager (LINE ไม่มี API ให้ทำแทน)

เปิด https://manager.line.biz/account/@891ujhzo → ตั้งค่า → ข้อมูลบัญชี
ไฟล์และข้อความที่ต้องใช้เตรียมไว้ครบแล้วใน [`line-oa/README.md`](./line-oa/README.md) หัวข้อ "ขั้นที่ 2"

### ขั้นที่ 3 — Reissue channel secret

secret ชุดปัจจุบันเคยปรากฏในภาพ/แชตแล้ว ก่อนเปิดให้พนักงานใช้จริงควรออกใหม่:

1. https://developers.line.biz/console/ → channel `IT-Support-Admin` → **Basic settings**
2. กด **Issue** ที่ Channel secret
3. แก้ `LINE_CHANNEL_SECRET` ใน `.env` (ไฟล์เดียว ใช้ร่วมกันทั้ง `app` และ `bot`)
4. `docker compose up -d --force-recreate app bot`
5. กด **Verify** ที่ LINE Developers Console อีกครั้งให้ขึ้น Success

> ถ้าลืมข้อ 4 บอทจะเงียบสนิททุกข้อความ เพราะลายเซ็นไม่ผ่าน — เป็นบั๊กที่เคยเจอมาแล้วครั้งหนึ่ง
> และหาสาเหตุยากมาก เพราะทุกอย่างอื่น "ดูปกติ" หมด

---

## 3.1 เมื่อ LINE ต่อ webhook เข้ามาไม่ได้ทั้งที่ทุกอย่าง "ดูปกติ"

อาการที่เจอจริง (2026-09-21): บอท/แอป/Redis รันครบ · `tailscale funnel status` ขึ้น `Funnel on` ·
เรียก `https://<โดเมน>/webhook` จากเครื่องตัวเองได้ 200 · แต่ **ไม่มี webhook เข้ามาเลยทั้งวัน**

> ⚠️ **การเรียก URL สาธารณะจากเครื่องตัวเองไม่พิสูจน์อะไรเลย** — เครื่องนี้มี MagicDNS
> ชื่อโดเมน `.ts.net` จึงถูก resolve เป็น IP ในวง tailnet แล้ววิ่งตรงเข้าเครื่อง
> ไม่ได้ผ่านทางเข้าสาธารณะที่ LINE ใช้จริง

ตัวที่ชี้ขาดได้คือให้ LINE ยิงเองแล้วดูคำตอบ:

```powershell
$env:LINE_TOKEN = (Get-Content .env | Where-Object { $_ -match '^LINE_CHANNEL_ACCESS_TOKEN=' }) -replace '^LINE_CHANNEL_ACCESS_TOKEN=',''
Invoke-WebRequest https://api.line.me/v2/bot/channel/webhook/test -Method POST `
  -Headers @{Authorization="Bearer $env:LINE_TOKEN"} -ContentType 'application/json' -Body '{}' -UseBasicParsing
```

| คำตอบที่ได้ | แปลว่า |
| --- | --- |
| `"success":true,"statusCode":200` | ใช้งานได้จริง |
| `COULD_NOT_CONNECT` + `Connection failed` | ต่อไม่ถึงเครื่องเลย |
| `COULD_NOT_CONNECT` + `Session protocol negotiation failure` | ต่อถึงแต่ TLS เจรจาไม่สำเร็จ |

**วิธีแก้ที่ได้ผลจริง** (ต้นเหตุคือ Funnel ค้างหลังเครื่องเปลี่ยน IP ในวง LAN —
เห็นได้จากบรรทัด `portmap: monitor: gateway and self IP changed` ตอนรัน `tailscale netcheck`):

```powershell
Restart-Service -Name Tailscale -Force
Start-Sleep -Seconds 25
tailscale funnel --bg 3000
tailscale funnel --bg --set-path=/webhook 8000
# แล้วยิง /channel/webhook/test ซ้ำ ต้องได้ success:true
```

ตรวจก่อนสรุปว่าเป็นเรื่องอื่น: `tailscale netcheck` (ต้องมี IPv4/IPv6 และเจอ DERP) และ
`tailscale cert <โดเมน>` (ต้องออก cert ได้และยังไม่หมดอายุ) — ถ้าสองอย่างนี้ปกติแต่ LINE
ยังต่อไม่ได้ ให้ restart ตามข้างบน อย่าเสียเวลารื้อ config ใหม่ทั้งหมด

---

## 3. คำสั่งที่ต้องรันทุกครั้งที่เครื่องรีสตาร์ท

Tailscale Funnel ไม่ได้ตั้งค่าตัวเองอัตโนมัติหลังรีบูต:

```powershell
tailscale funnel --bg 3000                       # /        -> หน้าแอดมิน (Next.js)
tailscale funnel --bg --set-path=/webhook 8000   # /webhook -> บอท Python
tailscale funnel status                          # ต้องขึ้น (Funnel on) ไม่ใช่ (tainet only)
```

> ⚠️ **ต้องเป็น `funnel` เท่านั้น ห้ามใช้ `serve`** — สองคำสั่งนี้เขียนทับ config ตัวเดียวกัน
> การเผลอรัน `serve` จะสลับเป็น "tailnet only" เงียบๆ แล้ว webhook ตายทันทีโดยไม่มี error

ตรวจว่าใช้งานได้:

```powershell
curl.exe https://win-qrb8cpgc62i.taila97ec8.ts.net/webhook    # {"ok":true,"service":"line-bot-python"}
curl.exe http://127.0.0.1:8000/health                          # {"ok":true,"state_backend":"redis"}
```

---

## 4. ปิดอะไรไว้บ้างใน OA Manager (ห้ามเปิด)

| รายการ | ต้องเป็น | เปิดแล้วเกิดอะไร |
| --- | --- | --- |
| Webhooks | **เปิด** | ปิดแล้วบอทไม่ได้รับอะไรเลย |
| Chat (โหมดคนตอบ) | **ปิด** | เปิดแล้ว `chatMode` เปลี่ยนเป็น `chat` → webhook ไม่ยิงเลยแม้ตั้ง URL ถูกทุกอย่าง |
| Greeting message | **ปิด** | ข้อความต้อนรับซ้ำ 2 อัน (บอทส่งเองจาก `follow` event แล้ว) |
| Auto-response messages | **ปิด** | ตอบทับข้อความบอท |

ตรวจ `chatMode` ได้เร็วๆ ด้วย:

```powershell
curl.exe -H "Authorization: Bearer $env:LINE_CHANNEL_ACCESS_TOKEN" https://api.line.me/v2/bot/info
```

---

## 5. LIFF (ทางเลือก — ไม่จำเป็นแล้ว)

เดิม LIFF คือทางเดียวที่จะสร้าง ticket ได้ แต่ตอนนี้บอท Python สร้าง ticket จบในแชทแล้ว
**LIFF จึงไม่ใช่สิ่งที่ต้องทำก่อนเปิดใช้งาน** ทำเมื่อไหร่ก็ได้ถ้าอยากมีฟอร์มเว็บเสริม

สิ่งที่ยังขาด: `LINE_LOGIN_CHANNEL_ID`, `NEXT_PUBLIC_LIFF_ID`

1. https://developers.line.biz/console/ → Provider `IT Support-Admin` → **Create a new channel** → **LINE Login**
   (ห้ามสร้าง LIFF ใน Messaging API channel — LINE ไม่อนุญาตแล้ว และต้องอยู่ Provider เดียวกันเพื่อให้ user ID ตรงกัน)
2. ชื่อ channel `IT Support Portal` (ชื่อห้ามมีคำว่า LINE) · App types: **Web app**
3. **Basic settings** → **Linked LINE Official Account** → เลือก `IT-Support-Admin`
4. คัดลอก **Channel ID** → `LINE_LOGIN_CHANNEL_ID` (คนละตัวกับ Messaging API Channel ID `2011597498`)
5. แท็บ **LIFF** → **Add**: Size `Full` · Endpoint `https://win-qrb8cpgc62i.taila97ec8.ts.net/liff/new-ticket`
   · Scopes `openid` + `profile` · Bot link feature `On (Normal)`
6. คัดลอก **LIFF ID** (รูปแบบ `2006123456-AbCdEfGh` ไม่ใช่ URL) → `NEXT_PUBLIC_LIFF_ID`
7. **ต้อง build ใหม่ ไม่ใช่แค่ restart** — `NEXT_PUBLIC_*` ถูกฝังตอน build:
   ```powershell
   docker compose up -d --build app
   ```

> ระหว่างที่ LINE Login channel ยังเป็น `Developing` จะมีแค่ Admin/Tester ที่เปิด LIFF ได้

---

## 6. ทดสอบก่อนปล่อยให้พนักงานใช้

1. สแกน QR (`qr/line-oa-qr-logo.png`) เพิ่ม OA เป็นเพื่อน → ต้องได้ข้อความต้อนรับ **1 ข้อความ** และเห็น rich menu
2. กดปุ่ม **แจ้งซ่อม** → ต้องเข้า flow ถามสาขา
3. พิมพ์ `คีย์บอร์ดเหลือกี่อัน` → ต้องตอบยอดคงเหลือจริงจากระบบ
4. **ส่งรูปหน้าจอเข้าไป** → ต้องตอบ "ได้รับรูปแล้วครับ 📸" และเปิด flow ให้
5. แจ้งเรื่องจนจบ → เปิด `/tickets` ดูว่า ticket ขึ้น และ **เห็นรูปที่แนบมาในแผงรายละเอียด**
6. คลิกสถานะในแถว Ticket → เลือก **แก้ไขเสร็จแล้ว** → ใส่ชื่อผู้แก้ไขและหมายเหตุ → ตรวจตัวอย่างข้อความและเปิด **แจ้งกลับผ่าน LINE OA** → กด **บันทึกและส่ง LINE** → ตรวจข้อความใน LINE ของผู้แจ้ง
7. ส่งสติกเกอร์ → ต้องตอบว่าอ่านได้เฉพาะข้อความกับรูป (ไม่ใช่เงียบ)

### บันทึกสถานะและหมายเหตุจากหน้า Tickets

- **ยกเลิก** จะทิ้งการแก้ไขในหน้าต่าง โดยไม่บันทึกหรือส่ง LINE
- ปิดตัวเลือก LINE เพื่อ **บันทึก** เฉพาะสถานะและหมายเหตุในประวัติ สามารถเพิ่มหมายเหตุให้เรื่องที่แก้ไขแล้วโดยใช้สถานะเดิมได้
- ข้อความตัวอย่างและข้อความที่ส่งใช้รูปแบบเดียวกัน ได้แก่ เลข Ticket ประเภท สาขา สถานะ และหมายเหตุ
- ต้องตั้ง `LINE_CHANNEL_ACCESS_TOKEN` ของ OA ในแอป Next.js ด้วย และ Ticket ต้องมี LINE user ID ของผู้แจ้ง
- หน้าผลลัพธ์แยกการบันทึกข้อมูลออกจากการส่ง LINE หากส่งไม่สำเร็จ ข้อมูลยังคงบันทึกไว้ กด **เสร็จสิ้น** เพื่ออัปเดตตาราง
- LINE ตอบรับคำขอส่งไม่ได้ยืนยันว่าผู้แจ้งได้รับหรืออ่านข้อความแล้ว หากเครือข่ายขัดข้อง ให้ตรวจประวัติแชทก่อนส่งอีกครั้ง

### ทดสอบข้อ 6 โดยไม่ยิงเข้าไลน์จริง (ไม่กินโควตา)

```powershell
# รันเซิร์ฟเวอร์จำลองไว้ดูข้อความที่จะถูกส่ง แล้วชี้ LINE_API_BASE มาที่มัน
$env:LINE_API_BASE = "http://127.0.0.1:3999"
```

⚠️ อย่าลืมเอา `LINE_API_BASE` ออกก่อนใช้งานจริง ไม่งั้นข้อความจะไม่ถึงผู้ใช้

---

## 7. อาการเสีย → ตรวจตรงไหน

| อาการ | สาเหตุที่พบบ่อยที่สุด |
| --- | --- |
| Verify ได้ 401 | `LINE_CHANNEL_SECRET` ในโปรเซสที่รันอยู่ไม่ตรงกับ LINE — ต้อง recreate container ไม่ใช่แค่แก้ไฟล์ |
| Verify ต่อไม่ได้ | Tailscale Funnel ไม่ได้รัน หรือเป็น `tainet only` แทน `Funnel on` |
| Verify ได้ `COULD_NOT_CONNECT` / `Session protocol negotiation failure` ทั้งที่ `funnel status` ขึ้น `Funnel on` | **Funnel ค้างหลังเครื่องเปลี่ยน IP ในวง LAN** — restart บริการ Tailscale แล้วตั้ง funnel ใหม่ (ดูข้อ 3.1) |
| Verify error ทั้งที่ตั้งถูก | เพิ่ง `docker compose up -d bot` — Funnel ใช้เวลา 1-2 นาที รอแล้วกดใหม่ |
| แอดเพื่อนแล้วบอทเงียบ | `Use webhook` ปิด หรือ `chatMode` เป็น `chat` (เช็คที่ `/v2/bot/info`) |
| บอทตอบซ้ำ 2 ข้อความ | Greeting message / Auto-response ยังเปิดอยู่ |
| บอทเงียบเฉพาะบางคน | คนนั้นยิงเกิน `RATE_LIMIT_PER_MINUTE` (ค่าตั้งต้น 20/นาที) |
| ส่งรูปแล้วบอทเงียบ | `ACCEPT_IMAGES=false` หรือ `/api/internal/attachments` ตอบ 401 (`INTERNAL_API_KEY` ไม่ตรงกัน 2 ฝั่ง) |
| ไม่เห็น rich menu | ดู `richmenu` ใน `/health` ก่อน · ถ้าขึ้น ok/installed แล้วยังไม่เห็น ให้ปิด/เปิดห้องแชทใหม่ |
| `richmenu` ขึ้น `ไม่พบไฟล์รูปเมนู` | docker-compose ยังไม่ได้ mount `./line-oa/assets` — ต้อง `docker compose up -d` ใหม่ |
| รูปขึ้นในหน้าแอดมินไม่ได้ (404) | ต้องมี route `src/app/uploads/[...path]/route.ts` — Next.js อ่านโฟลเดอร์ `public/` แค่ตอนสตาร์ท |
| เปลี่ยนสถานะแล้วไม่มีแจ้งเตือน | ตรวจว่าเปิดตัวเลือก LINE และกดบันทึกแล้ว ตรวจผลลัพธ์ token และ LINE user ID ของผู้แจ้ง; `LINE_NOTIFY_STATUSES` ใช้กับการส่งอัตโนมัติ ไม่จำกัดตัวเลือกส่งจากหน้าต่างนี้ |
| ไม่มีแจ้งเตือนทั้งระบบ | โควตา push 300/เดือนหมด — เช็ค `GET /v2/bot/info/quota` |
| บอทตอบข้อมูลเก่า | knowledge cache 5 นาที — `docker compose restart bot` |

เอกสารอ้างอิงทางการ:

- https://developers.line.biz/en/docs/messaging-api/verify-webhook-url/
- https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
- https://developers.line.biz/en/docs/messaging-api/getting-images-video-audio-text/
- https://developers.line.biz/en/docs/messaging-api/using-rich-menus/
- https://developers.line.biz/en/docs/liff/getting-started/
