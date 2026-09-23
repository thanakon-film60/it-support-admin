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
from urllib.parse import quote

from . import flex as F

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
    "completed": "🎉 ดำเนินการเสร็จสิ้น",
    "closed": "📁 ปิดงานแล้ว",
    "cancelled": "❌ ยกเลิก",
}


@dataclass
class Reply:
    """ข้อความ 1 บับเบิลที่จะตอบกลับ

    quick = รายการปุ่ม [(label, postback_data), ...]
    หมายเหตุ: LINE จะแสดง quick reply ของ "ข้อความสุดท้าย" ในชุดที่ตอบกลับเท่านั้น
    ตัวแปลงใน line_api.py จะจัดการเรื่องนี้ให้ ไม่ต้องกังวลตอนเขียน flow

    flex = โครงสร้างการ์ด Flex Message (ถ้ามี จะส่งเป็นการ์ดแทนข้อความเปล่า)
           ส่วน `text` ยังต้องมีเสมอเพราะถูกใช้เป็น altText — คนที่เปิดจากหน้าจอแจ้งเตือน
           หรือ LINE รุ่นเก่าที่แสดง Flex ไม่ได้ จะเห็นข้อความนี้แทนที่จะเห็นว่างเปล่า
           การเก็บ text ไว้คู่กันยังทำให้เทสต์บทสนทนาทั้งหมดใช้ต่อได้โดยไม่ต้องแก้
    """

    text: str
    quick: list[tuple[str, str]] = field(default_factory=list)
    flex: dict | None = None


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
        flex=F.welcome(display_name),
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


def ask_branch(branches: list[str]) -> Reply:
    """ถามสาขา พร้อมปุ่มให้กดเลือก แทนการให้พิมพ์เอง

    ทำไมถึงสำคัญกว่าที่คิด: การให้พิมพ์ชื่อสาขาเองเป็นต้นเหตุของบั๊กที่เห็นชัดในบอทต้นแบบ —
    ผู้ใช้พิมพ์ "ต้องการแจ้งซ่อม" ตอนบอทรอชื่อสาขา แล้วได้คำตอบว่า "ไม่พบสาขาที่ตรงกัน"
    ซึ่งงงมาก เพราะผู้ใช้ไม่รู้ตัวว่าบอทรออะไรอยู่

    พอเปลี่ยนเป็นปุ่ม ปัญหาทั้งกลุ่มนี้หายไปเลย: ผู้ใช้เห็นทันทีว่าต้องเลือกสาขา
    เห็นว่ามีสาขาอะไรบ้าง และไม่มีทางสะกดผิด (ซึ่งทำให้รายงานแยกตามสาขาเพี้ยน)

    ยังพิมพ์เองได้อยู่ — บางคนพิมพ์เร็วกว่ากด และคนที่รู้ชื่อสาขาอยู่แล้วไม่ต้องหาในปุ่ม
    """
    if not branches:
        return ASK_BRANCH

    buttons = [
        (truncate_label(b), f"a=branch&v={quote(b, safe='')}")
        for b in branches[: MAX_QUICK_REPLY_ITEMS - 1]
    ]
    # เหลือช่องสุดท้ายไว้ให้ยกเลิกเสมอ ไม่ให้ผู้ใช้ติดอยู่ในขั้นตอนนี้
    buttons.append(("❌ ยกเลิก", "a=cancel"))

    more = ""
    if len(branches) > MAX_QUICK_REPLY_ITEMS - 1:
        more = f"\n(แสดง {MAX_QUICK_REPLY_ITEMS - 1} จาก {len(branches)} สาขา — สาขาอื่นพิมพ์ชื่อได้เลย)"

    return Reply(
        text=f"เลือกสาขาของคุณครับ 👇{more}\n\nหรือพิมพ์ชื่อสาขาเองก็ได้",
        quick=buttons,
    )


# ---------------------------------------------------------------- เมนูเลือกสาขา

#: ทางออกของเมนูสาขา — ต่างจากเมนูทรัพย์สินตรงที่สาขา "ข้ามไม่ได้"
#  ทุก ticket ต้องมีสาขา ไม่งั้นรายงานแยกสาขา/บริษัทใช้ไม่ได้เลย
#  จึงมีแค่ "ยกเลิก" ไม่มี "ไม่ทราบ"
_BRANCH_ESCAPES = [("❌ ยกเลิก", "a=cancel")]
_BRANCH_HINT = "เลือกจากการ์ด หรือพิมพ์ชื่อสาขาเองก็ได้ครับ"


def ask_branch_company(options: list[dict], page: int = 0) -> Reply:
    return _picker_reply(
        title="เลือกบริษัทของคุณครับ",
        crumb=None,
        options=options,
        page=page,
        action="a=bk_co",
        back=None,
        escapes=_BRANCH_ESCAPES,
        hint=_BRANCH_HINT,
    )


def ask_branch_group(options: list[dict], company_label: str, group_label: str,
                     page: int = 0) -> Reply:
    return _picker_reply(
        title=f"เลือก{group_label}",
        crumb=f"บริษัท: {company_label}",
        options=options,
        page=page,
        action="a=bk_grp",
        back=("◀ เปลี่ยนบริษัท", "a=bk_back&to=company"),
        escapes=_BRANCH_ESCAPES,
        hint=_BRANCH_HINT,
    )


def ask_branch_list(options: list[dict], crumb: str, page: int = 0, *, skip_group: bool = False) -> Reply:
    return _picker_reply(
        title="เลือกสาขาของคุณครับ",
        crumb=crumb,
        options=options,
        page=page,
        action="a=bk_branch",
        back=("◀ เปลี่ยนบริษัท", "a=bk_back&to=company") if skip_group else ("◀ เปลี่ยนกลุ่ม", "a=bk_back&to=group"),
        # ชั้นนี้ 1 แถว = 1 สาขา ตัวเลข "1" ต่อท้ายทุกแถวไม่ได้บอกอะไร
        show_count=False,
        escapes=_BRANCH_ESCAPES,
        hint=_BRANCH_HINT,
    )


def ask_which_company(company_labels: list[str], branch: str) -> Reply:
    """สาขาชื่อซ้ำข้ามบริษัท — ต้องถามว่าบริษัทไหน ห้ามเดา

    เกิดขึ้นจริงกับข้อมูลชุดนี้ เช่น "ศาลายา" "นครปฐม" "มหาชัย" มีทั้ง Montipa และ Motta
    ถ้าเดาให้ ticket จะไปอยู่บริษัทผิด และไม่มีใครรู้จนกว่าจะดูรายงานแยกบริษัท
    """
    return Reply(
        text=(
            f"สาขา \"{branch}\" มีทั้งใน {' และ '.join(company_labels)} ครับ\n\n"
            "เลือกบริษัทของคุณด้วยนะครับ"
        ),
        quick=[(lbl, f"a=bk_co_named&v={quote(lbl, safe='')}") for lbl in company_labels]
        + [("❌ ยกเลิก", "a=cancel")],
    )


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
    quick=[("📝 พิมพ์รายละเอียด", "a=describe_request"), ("ไม่มี/ไม่ทราบ", "a=skip_asset")],
)


# ---------------------------------------------------------------- เมนูเลือกทรัพย์สิน

#: ปุ่มท้ายการ์ดที่มีทุกชั้น — ต้องมีทางออกเสมอ
#  ถ้าเมนูไล่ชั้นไม่เจอของที่ต้องการ ผู้ใช้ต้องพิมพ์รหัสเองหรือข้ามได้ทันที
#  ไม่งั้นจะติดอยู่ในเมนูแล้วเลิกแจ้งไปเลย ซึ่งแย่กว่าตอนที่ยังไม่มีเมนูอีก
def _picker_escape_buttons() -> list[dict]:
    return [
        F._button("⌨️ พิมพ์รหัสเอง", "a=asset_manual", style="secondary"),
        F._button("ไม่มี / ไม่ทราบ", "a=skip_asset", style="secondary"),
    ]


def _picker_reply(
    *,
    title: str,
    crumb: str | None,
    options: list[dict],
    page: int,
    action: str,
    back: tuple[str, str] | None,
    show_count: bool = True,
    escapes: list[tuple[str, str]] | None = None,
    hint: str = "เลือกจากการ์ด หรือพิมพ์รหัสทรัพย์สินมาได้เลยครับ",
) -> Reply:
    """ประกอบการ์ดเลือก 1 ชั้น

    ปุ่มส่งกลับมาแค่ "ลำดับที่" (i=) ไม่ใช่ค่าจริง เพราะ postback data ของ LINE จำกัด 300 ไบต์
    ชื่อยี่ห้อ/รุ่นภาษาไทย encode แล้วกินตัวละ 9 ไบต์ ยาวหน่อยก็ทะลุ — ค่าจริงเก็บไว้ใน session
    """
    total = len(options)
    pages = max(1, (total + F.PICK_PAGE_SIZE - 1) // F.PICK_PAGE_SIZE)

    footer: list[dict] = []
    if pages > 1:
        nxt = (page + 1) % pages
        footer.append(F._button(f"▼ ดูเพิ่ม (หน้า {nxt + 1}/{pages})", f"a=pk_page&p={nxt}"))
    if back:
        footer.append(F._button(back[0], back[1], style="secondary"))
    esc = escapes if escapes is not None else [
        ("📝 พิมพ์รายละเอียด", "a=describe_request"),
        ("⌨️ พิมพ์รหัสเอง", "a=asset_manual"),
        ("ไม่มี / ไม่ทราบ", "a=skip_asset"),
    ]
    primary = [F._button(label, data, color=F.BRAND_BLUE) for label, data in esc if data == "a=describe_request"]
    footer = primary + footer + [F._button(label, data, style="secondary") for label, data in esc if data != "a=describe_request"]

    flex = F.picker(
        title=title,
        crumb=crumb,
        options=options,
        page=page,
        data_for_index=lambda i: f"{action}&i={i}",
        footer_buttons=footer,
        show_count=show_count,
    )

    # ข้อความสำรอง — คนที่เปิดจากนาฬิกา/แจ้งเตือน หรือ LINE เวอร์ชันเก่าจะเห็นอันนี้แทนการ์ด
    start = page * F.PICK_PAGE_SIZE
    listed = "\n".join(
        f"• {o.get('label') or o.get('value')}" for o in options[start : start + F.PICK_PAGE_SIZE]
    )
    lines = [title]
    if crumb:
        lines.append(crumb)
    lines.append("")
    lines.append(listed or "(ไม่มีตัวเลือก)")
    lines.append("")
    lines.append(hint)

    # ทางออกซ้ำไว้เป็น quick reply ด้วย ไม่ใช่มีแค่ในการ์ด
    # quick reply ปักอยู่เหนือแป้นพิมพ์เสมอ กดได้ทันทีไม่ว่าจะเลื่อนการ์ดไปถึงไหน
    # ส่วนปุ่มท้ายการ์ดต้องเลื่อนลงไปหา ซึ่งบนจอมือถือเล็กๆ คนมักไม่เลื่อน
    quick = [(label.replace(" / ", "/"), data) for label, data in esc]
    return Reply(text="\n".join(lines), quick=quick, flex=flex)


def ask_asset_category(options: list[dict], page: int = 0) -> Reply:
    return _picker_reply(
        title="เลือกประเภททรัพย์สิน",
        crumb=None,
        options=options,
        page=page,
        action="a=pk_cat",
        back=None,
    )


def ask_asset_brand(options: list[dict], category_label: str, page: int = 0) -> Reply:
    return _picker_reply(
        title="เลือกยี่ห้อ / รุ่น",
        crumb=f"ประเภท: {category_label}",
        options=options,
        page=page,
        action="a=pk_brand",
        back=("◀ เปลี่ยนประเภท", "a=pk_back&to=category"),
    )


def ask_asset_code(options: list[dict], crumb: str, page: int = 0) -> Reply:
    return _picker_reply(
        title="เลือกรหัสทรัพย์สิน",
        crumb=crumb,
        options=options,
        page=page,
        action="a=pk_code",
        back=("◀ เปลี่ยนยี่ห้อ/รุ่น", "a=pk_back&to=brand"),
        # ชั้นนี้ 1 แถว = 1 เครื่อง ตัวเลข "1" ต่อท้ายทุกแถวไม่ได้บอกอะไรเลย
        show_count=False,
    )


def asset_picker_unavailable() -> Reply:
    """หลังบ้านล่มตอนดึงตัวเลือก — ถอยไปใช้วิธีพิมพ์เอง ดีกว่าบอกว่าใช้ไม่ได้แล้วจบ"""
    return Reply(
        text=(
            "ตอนนี้ดึงรายการทรัพย์สินมาให้เลือกไม่ได้ครับ\n\n"
            "พิมพ์รหัสทรัพย์สินมาได้เลย (เช่น NB-001) หรือกดข้ามไปก่อนก็ได้ครับ"
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


def asset_label(equipment: dict) -> str:
    """ข้อความอธิบายเครื่อง 1 เครื่องแบบสั้น ใช้ทั้งตอนยืนยันและตอนให้เลือก"""
    code = equipment.get("asset_code") or "-"
    model = (equipment.get("brand_model") or "").strip()
    return f"{code} — {model}" if model else code


def ask_which_asset(matches: list[dict]) -> Reply:
    """รหัสเดียวตรงกับหลายเครื่อง — ให้ผู้ใช้เลือกว่าหมายถึงเครื่องไหน

    ทำไมต้องถาม ไม่เดาให้: ข้อมูลจริงมีรหัสซ้ำอยู่ 28 แถว เช่น PC2306001 ถูกใช้กับ 4 เครื่อง
    ที่ถลางภูเก็ต / อยุธยา / บางกะปิ / สำนักงานใหญ่ ถ้าเดาเอาเครื่องแรก ช่างจะได้ ticket
    ที่ชี้ไปผิดสาขา และไม่มีใครรู้ตัวจนกว่าจะไปถึงหน้างาน

    แสดงสถานที่ + ผู้ถือครองกำกับทุกตัวเลือก เพราะรหัสอย่างเดียวแยกไม่ออก
    """
    lines = [
        f"รหัสนี้ตรงกับ {len(matches)} เครื่องในระบบครับ",
        "เลือกเครื่องที่ต้องการแจ้ง:",
        "",
    ]
    buttons: list[tuple[str, str]] = []
    for index, equipment in enumerate(matches[: MAX_QUICK_REPLY_ITEMS - 1], start=1):
        where = (equipment.get("install_location") or "ไม่ระบุสถานที่").strip()
        holder = (equipment.get("holder_name") or "").strip()
        detail = f"{where} · {holder}" if holder else where
        lines.append(f"{index}. {asset_label(equipment)}")
        lines.append(f"   📍 {detail}")
        # label ของปุ่มยาวได้ 20 ตัวอักษร — ใส่เลขลำดับนำหน้าให้จับคู่กับรายการด้านบนได้
        buttons.append((truncate_label(f"{index}. {where}"), f"a=pick_asset&v={equipment['id']}"))

    if len(matches) > MAX_QUICK_REPLY_ITEMS - 1:
        lines.append("")
        lines.append(f"(แสดง {MAX_QUICK_REPLY_ITEMS - 1} จาก {len(matches)} เครื่อง)")

    buttons.append(("ข้ามไปก่อน", "a=skip_asset"))
    return Reply(text="\n".join(lines), quick=buttons)


# ---------------------------------------------------------------- รูปที่ผู้ใช้ส่งมา


def image_saved(count: int) -> Reply:
    return Reply(text=f"ได้รับรูปแล้วครับ 📸 ({count} รูป) จะแนบไปกับเรื่องที่แจ้งให้เลย")


def image_saved_and_start() -> Reply:
    """ผู้ใช้ส่งรูปมาทั้งที่ยังไม่ได้เริ่มแจ้งเรื่อง

    เก็บรูปไว้แล้วเปิด flow ให้เลย แทนที่จะบอกว่า "กรุณาเริ่มแจ้งเรื่องก่อน"
    เพราะการส่งรูปหน้าจอที่ error มาคือ "การแจ้งปัญหา" ในความรู้สึกของคนส่งอยู่แล้ว
    ถ้าให้เขาเริ่มใหม่แล้วส่งรูปซ้ำ ส่วนใหญ่จะเลิกกลางคัน
    """
    return Reply(
        text=(
            "ได้รับรูปแล้วครับ 📸\n"
            "จะแนบไปกับเรื่องที่แจ้งให้เลย — ขอข้อมูลอีกนิดนะครับ\n"
            "\n"
            "อยู่สาขาไหนครับ? (พิมพ์ชื่อสาขา)"
        ),
        quick=[("❌ ยกเลิก", "a=cancel")],
    )


def image_too_many(limit: int) -> Reply:
    return Reply(text=f"แนบรูปได้สูงสุด {limit} รูปต่อ 1 เรื่องครับ 🙏 รูปที่ส่งเพิ่มจะไม่ถูกบันทึก")


def image_too_large(limit_mb: int) -> Reply:
    return Reply(
        text=(
            f"รูปนี้ใหญ่เกิน {limit_mb} MB ครับ 🙏\n"
            "ลองส่งใหม่โดยเลือกความละเอียดต่ำลง หรือส่งเป็นภาพหน้าจอแทนได้ครับ"
        )
    )


def image_failed() -> Reply:
    return Reply(
        text=(
            "ขออภัยครับ บันทึกรูปไม่สำเร็จ 🙏\n"
            "แจ้งเรื่องต่อได้เลย แล้วพิมพ์อธิบายอาการแทนรูปได้ครับ"
        )
    )


def unsupported_message() -> Reply:
    """สติกเกอร์ / วิดีโอ / ไฟล์ / เสียง — บอกตรงๆ ว่ารับไม่ได้ ดีกว่าเงียบ

    ของเดิมบอทตัดทุก event ที่ไม่ใช่ข้อความทิ้งเงียบๆ ผู้ใช้จึงไม่รู้ว่าบอทไม่เห็น
    หรือบอทล่ม — ซึ่งทำให้เลิกใช้เร็วกว่าการบอกว่าทำไม่ได้เสียอีก
    """
    return Reply(
        text=(
            "ตอนนี้บอทอ่านได้เฉพาะข้อความกับรูปภาพครับ 🙏\n"
            "ถ้าเป็นปัญหาการใช้งาน พิมพ์อธิบายมาได้เลย หรือส่งรูปหน้าจอมาก็ได้ครับ"
        ),
        quick=MENU_BUTTONS,
    )


# ---------------------------------------------------------------- เมนู "เช็คข้อมูล"


def my_assets_answer(data: dict) -> Reply:
    """ทรัพย์สินที่ผู้ใช้ถือครองอยู่ — มาจากปุ่ม "ทรัพย์สินของฉัน" ในเมนูข้อมูล

    ต้องแยก 2 กรณีที่หน้าตาเหมือนกันแต่ความหมายต่างกันมาก:
      ยังไม่เคยผูกบัญชี -> ระบบยังไม่รู้ว่าคุณเป็นใคร ต้องแจ้งเรื่องสักครั้งก่อน
      ผูกแล้วแต่ไม่มีของ -> คำตอบที่ถูกต้องคือ "ไม่มี" จริงๆ
    ถ้าตอบเหมือนกันทั้งคู่ คนกลุ่มแรกจะเข้าใจผิดว่าตัวเองไม่มีของในความรับผิดชอบ
    """
    if not data.get("linked"):
        return Reply(
            text=(
                "ระบบยังไม่รู้ว่าคุณเป็นใครครับ 🙏\n\n"
                "ต้องแจ้งเรื่องผ่านบอทสักครั้งก่อน ระบบถึงจะผูกบัญชี LINE ของคุณ\n"
                "กับชื่อพนักงานในระบบได้ แล้วหลังจากนั้นจะเช็คทรัพย์สินของตัวเองได้เลย"
            ),
            quick=MENU_BUTTONS,
        )

    assets = data.get("assets") or []
    holder = data.get("holder_name")

    if not assets:
        return Reply(
            text=f"ตอนนี้ไม่มีทรัพย์สินในความรับผิดชอบของ{holder or 'คุณ'}ครับ",
            quick=MENU_BUTTONS,
            flex=F.my_assets([], holder),
        )

    lines = [f"💻 ทรัพย์สินของคุณ ({len(assets)} รายการ)", ""]
    for a in assets[:12]:
        lines.append(f"• {a.get('asset_code')} — {a.get('brand_model') or 'ไม่ระบุรุ่น'}  [{a.get('status') or '-'}]")
    if len(assets) > 12:
        lines.append(f"(แสดง 12 จาก {len(assets)} รายการ)")

    return Reply(text="\n".join(lines), quick=MENU_BUTTONS, flex=F.my_assets(assets, holder))


ASK_FIND_ASSET = Reply(
    text=(
        "พิมพ์รหัสทรัพย์สินที่ต้องการค้นหาครับ\n\n"
        "เช่น: NB2501001, PC2306001\n"
        "(พิมพ์ 'ยกเลิก' เพื่อออก)"
    ),
    quick=[("❌ ยกเลิก", "a=cancel")],
)


def find_asset_not_found(code: str) -> Reply:
    return Reply(
        text=f"ไม่พบรหัส '{code}' ในระบบครับ\n\nลองพิมพ์ใหม่ หรือกดยกเลิกเพื่อออก",
        quick=[("❌ ยกเลิก", "a=cancel")],
    )


def rate_limited() -> Reply:
    return Reply(text="ข้อความเข้ามาถี่เกินไปครับ 🙏 รอสักครู่แล้วลองใหม่อีกครั้งนะครับ")


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


def _description_prompt(text: str, button_label: str) -> Reply:
    return Reply(
        text=text,
        quick=[("❌ ยกเลิก", "a=cancel")],
        flex=F.description_prompt(text, button_label),
    )

ASK_DESCRIPTION = _description_prompt(
    "มีรายละเอียดเพิ่มเติมไหมครับ? กดปุ่มด้านล่างแล้วพิมพ์ได้เลย หรือพิมพ์ '-' ถ้าไม่มี\n\n(พิมพ์ 'ยกเลิก' เพื่อออก)",
    "พิมพ์รายละเอียด",
)

ASK_DESCRIPTION_REPAIR = _description_prompt(
    "ช่วยอธิบายอาการเสียหรือปัญหาที่ต้องการให้ทีม IT ช่วยครับ\n\n"
    "เช่น: คอมเปิดไม่ติดตั้งแต่เช้า กดปุ่มแล้วไม่มีไฟเข้า\n"
    "ไม่จำเป็นต้องทราบสาเหตุทางเทคนิค บอกอาการที่พบได้เลย และแนบรูปเพิ่มเติมได้ครับ\n\n"
    "กดปุ่ม 'พิมพ์อาการ/สาเหตุ' แล้วพิมพ์ในช่องแชท จากนั้นกดส่ง (จำเป็นต้องระบุ)",
    "พิมพ์อาการ/สาเหตุ",
)

ASK_DESCRIPTION_SERVICE = _description_prompt(
    "ต้องการให้ทีม IT ช่วยเรื่องอะไรครับ?\n\n"
    "พิมพ์สาเหตุหรือสิ่งที่ต้องการให้ช่วยได้เลย ไม่จำเป็นต้องเกี่ยวกับทรัพย์สินครับ\n\n"
    "เช่น: ขอให้ติดตั้งโปรแกรมบัญชี หรือขอสิทธิ์เข้าโฟลเดอร์แผนก\n\n"
    "กดปุ่ม 'พิมพ์สิ่งที่ให้ช่วย' แล้วระบุสิ่งที่ต้องการพร้อมรายละเอียดในช่องแชท จากนั้นกดส่ง (จำเป็นต้องระบุ)",
    "พิมพ์สิ่งที่ให้ช่วย",
)


def ask_description(ticket_type: str | None) -> Reply:
    return {"repair": ASK_DESCRIPTION_REPAIR, "it_service": ASK_DESCRIPTION_SERVICE}.get(ticket_type, ASK_DESCRIPTION)


def ticket_created(
    *,
    ticket_code: str,
    branch: str,
    ticket_type: str,
    requester_name: str,
    asset_label: str | None,
    items: list[dict],
    image_count: int = 0,
    description: str | None = None,
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
    if image_count > 0:
        # ยืนยันให้เห็นว่ารูปถูกแนบไปจริง — ไม่งั้นคนส่งรูปมาแล้วไม่แน่ใจว่าช่างจะได้เห็นไหม
        lines.append(f"📸 รูปแนบ: {image_count} รูป")
    if description:
        lines.append(f"📝 อาการ / รายละเอียด: {description[:1000]}")
    lines += ["", "ทีม IT จะติดต่อกลับโดยเร็วที่สุดครับ 🙏"]
    return Reply(
        text="\n".join(lines),
        quick=MENU_BUTTONS,
        flex=F.ticket_created(
            ticket_code=ticket_code,
            branch=branch,
            ticket_type=ticket_type,
            requester_name=requester_name,
            asset_label=asset_label,
            items=items,
            image_count=image_count,
            description=description,
        ),
    )


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
    return Reply(text=body, quick=MENU_BUTTONS, flex=F.faq_answer(matches) if matches else None)


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
    return Reply(text="\n".join(lines), quick=MENU_BUTTONS, flex=F.stock_list(items))


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
    return Reply(text="\n".join(lines), quick=MENU_BUTTONS, flex=F.asset_detail(equipment))


def asset_answer_multi(matches: list[dict]) -> Reply:
    """ตอบเมื่อรหัสที่ถามตรงกับหลายเครื่อง

    ต้องบอกให้ครบทุกเครื่อง ไม่ใช่ตอบเครื่องแรกแล้วจบ เพราะคนถามว่า "PC2306001 ใครถืออยู่"
    แล้วได้คำตอบเดียวจะเชื่อว่านั่นคือคำตอบที่ถูก ทั้งที่จริงมีอีก 3 เครื่องที่ใช้รหัสเดียวกัน
    การตอบไม่ครบในกรณีนี้แย่กว่าการตอบว่า "มีหลายเครื่องนะ"
    """
    lines = [f"💻 รหัส {matches[0].get('asset_code') or '-'} มี {len(matches)} เครื่องในระบบครับ", ""]
    for index, equipment in enumerate(matches[:5], start=1):
        lines.append(f"{index}. {equipment.get('brand_model') or 'ไม่ระบุรุ่น'}")
        lines.append(
            f"   📍 {equipment.get('install_location') or '-'}"
            f" · 👤 {equipment.get('holder_name') or 'ยังไม่มีผู้ถือครอง'}"
            f" · {equipment.get('status') or '-'}"
        )
    if len(matches) > 5:
        lines.append("")
        lines.append(f"(แสดง 5 จาก {len(matches)} เครื่อง)")
    lines.append("")
    lines.append("⚠️ รหัสนี้ถูกใช้ซ้ำหลายเครื่อง แจ้งทีม IT ให้แก้รหัสให้ไม่ซ้ำจะค้นหาง่ายขึ้นครับ")
    return Reply(text="\n".join(lines), quick=MENU_BUTTONS)


def ticket_answer(ticket: dict, *, views: dict | None = None) -> Reply:
    """ตอบสถานะของ ticket ที่ถามมา

    views = ผลจากการบันทึก log การเปิดดู (ถ้ามี) ใช้ยืนยันกับผู้ใช้ว่า
    "ทีม IT รู้แล้วว่าคุณกำลังติดตามเรื่องนี้อยู่" ซึ่งเป็นสิ่งที่คนกดปุ่มนี้อยากได้จริงๆ —
    ไม่ใช่แค่ตัวหนังสือบอกสถานะ แต่คือความมั่นใจว่ามีคนเห็นว่าตัวเองรออยู่
    """
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

    if views:
        lines.append("")
        # แจ้งทีม IT จริงเฉพาะครั้งแรก แต่ "บันทึกแล้ว" ทุกครั้ง จึงต้องเขียนให้ตรงกับที่เกิดขึ้นจริง
        # ไม่งั้นกลายเป็นหลอกผู้ใช้ว่ามีคนได้รับแจ้งทุกครั้งที่กด
        if views.get("notify") == "sent":
            lines.append("🔔 แจ้งทีม IT แล้วว่าคุณกำลังติดตามเรื่องนี้อยู่")
        else:
            lines.append("✔️ บันทึกแล้วว่าคุณเปิดดูเรื่องนี้ ทีม IT เห็นในระบบ")
        total = views.get("total_views")
        if isinstance(total, int) and total > 1:
            lines.append(f"(เปิดดูเรื่องนี้แล้ว {total} ครั้ง)")

    return Reply(text="\n".join(lines), quick=MENU_BUTTONS, flex=F.ticket_status(ticket))


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
    return Reply(text="\n".join(lines), quick=MENU_BUTTONS, flex=F.my_tickets(tickets))


# ---------------------------------------------------------------- ยืนยันผลการแก้ไข


def confirm_done_thanks(code: str) -> Reply:
    """ผู้แจ้งกด "ตกลง" แล้ว — ต้องตอบให้ชัดว่าเรื่องปิดแล้วจริง

    ถ้าตอบแค่ "ขอบคุณครับ" ผู้ใช้จะไม่รู้ว่ากดติดหรือเปล่า แล้วจะกดซ้ำอีกหลายครั้ง
    """
    return Reply(
        text=(
            f"ขอบคุณที่ยืนยันครับ 🙏\n\n"
            f"เรื่อง {code} ปิดเรียบร้อยแล้ว\n"
            "สถานะ: ดำเนินการเสร็จสิ้น ✅\n\n"
            "ถ้ามีปัญหาอีก แจ้งเข้ามาใหม่ได้ตลอดครับ"
        ),
        quick=MENU_BUTTONS,
    )


def still_broken_ack(code: str) -> Reply:
    return Reply(
        text=(
            f"รับทราบครับ เรื่อง {code} ถูกส่งกลับให้ทีม IT ตรวจสอบอีกครั้งแล้ว\n\n"
            "ถ้าสะดวก พิมพ์บอกอาการที่ยังเป็นอยู่เพิ่มได้เลยครับ จะได้แก้ตรงจุด"
        ),
        quick=MENU_BUTTONS,
    )


def confirm_not_owner() -> Reply:
    """คนกดไม่ใช่ผู้แจ้งของเรื่องนั้น — เกิดได้จริงถ้าเลขที่ตั๋วถูกส่งต่อในแชทกลุ่ม"""
    return Reply(
        text=(
            "ยืนยันให้ไม่ได้ครับ เพราะเรื่องนี้ไม่ได้แจ้งจากบัญชีนี้\n\n"
            "ให้ผู้ที่แจ้งเรื่องเป็นคนกดยืนยันนะครับ"
        ),
        quick=MENU_BUTTONS,
    )


def confirm_not_resolved(code: str, status_label: str) -> Reply:
    """กดจากข้อความเก่าหลังสถานะเปลี่ยนไปแล้ว — บอกสถานะปัจจุบันดีกว่าทำเงียบๆ"""
    return Reply(
        text=(
            f"เรื่อง {code} ไม่ได้อยู่ในขั้นรอยืนยันแล้วครับ\n\n"
            f"สถานะตอนนี้: {status_label}"
        ),
        quick=MENU_BUTTONS,
    )


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
