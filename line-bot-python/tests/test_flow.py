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

# ทะเบียนพนักงานชุดย่อ — รูปแบบเดียวกับที่ /api/internal/lookup?kind=knowledge ส่งมา
# จงใจให้ "สมชาย" มี 2 คนเพื่อทดสอบเส้นทาง "เจอหลายคนต้องให้เลือก" ซึ่งเป็นเคสที่พลาดง่ายที่สุด
EMPLOYEES = [
    {"id": "u-film", "code": "A69048", "name": "ธนากร โฮงทอง", "full_name": "นายธนากร โฮงทอง",
     "nickname": "ฟิล์ม", "department": "ฝ่ายเทคโนโลยีสารสนเทศ", "position": "IT Software/Network"},
    {"id": "u-somchai1", "code": "A60001", "name": "สมชาย ใจดี", "full_name": "นายสมชาย ใจดี",
     "nickname": "ชาย", "department": "ฝ่ายบัญชีและการเงิน", "position": "Accounts Payable"},
    {"id": "u-somchai2", "code": "A60002", "name": "สมชาย ทองดี", "full_name": "นายสมชาย ทองดี",
     "nickname": "ต้น", "department": "ฝ่ายคลังสินค้า", "position": "Packing Officer"},
    {"id": "u-noi", "code": "M69010", "name": "วรัญญา บุญกิจ", "full_name": "นางสาววรัญญา บุญกิจ",
     "nickname": "มุก", "department": "ฝ่ายบัญชีและการเงิน", "position": "Accounts Receivable"},
]

DEPARTMENTS = [
    {"name": "ฝ่ายบัญชีและการเงิน", "count": 2},
    {"name": "ฝ่ายคลังสินค้า", "count": 1},
    {"name": "ฝ่ายเทคโนโลยีสารสนเทศ", "count": 1},
]

# ทะเบียนบริษัท + สาขาไหนอยู่บริษัทไหน — รูปแบบเดียวกับที่ /api/internal/lookup?kind=knowledge ส่งมา
# (test_ai.py import ไปสร้าง Knowledge เพื่อตรวจว่าบอทเดาบริษัทจากชื่อสาขาได้ถูก)
COMPANIES = [
    {"code": "montipa", "label": "Montipa"},
    {"code": "motta", "label": "Motta"},
    {"code": "central", "label": "สำนักงานใหญ่"},
]

BRANCH_COMPANY = {
    "สำนักงานใหญ่": "central",
    "สาขาเซ็นทรัล": "montipa",
    "สาขาเชียงใหม่": "montipa",
    "สาขาขอนแก่น": "motta",
    "ภูเก็ต": "motta",
}

# ตัวเลือกของเมนูเลือกสาขาทีละชั้น (บริษัท -> กลุ่ม -> สาขา)
# จงใจให้ "ศาลายา" อยู่ทั้ง Montipa และ Motta เพราะข้อมูลจริงก็ซ้ำกันแบบนี้
BRANCH_OPTIONS = {
    ("company", None, None): [
        {"value": "montipa", "label": "Montipa", "sub": None, "count": 3},
        {"value": "motta", "label": "Motta", "sub": None, "count": 2},
        {"value": "central", "label": "สำนักงานใหญ่", "sub": None, "count": 1},
    ],
    ("group", "montipa", None): [
        # Montipa แบ่งตามเขตของ Area Manager (ตารางทีมขาย ต.ค. 2026) เหมือน Motta — ไม่ใช่ภูมิภาคแล้ว
        {"value": "pui", "label": "ทีมปุ้ย", "sub": "ROM: ปุ้มปุ้ย · เซ็นทรัล พระราม 2, เซ็นทรัล ศาลายา", "count": 2},
        {"value": "tubtim", "label": "ทีมทับทิม", "sub": None, "count": 1},
    ],
    ("branch", "montipa", "pui"): [
        {"value": "เซ็นทรัล พระราม 2", "label": "เซ็นทรัล พระราม 2", "sub": None, "count": 1},
        {"value": "เซ็นทรัล ศาลายา", "label": "เซ็นทรัล ศาลายา", "sub": None, "count": 1},
    ],
    ("group", "motta", None): [
        {"value": "aum", "label": "ทีมอุ้ม", "sub": None, "count": 2},
    ],
    ("branch", "motta", "aum"): [
        {"value": "ศาลายา", "label": "ศาลายา", "sub": None, "count": 1},
        {"value": "นครปฐม", "label": "นครปฐม", "sub": None, "count": 1},
    ],
    ("group", "central", None): [
        {"value": "hq", "label": "สำนักงานและคลัง", "sub": None, "count": 1},
    ],
    ("branch", "central", "hq"): [
        {"value": "สำนักงานใหญ่", "label": "สำนักงานใหญ่", "sub": None, "count": 1},
    ],
}

# ตัวเลือกของเมนูเลือกทรัพย์สินทีละชั้น (ประเภท -> ยี่ห้อ/รุ่น -> รหัส)
ASSET_OPTIONS = {
    ("category", None, None): [
        {"value": "notebook", "label": "โน้ตบุ๊ค", "sub": None, "count": 2},
        {"value": "printer", "label": "เครื่องพิมพ์", "sub": None, "count": 1},
    ],
    ("brand", "notebook", None): [
        {"value": "LENOVO ThinkPad E14", "label": "LENOVO ThinkPad E14", "sub": None, "count": 1},
        {"value": "DELL Latitude 5420", "label": "DELL Latitude 5420", "sub": None, "count": 1},
    ],
    ("code", "notebook", "LENOVO ThinkPad E14"): [
        {
            "value": "NB2501001",
            "label": "NB2501001",
            "sub": "LENOVO ThinkPad E14 · สำนักงานใหญ่ · สมชาย ใจดี",
            "count": 1,
        }
    ],
}

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

    def __init__(self, *, faq=None, fail_create=False, extra_equipment=None):
        self.created: list[dict] = []
        self.faq = faq or []
        self.fail_create = fail_create
        self.ticket_code = "ITRQ2026090158"
        self.uploaded: list[tuple[bytes, str]] = []
        # log การกดปุ่ม "เช็คสถานะเรื่องนี้"
        self.views: list[dict] = []
        self.fail_record_view = False
        # การเรียกเมนูเลือกทรัพย์สิน: [(level, category, brand)]
        self.option_calls: list[tuple] = []
        self.fail_asset_options = False
        # การเรียกเมนูเลือกสาขา: [(level, company, group)]
        self.branch_option_calls: list[tuple] = []
        self.fail_branch_options = False
        # การกดยืนยันผลการแก้ไข: [(code, user_id, action, name)]
        self.confirms: list[tuple] = []
        self.fail_confirm = False
        self.confirm_result: dict | None = None
        # การให้คะแนน/ความเห็น: [{"ticket_code", "line_user_id", "score", "comment", "viewer_name"}]
        self.rates: list[dict] = []
        self.fail_rate = False
        self.rate_result: dict | None = None
        # รหัส -> รายการเครื่องทั้งหมดที่ใช้รหัสนั้น (ใช้ทดสอบเคสรหัสซ้ำ)
        self.extra_equipment: dict[str, list[dict]] = extra_equipment or {}
        self.my_assets: dict = {"found": True, "linked": True, "holder_name": "สมชาย ใจดี",
                                "assets": [EQUIPMENT["NB2501001"]], "total": 1}
        # ทะเบียนผู้แจ้งที่ผูกกับบัญชี LINE — None = ยังไม่เคยผูก (บอทจะถามชื่อ)
        self.bound_requester: dict | None = None
        self.bind_calls: list[tuple[str, str]] = []
        # ทีม IT ที่สั่งเปิด/ปิดบอทได้ (อนุมัติในหน้าเว็บ "บอท LINE"): line_user_id -> {"status", "name"}
        self.staff: dict[str, dict] = {}
        self.staff_calls: list[tuple[str, str]] = []
        self.fail_staff = False

    async def line_staff(self, *, line_user_id: str, display_name: str = "", action: str = "check"):
        if self.fail_staff:
            raise BackendError("หลังบ้านล่ม")
        self.staff_calls.append((line_user_id, action))
        hit = self.staff.get(line_user_id)
        if action == "request" and hit is None:
            hit = self.staff[line_user_id] = {"status": "pending", "name": display_name or None}
        return dict(hit) if hit else {"status": "none", "name": None}

    async def get_requester(self, line_user_id: str):
        return self.bound_requester

    async def bind_requester(self, line_user_id: str, user_id: str):
        self.bind_calls.append((line_user_id, user_id))
        self.bound_requester = next((e for e in EMPLOYEES if e["id"] == user_id), None)
        return self.bound_requester

    async def unbind_requester(self, line_user_id: str) -> None:
        self.bound_requester = None

    async def list_stock_items(self):
        return STOCK

    async def lookup_equipment(self, code: str):
        matches = await self.lookup_equipment_matches(code)
        return matches[0] if matches else None

    async def lookup_equipment_matches(self, code: str):
        needle = code.replace("-", "").upper()
        if needle in self.extra_equipment:
            return self.extra_equipment[needle]
        found = EQUIPMENT.get(needle)
        return [found] if found else []

    async def upload_attachment(self, content: bytes, content_type: str) -> str:
        self.uploaded.append((content, content_type))
        return f"/uploads/tickets/fake-{len(self.uploaded)}.jpg"

    async def list_branches(self):
        return BRANCHES

    async def get_ticket(self, ticket_code: str):
        return TICKETS.get(ticket_code.upper())

    async def list_my_tickets(self, line_user_id: str):
        return list(TICKETS.values())

    async def list_my_assets(self, line_user_id: str):
        return self.my_assets

    async def branch_options(self, level: str, *, company=None, group=None):
        if self.fail_branch_options:
            raise BackendError("หลังบ้านล่ม")
        self.branch_option_calls.append((level, company, group))
        return BRANCH_OPTIONS.get((level, company, group), [])

    async def lookup_branch(self, name: str):
        hits = [c for (lvl, co, g), opts in BRANCH_OPTIONS.items()
                if lvl == "branch"
                for c in [co]
                if any(o["value"] == name for o in opts)]
        return {"found": bool(hits), "ambiguous": len(hits) > 1, "companies": hits}

    async def asset_options(self, level: str, *, category=None, brand=None):
        if self.fail_asset_options:
            raise BackendError("หลังบ้านล่ม")
        self.option_calls.append((level, category, brand))
        return ASSET_OPTIONS.get((level, category, brand), [])

    async def search_faq(self, query: str):
        return self.faq

    async def create_ticket(self, payload: dict):
        if self.fail_create:
            raise BackendError("backend ล่ม")
        self.created.append(payload)
        return {"ok": True, "ticket_code": self.ticket_code, "id": "t-1"}

    async def confirm_ticket(self, *, ticket_code, line_user_id, action, viewer_name=""):
        if self.fail_confirm:
            raise BackendError("หลังบ้านล่ม")
        self.confirms.append((ticket_code, line_user_id, action, viewer_name))
        if self.confirm_result is not None:
            return self.confirm_result
        return {
            "ok": True,
            "action": action,
            "ticket_code": ticket_code,
            "status": "completed" if action == "confirm" else "in_progress",
        }

    async def rate_ticket(self, *, ticket_code, line_user_id, score=None, comment=None, viewer_name=""):
        if self.fail_rate:
            raise BackendError("หลังบ้านล่ม")
        self.rates.append({"ticket_code": ticket_code, "line_user_id": line_user_id,
                           "score": score, "comment": comment, "viewer_name": viewer_name})
        if self.rate_result is not None:
            return self.rate_result
        # เลียนแบบหลังบ้าน: ขอความเห็นเฉพาะตอนกดดาวต่ำ (1–3) และยังไม่มีความเห็น
        return {"ok": True, "ticket_code": ticket_code, "score": score, "comment": comment,
                "ask_comment": score is not None and score <= 3 and not comment}

    async def record_ticket_view(self, **kwargs):
        if self.fail_record_view:
            raise BackendError("บันทึก log ไม่ได้")
        self.views.append(kwargs)
        return {
            "ok": True,
            "first_view": len(self.views) == 1,
            "total_views": len(self.views),
            "acknowledged": True,
            "notify": "sent" if len(self.views) == 1 else "skipped_repeat_view",
        }


def store():
    return MemoryStore(ttl_seconds=1800)


def text(value: str) -> Incoming:
    return Incoming(kind="text", user_id=USER, text=value)


def postback(data: dict) -> Incoming:
    return Incoming(kind="postback", user_id=USER, data=data)


@pytest.mark.asyncio
@pytest.mark.parametrize("ticket_type", ["repair", "it_service"])
async def test_description_keyboard_then_text_saved_in_ticket_and_summary(ticket_type):
    s, backend = store(), FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สำนักงานใหญ่"), s, backend)
    replies = await handle(postback({"a": "type", "v": ticket_type}), s, backend)
    badge = None
    if ticket_type == "repair":
        await handle(postback({"a": "skip_asset"}), s, backend)
        replies = await handle(text("สมชาย, IT"), s, backend)
        # ระบุผู้แจ้งไปแล้ว -> การ์ดขั้นถัดไปต้องบอกว่ากำลังแจ้งในชื่อใคร
        # (parse_requester แยกแผนกจากขีดกลาง " - " เท่านั้น เครื่องหมายจุลภาคจึงติดไปกับชื่อ
        #  — พฤติกรรมเดิม ไม่ได้แก้ในรอบนี้ แต่บันทึกไว้ให้เห็นว่าเป็นอย่างนี้จริง)
        badge = {"name": "สมชาย, IT", "department": "-"}
    assert replies[0] == M.ask_description(ticket_type, badge)
    replies = await handle(postback({"a": "write_description"}), s, backend)
    assert replies[0] == M.ask_description(ticket_type, badge)
    assert not backend.created
    assert (await s.get(USER)).step == "ASK_DESC"
    detail = "คอมเปิดไม่ติดตั้งแต่เช้า ช่วยตรวจสอบให้ด้วยครับ"
    replies = await handle(text(detail), s, backend)
    if ticket_type == "it_service":
        assert not backend.created
        assert (await s.get(USER)).step == "ASK_REQUESTER"
        replies = await handle(text("สมชาย - IT"), s, backend)
    assert backend.created[0]["description"] == detail
    assert detail in replies[0].text
    assert detail in str(replies[0].flex)
    assert await s.get(USER) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("ticket_type", ["repair", "it_service"])
@pytest.mark.parametrize("detail", ["", "   ", "-", "ไม่มี", "none"])
async def test_required_description_cannot_be_skipped(ticket_type, detail):
    s, backend = store(), FakeBackend()
    await s.set(USER, Session(step="ASK_DESC", ticket_type=ticket_type,
                              branch="สำนักงานใหญ่", requester_name="สมชาย"))
    replies = await handle(text(detail), s, backend)
    assert replies[0] == M.ask_description(ticket_type, {"name": "สมชาย", "department": "-"})
    assert not backend.created
    assert (await s.get(USER)).step == "ASK_DESC"


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["write_description", "retry_submit"])
async def test_old_description_buttons_cannot_skip_requester(action):
    s, backend = store(), FakeBackend()
    await s.set(USER, Session(step="ASK_REQUESTER", ticket_type="repair", branch="สำนักงานใหญ่"))
    await handle(postback({"a": action}), s, backend)
    assert not backend.created
    assert (await s.get(USER)).step == "ASK_REQUESTER"


@pytest.mark.asyncio
async def test_retry_requires_description_and_preserves_it_after_backend_error():
    s, backend = store(), FakeBackend(fail_create=True)
    await s.set(USER, Session(step="RETRY_SUBMIT", ticket_type="repair",
                              branch="สำนักงานใหญ่", requester_name="สมชาย"))
    await handle(postback({"a": "retry_submit"}), s, backend)
    assert (await s.get(USER)).step == "ASK_DESC"
    assert not backend.created
    detail = "เครื่องพิมพ์กระดาษติด"
    await handle(text(detail), s, backend)
    assert (await s.get(USER)).step == "RETRY_SUBMIT"
    backend.fail_create = False
    await handle(postback({"a": "retry_submit"}), s, backend)
    assert backend.created[-1]["description"] == detail
    assert await s.get(USER) is None


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
async def test_กดแจ้งเรื่องใหม่แล้วให้เลือกบริษัทก่อน():
    """เปลี่ยนจาก 'ปุ่มสาขาทั้งหมดในชุดเดียว' เป็น 'เลือกบริษัทก่อนแล้วค่อยไล่ลงไป'

    เหตุผล: กลุ่มบริษัทมีสาขารวมกัน 100 กว่าสาขา ของเดิม quick reply ใส่ได้ 12 ปุ่ม
    แล้วบอกว่า "สาขาอื่นพิมพ์ชื่อเอาเอง" ซึ่งแปลว่าคนเกือบ 90 สาขาต้องพิมพ์เอง
    และต้องเลือกบริษัทก่อนเพราะมีสาขาชื่อซ้ำกันข้ามบริษัทจริง
    """
    backend = FakeBackend()
    replies = await handle(postback({"a": "start"}), store(), backend)

    assert "เลือกบริษัท" in replies[0].text
    assert "Montipa" in replies[0].text and "Motta" in replies[0].text
    assert replies[0].flex is not None
    assert ("company", None, None) in backend.branch_option_calls

    # ต้องมีทางออกเสมอ ไม่ให้ผู้ใช้ติดอยู่ในขั้นตอนนี้
    assert any(data == "a=cancel" for _, data in replies[0].quick)

    # แต่ยังต้องพิมพ์เองได้อยู่ — บางคนพิมพ์เร็วกว่ากด
    assert "พิมพ์ชื่อสาขาเองก็ได้" in replies[0].text


@pytest.mark.asyncio
async def test_กดปุ่มสาขาแล้วไปขั้นตอนถัดไปเลย():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)

    r = await handle(postback({"a": "branch", "v": "สำนักงานใหญ่"}), s, backend)
    assert "สาขา: สำนักงานใหญ่ ✅" in r[0].text

    session = await s.get(USER)
    assert session is not None and session.branch == "สำนักงานใหญ่"


@pytest.mark.asyncio
async def test_กดปุ่มสาขาได้แม้_session_หมดอายุ():
    """ผู้ใช้กดปุ่มจากข้อความเก่าที่ค้างบนจอ ไม่ควรเจอ 'หมดเวลา' แล้วต้องเริ่มใหม่"""
    s = store()
    r = await handle(postback({"a": "branch", "v": "ภูเก็ต"}), s, FakeBackend())
    assert "หมดเวลา" not in r[0].text
    session = await s.get(USER)
    assert session is not None and session.branch == "ภูเก็ต"


@pytest.mark.asyncio
async def test_สาขาไม่เจอก็ยังมีปุ่มให้กด():
    """เดิมบอกแค่ 'ไม่พบสาขา' แล้วปล่อยให้เดาเอาเองว่าสะกดยังไงถึงจะถูก"""
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    r = await handle(text("สาขาที่ไม่มีอยู่จริงเลย"), s, backend)
    assert "ไม่พบสาขา" in r[0].text
    assert len(r) == 2, "ต้องแนบเมนูเลือกสาขามาให้ด้วย"
    # ตอนนี้แนบเป็นเมนูไล่ชั้น (เลือกบริษัทก่อน) ไม่ใช่ปุ่มสาขาทั้งหมดในชุดเดียว
    assert "เลือกบริษัท" in r[1].text
    assert r[1].flex is not None


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
    assert "เลือกประเภททรัพย์สิน" in r[0].text  # เดิมเป็นข้อความให้พิมพ์รหัสเอง ตอนนี้เป็นเมนูเลือกทีละชั้น
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
    assert "ผู้เบิกคือใคร" in r[0].text

    # 8. พิมพ์ชื่อ -> สร้าง ticket และสรุปผลทันที
    #    เดิมต้นแบบถาม "มีรายละเอียดเพิ่มเติมไหม" อีกขั้นแล้วให้พิมพ์ '-' — ผู้ทดสอบกดผ่านทุกครั้ง
    #    จึงตัดออก (30 ก.ย. 2026) การเบิกจบตรงที่ระบุผู้เบิกเสร็จ
    r = await handle(text("สมัย"), s, backend)
    assert all("มีรายละเอียดเพิ่มเติม" not in reply.text for reply in r)
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
    r = await handle(text("สมชาย ใจดี - แผนกบัญชี"), s, backend)

    assert len(backend.created) == 1
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
    assert "ผู้แจ้งคือใคร" in r[1].text

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
    assert "ผู้แจ้งคือใคร" in r[0].text


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
    assert "เลือกประเภททรัพย์สิน" in r[0].text  # เดิมเป็นข้อความให้พิมพ์รหัสเอง ตอนนี้เป็นเมนูเลือกทีละชั้น


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
    assert r[0] == M.ASK_DESCRIPTION_SERVICE
    detail = "ขอสิทธิ์เข้าถึงโฟลเดอร์ของแผนก"
    await handle(text(detail), s, backend)
    assert not backend.created
    r = await handle(text("ปิยะพงษ์ วงศ์ษา - IT"), s, backend)

    assert backend.created[0]["type"] == "it_service"
    assert backend.created[0]["description"] == detail
    assert backend.created[0]["requester_name"] == "ปิยะพงษ์ วงศ์ษา"
    assert backend.created[0]["requester_department"] == "IT"
    assert backend.created[0]["asset_code"] is None
    assert not backend.option_calls
    assert "📋 ประเภท: 🛠 ขอใช้บริการ IT" in r[0].text


@pytest.mark.asyncio
async def test_service_typed_type_and_known_type_skip_assets():
    for known_type in (False, True):
        s, backend = store(), FakeBackend()
        await s.set(USER, Session(step="ASK_BRANCH", ticket_type="it_service" if known_type else None))
        replies = await handle(text("สำนักงานใหญ่"), s, backend)
        if not known_type:
            replies = await handle(text("ขอใช้บริการ IT"), s, backend)
        assert replies[0] == M.ASK_DESCRIPTION_SERVICE
        assert (await s.get(USER)).step == "ASK_DESC"
        assert not backend.option_calls


@pytest.mark.asyncio
@pytest.mark.parametrize("step", ["ASK_ASSET", "ASK_PICK_ASSET"])
async def test_service_from_old_asset_picker_accepts_typed_reason(step):
    s, backend = store(), FakeBackend()
    await s.set(USER, Session(step=step, ticket_type="it_service", branch="สำนักงานใหญ่"))
    detail = "ขอสร้างอีเมลสำหรับพนักงานใหม่"
    await handle(text(detail), s, backend)
    session = await s.get(USER)
    assert session.description == detail
    assert session.step == "ASK_REQUESTER"
    assert not backend.option_calls
    assert not backend.created


@pytest.mark.asyncio
async def test_service_old_asset_button_opens_description():
    s, backend = store(), FakeBackend()
    await s.set(USER, Session(step="ASK_ASSET", ticket_type="it_service", branch="สำนักงานใหญ่"))
    replies = await handle(postback({"a": "pk_cat", "i": "0"}), s, backend)
    assert replies[0] == M.ASK_DESCRIPTION_SERVICE
    assert (await s.get(USER)).step == "ASK_DESC"
    assert not backend.option_calls


@pytest.mark.asyncio
async def test_service_keeps_details_and_name_when_submission_needs_retry():
    s, backend = store(), FakeBackend(fail_create=True)
    await s.set(USER, Session(step="ASK_DESC", ticket_type="it_service", branch="สำนักงานใหญ่"))
    detail = "ขอสิทธิ์ใช้งานระบบบัญชี"
    await handle(text(detail), s, backend)
    await handle(text("สมชาย - บัญชี"), s, backend)
    session = await s.get(USER)
    assert session.step == "RETRY_SUBMIT"
    assert session.description == detail
    backend.fail_create = False
    await handle(postback({"a": "retry_submit"}), s, backend)
    assert backend.created[0]["description"] == detail
    assert backend.created[0]["requester_name"] == "สมชาย"
    assert await s.get(USER) is None


# ------------------------------------------------------------------ FAQ


@pytest.mark.asyncio
@pytest.mark.parametrize("ticket_type", ["repair", "withdraw", "return", "it_service"])
async def test_every_ticket_type_accepts_free_text_without_an_asset(ticket_type):
    s, backend = store(), FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สำนักงานใหญ่"), s, backend)
    replies = await handle(postback({"a": "type", "v": ticket_type}), s, backend)
    if ticket_type != "it_service":
        assert any(data == "a=describe_request" for _, data in replies[0].quick)
        replies = await handle(postback({"a": "describe_request"}), s, backend)
    assert replies[0] == M.ask_description(ticket_type)
    detail = "รายละเอียดและสาเหตุที่ต้องการให้ทีม IT ช่วย"
    await handle(text(detail), s, backend)
    assert not backend.created
    if ticket_type == "withdraw":
        assert (await s.get(USER)).step == "ASK_ITEM"
        await handle(postback({"a": "item", "v": "st-1"}), s, backend)
        await handle(text("2"), s, backend)
        await handle(postback({"a": "done_items"}), s, backend)
    assert (await s.get(USER)).step == "ASK_REQUESTER"
    replies = await handle(text("สมชาย - IT"), s, backend)
    assert len(backend.created) == 1
    payload = backend.created[0]
    assert payload["type"] == ticket_type
    assert payload["asset_code"] is None
    assert payload["description"] == detail
    assert payload["requester_name"] == "สมชาย"
    if ticket_type == "withdraw":
        assert payload["items"][0]["name"] == "คีย์บอร์ด"
        assert payload["items"][0]["qty"] == 2
    assert detail in replies[0].text
    assert await s.get(USER) is None


# ------------------------------------------------ ปุ่ม "ไม่มี ส่งเลย" ของขั้นรายละเอียด
#
# ปุ่มนี้ทำให้ขั้นรายละเอียดจบได้ด้วยการกด 1 ครั้ง (คืน · ซ่อม · ขอใช้บริการ)
# การเบิกไม่เดินมาถึงขั้นนี้แล้ว (จบที่ขั้นผู้เบิก — ดู test_requester.py หมวด "เบิกจบที่ขั้นผู้เบิก")
# แต่ยังต้องกดได้ถูกต้องกับ session เบิกที่ค้างอยู่ขั้นนี้ตั้งแต่ก่อนอัปเดต เพราะ session อยู่ใน Redis
# ได้ถึง 30 นาที และการ์ดที่ส่งไปแล้วลบออกจากห้องแชทไม่ได้ — เทสต์เบิกข้างล่างจึงยังอยู่ครบ


def _skip_button(reply) -> bool:
    return any(data == M.SKIP_DESC_ACTION for _, data in reply.quick)


@pytest.mark.asyncio
async def test_กดปุ่มไม่มีส่งเลยตอนเบิกได้ticketทันทีไม่ต้องพิมพ์อะไรอีก():
    """session เบิกที่ค้างอยู่ขั้นรายละเอียดจากก่อนอัปเดต ต้องจบได้ด้วยการกดครั้งเดียว"""
    s, backend = store(), FakeBackend()
    await s.set(USER, Session(
        step="ASK_DESC", ticket_type="withdraw", branch="สำนักงานใหญ่",
        requester_name="สมชาย", items=[{"name": "คีย์บอร์ด", "qty": 2}],
    ))
    replies = await handle(postback({"a": "desc_skip"}), s, backend)

    assert len(backend.created) == 1, "กดครั้งเดียวต้องได้ ticket เลย"
    assert not backend.created[0]["description"], "ไม่มีรายละเอียด = ส่งค่าว่าง ไม่ใช่ข้อความ '-'"
    assert backend.created[0]["items"][0]["qty"] == 2
    assert "TK-" in replies[0].text or backend.ticket_code in replies[0].text
    assert await s.get(USER) is None, "ต้องจบบทสนทนา ไม่ค้างที่ ASK_DESC"


@pytest.mark.asyncio
async def test_กดปุ่มกับพิมพ์ขีดกลางต้องได้ผลเหมือนกันเป๊ะ():
    """ถ้าสองทางนี้ให้ผลต่างกันเมื่อไหร่ แปลว่ามีเส้นทางหนึ่งถูกลืมตอนแก้เงื่อนไขการส่ง"""
    payloads = []
    for finish in (postback({"a": "desc_skip"}), text("-")):
        s, backend = store(), FakeBackend()
        await s.set(USER, Session(
            step="ASK_DESC", ticket_type="withdraw", branch="สำนักงานใหญ่",
            requester_name="สมชาย", items=[{"name": "คีย์บอร์ด", "qty": 1}],
        ))
        await handle(finish, s, backend)
        payloads.append(backend.created)
    assert len(payloads[0]) == len(payloads[1]) == 1
    a, b = dict(payloads[0][0]), dict(payloads[1][0])
    a.pop("request_id", None)
    b.pop("request_id", None)
    assert a == b


@pytest.mark.asyncio
@pytest.mark.parametrize("ticket_type", ["repair", "withdraw", "return", "it_service"])
@pytest.mark.parametrize("told_already", [False, True])
async def test_ปุ่มไม่มีส่งเลยโผล่เฉพาะตอนที่กดแล้วผ่านจริง(ticket_type, told_already):
    """ความคงเส้นคงวาระหว่าง "ปุ่มที่ผู้ใช้เห็น" กับ "สิ่งที่ handler ยอมรับจริง"

    ปุ่มที่กดแล้วบอทถามซ้ำ แย่กว่าการไม่มีปุ่มเลย — ผู้ใช้จะสรุปว่าบอทพังแล้วเลิกใช้
    ไม่ได้สรุปว่า "อ๋อ ต้องพิมพ์เอง" เทสต์นี้ผูกสองอย่างเข้าด้วยกันเพื่อให้แก้ฝั่งเดียวไม่ได้
    """
    def new_session():
        return Session(
            step="ASK_DESC", ticket_type=ticket_type, branch="สำนักงานใหญ่",
            requester_name="สมชาย",
            items=[{"name": "คีย์บอร์ด", "qty": 1}] if ticket_type == "withdraw" else [],
            initial_message="คอมเปิดไม่ติดที่สำนักงานใหญ่" if told_already else None,
        )

    s, backend = store(), FakeBackend()
    await s.set(USER, new_session())
    prompt = await handle(postback({"a": "write_description"}), s, backend)
    shown = _skip_button(prompt[0])

    s2, backend2 = store(), FakeBackend()
    await s2.set(USER, new_session())
    await handle(postback({"a": "desc_skip"}), s2, backend2)
    accepted = bool(backend2.created)

    assert shown == accepted, (
        f"{ticket_type} / เล่ามาแล้ว={told_already}: "
        f"โชว์ปุ่ม={shown} แต่กดแล้วผ่าน={accepted}"
    )
    # เบิก/คืน ข้ามได้เสมอ · ซ่อม/ขอใช้บริการ ข้ามได้เฉพาะตอนเล่ามาแล้วตั้งแต่ข้อความแรก
    assert shown == (ticket_type not in ("repair", "it_service") or told_already)


@pytest.mark.asyncio
async def test_แจ้งซ่อมที่ยังไม่เคยเล่าอะไรกดปุ่มข้ามไม่ได้():
    """การ์ดเก่าที่ค้างบนจอจากก่อน deploy ยังกดเข้ามาได้ ต้องไม่หลุดเป็น ticket เปล่า"""
    s, backend = store(), FakeBackend()
    await s.set(USER, Session(step="ASK_DESC", ticket_type="repair",
                              branch="สำนักงานใหญ่", requester_name="สมชาย"))
    replies = await handle(postback({"a": "desc_skip"}), s, backend)
    assert not backend.created
    assert (await s.get(USER)).step == "ASK_DESC"
    assert not _skip_button(replies[0])


@pytest.mark.asyncio
async def test_กดปุ่มข้ามจากขั้นอื่นต้องไม่ส่งticketและไม่ข้ามขั้นตอน():
    """ปุ่มบนการ์ดเก่าที่เลื่อนขึ้นไปแล้วยังกดได้เสมอ — ห้ามลัดคิวไปสร้าง ticket"""
    s, backend = store(), FakeBackend()
    await s.set(USER, Session(step="ASK_REQUESTER", ticket_type="withdraw",
                              branch="สำนักงานใหญ่", items=[{"name": "คีย์บอร์ด", "qty": 1}]))
    await handle(postback({"a": "desc_skip"}), s, backend)
    assert not backend.created
    assert (await s.get(USER)).step == "ASK_REQUESTER"


@pytest.mark.asyncio
async def test_ปุ่มเปลี่ยนคนแจ้งยังอยู่คู่กับปุ่มข้าม():
    """ประเภทที่ยังมีขั้นรายละเอียด ปุ่มเปลี่ยนคนแจ้งอยู่ตรงนี้ที่เดียว — หายเมื่อไหร่ ผูกผิดคนแล้วแก้เองไม่ได้
    (การเบิกย้ายปุ่มนี้ไปอยู่บนการ์ดยืนยันผู้เบิกแล้ว ดู test_requester.py)"""
    reply = M.ask_description("return", {"name": "สมชาย", "department": "IT"})
    actions = [data for _, data in reply.quick]
    assert "a=rq_change" in actions
    assert M.SKIP_DESC_ACTION in actions


# ------------------------------------------------ ชื่อผู้แจ้งต้องอยู่ "บนการ์ด" จริงๆ


def _card_texts(card) -> list[str]:
    """ข้อความทุกชิ้นที่ถูกวาดบนการ์ด — ใช้ตรวจว่าผู้ใช้ "เห็น" อะไรจริงๆ"""
    out: list[str] = []
    if isinstance(card, dict):
        if card.get("type") == "text":
            out.append(card.get("text", ""))
        for value in card.values():
            out += _card_texts(value)
    elif isinstance(card, list):
        for value in card:
            out += _card_texts(value)
    return out


@pytest.mark.asyncio
@pytest.mark.parametrize("ticket_type", ["repair", "return", "it_service"])
async def test_ชื่อผู้แจ้งต้องอยู่บนการ์ดไม่ใช่แค่ใน_altText(ticket_type):
    """บั๊กจริง 1 ต.ค. 2026 — ผู้ใช้แจ้งว่า "ไม่โชว์ชื่อคนแจ้งเลย"

    `to_line_messages()` ส่ง Reply ที่มี flex เป็น "การ์ด" โดยใช้ `text` เป็น altText เท่านั้น
    ข้อมูลที่ใส่ไว้แค่ใน `text` จึงโผล่แค่ในหน้าจอแจ้งเตือน คนที่เปิดแชทอยู่ไม่เห็นเลยสักครั้ง
    เทสต์นี้ตรวจ "สิ่งที่ถูกวาดบนการ์ด" ไม่ใช่ `reply.text` เพราะ text หลอกตาได้
    """
    reply = M.ask_description(ticket_type, {"name": "ธีรภัทร อินทร์ทอง", "department": "IT"})
    on_card = " | ".join(_card_texts(reply.flex))
    assert "ธีรภัทร อินทร์ทอง" in on_card, f"ชื่อไม่อยู่บนการ์ด: {on_card}"
    assert "IT" in on_card, f"แผนกไม่อยู่บนการ์ด: {on_card}"
    assert "เปลี่ยนคนแจ้ง" in on_card or any(
        data == "a=rq_change" for _, data in reply.quick
    ), "ต้องมีทางแก้ชื่อผิดเสมอ"


@pytest.mark.asyncio
async def test_พิมพ์ชื่อเองก็ต้องเห็นชื่อตัวเองและเปลี่ยนได้():
    """เดิมโชว์เฉพาะคนที่ผูกกับทะเบียนแล้ว คนที่พิมพ์ชื่อเองจึงไม่เห็นชื่อตัวเองทั้งบทสนทนา
    และไม่มีปุ่มแก้ พิมพ์ผิดแล้วต้องยกเลิกเริ่มใหม่ทั้งเรื่อง"""
    s, backend = store(), FakeBackend()
    await s.set(USER, Session(step="ASK_REQUESTER", ticket_type="repair", branch="สำนักงานใหญ่"))
    replies = await handle(text("สมชาย - บัญชี"), s, backend)

    on_card = " | ".join(_card_texts(replies[0].flex))
    assert "สมชาย" in on_card, f"ชื่อที่พิมพ์เองต้องขึ้นบนการ์ดด้วย: {on_card}"
    assert "บัญชี" in on_card
    assert any(data == "a=rq_change" for _, data in replies[0].quick)


@pytest.mark.asyncio
async def test_old_free_text_shortcut_cannot_skip_requester():
    s, backend = store(), FakeBackend()
    await s.set(USER, Session(step="ASK_REQUESTER", ticket_type="repair", branch="สำนักงานใหญ่"))
    await handle(postback({"a": "describe_request"}), s, backend)
    assert (await s.get(USER)).step == "ASK_REQUESTER"
    assert not backend.created


def test_description_progress_survives_session_storage():
    session = Session(description_collected=True, description="รายละเอียด", step="ASK_REQUESTER")
    restored = Session.from_json(session.to_json())
    assert restored.description_collected and restored.description == session.description
    assert not Session.from_json('{"step":"ASK_ASSET"}').description_collected


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


# ------------------------------------------------------------------ รูปที่ผู้ใช้ส่งมา


def image(url: str | None = "/uploads/tickets/a.jpg", error: str | None = None) -> Incoming:
    return Incoming(kind="image", user_id=USER, image_url=url, image_error=error)


@pytest.mark.asyncio
async def test_ส่งรูปตอนยังไม่ได้เริ่มแจ้งเรื่อง_เปิด_flow_ให้เลย():
    """ส่งรูปหน้าจอ error มาเฉยๆ คือพฤติกรรมแรกที่คนทำ — ต้องไม่ให้เริ่มใหม่แล้วส่งรูปซ้ำ"""
    s = store()
    r = await handle(image(), s, FakeBackend())
    assert "ได้รับรูปแล้วครับ" in r[0].text
    assert "สาขาไหน" in r[0].text

    session = await s.get(USER)
    assert session is not None
    assert session.step == "ASK_BRANCH"
    assert session.image_urls == ["/uploads/tickets/a.jpg"]


@pytest.mark.asyncio
async def test_ส่งรูประหว่างแจ้งเรื่อง_แนบแล้วถามคำถามเดิมซ้ำ():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สำนักงานใหญ่"), s, backend)  # -> ASK_TYPE

    r = await handle(image("/uploads/tickets/b.jpg"), s, backend)
    assert "ได้รับรูปแล้วครับ" in r[0].text
    # ต้องถามคำถามของ step เดิมซ้ำ ไม่งั้นผู้ใช้ค้างว่าต้องทำอะไรต่อ
    assert len(r) == 2 and "แจ้งเรื่องอะไรครับ?" in r[1].text

    session = await s.get(USER)
    assert session is not None
    assert session.step == "ASK_TYPE", "การแนบรูปต้องไม่ขยับ state"
    assert session.image_urls == ["/uploads/tickets/b.jpg"]


@pytest.mark.asyncio
async def test_รูปถูกแนบไปกับ_ticket_ตอนสร้างจริง():
    s = store()
    backend = FakeBackend()
    await handle(image("/uploads/tickets/c.jpg"), s, backend)
    await handle(text("สำนักงานใหญ่"), s, backend)
    await handle(postback({"a": "type", "v": "repair"}), s, backend)
    await handle(postback({"a": "skip_asset"}), s, backend)
    await handle(text("ทดสอบ ระบบ"), s, backend)
    await handle(text("จอไม่ติด"), s, backend)

    assert backend.created[0]["image_urls"] == ["/uploads/tickets/c.jpg"]


@pytest.mark.asyncio
async def test_แนบรูปเกินลิมิตแล้วบอกตรงๆ():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "start"}), s, backend)
    for i in range(2):
        await handle(image(f"/uploads/tickets/{i}.jpg"), s, backend)

    r = await handle(image("/uploads/tickets/x.jpg"), s, backend, max_images=2)
    assert "สูงสุด 2 รูป" in r[0].text
    session = await s.get(USER)
    assert session is not None and len(session.image_urls) == 2


@pytest.mark.asyncio
async def test_รูปใหญ่เกินหรือโหลดไม่ได้ก็ยังตอบผู้ใช้():
    s = store()
    r = await handle(image(None, error="too_large"), s, FakeBackend(), max_image_mb=10)
    assert "ใหญ่เกิน 10 MB" in r[0].text

    r = await handle(image(None, error="failed"), s, FakeBackend())
    assert "บันทึกรูปไม่สำเร็จ" in r[0].text


@pytest.mark.asyncio
async def test_สติกเกอร์ไม่ทําให้บอทเงียบ():
    r = await handle(Incoming(kind="unsupported", user_id=USER), store(), FakeBackend())
    assert "ข้อความกับรูปภาพ" in r[0].text


# ------------------------------------------------------------------ รหัสทรัพย์สินซ้ำ


DUPLICATE_CODE = "PC2306001"
DUPLICATES = [
    {
        "id": "eq-d1",
        "asset_code": DUPLICATE_CODE,
        "brand_model": "HP ProDesk 400",
        "status": "ใช้งานอยู่",
        "install_location": "ถลางภูเก็ต",
        "holder_name": "สมหญิง",
        "repair_count": 0,
    },
    {
        "id": "eq-d2",
        "asset_code": DUPLICATE_CODE,
        "brand_model": "DELL OptiPlex 3080",
        "status": "ใช้งานอยู่",
        "install_location": "สำนักงานใหญ่",
        "holder_name": "สมชาย",
        "repair_count": 1,
    },
]


async def _to_asset_step(s, backend):
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สำนักงานใหญ่"), s, backend)
    await handle(postback({"a": "type", "v": "repair"}), s, backend)


@pytest.mark.asyncio
async def test_รหัสซ้ำต้องให้เลือกไม่ใช่เดาเครื่องแรก():
    """ข้อมูลจริงมี 28 แถวที่รหัสซ้ำ — เดาเครื่องแรกแปลว่าช่างอาจไปผิดสาขาโดยไม่มีใครรู้"""
    s = store()
    backend = FakeBackend(extra_equipment={DUPLICATE_CODE: DUPLICATES})
    await _to_asset_step(s, backend)

    r = await handle(text(DUPLICATE_CODE), s, backend)
    assert "ตรงกับ 2 เครื่อง" in r[0].text
    assert "ถลางภูเก็ต" in r[0].text and "สำนักงานใหญ่" in r[0].text

    session = await s.get(USER)
    assert session is not None
    assert session.step == "ASK_PICK_ASSET"
    assert session.asset_code is None, "ห้ามผูกทรัพย์สินก่อนผู้ใช้เลือก"


@pytest.mark.asyncio
async def test_เลือกเครื่องจากรหัสซ้ำแล้วไปต่อได้():
    s = store()
    backend = FakeBackend(extra_equipment={DUPLICATE_CODE: DUPLICATES})
    await _to_asset_step(s, backend)
    await handle(text(DUPLICATE_CODE), s, backend)

    r = await handle(postback({"a": "pick_asset", "v": "eq-d2"}), s, backend)
    assert "DELL OptiPlex 3080" in r[0].text

    session = await s.get(USER)
    assert session is not None
    assert session.asset_code == DUPLICATE_CODE
    assert session.asset_choices == [], "ล้างตัวเลือกทิ้งหลังเลือกแล้ว"
    assert session.step == "ASK_REQUESTER"


@pytest.mark.asyncio
async def test_รหัสไม่ซ้ำยังทํางานเหมือนเดิม():
    s = store()
    backend = FakeBackend()
    await _to_asset_step(s, backend)
    r = await handle(text("NB2501001"), s, backend)
    assert "NB2501001 — LENOVO ThinkPad E14" in r[0].text
    session = await s.get(USER)
    assert session is not None and session.step == "ASK_REQUESTER"


@pytest.mark.asyncio
async def test_ปุ่มเลือกเครื่องไม่เกินลิมิตของ_LINE():
    many = [
        {
            "id": f"eq-{i}",
            "asset_code": DUPLICATE_CODE,
            "brand_model": f"เครื่อง {i}",
            "install_location": f"สาขาที่ยาวมากจนเกินลิมิตของปุ่ม {i}",
            "holder_name": "ใครสักคน",
        }
        for i in range(20)
    ]
    reply = M.ask_which_asset(many)
    assert len(reply.quick) <= M.MAX_QUICK_REPLY_ITEMS
    assert all(len(label) <= M.MAX_QUICK_REPLY_LABEL for label, _ in reply.quick)


# ------------------------------------------------------------------ เมนู "เช็คข้อมูล" (เมนูชั้น 2)


@pytest.mark.asyncio
async def test_ทรัพย์สินของฉัน_ตอบจากข้อมูลจริง():
    r = await handle(postback({"a": "my_assets"}), store(), FakeBackend())
    assert "NB2501001" in r[0].text
    assert r[0].flex is not None, "ต้องตอบเป็นการ์ด"


@pytest.mark.asyncio
async def test_ทรัพย์สินของฉัน_ยังไม่ผูกบัญชีต้องบอกให้ชัด():
    """ต่างจาก 'ไม่มีของ' คนละเรื่อง — ถ้าตอบเหมือนกันผู้ใช้จะเข้าใจผิดว่าตัวเองไม่มีของ"""
    backend = FakeBackend()
    backend.my_assets = {"found": False, "linked": False, "assets": []}
    r = await handle(postback({"a": "my_assets"}), store(), backend)
    assert "ยังไม่รู้ว่าคุณเป็นใคร" in r[0].text


@pytest.mark.asyncio
async def test_ทรัพย์สินของฉัน_ผูกแล้วแต่ไม่มีของ():
    backend = FakeBackend()
    backend.my_assets = {"found": False, "linked": True, "holder_name": "สมชาย ใจดี", "assets": []}
    r = await handle(postback({"a": "my_assets"}), store(), backend)
    assert "ไม่มีทรัพย์สินในความรับผิดชอบ" in r[0].text


@pytest.mark.asyncio
async def test_ค้นหาทรัพย์สิน_ไม่สร้าง_ticket():
    """ปุ่มนี้คือ 'ดูข้อมูล' ไม่ใช่ 'เปิดงาน' — ห้ามพาเข้า flow แจ้งเรื่องโดยไม่ได้ตั้งใจ"""
    s = store()
    backend = FakeBackend()

    r = await handle(postback({"a": "find_asset"}), s, backend)
    assert "พิมพ์รหัสทรัพย์สิน" in r[0].text

    r = await handle(text("NB2501001"), s, backend)
    assert "NB2501001" in r[0].text
    assert "LENOVO ThinkPad E14" in r[0].text
    assert backend.created == [], "ต้องไม่สร้าง ticket"
    assert await s.get(USER) is None, "ค้นเสร็จต้องล้าง session ไม่ค้างอยู่ในโหมดค้นหา"


@pytest.mark.asyncio
async def test_ค้นหาทรัพย์สิน_ไม่เจอก็ยังค้นต่อได้():
    s = store()
    backend = FakeBackend()
    await handle(postback({"a": "find_asset"}), s, backend)
    r = await handle(text("ไม่มีรหัสนี้"), s, backend)
    assert "ไม่พบรหัส" in r[0].text
    session = await s.get(USER)
    assert session is not None and session.step == "FIND_ASSET", "ต้องยังอยู่ในโหมดค้นหา"


@pytest.mark.asyncio
async def test_ค้นหาทรัพย์สิน_รหัสซ้ำบอกให้ครบทุกเครื่อง():
    s = store()
    backend = FakeBackend(extra_equipment={DUPLICATE_CODE: DUPLICATES})
    await handle(postback({"a": "find_asset"}), s, backend)
    r = await handle(text(DUPLICATE_CODE), s, backend)
    assert "2 เครื่อง" in r[0].text
    assert "ถลางภูเก็ต" in r[0].text and "สำนักงานใหญ่" in r[0].text


# ------------------------------------------------- ปุ่ม "เช็คสถานะเรื่องนี้"


@pytest.mark.asyncio
async def test_กดเช็คสถานะแล้วได้สถานะจริง_ไม่ใช่เมนูเปล่า():
    """ก่อนแก้: flow.py ไม่มี handler ของ a=ticket เลย กดปุ่มที่เด่นที่สุดบนการ์ดแล้ว
    ได้เมนูเปล่าๆ (หรือ 'หมดเวลา' ถ้า session หมดอายุ) — จากมุมผู้ใช้คือปุ่มเสีย"""
    backend = FakeBackend()
    replies = await handle(
        postback({"a": "ticket", "code": "ITRQ2026090158"}), store(), backend
    )
    assert len(replies) == 1
    assert "ITRQ2026090158" in replies[0].text
    assert "รอดำเนินการ" in replies[0].text
    assert replies[0].flex is not None


@pytest.mark.asyncio
async def test_กดเช็คสถานะแล้วบันทึก_log_พร้อม_ip_และชื่อผู้กด():
    backend = FakeBackend()
    await handle(
        Incoming(
            kind="postback",
            user_id=USER,
            data={"a": "ticket", "code": "ITRQ2026090158"},
            display_name="ธนากร โฮงทอง",
            client_ip="147.92.150.10",
            user_agent="LineBotWebhook/2.0",
        ),
        store(),
        backend,
    )
    assert len(backend.views) == 1
    view = backend.views[0]
    assert view["ticket_code"] == "ITRQ2026090158"
    assert view["line_user_id"] == USER
    assert view["viewer_name"] == "ธนากร โฮงทอง"
    assert view["ip"] == "147.92.150.10"
    assert view["user_agent"] == "LineBotWebhook/2.0"


@pytest.mark.asyncio
async def test_ครั้งแรกบอกว่าแจ้งทีม_IT_แล้ว_ครั้งต่อไปไม่หลอกว่าแจ้งซ้ำ():
    """แจ้งทีม IT จริงเฉพาะครั้งแรก (กันโควตา push หมด) ข้อความจึงต้องตรงกับที่เกิดขึ้นจริง"""
    backend = FakeBackend()
    st = store()
    first = await handle(postback({"a": "ticket", "code": "ITRQ2026090158"}), st, backend)
    assert "แจ้งทีม IT แล้ว" in first[0].text

    second = await handle(postback({"a": "ticket", "code": "ITRQ2026090158"}), st, backend)
    assert "แจ้งทีม IT แล้ว" not in second[0].text
    assert "บันทึกแล้ว" in second[0].text
    assert "2 ครั้ง" in second[0].text


@pytest.mark.asyncio
async def test_บันทึก_log_ล้มเหลวต้องยังตอบสถานะให้ผู้ใช้อยู่ดี():
    """log เป็นเรื่องของทีม IT ส่วนคำตอบเป็นเรื่องของคนที่กด — พังคนละระดับกัน"""
    backend = FakeBackend()
    backend.fail_record_view = True
    replies = await handle(postback({"a": "ticket", "code": "ITRQ2026090158"}), store(), backend)
    assert len(replies) == 1
    assert "ITRQ2026090158" in replies[0].text


@pytest.mark.asyncio
async def test_กดเช็คสถานะเรื่องที่ไม่มีอยู่จริง():
    backend = FakeBackend()
    replies = await handle(postback({"a": "ticket", "code": "ITXX9999999999"}), store(), backend)
    assert "ITXX9999999999" in replies[0].text
    assert backend.views == []


@pytest.mark.asyncio
async def test_กดเช็คสถานะได้แม้_session_หมดอายุไปแล้ว():
    """ผู้ใช้มักกดปุ่มจากการ์ดเก่าที่ค้างอยู่บนจอ หลายวันหลังจากแจ้งเรื่อง
    ถ้าตอบ 'หมดเวลา' ตรงนี้ = ปุ่มใช้ไม่ได้จริงในสถานการณ์ที่คนใช้มันมากที่สุด"""
    backend = FakeBackend()
    empty_store = store()  # ไม่มี session ของ USER เลย
    replies = await handle(postback({"a": "ticket", "code": "ITRQ2026090158"}), empty_store, backend)
    assert "หมดเวลา" not in replies[0].text
    assert "ITRQ2026090158" in replies[0].text


# ------------------------------------------- เมนูเลือกทรัพย์สินทีละชั้น


async def _to_asset_picker(backend, st=None):
    """พาบทสนทนามาถึงขั้นตอนเลือกทรัพย์สิน แล้วคืนคำตอบล่าสุด"""
    st = st or store()
    await handle(text("สำนักงานใหญ่"), st, backend)
    replies = await handle(postback({"a": "type", "v": "repair"}), st, backend)
    return st, replies


@pytest.mark.asyncio
async def test_ถึงขั้นตอนทรัพย์สินแล้วได้เมนูให้เลือก_ไม่ใช่ให้พิมพ์รหัสเอง():
    """ของเดิมบอกแค่ 'ระบุหมายเลขทรัพย์สินครับ' ซึ่งแปลว่าผู้ใช้ต้องจำรหัสเอง
    ทั้งที่ไม่มีใครจำรหัสทรัพย์สินได้ — เป็นจุดที่คนเลิกใช้บอทมากที่สุด"""
    backend = FakeBackend()
    _, replies = await _to_asset_picker(backend)
    assert "เลือกประเภททรัพย์สิน" in replies[0].text
    assert replies[0].flex is not None
    assert ("category", None, None) in backend.option_calls


@pytest.mark.asyncio
async def test_ไล่เลือก_ประเภท_ยี่ห้อ_รหัส_จนผูกทรัพย์สินได้():
    backend = FakeBackend()
    st, _ = await _to_asset_picker(backend)

    # ชั้น 1: กดประเภทตัวแรก (โน้ตบุ๊ค)
    r = await handle(postback({"a": "pk_cat", "i": "0"}), st, backend)
    assert "เลือกยี่ห้อ / รุ่น" in r[0].text
    assert "โน้ตบุ๊ค" in r[0].text  # เส้นทางที่กรองมาต้องโชว์ ไม่งั้นผู้ใช้ลืมว่ากรองอะไรไว้
    assert ("brand", "notebook", None) in backend.option_calls

    # ชั้น 2: กดยี่ห้อตัวแรก
    r = await handle(postback({"a": "pk_brand", "i": "0"}), st, backend)
    assert "เลือกรหัสทรัพย์สิน" in r[0].text
    assert ("code", "notebook", "LENOVO ThinkPad E14") in backend.option_calls

    # ชั้น 3: กดรหัส -> ต้องผูกของได้และเดินบทสนทนาต่อ
    r = await handle(postback({"a": "pk_code", "i": "0"}), st, backend)
    assert "NB2501001" in r[0].text
    session = await st.get(USER)
    assert session.asset_code == "NB2501001"


@pytest.mark.asyncio
async def test_ปุ่มย้อนกลับต้องล้างตัวกรองชั้นที่ลึกกว่า():
    """ถ้าไม่ล้าง ผู้ใช้จะเปลี่ยนประเภทแล้วยังโดนกรองด้วยยี่ห้อเดิมอยู่เงียบๆ
    แล้วงงว่าทำไมไม่มีของให้เลือก"""
    backend = FakeBackend()
    st, _ = await _to_asset_picker(backend)
    await handle(postback({"a": "pk_cat", "i": "0"}), st, backend)
    await handle(postback({"a": "pk_brand", "i": "0"}), st, backend)

    session = await st.get(USER)
    assert session.pick_brand == "LENOVO ThinkPad E14"

    r = await handle(postback({"a": "pk_back", "to": "category"}), st, backend)
    assert "เลือกประเภททรัพย์สิน" in r[0].text
    session = await st.get(USER)
    assert session.pick_brand is None
    assert session.pick_category is None


@pytest.mark.asyncio
async def test_คนที่รู้รหัสอยู่แล้วพิมพ์ได้เลยไม่ต้องไล่เมนู():
    backend = FakeBackend()
    st, _ = await _to_asset_picker(backend)
    r = await handle(text("NB2501001"), st, backend)
    assert "NB2501001" in r[0].text
    session = await st.get(USER)
    assert session.asset_code == "NB2501001"


@pytest.mark.asyncio
async def test_ปุ่มพิมพ์รหัสเองพากลับไปโหมดพิมพ์():
    backend = FakeBackend()
    st, _ = await _to_asset_picker(backend)
    r = await handle(postback({"a": "asset_manual"}), st, backend)
    assert "ระบุหมายเลขทรัพย์สินครับ" in r[0].text
    session = await st.get(USER)
    assert session.pick_level is None


@pytest.mark.asyncio
async def test_หลังบ้านล่มตอนดึงตัวเลือกต้องให้พิมพ์เองได้_ไม่ใช่ตัน():
    backend = FakeBackend()
    backend.fail_asset_options = True
    _, replies = await _to_asset_picker(backend)
    assert "พิมพ์รหัสทรัพย์สิน" in replies[0].text
    assert ("ไม่มี/ไม่ทราบ", "a=skip_asset") in replies[0].quick


@pytest.mark.asyncio
async def test_กดจากการ์ดเก่าที่ลำดับไม่ตรงแล้วต้องเริ่มเลือกใหม่_ไม่เดาเครื่องผิด():
    """ผู้ใช้เลื่อนขึ้นไปกดการ์ดเก่าที่ค้างบนจอเป็นเรื่องปกติมาก
    ลำดับในการ์ดนั้นอาจไม่ตรงกับ session แล้ว ถ้าเดาต่อไปจะได้ทรัพย์สินผิดเครื่อง"""
    backend = FakeBackend()
    st, _ = await _to_asset_picker(backend)
    r = await handle(postback({"a": "pk_cat", "i": "99"}), st, backend)
    assert "เลือกประเภททรัพย์สิน" in r[0].text
    session = await st.get(USER)
    assert session.asset_code is None


@pytest.mark.asyncio
async def test_postback_data_ของทุกปุ่มต้องไม่เกิน_300_ไบต์():
    """ข้อจำกัดจริงของ LINE — เกินแล้วปุ่มพังเงียบๆ ไม่มี error ให้เห็น
    นี่คือเหตุผลที่ปุ่มส่งมาแค่ลำดับที่ ไม่ใช่ชื่อรุ่นเต็มๆ"""
    backend = FakeBackend()
    _, replies = await _to_asset_picker(backend)

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "postback":
                data = node.get("data", "")
                assert len(data.encode("utf-8")) <= 300, f"ยาวเกิน: {data}"
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(replies[0].flex)


@pytest.mark.asyncio
async def test_กดข้ามทรัพย์สินแล้วสถานะเมนูต้องถูกล้าง():
    backend = FakeBackend()
    st, _ = await _to_asset_picker(backend)
    await handle(postback({"a": "pk_cat", "i": "0"}), st, backend)
    await handle(postback({"a": "skip_asset"}), st, backend)
    session = await st.get(USER)
    assert session.pick_category is None
    assert session.pick_level is None


# ------------------------------------------- เมนูเลือกสาขา (บริษัท → กลุ่ม → สาขา)


@pytest.mark.asyncio
@pytest.mark.parametrize("ticket_type, expected_step", [(None, "ASK_TYPE"), ("repair", "ASK_ASSET")])
async def test_headquarters_skips_department_and_single_branch(ticket_type, expected_step):
    backend, st = FakeBackend(), store()
    await handle(postback({"a": "start"}), st, backend)
    session = await st.get(USER)
    session.ticket_type = ticket_type
    await st.set(USER, session)
    replies = await handle(postback({"a": "bk_co", "i": "2"}), st, backend)
    session = await st.get(USER)
    assert session.branch == "สำนักงานใหญ่"
    assert session.step == expected_step
    assert "เลือกหน่วยงาน" not in replies[0].text
    assert "เลือกสาขา" not in replies[0].text
    assert not backend.created


@pytest.mark.asyncio
async def test_headquarters_multiple_locations_show_branches_without_groups(monkeypatch):
    choices = BRANCH_OPTIONS[("branch", "central", "hq")] + [
        {"value": "คลัง IT", "label": "คลัง IT", "count": 1},
    ]
    monkeypatch.setitem(BRANCH_OPTIONS, ("branch", "central", "hq"), choices)
    backend, st = FakeBackend(), store()
    await handle(postback({"a": "start"}), st, backend)
    replies = await handle(postback({"a": "bk_co", "i": "2"}), st, backend)
    assert "เลือกสาขา" in replies[0].text
    assert "a=bk_back&to=company" in str(replies[0].flex)
    assert "a=bk_back&to=group" not in str(replies[0].flex)
    assert (await st.get(USER)).branch is None
    await handle(postback({"a": "bk_page", "p": "0"}), st, backend)
    assert (await st.get(USER)).pick_values == ["สำนักงานใหญ่", "คลัง IT"]
    await handle(postback({"a": "bk_branch", "i": "1"}), st, backend)
    assert (await st.get(USER)).branch == "คลัง IT"


@pytest.mark.asyncio
async def test_headquarters_backend_failure_does_not_select_stale_branch():
    backend, st = FakeBackend(), store()
    await handle(postback({"a": "start"}), st, backend)
    backend.fail_branch_options = True
    await handle(postback({"a": "bk_co", "i": "2"}), st, backend)
    session = await st.get(USER)
    assert session.branch is None
    assert session.step == "ASK_BRANCH"
    assert not backend.created


@pytest.mark.asyncio
async def test_old_headquarters_department_card_advances_without_another_branch_card():
    backend, st = FakeBackend(), store()
    await st.set(USER, Session(step="ASK_BRANCH", pick_company="central",
                              pick_company_label="สำนักงานใหญ่", pick_level="group",
                              pick_values=["hq"], pick_labels=["อื่นๆ"]))
    await handle(postback({"a": "bk_grp", "i": "0"}), st, backend)
    session = await st.get(USER)
    assert session.branch == "สำนักงานใหญ่"
    assert session.step == "ASK_TYPE"


@pytest.mark.asyncio
async def test_ไล่เลือก_บริษัท_กลุ่ม_สาขา_จนได้สาขา():
    backend = FakeBackend()
    st = store()
    await handle(postback({"a": "start"}), st, backend)

    r = await handle(postback({"a": "bk_co", "i": "0"}), st, backend)  # Montipa
    assert "เลือกเขต (Area Manager)" in r[0].text
    assert "Montipa" in r[0].text
    assert ("group", "montipa", None) in backend.branch_option_calls

    r = await handle(postback({"a": "bk_grp", "i": "0"}), st, backend)  # ทีมปุ้ย
    assert "เลือกสาขา" in r[0].text
    assert ("branch", "montipa", "pui") in backend.branch_option_calls

    r = await handle(postback({"a": "bk_branch", "i": "0"}), st, backend)
    assert "เซ็นทรัล พระราม 2" in r[0].text
    session = await st.get(USER)
    assert session.branch == "เซ็นทรัล พระราม 2"


@pytest.mark.asyncio
async def test_ชั้นกลางของเมนูสาขาเรียกว่าเขต_AM_ทั้ง_Montipa_และ_Motta():
    """ถ้าใช้คำกลางๆ ว่า 'กลุ่ม' ผู้ใช้จะไม่รู้ว่ากำลังเลือกอะไรอยู่ — ทั้งสองบริษัทแบ่งตามเขตของ Area Manager
    (Montipa เลิกแบ่งตามภูมิภาคเมื่อ 15 ต.ค. 2026 ตามตารางทีมขาย ต.ค. 2026)"""
    for index, company in (("0", "Montipa"), ("1", "Motta")):
        backend = FakeBackend()
        st = store()
        await handle(postback({"a": "start"}), st, backend)
        r = await handle(postback({"a": "bk_co", "i": index}), st, backend)
        assert r[0].text.startswith("เลือกเขต (Area Manager)"), company
        assert company in r[0].text
        assert "ภูมิภาค" not in r[0].text


@pytest.mark.asyncio
async def test_ปุ่มย้อนกลับล้างตัวกรองชั้นที่ลึกกว่า():
    backend = FakeBackend()
    st = store()
    await handle(postback({"a": "start"}), st, backend)
    await handle(postback({"a": "bk_co", "i": "0"}), st, backend)
    await handle(postback({"a": "bk_grp", "i": "0"}), st, backend)

    session = await st.get(USER)
    assert session.pick_group == "pui"

    r = await handle(postback({"a": "bk_back", "to": "company"}), st, backend)
    assert "เลือกบริษัท" in r[0].text
    session = await st.get(USER)
    assert session.pick_company is None and session.pick_group is None


@pytest.mark.asyncio
async def test_กดเลือกสาขาได้แม้_session_หมดอายุ():
    """คนกดปุ่มจากการ์ดเก่าที่ค้างบนจอเป็นเรื่องปกติมาก
    ถ้าตอบ 'หมดเวลา' คือทำให้เริ่มใหม่ทั้งที่เพิ่งกดไปหนึ่งที"""
    backend = FakeBackend()
    r = await handle(postback({"a": "bk_co", "i": "0"}), store(), backend)
    assert "หมดเวลา" not in r[0].text


@pytest.mark.asyncio
async def test_หลังบ้านล่มตอนดึงสาขาต้องยังพิมพ์เองได้():
    backend = FakeBackend()
    backend.fail_branch_options = True
    r = await handle(postback({"a": "start"}), store(), backend)
    # ตกกลับไปใช้ปุ่มชุดเดิมจากรายชื่อสาขาแบนๆ
    assert "สาขา" in r[0].text


@pytest.mark.asyncio
async def test_พิมพ์ชื่อสาขาเองยังใช้ได้เหมือนเดิม():
    backend = FakeBackend()
    st = store()
    r = await handle(text("สำนักงานใหญ่"), st, backend)
    assert "สำนักงานใหญ่" in r[0].text
    session = await st.get(USER)
    assert session.branch == "สำนักงานใหญ่"


@pytest.mark.asyncio
async def test_postback_ของเมนูสาขาไม่เกิน_300_ไบต์():
    """ชื่อสาขาไทยยาวๆ อย่าง 'เดอะมอลล์ไลฟ์สโตร์ บางกะปิ' encode แล้วกินตัวละ 9 ไบต์
    นี่คือเหตุผลที่ปุ่มส่งมาแค่ลำดับที่ ไม่ใช่ชื่อสาขาเต็ม"""
    backend = FakeBackend()
    st = store()
    replies = await handle(postback({"a": "start"}), st, backend)

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "postback":
                assert len(node.get("data", "").encode("utf-8")) <= 300
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(replies[0].flex)


# ------------------------------------------- ผู้แจ้งกดยืนยันผลการแก้ไข


@pytest.mark.asyncio
@pytest.mark.parametrize("action_data", [{"a": "confirm_done"}, {"a": "confirm", "v": "1"}])
async def test_กดตกลงแล้วเรื่องปิดเป็นดำเนินการเสร็จสิ้น(action_data):
    backend = FakeBackend()
    r = await handle(
        Incoming(kind="postback", user_id=USER,
                 data={**action_data, "code": "ITRQ2026090158"},
                 display_name="ธนากร โฮงทอง"),
        store(), backend,
    )
    assert "ปิดเรียบร้อยแล้ว" in r[0].text
    assert "ดำเนินการเสร็จสิ้น" in r[0].text
    assert backend.confirms == [("ITRQ2026090158", USER, "confirm", "ธนากร โฮงทอง")]


@pytest.mark.asyncio
@pytest.mark.parametrize("action_data", [{"a": "still_broken"}, {"a": "confirm", "v": "0"}])
async def test_กดยังไม่หายแล้วเรื่องกลับไปให้ทีม_IT(action_data):
    backend = FakeBackend()
    r = await handle(postback({**action_data, "code": "ITRQ2026090158"}), store(), backend)
    assert "ตรวจสอบอีกครั้ง" in r[0].text
    assert backend.confirms[0][2] == "reject"


@pytest.mark.asyncio
async def test_กดยืนยันได้แม้_session_หมดอายุ():
    """ข้อความแจ้ง 'แก้ไขแล้ว' เด้งมาตอนผู้ใช้ไม่ได้เปิดแชท กว่าจะมากดอาจผ่านไปหลายชั่วโมง
    ถ้าตอบ 'หมดเวลา' ปุ่มนี้แทบไม่มีวันใช้ได้เลย"""
    backend = FakeBackend()
    r = await handle(postback({"a": "confirm_done", "code": "ITRQ2026090158"}), store(), backend)
    assert "หมดเวลา" not in r[0].text


@pytest.mark.asyncio
async def test_คนอื่นกดยืนยันแทนไม่ได้():
    """เลขที่ตั๋วหลุดไปในแชทกลุ่มได้ง่าย ถ้าใครก็ปิดเรื่องได้ log จะมีลายเซ็นคนไม่เกี่ยวข้อง"""
    backend = FakeBackend()
    backend.confirm_result = {"ok": False, "reason": "not_owner"}
    r = await handle(postback({"a": "confirm_done", "code": "ITRQ2026090158"}), store(), backend)
    assert "ไม่ได้แจ้งจากบัญชีนี้" in r[0].text


@pytest.mark.asyncio
async def test_กดยืนยันจากข้อความเก่าหลังสถานะเปลี่ยนไปแล้ว():
    backend = FakeBackend()
    backend.confirm_result = {"ok": False, "reason": "not_resolved", "status": "in_progress"}
    r = await handle(postback({"a": "confirm_done", "code": "ITRQ2026090158"}), store(), backend)
    assert "ไม่ได้อยู่ในขั้นรอยืนยัน" in r[0].text
    assert "กำลังดำเนินการ" in r[0].text


@pytest.mark.asyncio
async def test_หลังบ้านล่มตอนกดยืนยันต้องไม่เงียบ():
    backend = FakeBackend()
    backend.fail_confirm = True
    r = await handle(postback({"a": "confirm_done", "code": "ITRQ2026090158"}), store(), backend)
    assert len(r) == 1 and r[0].text
