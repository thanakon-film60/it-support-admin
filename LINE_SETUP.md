# ตั้งค่า LINE Official Account + Messaging API + LIFF

คู่มือนี้ใช้กับโปรเจกต์ `it-support-admin` และบัญชี LINE OA `IT-Support-Admin`

## สถานะปัจจุบัน

| รายการ | สถานะ |
| --- | --- |
| LINE Official Account | สร้างแล้ว |
| Messaging API | Enabled |
| Messaging API Channel ID | `2011597498` (เก็บไว้อ้างอิง โปรเจกต์ไม่ต้องใช้ค่านี้) |
| `LINE_CHANNEL_SECRET` | ใส่ใน `.env.local` แล้ว |
| Webhook endpoint | ออนไลน์และตอบ HTTP 200 |
| `LINE_CHANNEL_ACCESS_TOKEN` | ยังต้องออกใน LINE Developers Console |
| LINE Login channel สำหรับ LIFF | ยังต้องสร้างใน Provider เดียวกัน |
| `LINE_LOGIN_CHANNEL_ID` | ยังไม่มี |
| `NEXT_PUBLIC_LIFF_ID` | ยังไม่มี |

> Channel secret เคยปรากฏในภาพ/แชตแล้ว ก่อนใช้งานจริงให้ Reissue ที่ LINE Developers
> Console แล้วเปลี่ยนค่าใน `.env.local` และ restart แอปทันที

## URL ที่ใช้

| ใช้ที่ไหน | URL |
| --- | --- |
| หน้าเข้าสู่ระบบ | `https://win-qrb8cpgc62i.taila97ec8.ts.net/login` |
| Webhook URL | `https://win-qrb8cpgc62i.taila97ec8.ts.net/api/line/webhook` |
| LIFF Endpoint URL | `https://win-qrb8cpgc62i.taila97ec8.ts.net/liff/new-ticket` |

โดเมนนี้ผ่าน Tailscale Funnel เครื่องต้องเปิดอยู่ แอปต้องรันที่พอร์ต 3000 และ Funnel ต้องทำงาน
จึงจะรับ Webhook จาก LINE ได้

## 1. ตั้ง Webhook URL

เปิดหน้าตรงของบัญชีนี้:

https://manager.line.biz/account/@891ujhzo/setting/messaging-api

ใส่ค่าในช่อง **Webhook URL** แล้วกด **Save**:

```text
https://win-qrb8cpgc62i.taila97ec8.ts.net/api/line/webhook
```

จากนั้นเข้า https://developers.line.biz/console/ แล้วทำตามนี้:

1. เลือก Provider `IT Support-Admin`
2. เลือก Messaging API channel ของ `IT-Support-Admin`
3. เปิดแท็บ **Messaging API**
4. ที่ **Webhook settings** กด **Verify** ให้ขึ้น `Success`
5. เปิด **Use webhook**

ปุ่ม Verify ของ LINE จะส่ง `POST` ที่มี `events: []` เข้ามา โปรเจกต์รองรับไว้แล้วและตรวจ
`x-line-signature` ด้วย Channel secret ก่อนตอบ HTTP 200

## 2. ออก Channel access token

ยังอยู่ที่ LINE Developers Console > Messaging API channel > แท็บ **Messaging API**:

1. เลื่อนถึง **Channel access token (long-lived)**
2. กด **Issue**
3. คัดลอก Token ไปใส่ไฟล์ `.env.local` ที่บรรทัดนี้ด้วยตัวเอง

```env
LINE_CHANNEL_ACCESS_TOKEN=วาง_token_ตรงนี้
```

อย่าส่ง Token ในแชตและอย่า commit ไฟล์ `.env.local` ถ้ากด Reissue ค่าเดิมจะหยุดใช้งาน

## 3. ปิดข้อความตอบอัตโนมัติของ OA

เปิด LINE Official Account Manager > **Settings** > **Response settings** แล้วตั้งค่า:

| รายการ | ค่า |
| --- | --- |
| Webhooks | Enabled |
| Auto-response messages | Disabled |
| Greeting message | Disabled |

โปรเจกต์มีข้อความต้อนรับและคำตอบ FAQ ของตัวเอง ถ้าไม่ปิดสองรายการหลัง ผู้ใช้จะได้รับข้อความซ้ำ

## 4. สร้าง LINE Login channel สำหรับ LIFF

ห้ามสร้าง LIFF ใน Messaging API channel เพราะ LINE ไม่อนุญาตให้เพิ่ม LIFF app ใหม่ใน channel
ประเภทนั้นแล้ว ให้สร้าง LINE Login channel แยก แต่ต้องอยู่ใน **Provider เดียวกัน** เพื่อให้ user ID
ตรงกันระหว่างบอทและ LIFF

1. เข้า https://developers.line.biz/console/
2. เลือก Provider `IT Support-Admin`
3. กด **Create a new channel** > **LINE Login**
4. ใช้ชื่อ channel `IT Support Portal` (ชื่อ channel ห้ามมีคำว่า LINE)
5. เลือก **App types: Web app** และกรอกอีเมลติดต่อ
6. สร้าง channel ให้เสร็จ
7. แท็บ **Basic settings** > **Linked LINE Official Account** > **Edit**
8. เลือก OA `IT-Support-Admin` แล้วกด **Update**
9. คัดลอก **Channel ID** ของ LINE Login channel ไปใส่:

```env
LINE_LOGIN_CHANNEL_ID=วาง_channel_id_ของ_LINE_Login_ตรงนี้
```

> ค่านี้ไม่ใช่ Messaging API Channel ID `2011597498`

## 5. สร้าง LIFF app

ใน LINE Login channel ที่สร้างเมื่อสักครู่ เปิดแท็บ **LIFF** > **Add** แล้วกรอก:

| ช่อง | ค่า |
| --- | --- |
| LIFF app name | `แจ้งปัญหา IT` |
| Size | `Full` |
| Endpoint URL | `https://win-qrb8cpgc62i.taila97ec8.ts.net/liff/new-ticket` |
| Scopes | `openid` และ `profile` |
| Bot link feature | `On (Normal)` |

กด **Add** แล้วคัดลอก **LIFF ID** ไปใส่:

```env
NEXT_PUBLIC_LIFF_ID=วาง_LIFF_ID_ตรงนี้
```

LIFF ID มีรูปแบบคล้าย `2006123456-AbCdEfGh` ไม่ใช่ URL `https://liff.line.me/...`

ถ้า LINE Login channel ยังเป็น `Developing` จะมีเพียง Admin/Tester ของ channel ที่เปิด LIFF ได้
ก่อนให้พนักงานทั่วไปใช้ ให้เพิ่ม Tester สำหรับการทดสอบหรือเปลี่ยน channel เป็น `Published`

## 6. Environment ที่โปรเจกต์ต้องมี

ไฟล์ `D:\GitHub-it\it-support-admin\.env.local`:

```env
SESSION_SECRET=มีค่าแล้ว
LINE_CHANNEL_SECRET=มีค่าแล้ว
LINE_CHANNEL_ACCESS_TOKEN=
LINE_LOGIN_CHANNEL_ID=
NEXT_PUBLIC_LIFF_ID=
```

มีข้อมูลที่ต้องนำจาก LINE มาเติมอีก 3 ค่า:

1. `LINE_CHANNEL_ACCESS_TOKEN` จาก Messaging API channel
2. `LINE_LOGIN_CHANNEL_ID` จาก LINE Login channel
3. `NEXT_PUBLIC_LIFF_ID` จาก LIFF app

`NEXT_PUBLIC_LIFF_ID` ถูกฝังตอน build หลังแก้ค่านี้ต้อง rebuild/restart แอป

## 7. รันระบบและ Tailscale Funnel

สำหรับทดสอบบนเครื่องนี้:

```powershell
npm run dev
tailscale funnel --bg 3000
tailscale funnel status
```

ทดสอบจากอินเทอร์เน็ต:

```powershell
curl.exe https://win-qrb8cpgc62i.taila97ec8.ts.net/api/line/webhook
```

ต้องได้ HTTP 200 และ JSON ที่มี `"service":"line-webhook"`

## 8. ทดสอบจริง

1. Messaging API tab > สแกน QR เพื่อเพิ่ม OA เป็นเพื่อน
2. ต้องได้รับข้อความต้อนรับจากบอทเพียงหนึ่งข้อความ
3. พิมพ์ `ปริ้นเอกสารไม่ได้`
4. ต้องได้คำแนะนำ FAQ และปุ่ม **แจ้งปัญหา / สร้าง Ticket**
5. กดปุ่ม ต้องเปิด LIFF และแสดงชื่อ LINE ของผู้ใช้
6. ส่งฟอร์ม แล้วเปิด `/tickets` ตรวจว่า Ticket และผู้แจ้งถูกต้อง

## ตรวจปัญหา

| อาการ | ตรวจอะไร |
| --- | --- |
| Verify ได้ 401 | Channel secret ใน process ที่รันไม่ตรงกับ LINE ให้ restart หลังแก้ env |
| Verify เชื่อมต่อไม่ได้ | แอปหรือ Tailscale Funnel ไม่ได้รัน หรือ URL ผิด |
| เพิ่มเพื่อนแล้วบอทเงียบ | `Use webhook` ปิด หรือยังไม่มี access token |
| บอทตอบซ้ำ | ปิด Auto-response และ Greeting message |
| ไม่มีปุ่มสร้าง Ticket | ยังไม่ได้ใส่ `NEXT_PUBLIC_LIFF_ID` และ rebuild |
| LIFF แจ้งยืนยันตัวตนไม่ได้ | ตรวจ `openid`, `LINE_LOGIN_CHANNEL_ID` และ Provider ต้องตรงกัน |
| พนักงานทั่วไปเปิด LIFF ไม่ได้ | Publish LINE Login channel หรือเพิ่มผู้ใช้เป็น Tester |

เอกสารอ้างอิงทางการ:

- https://developers.line.biz/en/docs/messaging-api/verify-webhook-url/
- https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
- https://developers.line.biz/en/docs/liff/getting-started/
- https://developers.line.biz/en/docs/liff/using-user-profile/
- https://developers.line.biz/en/docs/line-login/link-a-bot/
