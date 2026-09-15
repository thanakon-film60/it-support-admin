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
ASK_TYPE = "ASK_TYPE"
ASK_ASSET = "ASK_ASSET"
ASK_ITEM = "ASK_ITEM"
ASK_ITEM_NAME = "ASK_ITEM_NAME"
ASK_QTY = "ASK_QTY"
ASK_MORE_ITEMS = "ASK_MORE_ITEMS"
ASK_REQUESTER = "ASK_REQUESTER"
ASK_DESC = "ASK_DESC"
RETRY_SUBMIT = "RETRY_SUBMIT"

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

    kind: str  # "text" | "postback" | "follow"
    user_id: str
    text: str = ""
    data: dict[str, str] = field(default_factory=dict)
    display_name: str | None = None


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
        return [M.ASK_BRANCH]

    if not session.ticket_type:
        session.step = ASK_TYPE
        return [M.ask_type(session.branch)]

    if not session.asset_asked and not session.asset_code:
        session.asset_asked = True
        session.step = ASK_ASSET
        return [M.ASK_ASSET_CODE]

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
    return [M.ASK_DESCRIPTION_REPAIR if session.ticket_type == "repair" else M.ASK_DESCRIPTION]


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
        )
    ]


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
        equipment = await backend.lookup_equipment(analysis.asset_code)
        return M.asset_answer(equipment) if equipment else None

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

    session = await store.get(user_id)

    # ---------- postback: ผู้ใช้กดปุ่ม ----------
    if incoming.kind == "postback":
        action = incoming.data.get("a", "")

        if action == "cancel":
            await store.clear(user_id)
            return [M.cancelled()]

        if action == "start":
            fresh = Session(step=ASK_BRANCH, line_display_name=incoming.display_name)
            await store.set(user_id, fresh)
            return [M.ASK_BRANCH]

        if action == "faq_menu":
            await store.clear(user_id)
            return [M.FAQ_PROMPT]

        # ปุ่มที่เหลือต้องมี session อยู่ ถ้าหมดอายุไปแล้วให้บอกตรงๆ ดีกว่าทำเงียบๆ แล้วพัง
        if session is None:
            return [M.session_expired()]

        if action == "type":
            ticket_type = incoming.data.get("v", "")
            if ticket_type not in M.TYPE_LABEL:
                return [M.ask_type(session.branch or "-")]
            session.ticket_type = ticket_type
            session.step = ASK_ASSET
            await store.set(user_id, session)
            return [M.ASK_ASSET_CODE]

        if action == "skip_asset":
            session.asset_code = None
            session.asset_label = None
            replies = await _after_asset_step(session, backend)
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
            await store.set(user_id, new_session)
            return [M.branch_not_found(branches)]

        new_session = Session(
            step=ASK_TYPE, branch=matched, line_display_name=incoming.display_name
        )
        await store.set(user_id, new_session)
        return [M.ask_type(matched)]

    step = session.step

    if step == ASK_BRANCH:
        matched, branches = await _resolve_branch(text, backend, knowledge)
        if matched is None:
            # ไม่ใช่ชื่อสาขา — ก่อนจะบอกว่าหาไม่เจอ ลองดูว่าเป็นคำถามที่ตอบได้ไหม
            answer = await _try_question_answer(text, user_id, backend, knowledge)
            if answer is not None:
                return [answer, M.ASK_BRANCH]
            return [M.branch_not_found(branches)]
        session.branch = matched
        session.step = ASK_TYPE
        await store.set(user_id, session)
        return [M.ask_type(matched)]

    if step == ASK_TYPE:
        # ผู้ใช้พิมพ์แทนการกดปุ่ม — เดาจากคำที่พิมพ์ ถ้าเดาไม่ออกก็ถามใหม่พร้อมปุ่ม
        guessed = _guess_type(text)
        if guessed is None:
            return [M.ask_type(session.branch or "-")]
        session.ticket_type = guessed
        session.step = ASK_ASSET
        await store.set(user_id, session)
        return [M.ASK_ASSET_CODE]

    if step == ASK_ASSET:
        try:
            equipment = await backend.lookup_equipment(text)
        except BackendError:
            equipment = None
        if equipment is None:
            return [M.asset_not_found(text)]
        session.asset_code = equipment["asset_code"]
        label = equipment["asset_code"]
        if equipment.get("brand_model"):
            label = f"{equipment['asset_code']} — {equipment['brand_model']}"
        session.asset_label = label
        replies = [M.asset_confirmed(label)]
        replies += await _after_asset_step(session, backend)
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
        session.step = ASK_DESC
        await store.set(user_id, session)
        return [
            M.ASK_DESCRIPTION_REPAIR if session.ticket_type == "repair" else M.ASK_DESCRIPTION
        ]

    if step in (ASK_DESC, RETRY_SUBMIT):
        session.description = None if text.lower() in M.NO_DETAIL_WORDS else text
        try:
            replies = await _submit(session, user_id, backend)
        except BackendError:
            # เก็บ session ไว้ให้กดส่งซ้ำได้ ไม่ต้องกรอกใหม่ทั้งหมด
            session.step = RETRY_SUBMIT
            await store.set(user_id, session)
            error = M.backend_error()
            error.quick = [("🔁 ลองส่งใหม่", "a=retry_submit"), ("❌ ยกเลิก", "a=cancel")]
            return [error]
        await store.clear(user_id)
        return replies

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
