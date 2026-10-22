"""เทสต์ "ให้คะแนนหลังปิดงาน" และ "ยังมีปัญหาอยู่" (ต.ค. 2026)

สิ่งที่ต้องไม่พังเด็ดขาด:
  - กดดาวได้แม้ session หมดอายุ (การ์ดเด้งมาตอนผู้ใช้ไม่ได้เปิดแชท กว่าจะกดอาจผ่านไปหลายชั่วโมง)
  - ดาวต่ำถามความเห็นต่อได้ แต่ต้องข้ามได้เสมอ และห้ามยึดเรื่องที่ผู้ใช้กรอกค้างไว้มาถาม
  - ข้อความที่ไม่ใช่ความเห็น (ปุ่ม rich menu / รูป) ต้องไม่ถูกบันทึกเป็นข้อติของทีม IT
  - กด "ยังมีปัญหาอยู่" แล้วบอทต้องเงียบให้เจ้าหน้าที่คุยต่อ ไม่ตอบแทรกเรื่องที่เจ้าหน้าที่กำลังประสานอยู่
"""

from __future__ import annotations

import pytest

from app import flow as F
from app import messages as M
from app.flow import Incoming, handle
from app.store import Session
from test_flow import USER, FakeBackend, postback, store, text

CODE = "ITRQ2026100158"


def star(score: int, code: str = CODE) -> Incoming:
    return Incoming(kind="postback", user_id=USER, data={"a": "rate", "code": code, "s": str(score)},
                    display_name="Film")


# ---------------------------------------------------------------- กดดาว


@pytest.mark.asyncio
async def test_ให้4ถึง5ดาวแล้วขอบคุณจบเลยไม่ถามต่อ():
    s, backend = store(), FakeBackend()
    r = await handle(star(5), s, backend)
    assert backend.rates == [{"ticket_code": CODE, "line_user_id": USER, "score": 5,
                              "comment": None, "viewer_name": "Film"}]
    assert "5/5" in r[0].text
    assert await s.get(USER) is None, "ไม่ต้องรออะไรต่อ = ห้ามค้าง session ไว้"


@pytest.mark.asyncio
@pytest.mark.parametrize("score", [1, 2, 3])
async def test_ให้ดาวต่ำแล้วถามความเห็นต่อแต่ข้ามได้(score):
    s, backend = store(), FakeBackend()
    r = await handle(star(score), s, backend)
    assert "ปรับปรุง" in r[0].text
    assert r[0].quick == [("ข้าม", f"a=rate_skip&code={CODE}")]
    session = await s.get(USER)
    assert session.step == F.RATE_COMMENT
    assert session.rate_code == CODE


@pytest.mark.asyncio
async def test_พิมพ์ความเห็นหลังดาวต่ำแล้วบันทึกกับเรื่องเดิม():
    s, backend = store(), FakeBackend()
    await handle(star(2), s, backend)
    r = await handle(text("รอช่างนานเกินไปครับ"), s, backend)
    assert backend.rates[-1]["comment"] == "รอช่างนานเกินไปครับ"
    assert backend.rates[-1]["score"] is None, "ส่งแค่ความเห็น — คะแนนเดิมต้องไม่ถูกส่งทับ"
    assert backend.rates[-1]["ticket_code"] == CODE
    assert "ได้รับความเห็นแล้ว" in r[0].text
    assert await s.get(USER) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("how", ["button", "typed", "dash"])
async def test_ข้ามความเห็นได้ทั้งกดปุ่มและพิมพ์(how):
    s, backend = store(), FakeBackend()
    await handle(star(1), s, backend)
    incoming = {
        "button": postback({"a": "rate_skip", "code": CODE}),
        "typed": text("ข้าม"),
        "dash": text("-"),
    }[how]
    r = await handle(incoming, s, backend)
    assert "ขอบคุณที่ให้คะแนน" in r[0].text
    assert len(backend.rates) == 1, "ข้ามแล้วต้องไม่ส่งอะไรไปหลังบ้านอีก"
    assert await s.get(USER) is None


@pytest.mark.asyncio
async def test_กดปุ่ม_rich_menu_ตอนบอทรอความเห็นต้องไม่ถูกเก็บเป็นข้อติ():
    s, backend = store(), FakeBackend()
    await handle(star(2), s, backend)
    await handle(text("แจ้งซ่อม"), s, backend)
    assert all(rate["comment"] is None for rate in backend.rates), "ป้ายปุ่มต้องไม่กลายเป็นความเห็น"
    session = await s.get(USER)
    assert session is None or session.step != F.RATE_COMMENT


@pytest.mark.asyncio
async def test_ส่งรูปตอนบอทรอความเห็นถือเป็นเรื่องใหม่():
    s, backend = store(), FakeBackend()
    await handle(star(2), s, backend)
    await handle(Incoming(kind="image", user_id=USER, image_url="/uploads/tickets/a.jpg"), s, backend)
    session = await s.get(USER)
    assert session.step == F.ASK_BRANCH
    assert session.image_urls == ["/uploads/tickets/a.jpg"]
    assert len(backend.rates) == 1


@pytest.mark.asyncio
async def test_บันทึกความเห็นไม่สำเร็จแล้วพิมพ์ส่งใหม่ได้เลย():
    s, backend = store(), FakeBackend()
    await handle(star(3), s, backend)
    backend.fail_rate = True
    r = await handle(text("ช้า"), s, backend)
    assert "ไม่สำเร็จ" in r[0].text
    assert (await s.get(USER)).step == F.RATE_COMMENT, "ต้องยังรอความเห็นอยู่ ไม่งั้นต้องย้อนไปกดดาวใหม่"

    backend.fail_rate = False
    r = await handle(text("ช้า"), s, backend)
    assert "ได้รับความเห็นแล้ว" in r[0].text


def test_ตัดความเห็นยาวแบบนับเหมือน_JavaScript():
    """หลังบ้านนับ UTF-16 (อีโมจิ = 2) — ตัดด้วย len() ของ Python แล้วจะเกินเพดานฝั่งนั้น"""
    assert F._clip_utf16("ก" * 600, 500) == "ก" * 500
    clipped = F._clip_utf16("😡" * 300, 500)
    assert len(clipped.encode("utf-16-le")) // 2 <= 500
    assert len(clipped) == 250
    assert F._clip_utf16("สั้นๆ", 500) == "สั้นๆ"


@pytest.mark.asyncio
async def test_กดดาวระหว่างแจ้งเรื่องใหม่ค้างอยู่ต้องไม่ทำให้เรื่องที่กรอกหาย():
    s, backend = store(), FakeBackend()
    draft = Session(step=F.ASK_DESC, branch="สำนักงานใหญ่", ticket_type="repair",
                    requester_name="สมชาย ใจดี", rq_checked=True)
    await s.set(USER, draft)

    r = await handle(star(1), s, backend)
    assert "1/5" in r[0].text
    session = await s.get(USER)
    assert session.step == F.ASK_DESC, "ห้ามยึด session มาถามความเห็น"
    assert session.branch == "สำนักงานใหญ่"
    assert len(r) == 2, "ต้องพากลับเข้าคำถามเดิมด้วย ไม่ปล่อยให้ค้างว่าต้องทำอะไรต่อ"


@pytest.mark.asyncio
async def test_กดดาวระหว่างคุยกับเจ้าหน้าที่ได้คำตอบ_และยังคุยกับเจ้าหน้าที่ต่อ():
    s, backend = store(), FakeBackend()
    await handle(postback({"a": "human"}), s, backend)

    r = await handle(star(2), s, backend)
    assert "2/5" in r[0].text
    session = await s.get(USER)
    assert session.in_handoff(), "กดดาวต้องไม่ตัดการคุยกับเจ้าหน้าที่"
    assert session.step != F.RATE_COMMENT
    assert await handle(text("ยังไม่ได้เลยครับ"), s, backend) == [], "บอทต้องยังเงียบอยู่"


@pytest.mark.asyncio
async def test_หลังบ้านปฏิเสธคะแนนแล้วบอกเหตุผลที่ทำต่อได้():
    backend = FakeBackend()
    backend.rate_result = {"ok": False, "reason": "not_owner"}
    r = await handle(star(5), store(), backend)
    assert "ไม่ได้แจ้งจากบัญชีนี้" in r[0].text

    backend.rate_result = {"ok": False, "reason": "not_completed", "status": "in_progress"}
    r = await handle(star(5), store(), backend)
    assert "ยังไม่ได้ปิดงาน" in r[0].text
    assert M.TICKET_STATUS_LABEL["in_progress"] in r[0].text

    backend.fail_rate = True
    r = await handle(star(5), store(), backend)
    assert len(r) == 1 and r[0].text


@pytest.mark.asyncio
@pytest.mark.parametrize("data", [
    {"a": "rate", "code": CODE, "s": "9"},
    {"a": "rate", "code": CODE, "s": "x"},
    {"a": "rate", "s": "5"},
])
async def test_ข้อมูลดาวเพี้ยนไม่ยิงหลังบ้าน(data):
    backend = FakeBackend()
    r = await handle(postback(data), store(), backend)
    assert backend.rates == []
    assert r[0].quick == M.MENU_BUTTONS


def test_session_เก็บเลขที่เรื่องที่รอความเห็นข้าม_Redis_ได้():
    restored = Session.from_json(Session(step=F.RATE_COMMENT, rate_code=CODE).to_json())
    assert restored.step == F.RATE_COMMENT
    assert restored.rate_code == CODE


# ---------------------------------------------------------------- ยังมีปัญหาอยู่ -> คุยกับเจ้าหน้าที่


@pytest.mark.asyncio
async def test_กดยังมีปัญหาอยู่แล้วบอทเงียบให้เจ้าหน้าที่คุยต่อ():
    s, backend = store(), FakeBackend()
    r = await handle(postback({"a": "confirm", "code": CODE, "v": "0"}), s, backend)
    assert backend.confirms[0][2] == "reject"
    assert "เจ้าหน้าที่" in r[0].text
    assert M.RESUME_BUTTON in r[0].quick, "ต้องมีทางกลับมาใช้บอทเสมอ"
    assert (await s.get(USER)).in_handoff()

    # อาการที่เล่าต่อเป็นของเจ้าหน้าที่ — บอทห้ามตีความเป็นเรื่องใหม่แล้วถามสาขาแทรก
    assert await handle(text("ปริ้นเตอร์ยังกระดาษติดอยู่เลยครับ"), s, backend) == []


@pytest.mark.asyncio
async def test_ปิด_Chat_ใน_OA_อยู่_กดยังมีปัญหาแล้วไม่สลับไปคุยกับเจ้าหน้าที่():
    s, backend = store(), FakeBackend()
    r = await handle(postback({"a": "confirm", "code": CODE, "v": "0"}), s, backend,
                     handoff_available=False)
    assert "ตรวจสอบอีกครั้ง" in r[0].text
    assert M.RESUME_BUTTON not in r[0].quick
    session = await s.get(USER)
    assert session is None or not session.in_handoff(), "ไม่มีใครเห็นแชท ห้ามรับปากว่าเจ้าหน้าที่จะคุยต่อ"


@pytest.mark.asyncio
async def test_ปิดงานไปเกินกำหนดแล้วบอกให้แจ้งเรื่องใหม่():
    s, backend = store(), FakeBackend()
    backend.confirm_result = {"ok": False, "reason": "reopen_expired", "status": "completed", "reopen_days": 14}
    r = await handle(postback({"a": "confirm", "code": CODE, "v": "0"}), s, backend)
    assert "14 วัน" in r[0].text
    assert "แจ้งเรื่องใหม่" in r[0].text
    session = await s.get(USER)
    assert session is None or not session.in_handoff()


@pytest.mark.asyncio
async def test_กดยังมีปัญหาซ้ำหลังเปิดเรื่องไปแล้วไม่ตอบว่ารอยืนยัน():
    backend = FakeBackend()
    backend.confirm_result = {"ok": False, "reason": "not_resolved", "status": "in_progress"}
    r = await handle(postback({"a": "confirm", "code": CODE, "v": "0"}), store(), backend)
    assert "ไม่ต้องกดซ้ำ" in r[0].text
    assert "รอยืนยัน" not in r[0].text


@pytest.mark.asyncio
async def test_กดเรียบร้อยแล้วบนการ์ดเก่าได้ปุ่มดาวให้คะแนนต่อ():
    backend = FakeBackend()
    r = await handle(postback({"a": "confirm", "code": CODE, "v": "1"}), store(), backend)
    assert [data for _, data in r[0].quick] == [f"a=rate&code={CODE}&s={n}" for n in range(1, 6)]
    for label, data in r[0].quick:
        assert len(label) <= M.MAX_QUICK_REPLY_LABEL
        assert len(data.encode()) <= 300
