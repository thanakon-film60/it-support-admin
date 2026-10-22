"""เทสต์ "เบิกอุปกรณ์ต้องระบุว่าของอะไร" + ปุ่มยกเลิกทุกขั้น

ที่มา: ผู้ใช้แจ้ง (13 ต.ค. 2026) ว่า ticket เบิกขึ้นแค่ "รายละเอียด: เบิกอุปกรณ์" ไม่รู้ว่าจะเบิกอะไร
(ITRQ2026090012 ในข้อมูลจริง) — ขอให้บังคับระบุอุปกรณ์ ถ้าไม่ระบุก็ให้มีปุ่มยกเลิก

สิ่งที่ต้องไม่พัง:
  - ข้อความที่ไม่ใช่ชื่อของ ("อุปกรณ์", "ของ", ตัวเลขล้วน, ป้ายปุ่มเมนู) ต้องไม่กลายเป็นรายการเบิก
  - ของที่ไม่มีในสต็อกยังพิมพ์เบิกได้ (ของใหม่ที่ไม่เคยมีในระบบต้องเบิกได้)
  - ทุกขั้นของการเบิกมีปุ่ม "❌ ยกเลิก" ให้เห็นทางออก
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import flow as F  # noqa: E402
from app import messages as M  # noqa: E402
from app.flow import handle  # noqa: E402
from app.richmenu import MAIN_BUTTONS  # noqa: E402
from test_flow import USER, FakeBackend, postback, store, text  # noqa: E402

CANCEL = ("❌ ยกเลิก", "a=cancel")


async def at_item_step(s, backend):
    """เดินไปจนถึงขั้น "เลือกอุปกรณ์ที่จะเบิก" แล้วคืนคำตอบของขั้นนั้น"""
    await handle(postback({"a": "start"}), s, backend)
    await handle(text("สำนักงานใหญ่"), s, backend)
    await handle(postback({"a": "type", "v": "withdraw"}), s, backend)
    r = await handle(postback({"a": "skip_asset"}), s, backend)
    assert (await s.get(USER)).step == F.ASK_ITEM
    return r


async def test_ขั้นเลือกอุปกรณ์มีปุ่มพิมพ์ชื่อและยกเลิก_และบอกว่าต้องระบุ():
    s, backend = store(), FakeBackend()
    r = await at_item_step(s, backend)
    assert CANCEL in r[0].quick and M.ITEM_TYPE_BUTTON in r[0].quick
    assert "ต้องระบุอุปกรณ์อย่างน้อย 1 รายการ" in r[0].text


@pytest.mark.parametrize(
    "typed",
    ["อุปกรณ์", "ของ", "เบิกอุปกรณ์", "ขอเบิกอุปกรณ์ครับ", "2", "3 ชิ้น", "๒", "-", "ไม่รู้", "อื่นๆ",
     "เบิก", "พอแล้ว", "ok", "📦 เบิกอุปกรณ์", "ก"],
)
async def test_ข้อความที่ไม่ใช่ชื่ออุปกรณ์ถูกถามใหม่_ไม่กลายเป็นรายการเบิก(typed):
    s, backend = store(), FakeBackend()
    await at_item_step(s, backend)
    await handle(postback({"a": "item_other"}), s, backend)
    r = await handle(text(typed), s, backend)
    assert "ต้องการกี่" not in r[0].text, f"{typed!r} ต้องไม่ถูกรับเป็นชื่ออุปกรณ์"
    assert CANCEL in r[0].quick
    session = await s.get(USER)
    assert session.items == [] and session.pending_item_name is None
    assert session.step == F.ASK_ITEM_NAME, "ไม่ขยับขั้น — พิมพ์ชื่อใหม่ได้ทันที"


async def test_กด_rich_menu_กลางการเบิก_บอกว่ากำลังเบิกอยู่():
    s, backend = store(), FakeBackend()
    await at_item_step(s, backend)
    r = await handle(text(MAIN_BUTTONS[0]["text"]), s, backend)  # "แจ้งซ่อม"
    assert "ตอนนี้กำลังเบิกอุปกรณ์อยู่" in r[0].text
    assert CANCEL in r[0].quick


async def test_พิมพ์ชื่อของที่ไม่มีในสต็อกเบิกได้_และตัดคำว่าขอเบิกออก():
    s, backend = store(), FakeBackend()
    await at_item_step(s, backend)
    r = await handle(text("ขอเบิกสาย HDMI 10 เมตรครับ"), s, backend)
    assert r[0].text.startswith("เลือก: สาย HDMI 10 เมตร ✅"), "ตัดทั้งคำว่า 'ขอเบิก' และ 'ครับ' ออกจากชื่อ"
    assert CANCEL in r[0].quick
    r = await handle(text("1"), s, backend)
    assert "สาย HDMI 10 เมตร" in r[0].text
    assert CANCEL in r[0].quick, "ขั้นถามเพิ่มอีกไหมก็ต้องมีทางออก"


async def test_พิมพ์ชื่อตรงกับของในสต็อก_ใช้ชื่อและหน่วยนับของจริง():
    s, backend = store(), FakeBackend()
    await at_item_step(s, backend)
    r = await handle(text("สมุดเคลมสินค้า"), s, backend)
    assert "ต้องการกี่เล่มครับ?" in r[0].text


async def test_จำนวนผิดยังมีปุ่มยกเลิก():
    s, backend = store(), FakeBackend()
    await at_item_step(s, backend)
    await handle(postback({"a": "item", "v": "st-1"}), s, backend)
    r = await handle(text("หลายอัน"), s, backend)
    assert "กรุณาพิมพ์เป็นตัวเลข" in r[0].text and CANCEL in r[0].quick


async def test_ขั้นเบิกเพิ่ม_พิมพ์พอแล้วแทนการกดปุ่มได้_ไม่กลายเป็นของชื่อพอแล้ว():
    s, backend = store(), FakeBackend()
    await at_item_step(s, backend)
    await handle(postback({"a": "item", "v": "st-2"}), s, backend)
    await handle(text("2"), s, backend)
    r = await handle(text("พอแล้วครับ"), s, backend)
    assert "ผู้เบิกคือใคร" in r[0].text
    assert (await s.get(USER)).items == [{"name": "เมาส์", "qty": 2}]


async def test_ขั้นเบิกเพิ่ม_พิมพ์คำกว้างๆ_ถามซ้ำพร้อมรายการเดิม():
    s, backend = store(), FakeBackend()
    await at_item_step(s, backend)
    await handle(postback({"a": "item", "v": "st-2"}), s, backend)
    await handle(text("2"), s, backend)
    r = await handle(text("อุปกรณ์"), s, backend)
    assert "ไม่เข้าใจข้อความนี้" in r[0].text and "เมาส์ x2" in r[0].text
    assert ("✅ พอแล้ว", "a=done_items") in r[0].quick and CANCEL in r[0].quick
    r = await handle(text("คีย์บอร์ด"), s, backend)
    assert r[0].text.startswith("เลือก: คีย์บอร์ด ✅")


async def test_เบิกด้วยชื่อที่พิมพ์เองจนจบ_ticket_มีรายการของจริง():
    s, backend = store(), FakeBackend()
    await at_item_step(s, backend)
    await handle(postback({"a": "item_other"}), s, backend)
    await handle(text("อุปกรณ์"), s, backend)       # ไม่รับ
    await handle(text("หมึก HP 682"), s, backend)  # รับ
    await handle(text("2"), s, backend)
    await handle(postback({"a": "done_items"}), s, backend)
    r = await handle(text("สมัย"), s, backend)
    assert "📦 หมึก HP 682 x2" in r[0].text
    assert backend.created[0]["items"] == [{"name": "หมึก HP 682", "qty": 2}]


async def test_ยกเลิกกลางการเบิกได้ทุกขั้น():
    for step_actions in (
        [],
        [postback({"a": "item_other"})],
        [postback({"a": "item", "v": "st-1"})],
        [postback({"a": "item", "v": "st-1"}), text("1")],
    ):
        s, backend = store(), FakeBackend()
        await at_item_step(s, backend)
        for incoming in step_actions:
            await handle(incoming, s, backend)
        r = await handle(postback({"a": "cancel"}), s, backend)
        assert r[0].text == M.cancelled().text
        assert await s.get(USER) is None and backend.created == []


async def test_กดพอแล้วจากการ์ดเก่าตอนยังไม่มีของ_ต้องถามอุปกรณ์ไม่ใช่ส่งเรื่อง():
    s, backend = store(), FakeBackend()
    await at_item_step(s, backend)
    r = await handle(postback({"a": "done_items"}), s, backend)
    assert backend.created == []
    assert "เลือกอุปกรณ์ที่ต้องการเบิก" in r[0].text


def test_ปุ่มขั้นเบิกไม่เกินลิมิตของ_LINE():
    many = [{"id": f"s{i}", "name": f"อุปกรณ์ชิ้นที่ {i} ชื่อยาวมากๆ", "unit": "ชิ้น"} for i in range(30)]
    for reply in (M.ask_item(many), M.item_required(many, "x"), M.ask_more_items([{"name": "a", "qty": 1}]),
                  M.ASK_ITEM_NAME, M.ask_qty("a"), M.invalid_qty()):
        assert len(reply.quick) <= M.MAX_QUICK_REPLY_ITEMS
        assert all(len(label) <= M.MAX_QUICK_REPLY_LABEL for label, _ in reply.quick)
        assert reply.quick[-1] == CANCEL, "ปุ่มยกเลิกอยู่ท้ายสุดเสมอ"


# ------------------------------------------------------------------ อักขระล่องหน


async def test_อักขระล่องหนถูกตัดออกจากชื่อผู้แจ้งที่พิมพ์มา():
    s, backend = store(), FakeBackend()
    await at_item_step(s, backend)
    await handle(postback({"a": "item", "v": "st-1"}), s, backend)
    await handle(text("1"), s, backend)
    await handle(postback({"a": "done_items"}), s, backend)
    await handle(text("ธนากร\u200b โฮงทอง\u200b\u00a0- IT"), s, backend)
    payload = backend.created[0]
    assert payload["requester_name"] == "ธนากร โฮงทอง"
    assert payload["requester_department"] == "IT"


# ------------------------------------------------------------------ ป้ายปุ่ม rich menu ไม่ใช่ "คำบอกเล่า"


@pytest.mark.parametrize("label, ticket_type", [("แจ้งซ่อม", "repair"), ("เบิกอุปกรณ์", "withdraw"),
                                                 ("ขอใช้บริการ IT", "it_service")])
async def test_กดเมนูแล้วป้ายปุ่มไม่นับว่าเล่ารายละเอียดมาแล้ว(label, ticket_type):
    """เดิมป้ายปุ่มถูกเก็บเป็นข้อความแรกของผู้ใช้ — แจ้งซ่อมจึงข้ามขั้นรายละเอียดได้ด้วยปุ่ม "ไม่มี ส่งเลย"
    และ ticket ขึ้นแค่ "รายละเอียด: แจ้งซ่อม" / "เบิกอุปกรณ์" ซึ่งไม่ได้บอกอะไรทีม IT เลย"""
    from test_ai import FakeKnowledgeCache

    s, backend = store(), FakeBackend()
    await handle(text(label), s, backend, knowledge=FakeKnowledgeCache())
    session = await s.get(USER)
    assert session.ticket_type == ticket_type
    assert session.initial_message is None
    if ticket_type == "repair":
        assert not F._can_skip_description(session), "ยังไม่ได้เล่าอาการ ต้องข้ามขั้นรายละเอียดไม่ได้"


async def test_พิมพ์เล่าเองยังนับเป็นข้อความแรกตามเดิม():
    from test_ai import FakeKnowledgeCache

    s, backend = store(), FakeBackend()
    await handle(text("ขอเบิกเมาส์ 2 ตัว"), s, backend, knowledge=FakeKnowledgeCache())
    session = await s.get(USER)
    assert session.initial_message == "ขอเบิกเมาส์ 2 ตัว"
    assert session.items == [{"name": "เมาส์", "qty": 2}]
