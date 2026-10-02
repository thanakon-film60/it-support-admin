"""State machine ของบทสนทนา — หัวใจของบอททั้งตัว

ออกแบบเป็น "ฟังก์ชันเกือบบริสุทธิ์": รับ (เหตุการณ์เข้า, store, backend) แล้วคืนรายการข้อความตอบกลับ
ไม่มีการเรียก LINE API อยู่ในไฟล์นี้เลย ผลคือเทสต์บทสนทนาทั้งเส้นได้โดยไม่ต้องมี LINE จริง
ไม่ต้องมี token ไม่ต้องมี ngrok (ดู tests/test_flow.py)

ผังสถานะ
  IDLE ──(กดแจ้งเรื่องใหม่ / พิมพ์ข้อความที่ไม่ตรง FAQ)──▶ ASK_BRANCH
  ASK_BRANCH ──(พิมพ์สาขา)──▶ ASK_TYPE
  ASK_TYPE ──(กดประเภท)──▶ ASK_ASSET
  ASK_ASSET ──(พิมพ์รหัส / กดข้าม)──┬─ ถ้าเป็น "เบิก" ─▶ ASK_ITEM ─▶ ASK_QTY ─▶ ASK_MORE_ITEMS ─┐
                                     └─ ถ้าเป็น "ซ่อม/คืน" ─────────────────────────────────────┴─▶ ASK_REQUESTER
  ASK_REQUESTER ──(ค้นทะเบียนพนักงาน / เลือกจากเมนูฝ่าย)──┬─ ถ้าเป็น "เบิก" ─▶ สร้าง ticket ──▶ IDLE
                                                            └─ ประเภทอื่น ─▶ ASK_DESC
  ASK_DESC ──(พิมพ์รายละเอียด)──▶ สร้าง ticket ──▶ IDLE

ASK_REQUESTER จะถูก "ข้าม" ทั้งขั้นถ้าบัญชี LINE นี้เคยระบุตัวไปแล้ว (ผูกไว้ที่ users ฝั่งแอดมิน)
ถามครั้งเดียวตลอดอายุการใช้งาน เปลี่ยนคนได้ด้วยปุ่ม "เปลี่ยนคนแจ้ง" ที่ติดอยู่กับขั้น ASK_DESC

ยกเว้น "เบิก" ที่จบตรงขั้นนี้ (ดู _ends_at_requester) — บัญชีที่ผูกแล้วจะเห็นการ์ด "ผู้เบิกคือคนนี้
ใช่ไหม" ให้กดยืนยันครั้งเดียวแล้วส่งเลย ปุ่ม "ไม่ใช่ เปลี่ยนคน" ย้ายมาอยู่บนการ์ดนั้นแทน

ทุกสถานะรับคำว่า "ยกเลิก" เพื่อล้างทิ้งได้เสมอ และ session หมดอายุเองตาม TTL
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from urllib.parse import parse_qsl

from . import ai as ai_module
from . import messages as M
from .backend import BackendClient, BackendError
from .store import ConversationStore, Session

# คะแนน TF-IDF ขั้นต่ำที่ถือว่า FAQ "ตรงมากพอ" จนควรเสนอวิธีแก้ก่อนเปิด ticket
# วัดจาก FAQ ชุดจริงในระบบ: เคสที่ควรตอบ FAQ ได้ 0.37-0.81 ส่วนเคสที่ควรแจ้งซ่อมจริงได้ 0.00
FAQ_STRONG_SCORE = 0.30

logger = logging.getLogger(__name__)

# ---- ชื่อสถานะ ----
IDLE = "IDLE"
ASK_BRANCH = "ASK_BRANCH"
BRANCH_START_LEVEL = "company"
ASK_TYPE = "ASK_TYPE"
ASK_ASSET = "ASK_ASSET"
# รหัสที่พิมพ์มาตรงกับหลายเครื่อง — รอให้ผู้ใช้เลือกว่าหมายถึงเครื่องไหน
ASK_PICK_ASSET = "ASK_PICK_ASSET"
ASK_ITEM = "ASK_ITEM"
ASK_ITEM_NAME = "ASK_ITEM_NAME"
ASK_QTY = "ASK_QTY"
ASK_MORE_ITEMS = "ASK_MORE_ITEMS"
ASK_REQUESTER = "ASK_REQUESTER"
ASK_DESC = "ASK_DESC"
RETRY_SUBMIT = "RETRY_SUBMIT"
# ค้นหาทรัพย์สินแบบลอยๆ (จากเมนู "เช็คข้อมูล") — ไม่ได้อยู่ในขั้นตอนแจ้งเรื่อง
FIND_ASSET = "FIND_ASSET"

TYPE_KEYWORDS = {
    "repair": ("ซ่อม", "เสีย", "repair", "พัง"),
    "withdraw": ("เบิก", "ขอของ", "withdraw"),
    "return": ("คืน", "return", "ส่งคืน"),
    "it_service": ("บริการ", "ติดตั้ง", "ลงโปรแกรม", "ขอสิทธิ์", "service"),
}


async def _resolve_branch(
    text: str, backend: BackendClient, knowledge=None
) -> tuple[str | None, list[str]]:
    """เทียบสาขาที่ผู้ใช้พิมพ์กับรายชื่อสาขาจริงในระบบ

    คืน (ชื่อสาขาที่ตรง | None, รายชื่อสาขาทั้งหมดไว้ใช้ยกตัวอย่างตอนหาไม่เจอ)
    ยอมให้พิมพ์ไม่ตรงเป๊ะได้ระดับหนึ่ง เช่น "สนง.ใหญ่" -> "สำนักงานใหญ่"
    แต่ถ้าไม่ใกล้พอจะไม่เดามั่ว เพราะสาขาผิดหมายถึงช่างไปผิดที่
    """
    branches: list[str] = []
    try:
        if knowledge is not None:
            branches = (await knowledge.get()).branches
        if not branches:
            branches = await backend.list_branches()
    except BackendError:
        branches = []

    cleaned = (text or "").strip()
    if not branches:
        # ดึงรายชื่อสาขาไม่ได้ -> ยอมรับไปก่อนดีกว่าทำให้ผู้ใช้ติดตาย แล้วให้แอดมินไปแก้ทีหลัง
        logger.warning("ดึงรายชื่อสาขาไม่ได้ — ข้ามการตรวจสอบสาขาชั่วคราว")
        return (cleaned or None), []

    for branch in branches:
        if branch.strip().lower() == cleaned.lower():
            return branch, branches

    matched, _score = ai_module._fuzzy_best(cleaned, branches, threshold=82)
    return matched, branches


async def _branch_prompt(
    backend: BackendClient,
    knowledge=None,
    *,
    session: Session | None = None,
    level: str = BRANCH_START_LEVEL,
    page: int = 0,
) -> M.Reply:
    """เมนูเลือกสาขาแบบไล่ทีละชั้น: บริษัท → กลุ่ม → สาขา

    ทำไมต้องไล่ชั้น: กลุ่มบริษัทมีสาขารวมกัน 100 กว่าสาขา (Montipa 30 · Motta 69)
    ของเดิมยัดเป็น quick reply ได้แค่ 12 ปุ่ม แล้วบอกว่า "สาขาอื่นพิมพ์ชื่อเอาเอง"
    ซึ่งแปลว่าคนอีกเกือบ 90 สาขาต้องพิมพ์เอง — และสะกดผิดทีเดียวรายงานแยกสาขาก็เพี้ยน

    ชั้นแรกคือ "บริษัท" ไม่ใช่ภูมิภาค เพราะมีสาขาชื่อซ้ำกันข้ามบริษัทจริง
    (ศาลายา / นครปฐม / มหาชัย มีทั้ง Montipa และ Motta) ถ้าไม่แยกบริษัทก่อนจะปนกันแน่นอน

    ถ้าดึงตัวเลือกไม่ได้ (backend ล่ม) ตกกลับไปให้พิมพ์เอง ดีกว่าทำให้ผู้ใช้ติดตาย
    """
    company = session.pick_company if session else None
    group = session.pick_group if session else None
    headquarters = company == "central" and level in ("group", "branch")
    try:
        if headquarters:
            # Headquarters has no useful department-selection step. Read the
            # actual branches so future locations still remain selectable.
            groups = await backend.branch_options("group", company=company)
            options = []
            for item in groups:
                options.extend(await backend.branch_options(
                    "branch", company=company, group=item["value"]
                ))
            level = "branch"
            if session is not None:
                session.pick_group = None
                session.pick_group_label = None
        else:
            options = await backend.branch_options(level, company=company, group=group)
    except BackendError:
        logger.warning("ดึงตัวเลือกสาขาไม่สำเร็จ level=%s", level)
        if headquarters:
            return M.backend_error()
        options = []

    if not options:
        # ตกกลับไปใช้ปุ่มชุดเดิมจากรายชื่อสาขาแบน ๆ ถ้ายังดึงไม่ได้อีกก็ให้พิมพ์เอง
        branches: list[str] = []
        try:
            if knowledge is not None:
                branches = (await knowledge.get()).branches
            if not branches:
                branches = await backend.list_branches()
        except BackendError:
            branches = []
        return M.ask_branch(branches)

    if session is not None:
        session.pick_level = level
        session.pick_page = page
        session.pick_values = [str(o.get("value") or "") for o in options]
        session.pick_labels = [str(o.get("label") or o.get("value") or "") for o in options]

    if level == "company":
        return M.ask_branch_company(options, page)
    if level == "group":
        return M.ask_branch_group(
            options,
            (session.pick_company_label if session else None) or "-",
            _group_label_for(session.pick_company if session else None),
            page,
        )

    crumb = " · ".join(
        x for x in [
            session.pick_company_label if session else None,
            session.pick_group_label if session else None,
        ] if x
    )
    return M.ask_branch_list(options, crumb or "-", page, skip_group=headquarters)


def _group_label_for(company: str | None) -> str:
    """ชื่อเรียกกลุ่มย่อยต่างกันในแต่ละบริษัท — Montipa แบ่งตามภูมิภาค Motta แบ่งตามทีมขาย
    ถ้าใช้คำกลาง ๆ ว่า "กลุ่ม" ทั้งคู่ ผู้ใช้จะไม่รู้ว่ากำลังเลือกอะไรอยู่"""
    return {"montipa": "ภูมิภาค", "motta": "ทีม", "central": "หน่วยงาน"}.get(company or "", "กลุ่ม")


def _clear_branch_picker(session: Session) -> None:
    session.pick_company = None
    session.pick_company_label = None
    session.pick_group = None
    session.pick_group_label = None
    session.pick_values = []
    session.pick_labels = []
    session.pick_page = 0


def _clear_requester_picker(session: Session) -> None:
    session.rq_level = None
    session.rq_dept = None
    session.rq_page = 0
    session.rq_values = []
    session.rq_labels = []
    session.rq_pending = None


def _apply_requester(session: Session, emp: dict) -> None:
    """เขียนผู้แจ้งที่เลือกแล้วลง session — ใช้ทางเดียวทั้งจากการค้นหาและจากเมนู"""
    session.requester_user_id = str(emp.get("id") or "") or None
    session.requester_name = str(emp.get("name") or "").strip() or None
    department = str(emp.get("department") or "").strip()
    session.requester_department = department or None
    _clear_requester_picker(session)


def _requester_badge(session: Session) -> dict | None:
    """ข้อมูลย่อของผู้แจ้งไว้แสดงบนการ์ดขั้นถัดไป — ทุกครั้งที่รู้ว่าแจ้งในชื่อใคร

    เดิมแสดงเฉพาะตอนที่ผูกกับทะเบียนแล้ว (`requester_user_id`) ด้วยเหตุผลว่า "ถ้าเพิ่งเลือกเอง
    ก็ไม่ต้องบอกซ้ำ" — แต่ผลจริงคือคนที่พิมพ์ชื่อเองไม่เห็นชื่อตัวเองเลยทั้งบทสนทนา
    และไม่ได้ปุ่ม "เปลี่ยนคนแจ้ง" ด้วย พิมพ์ผิดแล้วแก้ไม่ได้นอกจากยกเลิกแล้วเริ่มใหม่ทั้งเรื่อง
    (ผู้ใช้แจ้งมาเอง 1 ต.ค. 2026 ว่า "ไม่โชว์ชื่อคนแจ้งเลย")

    ต้นทุนคือกล่องเล็กๆ 1 กล่องบนการ์ด แลกกับการที่ชื่อผิดถูกจับได้ก่อนสร้าง ticket เสมอ
    """
    if not session.requester_name:
        return None
    return {"name": session.requester_name, "department": session.requester_department or "-"}


def _ends_at_requester(session: Session) -> bool:
    """ประเภทเรื่องที่ "จบที่ขั้นระบุผู้แจ้ง" — ยืนยันตัวแล้วส่งเรื่องทันที ไม่ถามรายละเอียดต่อ

    ตอนนี้มีแค่ "เบิก": ทุกอย่างที่ทีม IT ใช้จ่ายของจริง (ของอะไร · กี่ชิ้น · ให้ใคร) ครบตั้งแต่
    เลือกของกับระบุผู้เบิกแล้ว ขั้น "มีรายละเอียดเพิ่มเติมไหม" จึงเป็นการกดเปล่าที่ไม่ได้ข้อมูลอะไรเพิ่ม
    ผู้ทดสอบกดผ่านขั้นนี้ทุกครั้งแล้วขอให้ตัดออก (ผลทดสอบจริง 28 ก.ย. 2026)
    ticket ไม่ว่างเปล่า เพราะหลังบ้านประกอบคำอธิบายจากรายการเบิกให้เองเมื่อไม่มีรายละเอียด

    "คืน" ไม่ได้อยู่ในนี้โดยตั้งใจ — การคืนไม่มีรายการของ และกด "ไม่มี/ไม่ทราบ" ข้ามรหัสทรัพย์สินได้
    ถ้าตัดขั้นรายละเอียดด้วย ticket คืนของบางใบจะไม่มีข้อมูลเลยว่าคืนอะไร
    """
    return session.ticket_type == "withdraw"


def _description_settled(session: Session) -> bool:
    """ขั้นรายละเอียด "ไม่ต้องถามแล้ว" หรือยัง

    รวมไว้ที่เดียวเพราะมี 3 ทางที่ระบุผู้แจ้งเสร็จ (กดยืนยัน / เลือกจากผลค้นหา / ใช้ชื่อที่พิมพ์)
    เดิมแต่ละทางเขียนเงื่อนไขซ้ำกันเอง วันที่เพิ่มเงื่อนไขใหม่จะมีทางที่ถูกลืม แล้วได้บั๊กแบบ
    "ยืนยันผู้เบิกแล้วส่งเลย แต่เลือกจากรายชื่อแล้วยังถามรายละเอียด" ซึ่งดูเหมือนเรื่องเดียวกันจนไล่ยาก
    """
    if _ends_at_requester(session) or session.description_collected:
        return True
    return session.ticket_type == "it_service" and bool(session.description)


def _submits_after_requester(session: Session) -> bool:
    """ถ้าระบุผู้แจ้งเสร็จตอนนี้ บอทจะส่งเรื่องทันทีเลยไหม (ใช้ตัดสินว่าจะบอกผู้ใช้ล่วงหน้าหรือเปล่า)

    **ต้องตรงกับ _ready_to_submit เป๊ะ** — ข้อความ "กดแล้วส่งเรื่องทันที" ที่ไม่จริง แย่กว่าไม่บอกเลย
    ผู้ใช้จะรอข้อความยืนยันที่ไม่มาถึง หรือส่งไปก่อนทั้งที่ยังอยากแนบอะไรเพิ่ม
    """
    if not session.branch:
        return False
    if session.ticket_type == "withdraw" and not session.items:
        return False
    return _description_settled(session)


def _ready_to_submit(session: Session) -> bool:
    """ข้อมูลครบพอจะสร้าง ticket หลังระบุผู้แจ้งแล้วหรือยัง"""
    return bool(session.requester_name) and _submits_after_requester(session)


def _can_skip_description(session: Session) -> bool:
    """ขั้น "รายละเอียด" ข้ามได้ไหม

    **ต้องตรงกับเงื่อนไขบังคับในตัวจัดการ ASK_DESC เป๊ะๆ** เพราะค่านี้เป็นตัวตัดสินว่าจะโชว์
    ปุ่ม "ไม่มี ส่งเลย" หรือไม่ — ปุ่มที่กดแล้วบอทถามซ้ำแย่กว่าไม่มีปุ่มเลย ผู้ใช้จะสรุปว่า
    บอทพังแล้วเลิกใช้ ไม่ใช่สรุปว่า "ต้องพิมพ์"

    - เบิก / คืน : ข้อมูลที่ช่างต้องใช้ (รายการ+จำนวน หรือรหัสทรัพย์สิน) ครบไปแล้วก่อนถึงขั้นนี้
    - แจ้งซ่อม / ขอใช้บริการ : ticket ที่ไม่มีข้อความอะไรเลยคือสิ่งที่ช่างเอาไปทำต่อไม่ได้
      จึงข้ามได้เฉพาะตอนที่ผู้ใช้เล่ามาแล้วตั้งแต่ข้อความแรก (initial_message)
    """
    if session.ticket_type not in ("repair", "it_service"):
        return True
    return bool((session.initial_message or "").strip())


def _ask_description(session: Session) -> M.Reply:
    """คำถามขั้นรายละเอียด — ผ่านทางนี้ทางเดียวเท่านั้น

    ถ้าเรียก M.ask_description() ตรงๆ จากหลายที่ จะมีวันที่บางเส้นทางลืมส่ง can_skip
    แล้วปุ่มหายไปเฉพาะบางเส้นทางโดยไม่มีใครสังเกต (เทสต์ test_flow จับไว้แล้ว)
    """
    return M.ask_description(
        session.ticket_type,
        _requester_badge(session),
        can_skip=_can_skip_description(session),
    )


async def _bound_requester(
    session: Session, user_id: str | None, backend: BackendClient
) -> dict | None:
    """ผู้แจ้งที่บัญชี LINE นี้ผูกไว้ — ถามหลังบ้านครั้งเดียวต่อ 1 บทสนทนา

    หลังบ้านล่มถือว่า "ยังไม่ผูก" แล้วถามผู้ใช้ตามปกติ ดีกว่าค้างรอ:
    การถามชื่อเกินความจำเป็น 1 ครั้งเสียเวลาผู้ใช้ไม่กี่วินาที แต่การพังทั้งบทสนทนา
    เพราะ endpoint เดียวล่มคือการทำให้แจ้งเรื่องไม่ได้เลย
    """
    if session.rq_checked or not user_id:
        return None
    session.rq_checked = True
    try:
        return await backend.get_requester(user_id)
    except BackendError:
        logger.warning("ดึงผู้แจ้งที่ผูกไว้ไม่สำเร็จ — ถามผู้ใช้ตามปกติ")
        return None


async def _requester_menu(
    session: Session, knowledge, *, level: str = "dept", page: int = 0
) -> M.Reply:
    """เมนูเลือกผู้แจ้งทีละชั้น: ฝ่าย → ชื่อ

    เป็นทางสำรองของการพิมพ์ค้นหา ไม่ใช่ทางหลัก — คนที่รู้ชื่อเล่นตัวเองพิมพ์ 2 ตัวอักษรก็จบ
    ส่วนเมนูนี้ไว้ให้คนที่ไม่แน่ใจว่าชื่อตัวเองอยู่ในระบบว่ายังไง

    ถ้าดึงทะเบียนไม่ได้ ตกกลับไปให้พิมพ์เอง — ห้ามทำให้ผู้ใช้ติดตายในเมนูที่ว่างเปล่า
    """
    if knowledge is None:
        return M.ask_requester(session.ticket_type or "repair")
    try:
        kb = await knowledge.get()
    except BackendError:
        return M.ask_requester(session.ticket_type or "repair")

    if level == "person" and session.rq_dept:
        people = kb.employees_in(session.rq_dept)
        options = [
            {"value": str(e.get("id") or ""),
             "label": f"{e.get('name')} ({e.get('nickname')})" if e.get("nickname") else str(e.get("name")),
             "sub": e.get("position"), "count": 1}
            for e in people
        ]
        if options:
            session.rq_level = "person"
            session.rq_page = page
            session.rq_values = [o["value"] for o in options]
            session.rq_labels = [o["label"] for o in options]
            return M.ask_requester_person(options, session.rq_dept, page)

    options = kb.department_options()
    if not options:
        return M.ask_requester(session.ticket_type or "repair")
    session.rq_level = "dept"
    session.rq_dept = None
    session.rq_page = page
    session.rq_values = [o["value"] for o in options]
    session.rq_labels = [o["label"] for o in options]
    return M.ask_requester_department(options, page)


async def _requester_search(
    session: Session, text: str, knowledge
) -> list[M.Reply]:
    """ผู้ใช้พิมพ์ชื่อมาตอนอยู่ขั้น "ระบุผู้แจ้ง" — ค้นทะเบียนให้

    ไม่เจอ = ไม่บังคับ ให้กด "ใช้ชื่อที่พิมพ์" แจ้งไปก่อนได้ เพราะพนักงานใหม่ที่ HR
    ยังไม่ได้เพิ่มเข้าทะเบียนก็ต้องแจ้งซ่อมได้เหมือนกัน การบังคับให้มีชื่อในทะเบียนก่อน
    เท่ากับปิดประตูใส่คนที่เพิ่งเข้างาน ซึ่งเป็นกลุ่มที่ต้องพึ่ง IT มากที่สุด
    """
    ticket_type = session.ticket_type or "repair"
    if knowledge is None:
        return []
    try:
        kb = await knowledge.get()
    except BackendError:
        return []
    if not kb.employees:
        # หลังบ้านยังไม่ส่งทะเบียนมา (เว็บรุ่นเก่า/ดึงไม่สำเร็จ) -> ถอยไปใช้ "พิมพ์ชื่อ - แผนก" แบบเดิม
        # ห้ามตอบว่า "ไม่พบในทะเบียน" เพราะไม่มีทะเบียนให้ค้นตั้งแต่แรก ผู้ใช้จะงงและติดตาย
        return []
    matches = kb.find_employees(text)
    # กดยืนยัน/เลือกชื่อแล้วบอทจะส่งเรื่องเลยไหม (การเบิกจบที่ขั้นนี้) — บอกไว้บนการ์ด
    final = _submits_after_requester(session)
    if not matches:
        # เก็บคำที่พิมพ์ไว้ เพราะปุ่ม "ใช้ชื่อที่พิมพ์" ส่งกลับมาได้แค่ชื่อ action
        # (postback ไม่ควรแบกข้อความผู้ใช้กลับไปกลับมา — ยาวเกิน 300 ไบต์ได้ง่ายมาก)
        _clear_requester_picker(session)
        session.rq_pending = {"manual": text}
        return [M.requester_not_found(text, ticket_type)]
    if len(matches) == 1:
        session.rq_pending = matches[0]
        return [M.requester_confirm(matches[0], ticket_type, final=final)]
    session.rq_level = "search"
    session.rq_values = [str(e.get("id") or "") for e in matches]
    session.rq_labels = [str(e.get("name") or "") for e in matches]
    session.rq_pending = None
    return [M.requester_choices(matches, ticket_type, final=final)]


async def _confirm_requester(
    session: Session, emp: dict, user_id: str, backend: BackendClient, store: ConversationStore
) -> list[M.Reply]:
    """ยืนยันตัวผู้แจ้งแล้ว -> ผูกกับบัญชี LINE แล้วเดินบทสนทนาต่อ (การเบิกจบที่นี่ — ส่งเรื่องเลย)

    ผูกไม่สำเร็จก็ไปต่อได้ (แค่ครั้งหน้าจะถามใหม่) — การผูกเป็นความสะดวก ไม่ใช่เงื่อนไข
    ของการแจ้งเรื่อง จึงไม่ควรมีทางที่มันทำให้แจ้งเรื่องไม่ได้

    ผูกซ้ำแม้คนนั้นจะผูกอยู่แล้ว (มาจากการ์ดยืนยันคนที่ผูกไว้) — หลังบ้านไม่เขียนอะไรถ้าไม่มีอะไรเปลี่ยน
    และถ้าระหว่างนั้นแอดมินเพิ่งแก้การผูกจากหน้าเว็บ การกด "ใช่ ฉันเอง" ของเจ้าตัวคือคำตอบล่าสุดที่ควรชนะ
    """
    _apply_requester(session, emp)
    try:
        await backend.bind_requester(user_id, session.requester_user_id or "")
    except BackendError:
        logger.warning("ผูกผู้แจ้งไม่สำเร็จ — ใช้ชื่อนี้กับเรื่องนี้ไปก่อน")

    if _ready_to_submit(session):
        return await _submit_or_retry(session, user_id, backend, store)
    replies = await _advance(session, backend, user_id=user_id)
    await store.set(user_id, session)
    return replies


async def _try_question_answer(
    text: str, user_id: str, backend: BackendClient, knowledge
) -> M.Reply | None:
    """ผู้ใช้ถามคำถามขึ้นมากลางคัน ทั้งที่บอทกำลังรอคำตอบอย่างอื่นอยู่

    คืนคำตอบถ้าตีความได้ว่าเป็นคำถามจริงๆ ไม่งั้นคืน None

    ทำไมต้องมี: คนไม่ได้คุยเป็นเส้นตรงเหมือน flowchart ถ้าระหว่างกรอกข้อมูลแล้วนึกอยากถามว่า
    "ของเหลือเท่าไหร่" ขึ้นมา แล้วบอทตอบว่า "ไม่พบสาขาที่ตรงกัน" มันคือประสบการณ์ที่แย่มาก
    """
    if knowledge is None:
        return None
    try:
        kb = await knowledge.get()
    except BackendError:
        return None

    analysis = ai_module.analyze(text, kb)

    if analysis.is_data_intent():
        try:
            return await _answer_data_question(analysis, user_id, backend)
        except BackendError:
            return None

    if analysis.faq_matches and analysis.faq_matches[0]["score"] >= FAQ_STRONG_SCORE:
        return M.faq_answer(analysis.faq_matches)

    return None


@dataclass
class Incoming:
    """เหตุการณ์ที่ normalize แล้วจาก LINE webhook (ตัดรายละเอียดของ SDK ออกไป)"""

    kind: str  # "text" | "postback" | "follow" | "image" | "unsupported"
    user_id: str
    text: str = ""
    data: dict[str, str] = field(default_factory=dict)
    display_name: str | None = None
    # kind="image": URL ของรูปหลังอัปโหลดเข้าระบบเรียบร้อยแล้ว
    # main.py เป็นคนดาวน์โหลดจาก LINE และอัปโหลดให้ก่อน เพื่อให้ไฟล์นี้ยังไม่ต้องรู้จัก LINE API
    image_url: str | None = None
    # เหตุผลที่รูปใช้ไม่ได้: "too_large" | "failed"
    image_error: str | None = None
    # ข้อมูลของ request ที่ webhook วิ่งเข้ามา — ใช้บันทึก log ตอนผู้ใช้กดเช็คสถานะ
    #
    # ⚠️ client_ip นี้คือ IP ของ "เซิร์ฟเวอร์ LINE" ไม่ใช่มือถือของพนักงาน
    # เพราะ LINE รับการกดปุ่มไว้แล้วยิง webhook มาจากเซิร์ฟเวอร์ตัวเอง มือถือผู้ใช้
    # ไม่เคยต่อมาที่เราเลย — เก็บไว้เพื่อตรวจสอบว่า webhook มาจากไหนจริงๆ เท่านั้น
    # ตัวที่ระบุ "ใครกด" ได้จริงคือ user_id ซึ่งแม่นกว่ามาก
    client_ip: str | None = None
    user_agent: str | None = None


def parse_postback(raw: str) -> dict[str, str]:
    """แปลง 'a=type&v=repair' -> {'a': 'type', 'v': 'repair'}"""
    return dict(parse_qsl(raw or "", keep_blank_values=True))


def parse_requester(raw: str) -> tuple[str, str | None]:
    """แยก 'สมชาย ใจดี - แผนกบัญชี' เป็น (ชื่อ, แผนก)

    ถ้าไม่มีตัวคั่นก็ถือว่าทั้งก้อนคือชื่อ ไม่บังคับให้ผู้ใช้ต้องพิมพ์ตามฟอร์แมตเป๊ะ
    เพราะการบังคับฟอร์แมตในแชทคือวิธีที่ดีที่สุดที่จะทำให้คนเลิกใช้
    """
    text = raw.strip()
    for sep in ("-", "–", "—", "/", "|"):
        if sep in text:
            name, dept = text.split(sep, 1)
            if name.strip():
                return name.strip(), (dept.strip() or None)
    return text, None


def _is_cancel(text: str) -> bool:
    return text.strip().lower() in M.CANCEL_WORDS


def _guess_type(text: str) -> str | None:
    lowered = text.strip().lower()
    for ticket_type, words in TYPE_KEYWORDS.items():
        if any(w in lowered for w in words):
            return ticket_type
    return None


async def _asset_picker_prompt(
    session: Session, backend: BackendClient, *, level: str = "category", page: int = 0
) -> M.Reply:
    """แสดงเมนูเลือกทรัพย์สินของชั้นที่ระบุ แล้วจำสถานะไว้ใน session

    ทำไมต้องไล่เลือกทีละชั้น (ประเภท -> ยี่ห้อ/รุ่น -> รหัส):
    แชท LINE ไม่มี dropdown จริงให้ใช้ quick reply ใส่ได้ 13 ปุ่ม carousel ใส่ได้ 12 ใบ
    แต่ข้อมูลจริงมีทรัพย์สิน 200 กว่าชิ้น การกรองทีละชั้นจึงเป็นทางเดียวที่พาคนไปถึง
    เครื่องที่ต้องการได้ในไม่กี่ปุ่ม โดยไม่ต้องให้จำรหัสเอง — ซึ่งเป็นจุดที่คนเลิกใช้บอทมากที่สุด

    เก็บ values/labels ของ "ทั้งชั้น" (ไม่ใช่เฉพาะหน้าที่แสดง) เพราะปุ่มส่งกลับมาเป็นลำดับที่
    การเปลี่ยนหน้าจึงต้องอ้างลำดับเดียวกันกับตอนกด ไม่งั้นกดหน้า 2 แล้วได้ของผิด
    """
    try:
        options = await backend.asset_options(
            level, category=session.pick_category, brand=session.pick_brand
        )
    except BackendError:
        logger.warning("ดึงตัวเลือกทรัพย์สินไม่สำเร็จ level=%s", level)
        return M.asset_picker_unavailable()

    if not options:
        # ไม่มีของให้เลือกในเงื่อนไขนี้ (เช่นระบบยังไม่ได้นำเข้าทรัพย์สิน) — ให้พิมพ์เองไปก่อน
        return M.asset_picker_unavailable()

    session.pick_level = level
    session.pick_page = page
    session.pick_values = [str(o.get("value") or "") for o in options]
    session.pick_labels = [str(o.get("label") or o.get("value") or "") for o in options]

    if level == "category":
        return M.ask_asset_category(options, page)
    if level == "brand":
        return M.ask_asset_brand(options, session.pick_category_label or "-", page)

    crumb = " · ".join(x for x in [session.pick_category_label, session.pick_brand] if x)
    return M.ask_asset_code(options, crumb or "-", page)


async def _resolve_asset_code(
    session: Session, backend: BackendClient, code: str, *,
    user_id: str | None = None, confirm: bool = True,
) -> list[M.Reply]:
    """แปลงรหัสทรัพย์สินเป็นของจริง แล้วเดินบทสนทนาต่อ

    ใช้ร่วมกันทั้งทางที่ผู้ใช้พิมพ์รหัสเองและทางที่กดเลือกจากเมนู
    จะได้ไม่มีทางที่สองทางนี้ทำงานไม่เหมือนกัน (เคยเป็นบั๊กคลาสสิกของโค้ดที่ก๊อปกันไปมา)

    confirm=False สำหรับทางที่ "ยืนยันไปแล้วด้วยข้อความอื่น" (ชั้น AI ขึ้นสรุปสิ่งที่จับได้อยู่แล้ว)
    ไม่งั้นผู้ใช้จะเห็น 2 บับเบิลพูดเรื่องเดียวกันติดกัน ซึ่งอ่านแล้วเหมือนบอทพูดซ้ำเพราะบั๊ก
    """
    try:
        matches = await backend.lookup_equipment_matches(code)
    except BackendError:
        matches = []

    if not matches:
        # เก็บรหัสดิบไว้ให้แอดมินตามต่อ แต่ห้ามผูก equipment_id กับเครื่องที่ไม่มีอยู่
        session.equipment_id = None
        return [M.asset_not_found(code)]

    # รหัสเดียวตรงหลายเครื่อง -> ถามก่อน ห้ามเดา (ดูเหตุผลที่ M.ask_which_asset)
    if len(matches) > 1:
        session.asset_choices = matches
        session.equipment_id = None
        session.step = ASK_PICK_ASSET
        return [M.ask_which_asset(matches)]

    equipment = matches[0]
    session.asset_code = equipment["asset_code"]
    session.asset_label = M.asset_label(equipment)
    session.equipment_id = equipment.get("id")
    session.asset_choices = []
    _clear_picker(session)
    replies = [M.asset_confirmed(session.asset_label)] if confirm else []
    replies += await _after_asset_step(session, backend, user_id=user_id)
    return replies


def _to_int(raw: str | None) -> int | None:
    """แปลงค่าจาก postback เป็นตัวเลข — ค่าที่มาจากปุ่มเก่า/ถูกแก้มืออาจไม่ใช่ตัวเลข"""
    try:
        return int(str(raw))
    except (TypeError, ValueError):
        return None


def _clear_picker(session: Session) -> None:
    session.pick_level = None
    session.pick_category = None
    session.pick_category_label = None
    session.pick_brand = None
    session.pick_page = 0
    session.pick_values = []
    session.pick_labels = []


async def _after_asset_step(
    session: Session, backend: BackendClient, *, user_id: str | None = None
) -> list[M.Reply]:
    """ผ่านขั้นตอนถามรหัสทรัพย์สินไปแล้ว — ให้ _advance ตัดสินใจว่าจะถามอะไรต่อ

    เดิมฟังก์ชันนี้กระโดดไปถาม "เลือกอุปกรณ์" ทันทีเมื่อเป็นการเบิก ซึ่งผิดเมื่อชั้น AI
    จับรายการของมาจากประโยคแรกได้แล้ว (บอทจะถามซ้ำในสิ่งที่ผู้ใช้บอกไปแล้ว)
    จึงรวมการตัดสินใจไว้ที่ _advance ที่เดียว
    """
    session.asset_asked = True
    return await _advance(session, backend, user_id=user_id)


async def _items_done(
    session: Session, user_id: str, backend: BackendClient, store: ConversationStore,
) -> list[M.Reply]:
    """เลือกของที่จะเบิกครบแล้ว — ไปขั้นผู้เบิก ซึ่งเป็นขั้นสุดท้ายของการเบิก

    เดิมทั้งปุ่ม "พอแล้ว" และทางเบิกชิ้นเดียวกระโดดไปถาม "ผู้เบิกคือใคร" ตรงๆ ไม่ผ่าน _advance
    บัญชีที่เคยระบุตัวแล้วจึงถูกถามชื่อซ้ำทุกครั้งที่เบิก ทั้งที่ข้อความของขั้นนั้นเองสัญญาว่า
    "ถามครั้งเดียว ครั้งต่อไปไม่ต้องพิมพ์อีก" — ให้ _advance ตัดสินที่เดียวเหมือนประเภทอื่น
    """
    if _ready_to_submit(session):
        # ระบุผู้เบิกไว้แล้วตั้งแต่ก่อนเลือกของ (เช่นกดการ์ดเก่า) — ไม่มีอะไรต้องถามอีกแล้ว
        return await _submit_or_retry(session, user_id, backend, store)
    replies = await _advance(session, backend, user_id=user_id)
    await store.set(user_id, session)
    return replies


async def _advance(
    session: Session, backend: BackendClient, *, user_id: str | None = None
) -> list[M.Reply]:
    """หาช่องข้อมูลแรกที่ยังว่าง แล้วถามเฉพาะอันนั้น

    ใช้กับเส้นทางที่ AI เติมข้อมูลให้ล่วงหน้าจากประโยคเดียว — ถ้าผู้ใช้บอกสาขากับประเภท
    มาแล้วในประโยคแรก บอทต้องไม่ถามซ้ำ ไม่อย่างนั้น "ฉลาดขึ้น" จะกลายเป็นน่ารำคาญขึ้น
    """
    if not session.branch:
        session.step = ASK_BRANCH
        return [await _branch_prompt(backend, session=session)]

    if not session.ticket_type:
        session.step = ASK_TYPE
        return [M.ask_type(session.branch)]

    if session.ticket_type == "it_service" and not session.description:
        session.step = ASK_DESC
        return [_ask_description(session)]

    if session.ticket_type != "it_service" and not session.asset_asked and not session.asset_code:
        session.asset_asked = True
        session.step = ASK_ASSET
        return [await _asset_picker_prompt(session, backend)]

    if session.ticket_type == "withdraw" and not session.items:
        session.step = ASK_ITEM
        # เดิมไม่มี try/except ตรงนี้ตัวเดียวในบรรดาจุดที่เรียก backend ทั้งไฟล์ — ถ้า backend
        # ล่มชั่วคราว exception จะหลุดขึ้นไปโดน handler กลางใน main.py ดักเงียบๆ ผู้ใช้ไม่ได้รับ
        # คำตอบใดๆ เลยแม้แต่ข้อความ error (เจอจริงตอนไล่บั๊ก E2E วันที่ 2026-09-14 ก่อนจะพบว่า
        # ต้นเหตุจริงคือ backend 401/404 ไม่ใช่ตรงนี้ — แต่จุดนี้ก็ควรกันไว้เผื่อ backend ล่มจริงๆ ด้วย)
        try:
            items = await backend.list_stock_items()
        except BackendError:
            return [M.backend_error()]
        return [M.ask_item(items)]

    if not session.requester_name:
        # เคยบอกไปแล้วว่าเป็นใครในครั้งก่อนๆ -> ไม่ถามซ้ำ นี่คือขั้นตอนที่เสียเวลาผู้ใช้มากที่สุด
        # เพราะต้องพิมพ์ชื่อ-นามสกุล-แผนกใหม่ทุกครั้งที่แจ้ง ทั้งที่เป็นข้อมูลที่ไม่เคยเปลี่ยน
        bound = await _bound_requester(session, user_id, backend)
        if bound and _ends_at_requester(session):
            # เบิกจบที่ขั้นนี้ จึง "เติมให้เงียบๆ แล้วส่ง" ไม่ได้ — ประเภทอื่นเห็นชื่อพร้อมปุ่ม
            # "เปลี่ยนคนแจ้ง" ที่ขั้นรายละเอียด แต่การเบิกไม่มีขั้นนั้นแล้ว ถ้าส่งเลย บัญชีที่ถูกผูกผิดคน
            # จะเบิกของในชื่อคนอื่นไปเรื่อยๆ โดยไม่มีใครเห็นและไม่มีทางแก้เองในแชท
            # การ์ดนี้ใช้ 1 การกด เท่ากับที่เคยต้องกด "ไม่มี ส่งเลย" ที่ขั้นรายละเอียด
            _clear_requester_picker(session)
            session.rq_pending = bound
            session.step = ASK_REQUESTER
            return [M.requester_confirm(
                bound, session.ticket_type, bound=True, final=_submits_after_requester(session),
            )]
        if bound:
            _apply_requester(session, bound)
        else:
            session.step = ASK_REQUESTER
            return [M.ask_requester(session.ticket_type or "repair")]

    # การเบิกที่มาถึงบรรทัดนี้คือข้อมูลครบแล้วรวมถึงผู้เบิก — ทุกจุดที่ระบุผู้เบิกหรือเลือกของเสร็จ
    # เช็ค _ready_to_submit แล้วส่งเองก่อนจะถึง _advance (ฟังก์ชันนี้ส่งเรื่องเองไม่ได้เพราะไม่ได้ถือ store)
    # จึงเกิดได้แค่จากการ์ดเก่าหรือลำดับการกดที่ผิดปกติ — ปล่อยให้ตกไปขั้นรายละเอียดเหมือนเดิม
    # ซึ่งจบได้ด้วย "ไม่มี ส่งเลย" 1 การกด ดีกว่าวางทางออกใหม่ที่ไม่เคยเจอของจริง
    session.step = ASK_DESC
    return [_ask_description(session)]


async def _prompt_for_step(session: Session, backend: BackendClient) -> M.Reply | None:
    """ข้อความถามของ "สถานะปัจจุบัน" โดยไม่ขยับ state

    ต่างจาก _advance ตรงที่ _advance จะเลื่อน step ไปข้างหน้า ส่วนอันนี้แค่ถามซ้ำที่เดิม
    ใช้ตอนที่มีอย่างอื่นแทรกกลางบทสนทนา (เช่นผู้ใช้ส่งรูปมา) แล้วต้องพาผู้ใช้กลับเข้าเส้นทางเดิม
    ถ้าไม่ถามซ้ำ ผู้ใช้จะค้างว่า "แล้วต้องทำอะไรต่อ" เพราะคำถามเดิมเลื่อนหายขึ้นไปแล้ว
    """
    step = session.step

    if step == FIND_ASSET:
        return M.ASK_FIND_ASSET

    if step == ASK_BRANCH:
        # กลับเข้าเมนูชั้นเดิมที่ค้างไว้ ไม่ใช่เริ่มใหม่จากชั้นแรก
        return await _branch_prompt(
            backend, session=session, level=session.pick_level or "company", page=session.pick_page
        )
    if step == ASK_TYPE:
        return M.ask_type(session.branch or "-")
    if step == ASK_ASSET:
        # กลับเข้าเมนูชั้นเดิมที่ค้างไว้ ไม่ใช่เริ่มใหม่จากชั้นแรก
        return await _asset_picker_prompt(
            session, backend, level=session.pick_level or "category", page=session.pick_page
        )
    if step == ASK_PICK_ASSET and session.asset_choices:
        return M.ask_which_asset(session.asset_choices)
    if step == ASK_ITEM:
        try:
            return M.ask_item(await backend.list_stock_items())
        except BackendError:
            return None
    if step == ASK_ITEM_NAME:
        return M.ASK_ITEM_NAME
    if step == ASK_QTY and session.pending_item_name:
        return M.ask_qty(session.pending_item_name, session.pending_item_unit)
    if step == ASK_MORE_ITEMS:
        return M.ask_more_items(session.items)
    if step == ASK_REQUESTER:
        return M.ask_requester(session.ticket_type or "repair")
    if step == RETRY_SUBMIT and _ends_at_requester(session):
        # การเบิกไม่มีขั้นรายละเอียดแล้ว — ส่งไม่สำเร็จแล้วส่งรูปมา ต้องชวนกดส่งใหม่
        # ไม่ใช่เด้งคำถาม "มีรายละเอียดเพิ่มเติมไหม" ที่ผู้ใช้ไม่เคยเห็นในเส้นทางนี้ขึ้นมาเฉยๆ
        return _retry_prompt()
    if step in (ASK_DESC, RETRY_SUBMIT):
        return _ask_description(session)
    return None


async def _handle_image(
    incoming: Incoming,
    store: ConversationStore,
    backend: BackendClient,
    *,
    max_images: int,
    max_image_mb: int,
) -> list[M.Reply]:
    """ผู้ใช้ส่งรูปเข้ามา (ส่วนใหญ่คือภาพหน้าจอที่ error หรือรูปอุปกรณ์ที่พัง)

    ของเดิมบอทตัดรูปทิ้งเงียบๆ ตั้งแต่ main.py — คนส่งรูปมาแล้วไม่มีอะไรตอบกลับเลย
    ซึ่งเป็นพฤติกรรมแรกๆ ที่คนทำเวลาเจอปัญหา IT ("ถ่ายจอส่งให้ดู")
    """
    user_id = incoming.user_id

    if incoming.image_error == "too_large":
        return [M.image_too_large(max_image_mb)]
    if incoming.image_error or not incoming.image_url:
        return [M.image_failed()]

    session = await store.get(user_id)

    # ยังไม่ได้เริ่มแจ้งเรื่อง -> เก็บรูปไว้แล้วเปิด flow ให้เลย ไม่ต้องให้ส่งรูปซ้ำรอบสอง
    if session is None or session.step == IDLE:
        fresh = Session(
            step=ASK_BRANCH,
            line_display_name=incoming.display_name,
            image_urls=[incoming.image_url],
        )
        await store.set(user_id, fresh)
        return [M.image_saved_and_start()]

    if len(session.image_urls) >= max_images:
        return [M.image_too_many(max_images)]

    session.image_urls.append(incoming.image_url)
    await store.set(user_id, session)

    replies = [M.image_saved(len(session.image_urls))]
    prompt = await _prompt_for_step(session, backend)
    if prompt is not None:
        replies.append(prompt)
    return replies


async def _submit(session: Session, user_id: str, backend: BackendClient) -> list[M.Reply]:
    """ยิงสร้าง ticket จริงไปที่ระบบ admin แล้วสรุปผลกลับไปหาผู้ใช้"""
    payload = {
        # หลังบ้านใช้คู่ (request_id, line_user_id) กันการสร้าง ticket ซ้ำ
        # ถ้าไม่ส่งมา การกด "ลองส่งใหม่" หลัง timeout จะได้ ticket ใบที่ 2 และตัดสต็อกซ้ำ
        "request_id": session.request_id,
        "initial_message": session.initial_message,
        # ผูกกับเครื่องที่ผู้ใช้เลือกไว้จริง ไม่ให้หลังบ้านเดาจากรหัสที่ซ้ำกันได้
        "equipment_id": session.equipment_id,
        "type": session.ticket_type,
        "location": session.branch or "",
        "description": session.description or "",
        "requester_name": session.requester_name or "",
        "requester_department": session.requester_department,
        # ผูกกับแถวเดิมของคนนั้นในระบบแอดมิน ไม่ให้หลังบ้านต้องเดาจากชื่อ
        "requester_user_id": session.requester_user_id,
        "asset_code": session.asset_code,
        "items": session.items,
        "line_user_id": user_id,
        "line_display_name": session.line_display_name,
        "image_urls": session.image_urls,
    }
    result = await backend.create_ticket(payload)
    return [
        M.ticket_created(
            ticket_code=result["ticket_code"],
            branch=session.branch or "-",
            ticket_type=session.ticket_type or "repair",
            requester_name=session.requester_name or "-",
            asset_label=session.asset_label,
            items=session.items,
            image_count=len(session.image_urls),
            description=session.description,
        )
    ]


def _retry_prompt() -> M.Reply:
    """ข้อความ "ส่งไม่สำเร็จ" พร้อมปุ่มลองส่งใหม่ — ใช้ทั้งตอนเพิ่งล้มและตอนต้องถามซ้ำ"""
    error = M.backend_error()
    error.quick = [("🔁 ลองส่งใหม่", "a=retry_submit"), ("❌ ยกเลิก", "a=cancel")]
    return error


async def _submit_or_retry(
    session: Session, user_id: str, backend: BackendClient, store: ConversationStore,
) -> list[M.Reply]:
    try:
        replies = await _submit(session, user_id, backend)
    except BackendError:
        session.step = RETRY_SUBMIT
        await store.set(user_id, session)
        return [_retry_prompt()]
    await store.clear(user_id)
    return replies


async def _handle_idle_text(
    text: str,
    incoming: Incoming,
    store: ConversationStore,
    backend: BackendClient,
    *,
    knowledge=None,
    llm=None,
) -> list[M.Reply] | None:
    """จัดการข้อความที่พิมพ์เข้ามาตอนยังไม่ได้เริ่มแจ้งเรื่อง

    คืน None = วิเคราะห์ไม่ได้/ไม่มีชั้น AI ให้ผู้เรียกไปใช้พฤติกรรมสำรอง (ถือว่าเป็นชื่อสาขา)
    """
    user_id = incoming.user_id

    # ไม่มีชั้น AI (เช่นในเทสต์ที่ไม่ได้ใส่มา) -> ใช้การค้น FAQ แบบเดิมของหลังบ้าน
    if knowledge is None:
        try:
            matches = await backend.search_faq(text)
        except BackendError:
            matches = []
        return [M.faq_answer(matches)] if matches else None

    kb = await knowledge.get()
    analysis = ai_module.analyze(text, kb)

    # 1) ถามหา "ข้อมูลจริง" ในระบบ -> ดึงมาตอบตรงๆ ไม่ต้องให้ไปเปิดหน้าเว็บดูเอง
    if analysis.is_data_intent():
        try:
            data_reply = await _answer_data_question(analysis, incoming.user_id, backend)
        except BackendError:
            data_reply = None
        if data_reply is not None:
            return [data_reply]

    # 2) ถามคำถามทั่วไป -> ตอบจาก FAQ ที่มีอยู่ในระบบ
    if analysis.intent == "faq" and analysis.faq_matches:
        if llm is not None:
            composed = await llm(text, analysis.faq_matches)
            if composed:
                return [M.faq_answer_text(composed)]
        return [M.faq_answer(analysis.faq_matches)]

    # 3) จะแจ้งเรื่อง แต่ระบบมี FAQ ที่ตรงมาก -> เสนอวิธีแก้ก่อน แล้วให้เลือกเองว่าจะแจ้งต่อไหม
    #    (ถ้า FAQ ไม่ตรงพอ เช่น "คีย์บอร์ดเสีย" ที่ได้คะแนน 0.00 จะข้ามเงื่อนไขนี้ไปเปิด flow ตามปกติ)
    if (
        analysis.is_ticket_intent()
        and analysis.faq_matches
        and analysis.faq_matches[0]["score"] >= FAQ_STRONG_SCORE
    ):
        return [M.faq_answer_with_ticket_option(analysis.faq_matches)]

    # 4) สื่อชัดว่าจะแจ้งเรื่อง -> เปิด flow พร้อมเติมข้อมูลที่จับได้จากประโยคเดียว
    if analysis.is_ticket_intent():
        session = Session(
            ticket_type=analysis.intent,
            branch=analysis.branch,
            line_display_name=incoming.display_name,
            # ประโยคที่ผู้ใช้พิมพ์มาเองมีบริบทครบที่สุด เก็บไว้ทั้งดุ้นแล้วส่งไปกับ ticket
            # ไม่งั้นข้อมูลที่ดีที่สุดที่เคยมีจะหายไปตั้งแต่ข้อความแรก เหลือแค่ค่าที่ AI แกะได้
            initial_message=text,
        )
        if analysis.item_name:
            # ถ้าไม่ได้บอกจำนวนมา ให้ถือว่า 1 ชิ้น (ค่าที่คนคาดหวังที่สุด)
            session.items = [{"name": analysis.item_name, "qty": analysis.quantity or 1}]

        replies: list[M.Reply] = []
        tail: list[M.Reply] = []

        if analysis.asset_code:
            # ผูกเครื่องผ่านตัวเดียวกับทางอื่นทั้งหมด (พิมพ์รหัสเอง / ไล่เมนู)
            #
            # เดิมทางนี้ตั้ง asset_code กับ asset_label เองจาก cache แล้วเดินต่อเลย ซึ่งข้าม
            # การถาม "เครื่องไหน" ตอนรหัสซ้ำไปเงียบๆ — ข้อมูลจริงมีรหัสซ้ำอยู่ 28 แถว
            # แปลว่าคนที่พิมพ์รหัสมาในประโยคแรกมีโอกาสได้ ticket ที่ผูกผิดเครื่อง/ผิดสาขา
            # ทั้งที่คนที่พิมพ์รหัสทีหลังถูกถามให้เลือก
            session.asset_asked = True
            tail = await _resolve_asset_code(
                session, backend, analysis.asset_code, user_id=user_id, confirm=False
            )
            if not session.asset_code and session.step != ASK_PICK_ASSET:
                # รหัสที่ AI จับได้ไม่มีในระบบแล้ว (cache เก่ากว่าของจริง) — ไม่ต้องทักเรื่องรหัส
                # เพราะผู้ใช้ยังไม่ทันถูกถามเรื่องนี้เลย พาเดินตามลำดับปกติดีกว่า
                session.asset_asked = False
                tail = await _advance(session, backend, user_id=user_id)
        else:
            tail = await _advance(session, backend, user_id=user_id)

        slots = analysis.filled_slots()
        if session.asset_label:
            # แทนรหัสดิบด้วยฉลากที่ผูกกับเครื่องจริงแล้ว (มียี่ห้อ/รุ่นต่อท้าย)
            # ผู้ใช้จึงตรวจได้ตั้งแต่บับเบิลแรกว่าบอทหยิบถูกเครื่อง โดยไม่ต้องมีบับเบิลยืนยันแยก
            slots = [
                f"ทรัพย์สิน: {session.asset_label}" if p.startswith("ทรัพย์สิน:") else p
                for p in slots
            ]
        if slots:
            replies.append(M.understood(slots))
        replies += tail
        await store.set(incoming.user_id, session)
        return replies

    # 5) เดา intent ไม่ออก แต่มี FAQ ใกล้เคียง -> ตอบ FAQ ไปก่อน
    if analysis.faq_matches:
        return [M.faq_answer(analysis.faq_matches)]

    return None


async def _answer_data_question(analysis, user_id: str, backend: BackendClient):
    """ตอบคำถามที่ต้องไปดึงข้อมูลจริงจากระบบ admin มาแสดง

    ทุกคำตอบมาจากฐานข้อมูลของโปรเจกต์ล้วนๆ ไม่มีการแต่งตัวเลขขึ้นเอง
    ถ้าหาไม่เจอจะบอกว่าไม่เจอ ไม่เดาให้
    """
    if analysis.intent == "stock_query":
        # สำคัญ: ต้องอ่านยอดคงเหลือ "สด" จากหลังบ้าน ห้ามใช้ตัวเลขจาก knowledge cache
        # เพราะ cache มีอายุถึง 5 นาที ถ้ามีคนเบิกไประหว่างนั้น บอทจะตอบตัวเลขที่ผิด
        # ซึ่งแย่กว่าไม่ตอบเลย (คนไปถึงคลังแล้วไม่มีของ) — cache ใช้ได้แค่ตอน "ตีความ" ว่าถามถึงของชิ้นไหน
        live_items = await backend.list_stock_items()
        if analysis.stock_matches:
            wanted = {s["name"] for s in analysis.stock_matches}
            items = [s for s in live_items if s["name"] in wanted]
        else:
            items = sorted(live_items, key=lambda s: s.get("quantity_available", 0))[:5]
        return M.stock_answer(items) if items else None

    if analysis.intent == "asset_query" and analysis.asset_code:
        matches = await backend.lookup_equipment_matches(analysis.asset_code)
        if not matches:
            return None
        # รหัสซ้ำ -> ต้องบอกให้ครบทุกเครื่อง ไม่ใช่ตอบเครื่องแรกแล้วจบ
        return M.asset_answer(matches[0]) if len(matches) == 1 else M.asset_answer_multi(matches)

    if analysis.intent == "ticket_query" and analysis.ticket_code:
        ticket = await backend.get_ticket(analysis.ticket_code)
        return M.ticket_answer(ticket) if ticket else M.ticket_not_found(analysis.ticket_code)

    if analysis.intent == "my_tickets_query":
        return M.my_tickets_answer(await backend.list_my_tickets(user_id))

    return None


async def handle(
    incoming: Incoming,
    store: ConversationStore,
    backend: BackendClient,
    *,
    allow_multi_item: bool = True,
    knowledge=None,
    llm=None,
    max_images: int = 5,
    max_image_mb: int = 10,
) -> list[M.Reply]:
    """ประมวลผล 1 เหตุการณ์ แล้วคืนข้อความที่จะตอบกลับ (สูงสุด 5 บับเบิลตามลิมิตของ LINE)

    knowledge : KnowledgeCache สำหรับชั้น AI (ถ้าไม่ใส่ บอทจะทำงานแบบ keyword ล้วน)
    llm       : async callable (question, faq_matches) -> str | None สำหรับเรียบเรียงคำตอบ
    """

    user_id = incoming.user_id

    # ---------- follow: มีคนกดเพิ่มเพื่อน ----------
    if incoming.kind == "follow":
        await store.clear(user_id)
        return [M.welcome(incoming.display_name)]

    # ---------- image: ผู้ใช้ส่งรูป ----------
    if incoming.kind == "image":
        return await _handle_image(
            incoming, store, backend, max_images=max_images, max_image_mb=max_image_mb
        )

    # ---------- สติกเกอร์ / วิดีโอ / ไฟล์ / เสียง ----------
    if incoming.kind == "unsupported":
        return [M.unsupported_message()]

    session = await store.get(user_id)

    # ---------- postback: ผู้ใช้กดปุ่ม ----------
    # Continue service requests that were left on the old asset picker before deployment.
    if session and session.ticket_type == "it_service" and session.step in (ASK_ASSET, ASK_PICK_ASSET):
        session.step = ASK_DESC
        _clear_picker(session)
        await store.set(user_id, session)
        if incoming.kind == "postback" and incoming.data.get("a") in (
            "pk_cat", "pk_brand", "pk_code", "pk_page", "pk_back", "asset_manual", "skip_asset", "pick_asset",
        ):
            return [_ask_description(session)]

    if incoming.kind == "postback":
        action = incoming.data.get("a", "")
        # Flex confirmation cards use a=confirm&v=1/0; retain older card actions too.
        if action == "confirm" and incoming.data.get("v") in ("1", "0"):
            action = "confirm_done" if incoming.data["v"] == "1" else "still_broken"

        if action == "cancel":
            await store.clear(user_id)
            return [M.cancelled()]

        if action == "start":
            fresh = Session(step=ASK_BRANCH, line_display_name=incoming.display_name)
            # ต้องสร้างการ์ดก่อนแล้วค่อยเซฟ เพราะ _branch_prompt เขียนรายการตัวเลือก
            # (pick_values/pick_labels) ลง session — ปุ่มส่งกลับมาแค่ "ลำดับที่" ไม่ใช่ค่าจริง
            # เซฟก่อนแล้วค่อยสร้างการ์ดเมื่อไหร่ ปุ่มจะกดไม่ติดทันที
            reply = await _branch_prompt(backend, knowledge, session=fresh)
            await store.set(user_id, fresh)
            return [reply]

        if action == "faq_menu":
            await store.clear(user_id)
            return [M.FAQ_PROMPT]

        # ---------- ผู้แจ้งยืนยันผลการแก้ไข (ปุ่มที่แนบมากับข้อความ "แก้ไขแล้ว") ----------
        #
        # ยอมรับได้แม้ session หมดอายุ — ข้อความแจ้งเตือนนี้เด้งมาตอนผู้ใช้ไม่ได้เปิดแชทอยู่
        # กว่าจะมากดอาจผ่านไปหลายชั่วโมง ถ้าตอบ "หมดเวลา" คือปุ่มนี้แทบไม่มีวันใช้ได้เลย
        if action in ("confirm_done", "still_broken"):
            code = incoming.data.get("code", "").strip()
            if not code:
                return [M.menu()]
            try:
                result = await backend.confirm_ticket(
                    ticket_code=code,
                    line_user_id=user_id,
                    action="confirm" if action == "confirm_done" else "reject",
                    viewer_name=incoming.display_name or "",
                )
            except BackendError:
                return [M.backend_error()]

            if not result.get("ok"):
                if result.get("reason") == "not_owner":
                    return [M.confirm_not_owner()]
                if result.get("reason") == "not_resolved":
                    return [
                        M.confirm_not_resolved(
                            code, M.TICKET_STATUS_LABEL.get(result.get("status", ""), "-")
                        )
                    ]
                return [M.backend_error()]

            if action == "confirm_done":
                return [M.confirm_done_thanks(code)]
            return [M.still_broken_ack(code)]

        if action == "ticket":
            # ปุ่ม "เช็คสถานะเรื่องนี้" บนการ์ดตอนรับเรื่อง
            #
            # เดิมไม่มี handler ของ action นี้เลย ทั้งที่ flex.py สร้างปุ่มไว้ตั้งแต่ต้น
            # กดแล้วจึงตกไปท้ายบล็อกได้เมนูเปล่าๆ หรือถ้า session หมดอายุก็ได้ "หมดเวลา"
            # ซึ่งจากมุมผู้ใช้คือ "ปุ่มเสีย" — และเป็นปุ่มที่เด่นที่สุดบนการ์ดด้วย
            code = incoming.data.get("code", "").strip()
            if not code:
                return [M.menu()]
            try:
                ticket = await backend.get_ticket(code)
            except BackendError:
                return [M.backend_error()]
            if not ticket:
                return [M.ticket_not_found(code)]

            # บันทึก log ว่ามีคนเปิดดู — ห้ามทำให้ผู้ใช้ไม่ได้คำตอบถ้าขั้นนี้พัง
            # (log เป็นเรื่องของทีม IT ส่วนคำตอบเป็นเรื่องของคนที่กด ความสำคัญคนละระดับ)
            views = None
            try:
                views = await backend.record_ticket_view(
                    ticket_code=ticket.get("ticket_code") or code,
                    line_user_id=user_id,
                    viewer_name=incoming.display_name or ticket.get("requester_name") or "",
                    ip=incoming.client_ip,
                    user_agent=incoming.user_agent,
                )
            except BackendError:
                logger.warning("บันทึก log การเปิดดู ticket ไม่สำเร็จ code=%s", code)

            return [M.ticket_answer(ticket, views=views)]

        if action == "my_assets":
            # ทรัพย์สินที่ผู้ใช้ถือครองอยู่ — ไม่ต้องมี session ดูได้ตลอดเวลา
            try:
                data = await backend.list_my_assets(user_id)
            except BackendError:
                return [M.backend_error()]
            return [M.my_assets_answer(data)]

        if action == "find_asset":
            # เปิดโหมดค้นหารหัส — แยกจากขั้นตอนแจ้งเรื่อง เพราะแค่อยากดูข้อมูล ไม่ได้จะเปิดงาน
            await store.set(user_id, Session(step=FIND_ASSET, line_display_name=incoming.display_name))
            return [M.ASK_FIND_ASSET]

        # ---------- เมนูเลือกสาขาทีละชั้น (บริษัท → กลุ่ม → สาขา) ----------
        #
        # ยอมรับได้แม้ session หมดอายุ เหมือนปุ่มสาขาเดิม — คนกดปุ่มจากการ์ดเก่าที่ค้างบนจอ
        # เป็นเรื่องปกติมาก ถ้าตอบ "หมดเวลา" ตรงนี้คือทำให้เริ่มใหม่ทั้งที่เพิ่งกดไปหนึ่งที
        if action in ("bk_co", "bk_grp", "bk_branch", "bk_page", "bk_back", "bk_co_named"):
            if session is None:
                session = Session(line_display_name=incoming.display_name)

            if action == "bk_page":
                page = _to_int(incoming.data.get("p")) or 0
                reply = await _branch_prompt(
                    backend, knowledge, session=session,
                    level=session.pick_level or "company", page=max(0, page),
                )
                await store.set(user_id, session)
                return [reply]

            if action == "bk_back":
                to = incoming.data.get("to", "company")
                if to == "company":
                    session.pick_company = None
                    session.pick_company_label = None
                session.pick_group = None
                session.pick_group_label = None
                reply = await _branch_prompt(
                    backend, knowledge, session=session,
                    level="company" if to == "company" else "group",
                )
                await store.set(user_id, session)
                return [reply]

            if action == "bk_co_named":
                # มาจากปุ่มตอนสาขาชื่อซ้ำข้ามบริษัท — ส่งชื่อบริษัทมาตรงๆ ไม่ใช่ลำดับที่
                label = incoming.data.get("v", "").strip()
                pending = session.pick_group_label  # เก็บชื่อสาขาที่ค้างไว้ตอนถาม
                session.pick_company_label = label
                session.pick_group_label = None
                if pending:
                    session.branch = pending
                    replies = await _advance(session, backend, user_id=user_id)
                    await store.set(user_id, session)
                    return replies
                reply = await _branch_prompt(backend, knowledge, session=session)
                await store.set(user_id, session)
                return [reply]

            idx = _to_int(incoming.data.get("i"))
            value = (
                session.pick_values[idx]
                if idx is not None and 0 <= idx < len(session.pick_values)
                else None
            )
            label = (
                session.pick_labels[idx]
                if idx is not None and 0 <= idx < len(session.pick_labels)
                else value
            )
            if value is None:
                # การ์ดเก่าที่ลำดับไม่ตรงกับ session แล้ว — เริ่มเลือกใหม่ ดีกว่าได้สาขาผิด
                _clear_branch_picker(session)
                reply = await _branch_prompt(backend, knowledge, session=session)
                await store.set(user_id, session)
                return [reply]

            if action in ("bk_co", "bk_grp"):
                if action == "bk_co":
                    session.pick_company = value
                    session.pick_company_label = label
                    session.pick_group = None
                    session.pick_group_label = None
                else:
                    session.pick_group = value
                    session.pick_group_label = label
                # Clear old indices before fetching, including on backend errors.
                session.pick_values = []
                session.pick_labels = []
                reply = await _branch_prompt(
                    backend, knowledge, session=session,
                    level="group" if action == "bk_co" else "branch",
                )
                if session.pick_company == "central" and len(session.pick_values) == 1:
                    session.branch = session.pick_values[0]
                    replies = await _advance(session, backend, user_id=user_id)
                    await store.set(user_id, session)
                    return replies
                await store.set(user_id, session)
                return [reply]

            # bk_branch — เลือกสาขาเสร็จแล้ว เดินบทสนทนาต่อ
            session.branch = value
            replies = await _advance(session, backend, user_id=user_id)
            await store.set(user_id, session)
            return replies

        if action == "branch":
            # กดปุ่มเลือกสาขา — ยอมรับได้แม้ session หมดอายุไปแล้ว
            # (ผู้ใช้กดปุ่มจากข้อความเก่าที่ค้างอยู่บนจอ ไม่ควรเจอ "หมดเวลา" แล้วต้องเริ่มใหม่)
            chosen = incoming.data.get("v", "").strip()
            if not chosen:
                return [await _branch_prompt(backend, knowledge, session=session)]
            if session is None:
                session = Session(line_display_name=incoming.display_name)
            session.branch = chosen
            replies = await _advance(session, backend, user_id=user_id)
            await store.set(user_id, session)
            return replies

        # ปุ่มที่เหลือต้องมี session อยู่ ถ้าหมดอายุไปแล้วให้บอกตรงๆ ดีกว่าทำเงียบๆ แล้วพัง
        if session is None:
            return [M.session_expired()]

        # ---------- ระบุ/เปลี่ยนผู้แจ้ง ----------
        if action in ("rq_menu", "rq_dept", "rq_pick", "rq_page", "rq_again",
                      "rq_yes", "rq_manual", "rq_change"):
            if action in ("rq_change", "rq_again"):
                if action == "rq_change":
                    # ถอดการผูกออกจริงๆ ไม่ใช่แค่ล้างใน session — ไม่งั้นครั้งหน้าบอทจะเติม
                    # ชื่อเดิมกลับมาอีก ทั้งที่ผู้ใช้เพิ่งบอกไปว่าไม่ใช่คนนั้น
                    await backend.unbind_requester(user_id)
                    session.requester_user_id = None
                    session.requester_name = None
                    session.requester_department = None
                    session.rq_checked = True
                _clear_requester_picker(session)
                session.step = ASK_REQUESTER
                await store.set(user_id, session)
                return [M.ask_requester(session.ticket_type or "repair")]

            if action in ("rq_menu", "rq_page", "rq_dept") and not M.REQUESTER_PICKER_ENABLED:
                # เมนูเลือกผู้แจ้งถูกปิดไว้ (ดู M.REQUESTER_PICKER_ENABLED) แต่การ์ดที่ส่งไปแล้ว
                # ยังค้างอยู่ในห้องแชทของผู้ใช้ตลอดไป ลบออกไม่ได้ — คนที่เลื่อนขึ้นไปกดของเก่า
                # ต้องได้หน้าพิมพ์ชื่อ ไม่ใช่ปุ่มที่กดแล้วเงียบ ซึ่งอ่านได้อย่างเดียวว่า "บอทเสีย"
                _clear_requester_picker(session)
                session.step = ASK_REQUESTER
                await store.set(user_id, session)
                return [M.ask_requester(session.ticket_type or "repair")]

            if action in ("rq_menu", "rq_page"):
                level = "dept" if action == "rq_menu" else (session.rq_level or "dept")
                page = 0 if action == "rq_menu" else max(0, _to_int(incoming.data.get("p")) or 0)
                session.step = ASK_REQUESTER
                reply = await _requester_menu(session, knowledge, level=level, page=page)
                await store.set(user_id, session)
                return [reply]

            if action == "rq_dept":
                idx = _to_int(incoming.data.get("i"))
                value = (
                    session.rq_values[idx]
                    if idx is not None and 0 <= idx < len(session.rq_values)
                    else None
                )
                if value is None:
                    # กดจากการ์ดเก่าที่ตัวเลือกไม่ตรงกับ session แล้ว — เริ่มเลือกใหม่ดีกว่าเดาให้ผิดฝ่าย
                    reply = await _requester_menu(session, knowledge, level="dept")
                else:
                    session.rq_dept = value
                    reply = await _requester_menu(session, knowledge, level="person")
                await store.set(user_id, session)
                return [reply]

            if action == "rq_manual":
                typed = str((session.rq_pending or {}).get("manual") or "").strip()
                if not typed:
                    session.step = ASK_REQUESTER
                    await store.set(user_id, session)
                    return [M.ask_requester(session.ticket_type or "repair")]
                name, department = parse_requester(typed)
                session.requester_user_id = None
                session.requester_name = name
                session.requester_department = department
                _clear_requester_picker(session)
                if _ready_to_submit(session):
                    return await _submit_or_retry(session, user_id, backend, store)
                replies = await _advance(session, backend, user_id=user_id)
                await store.set(user_id, session)
                return replies

            if action == "rq_yes":
                emp = session.rq_pending if isinstance(session.rq_pending, dict) else None
                if not emp or not emp.get("id"):
                    session.step = ASK_REQUESTER
                    await store.set(user_id, session)
                    return [M.ask_requester(session.ticket_type or "repair")]
                return await _confirm_requester(session, emp, user_id, backend, store)

            # rq_pick — เลือกคนเองจากผลค้นหา/เมนูฝ่าย จึงไม่ต้องให้ยืนยันซ้ำอีกชั้น
            # (ต่างจาก rq_yes ที่เป็นการยืนยัน "คนที่บอทเดาให้" ซึ่งต้องถามก่อนเสมอ)
            idx = _to_int(incoming.data.get("i"))
            emp_id = (
                session.rq_values[idx]
                if idx is not None and 0 <= idx < len(session.rq_values)
                else None
            )
            emp = None
            if emp_id and knowledge is not None:
                try:
                    kb = await knowledge.get()
                    emp = next((e for e in kb.employees if str(e.get("id")) == emp_id), None)
                except BackendError:
                    emp = None
            if emp is None:
                reply = await _requester_menu(session, knowledge, level="dept")
                await store.set(user_id, session)
                return [reply]
            return await _confirm_requester(session, emp, user_id, backend, store)

        if action == "desc_skip":
            # การ์ดเก่าค้างบนจออยู่ได้เสมอ — กดจากที่อื่นต้องไม่ส่ง ticket ออกไป
            if session.step not in (ASK_DESC, RETRY_SUBMIT):
                return [await _prompt_for_step(session, backend) or M.menu()]
            if not _can_skip_description(session):
                # ไม่ควรเกิด เพราะปุ่มจะไม่ถูกส่งไปตั้งแต่แรก — แต่การ์ดเก่าจากก่อน deploy
                # หรือจาก session ที่ข้อมูลเปลี่ยนไปแล้ว ยังกดเข้ามาได้
                session.step = ASK_DESC
                await store.set(user_id, session)
                return [_ask_description(session)]
            return await _finish_description(session, None, user_id, backend, store)

        if action == "write_description":
            # Opening the keyboard must not submit a ticket or skip another step.
            reply = await _prompt_for_step(session, backend)
            await store.set(user_id, session)
            return [reply or M.menu()]

        if action == "describe_request":
            if session.step not in (ASK_ASSET, ASK_PICK_ASSET, ASK_DESC):
                return [await _prompt_for_step(session, backend) or M.menu()]
            session.asset_asked = True
            session.asset_choices = []
            _clear_picker(session)
            session.step = ASK_DESC
            await store.set(user_id, session)
            return [_ask_description(session)]

        if action == "type":
            ticket_type = incoming.data.get("v", "")
            if ticket_type not in M.TYPE_LABEL:
                return [M.ask_type(session.branch or "-")]
            session.ticket_type = ticket_type
            if ticket_type == "it_service":
                _clear_picker(session)
                replies = await _advance(session, backend, user_id=user_id)
                await store.set(user_id, session)
                return replies
            session.step = ASK_ASSET
            reply = await _asset_picker_prompt(session, backend)
            await store.set(user_id, session)
            return [reply]

        # ---------- เมนูเลือกทรัพย์สินทีละชั้น ----------
        #
        # ปุ่มส่งมาแค่ "ลำดับที่" (i=) แล้วมาเปิดค่าจริงจาก session.pick_values
        # เพราะ postback data ของ LINE จำกัด 300 ไบต์ ซึ่งชื่อรุ่นภาษาไทยยาวๆ ทะลุได้ง่าย
        if action in ("pk_cat", "pk_brand", "pk_code"):
            idx = _to_int(incoming.data.get("i"))
            value = (
                session.pick_values[idx]
                if idx is not None and 0 <= idx < len(session.pick_values)
                else None
            )
            label = (
                session.pick_labels[idx]
                if idx is not None and 0 <= idx < len(session.pick_labels)
                else value
            )
            if value is None:
                # กดจากการ์ดเก่าที่ตัวเลือกไม่ตรงกับ session แล้ว — เริ่มเลือกใหม่ดีกว่าเดาให้ผิดเครื่อง
                _clear_picker(session)
                reply = await _asset_picker_prompt(session, backend)
                await store.set(user_id, session)
                return [reply]

            if action == "pk_cat":
                session.pick_category = value
                session.pick_category_label = label
                session.pick_brand = None
                reply = await _asset_picker_prompt(session, backend, level="brand")
                await store.set(user_id, session)
                return [reply]

            if action == "pk_brand":
                session.pick_brand = value
                reply = await _asset_picker_prompt(session, backend, level="code")
                await store.set(user_id, session)
                return [reply]

            replies = await _resolve_asset_code(session, backend, value, user_id=user_id)
            await store.set(user_id, session)
            return replies

        if action == "pk_page":
            page = _to_int(incoming.data.get("p")) or 0
            reply = await _asset_picker_prompt(
                session, backend, level=session.pick_level or "category", page=max(0, page)
            )
            await store.set(user_id, session)
            return [reply]

        if action == "pk_back":
            # ย้อนขึ้นไปชั้นบน ต้องล้างตัวกรองที่ลึกกว่าด้วย ไม่งั้นจะกรองค้างอยู่เงียบๆ
            to = incoming.data.get("to", "category")
            if to == "category":
                session.pick_category = None
                session.pick_category_label = None
            session.pick_brand = None
            reply = await _asset_picker_prompt(
                session, backend, level="category" if to == "category" else "brand"
            )
            await store.set(user_id, session)
            return [reply]

        if action == "asset_manual":
            # ทางลัดสำหรับคนที่รู้รหัสอยู่แล้ว — ไม่ต้องไล่กด 3 ชั้นให้เสียเวลา
            _clear_picker(session)
            session.step = ASK_ASSET
            await store.set(user_id, session)
            return [M.ASK_ASSET_CODE]

        if action == "skip_asset":
            session.asset_code = None
            session.asset_label = None
            session.equipment_id = None
            session.asset_choices = []
            _clear_picker(session)
            replies = await _after_asset_step(session, backend, user_id=user_id)
            await store.set(user_id, session)
            return replies

        if action == "pick_asset":
            # ผู้ใช้เลือกเครื่องจากรายการที่รหัสซ้ำกัน
            chosen_id = incoming.data.get("v", "")
            chosen = next(
                (e for e in session.asset_choices if e.get("id") == chosen_id), None
            )
            if chosen is None:
                # ตัวเลือกหมดอายุไปแล้ว (session ถูกเขียนทับ) — ให้พิมพ์รหัสใหม่ดีกว่าเดาให้
                session.asset_choices = []
                session.step = ASK_ASSET
                await store.set(user_id, session)
                return [M.ASK_ASSET_CODE]
            session.asset_code = chosen.get("asset_code")
            session.asset_label = M.asset_label(chosen)
            session.equipment_id = chosen.get("id")
            session.asset_choices = []
            replies = [M.asset_confirmed(session.asset_label)]
            replies += await _after_asset_step(session, backend, user_id=user_id)
            await store.set(user_id, session)
            return replies

        if action == "item":
            stock_items = await backend.list_stock_items()
            chosen = next((s for s in stock_items if s["id"] == incoming.data.get("v")), None)
            if chosen is None:
                # ของหายไปจากสต็อกระหว่างที่ผู้ใช้ยังไม่กด (แอดมินลบทิ้ง) — ให้เลือกใหม่
                return [M.ask_item(stock_items)]
            session.pending_item_name = chosen["name"]
            session.pending_item_unit = chosen.get("unit") or "ชิ้น"
            session.step = ASK_QTY
            await store.set(user_id, session)
            return [M.ask_qty(chosen["name"], session.pending_item_unit)]

        if action == "item_other":
            session.step = ASK_ITEM_NAME
            await store.set(user_id, session)
            return [M.ASK_ITEM_NAME]

        if action == "add_item":
            session.step = ASK_ITEM
            stock_items = await backend.list_stock_items()
            await store.set(user_id, session)
            return [M.ask_item(stock_items)]

        if action == "done_items":
            return await _items_done(session, user_id, backend, store)

        if action == "retry_submit":
            if session.step != RETRY_SUBMIT:
                return [await _prompt_for_step(session, backend) or M.menu()]
            if (
                session.ticket_type in ("repair", "it_service")
                and not (session.initial_message or "").strip()
                and (
                    not (session.description or "").strip()
                    or session.description.strip().lower() in M.NO_DETAIL_WORDS
                )
            ):
                session.step = ASK_DESC
                await store.set(user_id, session)
                return [_ask_description(session)]
            try:
                replies = await _submit(session, user_id, backend)
            except BackendError:
                return [M.backend_error()]
            await store.clear(user_id)
            return replies

        return [M.menu()]

    # ---------- text: ผู้ใช้พิมพ์ข้อความ ----------
    text = (incoming.text or "").strip()

    if _is_cancel(text):
        await store.clear(user_id)
        return [M.cancelled()]

    # ไม่ได้อยู่ระหว่างแจ้งเรื่อง -> ให้ชั้น AI อ่านประโยคก่อนว่าผู้ใช้ต้องการอะไร
    if session is None or session.step == IDLE:
        replies = await _handle_idle_text(
            text, incoming, store, backend, knowledge=knowledge, llm=llm
        )
        if replies is not None:
            return replies

        # ข้อความต้อนรับบอกไว้ว่า "พิมพ์ชื่อสาขาเพื่อเริ่มแจ้งเรื่อง" — จึงลองตีความข้อความแรก
        # ว่าเป็นชื่อสาขา แต่ต้องมีอยู่จริงในระบบเท่านั้น ไม่งั้นจะได้ ticket ที่สาขาเพี้ยน
        matched, branches = await _resolve_branch(text, backend, knowledge)
        if matched is None:
            new_session = Session(step=ASK_BRANCH, line_display_name=incoming.display_name)
            # แนบเมนูเลือกสาขาไปด้วย ผู้ใช้จะได้ไม่ต้องเดาว่าสะกดยังไงถึงจะถูก
            prompt = await _branch_prompt(backend, knowledge, session=new_session)
            await store.set(user_id, new_session)
            return [M.branch_not_found(branches), prompt]

        new_session = Session(
            step=ASK_TYPE, branch=matched, line_display_name=incoming.display_name
        )
        await store.set(user_id, new_session)
        return [M.ask_type(matched)]

    step = session.step

    if step == FIND_ASSET:
        # โหมดค้นหาอย่างเดียว — ห้ามพาเข้า flow แจ้งเรื่อง เพราะผู้ใช้แค่อยากดูข้อมูล
        try:
            matches = await backend.lookup_equipment_matches(text)
        except BackendError:
            return [M.backend_error()]
        if not matches:
            # ไม่ล้าง session ผู้ใช้จะได้พิมพ์รหัสใหม่ต่อได้เลย ไม่ต้องกดปุ่มเริ่มใหม่
            return [M.find_asset_not_found(text)]
        await store.clear(user_id)
        # รหัสซ้ำ -> บอกให้ครบทุกเครื่อง ไม่ใช่ตอบเครื่องแรกแล้วจบ
        return [M.asset_answer(matches[0]) if len(matches) == 1 else M.asset_answer_multi(matches)]

    if step == ASK_BRANCH:
        matched, branches = await _resolve_branch(text, backend, knowledge)
        if matched is None:
            # ไม่ใช่ชื่อสาขา — ก่อนจะบอกว่าหาไม่เจอ ลองดูว่าเป็นคำถามที่ตอบได้ไหม
            answer = await _try_question_answer(text, user_id, backend, knowledge)
            prompt = await _branch_prompt(
                backend, knowledge, session=session,
                level=session.pick_level or "company", page=session.pick_page
            )
            await store.set(user_id, session)
            if answer is not None:
                return [answer, prompt]
            return [M.branch_not_found(branches), prompt]

        # สาขาชื่อซ้ำข้ามบริษัทได้จริง (ศาลายา/นครปฐม/มหาชัย มีทั้ง Montipa และ Motta)
        # ต้องถามก่อนว่าบริษัทไหน ห้ามเดา ไม่งั้น ticket จะไปอยู่บริษัทผิดโดยไม่มีใครรู้
        try:
            info = await backend.lookup_branch(matched)
        except BackendError:
            info = {}
        if info.get("ambiguous"):
            labels = [
                {"montipa": "Montipa", "motta": "Motta", "central": "สำนักงานใหญ่"}.get(c, c)
                for c in info.get("companies", [])
            ]
            # พักชื่อสาขาไว้ใน pick_group_label รอจนกว่าผู้ใช้จะเลือกบริษัท
            session.pick_group_label = matched
            await store.set(user_id, session)
            return [M.ask_which_company(labels, matched)]

        session.branch = matched
        replies = await _advance(session, backend, user_id=user_id)
        await store.set(user_id, session)
        return replies

    if step == ASK_TYPE:
        # ผู้ใช้พิมพ์แทนการกดปุ่ม — เดาจากคำที่พิมพ์ ถ้าเดาไม่ออกก็ถามใหม่พร้อมปุ่ม
        guessed = _guess_type(text)
        if guessed is None:
            return [M.ask_type(session.branch or "-")]
        session.ticket_type = guessed
        if guessed == "it_service":
            _clear_picker(session)
            replies = await _advance(session, backend, user_id=user_id)
            await store.set(user_id, session)
            return replies
        session.step = ASK_ASSET
        reply = await _asset_picker_prompt(session, backend)
        await store.set(user_id, session)
        return [reply]

    if step in (ASK_ASSET, ASK_PICK_ASSET):
        replies = await _resolve_asset_code(session, backend, text, user_id=user_id)
        await store.set(user_id, session)
        return replies

    if step in (ASK_ITEM, ASK_ITEM_NAME):
        # พิมพ์ชื่อของเองแทนการกดปุ่ม (ของที่ไม่มีในสต็อก)
        session.pending_item_name = text
        session.pending_item_unit = "ชิ้น"
        session.step = ASK_QTY
        await store.set(user_id, session)
        return [M.ask_qty(text, session.pending_item_unit)]

    if step == ASK_QTY:
        qty = _parse_qty(text)
        if qty is None:
            return [M.invalid_qty(session.pending_item_unit)]
        session.items.append({"name": session.pending_item_name or text, "qty": qty})
        session.pending_item_name = None

        if allow_multi_item:
            session.step = ASK_MORE_ITEMS
            await store.set(user_id, session)
            return [M.ask_more_items(session.items)]

        return await _items_done(session, user_id, backend, store)

    if step == ASK_MORE_ITEMS:
        # อยู่ระหว่างรอให้กดปุ่ม แต่ผู้ใช้พิมพ์มา — ตีความว่าเป็นของชิ้นใหม่ที่อยากเพิ่ม
        session.pending_item_name = text
        session.pending_item_unit = "ชิ้น"
        session.step = ASK_QTY
        await store.set(user_id, session)
        return [M.ask_qty(text, session.pending_item_unit)]

    if step == ASK_REQUESTER:
        # ค้นจากทะเบียนพนักงานก่อนเสมอ — ผู้แจ้งที่ผูกกับแถวจริงในระบบทำให้ดูประวัติรายคนได้
        # และทำให้ครั้งต่อไปไม่ต้องถามอีก ส่วนการพิมพ์ชื่อลอยๆ ให้ผลทั้งสองอย่างนั้นไม่ได้เลย
        found = await _requester_search(session, text, knowledge)
        if found:
            await store.set(user_id, session)
            return found

        # ไม่มีชั้น AI (เทสต์เก่า) หรือดึงทะเบียนไม่ได้ -> ใช้พฤติกรรมเดิม พิมพ์ "ชื่อ - แผนก"
        name, department = parse_requester(text)
        session.requester_user_id = None
        session.requester_name = name
        session.requester_department = department
        if not name and _submits_after_requester(session):
            return [M.ask_requester(session.ticket_type)]
        if _ready_to_submit(session):
            return await _submit_or_retry(session, user_id, backend, store)
        if _ends_at_requester(session):
            # เบิกที่ยังขาดข้อมูลอื่น (เช่นรายการของ) — ให้ _advance ถามช่องที่ยังว่าง
            # ห้ามตกลงไปขั้นรายละเอียดข้างล่าง ซึ่งการเบิกไม่มีแล้ว
            replies = await _advance(session, backend, user_id=user_id)
            await store.set(user_id, session)
            return replies
        session.step = ASK_DESC
        await store.set(user_id, session)
        return [_ask_description(session)]

    if step in (ASK_DESC, RETRY_SUBMIT):
        description = None if not text or text.lower() in M.NO_DETAIL_WORDS else text
        # บังคับให้มีรายละเอียดเฉพาะตอนที่ "ยังไม่เคยเล่าอะไรมาเลย"
        # คนที่พิมพ์ "NB2501001 เปิดไม่ติด" มาตั้งแต่ข้อความแรกแล้วตอบ "ไม่มี" ตรงนี้
        # ไม่ได้แปลว่าไม่มีข้อมูล — การถามซ้ำคือการให้เขาพิมพ์สิ่งเดิมอีกรอบ
        if not description and not _can_skip_description(session):
            session.step = ASK_DESC
            await store.set(user_id, session)
            return [_ask_description(session)]
        return await _finish_description(session, description, user_id, backend, store)

    # สถานะแปลกปลอม (ไม่ควรเกิด) — ล้างทิ้งแล้วกลับเมนู ดีกว่าปล่อยให้ผู้ใช้ติดอยู่
    logger.warning("พบ step ที่ไม่รู้จัก: %s", step)
    await store.clear(user_id)
    return [M.menu()]


async def _finish_description(
    session: Session,
    description: str | None,
    user_id: str | None,
    backend: BackendClient,
    store: ConversationStore,
) -> list[M.Reply]:
    """ปิดขั้นรายละเอียดแล้วไปต่อ — ใช้ร่วมกันระหว่าง "พิมพ์มา" กับ "กดปุ่มไม่มี ส่งเลย"

    ห้ามแยกสองเส้นทางนี้ออกจากกัน ไม่งั้นวันที่แก้เงื่อนไขการส่งจะแก้แค่ทางเดียว
    แล้วได้บั๊กที่ "พิมพ์ - ผ่าน แต่กดปุ่มไม่ผ่าน" ซึ่งไล่หายากเพราะดูเหมือนเรื่องเดียวกัน
    """
    session.description = description
    session.description_collected = True
    if (
        not session.requester_name
        or not session.branch
        or (session.ticket_type == "withdraw" and not session.items)
    ):
        replies = await _advance(session, backend, user_id=user_id)
        await store.set(user_id, session)
        return replies
    return await _submit_or_retry(session, user_id, backend, store)


def _parse_qty(text: str) -> int | None:
    """แปลงข้อความเป็นจำนวน — รับทั้งเลขอารบิกและเลขไทย และต้องเป็นจำนวนเต็มบวก"""
    thai_digits = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")
    cleaned = text.strip().translate(thai_digits)
    try:
        qty = int(cleaned)
    except ValueError:
        return None
    if qty <= 0 or qty > 999:
        return None
    return qty
