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
from test_flow import DEPARTMENTS, EMPLOYEES, FakeBackend, USER, image, postback, store, text
from test_ai import build_knowledge


class Knowledge:
    """คลังความรู้ที่ "มีทะเบียนพนักงาน" — ต่างจาก FakeKnowledgeCache ใน test_ai ที่ไม่มี

    จงใจแยกกัน: ชุดที่ไม่มีทะเบียนใช้ตรวจว่าเส้นทางถอยกลับ (พิมพ์ "ชื่อ - แผนก" เอง)
    ยังทำงานอยู่ ซึ่งเป็นสิ่งที่ต้องรับประกันสำหรับเว็บรุ่นเก่าที่ยังไม่ส่ง employees มา
    """

    def __init__(self, employees: list[dict] | None = None):
        kb = build_knowledge()
        kb.employees = EMPLOYEES if employees is None else employees
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


# ------------------------------------------------------------------ พนักงานสาขา: หาตัวเองให้เจอ
#
# แถวจริงจากรายงานตารางเวลาการทำงาน ต.ค. 2026 (ชื่อ · ชื่อเล่น · ตำแหน่ง ตามไฟล์) — ชุดที่ค้นแบบเดิมแล้ว
# "พิมพ์ชื่อตัวเองถูกแต่หาตัวเองไม่เจอ" หรือ "เจอแต่แยกไม่ออกว่าคนไหนคือตัวเอง"
# เลือกผิดคนครั้งเดียว = บัญชี LINE ผูกกับคนอื่นถาวร ticket ทุกใบหลังจากนั้นขึ้นชื่อคนอื่น

BRANCH_STAFF = [
    {"id": "u-cream-spk", "code": "AS68012", "name": "วนิดา พันเพ็ง", "nickname": "ครีม",
     "department": "ฝ่ายขาย", "position": "พนักงานขายสาขาโรบินสันสมุทรปราการ"},
    {"id": "u-cream-imp", "code": "AS69091", "name": "แพรวรรณ ผาชา", "nickname": "ครีม",
     "department": "ฝ่ายขาย", "position": "พนักงานขายสาขาอิมพิเรียลเวิลด์สำโรง"},
    {"id": "u-namfon-nick", "code": "AS66019", "name": "วิจิตรา วงศ์เขียว", "nickname": "น้ำฝน",
     "department": "ฝ่ายขาย", "position": "พนักงานขายสาขาเซ็นทรัลลำปาง"},
    {"id": "u-namfon-first", "code": "AS67129", "name": "น้ำฝน หน่อคำ", "nickname": "ฝน",
     "department": "ฝ่ายขาย", "position": "พนักงานขายสาขาฟิวเจอร์พาร์ครังสิต"},
    {"id": "u-saetan", "code": "AS69063", "name": "รัชดาภรณ์ เเซ่ตั๋น", "nickname": "โมเมย์",
     "department": "ฝ่ายขาย", "position": "พนักงานขายสาขาเซ็นทรัลสุราษฎร์ธานี"},
]


@pytest.mark.asyncio
async def test_ชื่อเล่นซ้ำกัน_ต้องเห็นสาขาของแต่ละคน_และปุ่มต้องไม่หน้าตาเหมือนกัน():
    """"ครีม" 2 คนอยู่ฝ่ายขายทั้งคู่ — ถ้าโชว์แค่ฝ่าย 2 บรรทัดต่างกันแค่ชื่อจริง และปุ่มเป็น
    "1. ครีม" "2. ครีม" ผู้ใช้ต้องเดาว่าปุ่มไหนคือตัวเอง"""
    s, backend, kb = store(), FakeBackend(), Knowledge(EMPLOYEES + BRANCH_STAFF)
    await _to_requester_step(s, backend, kb)

    r = await handle(text("ครีม"), s, backend, knowledge=kb)

    assert "เจอ 2 คน" in r[0].text
    assert "พนักงานขายสาขาโรบินสันสมุทรปราการ" in r[0].text
    assert "พนักงานขายสาขาอิมพิเรียลเวิลด์สำโรง" in r[0].text
    assert [label for label, data in r[0].quick if data.startswith("a=rq_pick")] == ["1. วนิดา", "2. แพรวรรณ"]

    await handle(postback({"a": "rq_pick", "i": "1"}), s, backend, knowledge=kb)
    assert backend.bind_calls == [(USER, "u-cream-imp")]


@pytest.mark.asyncio
async def test_พิมพ์ชื่อจริงตัวเอง_ต้องเจอตัวเองแม้ชื่อนี้จะเป็นชื่อเล่นของคนอื่น():
    """"น้ำฝน" เป็นชื่อเล่นของคนหนึ่งและชื่อจริงของอีกคน — เดิมชั้น "ตรงเป๊ะ" นับแค่ชื่อเล่นแล้วหยุด
    เจ้าของชื่อจริงพิมพ์ชื่อตัวเองทีไรได้การ์ด "คือคนนี้ใช่ไหม" ของคนอื่นทุกครั้ง"""
    s, backend, kb = store(), FakeBackend(), Knowledge(EMPLOYEES + BRANCH_STAFF)
    await _to_requester_step(s, backend, kb)

    r = await handle(text("น้ำฝน"), s, backend, knowledge=kb)

    assert "เจอ 2 คน" in r[0].text
    assert "น้ำฝน หน่อคำ" in r[0].text
    assert "วิจิตรา วงศ์เขียว" in r[0].text


@pytest.mark.asyncio
async def test_นามสกุลที่ทะเบียนสะกดด้วยสระเอสองตัว_พิมพ์ด้วยสระแอก็ต้องเจอ():
    """"เเซ่ตั๋น" (เ+เ) กับ "แซ่ตั๋น" (แ) บนจอเหมือนกันทุกจุด เจ้าตัวไม่มีทางรู้ว่าทะเบียนสะกดแบบไหน
    — พิมพ์แค่นามสกุลเพราะชื่อเต็มยังพอให้ fuzzy เดาถูกได้ แต่คำสั้นๆ หลุด threshold"""
    s, backend, kb = store(), FakeBackend(), Knowledge(EMPLOYEES + BRANCH_STAFF)
    await _to_requester_step(s, backend, kb)

    r = await handle(text("แซ่ตั๋น"), s, backend, knowledge=kb)

    assert "ใช่ไหมครับ" in r[0].text
    assert "รัชดาภรณ์ เเซ่ตั๋น" in r[0].text
    assert "พนักงานขายสาขาเซ็นทรัลสุราษฎร์ธานี" in r[0].text, "การ์ดยืนยันต้องบอกสาขาด้วย ไม่ใช่แค่ฝ่าย"


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


# ------------------------------------------------------------------ เบิกจบที่ขั้นผู้เบิก
#
# ผลทดสอบจริง 28 ก.ย. 2026: เลือกของครบ ยืนยันผู้เบิกแล้ว บอทยังถาม "มีรายละเอียดเพิ่มเติมไหม"
# อีกขั้น ผู้ทดสอบขอให้จบทันทีหลังระบุผู้เบิก — ทุกทางที่ระบุผู้เบิกได้ (กดยืนยัน / เลือกจากชื่อซ้ำ /
# ใช้ชื่อที่พิมพ์ / บัญชีที่ผูกไว้แล้ว) ต้องจบเหมือนกันหมด ไม่งั้นจะเหลือบางทางที่ยังถามอยู่เงียบๆ
#
# ขั้นที่ตัดออกเคยเป็นที่เดียวที่มีปุ่ม "เปลี่ยนคนแจ้ง" ของบัญชีที่บอทเติมชื่อให้เอง
# บัญชีที่ผูกไว้จึงต้องเห็นการ์ด "ผู้เบิกคือคนนี้ใช่ไหม" พร้อมปุ่ม "ไม่ใช่ เปลี่ยนคน" แทน — ห้ามส่งเงียบๆ


async def _to_withdraw_requester_step(s, backend, kb):
    """เดินการเบิกจนถึงขั้นผู้เบิก (คีย์บอร์ด 2 ชิ้น ไม่ระบุทรัพย์สิน)"""
    await handle(postback({"a": "start"}), s, backend, knowledge=kb)
    await handle(text("สำนักงานใหญ่"), s, backend, knowledge=kb)
    await handle(postback({"a": "type", "v": "withdraw"}), s, backend, knowledge=kb)
    await handle(postback({"a": "skip_asset"}), s, backend, knowledge=kb)
    await handle(postback({"a": "item", "v": "st-1"}), s, backend, knowledge=kb)
    await handle(text("2"), s, backend, knowledge=kb)
    return await handle(postback({"a": "done_items"}), s, backend, knowledge=kb)


def _no_description_step(replies) -> bool:
    return all("มีรายละเอียดเพิ่มเติม" not in reply.text for reply in replies)


@pytest.mark.asyncio
async def test_เบิก_กดใช่ฉันเองแล้วได้ticketทันที_ไม่ถามรายละเอียดต่อ():
    """เคสตามภาพหน้าจอของผู้ทดสอบ: พิมพ์ชื่อ -> "ผู้เบิกคือคนนี้ใช่ไหม" -> กด "ใช่ ฉันเอง" แล้วต้องจบ"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    r = await _to_withdraw_requester_step(s, backend, kb)
    assert "ผู้เบิกคือใคร" in r[0].text

    r = await handle(text("ฟิล์ม"), s, backend, knowledge=kb)
    assert "ผู้เบิกคือคนนี้ใช่ไหม" in r[0].text
    assert M.SENDS_ON_CONFIRM in r[0].text, "กดแล้วส่งเลย ต้องบอกไว้ก่อนกด"
    assert not backend.created

    r = await handle(postback({"a": "rq_yes"}), s, backend, knowledge=kb)

    assert len(backend.created) == 1
    assert _no_description_step(r)
    assert "✅ รับเรื่องแล้วครับ!" in r[0].text
    payload = backend.created[0]
    assert payload["requester_user_id"] == "u-film"
    assert payload["items"] == [{"name": "คีย์บอร์ด", "qty": 2}]
    assert not payload["description"], "ไม่ได้พิมพ์อะไรเพิ่ม = ส่งค่าว่าง ให้หลังบ้านประกอบจากรายการเบิกเอง"
    assert backend.bind_calls == [(USER, "u-film")]
    assert await s.get(USER) is None, "จบแล้วต้องไม่ค้าง session"


@pytest.mark.asyncio
async def test_เบิก_ชื่อซ้ำกัน_เลือกคนแล้วได้ticketทันที():
    s, backend, kb = store(), FakeBackend(), Knowledge()
    await _to_withdraw_requester_step(s, backend, kb)

    r = await handle(text("สมชาย"), s, backend, knowledge=kb)
    assert "เจอ 2 คน" in r[0].text
    assert M.SENDS_ON_PICK in r[0].text

    r = await handle(postback({"a": "rq_pick", "i": "1"}), s, backend, knowledge=kb)
    assert len(backend.created) == 1
    assert backend.created[0]["requester_name"] == "สมชาย ทองดี"
    assert _no_description_step(r)


@pytest.mark.asyncio
async def test_เบิก_ไม่พบในทะเบียน_ใช้ชื่อที่พิมพ์แล้วได้ticketทันที():
    """พนักงานใหม่ที่ยังไม่อยู่ในทะเบียนก็ต้องเบิกจบได้ในจำนวนการกดเท่ากับคนอื่น"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    await _to_withdraw_requester_step(s, backend, kb)
    await handle(text("สมหญิง มาใหม่ - ฝ่ายขาย"), s, backend, knowledge=kb)

    r = await handle(postback({"a": "rq_manual"}), s, backend, knowledge=kb)

    assert len(backend.created) == 1
    payload = backend.created[0]
    assert payload["requester_name"] == "สมหญิง มาใหม่"
    assert payload["requester_user_id"] is None
    assert _no_description_step(r)


@pytest.mark.asyncio
async def test_เบิก_บัญชีที่ผูกไว้เห็นชื่อตัวเองแล้วกดยืนยันครั้งเดียว_ไม่ต้องพิมพ์ชื่ออีก():
    """เดิมกด "พอแล้ว" ทีไรถูกถามชื่อใหม่ทุกครั้ง ทั้งที่ข้อความของขั้นนั้นสัญญาว่า "ถามครั้งเดียว"
    และต้องไม่ส่งเงียบๆ ด้วย — เจ้าของบัญชีต้องได้เห็นว่ากำลังเบิกในชื่อใคร"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    backend.bound_requester = _emp("A69048") | {"id": "u-film"}

    r = await _to_withdraw_requester_step(s, backend, kb)

    assert "ผู้เบิกคือใคร" not in r[0].text, "ผูกแล้วต้องไม่ให้พิมพ์ชื่อซ้ำ"
    assert "ผู้เบิกคือคนนี้ใช่ไหม" in r[0].text
    assert "ธนากร โฮงทอง" in r[0].text
    assert M.SENDS_ON_CONFIRM in r[0].text
    assert not backend.created, "ต้องให้เห็นชื่อและกดยืนยันก่อน ห้ามส่งเงียบๆ"

    r = await handle(postback({"a": "rq_yes"}), s, backend, knowledge=kb)
    assert len(backend.created) == 1
    assert backend.created[0]["requester_user_id"] == "u-film"
    assert _no_description_step(r)


@pytest.mark.asyncio
async def test_เบิก_บัญชีที่ผูกผิดคน_กดไม่ใช่แล้วถอดการผูกและเลือกคนใหม่ได้():
    """ปุ่มนี้คือทางแก้เดียวในแชทของบัญชีที่ผูกผิดคน หลังจากการเบิกไม่มีขั้นรายละเอียดแล้ว"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    backend.bound_requester = _emp("A69048") | {"id": "u-film"}
    r = await _to_withdraw_requester_step(s, backend, kb)

    assert ("👤 ไม่ใช่ เปลี่ยนคน", "a=rq_change") in r[0].quick
    assert all(data != "a=rq_again" for _, data in r[0].quick), (
        "คนที่มาจากการผูกต้องถอดการผูกได้ ถ้าแค่ค้นใหม่ ครั้งหน้าบอทจะเสนอคนผิดคนเดิมอีก"
    )

    r = await handle(postback({"a": "rq_change"}), s, backend, knowledge=kb)
    assert backend.bound_requester is None
    assert "ผู้เบิกคือใคร" in r[0].text
    assert not backend.created

    await handle(text("มุก"), s, backend, knowledge=kb)
    await handle(postback({"a": "rq_yes"}), s, backend, knowledge=kb)
    assert len(backend.created) == 1
    assert backend.created[0]["requester_user_id"] == "u-noi"
    assert backend.bind_calls[-1] == (USER, "u-noi")


@pytest.mark.asyncio
async def test_เบิก_กดใช่ฉันเองซ้ำจากการ์ดเดิมต้องไม่ได้ticketใบที่สอง():
    """ปุ่ม "ใช่ ฉันเอง" ตอนนี้คือปุ่มส่งเรื่อง — กดรัวหรือกดการ์ดเดิมซ้ำต้องไม่ได้ของ 2 รอบ"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    await _to_withdraw_requester_step(s, backend, kb)
    await handle(text("ฟิล์ม"), s, backend, knowledge=kb)
    await handle(postback({"a": "rq_yes"}), s, backend, knowledge=kb)

    await handle(postback({"a": "rq_yes"}), s, backend, knowledge=kb)

    assert len(backend.created) == 1


@pytest.mark.asyncio
async def test_เบิก_ส่งไม่สำเร็จแล้วส่งรูปตามมา_ต้องชวนลองส่งใหม่_ไม่ใช่ถามรายละเอียด():
    s, backend, kb = store(), FakeBackend(fail_create=True), Knowledge()
    await _to_withdraw_requester_step(s, backend, kb)
    await handle(text("ฟิล์ม"), s, backend, knowledge=kb)
    r = await handle(postback({"a": "rq_yes"}), s, backend, knowledge=kb)
    assert ("🔁 ลองส่งใหม่", "a=retry_submit") in r[0].quick

    r = await handle(image(), s, backend, knowledge=kb)
    assert any(("🔁 ลองส่งใหม่", "a=retry_submit") in reply.quick for reply in r)
    assert _no_description_step(r)

    backend.fail_create = False
    await handle(postback({"a": "retry_submit"}), s, backend, knowledge=kb)
    assert len(backend.created) == 1
    assert backend.created[0]["image_urls"] == ["/uploads/tickets/a.jpg"]


@pytest.mark.asyncio
async def test_คืนอุปกรณ์ยังถามรายละเอียดหลังระบุผู้คืนเหมือนเดิม():
    """ตัดเฉพาะการเบิก — การคืนที่กดข้ามรหัสทรัพย์สินมา ขั้นรายละเอียดคือที่เดียวที่บอกว่าคืนอะไร"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    await handle(postback({"a": "start"}), s, backend, knowledge=kb)
    await handle(text("สำนักงานใหญ่"), s, backend, knowledge=kb)
    await handle(postback({"a": "type", "v": "return"}), s, backend, knowledge=kb)
    await handle(postback({"a": "skip_asset"}), s, backend, knowledge=kb)

    r = await handle(text("ฟิล์ม"), s, backend, knowledge=kb)
    assert "ผู้คืนคือคนนี้ใช่ไหม" in r[0].text
    assert M.SENDS_ON_CONFIRM not in r[0].text

    r = await handle(postback({"a": "rq_yes"}), s, backend, knowledge=kb)
    assert not backend.created
    assert "มีรายละเอียดเพิ่มเติมไหมครับ?" in r[0].text
    assert (await s.get(USER)).step == "ASK_DESC"


@pytest.mark.asyncio
@pytest.mark.parametrize("ticket_type", ["repair", "withdraw", "return", "it_service"])
@pytest.mark.parametrize("told_already", [False, True])
async def test_ข้อความกดแล้วส่งทันทีโผล่เฉพาะตอนที่กดแล้วส่งจริง(ticket_type, told_already):
    """คำบอกบนการ์ดกับสิ่งที่บอททำจริงต้องไปด้วยกันเสมอ — บอกว่าส่งเลยแต่ถามต่อ
    หรือไม่บอกแต่ส่งไปเลย ผิดทั้งคู่ (4 ประเภท x เล่ามาแล้ว/ยังไม่เล่า = 8 เคส)"""
    s, backend, kb = store(), FakeBackend(), Knowledge()
    await s.set(USER, Session(
        step="ASK_REQUESTER", ticket_type=ticket_type, branch="สำนักงานใหญ่", asset_asked=True,
        items=[{"name": "คีย์บอร์ด", "qty": 1}] if ticket_type == "withdraw" else [],
        description="ขอลงโปรแกรมบัญชีให้เครื่องใหม่" if told_already else None,
        description_collected=told_already,
    ))

    r = await handle(text("ฟิล์ม"), s, backend, knowledge=kb)
    warned = M.SENDS_ON_CONFIRM in r[0].text
    await handle(postback({"a": "rq_yes"}), s, backend, knowledge=kb)
    sent = bool(backend.created)

    assert warned == sent, f"{ticket_type} / เล่ามาแล้ว={told_already}: บอกว่าส่งเลย={warned} แต่ส่งจริง={sent}"
    assert sent == (ticket_type == "withdraw" or told_already)
