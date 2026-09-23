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

from . import messages as M
from .ai import KnowledgeCache, compose_answer_with_llm
from .backend import BackendClient, BackendError
from .config import settings
from .flow import ASK_BRANCH, BRANCH_START_LEVEL, Incoming, handle, parse_postback
from .line_api import ImageTooLarge, LineApi
from .richmenu import RichMenuError, ensure_rich_menu
from .store import build_rate_limiter, build_store

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
    app.state.richmenu_status = "ปิดการติดตั้งอัตโนมัติ" if not settings.richmenu_auto_install else "กำลังติดตั้ง..."
    if settings.richmenu_auto_install:
        asyncio.create_task(_install_rich_menu(app))

    try:
        yield
    finally:
        await app.state.line.aclose()
        await app.state.backend.aclose()


app = FastAPI(title="IT Support LINE Bot", lifespan=lifespan)


async def _install_rich_menu(app: FastAPI) -> None:
    """ติดตั้ง rich menu — ห้ามทำให้บอทตายไม่ว่าจะพังยังไง

    เก็บผลไว้ที่ app.state.richmenu_status เพื่อให้ /health บอกได้ว่าติดตั้งผ่านไหม
    ไม่งั้นต้องไปไล่อ่าน log ซึ่งคนที่ deploy มักไม่ได้ดู
    """
    try:
        app.state.richmenu_status = await ensure_rich_menu(
            settings.line_channel_access_token,
            settings.richmenu_image_path,
            data_image_path=settings.richmenu_data_image_path,
            # line_api_host ถูกตั้งเฉพาะตอนทดสอบ e2e — ถ้ามีค่าให้ชี้ไปที่นั่นทั้งคู่
            # จะได้ไม่มีทางยิงไป LINE จริงระหว่างเทสต์
            api_host=settings.line_api_host or "https://api.line.me",
            blob_host=settings.line_api_host or settings.line_blob_host,
            force=settings.richmenu_force_reinstall,
        )
        logger.info("rich menu: %s", app.state.richmenu_status)
    except RichMenuError as exc:
        app.state.richmenu_status = f"ล้มเหลว: {exc}"
        logger.error("ติดตั้ง rich menu ไม่สำเร็จ: %s", exc)
    except Exception as exc:  # noqa: BLE001 - บอทต้องทำงานต่อได้แม้เมนูติดตั้งไม่ขึ้น
        app.state.richmenu_status = f"ล้มเหลว: {exc}"
        logger.exception("ติดตั้ง rich menu ไม่สำเร็จ (ข้อผิดพลาดที่ไม่คาดคิด)")


@app.get("/health")
async def health():
    return {
        "ok": True,
        "state_backend": "redis" if settings.use_redis else "memory",
        "accept_images": settings.accept_images,
        "rate_limit_per_minute": settings.rate_limit_per_minute,
        "richmenu": getattr(app.state, "richmenu_status", "ยังไม่ทราบ"),
        # ขั้นตอนแรกของบทสนทนาที่โค้ดชุดนี้ใช้ — ให้ deploy.ps1 ตรวจได้ว่าบอทรันโค้ดใหม่จริง
        # (ดูจากอาการไม่ได้ เพราะบอทเก่าก็ตอบข้อความเหมือนกัน แค่ไม่มีขั้นตอนเลือกบริษัท)
        "first_step": ASK_BRANCH,
        "first_selection": BRANCH_START_LEVEL,
        # ทักต้อนรับกลับหลังหายไปกี่วัน (0 = ปิด) — อยู่ใน /health เพราะดูจากอาการไม่ได้เลย
        # ต้องรอให้มีคนหายไปครบตามกำหนดแล้วกลับมาถึงจะรู้ว่าโค้ดชุดใหม่ขึ้นแล้วหรือยัง
        "welcome_back_days": settings.welcome_back_days,
    }


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

    incoming = await _to_incoming(app, event, net)
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
    )
    if reply_token and replies:
        await app.state.line.reply(reply_token, replies)


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


async def _to_incoming(app: FastAPI, event, net: tuple[str | None, str | None] = (None, None)) -> Incoming | None:
    """แปลง event ของ SDK เป็นโครงสร้างกลาง — ตัดชนิดที่บอทไม่สนใจทิ้งตรงนี้"""
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
