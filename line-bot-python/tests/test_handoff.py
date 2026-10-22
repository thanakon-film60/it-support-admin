"""เทสต์ "ส่งต่อให้เจ้าหน้าที่" — ลูกค้าขอคุยกับคน แล้วทีม IT ตอบเองในแอป LINE Official Account

สิ่งที่ต้องไม่พังเด็ดขาด:
  - ระหว่างคุยกับเจ้าหน้าที่ บอทต้องเงียบสนิท (ไม่งั้นจะตอบ "ไม่พบสาขา" แทรกทุกประโยค)
  - ทางกลับมาใช้บอทต้องมีเสมอ: ปุ่ม / พิมพ์ "ยกเลิก" "เมนู" / กด rich menu / หมดเวลาเอง
  - Chat ใน OA Manager ปิดอยู่ = ห้ามรับปากว่าส่งต่อแล้ว เพราะไม่มีใครเห็นข้อความ
  - "อ่านแล้ว" ในแอป LINE OA ต้องเหลือไว้เฉพาะแชทที่รอคน (ดู main._mark_read)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys
import time
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import flow as F  # noqa: E402
from app import messages as M  # noqa: E402
from app.flow import Incoming, handle, wants_human  # noqa: E402
from app.richmenu import MAIN_BUTTONS, RETIRED_BUTTON_TEXTS  # noqa: E402
from app.store import MemoryStore, RedisStore, Session  # noqa: E402
from test_flow import USER, FakeBackend, postback, store, text  # noqa: E402

HOUR = 3600


def image(url: str | None = "https://example.test/a.jpg") -> Incoming:
    return Incoming(kind="image", user_id=USER, image_url=url)


def sticker() -> Incoming:
    return Incoming(kind="unsupported", user_id=USER)


async def start_handoff(s, backend, **kw):
    r = await handle(postback({"a": "human"}), s, backend, **kw)
    assert len(r) == 1 and "ส่งต่อให้ทีม IT" in r[0].text
    return r


# ------------------------------------------------------------------ เริ่มส่งต่อ


async def test_กดปุ่มคุยกับเจ้าหน้าที่แล้วบอทรับปากและบอกทางกลับ():
    s, backend = store(), FakeBackend()
    before = time.time()
    r = await start_handoff(s, backend)
    # ปุ่มกลับมาใช้บอทต้องปักไว้เหนือแป้นพิมพ์ทันที ไม่งั้นคนที่กดเล่นจะนึกว่าบอทเสีย
    assert r[0].quick == [M.RESUME_BUTTON]
    assert r[0].keep_unread, "ต้องค้าง 'ยังไม่อ่าน' ไว้ให้ทีม IT เห็นในแอป LINE OA"
    session = await s.get(USER)
    assert session is not None and session.in_handoff()
    # ค่าเริ่มต้น 24 ชม. นับจากตอนกด
    assert before + 23.9 * HOUR < session.handoff_until < time.time() + 24.1 * HOUR


@pytest.mark.parametrize(
    "typed",
    ["ขอคุยกับเจ้าหน้าที่", "ติดต่อแอดมินหน่อยค่ะ", "แอดมิน", "👤 คุยกับเจ้าหน้าที่", "ขอคุยกับทีม IT ครับ"],
)
async def test_พิมพ์ขอคุยกับคนเองก็ส่งต่อได้(typed):
    s, backend = store(), FakeBackend()
    r = await handle(text(typed), s, backend)
    assert "ส่งต่อให้ทีม IT" in r[0].text
    assert (await s.get(USER)).in_handoff()


async def test_ขอซ้ำระหว่างรอ_ได้คำยืนยันแทนการเริ่มใหม่_และต่อเวลา(monkeypatch):
    s, backend = store(), FakeBackend()
    await start_handoff(s, backend)
    first = (await s.get(USER)).handoff_until

    monkeypatch.setattr(F.time, "time", lambda: first - 20 * HOUR)  # ผ่านไป 4 ชม.
    r = await handle(text("ขอคุยกับเจ้าหน้าที่ครับ"), s, backend)
    assert "แจ้งทีม IT ไว้แล้ว" in r[0].text and r[0].keep_unread
    assert (await s.get(USER)).handoff_until == pytest.approx(first + 4 * HOUR)


async def test_ขอคุยกับคนกลางขั้นตอนแจ้งเรื่อง_ทิ้งขั้นตอนเดิม():
    s, backend = store(), FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สำนักงานใหญ่"), s, backend)
    assert (await s.get(USER)).branch == "สำนักงานใหญ่"

    await start_handoff(s, backend)
    session = await s.get(USER)
    assert session.step == F.IDLE and session.branch is None


# ------------------------------------------------------------------ ระหว่างคุยกับเจ้าหน้าที่


async def test_ระหว่างคุยกับเจ้าหน้าที่บอทเงียบสนิท_ไม่ว่าส่งอะไรมา():
    s, backend = store(), FakeBackend()
    await start_handoff(s, backend)

    for incoming in (
        text("เครื่องปริ้นที่สาขาต่อ wifi ยังไงครับ"),
        text("สำนักงานใหญ่"),  # ชื่อสาขา — ปกติจะพาเข้าขั้นตอนแจ้งเรื่อง
        text("คีย์บอร์ดเสีย"),  # ปกติจะเปิดเรื่องแจ้งซ่อม
        image(),
        sticker(),
    ):
        assert await handle(incoming, s, backend) == []

    session = await s.get(USER)
    assert session.in_handoff() and session.step == F.IDLE
    assert session.image_urls == [], "รูประหว่างคุยกับคนเป็นของเจ้าหน้าที่ ไม่ใช่ของ ticket"
    assert backend.created == []


async def test_ข้อความระหว่างคุยต่อเวลาออกไปนับจากข้อความล่าสุด(monkeypatch):
    s, backend = store(), FakeBackend()
    await start_handoff(s, backend)
    started = (await s.get(USER)).handoff_until - 24 * HOUR

    later = started + 20 * HOUR
    monkeypatch.setattr(F.time, "time", lambda: later)
    assert await handle(text("ยังไม่ได้เลยครับ"), s, backend) == []
    assert (await s.get(USER)).handoff_until == pytest.approx(later + 24 * HOUR)


async def test_ปุ่มดูข้อมูลบนการ์ดเก่ากดได้โดยไม่ตัดการคุยกับเจ้าหน้าที่():
    s, backend = store(), FakeBackend()
    await start_handoff(s, backend)

    r = await handle(postback({"a": "ticket", "code": "ITRQ2026090158"}), s, backend)
    assert r, "ปุ่มเช็คสถานะต้องตอบตามปกติ"
    r = await handle(postback({"a": "my_assets"}), s, backend)
    assert r
    assert (await s.get(USER)).in_handoff()


# ------------------------------------------------------------------ กลับมาใช้บอท


async def test_กดกลับไปใช้บอท_บอทกลับมาตอบทันที():
    s, backend = store(), FakeBackend()
    await start_handoff(s, backend)

    r = await handle(postback({"a": "bot_resume"}), s, backend)
    assert "กลับมาใช้บอทแล้ว" in r[0].text
    assert r[0].quick == M.MENU_BUTTONS
    assert await s.get(USER) is None

    r = await handle(postback({"a": "start"}), s, backend)
    assert "เลือกบริษัท" in r[0].text


@pytest.mark.parametrize("typed", ["ยกเลิก", "เมนู", "กลับไปใช้บอทครับ", "🤖 กลับไปใช้บอท", "bot"])
async def test_พิมพ์คำว่ายกเลิกหรือเมนู_ก็กลับมาใช้บอท(typed):
    s, backend = store(), FakeBackend()
    await start_handoff(s, backend)
    r = await handle(text(typed), s, backend)
    assert "กลับมาใช้บอทแล้ว" in r[0].text
    assert await s.get(USER) is None


# รวมป้ายของปุ่มที่ถอดออกแล้ว — มือถือที่ยังแคชเมนู 4 ปุ่มเดิมกดแล้วต้องได้ผลเหมือนกดเมนูปัจจุบัน
@pytest.mark.parametrize("label", [b["text"] for b in MAIN_BUTTONS] + list(RETIRED_BUTTON_TEXTS))
async def test_กด_rich_menu_ระหว่างคุย_บอทรับไปทำต่อเลย(label):
    s, backend = store(), FakeBackend()
    await start_handoff(s, backend)
    r = await handle(text(label), s, backend)
    assert r, "กดเมนูแล้วต้องได้คำตอบจากบอททันที ไม่ใช่เงียบ"
    session = await s.get(USER)
    assert session is None or not session.in_handoff()


async def test_กดปุ่มอื่นของบอทระหว่างคุย_ถือว่ากลับมาใช้บอท():
    s, backend = store(), FakeBackend()
    await start_handoff(s, backend)
    r = await handle(postback({"a": "start"}), s, backend)
    assert "เลือกบริษัท" in r[0].text
    session = await s.get(USER)
    assert session.step == F.ASK_BRANCH and not session.in_handoff()


async def test_หมดเวลาแล้วบอทกลับมาตอบเอง(monkeypatch):
    s, backend = store(), FakeBackend()
    await start_handoff(s, backend)
    until = (await s.get(USER)).handoff_until

    monkeypatch.setattr(F.time, "time", lambda: until + 1)
    r = await handle(postback({"a": "start"}), s, backend)
    assert "เลือกบริษัท" in r[0].text


async def test_ปุ่มกลับไปใช้บอทเก่าที่กดหลังหมดเวลา_ไม่ทำให้ขั้นตอนที่ทำอยู่หาย():
    s, backend = store(), FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    r = await handle(postback({"a": "bot_resume"}), s, backend)
    assert "กลับมาใช้บอทแล้ว" in r[0].text
    assert (await s.get(USER)).step == F.ASK_BRANCH


# ------------------------------------------------------------------ Chat ใน OA Manager ปิดอยู่


async def test_chat_ปิดอยู่_ไม่รับปากว่าส่งต่อ():
    s, backend = store(), FakeBackend()
    for incoming in (postback({"a": "human"}), text("ขอคุยกับเจ้าหน้าที่")):
        r = await handle(incoming, s, backend, handoff_available=False)
        assert "ยังไม่เปิดให้คุยกับเจ้าหน้าที่" in r[0].text
        assert M.HUMAN_BUTTON not in r[0].quick, "กดซ้ำก็ได้คำตอบเดิม ไม่ต้องมีปุ่มให้วน"
    session = await s.get(USER)
    assert session is None or not session.in_handoff()


async def test_chat_ถูกปิดระหว่างคุย_บอทกลับมาตอบแทน():
    s, backend = store(), FakeBackend()
    await start_handoff(s, backend)
    r = await handle(postback({"a": "start"}), s, backend, handoff_available=False)
    assert "เลือกบริษัท" in r[0].text
    r = await handle(text("ยังอยู่ไหมครับ"), s, backend, handoff_available=False)
    assert r, "ไม่มีใครเห็นแชทแล้ว บอทต้องตอบ ไม่ใช่เงียบ"


async def test_chat_ปิดอยู่_ข้อความที่บอทไม่เข้าใจไม่ชวนกดคุยกับเจ้าหน้าที่():
    s, backend = store(), FakeBackend()
    r = await handle(text("ฟหกด่าสว"), s, backend, handoff_available=False)
    assert "ไม่พบสาขา" in r[0].text
    assert M.HUMAN_BUTTON not in r[-1].quick


# ------------------------------------------------------------------ ปุ่มคุยกับเจ้าหน้าที่อยู่ตรงไหนบ้าง


def test_เมนูหลักมีปุ่มคุยกับเจ้าหน้าที่_และป้ายไม่เกินลิมิตของ_LINE():
    assert M.HUMAN_BUTTON in M.MENU_BUTTONS
    assert M.HUMAN_BUTTON in M.welcome("ฟิล์ม").quick
    # การ์ดต้อนรับ (คนที่เพิ่งแอดเห็นการ์ดนี้ก่อนอย่างอื่น) ต้องมีปุ่มนี้ด้วย
    assert '"a=human"' in json.dumps(M.welcome("ฟิล์ม").flex)
    for label, data in [*M.MENU_BUTTONS, M.RESUME_BUTTON]:
        assert len(label) <= M.MAX_QUICK_REPLY_LABEL, label
        assert len(data.encode()) <= 300
    assert len({d for _, d in M.MENU_BUTTONS}) == len(M.MENU_BUTTONS)


async def test_ข้อความแรกที่บอทไม่เข้าใจ_ชวนเลือกสาขาหรือคุยกับเจ้าหน้าที่():
    """เดิมตอบ 'ไม่พบสาขา' — คนที่พิมพ์ถามเรื่องนอกขอบเขตบอทมาอ่านแล้วงงว่าทำไมโดนถามสาขา"""
    s, backend = store(), FakeBackend()
    r = await handle(text("ขอเปลี่ยนรหัส wifi ห้องประชุม"), s, backend)
    assert len(r) == 2
    assert "ยังไม่เข้าใจข้อความนี้" in r[0].text and "คุยกับเจ้าหน้าที่" in r[0].text
    assert r[0].keep_unread, "บอทช่วยไม่ได้ = ค้าง 'ยังไม่อ่าน' ไว้ให้ทีม IT เห็น"
    assert "เลือกบริษัท" in r[1].text and r[1].flex is not None
    assert M.HUMAN_BUTTON in r[1].quick
    assert r[1].quick[-1] == ("❌ ยกเลิก", "a=cancel"), "ปุ่มยกเลิกต้องอยู่ท้ายสุดเหมือนเดิม"
    # ยังเลือกสาขาต่อได้ตามปกติ
    assert (await s.get(USER)).step == F.ASK_BRANCH


async def test_ตอนถามสาขาแล้วพิมพ์ไม่ตรง_ก็มีปุ่มคุยกับเจ้าหน้าที่():
    s, backend = store(), FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    r = await handle(text("สาขาที่ไม่มีอยู่จริงเลย"), s, backend)
    assert "ไม่พบสาขา" in r[0].text
    assert M.HUMAN_BUTTON in r[1].quick


def test_เติมปุ่มคุยกับเจ้าหน้าที่ตอนปุ่มเต็ม_ยังเก็บปุ่มยกเลิกไว้ท้ายสุด():
    full = M.Reply(
        text="x",
        quick=[(f"สาขา {i}", f"a=branch&v={i}") for i in range(12)] + [("❌ ยกเลิก", "a=cancel")],
    )
    out = F._with_human_button(full)
    assert len(out.quick) == M.MAX_QUICK_REPLY_ITEMS
    assert out.quick[-2] == M.HUMAN_BUTTON and out.quick[-1] == ("❌ ยกเลิก", "a=cancel")
    assert full.quick[-2] != M.HUMAN_BUTTON, "ห้ามแก้ของเดิมในที่ (Reply ใช้ร่วมกันได้)"
    assert F._with_human_button(out).quick == out.quick, "เติมซ้ำต้องไม่ได้ปุ่มสองอัน"


# ------------------------------------------------------------------ จับคำขอคุยกับคน


@pytest.mark.parametrize(
    "typed",
    [
        "ขอคุยกับเจ้าหน้าที่", "คุยกับเจ้าหน้าที่ครับ", "ติดต่อเจ้าหน้าที่ยังไง", "ขอสายเจ้าหน้าที่",
        "เจ้าหน้าที่ครับ", "admin", "คุยกับคนจริงๆ ได้ไหม", "ติดต่อฝ่ายไอที", "ช่วยติดต่อเจ้าหน้าที่ให้หน่อย",
        "คุยกับเจ้าหน้าที่เรื่องปริ้นเตอร์", "talk to human", "จนท.",
    ],
)
def test_จับคำขอคุยกับคนได้(typed):
    assert wants_human(typed)


@pytest.mark.parametrize(
    "typed",
    [
        "เจ้าหน้าที่บอกให้แจ้งซ่อมจอ", "ไม่ต้องการคุยกับเจ้าหน้าที่", "คอมเปิดไม่ติด", "ถามหน่อย",
        "สอบถามค่ะ", "แจ้งซ่อม", "it", "ไอที", "ขอบคุณครับ", "ขอเบิกเมาส์",
        "คุยกับเจ้าหน้าที่เรื่องเครื่องปริ้นที่สาขาภูเก็ตเสียตั้งแต่เมื่อวานแล้วยังไม่มีใครมาดูเลยครับ",
    ],
)
def test_ไม่จับประโยคที่แค่มีคำว่าเจ้าหน้าที่ปนอยู่(typed):
    assert not wants_human(typed)


def test_ข้อความจาก_rich_menu_ตรงกับที่บอทใช้จบการคุยกับเจ้าหน้าที่():
    """เปลี่ยนป้ายปุ่ม rich menu แล้วลืมตรงนี้ = กดเมนูระหว่างคุยกับเจ้าหน้าที่แล้วบอทเงียบ"""
    current = {b["text"] for b in MAIN_BUTTONS if b["type"] == "message"}
    assert F.RICH_MENU_TEXTS == current | set(RETIRED_BUTTON_TEXTS)
    assert all(not wants_human(t) for t in F.RICH_MENU_TEXTS)


# ------------------------------------------------------------------ อายุของ session ระหว่างส่งต่อ


async def test_session_ระหว่างส่งต่อไม่หมดอายุตาม_TTL_ปกติ(monkeypatch):
    s = MemoryStore(ttl_seconds=1800)
    now = 1_000_000.0
    monkeypatch.setattr("app.store.time.time", lambda: now)
    await s.set(USER, Session(handoff_until=now + 24 * HOUR))

    monkeypatch.setattr("app.store.time.time", lambda: now + 5 * HOUR)
    assert (await s.get(USER)) is not None, "30 นาทีปกติต้องไม่ลบคนที่รอเจ้าหน้าที่อยู่"

    monkeypatch.setattr("app.store.time.time", lambda: now + 25 * HOUR)
    assert (await s.get(USER)) is None, "หมดเวลาส่งต่อแล้ว ต้องหมดอายุตามปกติ"


async def test_redis_ยืดอายุ_key_ให้ถึงเวลาที่ส่งต่อ(monkeypatch):
    calls = []

    class FakeRedis:
        async def setex(self, key, ttl, value):
            calls.append((key, ttl, json.loads(value)))

    s = RedisStore.__new__(RedisStore)
    s._redis, s._ttl, s._prefix = FakeRedis(), 1800, "linebot:session:"
    now = 1_000_000.0
    monkeypatch.setattr("app.store.time.time", lambda: now)

    await s.set(USER, Session())
    await s.set(USER, Session(handoff_until=now + 24 * HOUR))
    assert calls[0][1] == 1800
    assert calls[1][1] == 24 * HOUR + 60
    assert calls[1][2]["handoff_until"] == now + 24 * HOUR


def test_session_เก่าที่ไม่มีฟิลด์ส่งต่อยังอ่านได้():
    old = json.dumps({"step": "ASK_BRANCH", "branch": "ภูเก็ต"})
    session = Session.from_json(old)
    assert session.handoff_until == 0.0 and not session.in_handoff()


# ------------------------------------------------------------------ main.py: อ่านแล้ว / ไม่โหลดรูป


def _sign(body: bytes) -> str:
    return base64.b64encode(hmac.new(b"test-secret", body, hashlib.sha256).digest()).decode()


def _message_event(n: int, message: dict) -> dict:
    return {
        "type": "message", "timestamp": n, "mode": "active",
        "source": {"type": "user", "userId": USER},
        "replyToken": f"reply-{n}", "webhookEventId": f"ev-{n}",
        "deliveryContext": {"isRedelivery": False},
        "message": {"id": f"m{n}", "quoteToken": f"q{n}", "markAsReadToken": f"read-{n}", **message},
    }


@pytest.fixture
def bot(monkeypatch):
    """แอปตัวจริง (FastAPI + ลายเซ็น + flow) แต่ LINE/หลังบ้านเป็นของปลอมทั้งหมด"""
    from fastapi.testclient import TestClient

    from app.line_api import LineApi
    from app.main import app, settings

    monkeypatch.setattr(settings, "line_channel_secret", "test-secret")
    monkeypatch.setattr(settings, "line_channel_access_token", "test-token")
    monkeypatch.setattr(settings, "internal_api_key", "test-key")
    monkeypatch.setattr(settings, "redis_url", "")
    monkeypatch.setattr(settings, "richmenu_auto_install", False)
    monkeypatch.setattr(settings, "ai_provider", "none")
    monkeypatch.setattr(settings, "accept_images", True)
    monkeypatch.setattr(settings, "mark_as_read", True)

    state = {"chat_mode": "chat"}
    monkeypatch.setattr(
        LineApi, "get_bot_info", AsyncMock(side_effect=lambda: {"chat_mode": state["chat_mode"]})
    )

    with TestClient(app) as client:
        line = app.state.line
        line.reply = AsyncMock()
        line.mark_as_read = AsyncMock(return_value=True)
        line.get_display_name = AsyncMock(return_value="Tester")
        line.get_message_content = AsyncMock(return_value=(b"img", "image/jpeg"))
        real_backend, real_knowledge = app.state.backend, app.state.knowledge
        app.state.backend = FakeBackend()
        app.state.knowledge = None
        # รอให้ถามสถานะ Chat รอบแรก (background) เสร็จก่อน
        for _ in range(50):
            if client.get("/health").json()["chat_mode"] != "unknown":
                break
            time.sleep(0.02)

        counter = {"n": 0}

        def send(message: dict) -> list:
            counter["n"] += 1
            line.reply.reset_mock()
            line.mark_as_read.reset_mock()
            body = json.dumps({"events": [_message_event(counter["n"], message)]}).encode()
            res = client.post("/webhook", content=body, headers={"x-line-signature": _sign(body)})
            assert res.status_code == 200
            if not line.reply.await_count:
                return []
            return line.reply.call_args.args[1]

        def say(value: str) -> list:
            return send({"type": "text", "text": value})

        try:
            yield client, app, line, send, say, state
        finally:
            # คืนของจริงก่อนปิดแอป — ตอนปิด lifespan จะเรียก backend.aclose()
            app.state.backend, app.state.knowledge = real_backend, real_knowledge


def test_webhook_สั่งอ่านแล้วเฉพาะข้อความที่บอทจัดการจบเอง(bot):
    client, app, line, send, say, _ = bot
    assert client.get("/health").json()["chat_mode"] == "chat"
    assert client.get("/health").json()["handoff_hours"] == 24.0

    # บอทจัดการเองจบ -> อ่านแล้ว
    replies = say("ยกเลิก")
    assert "ยกเลิกรายการแล้ว" in replies[0].text
    line.mark_as_read.assert_awaited_once_with("read-1")

    # ขอคุยกับคน -> ค้างไว้ให้ทีม IT เห็น
    replies = say("ขอคุยกับเจ้าหน้าที่")
    assert "ส่งต่อให้ทีม IT" in replies[0].text
    line.mark_as_read.assert_not_awaited()

    # ระหว่างคุย: บอทเงียบ ไม่สั่งอ่าน และไม่โหลดรูปมาเข้าระบบ
    assert say("เครื่องปริ้นต่อ wifi ไม่ได้ครับ") == []
    line.mark_as_read.assert_not_awaited()
    assert send({"type": "image", "contentProvider": {"type": "line"}}) == []
    line.get_message_content.assert_not_awaited()
    line.mark_as_read.assert_not_awaited()

    # กดกลับมาใช้บอท: ข้อความที่พิมพ์ถึงเจ้าหน้าที่ยังไม่มีใครเปิดดู -> ห้ามสั่งอ่านทับ
    replies = say("กลับไปใช้บอท")
    assert "กลับมาใช้บอทแล้ว" in replies[0].text
    line.mark_as_read.assert_not_awaited()

    # บอทไม่เข้าใจ -> ค้างไว้ให้ทีม IT เห็นว่ามีคนที่บอทช่วยไม่ได้
    replies = say("ขอเปลี่ยนรหัส wifi ห้องประชุม")
    assert "ยังไม่เข้าใจข้อความนี้" in replies[0].text
    line.mark_as_read.assert_not_awaited()

    # กลับมาคุยกับบอทตามปกติ -> อ่านแล้วตามเดิม
    replies = say("ยกเลิก")
    line.mark_as_read.assert_awaited_once_with("read-7")

    # รูปตอนไม่ได้คุยกับเจ้าหน้าที่ยังโหลดเข้าระบบตามปกติ
    send({"type": "image", "contentProvider": {"type": "line"}})
    line.get_message_content.assert_awaited_once()


def test_webhook_chat_ปิดอยู่_ไม่ส่งต่อและไม่ยิงสั่งอ่านแล้ว(bot, monkeypatch):
    client, app, line, send, say, state = bot
    state["chat_mode"] = "bot"
    app.state.bot_info_checked_at = 0.0  # บังคับถามใหม่ (ปกติถามทุก 5 นาที)
    for _ in range(50):
        if client.get("/health").json()["chat_mode"] == "bot":
            break
        time.sleep(0.02)
    assert client.get("/health").json()["chat_mode"] == "bot"

    replies = say("ขอคุยกับเจ้าหน้าที่")
    assert "ยังไม่เปิดให้คุยกับเจ้าหน้าที่" in replies[0].text
    line.mark_as_read.assert_not_awaited()
    replies = say("ยกเลิก")
    assert "ยกเลิกรายการแล้ว" in replies[0].text
    line.mark_as_read.assert_not_awaited()
