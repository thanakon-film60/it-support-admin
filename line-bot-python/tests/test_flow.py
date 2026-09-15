"""เทสต์บทสนทนาทั้งเส้น โดยไม่ต้องมี LINE จริงและไม่ต้องมี Next.js รันอยู่

แนวคิด: flow.handle() ไม่แตะ network เอง มันคุยผ่าน BackendClient เท่านั้น
เราจึงยัด FakeBackend เข้าไปแทนได้ แล้วตรวจว่าบทสนทนาเดินถูกทุก step
เทสต์ชุดนี้รันเสร็จในหลักมิลลิวินาที จึงรันซ้ำได้ทุกครั้งที่แก้ข้อความหรือ logic
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import messages as M  # noqa: E402
from app.backend import BackendError  # noqa: E402
from app.flow import Incoming, handle, parse_requester  # noqa: E402
from app.store import MemoryStore, Session  # noqa: E402

USER = "U_test_0001"

STOCK = [
    {"id": "st-1", "name": "คีย์บอร์ด", "unit": "ชิ้น", "quantity_available": 4},
    {"id": "st-2", "name": "เมาส์", "unit": "ชิ้น", "quantity_available": 6},
    {"id": "st-3", "name": "สมุดเคลมสินค้า", "unit": "เล่ม", "quantity_available": 2},
]

EQUIPMENT = {
    "NB2501001": {
        "id": "eq-1",
        "asset_code": "NB2501001",
        "brand_model": "LENOVO ThinkPad E14",
        "status": "ใช้งานอยู่",
        "install_location": "สำนักงานใหญ่",
        "holder_name": "สมชาย ใจดี",
        "repair_count": 2,
    }
}

BRANCHES = ["สำนักงานใหญ่", "สาขาเซ็นทรัล", "สาขาเชียงใหม่", "สาขาขอนแก่น", "ภูเก็ต"]

TICKETS = {
    "ITRQ2026090158": {
        "ticket_code": "ITRQ2026090158",
        "type": "withdraw",
        "status": "pending",
        "location": "สำนักงานใหญ่",
        "description": "ขอเบิก คีย์บอร์ด x1",
        "requester_name": "สมัย",
        "asset_code": None,
        "created_at_th": "14 ก.ย. 69 17:27",
    }
}


class FakeBackend:
    """แทนที่ BackendClient ตัวจริง — บันทึก payload ที่ถูกส่งมาไว้ให้ตรวจสอบได้"""

    def __init__(self, *, faq=None, fail_create=False):
        self.created: list[dict] = []
        self.faq = faq or []
        self.fail_create = fail_create
        self.ticket_code = "ITRQ2026090158"

    async def list_stock_items(self):
        return STOCK

    async def lookup_equipment(self, code: str):
        return EQUIPMENT.get(code.replace("-", "").upper())

    async def list_branches(self):
        return BRANCHES

    async def get_ticket(self, ticket_code: str):
        return TICKETS.get(ticket_code.upper())

    async def list_my_tickets(self, line_user_id: str):
        return list(TICKETS.values())

    async def search_faq(self, query: str):
        return self.faq

    async def create_ticket(self, payload: dict):
        if self.fail_create:
            raise BackendError("backend ล่ม")
        self.created.append(payload)
        return {"ok": True, "ticket_code": self.ticket_code, "id": "t-1"}


def store():
    return MemoryStore(ttl_seconds=1800)


def text(value: str) -> Incoming:
    return Incoming(kind="text", user_id=USER, text=value)


def postback(data: dict) -> Incoming:
    return Incoming(kind="postback", user_id=USER, data=data)


# ------------------------------------------------------------------ พื้นฐาน


@pytest.mark.asyncio
async def test_follow_ตอบข้อความต้อนรับพร้อมชื่อ():
    replies = await handle(
        Incoming(kind="follow", user_id=USER, display_name="Film"), store(), FakeBackend()
    )
    assert "สวัสดีครับ Film" in replies[0].text
    assert "ยินดีต้อนรับสู่ระบบแจ้งปัญหา IT" in replies[0].text
    assert replies[0].quick == M.MENU_BUTTONS


@pytest.mark.asyncio
async def test_กดแจ้งเรื่องใหม่แล้วถามสาขา():
    replies = await handle(postback({"a": "start"}), store(), FakeBackend())
    assert "พิมพ์ชื่อสาขาของคุณ" in replies[0].text


@pytest.mark.asyncio
async def test_ยกเลิกได้ทุกเมื่อ():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สำนักงานใหญ่"), s, backend)
    replies = await handle(text("ยกเลิก"), s, backend)
    assert "ยกเลิกรายการแล้ว" in replies[0].text
    assert await s.get(USER) is None


# ------------------------------------------------------------------ เบิกอุปกรณ์ (ตามรูป)


@pytest.mark.asyncio
async def test_flow_เบิกอุปกรณ์ครบทั้งเส้นตรงตามต้นแบบ():
    s = store()
    backend = FakeBackend()

    # 1. กดเริ่ม -> ถามสาขา
    r = await handle(postback({"a": "start"}), s, backend)
    assert "พิมพ์ชื่อสาขา" in r[0].text

    # 2. พิมพ์สาขา -> ยืนยันสาขา + ถามประเภท
    r = await handle(text("สำนักงานใหญ่"), s, backend)
    assert r[0].text.startswith("สาขา: สำนักงานใหญ่ ✅")
    assert "แจ้งเรื่องอะไรครับ?" in r[0].text
    assert ("📦 เบิกอุปกรณ์", "a=type&v=withdraw") in r[0].quick

    # 3. เลือกเบิกอุปกรณ์ -> ถามรหัสทรัพย์สิน
    r = await handle(postback({"a": "type", "v": "withdraw"}), s, backend)
    assert "ระบุหมายเลขทรัพย์สินครับ" in r[0].text
    assert ("ไม่มี/ไม่ทราบ", "a=skip_asset") in r[0].quick

    # 4. กดไม่ทราบ -> ให้เลือกอุปกรณ์จากสต็อกจริง
    r = await handle(postback({"a": "skip_asset"}), s, backend)
    assert "เลือกอุปกรณ์ที่ต้องการเบิกครับ:" in r[0].text
    assert ("คีย์บอร์ด", "a=item&v=st-1") in r[0].quick

    # 5. เลือกคีย์บอร์ด -> ถามจำนวน
    r = await handle(postback({"a": "item", "v": "st-1"}), s, backend)
    assert r[0].text.startswith("เลือก: คีย์บอร์ด ✅")
    assert "ต้องการกี่ชิ้นครับ?" in r[0].text

    # 6. พิมพ์จำนวน -> ถามว่าเบิกเพิ่มอีกไหม
    r = await handle(text("1"), s, backend)
    assert "คีย์บอร์ด x1" in r[0].text

    # 7. พอแล้ว -> ถามชื่อผู้เบิก
    r = await handle(postback({"a": "done_items"}), s, backend)
    assert "ระบุชื่อผู้เบิก" in r[0].text

    # 8. พิมพ์ชื่อ -> ถามรายละเอียดเพิ่มเติม
    r = await handle(text("สมัย"), s, backend)
    assert "มีรายละเอียดเพิ่มเติมไหมครับ?" in r[0].text

    # 9. พิมพ์ '-' -> สร้าง ticket และสรุปผล
    r = await handle(text("-"), s, backend)
    summary = r[0].text
    assert "✅ รับเรื่องแล้วครับ!" in summary
    assert "🎫 ITRQ2026090158" in summary
    assert "📍 สาขา: สำนักงานใหญ่" in summary
    assert "📋 ประเภท: 📦 เบิกอุปกรณ์" in summary
    assert "👤 ผู้รับ/คืน: สมัย" in summary
    assert "📦 คีย์บอร์ด x1" in summary
    assert "ทีม IT จะติดต่อกลับโดยเร็วที่สุดครับ 🙏" in summary

    # payload ที่ส่งไปสร้าง ticket ต้องถูกต้อง
    assert len(backend.created) == 1
    payload = backend.created[0]
    assert payload["type"] == "withdraw"
    assert payload["location"] == "สำนักงานใหญ่"
    assert payload["requester_name"] == "สมัย"
    assert payload["items"] == [{"name": "คีย์บอร์ด", "qty": 1}]
    assert payload["line_user_id"] == USER

    # จบแล้วต้องล้าง session ทิ้ง ไม่ค้าง
    assert await s.get(USER) is None


@pytest.mark.asyncio
async def test_เบิกหลายรายการได้():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สาขาเชียงใหม่"), s, backend)
    await handle(postback({"a": "type", "v": "withdraw"}), s, backend)
    await handle(postback({"a": "skip_asset"}), s, backend)
    await handle(postback({"a": "item", "v": "st-1"}), s, backend)
    await handle(text("2"), s, backend)
    await handle(postback({"a": "add_item"}), s, backend)
    await handle(postback({"a": "item", "v": "st-2"}), s, backend)
    await handle(text("3"), s, backend)
    await handle(postback({"a": "done_items"}), s, backend)
    await handle(text("สมชาย ใจดี - แผนกบัญชี"), s, backend)
    r = await handle(text("-"), s, backend)

    assert backend.created[0]["items"] == [
        {"name": "คีย์บอร์ด", "qty": 2},
        {"name": "เมาส์", "qty": 3},
    ]
    assert backend.created[0]["requester_name"] == "สมชาย ใจดี"
    assert backend.created[0]["requester_department"] == "แผนกบัญชี"
    assert "📦 คีย์บอร์ด x2" in r[0].text
    assert "📦 เมาส์ x3" in r[0].text


@pytest.mark.asyncio
async def test_หน่วยนับตามสต็อกจริง():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สำนักงานใหญ่"), s, backend)
    await handle(postback({"a": "type", "v": "withdraw"}), s, backend)
    await handle(postback({"a": "skip_asset"}), s, backend)
    r = await handle(postback({"a": "item", "v": "st-3"}), s, backend)
    assert "ต้องการกี่เล่มครับ?" in r[0].text


@pytest.mark.asyncio
async def test_จำนวนต้องเป็นตัวเลขบวก():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สำนักงานใหญ่"), s, backend)
    await handle(postback({"a": "type", "v": "withdraw"}), s, backend)
    await handle(postback({"a": "skip_asset"}), s, backend)
    await handle(postback({"a": "item", "v": "st-1"}), s, backend)

    for bad in ["ไม่รู้", "0", "-5", "หนึ่ง"]:
        r = await handle(text(bad), s, backend)
        assert "กรุณาพิมพ์เป็นตัวเลข" in r[0].text

    # เลขไทยต้องใช้ได้
    r = await handle(text("๒"), s, backend)
    assert "คีย์บอร์ด x2" in r[0].text


# ------------------------------------------------------------------ แจ้งซ่อม / คืน


@pytest.mark.asyncio
async def test_flow_แจ้งซ่อมและผูกกับทรัพย์สินจริง():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สาขาเซ็นทรัล"), s, backend)
    await handle(postback({"a": "type", "v": "repair"}), s, backend)

    # พิมพ์รหัสแบบมีขีด ต้องจับคู่กับรหัสจริงในระบบได้
    r = await handle(text("NB-2501001"), s, backend)
    assert "ทรัพย์สิน: NB2501001 — LENOVO ThinkPad E14 ✅" in r[0].text
    assert "ระบุชื่อผู้แจ้ง" in r[1].text

    await handle(text("วิชัย ศรีสุข - ขายหน้าร้าน"), s, backend)
    r = await handle(text("จอมีเส้นแนวตั้ง เปิดมาก็เป็นเลย"), s, backend)

    payload = backend.created[0]
    assert payload["type"] == "repair"
    assert payload["asset_code"] == "NB2501001"
    assert payload["description"] == "จอมีเส้นแนวตั้ง เปิดมาก็เป็นเลย"
    assert "💻 ทรัพย์สิน: NB2501001 — LENOVO ThinkPad E14" in r[0].text
    assert "👤 ผู้แจ้ง: วิชัย ศรีสุข" in r[0].text


@pytest.mark.asyncio
async def test_รหัสทรัพย์สินไม่เจอไม่ทำให้ติดตาย():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สำนักงานใหญ่"), s, backend)
    await handle(postback({"a": "type", "v": "repair"}), s, backend)

    r = await handle(text("XX-999"), s, backend)
    assert "ไม่พบหมายเลข 'XX-999'" in r[0].text
    assert ("ข้ามไปก่อน", "a=skip_asset") in r[0].quick

    # ยังข้ามไปต่อได้
    r = await handle(postback({"a": "skip_asset"}), s, backend)
    assert "ระบุชื่อผู้แจ้ง" in r[0].text


@pytest.mark.asyncio
async def test_flow_คืนอุปกรณ์():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สาขาขอนแก่น"), s, backend)
    await handle(postback({"a": "type", "v": "return"}), s, backend)
    await handle(postback({"a": "skip_asset"}), s, backend)
    r = await handle(text("นภัสสร ทองดี"), s, backend)
    assert "มีรายละเอียดเพิ่มเติมไหมครับ?" in r[0].text
    r = await handle(text("คืนเครื่องเก่าหลังได้เครื่องใหม่"), s, backend)
    assert backend.created[0]["type"] == "return"
    assert "👤 ผู้รับ/คืน: นภัสสร ทองดี" in r[0].text


@pytest.mark.asyncio
async def test_พิมพ์ประเภทแทนการกดปุ่มก็เข้าใจ():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สำนักงานใหญ่"), s, backend)
    r = await handle(text("อยากแจ้งซ่อมครับ"), s, backend)
    assert "ระบุหมายเลขทรัพย์สินครับ" in r[0].text


# ------------------------------------------------------------------ ตรวจสอบสาขา (ตามต้นแบบ)


@pytest.mark.asyncio
async def test_สาขาที่ไม่มีในระบบต้องถูกปฏิเสธ():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    r = await handle(text("ต้องการแจ้งซ่อม"), s, backend)
    assert "ไม่พบสาขาที่ตรงกันครับ ลองพิมพ์ใหม่" in r[0].text
    assert "เช่น:" in r[0].text
    assert "(พิมพ์ 'ยกเลิก' เพื่อออก)" in r[0].text

    # ยังอยู่ step เดิม พิมพ์สาขาถูกแล้วต้องไปต่อได้
    r = await handle(text("สำนักงานใหญ่"), s, backend)
    assert r[0].text.startswith("สาขา: สำนักงานใหญ่ ✅")


@pytest.mark.asyncio
async def test_สาขาพิมพ์ผิดเล็กน้อยยังจับได้():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    r = await handle(text("สำนักงานใหย่"), s, backend)
    assert r[0].text.startswith("สาขา: สำนักงานใหญ่ ✅"), "ควร normalize เป็นชื่อสาขาจริงในระบบ"


@pytest.mark.asyncio
async def test_มีปุ่มครบ_4_ประเภทตามต้นแบบ():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    r = await handle(text("สำนักงานใหญ่"), s, backend)
    labels = [label for label, _ in r[0].quick]
    assert labels == ["🖊 แจ้งซ่อม", "📦 เบิกอุปกรณ์", "🔄 คืนอุปกรณ์", "🛠 ขอใช้บริการ IT"]


@pytest.mark.asyncio
async def test_flow_ขอใช้บริการ_IT():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สำนักงานใหญ่"), s, backend)
    r = await handle(postback({"a": "type", "v": "it_service"}), s, backend)
    assert "ระบุหมายเลขทรัพย์สินครับ" in r[0].text

    await handle(postback({"a": "skip_asset"}), s, backend)
    await handle(text("ปิยะพงษ์ วงศ์ษา - IT"), s, backend)
    r = await handle(text("ขอสิทธิ์เข้าถึงโฟลเดอร์ของแผนก"), s, backend)

    assert backend.created[0]["type"] == "it_service"
    assert "📋 ประเภท: 🛠 ขอใช้บริการ IT" in r[0].text


# ------------------------------------------------------------------ FAQ


@pytest.mark.asyncio
async def test_ตอบ_FAQ_เมื่อยังไม่ได้เริ่มแจ้งเรื่อง():
    backend = FakeBackend(
        faq=[{"id": "f1", "title": "ปริ้นเตอร์ไม่พิมพ์", "content": "ลองเช็คสายและคิวงานพิมพ์"}]
    )
    r = await handle(text("ปริ้นเตอร์"), store(), backend)
    assert "📌 ปริ้นเตอร์ไม่พิมพ์" in r[0].text
    assert "ลองเช็คสายและคิวงานพิมพ์" in r[0].text


@pytest.mark.asyncio
async def test_ไม่เจอ_FAQ_ให้ถือว่าข้อความแรกคือชื่อสาขา():
    # ข้อความต้อนรับบอกให้ "พิมพ์ชื่อสาขาเพื่อเริ่มแจ้งเรื่อง" — พฤติกรรมนี้จึงต้องรองรับ
    s = store()
    backend = FakeBackend(faq=[])
    r = await handle(text("ภูเก็ต"), s, backend)
    assert r[0].text.startswith("สาขา: ภูเก็ต ✅")
    session = await s.get(USER)
    assert session is not None and session.branch == "ภูเก็ต"


# ------------------------------------------------------------------ เคสพัง


@pytest.mark.asyncio
async def test_กดปุ่มตอน_session_หมดอายุแล้ว():
    r = await handle(postback({"a": "type", "v": "repair"}), store(), FakeBackend())
    assert "หมดเวลา" in r[0].text


@pytest.mark.asyncio
async def test_backend_ล่มตอนส่ง_ให้กดส่งซ้ำได้ไม่ต้องกรอกใหม่():
    s = store()
    backend = FakeBackend(fail_create=True)
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สำนักงานใหญ่"), s, backend)
    await handle(postback({"a": "type", "v": "return"}), s, backend)
    await handle(postback({"a": "skip_asset"}), s, backend)
    await handle(text("ทดสอบ ระบบ"), s, backend)
    r = await handle(text("-"), s, backend)

    assert "ระบบขัดข้องชั่วคราว" in r[0].text
    assert ("🔁 ลองส่งใหม่", "a=retry_submit") in r[0].quick
    # ข้อมูลต้องยังอยู่ครบ ไม่ถูกล้างทิ้ง
    session = await s.get(USER)
    assert session is not None and session.requester_name == "ทดสอบ ระบบ"

    # หลังหลังบ้านกลับมา กดส่งซ้ำต้องผ่าน
    backend.fail_create = False
    r = await handle(postback({"a": "retry_submit"}), s, backend)
    assert "✅ รับเรื่องแล้วครับ!" in r[0].text
    assert await s.get(USER) is None


@pytest.mark.asyncio
async def test_session_หมดอายุตาม_ttl():
    s = MemoryStore(ttl_seconds=0)
    await s.set(USER, Session(step="ASK_BRANCH"))
    assert await s.get(USER) is None


# ------------------------------------------------------------------ helper


def test_แยกชื่อกับแผนก():
    assert parse_requester("สมชาย ใจดี - แผนกบัญชี") == ("สมชาย ใจดี", "แผนกบัญชี")
    assert parse_requester("สมชาย ใจดี") == ("สมชาย ใจดี", None)
    assert parse_requester("  สมัย  ") == ("สมัย", None)


def test_ปุ่มไม่เกินลิมิตของ_LINE():
    many = [{"id": f"s{i}", "name": f"อุปกรณ์ {i}", "unit": "ชิ้น"} for i in range(30)]
    reply = M.ask_item(many)
    assert len(reply.quick) <= M.MAX_QUICK_REPLY_ITEMS
    assert all(len(label) <= M.MAX_QUICK_REPLY_LABEL for label, _ in reply.quick)
