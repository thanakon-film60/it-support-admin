"""เทสต์ "เจ้าหน้าที่รับแชทต่อเอง" — หน้าแอดมินสั่งให้บอทเงียบกับผู้ใช้คนหนึ่ง (POST /internal/handoff)

ทำไมต้องมี: LINE ไม่ส่ง webhook ตอนเจ้าหน้าที่ตอบแชทในแอป LINE Official Account
บอทจึงไม่มีทางรู้เองว่ามีคนกำลังคุยอยู่ แล้วโผล่มาตอบแทรกงานที่เจ้าหน้าที่กำลังประสาน
สิ่งที่ต้องไม่พัง:
  - ไม่มี key = ห้ามแตะอะไรเลย (เส้นนี้สั่งให้บอทเงียบกับใครก็ได้)
  - รับแชทแล้วบอทต้องเงียบจริง และคืนให้บอทแล้วต้องกลับมาตอบจริง
  - Chat ใน OA ปิดอยู่ = ห้ามสั่งเงียบ (ไม่มีใครเห็นแชท ผู้ใช้จะพิมพ์ใส่ความว่างเปล่า)
"""

from __future__ import annotations

import time

from test_flow import USER
# fixture "bot" (แอปตัวจริง: FastAPI + ลายเซ็น + flow ที่ LINE เป็นของปลอม) มาจาก test_handoff ผ่าน conftest.py

KEY = {"x-internal-key": "test-key"}
PATHS = ("/internal/handoff", "/internal/handoff/status", "/internal/handoff/end")


def test_ไม่มี_key_หรือ_key_ผิดแตะอะไรไม่ได้เลย(bot):
    client, app, *_ = bot
    for headers in ({}, {"x-internal-key": "wrong"}):
        for path in PATHS:
            assert client.post(path, json={"line_user_id": USER}, headers=headers).status_code == 401


def test_ไม่ได้ตั้ง_INTERNAL_API_KEY_ต้องปฏิเสธทุก_request(bot, monkeypatch):
    client, app, *_ = bot
    from app.main import settings

    monkeypatch.setattr(settings, "internal_api_key", "")
    res = client.post("/internal/handoff", json={"line_user_id": USER}, headers={"x-internal-key": ""})
    assert res.status_code == 401


def test_payload_เพี้ยนถูกปฏิเสธ(bot):
    client, *_ = bot
    for body in ({}, {"line_user_id": ""}, {"line_user_id": "U" * 100}, {"line_user_id": USER, "hours": 0},
                 {"line_user_id": USER, "hours": 500}):
        assert client.post("/internal/handoff", json=body, headers=KEY).status_code == 422


def test_รับแชทต่อแล้วบอทเงียบ_คืนให้บอทแล้วกลับมาตอบ(bot):
    client, app, line, send, say, state = bot

    res = client.post("/internal/handoff", json={"line_user_id": USER}, headers=KEY)
    assert res.status_code == 200
    body = res.json()
    assert body["active"] is True
    assert body["until"] > time.time() + 23 * 3600, "ค่าตั้งต้นต้องเท่ากับ HANDOFF_HOURS (24 ชม.)"

    # ผู้ใช้ตอบเจ้าหน้าที่ — บอทต้องไม่ตีความเป็นเรื่องใหม่แล้วถามสาขาแทรก
    assert say("ปริ้นเตอร์ยังกระดาษติดอยู่ครับ") == []
    assert say("ส่งรูปให้แล้วนะครับ") == []

    status = client.post("/internal/handoff/status", json={"line_user_id": USER}, headers=KEY).json()
    assert status["active"] is True
    assert status["chat_mode"] == "chat"

    ended = client.post("/internal/handoff/end", json={"line_user_id": USER}, headers=KEY).json()
    assert ended["active"] is False
    assert say("ยกเลิก"), "คืนให้บอทแล้ว บอทต้องกลับมาตอบ"


def test_กดรับแชทซ้ำไม่หดเวลาที่เหลือ(bot):
    client, *_ = bot
    long = client.post("/internal/handoff", json={"line_user_id": USER, "hours": 48}, headers=KEY).json()
    again = client.post("/internal/handoff", json={"line_user_id": USER, "hours": 1}, headers=KEY).json()
    assert again["until"] >= long["until"]
    client.post("/internal/handoff/end", json={"line_user_id": USER}, headers=KEY)


def test_คืนให้บอทตอนไม่ได้รับแชทอยู่ไม่ล้างเรื่องที่ผู้ใช้กรอกค้าง(bot):
    client, app, line, send, say, state = bot
    say("ยกเลิก")
    say("ภูเก็ต")  # เริ่มแจ้งเรื่อง — มี session ค้างอยู่
    sessions = app.state.store._data  # MemoryStore (เทสต์ไม่ได้ตั้ง REDIS_URL)
    step = sessions[USER].step
    assert step != "IDLE"
    before = client.post("/internal/handoff/status", json={"line_user_id": USER}, headers=KEY).json()
    assert before["active"] is False

    client.post("/internal/handoff/end", json={"line_user_id": USER}, headers=KEY)
    assert sessions[USER].step == step, "กดคืนให้บอทพลาดคน ต้องไม่ทำให้เรื่องที่เขากรอกค้างหาย"


def test_Chat_ใน_OA_ปิดอยู่_สั่งให้บอทเงียบไม่ได้(bot):
    client, app, line, send, say, state = bot
    state["chat_mode"] = "bot"
    app.state.bot_info_checked_at = 0.0  # บังคับถามใหม่ (ปกติถามทุก 5 นาที)
    for _ in range(50):
        if client.get("/health").json()["chat_mode"] == "bot":
            break
        time.sleep(0.02)

    res = client.post("/internal/handoff", json={"line_user_id": USER}, headers=KEY)
    assert res.status_code == 409
    assert res.json()["reason"] == "chat_off"
    assert say("ยกเลิก"), "บอทต้องยังตอบอยู่"
