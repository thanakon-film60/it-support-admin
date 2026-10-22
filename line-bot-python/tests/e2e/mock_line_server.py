"""เซิร์ฟเวอร์จำลองของ LINE Messaging API — ใช้ตอนทดสอบ end-to-end

จุดประสงค์: ให้บอทยิง reply ออกไปจริงๆ ผ่าน SDK ตัวจริง แต่ปลายทางเป็นเซิร์ฟเวอร์นี้แทน
เราจึงตรวจได้ว่า "ข้อความที่ LINE จะได้รับจริง" หน้าตาเป็นอย่างไร รวมถึงปุ่ม quick reply
ซึ่งเป็นสิ่งที่ unit test ระดับ flow มองไม่เห็น

ชี้บอทมาที่นี่ด้วย env: LINE_API_HOST=http://127.0.0.1:3999
"""

from __future__ import annotations

from fastapi import FastAPI, Request

app = FastAPI(title="Mock LINE API")

captured: list[dict] = []


@app.post("/v2/bot/message/reply")
async def reply(request: Request):
    captured.append(await request.json())
    return {}


@app.post("/v2/bot/message/push")
async def push(request: Request):
    captured.append(await request.json())
    return {}


@app.get("/v2/bot/profile/{user_id}")
async def profile(user_id: str):
    return {"userId": user_id, "displayName": "Film", "pictureUrl": "", "statusMessage": ""}


# ข้อมูลบัญชี — บอทถามตอนสตาร์ทว่าเปิด Chat อยู่ไหม (ปุ่ม "คุยกับเจ้าหน้าที่" ใช้ได้เฉพาะตอนเปิด)
@app.get("/v2/bot/info")
async def bot_info():
    return {
        "userId": "U_mock_bot", "basicId": "@mock", "displayName": "IT Support (mock)",
        "chatMode": "chat", "markAsReadMode": "manual",
    }


# บอทสั่ง "อ่านแล้ว" ให้ข้อความที่ตอบจบเอง — เก็บ token ไว้ตรวจว่าสั่งเฉพาะข้อความที่ควรสั่ง
marked: list[str] = []


@app.post("/v2/bot/chat/markAsRead")
async def mark_as_read(request: Request):
    marked.append((await request.json()).get("markAsReadToken", ""))
    return {}


@app.get("/_captured")
async def get_captured():
    return {"count": len(captured), "items": captured, "marked": marked}


@app.post("/_reset")
async def reset():
    captured.clear()
    marked.clear()
    return {"ok": True}
