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

import time
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
    # True = อย่าสั่ง "อ่านแล้ว" ให้ข้อความของผู้ใช้ที่ทำให้เกิดคำตอบนี้ (ดู main._mark_read)
    # แชทที่ยังไม่อ่านในแอป LINE Official Account คือสัญญาณให้เจ้าหน้าที่เข้ามาดู —
    # ใช้กับกรณีที่บอทช่วยไม่ได้ เช่น ขอคุยกับคน หรือบอทตีความข้อความไม่ออก
    keep_unread: bool = False


def truncate_label(label: str) -> str:
    if len(label) <= MAX_QUICK_REPLY_LABEL:
        return label
    return label[: MAX_QUICK_REPLY_LABEL - 1] + "…"


_TH_MONTHS = ("ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.")


def thai_time(epoch: float | None, now: float | None = None) -> str:
    """เวลาไทยแบบสั้น: วันนี้ -> "14:05" · วันอื่น -> "12 ต.ค. 14:05"

    คิดเวลาไทย (UTC+7) เองจาก epoch ไม่พึ่ง timezone ของเครื่อง — container ส่วนใหญ่ตั้งเป็น UTC
    ถ้าใช้ localtime ตรงๆ เวลาบนการ์ดจะช้าไป 7 ชั่วโมงโดยไม่มีใครสังเกต
    """
    if not epoch:
        return "-"
    t = time.gmtime(epoch + 7 * 3600)
    n = time.gmtime((time.time() if now is None else now) + 7 * 3600)
    hm = f"{t.tm_hour:02d}:{t.tm_min:02d}"
    if (t.tm_year, t.tm_yday) == (n.tm_year, n.tm_yday):
        return hm
    return f"{t.tm_mday} {_TH_MONTHS[t.tm_mon - 1]} {hm}"


# ---------------------------------------------------------------- เมนู / ทั่วไป

# ส่งต่อให้คนของทีม IT ตอบเองในแชท (ทีมตอบผ่านแอป LINE Official Account)
HUMAN_BUTTON = ("👤 คุยกับเจ้าหน้าที่", "a=human")
RESUME_BUTTON = ("🤖 กลับไปใช้บอท", "a=bot_resume")

MENU_BUTTONS: list[tuple[str, str]] = [
    ("📝 แจ้งเรื่องใหม่", "a=start"),
    ("❓ คำถามที่พบบ่อย", "a=faq_menu"),
    HUMAN_BUTTON,
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
            "👤 เรื่องอื่นที่บอทช่วยไม่ได้ กด 'คุยกับเจ้าหน้าที่' ทีม IT จะตอบในแชทนี้\n"
            "\n"
            "กดปุ่มด้านล่าง หรือพิมพ์บอกปัญหามาได้เลยครับ"
        ),
        quick=MENU_BUTTONS,
        flex=F.welcome(display_name),
    )


def menu() -> Reply:
    return Reply(text="เลือกสิ่งที่ต้องการได้เลยครับ:", quick=MENU_BUTTONS)


# ---------------------------------------------------------------- ส่งต่อให้เจ้าหน้าที่
#
# ระหว่างนี้บอท "เงียบ" กับคนนั้น ข้อความทุกอันจึงต้องบอกทางกลับมาใช้บอทไว้เสมอ
# ไม่งั้นคนที่กดเล่นๆ หรือเปลี่ยนใจจะนึกว่าบอทเสีย เพราะพิมพ์อะไรไปก็ไม่ตอบ


def handoff_started() -> Reply:
    return Reply(
        text=(
            "ส่งต่อให้ทีม IT แล้วครับ 🙋\n"
            "พิมพ์คำถามหรือรายละเอียดทิ้งไว้ในแชทนี้ได้เลย (ส่งรูปหน้าจอได้) "
            "เจ้าหน้าที่จะตอบกลับในแชทนี้\n"
            "\n"
            "ระหว่างนี้บอทจะไม่ตอบอัตโนมัติ\n"
            "อยากแจ้งเรื่องผ่านบอทอีกครั้ง กด '🤖 กลับไปใช้บอท' หรือกดเมนูด้านล่างได้เลยครับ"
        ),
        quick=[RESUME_BUTTON],
        keep_unread=True,
    )


def handoff_waiting() -> Reply:
    return Reply(
        text="แจ้งทีม IT ไว้แล้วครับ 🙏 เจ้าหน้าที่จะตอบในแชทนี้ — พิมพ์รายละเอียดเพิ่มทิ้งไว้ได้เลย",
        quick=[RESUME_BUTTON],
        keep_unread=True,
    )


def handoff_ended() -> Reply:
    return Reply(text="กลับมาใช้บอทแล้วครับ 🤖\nเลือกสิ่งที่ต้องการได้เลย:", quick=MENU_BUTTONS)


def handoff_unavailable() -> Reply:
    """Chat ใน OA Manager ปิดอยู่ — เจ้าหน้าที่มองไม่เห็นแชท จึงส่งต่อไม่ได้

    บอกตรงๆ ดีกว่ารับปากว่า "ส่งต่อแล้ว" ทั้งที่ไม่มีใครเห็นข้อความเลย
    """
    return Reply(
        text=(
            "ตอนนี้ยังไม่เปิดให้คุยกับเจ้าหน้าที่ทางแชทนี้ครับ 🙏\n"
            "แจ้งเรื่องผ่านบอทได้เลย ทีม IT จะเห็นเรื่องในระบบทันที"
        ),
        quick=[b for b in MENU_BUTTONS if b != HUMAN_BUTTON],
    )


# ---------------------------------------------------------------- ทีม IT สั่งเปิด/ปิดบอท
#
# ทีม IT พิมพ์ "แอดมิน" หาบอทจาก LINE ของตัวเอง (บัญชีที่อนุมัติในหน้าเว็บ "บอท LINE" แล้ว)
# ได้การ์ดที่ปิด/เปิดบอททั้งระบบ หรือรายคนจากรายชื่อ LINE ของคนที่ทักมาล่าสุด

ADMIN_BUTTON = ("🛠 การ์ดควบคุมบอท", "a=adm")


def bot_off_notice() -> Reply:
    """แจ้งผู้ใช้ตอนทีม IT ปิดบอทอยู่ (ทั้งระบบหรือเฉพาะคนนี้) — ส่งครั้งเดียวต่อวัน แล้วบอทเงียบ

    ไม่มีปุ่มให้กด เพราะระหว่างนี้บอทไม่ตอบอะไรเลย ปุ่มที่กดแล้วเงียบแย่กว่าไม่มีปุ่ม
    ค้าง "ยังไม่อ่าน" ไว้ให้เจ้าหน้าที่เห็นในแอป LINE OA ว่ามีคนรออยู่
    """
    return Reply(
        text=(
            "ตอนนี้เจ้าหน้าที่ IT ตอบแชทนี้เองครับ 🙋\n"
            "พิมพ์เรื่องที่ต้องการทิ้งไว้ได้เลย (ส่งรูปหน้าจอได้) เจ้าหน้าที่จะตอบกลับในแชทนี้\n\n"
            "ระหว่างนี้บอทจะไม่ตอบอัตโนมัติ"
        ),
        keep_unread=True,
    )


def staff_request(status: str) -> Reply:
    """ตอบคำว่า "ขอสิทธิ์แอดมิน" ตามสถานะที่หลังบ้านบอกมา (approved / pending)"""
    if status == "approved":
        return Reply(
            text="บัญชีนี้มีสิทธิ์ควบคุมบอทอยู่แล้วครับ ✅\nพิมพ์ 'แอดมิน' เมื่อไหร่ก็ได้เพื่อเปิดการ์ดควบคุมบอท",
            quick=[ADMIN_BUTTON],
        )
    return Reply(
        text=(
            "ส่งคำขอสิทธิ์ควบคุมบอทแล้วครับ 🙏\n"
            "รอแอดมินอนุมัติในหน้าเว็บ เมนู 'บอท LINE'\n"
            "อนุมัติแล้วพิมพ์ 'แอดมิน' ในแชทนี้เพื่อเปิดการ์ดควบคุมบอท"
        )
    )


def admin_denied() -> Reply:
    return Reply(
        text=(
            "บัญชีนี้ยังไม่มีสิทธิ์ควบคุมบอทครับ\n"
            "พิมพ์ 'ขอสิทธิ์แอดมิน' แล้วให้แอดมินอนุมัติในหน้าเว็บ (เมนู 'บอท LINE') ก่อน"
        ),
        quick=MENU_BUTTONS,
    )


def admin_chat_off() -> Reply:
    return Reply(
        text=(
            "ปิดบอทตอนนี้ไม่ได้ครับ ⚠️\n"
            "Chat ใน LINE Official Account ปิดอยู่ — ถ้าบอทเงียบด้วย จะไม่มีใครเห็นข้อความของผู้ใช้เลย\n"
            "เปิด Chat ใน OA Manager (ตั้งค่าการตอบกลับ) ก่อนแล้วค่อยลองใหม่"
        )
    )


def admin_confirm_global_off() -> Reply:
    return Reply(
        text=(
            "ยืนยันปิดบอททั้งระบบ?\n\n"
            "ระหว่างปิด ทุกคนที่ทักมาจะได้ข้อความแจ้ง 1 ครั้งต่อวันว่าเจ้าหน้าที่จะตอบเอง แล้วบอทจะเงียบ\n"
            "ทีม IT ต้องตอบเองในแอป LINE Official Account หรือ chat.line.biz\n"
            "(ปุ่มดาวและปุ่มเช็คสถานะบนการ์ดเก่ายังกดได้ตามปกติ)"
        ),
        quick=[("⛔ ยืนยันปิดบอท", "a=adm_all&v=off&ok=1"), ("↩️ ไม่ปิด", "a=adm")],
    )


def admin_global_done(turned_off: bool) -> Reply:
    if turned_off:
        return Reply(text="⛔ ปิดบอททั้งระบบแล้วครับ — ทีม IT ตอบแชทเองในแอป LINE OA ได้เลย")
    return Reply(text="✅ เปิดบอททั้งระบบแล้วครับ — บอทกลับมาตอบทุกคนตามปกติ")


def admin_user_done(name: str, turned_off: bool) -> Reply:
    if turned_off:
        return Reply(text=f"⛔ ปิดบอทกับ \"{name}\" แล้วครับ — บอทจะเงียบกับคนนี้จนกว่าจะกดเปิด")
    return Reply(text=f"✅ เปิดบอทกับ \"{name}\" แล้วครับ — บอทกลับมาตอบคนนี้ตามปกติ")


def admin_panel(
    *, bot_off: dict | None, rows: list[dict], page: int, pages: int, total: int, chat_ok: bool,
) -> Reply:
    """การ์ดควบคุมบอท — rows มาจาก flow (ชื่อ LINE + สถานะ + postback ของปุ่มแต่ละแถว)

    ข้อความ (altText / ตอนแสดงการ์ดไม่ได้) สรุปสถานะเป็นบรรทัดๆ ให้อ่านรู้เรื่องแม้ไม่มีการ์ด
    """
    lines = [f"🛠 ควบคุมบอท — บอททั้งระบบ: {'ปิดอยู่ 🔴' if bot_off else 'เปิดอยู่ 🟢'}"]
    if not chat_ok:
        lines.append("⚠️ Chat ใน LINE OA ปิดอยู่ — สั่งปิดบอทไม่ได้")
    for r in rows:
        lines.append(f"• {r['name']}: {r['status']}")
    if not rows:
        lines.append("ยังไม่มีผู้ใช้ทักมา")
    return Reply(
        text="\n".join(lines),
        flex=F.admin_panel(
            bot_off=bot_off, rows=rows, page=page, pages=pages, total=total, chat_ok=chat_ok,
        ),
        quick=[("🔄 รีเฟรช", f"a=adm&p={page}")],
    )


def not_understood(examples: list[str]) -> Reply:
    """ข้อความแรกที่บอทตีความไม่ออกเลย (ไม่ใช่คำถาม ไม่ใช่การแจ้งเรื่อง ไม่ใช่ชื่อสาขา)

    เดิมตอบ "ไม่พบสาขา" ซึ่งถูกเฉพาะคนที่ตั้งใจพิมพ์ชื่อสาขา — คนที่พิมพ์ถามเรื่องที่บอทไม่รู้จัก
    (เรื่องนอกขอบเขตของบอท) จะงงว่าทำไมโดนถามสาขา จึงเปิดทางไปคุยกับเจ้าหน้าที่ไว้ด้วย
    """
    sample = ", ".join(examples[:2]) if examples else "ภูเก็ต, สำนักงานใหญ่"
    return Reply(
        text=(
            "ยังไม่เข้าใจข้อความนี้ครับ 🙏\n"
            f"• จะแจ้งเรื่อง — เลือกสาขาจากการ์ดด้านล่าง หรือพิมพ์ชื่อสาขา (เช่น {sample})\n"
            "• เป็นเรื่องอื่นที่อยากคุยกับคน — กด '👤 คุยกับเจ้าหน้าที่'"
        ),
        # ทิ้งไว้ "ยังไม่อ่าน" ในแอป LINE OA ให้เจ้าหน้าที่เห็นว่ามีคนพิมพ์มาแล้วบอทช่วยไม่ได้
        keep_unread=True,
    )


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


def branch_area_hint(example: str) -> str:
    """คำแนะนำของการ์ดเลือกเขต (บริษัทที่แบ่งตาม Area Manager) — เห็นในแจ้งเตือน/LINE รุ่นเก่าที่ไม่แสดงการ์ด"""
    eg = f" (เช่น {example})" if example else ""
    return f"เลือกจากการ์ด หรือพิมพ์ชื่อสาขา / ชื่อ Area Manager{eg} ก็ได้ครับ"


def branch_area_subtitle(example: str) -> str:
    """หัวการ์ดเลือกเขต — บอกไว้บนการ์ดเลยว่าพิมพ์ชื่อ AM ได้ (คำแนะนำด้านบนไม่โผล่บนการ์ด)"""
    eg = f" เช่น {example}" if example else ""
    return f"แตะเขต หรือพิมพ์ชื่อ AM{eg}"


def _area_example(options: list[dict]) -> str:
    """ชื่อ AM ตัวอย่าง = เขตสุดท้ายของบริษัทนั้น ("ทีมใบตอง" -> "ใบตอง" · "ทีมทับทิม" -> "ทับทิม")

    เขตท้ายๆ อยู่หน้าหลังของการ์ด จึงเป็นเขตที่หาไม่เจอบ่อยที่สุด (ผู้ใช้แจ้ง 13 ต.ค. 2026 ว่าหาใบตองไม่เจอ)
    และต้องเป็นชื่อจริงของบริษัทนั้นเสมอ — ยกชื่อ AM ของ Motta ให้คน Montipa พิมพ์ตาม จะไม่เจอเขตไหนเลย
    """
    label = str(options[-1].get("label") or "") if options else ""
    return label.removeprefix("ทีม").strip()


#: ปุ่ม "ดูเพิ่ม" ของเมนูสาขาทุกชั้น — ต้องส่ง bk_page ของเมนูสาขาเอง
#  เดิมไม่ได้ส่งค่านี้ ปุ่มจึงใช้ค่าตั้งต้นของ _picker_reply (a=pk_page = เมนูทรัพย์สิน) กดหน้า 2 แล้วได้
#  "ดึงรายการทรัพย์สินไม่ได้" ทุกครั้ง — เขตที่อยู่หน้า 2 (ทีมแนน · ทีมใบตอง) และสาขาที่ 9 ขึ้นไปของเขต/ภูมิภาค
#  เลือกจากการ์ดไม่ได้เลย (ผู้ใช้แจ้ง 13 ต.ค. 2026 พร้อมภาพหน้าจอ)
BRANCH_PAGE_ACTION = "a=bk_page"


def _branch_page_action(level: str) -> str:
    """ปุ่ม "ดูเพิ่ม" บอกชั้นของการ์ดมาด้วย (l=) — กดจากการ์ดเขตที่เลื่อนขึ้นไปเจอทีหลัง ต้องได้หน้าถัดไปของ
    "เขต" ตามที่การ์ดเขียนไว้ ไม่ใช่หน้าถัดไปของชั้นที่ session อยู่ตอนนี้"""
    return f"{BRANCH_PAGE_ACTION}&l={level}"


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
        page_action=_branch_page_action("company"),
    )


def ask_branch_group(options: list[dict], company_label: str, group_label: str,
                     page: int = 0, *, by_area: bool = False) -> Reply:
    """by_area=True (บริษัทที่แบ่งตาม Area Manager — Montipa, Motta): บอกด้วยว่าพิมพ์ชื่อ AM ได้
    คนจำชื่อหัวหน้าเขตได้แม่นกว่าจำว่าเขตตัวเองอยู่หน้าไหนของการ์ด"""
    example = _area_example(options) if by_area else ""
    return _picker_reply(
        title=f"เลือก{group_label}",
        crumb=f"บริษัท: {company_label}",
        options=options,
        page=page,
        action="a=bk_grp",
        back=("◀ เปลี่ยนบริษัท", "a=bk_back&to=company"),
        escapes=_BRANCH_ESCAPES,
        hint=branch_area_hint(example) if by_area else _BRANCH_HINT,
        page_action=_branch_page_action("group"),
        subtitle=branch_area_subtitle(example) if by_area else None,
    )


def ask_branch_list(
    options: list[dict], crumb: str, page: int = 0, *, skip_group: bool = False, group_word: str = "กลุ่ม",
) -> Reply:
    return _picker_reply(
        title="เลือกสาขาของคุณครับ",
        crumb=crumb,
        options=options,
        page=page,
        action="a=bk_branch",
        back=(
            ("◀ เปลี่ยนบริษัท", "a=bk_back&to=company") if skip_group
            else (f"◀ เปลี่ยน{group_word}", "a=bk_back&to=group")
        ),
        # ชั้นนี้ 1 แถว = 1 สาขา ตัวเลข "1" ต่อท้ายทุกแถวไม่ได้บอกอะไร
        show_count=False,
        escapes=_BRANCH_ESCAPES,
        hint=_BRANCH_HINT,
        page_action=_branch_page_action("branch"),
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
    page_action: str = "a=pk_page",
    subtitle: str | None = None,
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
        footer.append(F._button(f"▼ ดูเพิ่ม (หน้า {nxt + 1}/{pages})", f"{page_action}&p={nxt}"))
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
        subtitle=subtitle,
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


# ---------------------------------------------------------------- เบิกอุปกรณ์
#
# การเบิก "ต้องระบุอุปกรณ์อย่างน้อย 1 รายการ" เสมอ — ticket เบิกที่ไม่บอกว่าของอะไร ทีม IT เตรียมของไม่ได้
# ต้องทักกลับไปถามทุกครั้ง (ผู้ใช้แจ้งมา 13 ต.ค. 2026: ticket ขึ้นแค่ "รายละเอียด: เบิกอุปกรณ์")
# ทุกข้อความในขั้นนี้จึงมีปุ่ม "❌ ยกเลิก" ให้เห็นทางออก แทนที่จะปล่อยให้พิมพ์อะไรก็ได้เพื่อให้ผ่านขั้นไป

CANCEL_BUTTON = ("❌ ยกเลิก", "a=cancel")
ITEM_TYPE_BUTTON = ("✏️ พิมพ์ชื่ออุปกรณ์", "a=item_other")
ITEM_PICK_BUTTON = ("📋 เลือกจากรายการ", "a=add_item")

_ITEM_HINT = "ไม่มีในปุ่ม กด '✏️ พิมพ์ชื่ออุปกรณ์' แล้วพิมพ์ชื่อ เช่น สาย HDMI, หมึก HP 682"
_ITEM_REQUIRED = "ต้องระบุอุปกรณ์อย่างน้อย 1 รายการ — ไม่เบิกแล้วกด '❌ ยกเลิก'"


def _item_buttons(stock_items: list[dict]) -> list[tuple[str, str]]:
    """ปุ่มของในสต็อก + พิมพ์เอง + ยกเลิก — ตัดของในสต็อกให้พอดี 13 ปุ่มตามลิมิตของ LINE"""
    buttons = [
        (truncate_label(item["name"]), f"a=item&v={item['id']}")
        for item in stock_items[: MAX_QUICK_REPLY_ITEMS - 2]
    ]
    return [*buttons, ITEM_TYPE_BUTTON, CANCEL_BUTTON]


def ask_item(stock_items: list[dict]) -> Reply:
    """ปุ่มเลือกอุปกรณ์ที่จะเบิก — ดึงรายการจริงจากสต็อกในระบบ admin

    ถ้าของในสต็อกมีมากกว่าที่ปุ่มใส่ได้ LINE จะรับไม่ไหว จึงตัดให้พอดีแล้วเหลือที่ให้
    ปุ่ม 'พิมพ์ชื่ออุปกรณ์' (ของที่ไม่อยู่ในปุ่ม) กับ 'ยกเลิก' เสมอ
    """
    return Reply(
        text=f"เลือกอุปกรณ์ที่ต้องการเบิกครับ:\n\n{_ITEM_HINT}\n\n{_ITEM_REQUIRED}",
        quick=_item_buttons(stock_items),
    )


ASK_ITEM_NAME = Reply(
    text=(
        "พิมพ์ชื่ออุปกรณ์ที่ต้องการเบิกครับ\n"
        "เช่น: สาย HDMI · หมึกปริ้นเตอร์ HP 682 · เมาส์ไร้สาย\n\n"
        "พิมพ์ให้รู้ว่าเป็นของอะไร ทีม IT จะได้เตรียมของถูกชิ้น"
    ),
    quick=[ITEM_PICK_BUTTON, CANCEL_BUTTON],
)


def item_required(stock_items: list[dict], typed: str, *, menu_pressed: bool = False) -> Reply:
    """สิ่งที่พิมพ์มาไม่ใช่ชื่ออุปกรณ์ (เช่น "อุปกรณ์", "ของ", ตัวเลขล้วน, ป้ายปุ่มเมนู) — ถามใหม่

    บอกตรงๆ ว่าทำไมไม่รับ แล้ววางปุ่มของในสต็อก + ยกเลิกไว้ให้กดต่อได้ทันที
    ไม่งั้นผู้ใช้จะพิมพ์คำเดิมซ้ำแล้วนึกว่าบอทค้าง
    """
    if menu_pressed:
        head = (
            "ตอนนี้กำลังเบิกอุปกรณ์อยู่ครับ 📦\n"
            "ระบุอุปกรณ์ที่ต้องการก่อน หรือกด '❌ ยกเลิก' แล้วค่อยเลือกเมนูใหม่"
        )
    else:
        shown = (typed or "").strip()[:40] or "-"
        head = f"\"{shown}\" ยังไม่ใช่ชื่ออุปกรณ์ครับ 🙏\nบอกด้วยว่าต้องการเบิกอะไร เช่น เมาส์, สาย LAN 5 เมตร"
    return Reply(text=f"{head}\n\n{_ITEM_HINT}\n\n{_ITEM_REQUIRED}", quick=_item_buttons(stock_items))


def ask_qty(item_name: str, unit: str = "ชิ้น") -> Reply:
    return Reply(
        text=(
            f"เลือก: {item_name} ✅\n\n"
            f"ต้องการกี่{unit}ครับ? (พิมพ์ตัวเลข)"
        ),
        quick=[CANCEL_BUTTON],
    )


def invalid_qty(unit: str = "ชิ้น") -> Reply:
    return Reply(text=f"กรุณาพิมพ์เป็นตัวเลขครับ เช่น 1 หรือ 2 (จำนวน{unit})", quick=[CANCEL_BUTTON])


def ask_more_items(items: list[dict], *, retry: bool = False) -> Reply:
    summary = "\n".join(f"• {i['name']} x{i['qty']}" for i in items)
    head = "ไม่เข้าใจข้อความนี้ครับ 🙏\n\n" if retry else ""
    return Reply(
        text=(
            f"{head}รายการที่เบิกตอนนี้:\n{summary}\n\nต้องการเพิ่มอีกไหมครับ?\n"
            "(พิมพ์ชื่ออุปกรณ์ชิ้นถัดไปได้เลย หรือกด '✅ พอแล้ว')"
        ),
        quick=[("➕ เพิ่มอีก", "a=add_item"), ("✅ พอแล้ว", "a=done_items"), CANCEL_BUTTON],
    )


# ปิดเมนู "เลือกจากรายชื่อ" ไว้ชั่วคราวตามที่เจ้าของระบบสั่ง (28 ก.ย. 2026)
# — ขั้นระบุผู้แจ้งให้พิมพ์ชื่อเอาเองอย่างเดียวไปก่อน
#
# ไม่ได้ลบโค้ดเมนูทิ้ง เพราะคำสั่งคือ "ไปก่อน" ไม่ใช่ "เลิกใช้" การลบแล้ววันหลังเขียนใหม่
# มีราคาแพงกว่าการคงไว้หลังธงตัวเดียวมาก (ตัวเมนู + การแบ่งหน้า + การกันกดการ์ดเก่า
# เป็นโค้ดที่ผ่านการทดสอบมาแล้ว) เปิดกลับ = แก้บรรทัดนี้เป็น True บรรทัดเดียว
#
# ปิดที่นี่ที่เดียวคุมทั้ง 2 ฝั่ง: ปุ่มหายจากทุกข้อความ (ไฟล์นี้) และปุ่มเก่าที่ค้างอยู่ในแชท
# กดแล้วถอยไปหน้าพิมพ์ชื่อแทนที่จะเปิดเมนู (flow.py) — ต้องทำทั้งคู่ เพราะการ์ดที่ส่งไปแล้ว
# ลบออกจากห้องแชทของผู้ใช้ไม่ได้ ถ้ากันแค่ฝั่งข้อความใหม่ คนที่เลื่อนขึ้นไปกดของเก่าจะยังเข้าเมนูได้
REQUESTER_PICKER_ENABLED = False


def _picker_button() -> list[tuple[str, str]]:
    """ปุ่ม "เลือกจากรายชื่อ" — คืนลิสต์ว่างเมื่อปิดใช้งาน เพื่อให้กระจายด้วย * ได้ทุกที่"""
    return [("📋 เลือกจากรายชื่อ", "a=rq_menu")] if REQUESTER_PICKER_ENABLED else []


def ask_requester(ticket_type: str) -> Reply:
    """ถามว่า "ใครแจ้ง" — ถามครั้งเดียวต่อ 1 บัญชี LINE เท่านั้น

    ทำไมให้พิมพ์ค้นหาเป็นทางหลัก ไม่ใช่กดเมนูฝ่าย: ทะเบียนมีพนักงาน 338 คน
    การกดเมนูแปลว่าต้องเลื่อนหาตัวเองในฝ่ายที่อาจมีเป็นสิบๆ คน ส่วนการพิมพ์ชื่อเล่นของตัวเอง
    ใช้เวลาไม่ถึง 2 วินาทีและแทบไม่มีทางเลือกผิดคน — เมนูจึงเป็นทางสำรองสำหรับคนที่
    ไม่แน่ใจว่าชื่อตัวเองในระบบสะกดยังไง
    """
    who = PERSON_LABEL.get(ticket_type, "ผู้แจ้ง")
    return Reply(
        text=(
            f"{who}คือใครครับ?\n\n"
            "พิมพ์ชื่อจริง ชื่อเล่น หรือรหัสพนักงานมาได้เลย\n"
            "เช่น: ธนากร · ฟิล์ม · A69048\n\n"
            "(ถามครั้งเดียว ครั้งต่อไปไม่ต้องพิมพ์อีก)"
        ),
        quick=[*_picker_button(), ("❌ ยกเลิก", "a=cancel")],
    )


def _employee_where(emp: dict) -> str:
    """ฝ่าย · ตำแหน่ง ของพนักงาน 1 คน
    ตำแหน่งต้องมาด้วยเสมอ: ตำแหน่งของพนักงานสาขามีชื่อสาขาอยู่ในตัว ("พนักงานขายสาขาเซ็นทรัลหาดใหญ่")
    ซึ่งเป็นสิ่งเดียวที่แยกคนชื่อเล่นซ้ำกันได้ — ทะเบียนมี "ครีม" 5 คนอยู่ฝ่ายขายทั้งหมด ถ้าโชว์แค่ฝ่าย
    ผู้ใช้จะเห็น 5 บรรทัดที่ต่างกันแค่ชื่อจริง แล้วต้องเดาว่าคนไหนคือตัวเอง"""
    dept = emp.get("department") or "-"
    position = emp.get("position")
    return f"{dept} · {position}" if position else dept


def _employee_line(emp: dict) -> str:
    """บรรทัดสรุปพนักงาน 1 คน — ใส่ชื่อเล่น ฝ่าย และตำแหน่งด้วยเพราะชื่อจริงอย่างเดียวแยกคนไม่ออก
    (ในทะเบียนมีชื่อจริงคล้ายกันหลายคู่ แต่พอมีชื่อเล่น+ฝ่าย+ตำแหน่งแล้วแทบไม่มีทางสับสน)"""
    name = emp.get("full_name") or emp.get("name") or "-"
    nick = emp.get("nickname")
    head = f"{name} ({nick})" if nick else name
    return f"{head}\n🏷 {_employee_where(emp)}"


# บอกไว้บนการ์ดเมื่อการกดยืนยันคือการ "ส่งเรื่อง" (การเบิกจบที่ขั้นผู้เบิก — ดู flow._ends_at_requester)
# ถ้าไม่บอก คนจะรอคำถามถัดไปที่ไม่มีแล้ว หรือกดไปก่อนทั้งที่ยังอยากส่งรูปแนบ
SENDS_ON_CONFIRM = "กด 'ใช่ ฉันเอง' เพื่อส่งเรื่องให้ทีม IT ได้ทันทีครับ"
SENDS_ON_PICK = "เลือกแล้วส่งเรื่องให้ทีม IT ทันทีครับ"


def requester_confirm(
    emp: dict, ticket_type: str, *, bound: bool = False, final: bool = False,
) -> Reply:
    """เจอคนเดียว -> ให้กดยืนยันก่อนผูก

    ต้องยืนยันเพราะการผูกนี้ "ติดถาวร" — ครั้งต่อๆ ไปบอทจะไม่ถามอีกเลย
    ถ้าผูกผิดคนตั้งแต่แรกโดยไม่ถาม ticket ทุกใบหลังจากนั้นจะขึ้นชื่อคนอื่นโดยที่เจ้าตัวไม่รู้

    bound : คนนี้มาจากการผูกบัญชีไว้เดิม ไม่ใช่ผลค้นที่เพิ่งพิมพ์ — ปุ่ม "ไม่ใช่" ต้องถอดการผูกด้วย
            (a=rq_change) ถ้าใช้ "ค้นใหม่" เฉยๆ ครั้งหน้าบอทจะเสนอคนผิดคนเดิมกลับมาอีก
    final : กดยืนยันแล้วบอทจะส่งเรื่องทันที — ใส่บรรทัดบอกไว้ (ดู SENDS_ON_CONFIRM)
    """
    who = PERSON_LABEL.get(ticket_type, "ผู้แจ้ง")
    text = f"{who}คือคนนี้ใช่ไหมครับ?\n\n{_employee_line(emp)}"
    if final:
        text += f"\n\n{SENDS_ON_CONFIRM}"
    not_me = ("👤 ไม่ใช่ เปลี่ยนคน", "a=rq_change") if bound else ("🔁 ไม่ใช่ ค้นใหม่", "a=rq_again")
    return Reply(
        text=text,
        quick=[
            ("✅ ใช่ ฉันเอง", "a=rq_yes"),
            not_me,
            *_picker_button(),
            ("❌ ยกเลิก", "a=cancel"),
        ],
    )


def requester_choices(matches: list[dict], ticket_type: str, *, final: bool = False) -> Reply:
    """เจอหลายคน -> ให้เลือก (ส่งกลับมาเป็น "ลำดับที่" เพราะ postback จำกัด 300 ไบต์)"""
    who = PERSON_LABEL.get(ticket_type, "ผู้แจ้ง")
    shown = matches[:MAX_QUICK_REPLY_ITEMS - 2]
    nicks = [emp.get("nickname") for emp in shown]
    lines = [f"เจอ {len(matches)} คนที่ใกล้เคียงครับ เลือก{who}ด้วยนะครับ", ""]
    quick: list[tuple[str, str]] = []
    for index, emp in enumerate(shown):
        nick = emp.get("nickname")
        name = emp.get("name") or "-"
        lines.append(f"{index + 1}. {name}{f' ({nick})' if nick else ''}")
        lines.append(f"   {_employee_where(emp)}")
        # ปุ่มใช้ชื่อเล่นเพราะสั้นพอดีปุ่ม — แต่พิมพ์ "ครีม" แล้วได้ปุ่ม "1. ครีม" "2. ครีม" … ทุกปุ่มหน้าตาเหมือนกัน
        # ต้องย้อนไปนับบรรทัดในข้อความเอง จึงใช้ชื่อจริงแทนเมื่อชื่อเล่นซ้ำกันในผลชุดนี้
        label = nick if nick and nicks.count(nick) == 1 else name.split()[0]
        quick.append((truncate_label(f"{index + 1}. {label}"), f"a=rq_pick&i={index}"))
    if final:
        lines += ["", SENDS_ON_PICK]
    quick.append(("🔁 ค้นใหม่", "a=rq_again"))
    quick.append(("❌ ยกเลิก", "a=cancel"))
    return Reply(text="\n".join(lines), quick=quick)


def requester_not_found(text: str, ticket_type: str) -> Reply:
    who = PERSON_LABEL.get(ticket_type, "ผู้แจ้ง")
    # ข้อความต้องเปลี่ยนตามธงด้วย ไม่ใช่ซ่อนแค่ปุ่ม — การบอกให้ "เลือกจากรายชื่อ"
    # ทั้งที่ไม่มีปุ่มให้กด คือการบอกทางออกที่ไม่มีอยู่จริงให้คนที่กำลังติดอยู่แล้ว
    retry = (
        "ลองพิมพ์ชื่อเล่น หรือรหัสพนักงานดูอีกครั้ง หรือเลือกจากรายชื่อก็ได้"
        if REQUESTER_PICKER_ENABLED
        else "ลองพิมพ์ชื่อเล่น หรือรหัสพนักงานดูอีกครั้งได้ครับ"
    )
    return Reply(
        text=(
            f"ไม่พบ \"{text}\" ในทะเบียนพนักงานครับ\n\n"
            f"{retry}\n"
            f"ถ้ายังไม่มีชื่อในระบบ กด \"ใช้ชื่อที่พิมพ์\" เพื่อแจ้งในชื่อนี้ไปก่อนได้ครับ "
            f"(แอดมินจะเห็นว่า{who}คนนี้ยังไม่ได้อยู่ในทะเบียน)"
        ),
        quick=[
            ("✍️ ใช้ชื่อที่พิมพ์", "a=rq_manual"),
            *_picker_button(),
            ("❌ ยกเลิก", "a=cancel"),
        ],
    )


_REQUESTER_ESCAPES = [("🔍 พิมพ์ชื่อค้นหา", "a=rq_again"), ("❌ ยกเลิก", "a=cancel")]
_REQUESTER_HINT = "เลือกจากการ์ด หรือพิมพ์ชื่อ/ชื่อเล่น/รหัสพนักงานค้นหาก็ได้ครับ"


def ask_requester_department(options: list[dict], page: int = 0) -> Reply:
    return _picker_reply(
        title="เลือกฝ่ายของคุณครับ",
        crumb=None,
        options=options,
        page=page,
        action="a=rq_dept",
        back=None,
        escapes=_REQUESTER_ESCAPES,
        hint=_REQUESTER_HINT,
        page_action="a=rq_page",
    )


def ask_requester_person(options: list[dict], department: str, page: int = 0) -> Reply:
    return _picker_reply(
        title="เลือกชื่อของคุณครับ",
        crumb=f"ฝ่าย: {department}",
        options=options,
        page=page,
        action="a=rq_pick",
        back=("◀ เปลี่ยนฝ่าย", "a=rq_menu"),
        # 1 แถว = 1 คน ตัวเลข "1" ต่อท้ายทุกแถวไม่ได้บอกอะไร
        show_count=False,
        escapes=_REQUESTER_ESCAPES,
        hint=_REQUESTER_HINT,
        page_action="a=rq_page",
    )


# ปุ่ม "ข้ามรายละเอียด" — เพิ่ม 2026-09-30
#
# เดิมคนที่ไม่มีรายละเอียดจะเพิ่มต้องพิมพ์ "-" เอง ซึ่งเป็นการเปิดคีย์บอร์ดเพื่อพิมพ์ตัวเดียว
# ปุ่มนี้ทำให้จบได้ด้วยการกด 1 ครั้ง และคงขั้นตอนไว้ เพราะปุ่ม "เปลี่ยนคนแจ้ง" (a=rq_change)
# ของคนที่บอทเติมชื่อให้จากการผูกบัญชีติดอยู่กับข้อความของขั้นนี้
#
# การเบิก "ไม่มีขั้นนี้แล้ว" (30 ก.ย. 2026 ตามที่ผู้ทดสอบขอ — ดู flow._ends_at_requester)
# ทางแก้ผู้เบิกที่ผูกผิดย้ายไปอยู่บนการ์ดยืนยันผู้เบิก (requester_confirm(bound=True)) แทน
# ปุ่มนี้จึงเหลือไว้ให้ คืน · ซ่อม · ขอใช้บริการ และ session เบิกที่ค้างขั้นนี้มาจากก่อนอัปเดต
#
# ปุ่มนี้ต้องโผล่ "เฉพาะตอนที่ข้ามได้จริง" เท่านั้น (ดู flow._can_skip_description)
SKIP_DESC_LABEL = F.SKIP_DESC_LABEL
SKIP_DESC_ACTION = "a=desc_skip"


def _description_prompt(text: str, button_label: str, *, can_skip: bool) -> Reply:
    quick: list[tuple[str, str]] = []
    if can_skip:
        quick.append((SKIP_DESC_LABEL, SKIP_DESC_ACTION))
    quick.append(("❌ ยกเลิก", "a=cancel"))
    return Reply(
        text=text,
        quick=quick,
        flex=F.description_prompt(text, button_label, can_skip=can_skip),
    )


# ท้ายข้อความของแจ้งซ่อม/ขอใช้บริการต่างกัน 2 แบบ เพราะ "บังคับพิมพ์" กับ "กดข้ามได้"
# เป็นคนละคำสั่งกัน ถ้าใช้ข้อความเดียวจะมีกรณีที่บอกว่า "จำเป็นต้องระบุ" ทั้งที่มีปุ่มข้ามอยู่ข้างล่าง
_MUST_FILL = " (จำเป็นต้องระบุ)"
_ALREADY_TOLD = "\nถ้าเล่ามาแล้วตั้งแต่ข้อความแรก กด 'ไม่มี ส่งเลย' ได้ทันที"

_DESC_GENERIC = (
    "มีรายละเอียดเพิ่มเติมไหมครับ?\n\n"
    "ถ้ามี กดปุ่ม 'พิมพ์รายละเอียด' แล้วพิมพ์ในช่องแชท\n"
    "ถ้าไม่มี กดปุ่ม 'ไม่มี ส่งเลย' ได้ทันที (พิมพ์ '-' ก็ได้เหมือนเดิม)\n\n"
    "(พิมพ์ 'ยกเลิก' เพื่อออก)"
)

_DESC_REPAIR = (
    "ช่วยอธิบายอาการเสียหรือปัญหาที่ต้องการให้ทีม IT ช่วยครับ\n\n"
    "เช่น: คอมเปิดไม่ติดตั้งแต่เช้า กดปุ่มแล้วไม่มีไฟเข้า\n"
    "ไม่จำเป็นต้องทราบสาเหตุทางเทคนิค บอกอาการที่พบได้เลย และแนบรูปเพิ่มเติมได้ครับ\n\n"
    "กดปุ่ม 'พิมพ์อาการ/สาเหตุ' แล้วพิมพ์ในช่องแชท จากนั้นกดส่ง"
)

_DESC_SERVICE = (
    "ต้องการให้ทีม IT ช่วยเรื่องอะไรครับ?\n\n"
    "พิมพ์สาเหตุหรือสิ่งที่ต้องการให้ช่วยได้เลย ไม่จำเป็นต้องเกี่ยวกับทรัพย์สินครับ\n\n"
    "เช่น: ขอให้ติดตั้งโปรแกรมบัญชี หรือขอสิทธิ์เข้าโฟลเดอร์แผนก\n\n"
    "กดปุ่ม 'พิมพ์สิ่งที่ให้ช่วย' แล้วระบุสิ่งที่ต้องการพร้อมรายละเอียดในช่องแชท จากนั้นกดส่ง"
)

# คืน (และการเบิกที่ค้างขั้นนี้มาจากก่อนอัปเดต): ส่วนใหญ่รู้แล้วว่าคืนเครื่องไหนจากรหัสทรัพย์สิน
# รายละเอียดจึงไม่บังคับ — แต่ยังคงขั้นนี้ไว้ให้เล่าได้ เผื่อคนที่กดข้ามรหัสมา (ดู flow._ends_at_requester)
ASK_DESCRIPTION = _description_prompt(_DESC_GENERIC, "พิมพ์รายละเอียด", can_skip=True)

ASK_DESCRIPTION_REPAIR = _description_prompt(
    _DESC_REPAIR + _MUST_FILL, "พิมพ์อาการ/สาเหตุ", can_skip=False
)
ASK_DESCRIPTION_SERVICE = _description_prompt(
    _DESC_SERVICE + _MUST_FILL, "พิมพ์สิ่งที่ให้ช่วย", can_skip=False
)

# ใช้เมื่อผู้ใช้เล่าเรื่องมาแล้วตั้งแต่ข้อความแรก (session.initial_message) — handler ยอมให้ข้าม
# อยู่แล้วตั้งแต่ก่อนมีปุ่มนี้ แต่ข้อความยังบอกว่า "จำเป็นต้องระบุ" ซึ่งขัดกับของจริง
_ASK_DESCRIPTION_REPAIR_SKIP = _description_prompt(
    _DESC_REPAIR + _ALREADY_TOLD, "พิมพ์อาการ/สาเหตุ", can_skip=True
)
_ASK_DESCRIPTION_SERVICE_SKIP = _description_prompt(
    _DESC_SERVICE + _ALREADY_TOLD, "พิมพ์สิ่งที่ให้ช่วย", can_skip=True
)


# ป้ายปุ่มเปิดคีย์บอร์ดต่อประเภทเรื่อง — ต้องตรงกับที่ส่งให้ _description_prompt ด้านบน
_DESC_BUTTON_LABEL = {"repair": "พิมพ์อาการ/สาเหตุ", "it_service": "พิมพ์สิ่งที่ให้ช่วย"}


def ask_description(
    ticket_type: str | None,
    requester: dict | None = None,
    *,
    can_skip: bool | None = None,
) -> Reply:
    """ถามรายละเอียด — ถ้ารู้ว่าแจ้งในชื่อใคร ต้องโชว์ชื่อนั้นบนการ์ดด้วย

    ทำไมมาแปะกับคำถามนี้แทนที่จะส่งเป็นอีกบับเบิล: ขั้น "รายละเอียด" คือขั้นถัดจากผู้แจ้งเสมอ
    การรวมไว้ที่เดียวทำให้ผู้ใช้เห็นว่ากำลังแจ้งในชื่อใครโดยไม่ต้องเสียบับเบิลเพิ่มทุกครั้ง
    — ซึ่งถ้าเพิ่มจริงจะกลายเป็นข้อความรกที่คนเลิกอ่านภายในไม่กี่ครั้ง

    **บั๊กที่แก้ 2026-10-01:** เวอร์ชันก่อนเอาบรรทัดชื่อไปต่อหน้า `text` แต่ส่ง `flex=base.flex`
    ซึ่งเป็นการ์ดใบเดิมที่ไม่มีชื่อ — และ `line_api.to_line_messages()` ส่ง Reply ที่มี flex
    เป็น "การ์ด" โดยใช้ `text` เป็น altText เท่านั้น ชื่อจึงไปโผล่แค่ในหน้าจอแจ้งเตือน
    คนที่เปิดแชทอยู่ไม่เคยเห็นชื่อเลยสักครั้ง ทั้งที่ docstring เดิมเขียนว่าแสดงให้แล้ว
    """
    if can_skip is None:
        # ค่าเริ่มต้นต้องตรงกับ flow._can_skip_description สำหรับเคสที่ไม่มี initial_message
        can_skip = ticket_type not in ("repair", "it_service")
    if ticket_type == "repair":
        base = _ASK_DESCRIPTION_REPAIR_SKIP if can_skip else ASK_DESCRIPTION_REPAIR
    elif ticket_type == "it_service":
        base = _ASK_DESCRIPTION_SERVICE_SKIP if can_skip else ASK_DESCRIPTION_SERVICE
    else:
        base = ASK_DESCRIPTION
    if not requester:
        return base
    name = requester.get("name") or "-"
    dept = requester.get("department") or "-"
    return Reply(
        text=f"👤 แจ้งในชื่อ: {name} · {dept}\n\n{base.text}",
        quick=[("👤 เปลี่ยนคนแจ้ง", "a=rq_change")] + list(base.quick),
        # ต้องประกอบการ์ดใหม่พร้อมชื่อ ห้ามใช้ base.flex ซ้ำ (ดูเหตุผลใน docstring)
        flex=F.description_prompt(
            base.text,
            _DESC_BUTTON_LABEL.get(ticket_type, "พิมพ์รายละเอียด"),
            can_skip=can_skip,
            requester=requester,
        ),
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


# ---------------------------------------------------------------- ผลการแก้ไข / ให้คะแนน
#
# ตั้งแต่ ต.ค. 2026 ทีม IT ปิดงานเองได้ ผู้แจ้งได้การ์ด "แก้ไขเรียบร้อยแล้ว" ที่มีดาว 1–5 + ปุ่ม "ยังมีปัญหาอยู่"
# (การ์ดสร้างฝั่ง Next.js: src/lib/line/rating-card.ts) ส่วนการ์ดยืนยันรุ่นเก่ายังกดได้ เพราะค้างอยู่ในห้องแชท

RATING_MAX = 5
# ต้องตรงกับ MAX_RATING_COMMENT ฝั่ง Next.js (src/lib/ticket-feedback.ts) — นับแบบ UTF-16 เหมือนฝั่งนั้น
MAX_RATING_COMMENT = 500
# พิมพ์คำเหล่านี้ตอนบอทขอความเห็น = ไม่อยากเขียน (เหมือนกดปุ่ม "ข้าม")
RATE_SKIP_WORDS = {"ข้าม", "skip"}


def rating_buttons(code: str) -> list[tuple[str, str]]:
    """ปุ่มดาวแบบ quick reply (⭐ ถึง ⭐⭐⭐⭐⭐) — data แบบเดียวกับดาวบนการ์ดปิดงาน"""
    return [("⭐" * n, f"a=rate&code={code}&s={n}") for n in range(1, RATING_MAX + 1)]


def confirm_done_thanks(code: str) -> Reply:
    """ผู้แจ้งกด "เรียบร้อยแล้ว" บนการ์ดรุ่นเก่า — ต้องตอบให้ชัดว่าเรื่องปิดแล้วจริง

    ถ้าตอบแค่ "ขอบคุณครับ" ผู้ใช้จะไม่รู้ว่ากดติดหรือเปล่า แล้วจะกดซ้ำอีกหลายครั้ง
    แนบดาวให้คะแนนไว้ด้วย — เรื่องจากการ์ดเก่าจะได้มีคะแนนเหมือนเรื่องที่ปิดด้วยระบบใหม่
    (เป็นคำตอบ reply จึงไม่กินโควตา push)
    """
    return Reply(
        text=(
            f"ขอบคุณที่ยืนยันครับ 🙏\n\n"
            f"เรื่อง {code} ปิดเรียบร้อยแล้ว\n"
            "สถานะ: ดำเนินการเสร็จสิ้น ✅\n\n"
            "ช่วยให้คะแนนการบริการครั้งนี้ด้วยปุ่มดาวด้านล่างได้เลยครับ\n"
            "(1 ดาว = ต้องปรับปรุง · 5 ดาว = ดีมาก)"
        ),
        quick=rating_buttons(code),
    )


def still_broken_ack(code: str, *, handed_off: bool = False) -> Reply:
    """ผู้แจ้งกด "ยังมีปัญหาอยู่" / "ยังไม่หาย" — เปิดเรื่องกลับและแจ้งทีม IT แล้ว

    handed_off=True: บอทเปลี่ยนเป็นโหมดคุยกับเจ้าหน้าที่ให้เลย (เงียบกับคนนี้) เพราะสิ่งที่ผู้แจ้งพิมพ์ต่อจากนี้
    คืออาการที่ยังเป็นอยู่ ซึ่งเป็นของเจ้าหน้าที่ — ถ้าบอทยังตอบ จะตีความเป็นเรื่องใหม่แล้วถามสาขาแทรกกลางบทสนทนา
    """
    if handed_off:
        return Reply(
            text=(
                f"รับทราบครับ 🙏 เปิดเรื่อง {code} กลับมาให้ทีม IT ตรวจสอบอีกครั้งแล้ว\n\n"
                "👤 เจ้าหน้าที่ได้รับแจ้งแล้ว และจะคุยกับคุณต่อในแชทนี้\n"
                "พิมพ์เล่าอาการที่ยังเป็นอยู่ หรือส่งรูปหน้าจอมาได้เลยครับ\n\n"
                "ระหว่างนี้บอทจะไม่ตอบแทรก — อยากใช้เมนูบอท กด '🤖 กลับไปใช้บอท'"
            ),
            quick=[RESUME_BUTTON],
            keep_unread=True,
        )
    return Reply(
        text=(
            f"รับทราบครับ เรื่อง {code} ถูกส่งกลับให้ทีม IT ตรวจสอบอีกครั้งแล้ว\n\n"
            "ทีม IT ได้รับแจ้งแล้ว และจะติดต่อกลับไปครับ 🙏"
        ),
        quick=MENU_BUTTONS,
    )


def confirm_not_owner() -> Reply:
    """คนกดไม่ใช่ผู้แจ้งของเรื่องนั้น — เกิดได้จริงถ้าเลขที่ตั๋วถูกส่งต่อในแชทกลุ่ม
    ใช้ทั้งปุ่มยืนยัน ปุ่มยังมีปัญหา และดาวให้คะแนน จึงไม่ระบุว่ากดปุ่มอะไร"""
    return Reply(
        text=(
            "ปุ่มนี้กดได้เฉพาะคนที่แจ้งเรื่องนี้ครับ เพราะเรื่องนี้ไม่ได้แจ้งจากบัญชีนี้\n\n"
            "ถ้ามีปัญหาแบบเดียวกัน กด 'แจ้งเรื่องใหม่' ได้เลยครับ"
        ),
        quick=MENU_BUTTONS,
    )


def confirm_not_resolved(code: str, status_label: str) -> Reply:
    """กด "เรียบร้อยแล้ว" จากการ์ดเก่าหลังสถานะเปลี่ยนไปแล้ว — บอกสถานะปัจจุบันดีกว่าทำเงียบๆ"""
    return Reply(
        text=(
            f"เรื่อง {code} ไม่ได้อยู่ในขั้นรอยืนยันแล้วครับ\n\n"
            f"สถานะตอนนี้: {status_label}"
        ),
        quick=MENU_BUTTONS,
    )


def reopen_not_possible(code: str, status_label: str) -> Reply:
    """กด "ยังมีปัญหาอยู่" กับเรื่องที่ไม่ได้ปิดอยู่ (ส่วนใหญ่คือกดซ้ำหลังเปิดกลับไปแล้ว)"""
    return Reply(
        text=(
            f"เรื่อง {code} ไม่ได้อยู่ในสถานะปิดงานแล้วครับ — ไม่ต้องกดซ้ำ\n\n"
            f"สถานะตอนนี้: {status_label}\n"
            "อยากเล่าอาการเพิ่ม กด '👤 คุยกับเจ้าหน้าที่' ได้เลยครับ"
        ),
        quick=MENU_BUTTONS,
    )


def reopen_expired(code: str, days: int | None) -> Reply:
    """ปิดงานไปนานเกินกำหนดแล้ว — ให้แจ้งใหม่แทนการดึงเรื่องเก่ากลับมา (เหตุผลอยู่ที่ REOPEN_WINDOW_DAYS ฝั่ง Next.js)"""
    since = f"เกิน {days} วัน" if days else "นานเกินกำหนด"
    return Reply(
        text=(
            f"เรื่อง {code} ปิดงานไป{since}แล้ว เปิดกลับไม่ได้ครับ\n\n"
            f"ถ้ายังมีปัญหาอยู่ กด 'แจ้งเรื่องใหม่' แล้วใส่เลขที่ {code} ไว้ในรายละเอียด "
            "ทีม IT จะดูประวัติเดิมประกอบให้ครับ"
        ),
        quick=MENU_BUTTONS,
    )


def _stars(score: int) -> str:
    return f"{'⭐' * score} ({score}/{RATING_MAX})"


def rate_thanks(score: int) -> Reply:
    return Reply(
        text=f"ขอบคุณสำหรับคะแนน {_stars(score)} ครับ 🙏\nถ้ามีปัญหาอีก แจ้งเข้ามาใหม่ได้ตลอดครับ",
        quick=MENU_BUTTONS,
    )


def rate_ask_comment(code: str, score: int) -> Reply:
    """คะแนนต่ำ — ถามต่อว่าควรปรับปรุงตรงไหน แต่ต้องข้ามได้เสมอ
    บังคับตอบแล้วคนจะเลิกให้คะแนนต่ำไปเลย ซึ่งคือคะแนนที่ทีม IT อยากรู้ที่สุด"""
    return Reply(
        text=(
            f"ขอบคุณสำหรับคะแนน {_stars(score)} ครับ 🙏\n\n"
            "ช่วยบอกสั้นๆ ได้ไหมครับว่าควรปรับปรุงตรงไหน ทีม IT จะนำไปแก้ไข\n"
            "พิมพ์ตอบได้เลย หรือกด 'ข้าม'"
        ),
        quick=[("ข้าม", f"a=rate_skip&code={code}")],
    )


def rate_comment_thanks() -> Reply:
    return Reply(
        text="ได้รับความเห็นแล้วครับ ขอบคุณมากครับ 🙏\nทีม IT จะนำไปปรับปรุงการบริการ",
        quick=MENU_BUTTONS,
    )


def rate_comment_skipped() -> Reply:
    return Reply(text="รับทราบครับ ขอบคุณที่ให้คะแนนครับ 🙏", quick=MENU_BUTTONS)


def rate_comment_failed(code: str) -> Reply:
    """บันทึกความเห็นไม่สำเร็จ — บอทยังรอความเห็นอยู่ ผู้ใช้พิมพ์ส่งใหม่ได้เลยไม่ต้องกดดาวใหม่"""
    return Reply(
        text="ขออภัยครับ ระบบขัดข้องชั่วคราว บันทึกความเห็นไม่สำเร็จ 🙏\nลองพิมพ์ส่งอีกครั้ง หรือกด 'ข้าม'",
        quick=[("ข้าม", f"a=rate_skip&code={code}")],
    )


def rate_not_completed(code: str, status_label: str) -> Reply:
    """กดดาวบนการ์ดเก่า หลังเรื่องถูกเปิดกลับไปแล้ว (เช่นกด "ยังมีปัญหาอยู่" ไปก่อน)"""
    return Reply(
        text=(
            f"เรื่อง {code} ยังไม่ได้ปิดงานครับ (สถานะตอนนี้: {status_label})\n"
            "ให้คะแนนได้หลังทีม IT ปิดงานแล้ว — จะมีการ์ดส่งมาให้อีกครั้งครับ"
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
