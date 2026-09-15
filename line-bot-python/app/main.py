"""FastAPI app — จุดที่ LINE ยิง webhook เข้ามา

สิ่งที่ไฟล์นี้รับผิดชอบมีแค่ 3 อย่าง:
  1. ตรวจลายเซ็น (x-line-signature) ว่า request มาจาก LINE จริง
  2. แปลง event ของ SDK เป็นโครงสร้างกลางๆ (Incoming) แล้วส่งให้ flow ตัดสินใจ
  3. ส่งคำตอบกลับผ่าน reply token

ตรรกะบทสนทนาไม่มีอยู่ในไฟล์นี้เลย — อยู่ใน flow.py ทั้งหมด
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request
from linebot.v3 import WebhookParser
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.webhooks import FollowEvent, MessageEvent, PostbackEvent

from .ai import KnowledgeCache, compose_answer_with_llm
from .backend import BackendClient
from .config import settings
from .flow import Incoming, handle, parse_postback
from .line_api import LineApi
from .store import build_store

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("linebot")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.require_line_credentials()

    app.state.parser = WebhookParser(settings.line_channel_secret)
    app.state.line = LineApi(settings.line_channel_access_token, settings.line_api_host)
    app.state.backend = BackendClient(
        settings.backend_base_url,
        settings.internal_api_key,
        settings.backend_timeout_seconds,
    )
    app.state.store = build_store(settings.redis_url, settings.session_ttl_seconds)

    # ชั้น AI: cache ข้อมูลจากฐานข้อมูลของโปรเจกต์ (สาขา/ทรัพย์สิน/สต็อก/FAQ) แล้วสร้างดัชนีค้นหา
    app.state.knowledge = KnowledgeCache(app.state.backend, settings.knowledge_ttl_seconds)

    if settings.use_llm:
        async def _llm(question: str, faq_matches: list[dict]) -> str | None:
            return await compose_answer_with_llm(
                question,
                faq_matches,
                provider=settings.ai_provider.strip().lower(),
                api_key=settings.ai_api_key,
                model=settings.ai_model,
                timeout=settings.ai_timeout_seconds,
            )

        app.state.llm = _llm
    else:
        app.state.llm = None

    logger.info(
        "bot พร้อมทำงาน | backend=%s | state=%s | llm=%s",
        settings.backend_base_url,
        "redis" if settings.use_redis else "in-memory (dev เท่านั้น)",
        settings.ai_provider if settings.use_llm else "ปิด (ใช้ TF-IDF อย่างเดียว)",
    )
    try:
        yield
    finally:
        await app.state.line.aclose()
        await app.state.backend.aclose()


app = FastAPI(title="IT Support LINE Bot", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True, "state_backend": "redis" if settings.use_redis else "memory"}


# ทำไมต้องรับที่ "/" ด้วย: reverse proxy หลายตัว (รวมถึง `tailscale funnel --set-path=/webhook`
# ที่ระบบนี้ใช้จริง) จะ "ตัด" prefix ของ path ทิ้งก่อน forward เข้ามา — LINE ยิง POST /webhook
# แต่บอทได้รับเป็น POST / ทำให้ตอบ 404 กลับไป (เจอจริงตอนกด Verify ครั้งแรก 2026-09-14)
# การรับที่ "/" ไม่ได้ลดความปลอดภัย เพราะด่านจริงคือการตรวจลายเซ็น HMAC ด้านล่าง ไม่ใช่ path
# (ทางเลือกที่ "สะอาด" กว่าคือให้ proxy ส่ง path เดิมมา เช่นตั้ง target เป็น
#  http://127.0.0.1:8000/webhook แต่การรับสองทางทำให้ย้าย proxy ไปแบบไหนก็ไม่พังอีก)
@app.get("/webhook")
@app.get("/")
async def webhook_verify():
    """LINE Developers Console ยิง GET มาตอนกดปุ่ม Verify"""
    return {"ok": True, "service": "line-bot-python"}


@app.post("/webhook")
@app.post("/")
async def webhook(request: Request, x_line_signature: str = Header(default="")):
    # ต้องใช้ body ดิบ (ไบต์ตรงๆ) ในการตรวจลายเซ็น — ถ้า parse เป็น JSON ก่อนแล้ว dump กลับ
    # ตัวอักษร/ลำดับคีย์อาจเปลี่ยน ทำให้ HMAC ไม่ตรงทั้งที่ request ถูกต้อง
    raw_body = (await request.body()).decode("utf-8")

    try:
        events = request.app.state.parser.parse(raw_body, x_line_signature)
    except InvalidSignatureError:
        logger.warning("ลายเซ็นไม่ถูกต้อง — ปฏิเสธ request")
        raise HTTPException(status_code=401, detail="invalid signature")

    # ประมวลผลทีละ event แบบขนาน แต่ดัก error รายตัว
    # LINE จะ retry ถ้าไม่ได้ 200 กลับไปเร็วพอ — เราจึงต้องตอบ 200 เสมอแม้จะมี event ที่พัง
    await asyncio.gather(*(_safe_handle(request.app, e) for e in events))
    return {"ok": True}


async def _safe_handle(app: FastAPI, event) -> None:
    try:
        await asyncio.wait_for(
            _handle_event(app, event), timeout=settings.event_timeout_seconds
        )
    except asyncio.TimeoutError:
        logger.error("ประมวลผล event นานเกิน %ss — ตัดจบ", settings.event_timeout_seconds)
    except Exception:
        logger.exception("ประมวลผล event ล้มเหลว")


async def _handle_event(app: FastAPI, event) -> None:
    incoming = await _to_incoming(app, event)
    if incoming is None:
        return

    replies = await handle(
        incoming,
        app.state.store,
        app.state.backend,
        knowledge=app.state.knowledge,
        llm=app.state.llm,
    )
    reply_token = getattr(event, "reply_token", None)
    if reply_token and replies:
        await app.state.line.reply(reply_token, replies)


async def _to_incoming(app: FastAPI, event) -> Incoming | None:
    """แปลง event ของ SDK เป็นโครงสร้างกลาง — ตัดชนิดที่บอทไม่สนใจทิ้งตรงนี้"""
    user_id = getattr(getattr(event, "source", None), "user_id", None)
    if not user_id:
        # เช่น event จากห้องกลุ่มที่ไม่มี userId — บอทนี้ออกแบบมาสำหรับแชท 1:1
        return None

    if isinstance(event, FollowEvent):
        display_name = await app.state.line.get_display_name(user_id)
        return Incoming(kind="follow", user_id=user_id, display_name=display_name)

    if isinstance(event, PostbackEvent):
        return Incoming(
            kind="postback",
            user_id=user_id,
            data=parse_postback(event.postback.data),
            display_name=await _display_name_if_new(app, user_id),
        )

    if isinstance(event, MessageEvent):
        message = event.message
        # รองรับเฉพาะข้อความตัวอักษร — รูป/สติกเกอร์/ไฟล์ ยังไม่อยู่ใน scope
        if getattr(message, "type", None) != "text":
            return None
        return Incoming(
            kind="text",
            user_id=user_id,
            text=getattr(message, "text", "") or "",
            display_name=await _display_name_if_new(app, user_id),
        )

    return None


async def _display_name_if_new(app: FastAPI, user_id: str) -> str | None:
    """ดึงชื่อโปรไฟล์เฉพาะตอนที่ยังไม่มี session อยู่ (คือเพิ่งเริ่มบทสนทนา)

    ทำไมไม่ดึงทุกครั้ง: get_profile เป็น API call จริง มีโควต้าและกินเวลา
    ถ้าเรียกทุกข้อความ บอทจะช้าลงโดยไม่ได้อะไรเพิ่ม เพราะชื่อไม่เปลี่ยนกลางบทสนทนา
    """
    session = await app.state.store.get(user_id)
    if session is not None:
        return session.line_display_name
    return await app.state.line.get_display_name(user_id)
