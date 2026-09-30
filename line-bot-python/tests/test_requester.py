"""ขั้นตอน "ผู้แจ้งคือใคร" — ค้นจากทะเบียนพนักงาน แล้วจำไว้ไม่ต้องถามซ้ำ

ทำไมขั้นตอนนี้ต้องมีเทสต์ของตัวเอง: มันเป็นขั้นเดียวในบทสนทนาที่ "เขียนข้อมูลถาวร"
(ผูกบัญชี LINE เข้ากับพนักงาน 1 คน) ผูกผิดคนครั้งเดียวแล้ว ticket ทุกใบหลังจากนั้น
จะขึ้นชื่อคนอื่นโดยที่เจ้าตัวไม่มีทางรู้ — ต่างจากขั้นอื่นที่ผิดแล้วแก้ได้ในเรื่องนั้นเรื่องเดียว
"""

from __future__ import annotations

import pytest

from app import messages as M
from app.flow import handle
from app.store import Session
from test_flow import DEPARTMENTS, EMPLOYEES, FakeBackend, USER, postback, store, text
from test_ai import build_knowledge


class Knowledge:
    """คลังความรู้ที่ "มีทะเบียนพนักงาน" — ต่างจาก FakeKnowledgeCache ใน test_ai ที่ไม่มี

    จงใจแยกกัน: ชุดที่ไม่มีทะเบียนใช้ตรวจว่าเส้นทางถอยกลับ (พิมพ์ "ชื่อ - แผนก" เอง)
    ยังทำงานอยู่ ซึ่งเป็นสิ่งที่ต้องรับประกันสำหรับเว็บรุ่นเก่าที่ยังไม่ส่ง employees มา
    """

    def __init__(self):
        kb = build_knowledge()
        kb.employees = EMPLOYEES
        kb.departments = DEPARTMENTS
        self._kb = kb

    async def get(self):
        return self._kb

    def invalidate(self) -> None:
        pass


def _emp(code: str) -> dict:
    return next(e for e in EMPLOYEES if e["code"] == code)


async def _to_requester_step(s, backend, kb):
    """เดินบทสนทนาจนถึงขั้นถามผู้แจ้ง (แจ้งซ่อม ไม่ระบุทรัพย์สิน)"""
    await handle(postback({"a": "start"}), s, backend, knowledge=kb)
    await handle(text("สำนักงานใหญ่"), s, backend, knowledge=kb)
    await handle(postback({"a": "type", "v": "repair"}), s, backend, knowledge=kb)
    return await handle(postback({"a": "skip_asset"}), s, backend, knowledge=kb)


# ------------------------------------------------------------------ ค้นหา


@pytest.mark.asyncio
async def test_พิมพ์ชื่อเล่นแล้วเจอคนเดียวต้องให้ยืนยันก่อนผูก():
    s, backend, kb = store(), FakeBackend(), Knowledge()
    r = await _to_requester_step(s, backend, kb)
    assert "ผู้แจ้งคือใคร" in r[0].text

    r = await handle(text("ฟิล์ม"), s, backend, knowledge=kb)
    assert "ธนากร โฮงทอง" in r[0].text
    assert "ฝ่ายเทคโนโลยีสารสนเทศ" in r[0].text
    assert ("✅ ใช่ ฉันเอง", "a=rq_yes") in r[0].quick
    assert backend.bind_calls == [], "ยังไม่กดยืนยัน ห้ามผูกล่วงหน้า"


@pytest.mark.asyncio
async def test_กดยืนยันแล้วผูกบัญชีและเดินต่อไปขั้นรายละเอียด():
    s, backend, kb = store(), FakeBackend(), Knowledge()
    await _to_requester_step(s, backend, kb)
    await handle(text("A69048"), s, backend, knowledge=kb)

    r = await handle(postback({"a": "rq_yes"}), s, backend, knowledge=kb)

    assert backend.bind_calls == [(USER, "u-film")]
    session = await s.get(USER)
    assert session.requester_user_id == "u-film"
    assert session.requester_name == "ธนากร โฮงทอง"
    assert session.requester_department == "ฝ่ายเทคโนโลยีสารสนเทศ"
    assert "แจ้งในชื่อ: ธนากร โฮงทอง" in r[0].text
    assert ("👤 เปลี่ยนคนแจ้ง", "a=rq_change") in r[0].quick


@pytest.mark.asyncio
async def test_ชื่อซ้ํากันหลายคนต้องให้เลือกห้ามเดา():
    """"สมชาย" มี 2 คนในทะเบียน — เดาให้คนแรกคือการผูกผิดคนแบบถาวร"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    await _to_requester_step(s, backend, kb)

    r = await handle(text("สมชาย"), s, backend, knowledge=kb)

    assert "เจอ 2 คน" in r[0].text
    assert ("1. ชาย", "a=rq_pick&i=0") in r[0].quick
    assert backend.bind_calls == []

    r = await handle(postback({"a": "rq_pick", "i": "1"}), s, backend, knowledge=kb)
    assert backend.bind_calls == [(USER, "u-somchai2")]
    assert (await s.get(USER)).requester_name == "สมชาย ทองดี"


@pytest.mark.asyncio
async def test_ไม่เจอในทะเบียนต้องแจ้งเรื่องต่อได้ด้วยชื่อที่พิมพ์():
    """พนักงานใหม่ที่ HR ยังไม่ได้เพิ่มเข้าทะเบียนก็ต้องแจ้งซ่อมได้ ไม่งั้นคือปิดประตูใส่
    กลุ่มที่ต้องพึ่ง IT มากที่สุด"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    await _to_requester_step(s, backend, kb)

    r = await handle(text("สมหญิง มาใหม่ - ฝ่ายขาย"), s, backend, knowledge=kb)
    assert "ไม่พบ" in r[0].text
    assert ("✍️ ใช้ชื่อที่พิมพ์", "a=rq_manual") in r[0].quick

    await handle(postback({"a": "rq_manual"}), s, backend, knowledge=kb)
    session = await s.get(USER)
    assert session.requester_name == "สมหญิง มาใหม่"
    assert session.requester_department == "ฝ่ายขาย"
    assert session.requester_user_id is None, "คนนอกทะเบียนต้องไม่ถูกผูกกับแถวใดแถวหนึ่ง"
    assert backend.bind_calls == []


# ------------------------------------------------------------------ จำไว้ครั้งหน้า


@pytest.mark.asyncio
async def test_ผูกแล้วครั้งต่อไปไม่ถามชื่ออีก():
    """เหตุผลทั้งหมดของฟีเจอร์นี้อยู่ที่เทสต์ตัวนี้ — ถ้ายังถามอยู่ก็ไม่ได้แก้อะไรเลย"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    backend.bound_requester = _emp("A69048") | {"id": "u-film"}

    r = await _to_requester_step(s, backend, kb)

    assert "ผู้แจ้งคือใคร" not in r[0].text
    assert "แจ้งในชื่อ: ธนากร โฮงทอง" in r[0].text
    session = await s.get(USER)
    assert session.step == "ASK_DESC"
    assert session.requester_user_id == "u-film"


@pytest.mark.asyncio
async def test_ถามหลังบ้านเรื่องการผูกแค่ครั้งเดียวต่อบทสนทนา(monkeypatch):
    s, backend, kb = store(), FakeBackend(), Knowledge()
    calls: list[str] = []
    original = backend.get_requester

    async def counted(line_user_id: str):
        calls.append(line_user_id)
        return await original(line_user_id)

    backend.get_requester = counted
    await _to_requester_step(s, backend, kb)
    await handle(text("ฟิล์ม"), s, backend, knowledge=kb)
    await handle(postback({"a": "rq_yes"}), s, backend, knowledge=kb)

    assert len(calls) == 1, f"ยิงถามหลังบ้านซ้ำ {len(calls)} ครั้ง"


@pytest.mark.asyncio
async def test_กดเปลี่ยนคนแจ้งต้องถอดการผูกจริงไม่ใช่แค่ล้างใน_session():
    """ถ้าถอดแค่ใน session ครั้งหน้าบอทจะเติมชื่อเดิมกลับมาอีก ทั้งที่ผู้ใช้เพิ่งบอกว่าไม่ใช่"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    backend.bound_requester = _emp("A69048") | {"id": "u-film"}
    await _to_requester_step(s, backend, kb)

    r = await handle(postback({"a": "rq_change"}), s, backend, knowledge=kb)

    assert backend.bound_requester is None, "ต้องถอดการผูกที่หลังบ้านด้วย"
    assert "ผู้แจ้งคือใคร" in r[0].text
    session = await s.get(USER)
    assert session.requester_user_id is None and session.requester_name is None


@pytest.mark.asyncio
async def test_ส่ง_requester_user_id_ไปกับ_ticket():
    """ผูกกับแถวเดิมของคนนั้น ไม่ให้หลังบ้านเดาจากชื่อ (ชื่อสะกดต่างกัน = คนละแถว)"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    backend.bound_requester = _emp("A69048") | {"id": "u-film"}
    await _to_requester_step(s, backend, kb)
    await handle(text("จอไม่ติด"), s, backend, knowledge=kb)

    assert backend.created[0]["requester_user_id"] == "u-film"
    assert backend.created[0]["requester_name"] == "ธนากร โฮงทอง"
    assert backend.created[0]["requester_department"] == "ฝ่ายเทคโนโลยีสารสนเทศ"


# ------------------------------------------------------------------ เมนูฝ่าย


@pytest.fixture
def picker_on(monkeypatch):
    """เปิดเมนูเลือกผู้แจ้งเฉพาะในเทสต์

    ตอนนี้เมนูถูกปิดไว้ (M.REQUESTER_PICKER_ENABLED = False) แต่โค้ดยังอยู่ครบและต้องเปิดกลับได้
    ถ้าปล่อยให้เทสต์ชุดนี้หายไปตามธง วันที่เปิดกลับจะไม่เหลืออะไรยืนยันว่าเมนูยังทำงาน
    """
    monkeypatch.setattr(M, "REQUESTER_PICKER_ENABLED", True)


@pytest.mark.asyncio
async def test_เลือกจากเมนูฝ่ายแล้วไม่ต้องยืนยันซ้ํา(picker_on):
    """กดชื่อตัวเองจากฝ่ายตัวเองคือการเลือกที่ชัดเจนอยู่แล้ว การให้ยืนยันอีกชั้นคือการกดเปล่า"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    await _to_requester_step(s, backend, kb)

    r = await handle(postback({"a": "rq_menu"}), s, backend, knowledge=kb)
    assert "เลือกฝ่ายของคุณ" in r[0].text
    session = await s.get(USER)
    assert session.rq_level == "dept"
    assert session.rq_values[0] == "ฝ่ายบัญชีและการเงิน"

    r = await handle(postback({"a": "rq_dept", "i": "0"}), s, backend, knowledge=kb)
    assert "เลือกชื่อของคุณ" in r[0].text
    assert "ฝ่าย: ฝ่ายบัญชีและการเงิน" in r[0].text
    session = await s.get(USER)
    assert session.rq_level == "person"
    assert set(session.rq_values) == {"u-somchai1", "u-noi"}

    r = await handle(postback({"a": "rq_pick", "i": "0"}), s, backend, knowledge=kb)
    assert backend.bind_calls == [(USER, "u-somchai1")]
    assert (await s.get(USER)).requester_name == "สมชาย ใจดี"


@pytest.mark.asyncio
async def test_กดการ์ดเก่าที่ตัวเลือกไม่ตรงกับ_session_แล้วต้องเริ่มเลือกใหม่ไม่ใช่ผูกมั่ว(picker_on):
    s, backend, kb = store(), FakeBackend(), Knowledge()
    await _to_requester_step(s, backend, kb)
    await handle(postback({"a": "rq_menu"}), s, backend, knowledge=kb)

    r = await handle(postback({"a": "rq_pick", "i": "99"}), s, backend, knowledge=kb)

    assert "เลือกฝ่ายของคุณ" in r[0].text
    assert backend.bind_calls == []


@pytest.mark.asyncio
async def test_หลังบ้านไม่ส่งทะเบียนมาต้องถอยไปใช้การพิมพ์ชื่อแบบเดิม():
    """เว็บรุ่นเก่ายังไม่ส่ง employees มา — ห้ามตอบว่า "ไม่พบในทะเบียน" ทั้งที่ไม่มีทะเบียนให้ค้น"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    (await kb.get()).employees = []
    await _to_requester_step(s, backend, kb)

    await handle(text("สมชาย ใจดี - แผนกบัญชี"), s, backend, knowledge=kb)

    session = await s.get(USER)
    assert session.requester_name == "สมชาย ใจดี"
    assert session.requester_department == "แผนกบัญชี"
    assert session.step == "ASK_DESC"


@pytest.mark.asyncio
async def test_หลังบ้านล่มตอนถามการผูกต้องถามผู้ใช้ตามปกติไม่ใช่ค้าง():
    from app.backend import BackendError

    s, backend, kb = store(), FakeBackend(), Knowledge()

    async def boom(line_user_id: str):
        raise BackendError("ล่ม")

    backend.get_requester = boom
    r = await _to_requester_step(s, backend, kb)

    assert "ผู้แจ้งคือใคร" in r[0].text


@pytest.mark.asyncio
async def test_ผูกไม่สําเร็จก็ยังแจ้งเรื่องต่อได้():
    """การผูกเป็นความสะดวก ไม่ใช่เงื่อนไขของการแจ้งเรื่อง"""
    from app.backend import BackendError

    s, backend, kb = store(), FakeBackend(), Knowledge()

    async def boom(line_user_id: str, user_id: str):
        raise BackendError("ล่ม")

    backend.bind_requester = boom
    await _to_requester_step(s, backend, kb)
    await handle(text("ฟิล์ม"), s, backend, knowledge=kb)
    r = await handle(postback({"a": "rq_yes"}), s, backend, knowledge=kb)

    session = await s.get(USER)
    assert session.requester_name == "ธนากร โฮงทอง"
    assert session.step == "ASK_DESC"
    assert "แจ้งในชื่อ" in r[0].text


# ------------------------------------------------------------------ ปิดเมนูชั่วคราว


@pytest.mark.asyncio
async def test_ปิดเมนูแล้วต้องไม่เหลือปุ่มเลือกจากรายชื่อในข้อความไหนเลย():
    """ค่าตั้งต้นตอนนี้คือปิด — ขั้นระบุผู้แจ้งให้พิมพ์เองอย่างเดียว"""
    assert M.REQUESTER_PICKER_ENABLED is False

    emp = {"id": "u-film", "name": "ธนากร โฮงทอง", "nickname": "ฟิล์ม",
           "department": "ฝ่ายเทคโนโลยีสารสนเทศ"}
    replies = [
        M.ask_requester("repair"),
        M.requester_confirm(emp, "repair"),
        M.requester_not_found("ฟิล์ม", "repair"),
    ]
    for reply in replies:
        assert all(data != "a=rq_menu" for _, data in reply.quick), reply.text

    # ปุ่มที่เป็น "ทางออก" ของแต่ละข้อความต้องยังอยู่ครบ ไม่ใช่ถูกลบตามไปด้วย
    assert ("❌ ยกเลิก", "a=cancel") in M.ask_requester("repair").quick
    assert ("✍️ ใช้ชื่อที่พิมพ์", "a=rq_manual") in M.requester_not_found("x", "repair").quick
    # ห้ามชวนให้ "เลือกจากรายชื่อ" ทั้งที่ไม่มีปุ่มให้กด
    assert "เลือกจากรายชื่อ" not in M.requester_not_found("x", "repair").text


@pytest.mark.asyncio
async def test_กดปุ่มเมนูเก่าที่ค้างในแชทต้องถอยไปหน้าพิมพ์ชื่อ_ไม่ใช่เงียบ():
    """การ์ดที่ส่งไปแล้วลบออกจากห้องแชทของผู้ใช้ไม่ได้ ปุ่มเก่าจึงยังถูกกดได้เสมอ"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    await _to_requester_step(s, backend, kb)

    for data in ({"a": "rq_menu"}, {"a": "rq_page", "p": "1"}, {"a": "rq_dept", "i": "0"}):
        r = await handle(postback(data), s, backend, knowledge=kb)
        assert "คือใครครับ?" in r[0].text, data
        assert "เลือกฝ่าย" not in r[0].text, data
        session = await s.get(USER)
        assert session.step == "ASK_REQUESTER"
        assert session.rq_values == []


@pytest.mark.asyncio
async def test_ปิดเมนูแล้วการพิมพ์ชื่อค้นหายังทำงานครบเหมือนเดิม():
    """ปิดแค่เมนู ไม่ใช่ปิดการผูกกับทะเบียน — ทางหลัก (พิมพ์ชื่อ) ต้องไม่กระทบ"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    await _to_requester_step(s, backend, kb)

    r = await handle(text("ฟิล์ม"), s, backend, knowledge=kb)
    assert "ใช่ไหมครับ" in r[0].text

    await handle(postback({"a": "rq_yes"}), s, backend, knowledge=kb)
    assert backend.bind_calls == [(USER, "u-film")]
