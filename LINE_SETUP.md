# คู่มือตั้งค่า LINE Bot + LIFF

ทำที่ [LINE Developers Console](https://developers.line.biz/console/) ใช้เวลาประมาณ 15 นาที

**สิ่งที่ต้องได้กลับมา 3 ค่า** (เอามาให้ผมใส่ `.env` แล้ว rebuild ให้):

1. `LINE_CHANNEL_SECRET`
2. `LINE_CHANNEL_ACCESS_TOKEN`
3. `NEXT_PUBLIC_LIFF_ID`

---

## URL ของระบบที่ต้องใช้กรอก

```
https://win-qrb8cpgc62i.taila97ec8.ts.net
```

| ใช้ที่ไหน | URL เต็ม |
| --- | --- |
| Webhook URL | `https://win-qrb8cpgc62i.taila97ec8.ts.net/api/line/webhook` |
| LIFF Endpoint URL | `https://win-qrb8cpgc62i.taila97ec8.ts.net/liff/new-ticket` |

> ⚠️ **ถ้าจะเปลี่ยนชื่อ URL ให้สั้นลง ทำก่อนเริ่มขั้นตอนนี้**
> ชื่อ `win-qrb8cpgc62i` มาจากชื่อเครื่อง Windows เปลี่ยนเป็น `it-support-admin` ได้ที่
> [Tailscale admin console](https://login.tailscale.com/admin/machines) → จุดสามจุดที่เครื่อง → Edit machine name
> จะได้ URL เป็น `https://it-support-admin.taila97ec8.ts.net`
> ถ้าเปลี่ยนหลังตั้ง LINE เสร็จแล้ว ต้องกลับมาแก้ทั้ง Webhook URL และ LIFF Endpoint ใหม่ แล้ว rebuild อีกรอบ

---

## ขั้นที่ 1 — สร้าง Messaging API channel

1. เข้า https://developers.line.biz/console/
2. ถ้ายังไม่มี **Provider** ให้กด **Create a new provider** ตั้งชื่อเป็นชื่อบริษัท/ทีม
3. ในหน้า Provider กด **Create a Messaging API channel**
4. กรอกข้อมูล:

| ช่อง | ใส่อะไร |
| --- | --- |
| Channel name | ชื่อที่พนักงานจะเห็นใน LINE เช่น `IT Support` |
| Channel description | อธิบายสั้นๆ เช่น `แจ้งปัญหา IT / เบิกอุปกรณ์` |
| Category / Subcategory | เลือกอะไรก็ได้ที่ใกล้เคียง เช่น `Business` |
| Email address | อีเมลติดต่อ |

5. ติ๊กยอมรับเงื่อนไข แล้วกด **Create**

---

## ขั้นที่ 2 — เก็บค่าที่ 1: Channel secret

1. เข้า channel ที่เพิ่งสร้าง → แท็บ **Basic settings**
2. เลื่อนหาหัวข้อ **Channel secret** → กด copy

📋 **ค่าที่ 1 → `LINE_CHANNEL_SECRET`** (เป็นตัวอักษร+ตัวเลขยาวประมาณ 32 ตัว)

---

## ขั้นที่ 3 — เก็บค่าที่ 2: Channel access token

1. ไปแท็บ **Messaging API**
2. เลื่อนลงล่างสุดหาหัวข้อ **Channel access token (long-lived)**
3. กดปุ่ม **Issue** → กด copy

📋 **ค่าที่ 2 → `LINE_CHANNEL_ACCESS_TOKEN`** (ยาวมาก ประมาณ 170 ตัวอักษร ลงท้ายด้วย `=`)

> ถ้ากด Issue ซ้ำ token เดิมจะใช้ไม่ได้ทันที — กดครั้งเดียวพอ ถ้าเผลอกดซ้ำต้องเอาค่าใหม่มาให้ผมแทน

---

## ขั้นที่ 4 — ตั้งค่า Webhook

ยังอยู่ในแท็บ **Messaging API**

1. หาหัวข้อ **Webhook settings** → กด **Edit** ที่ช่อง **Webhook URL** → วาง:

   ```
   https://win-qrb8cpgc62i.taila97ec8.ts.net/api/line/webhook
   ```

2. กด **Update** แล้วกด **Verify** → **ต้องขึ้น Success**

   ถ้าขึ้น error ให้หยุดแล้วบอกผม อย่าเพิ่งทำขั้นต่อไป

3. เปิดสวิตช์ **Use webhook** ✅

---

## ขั้นที่ 5 — ปิดข้อความอัตโนมัติของ LINE

**ข้อนี้ห้ามข้าม** ไม่งั้นพนักงานจะได้ข้อความซ้ำซ้อน — ของ LINE ตอบทับของบอทเรา

ยังอยู่แท็บ **Messaging API** หาหัวข้อ **LINE Official Account features**

| รายการ | ตั้งเป็น |
| --- | --- |
| Auto-reply messages | **Disabled** |
| Greeting messages | **Disabled** |

กด **Edit** ข้างแต่ละรายการ (จะเด้งไปหน้า LINE Official Account Manager) แล้วปิดสวิตช์

> ระบบเรามีข้อความต้อนรับของตัวเองอยู่แล้ว จะส่งให้อัตโนมัติตอนมีคนกดเพิ่มเพื่อน

---

## ขั้นที่ 6 — เก็บค่าที่ 3: สร้าง LIFF app

LIFF คือหน้าเว็บฟอร์มที่เปิดในแอป LINE ให้พนักงานกรอกแจ้งปัญหา และดึงชื่อ-โปรไฟล์จาก LINE มาให้เอง

1. ไปแท็บ **LIFF** → กด **Add**
2. กรอก:

| ช่อง | ใส่อะไร |
| --- | --- |
| LIFF app name | `แจ้งปัญหา IT` |
| Size | **Full** |
| Endpoint URL | `https://win-qrb8cpgc62i.taila97ec8.ts.net/liff/new-ticket` |
| Scopes | ติ๊ก **profile** และ **openid** |
| Bot link feature | `On (Normal)` |

3. กด **Add**
4. ในรายการที่สร้างเสร็จ จะมีช่อง **LIFF ID** (หน้าตาประมาณ `2006123456-AbCdEfGh`) → กด copy

📋 **ค่าที่ 3 → `NEXT_PUBLIC_LIFF_ID`**

> อย่าสับสนระหว่าง **LIFF ID** กับ **LIFF URL** — เอาเฉพาะ **LIFF ID** ที่เป็นตัวเลข-ขีด-ตัวอักษร
> ไม่ใช่ URL ที่ขึ้นต้นด้วย `https://liff.line.me/`

---

## ขั้นที่ 7 — ส่งค่ากลับมาให้ผม

ส่งมา 3 บรรทัดนี้ เดี๋ยวผมใส่ `.env` + rebuild + ทดสอบให้ครบ:

```
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
NEXT_PUBLIC_LIFF_ID=
```

> ทั้ง 3 ค่านี้เป็นความลับ ใครได้ไปสามารถส่งข้อความในนามบอทของคุณได้
> เก็บไว้ใน `.env` เท่านั้น (ไฟล์นี้ถูก gitignore ไว้แล้ว) อย่า commit ขึ้น git และอย่าส่งในแชทกลุ่ม

---

## ขั้นที่ 8 — ทดสอบ (ทำหลังผม rebuild เสร็จ)

1. แท็บ **Messaging API** → สแกน **QR code** ด้วยแอป LINE เพื่อเพิ่มบอทเป็นเพื่อน
   → ต้องได้ข้อความต้อนรับจากบอททันที
2. พิมพ์ `ปริ้นเอกสารไม่ได้`
   → บอทต้องตอบวิธีแก้จาก FAQ พร้อมปุ่ม **📝 แจ้งปัญหา / สร้าง Ticket**
3. กดปุ่มนั้น → ฟอร์มต้องเปิดในแอป LINE และดึงชื่อคุณมาใส่ให้เอง
4. กรอกแล้วส่ง → เปิดหน้าแอดมิน `/tickets` ต้องเห็น ticket ใหม่ผูกกับชื่อคุณถูกต้อง

---

## ถ้าติดปัญหา

| อาการ | สาเหตุที่เป็นไปได้ |
| --- | --- |
| กด Verify แล้ว error | ระบบไม่ได้รัน หรือ URL พิมพ์ผิด — บอกผม เดี๋ยวเช็คให้ |
| เพิ่มเพื่อนแล้วบอทเงียบ | ยังไม่ได้เปิด **Use webhook** หรือยังไม่ได้ใส่ `LINE_CHANNEL_SECRET` |
| บอทตอบซ้ำ 2 ข้อความ | ยังไม่ได้ปิด **Auto-reply messages** (ขั้นที่ 5) |
| กดปุ่มแล้วไม่มีอะไรขึ้น | `NEXT_PUBLIC_LIFF_ID` ยังไม่ได้ใส่ หรือใส่แล้วแต่ยังไม่ได้ rebuild |
| ฟอร์มเปิดได้แต่ไม่ดึงชื่อ | Scopes ไม่ได้ติ๊ก `profile` / `openid` |

ทุกข้อบอกผมได้ ผมดู log ฝั่งเซิร์ฟเวอร์ให้ได้ว่า LINE ยิงเข้ามาถึงไหม
