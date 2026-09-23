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
  ASK_REQUESTER ──(พิมพ์ชื่อ)──▶ ASK_DESC ──(พิมพ์รายละเอียด)──▶ สร้าง ticket ──▶ IDLE

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
    session: Session, backend: BackendClient, code: str
) -> list[M.Reply]:
    """แปลงรหัสทรัพย์สินเป็นของจริง แล้วเดินบทสนทนาต่อ

    ใช้ร่วมกันทั้งทางที่ผู้ใช้พิมพ์รหัสเองและทางที่กดเลือกจากเมนู
    จะได้ไม่มีทางที่สองทางนี้ทำงานไม่เหมือนกัน (เคยเป็นบั๊กคลาสสิกของโค้ดที่ก๊อปกันไปมา)
    """
    try:
        matches = await backend.lookup_equipment_matches(code)
    except BackendError:
        matches = []

    if not matches:
        return [M.asset_not_found(code)]

    # รหัสเดียวตรงหลายเครื่อง -> ถามก่อน ห้ามเดา (ดูเหตุผลที่ M.ask_which_asset)
    if len(matches) > 1:
        session.asset_choices = matches
        session.step = ASK_PICK_ASSET
        return [M.ask_which_asset(matches)]

    equipment = matches[0]
    session.asset_code = equipment["asset_code"]
    session.asset_label = M.asset_label(equipment)
    session.asset_choices = []
    _clear_picker(session)
    replies = [M.asset_confirmed(session.asset_label)]
    replies += await _after_asset_step(session, backend)
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


async def _after_asset_step(session: Session, backend: BackendClient) -> list[M.Reply]:
    """ผ่านขั้นตอนถามรหัสทรัพย์สินไปแล้ว — ให้ _advance ตัดสินใจว่าจะถามอะไรต่อ

    เดิมฟังก์ชันนี้กระโดดไปถาม "เลือกอุปกรณ์" ทันทีเมื่อเป็นการเบิก ซึ่งผิดเมื่อชั้น AI
    จับรายการของมาจากประโยคแรกได้แล้ว (บอทจะถามซ้ำในสิ่งที่ผู้ใช้บอกไปแล้ว)
    จึงรวมการตัดสินใจไว้ที่ _advance ที่เดียว
    """
    session.asset_asked = True
    return await _advance(session, backend)


async def _advance(session: Session, backend: BackendClient) -> list[M.Reply]:
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
        return [M.ask_description(session.ticket_type)]

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
        session.step = ASK_REQUESTER
        return [M.ask_requester(session.ticket_type)]

    session.step = ASK_DESC
    return [M.ask_description(session.ticket_type)]


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
    if step in (ASK_DESC, RETRY_SUBMIT):
        return M.ask_description(session.ticket_type)
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
        "type": session.ticket_type,
        "location": session.branch or "",
        "description": session.description or "",
        "requester_name": session.requester_name or "",
        "requester_department": session.requester_department,
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


async def _submit_or_retry(
    session: Session, user_id: str, backend: BackendClient, store: ConversationStore,
) -> list[M.Reply]:
    try:
        replies = await _submit(session, user_id, backend)
    except BackendError:
        session.step = RETRY_SUBMIT
        await store.set(user_id, session)
        error = M.backend_error()
        error.quick = [("🔁 ลองส่งใหม่", "a=retry_submit"), ("❌ ยกเลิก", "a=cancel")]
        return [error]
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
        )
        if analysis.asset_code:
            session.asset_code = analysis.asset_code
            session.asset_asked = True
            equipment = next(
                (e for e in kb.equipment if e["asset_code"] == analysis.asset_code), None
            )
            if equipment and equipment.get("brand_model"):
                session.asset_label = f"{analysis.asset_code} — {equipment['brand_model']}"
            else:
                session.asset_label = analysis.asset_code
        if analysis.item_name:
            # ถ้าไม่ได้บอกจำนวนมา ให้ถือว่า 1 ชิ้น (ค่าที่คนคาดหวังที่สุด)
            session.items = [{"name": analysis.item_name, "qty": analysis.quantity or 1}]

        replies: list[M.Reply] = []
        slots = analysis.filled_slots()
        if slots:
            replies.append(M.understood(slots))
        replies += await _advance(session, backend)
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
            return [M.ask_description("it_service")]

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
                    replies = await _advance(session, backend)
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
                    replies = await _advance(session, backend)
                    await store.set(user_id, session)
                    return replies
                await store.set(user_id, session)
                return [reply]

            # bk_branch — เลือกสาขาเสร็จแล้ว เดินบทสนทนาต่อ
            session.branch = value
            replies = await _advance(session, backend)
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
            replies = await _advance(session, backend)
            await store.set(user_id, session)
            return replies

        # ปุ่มที่เหลือต้องมี session อยู่ ถ้าหมดอายุไปแล้วให้บอกตรงๆ ดีกว่าทำเงียบๆ แล้วพัง
        if session is None:
            return [M.session_expired()]

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
            return [M.ask_description(session.ticket_type)]

        if action == "type":
            ticket_type = incoming.data.get("v", "")
            if ticket_type not in M.TYPE_LABEL:
                return [M.ask_type(session.branch or "-")]
            session.ticket_type = ticket_type
            if ticket_type == "it_service":
                _clear_picker(session)
                replies = await _advance(session, backend)
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

            replies = await _resolve_asset_code(session, backend, value)
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
            session.asset_choices = []
            _clear_picker(session)
            replies = await _after_asset_step(session, backend)
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
            session.asset_choices = []
            replies = [M.asset_confirmed(session.asset_label)]
            replies += await _after_asset_step(session, backend)
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
            session.step = ASK_REQUESTER
            await store.set(user_id, session)
            return [M.ask_requester(session.ticket_type or "withdraw")]

        if action == "retry_submit":
            if session.step != RETRY_SUBMIT:
                return [await _prompt_for_step(session, backend) or M.menu()]
            if session.ticket_type in ("repair", "it_service") and (
                not (session.description or "").strip()
                or session.description.strip().lower() in M.NO_DETAIL_WORDS
            ):
                session.step = ASK_DESC
                await store.set(user_id, session)
                return [M.ask_description(session.ticket_type)]
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
        replies = await _advance(session, backend)
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
            replies = await _advance(session, backend)
            await store.set(user_id, session)
            return replies
        session.step = ASK_ASSET
        reply = await _asset_picker_prompt(session, backend)
        await store.set(user_id, session)
        return [reply]

    if step in (ASK_ASSET, ASK_PICK_ASSET):
        replies = await _resolve_asset_code(session, backend, text)
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

        session.step = ASK_REQUESTER
        await store.set(user_id, session)
        return [M.ask_requester(session.ticket_type or "withdraw")]

    if step == ASK_MORE_ITEMS:
        # อยู่ระหว่างรอให้กดปุ่ม แต่ผู้ใช้พิมพ์มา — ตีความว่าเป็นของชิ้นใหม่ที่อยากเพิ่ม
        session.pending_item_name = text
        session.pending_item_unit = "ชิ้น"
        session.step = ASK_QTY
        await store.set(user_id, session)
        return [M.ask_qty(text, session.pending_item_unit)]

    if step == ASK_REQUESTER:
        name, department = parse_requester(text)
        session.requester_name = name
        session.requester_department = department
        if (session.description_collected or (session.ticket_type == "it_service" and session.description)) and session.branch:
            if not name:
                return [M.ask_requester(session.ticket_type)]
            return await _submit_or_retry(session, user_id, backend, store)
        session.step = ASK_DESC
        await store.set(user_id, session)
        return [M.ask_description(session.ticket_type)]

    if step in (ASK_DESC, RETRY_SUBMIT):
        description = None if not text or text.lower() in M.NO_DETAIL_WORDS else text
        if session.ticket_type in ("repair", "it_service") and not description:
            session.step = ASK_DESC
            await store.set(user_id, session)
            return [M.ask_description(session.ticket_type)]
        session.description = description
        session.description_collected = True
        if not session.requester_name or not session.branch or (session.ticket_type == "withdraw" and not session.items):
            replies = await _advance(session, backend)
            await store.set(user_id, session)
            return replies
        return await _submit_or_retry(session, user_id, backend, store)

    # สถานะแปลกปลอม (ไม่ควรเกิด) — ล้างทิ้งแล้วกลับเมนู ดีกว่าปล่อยให้ผู้ใช้ติดอยู่
    logger.warning("พบ step ที่ไม่รู้จัก: %s", step)
    await store.clear(user_id)
    return [M.menu()]


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
