"""ตรวจการ์ด Flex ด้วย parser ตัวจริงของ line-bot-sdk

ทำไมต้องใช้ parser ตัวจริง ไม่เขียนเช็คคีย์เอง: โครงสร้าง Flex ของ LINE เข้มมาก
ใส่คีย์ผิดตัวเดียว LINE จะปฏิเสธ "ทั้ง request" ตอน runtime แล้วผู้ใช้จะไม่ได้รับอะไรเลย
ซึ่งเป็นอาการที่ดีบักยากที่สุด (บอทเงียบ ไม่มี error ฝั่งเรา) — จับให้ได้ตั้งแต่ตอนเทสต์ดีกว่ามาก
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from linebot.v3.messaging import FlexContainer  # noqa: E402

from app import flex as F  # noqa: E402
from app import messages as M  # noqa: E402
from app.line_api import MAX_ALT_TEXT, to_line_messages  # noqa: E402

# ลิมิตจริงของ LINE: ขนาดรวมของ 1 ข้อความ Flex ต้องไม่เกิน 30 KB
MAX_FLEX_BYTES = 30_000

TICKET = {
    "ticket_code": "ITRQ2026090158",
    "type": "withdraw",
    "status": "in_progress",
    "location": "สำนักงานใหญ่",
    "description": "จอไม่ติด เปิดไม่ขึ้นเลย",
    "requester_name": "สมชาย ใจดี",
    "created_at_th": "15 ก.ย. 69 17:27",
}

STOCK = [
    {"name": "คีย์บอร์ด", "unit": "ชิ้น", "quantity_available": 4, "stock_status": "ต่ำกว่า"},
    {"name": "ขาตั้ง Tablet", "unit": "ชิ้น", "quantity_available": 5, "stock_status": "ถึงขั้นต่ำ"},
    {"name": "เมาส์", "unit": "ชิ้น", "quantity_available": 6, "stock_status": "ปกติ"},
]

EQUIPMENT = {
    "asset_code": "NB2501001",
    "brand_model": "LENOVO ThinkPad E14",
    "status": "ใช้งานอยู่",
    "install_location": "สำนักงานใหญ่",
    "holder_name": "สมชาย ใจดี",
    "holder_department": "แผนกบัญชี",
    "repair_count": 2,
}

FAQ = [
    {"title": "ปริ้นเอกสารไม่ได้", "content": "1. เช็คสายไฟ\n2. เช็คคิวงานพิมพ์\n3. ลองรีสตาร์ตเครื่องพิมพ์"},
    {"title": "เครื่องพิมพ์กระดาษติด", "content": "ดึงกระดาษออกช้าๆ ตามทิศทางกระดาษ"},
]


def _all_cards() -> dict[str, dict]:
    return {
        "welcome": F.welcome("Film 🎬"),
        "welcome_ไม่มีชื่อ": F.welcome(None),
        "ticket_created": F.ticket_created(
            ticket_code="ITRQ2026090158", branch="สำนักงานใหญ่", ticket_type="withdraw",
            requester_name="สมัย", asset_label="NB2501001 — LENOVO ThinkPad E14",
            items=[{"name": "คีย์บอร์ด", "qty": 1}, {"name": "เมาส์", "qty": 2}], image_count=2,
        ),
        "ticket_created_ไม่มีของ": F.ticket_created(
            ticket_code="ITSR2026090001", branch="ภูเก็ต", ticket_type="repair",
            requester_name="สมชาย", asset_label=None, items=[], image_count=0,
        ),
        "stock_list": F.stock_list(STOCK),
        "stock_list_ว่าง": F.stock_list([]),
        "asset_detail": F.asset_detail(EQUIPMENT),
        "ticket_status": F.ticket_status(TICKET),
        "my_tickets": F.my_tickets([TICKET, dict(TICKET, status="resolved")]),
        "my_tickets_ว่าง": F.my_tickets([]),
        "faq_answer": F.faq_answer(FAQ),
    }


@pytest.mark.parametrize("name", list(_all_cards().keys()))
def test_การ์ดทุกใบผ่าน_parser_ของ_LINE(name):
    card = _all_cards()[name]
    # ถ้าโครงสร้างผิด บรรทัดนี้จะ throw — เท่ากับ LINE จะปฏิเสธตอน runtime
    FlexContainer.from_json(json.dumps(card, ensure_ascii=False))


@pytest.mark.parametrize("name", list(_all_cards().keys()))
def test_การ์ดไม่เกินลิมิตขนาดของ_LINE(name):
    size = F.estimate_size(_all_cards()[name])
    assert size <= MAX_FLEX_BYTES, f"{name} ใหญ่ {size} ไบต์ เกินลิมิต {MAX_FLEX_BYTES}"


def test_carousel_ไม่เกิน_12_ใบ():
    """LINE รับ carousel ได้สูงสุด 12 การ์ด เกินแล้วปฏิเสธทั้ง request"""
    many = [dict(TICKET, ticket_code=f"ITSR20260900{i:02d}") for i in range(30)]
    card = F.my_tickets(many)
    assert card["type"] == "carousel"
    assert len(card["contents"]) <= 12
    FlexContainer.from_json(json.dumps(card, ensure_ascii=False))


def test_สต็อกแสดงสีตามสถานะจริง():
    """สีคือสิ่งที่ผู้ใช้อ่านก่อนตัวเลข ถ้าแมปผิดจะสื่อสารผิดทั้งใบ"""
    card = F.stock_list(STOCK)
    blob = json.dumps(card, ensure_ascii=False)
    assert F.DANGER_COLOR in blob, "ของที่ต่ำกว่าขั้นต่ำต้องเป็นสีแดง"
    assert F.WARN_COLOR in blob, "ของที่ถึงขั้นต่ำต้องเป็นสีส้ม"
    assert F.OK_COLOR in blob, "ของที่ปกติต้องเป็นสีเขียว"


def test_ปุ่มในการ์ดไม่เกิน_20_ตัวอักษร():
    """label ของ action ยาวเกิน 20 ตัว LINE ปฏิเสธทั้ง request"""
    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "button":
                label = node["action"].get("label", "")
                assert len(label) <= 20, f"ปุ่ม '{label}' ยาว {len(label)} ตัว"
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    for card in _all_cards().values():
        walk(card)


# ---------------------------------------------------------------- การแปลงเป็นข้อความจริง


def test_reply_ที่มี_flex_ถูกส่งเป็นการ์ด():
    replies = [M.ticket_created(
        ticket_code="ITRQ2026090158", branch="สำนักงานใหญ่", ticket_type="withdraw",
        requester_name="สมัย", asset_label=None, items=[{"name": "คีย์บอร์ด", "qty": 1}],
        image_count=0,
    )]
    msgs = to_line_messages(replies)
    assert len(msgs) == 1
    assert msgs[0].type == "flex", "ต้องส่งเป็น FlexMessage"
    assert "ITRQ2026090158" in msgs[0].alt_text, "altText ต้องมีเลข ticket ให้เห็นในแจ้งเตือน"


@pytest.mark.parametrize("ticket_type", ["repair", "it_service", "return", "withdraw"])
def test_description_button_opens_keyboard_in_serialized_line_message(ticket_type):
    reply = M.ask_description(ticket_type)
    msgs = to_line_messages([reply])
    card = json.loads(msgs[0].to_json())
    action = card["contents"]["footer"]["contents"][0]["action"]
    assert action["type"] == "postback"
    assert action["data"] == "a=write_description"
    assert action["inputOption"] == "openKeyboard"
    assert not action.get("fillInText")
    assert len(action["label"]) <= 20
    assert F.estimate_size(reply.flex) <= MAX_FLEX_BYTES


def test_asset_picker_free_text_shortcut_opens_keyboard_in_card_and_quick_reply():
    message = to_line_messages([M.ask_asset_category([
        {"value": "notebook", "label": "โน้ตบุ๊ค", "count": 1},
    ])])[0]
    card = json.loads(message.to_json())
    actions = [button["action"] for button in card["contents"]["footer"]["contents"]]
    quick_actions = [item["action"] for item in card["quickReply"]["items"]]
    for options in (actions, quick_actions):
        action = next(a for a in options if a.get("data") == "a=describe_request")
        assert action["inputOption"] == "openKeyboard"


def test_reply_ที่ไม่มี_flex_ยังเป็นข้อความธรรมดา():
    msgs = to_line_messages([M.ASK_BRANCH])
    assert msgs[0].type == "text"


def test_altText_ถูกตัดไม่ให้เกินลิมิต():
    """altText เกิน 400 ตัว LINE ปฏิเสธทั้ง request — ต้องตัดให้เองก่อนส่ง"""
    long_reply = M.Reply(text="ก" * 1000, flex=F.stock_list(STOCK))
    msgs = to_line_messages([long_reply])
    assert len(msgs[0].alt_text) <= MAX_ALT_TEXT


def test_การ์ดพังต้องไม่ทําให้ผู้ใช้ไม่ได้รับอะไรเลย():
    """ถ้า flex ผิดรูป ต้องตกกลับไปเป็นข้อความธรรมดา ไม่ใช่เงียบ"""
    broken = M.Reply(text="ข้อความสำรอง", flex={"type": "ไม่มีชนิดนี้"})
    msgs = to_line_messages([broken])
    assert len(msgs) == 1
    assert msgs[0].type == "text"
    assert msgs[0].text == "ข้อความสำรอง"


def test_quick_reply_ยังอยู่บนการ์ด():
    """ปุ่ม quick reply ต้องติดไปกับข้อความสุดท้ายเหมือนเดิม แม้ข้อความนั้นเป็นการ์ด"""
    replies = [M.stock_answer(STOCK)]
    msgs = to_line_messages(replies)
    assert msgs[-1].quick_reply is not None
    assert len(msgs[-1].quick_reply.items) == len(M.MENU_BUTTONS)
