"""การ์ด Flex Message — หน้าตาของบอทที่ผู้ใช้เห็นจริง

ทำไมต้องมีไฟล์นี้: บอทต้นแบบตอบด้วยข้อความเปล่าล้วน อ่านยากเวลาข้อมูลเยอะ
(เลข ticket ปนอยู่กลางย่อหน้า, สถานะสต็อกต้องอ่านตัวเลขเทียบเอง) Flex Message ทำให้
ข้อมูลเดียวกัน "สแกนด้วยตาได้ใน 1 วินาที" — เลขที่ใหญ่ชัด สถานะเป็นสี ปุ่มกดต่อได้ทันที

หลักที่ยึดไว้ทั้งไฟล์:
  1. ทุกการ์ดต้องมี altText เป็นข้อความธรรมดาเสมอ — คนที่เปิดจากนาฬิกา/แจ้งเตือน
     หรือ LINE เวอร์ชันเก่าจะเห็นข้อความนั้นแทน ไม่ใช่เห็นว่างเปล่า
  2. ไม่ใส่รูปจากอินเทอร์เน็ตภายนอก — โหลดช้าและพังเมื่อเน็ตองค์กรบล็อก ใช้สี+ไอคอนข้อความแทน
  3. สีสื่อความหมายเดียวกันทั้งระบบ: เขียว=ปกติ/เสร็จ ส้ม=ใกล้หมด/รอ แดง=ขาด/ยกเลิก

ข้อจำกัดของ LINE ที่มีผลกับไฟล์นี้:
  - carousel ใส่ได้สูงสุด 12 การ์ด
  - ขนาด JSON ของ 1 ข้อความรวมแล้วต้องไม่เกิน 30 KB
  - ปุ่มใน footer ไม่ควรเกิน 3-4 ปุ่มต่อการ์ด ไม่งั้นการ์ดยาวเกินหน้าจอมือถือ
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------- ชุดสี

# สีหลักของระบบ เลือกโทนเดียวกับหน้าแอดมิน เพื่อให้คนที่เห็นทั้งสองฝั่งรู้สึกว่าเป็นระบบเดียวกัน
INK = "#172B4D"          # ตัวหนังสือหลัก
MUTED = "#64748B"        # ตัวหนังสือรอง
LINE_COLOR = "#E2EAF3"   # เส้นคั่น
BG_SOFT = "#F4F7FB"      # พื้นอ่อนสำหรับกล่องย่อย
BRAND_NAVY = "#102D50"
BRAND_BLUE = "#176BDA"
BRAND_TINT = "#EDF5FF"

OK_COLOR = "#16A34A"      # เขียว — ปกติ / เสร็จแล้ว
WARN_COLOR = "#EA580C"    # ส้ม — ใกล้หมด / กำลังดำเนินการ
DANGER_COLOR = "#DC2626"  # แดง — ต่ำกว่าขั้นต่ำ / ยกเลิก
INFO_COLOR = BRAND_BLUE   # น้ำเงิน — ข้อมูลทั่วไป

# สีประจำประเภทเรื่อง ใช้เป็นแถบหัวการ์ด ทำให้แยกประเภทได้ตั้งแต่ยังไม่อ่านตัวหนังสือ
TYPE_COLOR = {
    "repair": "#F97316",
    "withdraw": "#2563EB",
    "return": "#8B5CF6",
    "it_service": "#0EA5E9",
}

TYPE_TEXT = {
    "repair": "แจ้งซ่อม",
    "withdraw": "เบิกอุปกรณ์",
    "return": "คืนอุปกรณ์",
    "it_service": "ขอใช้บริการ IT",
}

# สีตามสถานะ ticket — ให้ตรงกับความรู้สึก: รอ=เทา กำลังทำ=ส้ม เสร็จ=เขียว ยกเลิก=แดง
STATUS_COLOR = {
    "pending": "#64748B",
    "in_progress": WARN_COLOR,
    "waiting_info": "#A855F7",
    "waiting_delivery": "#0891B2",
    "resolved": OK_COLOR,
    "completed": "#059669",
    "closed": "#334155",
    "cancelled": DANGER_COLOR,
}

STATUS_TEXT = {
    "pending": "รอดำเนินการ",
    "in_progress": "กำลังดำเนินการ",
    "waiting_info": "รอข้อมูลเพิ่ม",
    "waiting_delivery": "รออะไหล่/จัดส่ง",
    "resolved": "เสร็จแล้ว",
    "completed": "สำเร็จแล้ว",
    "closed": "ปิดงานแล้ว",
    "cancelled": "ยกเลิก",
}


# ---------------------------------------------------------------- ชิ้นส่วนที่ใช้ซ้ำ


def _text(value: str, **kw: Any) -> dict:
    """กล่องข้อความ 1 บรรทัด — wrap=True เสมอ เพราะชื่อทรัพย์สิน/สาขาภาษาไทยยาวเกินบรรทัดได้ง่าย
    ถ้าไม่ wrap ข้อความจะถูกตัดหายไปเงียบๆ โดยผู้ใช้ไม่รู้ว่ามีต่อ"""
    node = {"type": "text", "text": value or "-", "wrap": True, "size": "sm", "color": INK}
    node.update(kw)
    return node


def _row(label: str, value: str, *, value_color: str = INK, bold: bool = False) -> dict:
    """หนึ่งแถวของตาราง label ซ้าย / ค่าขวา

    flex 2:5 มาจากการลองจริง — ป้ายภาษาไทยอย่าง "ทรัพย์สินที่เกี่ยวข้อง" ต้องการพื้นที่พอสมควร
    แต่ถ้าให้มากกว่านี้ ค่าทางขวาจะถูกบีบจนขึ้นบรรทัดใหม่แทบทุกแถว
    """
    return {
        "type": "box",
        "layout": "baseline",
        "spacing": "sm",
        "contents": [
            {"type": "text", "text": label, "size": "sm", "color": MUTED, "flex": 2},
            {
                "type": "text",
                "text": value or "-",
                "size": "sm",
                "color": value_color,
                "flex": 5,
                "wrap": True,
                "weight": "bold" if bold else "regular",
            },
        ],
    }


def _separator(margin: str = "md") -> dict:
    return {"type": "separator", "margin": margin, "color": LINE_COLOR}


def _header(title: str, color: str, subtitle: str | None = None) -> dict:
    """แถบหัวการ์ดสีทึบ — ตัวบอกประเภท/สถานะที่เห็นก่อนอ่านอะไรทั้งสิ้น"""
    contents: list[dict] = [
        {"type": "box", "layout": "horizontal", "spacing": "sm", "contents": [
            _text("IT SUPPORT", size="xxs", color="#94CEF7", weight="bold", flex=1),
            _text("●", size="xs", color=color, align="end", flex=0),
        ]},
        _text(title, color="#FFFFFF", weight="bold", size="lg", margin="sm"),
    ]
    if subtitle:
        contents.append(
            _text(subtitle, color="#C5D9EC", size="xs", margin="sm")
        )
    return {
        "type": "box",
        "layout": "vertical",
        "backgroundColor": BRAND_NAVY,
        "paddingAll": "20px",
        "contents": contents,
    }


def _button(label: str, data: str, *, style: str = "primary", color: str | None = None) -> dict:
    """ปุ่มในการ์ด — ใช้ postback เสมอ ไม่ใช่ message
    เพราะไม่อยากให้ข้อความที่เป็นคำสั่งภายใน (เช่น a=ticket&code=...) โผล่ในห้องแชท"""
    if data == "a=cancel" or data.startswith("a=bk_back"):
        style, color = "link", MUTED
    elif style == "secondary" and color is None:
        color = "#EAF0F7"
    btn: dict[str, Any] = {
        "type": "button",
        "style": style,
        "height": "md" if style == "primary" else "sm",
        "action": {"type": "postback", "label": label[:20], "data": data, "displayText": label},
    }
    if color:
        btn["color"] = color
    if data == "a=describe_request":
        btn["action"]["inputOption"] = "openKeyboard"
    return btn


def _bubble(*, header: dict | None, body: list[dict], footer: list[dict] | None = None,
            size: str = "mega") -> dict:
    bubble: dict[str, Any] = {
        "type": "bubble",
        "size": size,
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "paddingAll": "18px",
            "backgroundColor": "#FFFFFF",
            "contents": body,
        },
    }
    if header:
        bubble["header"] = header
    if footer:
        bubble["footer"] = {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "paddingAll": "16px",
            "backgroundColor": BG_SOFT,
            "contents": footer,
        }
    return bubble


# ---------------------------------------------------------------- การ์ดจริง


def description_prompt(text: str, button_label: str) -> dict:
    button = _button(button_label, "a=write_description", color=INFO_COLOR)
    button["action"]["inputOption"] = "openKeyboard"
    paragraphs = text.split("\n\n")
    body = [_text(paragraphs[0], weight="bold", size="md")]
    for paragraph in paragraphs[1:]:
        if paragraph.startswith("เช่น:"):
            body.append({
                "type": "box", "layout": "vertical", "spacing": "sm",
                "backgroundColor": BRAND_TINT, "cornerRadius": "12px", "paddingAll": "14px",
                "margin": "md", "contents": [
                    _text("ตัวอย่างการแจ้ง", size="xxs", color=BRAND_BLUE, weight="bold"),
                    _text(paragraph.removeprefix("เช่น:").strip(), size="sm", color=INK),
                ],
            })
        else:
            body.append(_text(paragraph, size="xs", color=MUTED, margin="md"))
    return _bubble(
        header=_header("เล่าเรื่องที่ให้เราช่วย", INFO_COLOR, "รายละเอียดชัดเจน ช่วยให้ทีม IT ดูแลได้เร็วขึ้น"),
        body=body,
        footer=[button, _button("ยกเลิก", "a=cancel", style="secondary")],
    )


def ticket_created(
    *,
    ticket_code: str,
    branch: str,
    ticket_type: str,
    requester_name: str,
    asset_label: str | None,
    items: list[dict],
    image_count: int = 0,
    company_name: str | None = None,
    description: str | None = None,
) -> dict:
    """การ์ดยืนยันว่ารับเรื่องแล้ว — จังหวะสำคัญที่สุดของบทสนทนาทั้งหมด

    ผู้ใช้ต้องได้ 2 อย่างจากการ์ดนี้ใน 1 วินาที: (1) เรื่องเข้าระบบแล้วจริง (2) เลขที่เอาไว้อ้างอิง
    เลข ticket จึงตัวใหญ่สุดในการ์ด และมีปุ่มเช็คสถานะติดไว้เลย จะได้ไม่ต้องจำเลขเอง
    """
    color = TYPE_COLOR.get(ticket_type, INFO_COLOR)

    body: list[dict] = [
        _text("เลขที่เรื่อง", size="xs", color=MUTED),
        _text(ticket_code, size="xxl", weight="bold", color=color),
        _separator("lg"),
        _row("ประเภท", TYPE_TEXT.get(ticket_type, ticket_type)),
    ]
    if company_name:
        body.append(_row("บริษัท", company_name))
    body += [
        _row("สาขา", branch),
        _row("ผู้แจ้ง" if ticket_type in ("repair", "it_service") else "ผู้รับ/คืน", requester_name),
    ]

    if asset_label:
        body.append(_row("ทรัพย์สิน", asset_label))

    if items:
        lines = "\n".join(f"• {i['name']} x{i['qty']}" for i in items)
        body.append(_row("รายการ", lines))

    if image_count > 0:
        body.append(_row("รูปแนบ", f"{image_count} รูป"))

    if description:
        body.append({
            "type": "box", "layout": "vertical", "spacing": "sm",
            "paddingAll": "14px", "backgroundColor": BRAND_TINT, "cornerRadius": "12px",
            "margin": "md", "contents": [
                _text("รายละเอียดที่แจ้ง", size="xs", color=BRAND_BLUE, weight="bold"),
                _text(description[:1000], size="sm"),
            ],
        })

    body.append(_separator("lg"))
    body.append(_text("ทีม IT จะติดต่อกลับโดยเร็วที่สุด และจะแจ้งกลับมาทางแชทนี้เมื่อดำเนินการเสร็จ",
                      size="xs", color=MUTED))

    return _bubble(
        header=_header("✅ รับเรื่องแล้ว", color),
        body=body,
        footer=[
            _button("เช็คสถานะเรื่องนี้", f"a=ticket&code={ticket_code}", color=color),
            _button("แจ้งเรื่องใหม่", "a=start", style="secondary"),
        ],
    )


def stock_list(items: list[dict]) -> dict:
    """การ์ดยอดคงเหลือ — จุดที่ Flex ชนะข้อความเปล่าชัดที่สุด

    ข้อความเปล่าต้องอ่านว่า "คีย์บอร์ด 4 ชิ้น (ขั้นต่ำ 5)" แล้วคิดในใจว่าขาดหรือไม่ขาด
    การ์ดนี้ทำให้เห็นทันทีจากสี โดยไม่ต้องเทียบตัวเลขเอง
    """
    rows: list[dict] = []
    for item in items[:10]:
        qty = item.get("quantity_available", 0)
        status = item.get("stock_status") or ""
        if status == "ต่ำกว่า":
            color, badge = DANGER_COLOR, "ต่ำกว่าขั้นต่ำ"
        elif status == "ถึงขั้นต่ำ":
            color, badge = WARN_COLOR, "ถึงขั้นต่ำ"
        else:
            color, badge = OK_COLOR, "ปกติ"

        rows.append(
            {
                "type": "box",
                "layout": "vertical",
                "margin": "md",
                "spacing": "xs",
                "contents": [
                    {
                        "type": "box",
                        "layout": "baseline",
                        "contents": [
                            {"type": "text", "text": item.get("name", "-"), "size": "sm",
                             "color": INK, "weight": "bold", "flex": 5, "wrap": True},
                            {"type": "text", "text": f"{qty} {item.get('unit') or 'ชิ้น'}",
                             "size": "sm", "color": color, "weight": "bold", "flex": 2, "align": "end"},
                        ],
                    },
                    {"type": "text", "text": badge, "size": "xxs", "color": color},
                ],
            }
        )

    return _bubble(
        header=_header("📦 ยอดคงเหลือในสต็อก", INFO_COLOR, "ข้อมูลสดจากระบบ ณ ตอนนี้"),
        body=rows or [_text("ไม่พบรายการที่ตรงกับที่ถามครับ")],
        footer=[_button("แจ้งเบิกอุปกรณ์", "a=start", color=INFO_COLOR)],
    )


def asset_detail(equipment: dict) -> dict:
    """การ์ดข้อมูลทรัพย์สิน 1 ชิ้น"""
    code = equipment.get("asset_code", "-")
    status = equipment.get("status") or "-"
    status_color = OK_COLOR if status == "ว่าง" else (WARN_COLOR if status == "ส่งซ่อม" else INK)

    return _bubble(
        header=_header(f"💻 {code}", INFO_COLOR, equipment.get("brand_model") or None),
        body=[
            _row("สถานะ", status, value_color=status_color, bold=True),
            _row("ผู้ถือครอง", equipment.get("holder_name") or "ยังไม่มีผู้ถือครอง"),
            _row("แผนก", equipment.get("holder_department") or "-"),
            _row("ที่ตั้ง", equipment.get("install_location") or "-"),
            _row("ประวัติซ่อม", f"{equipment.get('repair_count', 0)} ครั้ง"),
        ],
        footer=[_button("แจ้งซ่อมเครื่องนี้", "a=start", color=TYPE_COLOR["repair"])],
    )


def ticket_status(ticket: dict) -> dict:
    """การ์ดสถานะของ ticket 1 ใบ"""
    status = ticket.get("status", "pending")
    color = STATUS_COLOR.get(status, MUTED)

    body = [
        _text("เลขที่เรื่อง", size="xs", color=MUTED),
        _text(ticket.get("ticket_code", "-"), size="xl", weight="bold", color=INK),
        _separator("lg"),
        _row("สถานะ", STATUS_TEXT.get(status, status), value_color=color, bold=True),
        _row("ประเภท", TYPE_TEXT.get(ticket.get("type", ""), ticket.get("type", "-"))),
        _row("สาขา", ticket.get("location") or "-"),
        _row("แจ้งเมื่อ", ticket.get("created_at_th") or "-"),
    ]
    if ticket.get("description"):
        body.append(_separator("md"))
        body.append(_text(ticket["description"], size="xs", color=MUTED))

    return _bubble(header=_header(f"🎫 {STATUS_TEXT.get(status, status)}", color), body=body)


def my_tickets(tickets: list[dict]) -> dict:
    """เรื่องทั้งหมดที่ผู้ใช้คนนี้เคยแจ้ง — ทำเป็น carousel ให้ปัดดูทีละใบ

    ทำไมไม่รวมเป็นการ์ดเดียวที่มีรายการยาวๆ: ผู้ใช้ส่วนใหญ่สนใจแค่ใบล่าสุด
    การให้ใบล่าสุดเต็มการ์ดแรกแล้วปัดดูย้อนหลังได้ อ่านง่ายกว่ารายการที่ต้องเลื่อนหา
    """
    bubbles = [ticket_status(t) for t in tickets[:10]]
    if not bubbles:
        return _bubble(
            header=_header("🎫 เรื่องที่คุณแจ้งไว้", INFO_COLOR),
            body=[_text("ยังไม่พบเรื่องที่คุณแจ้งไว้ในระบบครับ")],
            footer=[_button("แจ้งเรื่องใหม่", "a=start", color=INFO_COLOR)],
        )
    return {"type": "carousel", "contents": bubbles}


def faq_answer(matches: list[dict]) -> dict:
    """คำตอบ FAQ — ใบแรกคือคำตอบหลัก ที่เหลือคือหัวข้อใกล้เคียงให้เลือกอ่านต่อ"""
    top = matches[0]
    body: list[dict] = [_text(top.get("content") or "-", size="sm")]

    others = matches[1:4]
    if others:
        body.append(_separator("lg"))
        body.append(_text("เรื่องใกล้เคียง", size="xs", color=MUTED))
        for m in others:
            body.append(_text(f"• {m.get('title', '')}", size="xs", color=MUTED))

    return _bubble(
        header=_header(f"💡 {top.get('title', 'วิธีแก้เบื้องต้น')}", OK_COLOR),
        body=body,
        footer=[_button("ยังไม่หาย แจ้งทีม IT", "a=start", color=TYPE_COLOR["repair"])],
    )


def welcome(display_name: str | None) -> dict:
    """ข้อความแรกที่ทุกคนเห็นตอนกดเพิ่มเพื่อน — ต้องตอบให้ได้ว่า 'ใช้ทำอะไรได้บ้าง' ทันที"""
    name = (display_name or "").strip()
    greeting = f"สวัสดีครับ {name} 👋" if name else "สวัสดีครับ 👋"

    def _feature(icon: str, title: str, desc: str) -> dict:
        return {
            "type": "box",
            "layout": "baseline",
            "spacing": "sm",
            "margin": "md",
            "contents": [
                {"type": "text", "text": icon, "size": "sm", "flex": 0},
                {"type": "text", "text": title, "size": "sm", "color": INK, "weight": "bold", "flex": 3},
                {"type": "text", "text": desc, "size": "xs", "color": MUTED, "flex": 5, "wrap": True},
            ],
        }

    return _bubble(
        header=_header(greeting, INFO_COLOR, "ระบบแจ้งปัญหา IT ของบริษัท"),
        body=[
            _text("แจ้งเรื่องได้เลยจากแชทนี้ ไม่ต้องเปิดเว็บ", size="sm", color=MUTED),
            _separator("lg"),
            _feature("🔧", "แจ้งซ่อม", "อุปกรณ์เสีย ใช้งานไม่ได้"),
            _feature("📦", "เบิกอุปกรณ์", "ขอของจากคลัง IT"),
            _feature("🔄", "คืนอุปกรณ์", "ส่งคืนของที่ยืมไป"),
            _feature("🛠", "บริการ IT", "ลงโปรแกรม ขอสิทธิ์"),
            _separator("lg"),
            _text("หรือพิมพ์ถามตรงๆ ได้เลย เช่น", size="xs", color=MUTED),
            _text("“คีย์บอร์ดเหลือกี่อัน”\n“NB2501001 ใครถืออยู่”\n“เรื่องที่ฉันแจ้งถึงไหนแล้ว”",
                  size="xs", color=INFO_COLOR),
        ],
        footer=[
            _button("แจ้งเรื่องใหม่", "a=start", color=INFO_COLOR),
            _button("คำถามที่พบบ่อย", "a=faq_menu", style="secondary"),
        ],
    )


def my_assets(assets: list[dict], holder_name: str | None = None) -> dict:
    """ทรัพย์สินที่ผู้ใช้ถือครองอยู่ — ทำเป็นรายการในการ์ดเดียว ไม่ใช่ carousel

    ต่างจาก my_tickets ตรงที่ผู้ใช้อยากเห็น "ทั้งหมดพร้อมกัน" (เอาไว้ตรวจนับ/เช็คก่อนคืน)
    ไม่ใช่ดูทีละใบ การยัดเป็น carousel จะต้องปัด 5 ครั้งกว่าจะเห็นครบ ซึ่งผิดวัตถุประสงค์
    """
    rows: list[dict] = []
    for item in assets[:12]:
        status = item.get("status") or "-"
        color = OK_COLOR if status == "ว่าง" else (WARN_COLOR if status == "ส่งซ่อม" else INK)
        rows.append(
            {
                "type": "box",
                "layout": "vertical",
                "margin": "md",
                "spacing": "xs",
                "contents": [
                    {
                        "type": "box",
                        "layout": "baseline",
                        "contents": [
                            {"type": "text", "text": item.get("asset_code", "-"), "size": "sm",
                             "color": INK, "weight": "bold", "flex": 4, "wrap": True},
                            {"type": "text", "text": status, "size": "xs", "color": color,
                             "flex": 3, "align": "end"},
                        ],
                    },
                    {"type": "text", "text": item.get("brand_model") or "ไม่ระบุรุ่น",
                     "size": "xs", "color": MUTED, "wrap": True},
                ],
            }
        )

    subtitle = f"ผู้ถือครอง: {holder_name}" if holder_name else None
    body = rows or [_text("ตอนนี้ยังไม่มีทรัพย์สินในความรับผิดชอบของคุณครับ")]
    if len(assets) > 12:
        body = body + [_separator("md"), _text(f"(แสดง 12 จาก {len(assets)} รายการ)", size="xs", color=MUTED)]

    return _bubble(
        header=_header(f"💻 ทรัพย์สินของฉัน ({len(assets)})", INFO_COLOR, subtitle),
        body=body,
        footer=[_button("แจ้งซ่อม/คืนอุปกรณ์", "a=start", color=TYPE_COLOR["repair"])],
    )


def estimate_size(flex: dict) -> int:
    """ขนาด JSON โดยประมาณเป็นไบต์ — ใช้กันไม่ให้เกินลิมิต 30 KB ของ LINE"""
    import json

    return len(json.dumps(flex, ensure_ascii=False).encode("utf-8"))

# ---------------------------------------------------------------- เมนูเลือกทีละชั้น


#: จำนวนตัวเลือกต่อหนึ่งหน้า
#  มาจากข้อจำกัดจริงของ Flex: การ์ดที่ยาวเกินจอมือถือทำให้ปุ่มท้ายๆ ถูกดันตกขอบ
#  และคนจะไม่เลื่อนลงไปกดเลย 8 แถวคือจำนวนที่ยังเห็นครบในจอเดียวพร้อมปุ่มท้ายการ์ด
PICK_PAGE_SIZE = 8


def _pick_row(label: str, sub: str | None, count: int, data: str, *, show_count: bool) -> dict:
    """หนึ่งแถวในเมนูเลือก — ทั้งแถวกดได้ ไม่ใช่แค่ตัวปุ่ม

    ใช้ box ที่มี action แทน button เพราะ label ของ button ใน LINE จำกัดที่ 20 ตัวอักษร
    ซึ่งสั้นเกินไปสำหรับภาษาไทย ("คอมพิวเตอร์ตั้งโต๊ะ" อย่างเดียวก็ 19 แล้ว ยังไม่รวมจำนวน)
    พอใช้ box + text ข้างในจึงยาวได้เต็มที่และยังตัดบรรทัดเองได้ด้วย
    """
    left: list[dict] = [
        {"type": "text", "text": label, "size": "sm", "weight": "bold", "color": INK, "wrap": True}
    ]
    if sub:
        left.append(
            {"type": "text", "text": sub, "size": "xxs", "color": MUTED, "wrap": True, "margin": "xs"}
        )

    contents: list[dict] = [{"type": "box", "layout": "vertical", "flex": 5, "contents": left}]
    if show_count:
        contents.append(
            {
                "type": "box", "layout": "vertical", "flex": 0,
                "backgroundColor": BRAND_TINT, "cornerRadius": "8px", "paddingAll": "6px",
                "contents": [_text(str(count), size="xs", color=BRAND_BLUE, weight="bold", align="center")],
            }
        )
    contents.append(_text("›", size="lg", color="#97ABC2", flex=0, gravity="center"))

    return {
        "type": "box",
        "layout": "horizontal",
        "paddingAll": "12px",
        "spacing": "sm",
        "alignItems": "center",
        "backgroundColor": "#FFFFFF",
        "borderColor": LINE_COLOR,
        "borderWidth": "1px",
        "cornerRadius": "12px",
        "action": {"type": "postback", "data": data, "displayText": label},
        "contents": contents,
    }


def picker(
    *,
    title: str,
    crumb: str | None,
    options: list[dict],
    page: int,
    data_for_index,
    footer_buttons: list[dict],
    show_count: bool = True,
) -> dict:
    """การ์ดเลือกตัวเลือกทีละชั้น พร้อมแบ่งหน้า

    options = [{"value","label","sub","count"}] ทั้งหมด (ยังไม่ตัดหน้า)
    data_for_index = ฟังก์ชันรับ index จริงในลิสต์ แล้วคืนสตริง postback data
    """
    total = len(options)
    start = page * PICK_PAGE_SIZE
    chunk = options[start : start + PICK_PAGE_SIZE]
    pages = max(1, (total + PICK_PAGE_SIZE - 1) // PICK_PAGE_SIZE)

    body: list[dict] = []
    if crumb:
        # เส้นทางที่เลือกมาแล้ว — ถ้าไม่มี ผู้ใช้จะลืมว่าตัวเองกรองอะไรไว้บ้าง
        body.append({
            "type": "box", "layout": "vertical", "paddingAll": "10px",
            "backgroundColor": BRAND_TINT, "cornerRadius": "8px",
            "contents": [_text(crumb, size="xs", color=BRAND_BLUE)],
        })

    for i, o in enumerate(chunk):
        body.append(
            _pick_row(
                o.get("label") or o.get("value") or "-",
                o.get("sub"),
                int(o.get("count") or 0),
                data_for_index(start + i),
                show_count=show_count,
            )
        )

    if not chunk:
        body.append(_text("ไม่มีตัวเลือกในเงื่อนไขนี้", size="sm", color=MUTED))

    if pages > 1:
        body.append(
            {
                "type": "text",
                "text": f"หน้า {page + 1} / {pages} · ทั้งหมด {total} รายการ",
                "size": "xxs",
                "color": MUTED,
                "align": "center",
                "margin": "md",
            }
        )

    has_free_text = any(b.get("action", {}).get("data") == "a=describe_request" for b in footer_buttons)
    return _bubble(
        header=_header(title, INFO_COLOR, "เลือกอุปกรณ์ หรือพิมพ์เรื่องที่ต้องการให้ช่วย" if has_free_text else "แตะรายการเพื่อไปต่อ"),
        body=body,
        footer=footer_buttons,
    )
