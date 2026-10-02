---
name: it-support-admin
description: ใช้เมื่อทำงานกับโปรเจกต์ it-support-admin (ระบบรับแจ้งงาน IT ของกลุ่มบริษัท Montipa/Motta) — เว็บแอดมิน Next.js + LINE OA Bot ภาษา Python ครอบคลุมโครงสร้างโปรเจกต์ กฎการเขียนโค้ด กับดักที่เคยเจอ และวิธีทดสอบก่อน deploy
---

# it-support-admin

ระบบรับแจ้งงาน IT ของกลุ่มบริษัท — พนักงาน 326 คน · สาขา 102 แห่ง · 3 บริษัท (Montipa · Motta · ส่วนกลาง)

> **อ่าน `references/status.md` ก่อนเชื่อเอกสารอื่น** — มีรายการ "เอกสารเคยบอกว่าทำแล้วแต่โค้ดไม่ได้ทำ"
> อยู่ในนั้น (ตรวจครั้งล่าสุด 2026-09-26)

## อ่านอะไรก่อน

| ถ้างานคือ | อ่าน |
| --- | --- |
| เข้าใจภาพรวมทั้งหมด | `PROJECT.md` ในโปรเจกต์ (สรุปครบที่สุด) |
| แก้บทสนทนาของบอท | `references/line-bot.md` + docstring หัวไฟล์ `line-bot-python/app/flow.py` |
| แก้ข้อมูล/ฐานข้อมูล | `references/data-model.md` |
| แก้หน้าเว็บ | `references/architecture.md` |
| จะเขียนโค้ด/เทสต์/เอกสาร | `references/conventions.md` |
| อยากรู้ว่าทำอะไรไปแล้ว ค้างอะไร | `references/status.md` |

## โครงสร้าง 30 วินาที

```
src/                    Next.js 16 (App Router) — เว็บแอดมิน + API ภายใน
  app/(dashboard)/      หน้าเว็บทีม IT
  app/actions/          Server Action ("use server") — ขึ้นต้นด้วย requireSession() เสมอ
  app/api/internal/     API ที่บอทเรียก — ป้องกันด้วย header x-internal-key
  lib/db/               ชั้นข้อมูล — ทุกไฟล์ผ่าน store.ts เท่านั้น ห้ามแตะ fs ตรงๆ
  components/ui/        Modal / Pagination / Button / Card ใช้ร่วมกันทุกหน้า
line-bot-python/app/    FastAPI + state machine
  flow.py               หัวใจ — รับ event คืนข้อความ ไม่เรียก LINE API เลย
  ai.py                 TF-IDF + rapidfuzz + pythainlp · Knowledge cache 5 นาที
line-oa/                สคริปต์สร้างรูป rich menu / โปรไฟล์ / หน้าปก
scripts/                deploy / backup / ตั้ง Tailscale Funnel / ตั้ง autostart (Windows)
data/*.json             ที่เก็บข้อมูลจริงตอนนี้ (Postgres เตรียมไว้แล้วแต่ยังไม่ได้ใช้)
```

ระบบรันบน **เครื่อง Windows ในออฟฟิศ** เปิดสู่อินเทอร์เน็ตด้วย **Tailscale Funnel**
(`https://<ชื่อเครื่อง>.<tailnet>.ts.net/webhook` → `127.0.0.1:8000`) ไม่ได้อยู่บนคลาวด์

## กฎเหล็ก 8 ข้อ

1. **Client component ห้าม import อะไรที่เรียกถึง `src/lib/db/`** — `store.ts` import `node:fs`
   bundler จะลากเข้า bundle เบราว์เซอร์แล้ว `next build` ล้ม ใช้ `lib/companies.ts` หรือรับเป็น prop แทน
   (`import type` ปลอดภัย · มี `tests/client-bundle.test.cjs` กันไว้)
2. **Server Action ทุกตัวขึ้นต้นด้วย `await requireSession()`**
3. **API ภายในทุกเส้นตรวจ `x-internal-key` ก่อนทำอะไร**
4. **ข้อมูลจริงมีค่าซ้ำ** — รหัสทรัพย์สินซ้ำ 28 แถว · ชื่อสาขาซ้ำข้ามบริษัท · ชื่อพนักงานคล้ายกัน
   ทุกจุดที่แปลงสิ่งที่ผู้ใช้พิมพ์เป็นแถวในฐานข้อมูล **ต้องถามเมื่อกำกวม ห้ามหยิบตัวแรก**
5. **ลบข้อมูลที่มีประวัติผูกอยู่ไม่ได้** — ใช้ `active: false` แทน
6. **คอมเมนต์เขียน "ทำไม" ไม่ใช่ "ทำอะไร"** — อธิบายเหตุผลและผลเสียถ้าทำอีกแบบ
7. **แก้โค้ดแล้วอัปเดต `.md` ที่เกี่ยวข้องในรอบเดียวกัน**
8. **สื่อสารเป็นภาษาไทยทั้งหมด** — คอมเมนต์ ชื่อเทสต์ ข้อความ error ข้อความในแชท

## คำสั่งที่ต้องรันก่อนบอกว่าเสร็จ

```bash
npx tsc --noEmit                      # เร็วกว่า next build มาก ใช้ตรวจ type ระหว่างแก้
npx eslint src
node --test tests/*.test.cjs          # 68 เคส
cd line-bot-python && python -m pytest -q   # 261 เคส
```

สถานะที่ควรเป็น: **เขียวทั้งหมด** ถ้าเจอแดงตั้งแต่ก่อนแก้ ให้บอกผู้ใช้ก่อนว่าแดงอยู่แล้ว
อย่ากลบด้วยการแก้เทสต์ให้ผ่าน

`npm run build` และ `deploy.bat` รันได้เฉพาะบนเครื่องผู้ใช้ (Windows + docker)

## กับดักที่เสียเวลาไล่หามาแล้ว

- **แก้ `seed()` แล้วข้อมูลไม่ขึ้นบนเครื่องที่รันอยู่** — `readCollection` รัน seed เฉพาะตอนยังไม่มีไฟล์
  ต้องเขียนฟังก์ชันซิงก์แยก + marker เวอร์ชัน (ดู `ensureEmployeeRegistry()`)
- **deploy แล้ว rich menu ไม่เปลี่ยน** — ต้องเทียบลายเซ็นปุ่ม ไม่ใช่แค่ชื่อเมนู
- **วันที่เพี้ยน 7 ชั่วโมง** — container รัน UTC ใช้ `lib/date-th.ts` เสมอ อย่าใช้เวลาเครื่อง
- **ตารางบนจอใหญ่ตัดคอลัมน์ขวาสุดหาย** — วัดความกว้างจริงด้วย Playwright อย่าเดา
- **บอทอ่านข้อความแล้วแต่ไม่ตอบ ทั้งที่ทุกตัวชี้วัดขึ้นเขียวหมด** — Tailscale ลงทะเบียน Funnel
  ค้างที่ control plane · สั่งซ้ำด้วย config เดิมไม่ส่งอะไรขึ้นไปใหม่ และ `Restart-Service` ก็ไม่ช่วย
  ต้อง `tailscale funnel --https=443 off` ให้เกลี้ยงก่อนแล้วค่อยตั้งใหม่ (`LINE_SETUP.md` §3.1)
  **อาการหลอกมาก** `funnel status` · netcheck · cert · DNS · พอร์ต ขึ้นถูกหมดแต่ข้างนอกต่อไม่ได้
- **สคริปต์เทียบสถานะจากข้อความภาษาไทย** — Windows PowerShell 5.1 ถอดรหัส JSON ที่ไม่มี charset
  เป็น ISO-8859-1 ข้อความเพี้ยนก่อนถึงบรรทัดที่เทียบ แล้วรายงานผิดโดยไม่มี error
  ค่าที่เครื่องเอาไปตัดสินใจต้องเป็นฟิลด์ ASCII แยกต่างหากเสมอ (เช่น `richmenu_state` คู่กับ `richmenu`)

## วิธีตรวจงาน UI ด้วยตาจริง

เรนเดอร์ component จริงด้วย `react-dom/server` → คอมไพล์ Tailwind กับ `src/app/globals.css` ตัวจริง
→ เปิดด้วย Playwright/Chromium แล้ววัด `scrollWidth` เทียบ `clientWidth` + ถ่ายภาพที่ 390 / 768 / 1440
ดูตัวอย่างที่ `tests/employees-board.test.cjs` (ส่วนการเรนเดอร์)
