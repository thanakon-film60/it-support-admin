"""เทสต์ชั้น AI — การตัดคำไทย, ค้น FAQ ด้วย TF-IDF, จับ intent และ slot

ข้อมูลที่ใช้ในเทสต์เลียนแบบของจริงที่ดึงมาจากฐานข้อมูลของโปรเจกต์
(สาขาจาก tickets, รายการสต็อก, รหัสทรัพย์สิน, FAQ)
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import ai  # noqa: E402
from app import messages as M  # noqa: E402
from app.flow import Incoming, handle  # noqa: E402
from app.store import MemoryStore  # noqa: E402

from test_flow import BRANCH_COMPANY, COMPANIES, STOCK, FakeBackend, postback, text  # noqa: E402

USER = "U_test_0001"

BRANCHES = ["สำนักงานใหญ่", "สาขาเซ็นทรัล", "สาขาเชียงใหม่", "สาขาขอนแก่น", "ภูเก็ต"]

EQUIPMENT = [
    {"asset_code": "NB2501001", "brand_model": "LENOVO ThinkPad E14", "category": "notebook"},
    {"asset_code": "PC2501001", "brand_model": "ACER Veriton", "category": "desktop"},
    {"asset_code": "PR2502002", "brand_model": "HP LaserJet M15w", "category": "printer"},
]

FAQ = [
    {
        "id": "f1",
        "title": "เครื่องพิมพ์ไม่ทำงาน",
        "keywords": ["ปริ้นเตอร์", "เครื่องพิมพ์", "print"],
        "content": "ตรวจสอบสายไฟและสาย USB ว่าเสียบแน่น จากนั้นลองล้างคิวงานพิมพ์ในเครื่อง",
    },
    {
        "id": "f2",
        "title": "ลืมรหัสผ่านเข้าระบบ",
        "keywords": ["รหัสผ่าน", "password", "ลืมรหัส"],
        "content": "แจ้งทีม IT เพื่อรีเซ็ตรหัสผ่าน โดยต้องยืนยันตัวตนด้วยรหัสพนักงานก่อน",
    },
    {
        "id": "f3",
        "title": "wifi หลุดบ่อย",
        "keywords": ["wifi", "ไวไฟ", "เน็ต", "อินเทอร์เน็ต"],
        "content": "ลองลืมเครือข่ายแล้วเชื่อมต่อใหม่ ถ้ายังไม่หายให้แจ้งทีม IT เข้าตรวจสอบ access point",
    },
]


def build_knowledge() -> ai.Knowledge:
    documents = [
        (f["id"], " ".join([f["title"], " ".join(f["keywords"]), f["content"]])) for f in FAQ
    ]
    return ai.Knowledge(
        branches=BRANCHES,
        # ชั้น AI ต้องรู้ด้วยว่าสาขาไหนอยู่บริษัทไหน ไม่งั้นจับสาขาจากประโยคได้แต่เติมบริษัทไม่ได้
        # แล้วบอทจะหยุดถามบริษัทซ้ำทั้งที่ผู้ใช้บอกสาขามาแล้ว
        branch_items=[
            {"company": BRANCH_COMPANY[name], "name": name, "group": None, "floor": None}
            for name in BRANCHES
        ],
        companies=COMPANIES,
        stock_items=STOCK,
        equipment=EQUIPMENT,
        faq=FAQ,
        index=ai.TfidfIndex(documents),
        fetched_at=9e18,  # ตั้งไว้ไกลๆ กัน cache หมดอายุระหว่างเทสต์
    )


class FakeKnowledgeCache:
    def __init__(self):
        self._kb = build_knowledge()

    async def get(self):
        return self._kb


def store():
    return MemoryStore(ttl_seconds=1800)


# ------------------------------------------------------------------ ตัดคำ / ค้นหา


def test_ตัดคำไทยได้ถูก():
    tokens = ai.tokenize("คอมพิวเตอร์เปิดไม่ติดที่สาขาภูเก็ต")
    assert "คอมพิวเตอร์" in tokens
    assert "ภูเก็ต" in tokens


def test_ค้น_FAQ_เจอแม้ใช้คำต่างจากคีย์เวิร์ด():
    kb = build_knowledge()
    # ผู้ใช้พิมพ์ "ปริ้นงานไม่ออก" ซึ่งไม่ตรงคีย์เวิร์ดตัวไหนแบบ substring เลย
    results = kb.index.search("เครื่องพิมพ์ปริ้นงานไม่ออก", top_k=3)
    assert results, "ควรค้นเจออย่างน้อย 1 รายการ"
    assert results[0][0] == "f1"


def test_ค้น_FAQ_เรื่องรหัสผ่าน():
    kb = build_knowledge()
    results = kb.index.search("ลืมรหัสผ่าน เข้าระบบไม่ได้", top_k=3)
    assert results[0][0] == "f2"


def test_ค้นไม่เจอเมื่อถามเรื่องที่ไม่เกี่ยวเลย():
    kb = build_knowledge()
    analysis = ai.analyze("วันนี้กินข้าวเที่ยงที่ไหนดี", kb)
    assert analysis.faq_matches == []


# ------------------------------------------------------------------ intent / slot


@pytest.mark.parametrize(
    "sentence,expected",
    [
        ("คอมเปิดไม่ติด ช่วยด้วย", "repair"),
        ("ขอเบิกเมาส์หน่อยครับ", "withdraw"),
        ("ต้องการคืนโน้ตบุ๊ค", "return"),
        ("สวัสดีครับ", "unknown"),
    ],
)
def test_จับ_intent_จากประโยค(sentence, expected):
    intent, _ = ai.detect_intent(sentence)
    assert intent == expected


def test_จับสาขาจากประโยคโดยเทียบกับสาขาจริงใน_DB():
    kb = build_knowledge()
    analysis = ai.analyze("คีย์บอร์ดเสียที่สาขาเชียงใหม่", kb)
    assert analysis.intent == "repair"
    assert analysis.branch == "สาขาเชียงใหม่"


def test_จับรหัสทรัพย์สินแบบพิมพ์ย่อ():
    kb = build_knowledge()
    # ของจริงคือ NB2501001 แต่คนพิมพ์ NB-001
    assert ai.extract_asset_code("เครื่อง NB-001 เปิดไม่ติด", kb) == "NB2501001"
    assert ai.extract_asset_code("PC2501001 จอดับ", kb) == "PC2501001"
    assert ai.extract_asset_code("ไม่มีรหัส", kb) is None


def test_จับชื่อของและจำนวนตอนเบิก():
    kb = build_knowledge()
    analysis = ai.analyze("ขอเบิกคีย์บอร์ด 2 อัน", kb)
    assert analysis.intent == "withdraw"
    assert analysis.item_name == "คีย์บอร์ด"
    assert analysis.quantity == 2


def test_จับชื่อของแม้พิมพ์ผิดเล็กน้อย():
    kb = build_knowledge()
    analysis = ai.analyze("ขอเบิกคีย์บอด 1 อัน", kb)
    assert analysis.item_name == "คีย์บอร์ด"


def test_ไม่เอาเลขรหัสทรัพย์สินมาเป็นจำนวน():
    assert ai.extract_quantity("เครื่อง NB2501001 เสีย") is None
    assert ai.extract_quantity("ขอ 3 ชิ้น") == 3


# ------------------------------------------------------------------ ต่อเข้ากับ flow


@pytest.mark.asyncio
async def test_ประโยคเดียวจบ_ไม่ถามซ้ำในสิ่งที่บอกมาแล้ว():
    s = store()
    backend = FakeBackend()
    replies = await handle(
        text("คีย์บอร์ดเสียที่สาขาเชียงใหม่"),
        s,
        backend,
        knowledge=FakeKnowledgeCache(),
    )

    # บอทต้องบอกว่าเข้าใจอะไรบ้าง แล้วข้ามคำถามสาขา/ประเภทไปถามรหัสทรัพย์สินเลย
    assert "รับทราบครับ" in replies[0].text
    assert "สาขา: สาขาเชียงใหม่" in replies[0].text
    assert "เลือกประเภททรัพย์สิน" in replies[1].text  # เดิมเป็นข้อความให้พิมพ์รหัสเอง ตอนนี้เป็นเมนูเลือกทีละชั้น

    session = await s.get(USER)
    assert session.ticket_type == "repair"
    assert session.branch == "สาขาเชียงใหม่"


@pytest.mark.asyncio
async def test_เบิกของด้วยประโยคเดียวแล้วไปต่อจนจบ():
    s = store()
    backend = FakeBackend()
    kc = FakeKnowledgeCache()

    r = await handle(text("ขอเบิกเมาส์ 2 อัน ที่สำนักงานใหญ่"), s, backend, knowledge=kc)
    assert "อุปกรณ์: เมาส์ x2" in r[0].text
    assert "เลือกประเภททรัพย์สิน" in r[1].text  # เดิมเป็นข้อความให้พิมพ์รหัสเอง ตอนนี้เป็นเมนูเลือกทีละชั้น

    # ข้ามรหัสทรัพย์สิน -> ต้องไม่ถามเลือกของซ้ำ เพราะรู้แล้วว่าเบิกเมาส์ 2 อัน
    r = await handle(postback({"a": "skip_asset"}), s, backend, knowledge=kc)
    assert "ระบุชื่อผู้เบิก" in r[0].text

    await handle(text("สมชาย ใจดี - แผนกบัญชี"), s, backend, knowledge=kc)
    r = await handle(text("-"), s, backend, knowledge=kc)

    payload = backend.created[0]
    assert payload["type"] == "withdraw"
    assert payload["location"] == "สำนักงานใหญ่"
    assert payload["items"] == [{"name": "เมาส์", "qty": 2}]
    assert "📦 เมาส์ x2" in r[0].text


@pytest.mark.asyncio
async def test_ระบุรหัสทรัพย์สินมาในประโยคแรกเลย():
    s = store()
    backend = FakeBackend()
    r = await handle(
        text("NB-001 เปิดไม่ติด ที่สำนักงานใหญ่"), s, backend, knowledge=FakeKnowledgeCache()
    )
    assert "ทรัพย์สิน: NB2501001" in r[0].text
    # รู้ครบทั้งสาขา ประเภท และทรัพย์สินแล้ว -> ถามชื่อผู้แจ้งได้เลย
    assert "ระบุชื่อผู้แจ้ง" in r[1].text


@pytest.mark.asyncio
async def test_ถามคำถามทั่วไปได้คำตอบจาก_FAQ_ในระบบ():
    r = await handle(
        text("ปริ้นงานไม่ออกเลยครับ"), store(), FakeBackend(), knowledge=FakeKnowledgeCache()
    )
    assert "เครื่องพิมพ์ไม่ทำงาน" in r[0].text
    assert "ล้างคิวงานพิมพ์" in r[0].text
    assert r[0].quick == M.MENU_BUTTONS


@pytest.mark.asyncio
async def test_เปิดชั้น_LLM_แล้วใช้คำตอบที่เรียบเรียงแทน():
    async def fake_llm(question, faq_matches):
        assert faq_matches, "ต้องส่ง FAQ ที่ค้นเจอไปให้ LLM ใช้อ้างอิงเสมอ"
        return "ลองเช็คสาย USB ก่อนนะครับ ถ้ายังไม่ได้แจ้งทีม IT ได้เลย"

    r = await handle(
        text("ปริ้นงานไม่ออกเลยครับ"),
        store(),
        FakeBackend(),
        knowledge=FakeKnowledgeCache(),
        llm=fake_llm,
    )
    assert r[0].text == "ลองเช็คสาย USB ก่อนนะครับ ถ้ายังไม่ได้แจ้งทีม IT ได้เลย"


# ------------------------------------------------------------------ ถามข้อมูลในระบบ


@pytest.mark.asyncio
async def test_ถามยอดคงเหลือในสต็อกแล้วตอบจากข้อมูลจริง():
    r = await handle(
        text("คีย์บอร์ดเหลือกี่อัน"), store(), FakeBackend(), knowledge=FakeKnowledgeCache()
    )
    assert "ข้อมูลสต็อกล่าสุด" in r[0].text
    assert "คีย์บอร์ด: 4 ชิ้น" in r[0].text


@pytest.mark.asyncio
async def test_ถามสต็อกรวมตอบของที่ใกล้หมดก่อน():
    r = await handle(
        text("ตอนนี้สต็อกเหลือเท่าไหร่บ้าง"), store(), FakeBackend(), knowledge=FakeKnowledgeCache()
    )
    # สมุดเคลมสินค้าเหลือน้อยสุด (2) ต้องถูกยกมาก่อน
    assert "สมุดเคลมสินค้า" in r[0].text


@pytest.mark.asyncio
async def test_ถามว่าทรัพย์สินอยู่กับใคร():
    r = await handle(
        text("NB2501001 ใครถืออยู่"), store(), FakeBackend(), knowledge=FakeKnowledgeCache()
    )
    assert "💻 NB2501001" in r[0].text
    assert "ผู้ถือครอง: สมชาย ใจดี" in r[0].text
    assert "ประวัติซ่อม: 2 ครั้ง" in r[0].text


@pytest.mark.asyncio
async def test_ถามสถานะ_ticket_จากเลขที่():
    r = await handle(
        text("ITRQ2026090158 ถึงไหนแล้ว"), store(), FakeBackend(), knowledge=FakeKnowledgeCache()
    )
    assert "🎫 ITRQ2026090158" in r[0].text
    assert "สถานะ: 🕐 รอดำเนินการ" in r[0].text
    assert "ประเภท: 📦 เบิกอุปกรณ์" in r[0].text


@pytest.mark.asyncio
async def test_เลขที่_ticket_ที่ไม่มีในระบบต้องบอกว่าไม่พบ_ไม่เดา():
    r = await handle(
        text("ITRQ2026099999 ถึงไหนแล้ว"), store(), FakeBackend(), knowledge=FakeKnowledgeCache()
    )
    assert "ไม่พบเลขที่ ITRQ2026099999" in r[0].text


@pytest.mark.asyncio
async def test_ถามเรื่องที่ตัวเองแจ้งไว้():
    r = await handle(
        text("ขอดูเรื่องที่แจ้งไปหน่อย"), store(), FakeBackend(), knowledge=FakeKnowledgeCache()
    )
    assert "เรื่องที่คุณแจ้งไว้ล่าสุด" in r[0].text
    assert "ITRQ2026090158" in r[0].text


def test_ถามยอดสต็อกต้องไม่ถูกตีความว่าจะเบิก():
    kb = build_knowledge()
    assert ai.analyze("คีย์บอร์ดเหลือกี่อัน", kb).intent == "stock_query"
    assert ai.analyze("ขอเบิกคีย์บอร์ด 1 อัน", kb).intent == "withdraw"


def test_แจ้งเสียพร้อมรหัสต้องเป็นแจ้งซ่อม_ไม่ใช่คำถามข้อมูล():
    kb = build_knowledge()
    assert ai.analyze("NB-001 เปิดไม่ติด", kb).intent == "repair"


def test_จับเลขที่_ticket():
    assert ai.extract_ticket_code("เรื่อง ITRQ2026090158 ครับ") == "ITRQ2026090158"
    assert ai.extract_ticket_code("itsr2026090001") == "ITSR2026090001"
    assert ai.extract_ticket_code("ไม่มีเลขที่") is None


def test_แยก_it_service_ออกจาก_withdraw():
    kb = build_knowledge()
    assert ai.analyze("ขอสิทธิ์เข้าถึงโฟลเดอร์แผนก", kb).intent == "it_service"
    assert ai.analyze("ขอติดตั้งโปรแกรมบัญชี", kb).intent == "it_service"


@pytest.mark.asyncio
async def test_LLM_ล่มต้องตกกลับไปใช้คำตอบดิบจาก_FAQ():
    async def broken_llm(question, faq_matches):
        return None

    r = await handle(
        text("ปริ้นงานไม่ออกเลยครับ"),
        store(),
        FakeBackend(),
        knowledge=FakeKnowledgeCache(),
        llm=broken_llm,
    )
    assert "เครื่องพิมพ์ไม่ทำงาน" in r[0].text
