"""ข้อความภาษาไทยและปุ่ม quick reply ทั้งหมดของบอท

แยกออกมาไฟล์เดียวโดยเฉพาะ เพราะข้อความคือสิ่งที่ต้องแก้บ่อยที่สุด (ปรับคำ เปลี่ยน emoji
เพิ่มสาขา) การให้มันปนอยู่กับ logic จะทำให้แก้คำพูดทีต้องไปยุ่งกับ state machine ทุกที

ข้อจำกัดจริงของ LINE ที่มีผลกับไฟล์นี้ (ถ้าเกินจะโดน API ปฏิเสธทั้ง request):
  - quick reply ได้สูงสุด 13 ปุ่มต่อ 1 ข้อความ
  - label ของปุ่มยาวได้ไม่เกิน 20 ตัวอักษร
  - postback data ยาวได้ไม่เกิน 300 ไบต์
  - ข้อความ text ยาวได้ไม่เกิน 5000 ตัวอักษร
"""

from __future__ import annotations

from dataclasses import dataclass, field

MAX_QUICK_REPLY_ITEMS = 13
MAX_QUICK_REPLY_LABEL = 20

CANCEL_WORDS = {"ยกเลิก", "cancel", "ยกเลิกรายการ", "ออก"}
NO_DETAIL_WORDS = {"-", "ไม่มี", "ไม่", "none"}

# ป้ายชื่อประเภทเรื่อง — ถอดมาจากปุ่มของบอทต้นแบบตรงๆ
TYPE_LABEL = {
    "repair": "🖊 แจ้งซ่อม",
    "withdraw": "📦 เบิกอุปกรณ์",
    "return": "🔄 คืนอุปกรณ์",
    "it_service": "🛠 ขอใช้บริการ IT",
}

# คำเรียกผู้แจ้งต่างกันตามประเภทเรื่อง — ใช้ทั้งตอนถามและตอนสรุป
PERSON_LABEL = {
    "repair": "ผู้แจ้ง",
    "withdraw": "ผู้เบิก",
    "return": "ผู้คืน",
    "it_service": "ผู้แจ้ง",
}

# ใช้ในบรรทัดสรุปท้ายสุด (ต้นแบบใช้คำว่า "ผู้รับ/คืน" สำหรับเบิกและคืน)
SUMMARY_PERSON_LABEL = {
    "repair": "ผู้แจ้ง",
    "withdraw": "ผู้รับ/คืน",
    "return": "ผู้รับ/คืน",
    "it_service": "ผู้แจ้ง",
}

TICKET_STATUS_LABEL = {
    "pending": "🕐 รอดำเนินการ",
    "in_progress": "🔧 กำลังดำเนินการ",
    "waiting_info": "❓ รอข้อมูลเพิ่มเติม",
    "waiting_delivery": "🚚 รออะไหล่/จัดส่ง",
    "resolved": "✅ แก้ไขเสร็จแล้ว",
    "closed": "📁 ปิดงานแล้ว",
    "cancelled": "❌ ยกเลิก",
}


@dataclass
class Reply:
    """ข้อความ 1 บับเบิลที่จะตอบกลับ

    quick = รายการปุ่ม [(label, postback_data), ...]
    หมายเหตุ: LINE จะแสดง quick reply ของ "ข้อความสุดท้าย" ในชุดที่ตอบกลับเท่านั้น
    ตัวแปลงใน line_api.py จะจัดการเรื่องนี้ให้ ไม่ต้องกังวลตอนเขียน flow
    """

    text: str
    quick: list[tuple[str, str]] = field(default_factory=list)


def truncate_label(label: str) -> str:
    if len(label) <= MAX_QUICK_REPLY_LABEL:
        return label
    return label[: MAX_QUICK_REPLY_LABEL - 1] + "…"


# ---------------------------------------------------------------- เมนู / ทั่วไป

MENU_BUTTONS: list[tuple[str, str]] = [
    ("📝 แจ้งเรื่องใหม่", "a=start"),
    ("❓ คำถามที่พบบ่อย", "a=faq_menu"),
]


def welcome(display_name: str | None) -> Reply:
    """ตอบตอนมีคนกดเพิ่มเพื่อน (follow event) — ข้อความแรกที่ทุกคนเห็น

    เดิมข้อความนี้สั้นมาก ("สวัสดีครับ" + ปุ่ม 2 ปุ่ม) โดยตั้งใจให้ข้อความแนะนำบริการไปอยู่ที่
    "Greeting message" ของ LINE OA Manager แทน — แต่ตรวจสอบจริงเมื่อ 2026-09-14 พบว่า
    Greeting message ถูก "ปิด" อยู่ แปลว่าคำแนะนำนั้นไม่เคยถูกส่งถึงใครเลยสักคน
    คนที่แอดเข้ามาจึงไม่รู้ว่าบอทตัวนี้ทำอะไรได้บ้าง

    จึงย้ายคำแนะนำมาไว้ในโค้ดนี้ที่เดียว ข้อดีที่ได้เพิ่ม:
      - ทักชื่อผู้ใช้ได้ (Greeting message ของ LINE ทำได้แค่ตัวแปรชื่อแบบจำกัด)
      - แก้ที่เดียว ไม่ต้องจำว่ามีข้อความซ่อนอยู่อีกที่ในคอนโซล
      - ไม่เสี่ยงส่งซ้ำสองข้อความตอนแอด ถ้าวันหนึ่งมีคนไปเปิด Greeting message

    สิ่งที่ตั้งใจใส่ในข้อความนี้ (ไม่ได้ใส่ให้ครบๆ):
      1. บอกว่าแจ้งอะไรได้บ้าง -> คนตัดสินใจได้ทันทีว่าใช่ที่ต้องการไหม
      2. สอน "พิมพ์ถามตรงๆ ได้" พร้อมตัวอย่างจริง 3 แบบ -> เป็นจุดที่บอทตัวนี้เก่งกว่าเมนูกดปุ่ม
         แต่ถ้าไม่บอก แทบไม่มีใครลองพิมพ์เอง (คนคุ้นกับบอทที่กดปุ่มอย่างเดียว)
      3. ปิดท้ายด้วยทางเลือกที่ทำต่อได้ทันที ไม่ปล่อยให้คิดเอง
    """
    name = (display_name or "").strip()
    # ไม่เติม "คุณ" นำหน้า — ชื่อที่ได้จาก LINE คือ display name ซึ่งมักเป็นชื่อเล่นหรือมีอิโมจิ
    # ("คุณFilm 🎬" อ่านแล้วแปลกกว่า "Film 🎬") และเทสต์/e2e ผูกกับรูปแบบนี้ไว้ด้วย
    greeting = f"สวัสดีครับ {name} 👋" if name else "สวัสดีครับ 👋"
    return Reply(
        text=(
            f"{greeting}\n"
            "ยินดีต้อนรับสู่ระบบแจ้งปัญหา IT ครับ\n"
            "\n"
            "📌 แจ้งเรื่องได้ 4 ประเภท\n"
            "🖊 แจ้งซ่อม · 📦 เบิกอุปกรณ์\n"
            "🔄 คืนอุปกรณ์ · 🛠 ขอใช้บริการ IT\n"
            "\n"
            "💬 หรือพิมพ์ถามตรงๆ ได้เลย เช่น\n"
            "• คีย์บอร์ดเหลือกี่อัน\n"
            "• NB2501001 ใครถืออยู่\n"
            "• เรื่องที่ฉันแจ้งไว้ถึงไหนแล้ว\n"
            "\n"
            "กดปุ่มด้านล่าง หรือพิมพ์บอกปัญหามาได้เลยครับ"
        ),
        quick=MENU_BUTTONS,
    )


def menu() -> Reply:
    return Reply(text="เลือกสิ่งที่ต้องการได้เลยครับ:", quick=MENU_BUTTONS)


def cancelled() -> Reply:
    return Reply(text="ยกเลิกรายการแล้วครับ 🙏", quick=MENU_BUTTONS)


def session_expired() -> Reply:
    return Reply(
        text="รายการเดิมหมดเวลาไปแล้วครับ (ทิ้งไว้นานเกิน 30 นาที)\nเริ่มแจ้งใหม่ได้เลยครับ",
        quick=MENU_BUTTONS,
    )


def backend_error() -> Reply:
    return Reply(
        text="ขออภัยครับ ระบบขัดข้องชั่วคราว บันทึกเรื่องไม่สำเร็จ 🙏\nรบกวนลองใหม่อีกครั้ง หรือติดต่อทีม IT โดยตรง",
        quick=MENU_BUTTONS,
    )


# ---------------------------------------------------------------- ขั้นตอนแจ้งเรื่อง

ASK_BRANCH = Reply(text="พิมพ์ชื่อสาขาของคุณเพื่อเริ่มแจ้งเรื่องครับ\n\n(พิมพ์ 'ยกเลิก' เพื่อออก)")


def ask_type(branch: str) -> Reply:
    return Reply(
        text=f"สาขา: {branch} ✅\n\nแจ้งเรื่องอะไรครับ?",
        quick=[
            ("🖊 แจ้งซ่อม", "a=type&v=repair"),
            ("📦 เบิกอุปกรณ์", "a=type&v=withdraw"),
            ("🔄 คืนอุปกรณ์", "a=type&v=return"),
            ("🛠 ขอใช้บริการ IT", "a=type&v=it_service"),
        ],
    )


def branch_not_found(examples: list[str]) -> Reply:
    """สาขาที่พิมพ์มาไม่มีในระบบ

    ทำไมต้องตรวจ ไม่รับทุกอย่างที่พิมพ์มา: ถ้าปล่อยผ่าน ticket จะเต็มไปด้วยสาขาที่สะกดไม่ตรงกัน
    ("สนง.ใหญ่", "สำนักงานให่ญ", "HQ") แล้วรายงานแยกตามสาขาจะใช้ไม่ได้เลย
    การดักตั้งแต่ต้นทางถูกกว่าการมานั่งล้างข้อมูลทีหลังมาก
    """
    sample = ", ".join(examples[:2]) if examples else "ภูเก็ต, สำนักงานใหญ่"
    return Reply(
        text=(
            "ไม่พบสาขาที่ตรงกันครับ ลองพิมพ์ใหม่\n\n"
            f"เช่น: {sample}\n\n"
            "(พิมพ์ 'ยกเลิก' เพื่อออก)"
        )
    )


ASK_ASSET_CODE = Reply(
    text=(
        "ระบุหมายเลขทรัพย์สินครับ\n\n"
        "เช่น: NB-001, PC-002\n"
        "(พิมพ์เลขได้เลย หรือกดปุ่มถ้าไม่ทราบ/ไม่มี)"
    ),
    quick=[("ไม่มี/ไม่ทราบ", "a=skip_asset")],
)


def asset_not_found(code: str) -> Reply:
    return Reply(
        text=f"ไม่พบหมายเลข '{code}' ในระบบครับ\n\nลองพิมพ์ใหม่อีกครั้ง หรือกดข้ามไปก่อนได้ครับ",
        quick=[("ข้ามไปก่อน", "a=skip_asset")],
    )


def asset_confirmed(label: str) -> Reply:
    return Reply(text=f"ทรัพย์สิน: {label} ✅")


def ask_item(stock_items: list[dict]) -> Reply:
    """ปุ่มเลือกอุปกรณ์ที่จะเบิก — ดึงรายการจริงจากสต็อกในระบบ admin

    ถ้าของในสต็อกมีเกิน 13 รายการ LINE ใส่ปุ่มไม่ไหว จึงตัดให้เหลือ 12 ปุ่ม
    แล้วเพิ่มปุ่ม 'อื่นๆ (พิมพ์เอง)' ไว้ให้พิมพ์ชื่อของที่ไม่อยู่ในปุ่มได้
    """
    buttons: list[tuple[str, str]] = []
    for item in stock_items[: MAX_QUICK_REPLY_ITEMS - 1]:
        buttons.append((truncate_label(item["name"]), f"a=item&v={item['id']}"))
    buttons.append(("✏️ อื่นๆ (พิมพ์เอง)", "a=item_other"))
    return Reply(text="เลือกอุปกรณ์ที่ต้องการเบิกครับ:", quick=buttons)


ASK_ITEM_NAME = Reply(
    text="พิมพ์ชื่ออุปกรณ์ที่ต้องการเบิกครับ\n\n(พิมพ์ 'ยกเลิก' เพื่อออก)"
)


def ask_qty(item_name: str, unit: str = "ชิ้น") -> Reply:
    return Reply(
        text=(
            f"เลือก: {item_name} ✅\n\n"
            f"ต้องการกี่{unit}ครับ? (พิมพ์ตัวเลข)\n\n"
            "(พิมพ์ 'ยกเลิก' เพื่อออก)"
        )
    )


def invalid_qty(unit: str = "ชิ้น") -> Reply:
    return Reply(text=f"กรุณาพิมพ์เป็นตัวเลขครับ เช่น 1 หรือ 2 (จำนวน{unit})")


def ask_more_items(items: list[dict]) -> Reply:
    summary = "\n".join(f"• {i['name']} x{i['qty']}" for i in items)
    return Reply(
        text=f"รายการที่เบิกตอนนี้:\n{summary}\n\nต้องการเพิ่มอีกไหมครับ?",
        quick=[("➕ เพิ่มอีก", "a=add_item"), ("✅ พอแล้ว", "a=done_items")],
    )


def ask_requester(ticket_type: str) -> Reply:
    who = PERSON_LABEL.get(ticket_type, "ผู้แจ้ง")
    return Reply(
        text=(
            f"ระบุชื่อ{who} (ชื่อ-นามสกุล และแผนก) ครับ\n\n"
            "เช่น: สมชาย ใจดี - แผนกบัญชี\n\n"
            "(พิมพ์ 'ยกเลิก' เพื่อออก)"
        )
    )


ASK_DESCRIPTION = Reply(
    text="มีรายละเอียดเพิ่มเติมไหมครับ? (หรือพิมพ์ '-' ถ้าไม่มี)\n\n(พิมพ์ 'ยกเลิก' เพื่อออก)"
)

ASK_DESCRIPTION_REPAIR = Reply(
    text="ช่วยอธิบายอาการเสียให้หน่อยครับ\n\nเช่น: เปิดไม่ติด, จอมีเส้น, เสียงดังผิดปกติ\n\n(พิมพ์ 'ยกเลิก' เพื่อออก)"
)


def ticket_created(
    *,
    ticket_code: str,
    branch: str,
    ticket_type: str,
    requester_name: str,
    asset_label: str | None,
    items: list[dict],
) -> Reply:
    """ข้อความสรุปปิดท้าย — รูปแบบเดียวกับบอทต้นแบบ"""
    lines = [
        "✅ รับเรื่องแล้วครับ!",
        "",
        f"🎫 {ticket_code}",
        f"📍 สาขา: {branch}",
        f"📋 ประเภท: {TYPE_LABEL.get(ticket_type, ticket_type)}",
        f"👤 {SUMMARY_PERSON_LABEL.get(ticket_type, 'ผู้แจ้ง')}: {requester_name}",
    ]
    if asset_label:
        lines.append(f"💻 ทรัพย์สิน: {asset_label}")
    for item in items:
        lines.append(f"📦 {item['name']} x{item['qty']}")
    lines += ["", "ทีม IT จะติดต่อกลับโดยเร็วที่สุดครับ 🙏"]
    return Reply(text="\n".join(lines), quick=MENU_BUTTONS)


# ---------------------------------------------------------------- FAQ

def understood(parts: list[str]) -> Reply:
    """บอกผู้ใช้ว่าบอทจับอะไรจากประโยคได้บ้าง ก่อนจะถามส่วนที่ขาด

    สำคัญมากในเชิง UX: AI เดาได้ก็เดาผิดได้ การแสดงสิ่งที่เข้าใจออกมาให้เห็น
    ทำให้ผู้ใช้จับผิดได้ทันทีและพิมพ์ 'ยกเลิก' แทนที่จะปล่อยให้ ticket ผิดไหลเข้าระบบ
    """
    body = "\n".join(f"• {p}" for p in parts)
    return Reply(text=f"รับทราบครับ 👍\n{body}")


FAQ_PROMPT = Reply(
    text="พิมพ์คำถามหรือคำที่เกี่ยวข้องมาได้เลยครับ\n\nเช่น: ปริ้นเตอร์, wifi, รหัสผ่าน",
    quick=MENU_BUTTONS,
)


def faq_answer(matches: list[dict]) -> Reply:
    blocks = []
    for faq in matches[:3]:
        blocks.append(f"📌 {faq['title']}\n{faq['content']}")
    body = "\n\n———\n\n".join(blocks)
    # กันข้อความยาวเกินลิมิต 5000 ตัวอักษรของ LINE
    if len(body) > 4500:
        body = body[:4500] + "…"
    return Reply(text=body, quick=MENU_BUTTONS)


def faq_answer_with_ticket_option(matches: list[dict]) -> Reply:
    """ผู้ใช้กำลังจะแจ้งปัญหา แต่ระบบมีวิธีแก้อยู่แล้ว — เสนอวิธีแก้ก่อน แล้วค่อยให้เลือกว่าจะแจ้งไหม

    คุณค่าทางธุรกิจอยู่ตรงนี้: ทุกเรื่องที่ผู้ใช้แก้เองได้จาก FAQ คือ ticket ที่ทีม IT ไม่ต้องทำ
    แต่ต้องไม่ปิดทาง — ถ้าวิธีใน FAQ ไม่ได้ผล ต้องกดแจ้งต่อได้ทันทีในบับเบิลเดียวกัน
    """
    reply = faq_answer(matches)
    reply.text += "\n\n———\nถ้าลองแล้วยังไม่หาย กด 'แจ้งเรื่องใหม่' ให้ทีม IT ช่วยได้เลยครับ"
    return reply


def faq_answer_text(text: str) -> Reply:
    """คำตอบที่ผ่านการเรียบเรียงโดย LLM แล้ว"""
    return Reply(text=text.strip()[:4500], quick=MENU_BUTTONS)


# ---------------------------------------------------------------- ตอบคำถามจากข้อมูลในระบบ


def stock_answer(items: list[dict]) -> Reply:
    """ตอบว่าของในสต็อกเหลือเท่าไร — ดึงจากตารางสต็อกจริงของระบบ"""
    lines = ["📦 ข้อมูลสต็อกล่าสุด", ""]
    for item in items[:5]:
        quantity = item.get("quantity_available", 0)
        unit = item.get("unit") or "ชิ้น"
        status = item.get("stock_status")
        flag = ""
        if status == "ต่ำกว่า":
            flag = "  ⚠️ ต่ำกว่าขั้นต่ำ"
        elif status == "ถึงขั้นต่ำ":
            flag = "  ⚠️ ถึงขั้นต่ำแล้ว"
        lines.append(f"• {item['name']}: {quantity} {unit}{flag}")
    lines += ["", "ต้องการเบิกกดปุ่มด้านล่างได้เลยครับ"]
    return Reply(text="\n".join(lines), quick=MENU_BUTTONS)


def asset_answer(equipment: dict) -> Reply:
    """ตอบข้อมูลทรัพย์สิน 1 ชิ้น — รหัส/รุ่น/สถานะ/ผู้ถือครอง/ที่ตั้ง"""
    lines = [
        f"💻 {equipment['asset_code']}",
        "",
        f"รุ่น: {equipment.get('brand_model') or '-'}",
        f"สถานะ: {equipment.get('status') or '-'}",
        f"ผู้ถือครอง: {equipment.get('holder_name') or 'ยังไม่มีผู้ถือครอง'}",
        f"ที่ตั้ง: {equipment.get('install_location') or '-'}",
    ]
    if equipment.get("repair_count") is not None:
        lines.append(f"ประวัติซ่อม: {equipment['repair_count']} ครั้ง")
    return Reply(text="\n".join(lines), quick=MENU_BUTTONS)


def ticket_answer(ticket: dict) -> Reply:
    """ตอบสถานะของ ticket ที่ถามมา"""
    lines = [
        f"🎫 {ticket['ticket_code']}",
        "",
        f"สถานะ: {TICKET_STATUS_LABEL.get(ticket['status'], ticket['status'])}",
        f"ประเภท: {TYPE_LABEL.get(ticket['type'], ticket['type'])}",
        f"สาขา: {ticket.get('location') or '-'}",
        f"ผู้แจ้ง: {ticket.get('requester_name') or '-'}",
        f"แจ้งเมื่อ: {ticket.get('created_at_th') or '-'}",
    ]
    if ticket.get("description"):
        lines.append(f"รายละเอียด: {ticket['description']}")
    return Reply(text="\n".join(lines), quick=MENU_BUTTONS)


def my_tickets_answer(tickets: list[dict]) -> Reply:
    if not tickets:
        return Reply(
            text="ยังไม่พบเรื่องที่คุณแจ้งไว้ในระบบครับ",
            quick=MENU_BUTTONS,
        )
    lines = ["📋 เรื่องที่คุณแจ้งไว้ล่าสุด", ""]
    for ticket in tickets[:5]:
        lines.append(
            f"🎫 {ticket['ticket_code']}  {TICKET_STATUS_LABEL.get(ticket['status'], ticket['status'])}"
        )
        lines.append(f"   {TYPE_LABEL.get(ticket['type'], ticket['type'])} • {ticket.get('created_at_th') or ''}")
    return Reply(text="\n".join(lines), quick=MENU_BUTTONS)


def ticket_not_found(code: str) -> Reply:
    return Reply(text=f"ไม่พบเลขที่ {code} ในระบบครับ 🙏", quick=MENU_BUTTONS)


def faq_not_found() -> Reply:
    return Reply(
        text=(
            "ยังไม่มีคำตอบสำหรับคำถามนี้ในระบบครับ 🙏\n\n"
            "ถ้าต้องการให้ทีม IT ช่วย กด 'แจ้งเรื่องใหม่' ได้เลยครับ"
        ),
        quick=MENU_BUTTONS,
    )
