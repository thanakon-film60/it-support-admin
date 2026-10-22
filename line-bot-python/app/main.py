"""FastAPI app — จุดที่ LINE ยิง webhook เข้ามา

สิ่งที่ไฟล์นี้รับผิดชอบมีแค่ 3 อย่าง:
  1. ตรวจลายเซ็น (x-line-signature) ว่า request มาจาก LINE จริง
  2. แปลง event ของ SDK เป็นโครงสร้างกลางๆ (Incoming) แล้วส่งให้ flow ตัดสินใจ
  3. ส่งคำตอบกลับผ่าน reply token

ตรรกะบทสนทนาไม่มีอยู่ในไฟล์นี้เลย — อยู่ใน flow.py ทั้งหมด
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from linebot.v3 import WebhookParser
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.webhooks import FollowEvent, MessageEvent, PostbackEvent

from . import messages as M
from .ai import KnowledgeCache, compose_answer_with_llm
from .backend import BackendClient, BackendError
from .config import settings
from .flow import (
    ASK_BRANCH,
    BRANCH_START_LEVEL,
    IDLE,
    Incoming,
    handle,
    parse_postback,
    pause_bot_for,
    resume_bot_for,
)
from .line_api import ImageTooLarge, LineApi
from .richmenu import (
    STATE_DISABLED,
    STATE_FAILED,
    STATE_INSTALLING,
    STATE_UNKNOWN,
    RichMenuError,
    ensure_rich_menu,
)
from .store import Session, build_rate_limiter, build_store

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("linebot")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.require_line_credentials()

    app.state.parser = WebhookParser(settings.line_channel_secret)
    app.state.line = LineApi(
        settings.line_channel_access_token,
        settings.line_api_host,
        settings.line_blob_host,
    )
    app.state.backend = BackendClient(
        settings.backend_base_url,
        settings.internal_api_key,
        settings.backend_timeout_seconds,
    )
    app.state.store = build_store(settings.redis_url, settings.session_ttl_seconds)
    app.state.rate_limiter = build_rate_limiter(settings.redis_url)

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
        "bot พร้อมทำงาน | backend=%s | state=%s | llm=%s | รูป=%s | rate limit=%s",
        settings.backend_base_url,
        "redis" if settings.use_redis else "in-memory (dev เท่านั้น)",
        settings.ai_provider if settings.use_llm else "ปิด (ใช้ TF-IDF อย่างเดียว)",
        "เปิด" if settings.accept_images else "ปิด",
        f"{settings.rate_limit_per_minute}/นาที" if settings.rate_limit_per_minute > 0 else "ปิด",
    )

    # ติดตั้ง rich menu แบบไม่บล็อกการสตาร์ท
    #
    # ทำไมต้อง background: LINE จะกด Verify webhook หรือส่ง event เข้ามาเมื่อไหร่ก็ได้
    # ถ้าเรารอ 3 คำขอไป-กลับหา api.line.me ให้เสร็จก่อนค่อยเปิดรับ request บอทจะดูเหมือน
    # "ไม่ตอบ" อยู่หลายวินาทีตอนเพิ่ง deploy ซึ่งเป็นช่วงเดียวกับที่คนมักกด Verify พอดี
    if settings.richmenu_auto_install:
        app.state.richmenu_state, app.state.richmenu_status = STATE_INSTALLING, "กำลังติดตั้ง..."
        asyncio.create_task(_install_rich_menu(app))
    else:
        app.state.richmenu_state, app.state.richmenu_status = STATE_DISABLED, "ปิดการติดตั้งอัตโนมัติ"

    # เปิด Chat ใน OA Manager อยู่ไหม — ถามแบบ background เหตุผลเดียวกับ rich menu ข้างบน
    app.state.chat_mode = None
    app.state.bot_info_checked_at = 0.0
    app.state.bot_info_task = None
    _refresh_bot_info_soon(app)

    try:
        yield
    finally:
        task = getattr(app.state, "bot_info_task", None)
        if task is not None and not task.done():
            task.cancel()
        await app.state.line.aclose()
        await app.state.backend.aclose()


app = FastAPI(title="IT Support LINE Bot", lifespan=lifespan)


async def _install_rich_menu(app: FastAPI) -> None:
    """ติดตั้ง rich menu — ห้ามทำให้บอทตายไม่ว่าจะพังยังไง

    เก็บผลไว้ที่ app.state.richmenu_state (ASCII ไว้ให้สคริปต์อ่าน) คู่กับ
    app.state.richmenu_status (ข้อความไทยไว้ให้คนอ่าน) เพื่อให้ /health บอกได้ว่าติดตั้งผ่านไหม
    ไม่งั้นต้องไปไล่อ่าน log ซึ่งคนที่ deploy มักไม่ได้ดู
    """
    try:
        result = await ensure_rich_menu(
            settings.line_channel_access_token,
            settings.richmenu_image_path,
            # line_api_host ถูกตั้งเฉพาะตอนทดสอบ e2e — ถ้ามีค่าให้ชี้ไปที่นั่นทั้งคู่
            # จะได้ไม่มีทางยิงไป LINE จริงระหว่างเทสต์
            api_host=settings.line_api_host or "https://api.line.me",
            blob_host=settings.line_api_host or settings.line_blob_host,
            force=settings.richmenu_force_reinstall,
        )
        app.state.richmenu_state = result.state
        app.state.richmenu_status = result.message
        logger.info("rich menu: %s [%s]", result.message, result.state)
    except RichMenuError as exc:
        app.state.richmenu_state = STATE_FAILED
        app.state.richmenu_status = f"ล้มเหลว: {exc}"
        logger.error("ติดตั้ง rich menu ไม่สำเร็จ: %s", exc)
    except Exception as exc:  # noqa: BLE001 - บอทต้องทำงานต่อได้แม้เมนูติดตั้งไม่ขึ้น
        app.state.richmenu_state = STATE_FAILED
        app.state.richmenu_status = f"ล้มเหลว: {exc}"
        logger.exception("ติดตั้ง rich menu ไม่สำเร็จ (ข้อผิดพลาดที่ไม่คาดคิด)")


# ถามสถานะ Chat ใหม่ทุก 5 นาที — แอดมินเปิด/ปิด Chat ใน OA Manager ได้ทุกเมื่อโดยไม่ต้อง restart บอท
# ถามไม่สำเร็จให้ลองใหม่เร็วกว่า (1 นาที) จะได้ไม่ค้างค่า "ไม่ทราบ" นาน
BOT_INFO_TTL_SECONDS = 300
BOT_INFO_RETRY_SECONDS = 60


async def _refresh_bot_info(app: FastAPI) -> None:
    try:
        info = await asyncio.wait_for(app.state.line.get_bot_info(), timeout=10)
    except Exception:  # noqa: BLE001 - รวม timeout: ไม่รู้ก็ใช้ค่าเดิมไปก่อน
        info = None
    now = time.monotonic()
    if info and info.get("chat_mode"):
        if info["chat_mode"] != app.state.chat_mode:
            logger.info(
                "LINE OA: Chat %s (chat_mode=%s)",
                "เปิด — ส่งต่อให้เจ้าหน้าที่ได้" if info["chat_mode"] == "chat" else "ปิด — ส่งต่อให้เจ้าหน้าที่ไม่ได้",
                info["chat_mode"],
            )
        app.state.chat_mode = info["chat_mode"]
        app.state.bot_info_checked_at = now
    else:
        # ยังไม่สำเร็จ — ให้รอบหน้ามาถึงเร็วกว่าปกติ
        app.state.bot_info_checked_at = now - BOT_INFO_TTL_SECONDS + BOT_INFO_RETRY_SECONDS


def _refresh_bot_info_soon(app: FastAPI) -> None:
    """สั่งถามสถานะ Chat ใหม่ถ้าข้อมูลเก่าเกินกำหนด — ไม่รอผล (ห้ามทำให้การตอบลูกค้าช้าลง)"""
    task = getattr(app.state, "bot_info_task", None)
    if task is not None and not task.done():
        return
    checked = getattr(app.state, "bot_info_checked_at", 0.0)
    if checked and time.monotonic() - checked < BOT_INFO_TTL_SECONDS:
        return
    app.state.bot_info_task = asyncio.create_task(_refresh_bot_info(app))


def _handoff_available(app: FastAPI) -> bool:
    """ส่งต่อให้เจ้าหน้าที่ได้ไหม = Chat ใน OA Manager ไม่ได้ปิดอยู่

    ยังไม่รู้ (เพิ่งสตาร์ท / ถาม LINE ไม่สำเร็จ) ให้ถือว่าได้ — ถ้าเน็ตไป LINE พังจริง
    บอทก็ตอบใครไม่ได้อยู่ดี แต่ถ้าเดาว่า "ไม่ได้" จะปิดฟีเจอร์ทิ้งทั้งที่อาจเปิดอยู่
    """
    _refresh_bot_info_soon(app)
    return getattr(app.state, "chat_mode", None) != "bot"


@app.get("/health")
async def health():
    body = {
        "ok": True,
        "state_backend": "redis" if settings.use_redis else "memory",
        "accept_images": settings.accept_images,
        "rate_limit_per_minute": settings.rate_limit_per_minute,
        # สองฟิลด์นี้คู่กันเสมอ: richmenu_state ไว้ให้เครื่องตัดสินใจ (ASCII ไม่ขึ้นกับ
        # ภาษาและ encoding) ส่วน richmenu ไว้ให้คนอ่าน — สคริปต์ห้ามเทียบจากฟิลด์หลัง
        # เด็ดขาด เพราะ PowerShell 5.1 ถอดรหัสไทยเพี้ยนถ้า Content-Type ไม่มี charset
        "richmenu": getattr(app.state, "richmenu_status", "ยังไม่ทราบ"),
        "richmenu_state": getattr(app.state, "richmenu_state", STATE_UNKNOWN),
        # ขั้นตอนแรกของบทสนทนาที่โค้ดชุดนี้ใช้ — ให้ deploy.ps1 ตรวจได้ว่าบอทรันโค้ดใหม่จริง
        # (ดูจากอาการไม่ได้ เพราะบอทเก่าก็ตอบข้อความเหมือนกัน แค่ไม่มีขั้นตอนเลือกบริษัท)
        "first_step": ASK_BRANCH,
        "first_selection": BRANCH_START_LEVEL,
        # ทักต้อนรับกลับหลังหายไปกี่วัน (0 = ปิด) — อยู่ใน /health เพราะดูจากอาการไม่ได้เลย
        # ต้องรอให้มีคนหายไปครบตามกำหนดแล้วกลับมาถึงจะรู้ว่าโค้ดชุดใหม่ขึ้นแล้วหรือยัง
        "welcome_back_days": settings.welcome_back_days,
        # Chat ใน OA Manager: "chat" = เปิด (ทีม IT ตอบในแอป LINE OA ได้) / "bot" = ปิด / "unknown"
        # deploy.ps1 ใช้เตือนถ้าปิดอยู่ เพราะปุ่ม "คุยกับเจ้าหน้าที่" จะตอบว่ายังไม่เปิดให้คุย
        "chat_mode": _chat_mode_for_health(),
        "handoff_hours": settings.handoff_hours,
        "mark_as_read": settings.mark_as_read,
        # ทีม IT ปิดบอทอยู่ไหม (ทั้งระบบ / กี่คน) — deploy.ps1 เตือนได้ว่าบอทไม่ได้ตอบใครอยู่
        # ห่อ try ไว้เพราะ /health ต้องตอบได้แม้ Redis มีปัญหา (นั่นคือเวลาที่ต้องดู /health ที่สุด)
        **(await _off_summary()),
    }
    # ระบุ charset ให้ชัด: Starlette เติม "; charset=utf-8" ให้เฉพาะ media type ที่ขึ้นต้น
    # ด้วย text/ เท่านั้น application/json จึงออกไปแบบไม่มี charset — แล้ว
    # Invoke-WebRequest ของ Windows PowerShell 5.1 จะเดาเป็น ISO-8859-1 ทำให้ภาษาไทย
    # ที่คนอ่านกลายเป็นอักษรขยะบนหน้าจอคนที่ deploy (เจอจริง 2026-09-26)
    return JSONResponse(body, media_type="application/json; charset=utf-8")


def _chat_mode_for_health() -> str:
    _refresh_bot_info_soon(app)
    return getattr(app.state, "chat_mode", None) or "unknown"


async def _off_summary() -> dict:
    try:
        store = app.state.store
        return {
            "bot_off": (await store.get_bot_off()) is not None,
            "users_off": len(await store.list_user_off()),
        }
    except Exception:  # noqa: BLE001 - ดูเหตุผลที่จุดเรียก
        logger.warning("อ่านสถานะปิดบอทไม่สำเร็จ", exc_info=True)
        return {"bot_off": None, "users_off": None}


# ---------------------------------------------------------------- API ภายใน: เจ้าหน้าที่รับแชทต่อเอง
#
# ทำไมต้องมี: LINE ไม่ส่ง webhook ตอนเจ้าหน้าที่ตอบแชทในแอป LINE Official Account บอทจึงรู้เองไม่ได้
# ว่ามีคนกำลังคุยกับผู้ใช้อยู่ แล้วโผล่มาตอบแทรก (เช่นตีความคำตอบของผู้ใช้เป็นเรื่องใหม่แล้วถามสาขา)
# หน้าแอดมินจึงสั่งผ่านทางนี้แทน: กด "รับแชทต่อเอง" บน ticket / ส่งสถานะ "รอข้อมูล" ทาง LINE
#
# ใช้ POST + body ทุกเส้น (ไม่ใส่ line_user_id ใน query) — access log ของ uvicorn พิมพ์ query string
# ออกมาเต็มๆ ทุก request ซึ่งจะทำให้ user id ของพนักงานไปกองอยู่ใน log
# ทางเข้าจากอินเทอร์เน็ต (Cloudflare Tunnel) ส่งเข้าบอทเฉพาะ ^/webhook — เส้นนี้จึงเรียกได้จากใน compose
# เท่านั้น แต่ยังตรวจ key ทุกครั้ง เพราะวันที่ย้าย proxy แล้วเปิด path กว้างกว่าเดิม ด่านนี้ต้องยังอยู่


class HandoffRequest(BaseModel):
    # LINE user id จริงยาว 33 ตัว (U + hex 32) — เผื่อไว้นิดหน่อยแต่ไม่ปล่อยให้ยัดของยาวๆ เข้า Redis key
    line_user_id: str = Field(min_length=1, max_length=64)
    # ไม่ส่ง = ใช้ HANDOFF_HOURS ชุดเดียวกับปุ่ม "คุยกับเจ้าหน้าที่" · เพดาน 7 วันกันพิมพ์ผิดจนบอทเงียบยาว
    hours: float | None = Field(default=None, gt=0, le=168)


def _require_internal_key(value: str) -> None:
    expected = settings.internal_api_key
    # ยังไม่ตั้ง key = ปฏิเสธทุก request (fail closed) เหมือน verifyInternalKey ฝั่ง Next.js
    if not expected or not value or not hmac.compare_digest(expected.encode(), value.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


async def _handoff_state(user_id: str, session: Session | None) -> dict:
    """สถานะ "บอทเงียบกับคนนี้ไหม" รวมทุกสาเหตุ — หน้า ticket แสดงจากตรงนี้ที่เดียว

    active = เงียบอยู่ ไม่ว่าจะเพราะคุยกับเจ้าหน้าที่ (มีเวลาสิ้นสุด: until) หรือทีม IT ปิดบอทกับคนนี้
    ไว้จากการ์ดในแชท (bot_off_user — ไม่มีเวลาสิ้นสุด จนกว่าจะสั่งเปิด)
    ถ้าแยกถามคนละเส้น หน้าเว็บจะโชว์ว่า "บอทตอบตามปกติ" ทั้งที่บอทเงียบอยู่เพราะอีกสาเหตุหนึ่ง
    """
    store = app.state.store
    in_handoff = session is not None and session.in_handoff()
    user_off = await store.get_user_off(user_id)
    return {
        "ok": True,
        "active": in_handoff or user_off is not None,
        "until": session.handoff_until if in_handoff else None,
        "bot_off_user": user_off is not None,
        "bot_off_all": (await store.get_bot_off()) is not None,
        "chat_mode": _chat_mode_for_health(),
    }


@app.post("/internal/handoff/status")
async def handoff_status(body: HandoffRequest, x_internal_key: str = Header(default="")):
    _require_internal_key(x_internal_key)
    return await _handoff_state(body.line_user_id, await app.state.store.get(body.line_user_id))


@app.post("/internal/handoff")
async def handoff_start(body: HandoffRequest, x_internal_key: str = Header(default="")):
    _require_internal_key(x_internal_key)
    if not _handoff_available(app):
        # Chat ใน OA Manager ปิดอยู่ = ไม่มีใครเห็นแชท ถ้าให้บอทเงียบ ผู้ใช้จะพิมพ์ใส่ความว่างเปล่า
        return JSONResponse({"ok": False, "reason": "chat_off"}, status_code=409)

    store = app.state.store
    session = await store.get(body.line_user_id)
    until = time.time() + (body.hours or max(settings.handoff_hours, 0.1)) * 3600
    if session is not None and session.in_handoff():
        # กดซ้ำ / ผู้ใช้กดคุยกับเจ้าหน้าที่ไว้แล้ว — ต่อเวลาออกไป ไม่หดให้สั้นลง
        session.handoff_until = max(session.handoff_until, until)
    else:
        # เริ่ม session ใหม่หมดเหมือนตอนผู้ใช้กด "คุยกับเจ้าหน้าที่" เอง — ขั้นตอนแจ้งเรื่องที่ค้างอยู่
        # ถูกพักไว้ไม่ได้อยู่แล้ว (ระหว่างนี้ข้อความทุกอันเป็นของเจ้าหน้าที่) ปล่อยค้างไว้จะกลายเป็นข้อมูลเก่า
        name = session.line_display_name if session else None
        session = Session(step=IDLE, line_display_name=name, handoff_until=until)
    await store.set(body.line_user_id, session)
    # ไม่ log user id — log ของ container ถูกเก็บยาวและหลายคนเปิดดูได้
    logger.info("เจ้าหน้าที่รับแชทต่อเอง: บอทเงียบอีก %.1f ชม.", (session.handoff_until - time.time()) / 3600)
    return await _handoff_state(body.line_user_id, session)


@app.post("/internal/handoff/end")
async def handoff_end(body: HandoffRequest, x_internal_key: str = Header(default="")):
    _require_internal_key(x_internal_key)
    # "คืนให้บอทตอบ" = เปิดบอทกับคนนี้จริงๆ ไม่ว่าจะเงียบเพราะสาเหตุไหน (คุยกับเจ้าหน้าที่ / ทีม IT ปิดไว้)
    # ล้าง session เฉพาะตอนอยู่ในโหมดคุยกับเจ้าหน้าที่ — กดพลาดคนต้องไม่ทำให้เรื่องที่เขากรอกค้างหาย
    await resume_bot_for(app.state.store, body.line_user_id)
    return await _handoff_state(body.line_user_id, None)


# ---------------------------------------------------------------- API ภายใน: เปิด/ปิดบอท (หน้าเว็บ "บอท LINE")
#
# ทางหลักของการเปิด/ปิดบอทคือการ์ดในแชท LINE (พิมพ์ "แอดมิน") — เส้นนี้มีไว้ให้หน้าเว็บแสดงสถานะ
# และเป็นทางสำรองตอนมือถือไม่อยู่ใกล้ตัว ใช้ store ชุดเดียวกับการ์ด จึงเห็นค่าตรงกันเสมอ


class BotSwitchRequest(BaseModel):
    off: bool
    # ชื่อคนสั่ง (แสดงบนการ์ด/หน้าเว็บว่าใครปิดไว้) — ตัดความยาวกันข้อความยาวๆ ถูกยัดลง Redis
    by: str = Field(default="", max_length=80)


class BotUserSwitchRequest(BotSwitchRequest):
    line_user_id: str = Field(min_length=1, max_length=64)


async def _bot_status() -> dict:
    store = app.state.store
    offs = await store.list_user_off()
    users = []
    for uid, info in sorted(offs.items(), key=lambda kv: -(kv[1].get("since") or 0)):
        users.append({
            "line_user_id": uid,
            "name": await store.user_name(uid),
            "since": info.get("since"),
            "by": info.get("by"),
        })
    return {
        "ok": True,
        "bot_off": await store.get_bot_off(),
        "users_off": users,
        "chat_mode": _chat_mode_for_health(),
    }


@app.post("/internal/bot/status")
async def bot_status(x_internal_key: str = Header(default="")):
    _require_internal_key(x_internal_key)
    return await _bot_status()


@app.post("/internal/bot/global")
async def bot_global(body: BotSwitchRequest, x_internal_key: str = Header(default="")):
    _require_internal_key(x_internal_key)
    if body.off and not _handoff_available(app):
        # Chat ใน OA ปิดอยู่ = ไม่มีใครเห็นแชท ถ้าปิดบอทด้วย ผู้ใช้ทุกคนจะพิมพ์ใส่ความว่างเปล่า
        return JSONResponse({"ok": False, "reason": "chat_off"}, status_code=409)
    await app.state.store.set_bot_off(
        {"since": time.time(), "by": body.by.strip() or "หน้าเว็บ"} if body.off else None
    )
    logger.info("หน้าเว็บสั่ง%sบอททั้งระบบ", "ปิด" if body.off else "เปิด")
    return await _bot_status()


@app.post("/internal/bot/user")
async def bot_user(body: BotUserSwitchRequest, x_internal_key: str = Header(default="")):
    _require_internal_key(x_internal_key)
    store = app.state.store
    if body.off:
        if not _handoff_available(app):
            return JSONResponse({"ok": False, "reason": "chat_off"}, status_code=409)
        await pause_bot_for(store, body.line_user_id, by=body.by.strip() or "หน้าเว็บ")
    else:
        await resume_bot_for(store, body.line_user_id)
    return await _bot_status()


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


def _request_net(request: Request) -> tuple[str | None, str | None]:
    """ดึง IP ต้นทางและ user agent ของ request ที่วิ่งเข้ามา

    ⚠️ อ่านให้ดีว่านี่คือ IP ของใคร:
    webhook นี้ถูกยิงมาจาก **เซิร์ฟเวอร์ของ LINE** ไม่ใช่มือถือของพนักงาน
    ตอนพนักงานกดปุ่มในแชท มือถือของเขาคุยกับ LINE เท่านั้น ไม่เคยต่อมาที่เครื่องเราเลย
    ค่าที่ได้จึงเป็น IP ของ LINE (หรือของ Tailscale Funnel/Caddy ที่คั่นอยู่หน้าบ้าน)
    มีประโยชน์สำหรับตรวจว่า "request มาจาก LINE จริงไหม" แต่ห้ามเอาไปอ้างว่าเป็นเครื่องผู้ใช้

    X-Forwarded-For มาก่อนเพราะมี proxy คั่นอยู่จริง (Funnel/Caddy) ถ้าอ่าน request.client
    ตรงๆ จะได้ 127.0.0.1 ทุกครั้งซึ่งไม่มีประโยชน์เลย
    เอาเฉพาะ hop แรกและตัดความยาว กัน header ปลอมยาวๆ ถูกยัดลงไฟล์ log
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        ip = forwarded.split(",")[0].strip()[:64]
    else:
        ip = (getattr(request.client, "host", None) or "")[:64]
    ua = (request.headers.get("user-agent") or "")[:300]
    return (ip or None, ua or None)


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
    net = _request_net(request)
    await asyncio.gather(*(_safe_handle(request.app, e, net) for e in events))
    return {"ok": True}


async def _safe_handle(app: FastAPI, event, net: tuple[str | None, str | None]) -> None:
    try:
        await asyncio.wait_for(
            _handle_event(app, event, net), timeout=settings.event_timeout_seconds
        )
    except asyncio.TimeoutError:
        logger.error("ประมวลผล event นานเกิน %ss — ตัดจบ", settings.event_timeout_seconds)
    except Exception:
        logger.exception("ประมวลผล event ล้มเหลว")


async def _handle_event(app: FastAPI, event, net: tuple[str | None, str | None]) -> None:
    reply_token = getattr(event, "reply_token", None)

    user_id = getattr(getattr(event, "source", None), "user_id", None)
    if user_id:
        verdict = await _rate_limit_check(app, user_id)
        if verdict == "warn":
            if reply_token:
                await app.state.line.reply(reply_token, [M.rate_limited()])
            return
        if verdict == "drop":
            return

    # สถานะ "บอทเงียบกับคนนี้" ก่อนประมวลผล (คุยกับเจ้าหน้าที่ / ทีม IT ปิดบอทไว้)
    # ใช้ทั้งข้ามการโหลดรูป และตัดสินเรื่องสั่งอ่านแล้ว
    handoff_available = _handoff_available(app)
    was_handoff = bool(user_id) and await _bot_silent_for(app, user_id)

    incoming = await _to_incoming(
        app, event, net, skip_image_download=was_handoff and handoff_available
    )
    if incoming is None:
        return

    replies = await handle(
        incoming,
        app.state.store,
        app.state.backend,
        knowledge=app.state.knowledge,
        llm=app.state.llm,
        max_images=settings.max_images_per_ticket,
        max_image_mb=max(1, settings.max_image_bytes // (1024 * 1024)),
        handoff_hours=settings.handoff_hours,
        handoff_available=handoff_available,
    )
    if reply_token and replies:
        await app.state.line.reply(reply_token, replies)

    await _mark_read(app, event, user_id, replies, was_handoff=was_handoff)


async def _in_handoff(app: FastAPI, user_id: str) -> bool:
    session = await app.state.store.get(user_id)
    return bool(session is not None and session.in_handoff())


async def _bot_silent_for(app: FastAPI, user_id: str) -> bool:
    """บอทเงียบกับคนนี้อยู่ไหม — คุยกับเจ้าหน้าที่ หรือทีม IT ปิดบอท (ทั้งระบบ/เฉพาะคนนี้)

    ข้อความของคนที่บอทเงียบใส่เป็นของเจ้าหน้าที่ทั้งหมด: ห้ามสั่ง "อ่านแล้ว" (จะหลุดจากสายตาทีม IT)
    และไม่ต้องโหลดรูปเข้าระบบ (เจ้าหน้าที่ดูในแอป LINE OA เอง)
    """
    store = app.state.store
    if await store.get_bot_off() is not None or await store.get_user_off(user_id) is not None:
        return True
    return await _in_handoff(app, user_id)


async def _mark_read(app: FastAPI, event, user_id: str | None, replies, *, was_handoff: bool) -> None:
    """สั่ง "อ่านแล้ว" ให้ข้อความที่บอทจัดการให้เรียบร้อยแล้ว

    เป้าหมาย: แชทที่ขึ้น "ยังไม่อ่าน" ในแอป LINE Official Account ต้องเหลือเฉพาะคนที่รอคน
    ทีม IT จะได้ไล่ตอบจากตรงนั้นได้เลย ไม่ต้องเปิดดูทุกห้องที่บอทคุยจบไปแล้ว

    ไม่สั่งอ่านเมื่อ:
      - บอทไม่ได้ตอบ (เงียบเพราะกำลังคุยกับเจ้าหน้าที่) หรือคำตอบขอให้คงไว้ (keep_unread)
      - ก่อนหรือหลังข้อความนี้บอทเงียบกับคนนี้อยู่ (คุยกับเจ้าหน้าที่ / ทีม IT ปิดบอท)
        — LINE นับ "อ่านแล้ว" ย้อนหลังทุกข้อความ
        ในห้อง ถ้าสั่งตอนผู้ใช้กดกลับมาใช้บอท ข้อความที่พิมพ์ถึงเจ้าหน้าที่แต่ยังไม่มีใครเปิดดู
        จะกลายเป็นอ่านแล้วไปด้วย แล้วหลุดจากสายตาทีม IT
      - Chat ปิดอยู่ (LINE ขึ้นอ่านแล้วให้เองทุกข้อความ และ API นี้จะตอบ error)
    postback ไม่มี token ให้สั่ง — ปุ่มที่กดจึงไม่เกี่ยว
    """
    if not settings.mark_as_read or not replies or was_handoff or not user_id:
        return
    token = getattr(getattr(event, "message", None), "mark_as_read_token", None)
    if not token or any(getattr(r, "keep_unread", False) for r in replies):
        return
    if getattr(app.state, "chat_mode", None) == "bot":
        return
    if await _bot_silent_for(app, user_id):
        return
    await app.state.line.mark_as_read(token)


async def _rate_limit_check(app: FastAPI, user_id: str) -> str:
    """กันผู้ใช้คนเดียวยิง event เข้ามาถี่เกินไป

    คืน "ok" = ทำต่อได้ | "warn" = เพิ่งเกินลิมิต ให้ตอบเตือน 1 ครั้ง | "drop" = เงียบ

    ทำไมต้องเตือนแค่ครั้งเดียว: ถ้าตอบทุกครั้งที่เกินลิมิต บอทจะกลายเป็นตัวขยายสแปมเสียเอง
    (ยิงมา 100 ครั้ง = ตอบกลับ 100 ครั้ง) และเปลืองโควตาข้อความ แต่ถ้าเงียบตั้งแต่ครั้งแรก
    คนที่บังเอิญพิมพ์เร็วจะนึกว่าบอทล่ม — เตือนครั้งแรกครั้งเดียวจึงพอดี

    ถ้าตัวนับเองมีปัญหา (Redis ล่ม) ให้ปล่อยผ่าน — การกันสแปมพังไม่ควรทำให้บอททั้งตัวใช้ไม่ได้
    """
    limit = settings.rate_limit_per_minute
    if limit <= 0:
        return "ok"
    try:
        count = await app.state.rate_limiter.hit(user_id)
    except Exception:  # noqa: BLE001 - fail open ตามเหตุผลข้างบน
        logger.exception("ตัวนับ rate limit ทำงานไม่ได้ — ปล่อยผ่าน")
        return "ok"

    if count <= limit:
        return "ok"

    logger.warning("ผู้ใช้ %s ยิงเกินลิมิต (%s ครั้ง/นาที)", user_id, count)
    return "warn" if count == limit + 1 else "drop"


async def _to_incoming(
    app: FastAPI,
    event,
    net: tuple[str | None, str | None] = (None, None),
    *,
    skip_image_download: bool = False,
) -> Incoming | None:
    """แปลง event ของ SDK เป็นโครงสร้างกลาง — ตัดชนิดที่บอทไม่สนใจทิ้งตรงนี้

    skip_image_download: ผู้ใช้กำลังคุยกับเจ้าหน้าที่ — รูปเป็นของเจ้าหน้าที่ดูในแอป LINE OA
    ไม่ต้องโหลดมาอัปโหลดเข้าระบบ (flow จะเงียบใส่รูปนั้นอยู่แล้ว)
    """
    user_id = getattr(getattr(event, "source", None), "user_id", None)
    if not user_id:
        # เช่น event จากห้องกลุ่มที่ไม่มี userId — บอทนี้ออกแบบมาสำหรับแชท 1:1
        return None

    if isinstance(event, FollowEvent):
        display_name = await app.state.line.get_display_name(user_id)
        return Incoming(kind="follow", user_id=user_id, display_name=display_name)

    if isinstance(event, PostbackEvent):
        # แนบข้อมูล request เฉพาะ postback — เป็นทางเดียวที่ต้องบันทึก log การเปิดดู
        # (ปุ่ม "เช็คสถานะเรื่องนี้") ไม่ต้องไปพ่วงกับ event ชนิดอื่นให้รกเปล่าๆ
        client_ip, user_agent = net
        return Incoming(
            kind="postback",
            user_id=user_id,
            data=parse_postback(event.postback.data),
            display_name=await _display_name_if_new(app, user_id),
            client_ip=client_ip,
            user_agent=user_agent,
        )

    if isinstance(event, MessageEvent):
        message = event.message
        message_type = getattr(message, "type", None)

        if message_type == "text":
            return Incoming(
                kind="text",
                user_id=user_id,
                text=getattr(message, "text", "") or "",
                display_name=await _display_name_if_new(app, user_id),
            )

        if message_type == "image" and settings.accept_images:
            if skip_image_download:
                return Incoming(kind="image", user_id=user_id)
            return await _to_image_incoming(app, user_id, getattr(message, "id", ""))

        # สติกเกอร์ / วิดีโอ / เสียง / ไฟล์ / ตำแหน่ง — ตอบว่าอ่านไม่ได้ ดีกว่าเงียบ
        # (ของเดิมคืน None ที่ตรงนี้ ผู้ใช้ส่งสติกเกอร์มาแล้วบอทเงียบสนิท แยกไม่ออกว่าบอทล่มหรือเปล่า)
        return Incoming(
            kind="unsupported",
            user_id=user_id,
            display_name=await _display_name_if_new(app, user_id),
        )

    return None


async def _to_image_incoming(app: FastAPI, user_id: str, message_id: str) -> Incoming:
    """โหลดรูปจาก LINE แล้วอัปโหลดเข้าระบบ ก่อนส่งต่อให้ flow ตัดสินใจ

    ทำไมต้องโหลดตรงนี้ ไม่ใช่ใน flow.py: LINE เก็บไฟล์ไว้ให้ดาวน์โหลดได้ระยะเวลาจำกัด
    ถ้ารอไปทำทีหลังจะได้ 404 — และ flow.py ตั้งใจออกแบบไม่ให้รู้จัก LINE API เลย
    (เพื่อให้เทสต์บทสนทนาได้โดยไม่ต้องมี token) การโหลดไฟล์จึงต้องอยู่ฝั่งนี้

    ทุก error ถูกแปลงเป็น image_error แทนที่จะ throw — เพราะผู้ใช้ควรได้คำตอบเสมอ
    แม้รูปจะใช้ไม่ได้ ไม่ใช่เจอบอทเงียบ
    """
    if not message_id:
        return Incoming(kind="image", user_id=user_id, image_error="failed")

    display_name = await _display_name_if_new(app, user_id)
    try:
        content, content_type = await app.state.line.get_message_content(
            message_id, settings.max_image_bytes
        )
    except ImageTooLarge:
        logger.warning("รูปใหญ่เกินลิมิต message_id=%s", message_id)
        return Incoming(
            kind="image", user_id=user_id, display_name=display_name, image_error="too_large"
        )
    except Exception:  # noqa: BLE001 - ดูเหตุผลใน docstring
        logger.exception("ดาวน์โหลดรูปจาก LINE ไม่สำเร็จ message_id=%s", message_id)
        return Incoming(
            kind="image", user_id=user_id, display_name=display_name, image_error="failed"
        )

    try:
        url = await app.state.backend.upload_attachment(content, content_type)
    except BackendError:
        return Incoming(
            kind="image", user_id=user_id, display_name=display_name, image_error="failed"
        )

    return Incoming(kind="image", user_id=user_id, display_name=display_name, image_url=url)


async def _display_name_if_new(app: FastAPI, user_id: str) -> str | None:
    """ดึงชื่อโปรไฟล์เฉพาะตอนที่ยังไม่มี session อยู่ (คือเพิ่งเริ่มบทสนทนา)

    ทำไมไม่ดึงทุกครั้ง: get_profile เป็น API call จริง มีโควต้าและกินเวลา
    ถ้าเรียกทุกข้อความ บอทจะช้าลงโดยไม่ได้อะไรเพิ่ม เพราะชื่อไม่เปลี่ยนกลางบทสนทนา
    """
    session = await app.state.store.get(user_id)
    if session is not None:
        return session.line_display_name
    return await app.state.line.get_display_name(user_id)
