"""ห่อ line-bot-sdk v3 ไว้ชั้นเดียว เพื่อไม่ให้ detail ของ SDK รั่วเข้าไปใน flow

ประโยชน์: ถ้า LINE เปลี่ยน SDK (เคยเปลี่ยนมาแล้วตอน v2 -> v3 ซึ่ง breaking ทั้งหมด)
เราแก้แค่ไฟล์นี้ไฟล์เดียว flow.py กับ messages.py ไม่ต้องแตะ
"""

from __future__ import annotations

import json
import logging

import httpx
from linebot.v3.messaging import (
    AsyncApiClient,
    AsyncMessagingApi,
    Configuration,
    FlexMessage,
    FlexContainer,
    MarkMessagesAsReadByTokenRequest,
    PostbackAction,
    QuickReply,
    QuickReplyItem,
    ReplyMessageRequest,
    TextMessage,
)

from .messages import MAX_QUICK_REPLY_ITEMS, Reply, truncate_label

logger = logging.getLogger(__name__)

# LINE ตอบกลับได้สูงสุด 5 ข้อความต่อ 1 reply token
MAX_MESSAGES_PER_REPLY = 5


class ImageTooLarge(Exception):
    """รูปใหญ่เกินลิมิตที่ตั้งไว้ — flow จะเอาไปแปลงเป็นข้อความบอกผู้ใช้"""


class LineApi:
    def __init__(
        self,
        access_token: str,
        host: str = "",
        blob_host: str = "https://api-data.line.me",
    ) -> None:
        # host ว่าง = ยิงไป https://api.line.me ตามปกติ
        # ใส่ค่าได้เมื่อต้องการชี้ไปเซิร์ฟเวอร์จำลองตอนทดสอบ end-to-end โดยไม่ยิงของจริง
        # host เป็น read-only property ของ Configuration ต้องส่งตอนสร้างเท่านั้น (set ทีหลังไม่ได้)
        config = (
            Configuration(access_token=access_token, host=host.strip())
            if host.strip()
            else Configuration(access_token=access_token)
        )
        self._client = AsyncApiClient(config)
        self._api = AsyncMessagingApi(self._client)
        # สถานะล่าสุดของการสั่ง "อ่านแล้ว" — ไว้ log เฉพาะตอนเปลี่ยนสถานะ ไม่ใช่ทุกข้อความ
        self._mark_read_ok: bool | None = None

        # ดาวน์โหลดไฟล์ใช้ httpx ตรงๆ แทน SDK โดยตั้งใจ 2 เหตุผล:
        #   1. ต้องอ่านแบบ stream เพื่อ "ตัดจบกลางทาง" เมื่อไฟล์ใหญ่เกินลิมิต
        #      SDK โหลดทั้งก้อนเข้าหน่วยความจำก่อนเสมอ ซึ่งลิมิตจะไม่ทันกิน
        #   2. ชี้ host เองได้ ทำให้เทสต์ e2e ยิงไปเซิร์ฟเวอร์จำลองได้เหมือนฝั่งส่งข้อความ
        # ถ้า host ถูก override (โหมดทดสอบ) ให้ blob ใช้ host เดียวกัน จะได้ไม่หลุดไปยิงของจริง
        effective_blob_host = host.strip() or blob_host.strip() or "https://api-data.line.me"
        self._blob = httpx.AsyncClient(
            base_url=effective_blob_host.rstrip("/"),
            timeout=20.0,
            headers={"Authorization": f"Bearer {access_token}"},
        )

    async def aclose(self) -> None:
        await self._client.close()
        await self._blob.aclose()

    async def get_message_content(
        self, message_id: str, max_bytes: int
    ) -> tuple[bytes, str]:
        """ดาวน์โหลดไฟล์ที่ผู้ใช้ส่งมา (รูป/วิดีโอ/ไฟล์) จาก LINE Content API

        คืน (ไบต์ของไฟล์, content-type)

        หมายเหตุ: LINE เก็บไฟล์ไว้ให้ดาวน์โหลดได้ระยะเวลาจำกัดหลังผู้ใช้ส่ง
        ถ้าโหลดช้าเกินไปจะได้ 404 — จึงต้องโหลดทันทีตอนรับ event ไม่ใช่ทิ้งไว้โหลดทีหลัง
        """
        async with self._blob.stream(
            "GET", f"/v2/bot/message/{message_id}/content"
        ) as response:
            response.raise_for_status()

            # เช็ค Content-Length ก่อนถ้ามี — ประหยัดกว่ารอโหลดจนเกินแล้วค่อยรู้
            declared = response.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > max_bytes:
                raise ImageTooLarge(declared)

            chunks: list[bytes] = []
            total = 0
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                # LINE ไม่ได้ส่ง content-length มาทุกครั้ง จึงต้องนับระหว่างโหลดด้วย
                if total > max_bytes:
                    raise ImageTooLarge(str(total))
                chunks.append(chunk)

            content_type = (
                response.headers.get("content-type", "image/jpeg").split(";")[0].strip()
            )
            return b"".join(chunks), content_type

    async def reply(self, reply_token: str, replies: list[Reply]) -> None:
        messages = to_line_messages(replies)
        if not messages:
            return
        await self._api.reply_message(
            ReplyMessageRequest(reply_token=reply_token, messages=messages)
        )

    async def mark_as_read(self, token: str) -> bool:
        """สั่ง "อ่านแล้ว" ให้ข้อความของผู้ใช้ (LINE นับรวมทุกข้อความก่อนหน้าในห้องนั้นด้วย)

        มีผลเฉพาะตอนเปิด Chat ใน OA Manager — ตอนปิด LINE ขึ้นอ่านแล้วให้เองทุกข้อความอยู่แล้ว
        ทำแบบ best-effort: พลาดแค่ทำให้แชทค้าง "ยังไม่อ่าน" ในแอป OA ห้ามทำให้ event พัง
        """
        if not token:
            return False
        try:
            await self._api.mark_messages_as_read_by_token(
                MarkMessagesAsReadByTokenRequest(mark_as_read_token=token)
            )
        except Exception as exc:  # noqa: BLE001 - ดูเหตุผลใน docstring
            if self._mark_read_ok is not False:
                logger.warning("สั่งอ่านแล้วไม่สำเร็จ (Chat ใน OA Manager ปิดอยู่หรือเปล่า?): %s", exc)
            self._mark_read_ok = False
            return False
        if self._mark_read_ok is False:
            logger.info("สั่งอ่านแล้วกลับมาใช้ได้แล้ว")
        self._mark_read_ok = True
        return True

    async def get_bot_info(self) -> dict | None:
        """ข้อมูลบัญชี LINE OA — ที่ต้องใช้คือ chat_mode ("chat" = เปิด Chat / "bot" = ปิด)

        บอทต้องรู้ว่าเปิด Chat อยู่ไหม เพราะถ้าปิด เจ้าหน้าที่มองไม่เห็นแชทเลย
        การส่งต่อให้เจ้าหน้าที่จะกลายเป็นให้ลูกค้าพิมพ์ใส่ความว่างเปล่า
        """
        try:
            info = await self._api.get_bot_info()
        except Exception as exc:  # noqa: BLE001 - ไม่รู้ก็แค่ใช้ค่าเริ่มต้น ไม่ควรทำให้บอทล้ม
            logger.warning("ดึงข้อมูลบัญชี LINE OA ไม่สำเร็จ: %s", exc)
            return None
        return {
            "chat_mode": str(info.chat_mode or "").lower() or None,
            "mark_as_read_mode": str(info.mark_as_read_mode or "").lower() or None,
            "basic_id": info.basic_id,
            "display_name": info.display_name,
        }

    async def get_display_name(self, user_id: str) -> str | None:
        """ดึงชื่อโปรไฟล์ LINE — ถ้าดึงไม่ได้ให้คืน None ไม่ต้อง throw

        เหตุผล: ชื่อเป็นแค่ของประดับข้อความทักทาย ถ้าดึงไม่ได้ (ผู้ใช้บล็อกบอท / token หมดอายุ)
        บทสนทนาต้องเดินต่อได้ ไม่ใช่พังทั้ง event
        """
        try:
            profile = await self._api.get_profile(user_id)
            return profile.display_name
        except Exception as exc:  # noqa: BLE001 - ตั้งใจกลืน error ทุกชนิดตามเหตุผลด้านบน
            logger.warning("ดึงโปรไฟล์ไม่สำเร็จ user=%s err=%s", user_id, exc)
            return None


def to_line_messages(replies: list[Reply]):
    """แปลง Reply ของเราเป็นข้อความของ LINE (TextMessage หรือ FlexMessage)

    จุดที่พลาดกันบ่อย: LINE จะแสดง quick reply ของ "ข้อความสุดท้าย" เท่านั้น
    ถ้าใส่ปุ่มไว้ที่บับเบิลกลางๆ ผู้ใช้จะไม่เห็นปุ่มนั้นเลย ฟังก์ชันนี้จึงรวบปุ่มทั้งหมด
    ไปไว้ที่ข้อความสุดท้ายให้อัตโนมัติ

    Reply ที่มี flex จะถูกส่งเป็นการ์ด โดยใช้ `text` เป็น altText เสมอ —
    altText คือสิ่งที่โผล่ในหน้าจอแจ้งเตือนและในแอปที่แสดง Flex ไม่ได้
    ถ้าปล่อยว่างผู้ใช้จะเห็นแค่ "ข้อความ" ลอยๆ ไม่รู้ว่าเรื่องอะไร
    """
    trimmed = replies[:MAX_MESSAGES_PER_REPLY]
    if not trimmed:
        return []

    # หาปุ่มจาก Reply ตัวท้ายสุดที่มีปุ่ม
    quick_items: list[tuple[str, str]] = []
    for reply in reversed(trimmed):
        if reply.quick:
            quick_items = reply.quick
            break

    messages = []
    for index, reply in enumerate(trimmed):
        is_last = index == len(trimmed) - 1
        quick_reply = None
        if is_last and quick_items:
            quick_reply = QuickReply(
                items=[
                    QuickReplyItem(
                        action=PostbackAction(
                            label=truncate_label(label),
                            data=data,
                            # display_text = ข้อความที่จะโชว์ฝั่งผู้ใช้เหมือนเขาพิมพ์เอง
                            # ใส่ไว้เพื่อให้ประวัติแชทอ่านรู้เรื่องว่ากดอะไรไป
                            display_text=label,
                            input_option="openKeyboard" if data == "a=describe_request" else None,
                        )
                    )
                    for label, data in quick_items[:MAX_QUICK_REPLY_ITEMS]
                ]
            )

        if reply.flex:
            try:
                messages.append(
                    FlexMessage(
                        alt_text=_alt_text(reply.text),
                        contents=FlexContainer.from_json(json.dumps(reply.flex, ensure_ascii=False)),
                        quick_reply=quick_reply,
                    )
                )
                continue
            except Exception:  # noqa: BLE001
                # การ์ดพังไม่ควรทำให้ผู้ใช้ไม่ได้รับคำตอบอะไรเลย — ตกกลับไปเป็นข้อความธรรมดา
                logger.exception("สร้าง FlexMessage ไม่สำเร็จ — ตกกลับไปใช้ข้อความธรรมดา")

        messages.append(TextMessage(text=reply.text, quick_reply=quick_reply))

    return messages


# altText ของ LINE ยาวได้ไม่เกิน 400 ตัวอักษร ถ้าเกินจะถูกปฏิเสธทั้ง request
MAX_ALT_TEXT = 400


def _alt_text(text: str) -> str:
    cleaned = (text or "").strip() or "มีข้อความใหม่จากระบบ IT Support"
    if len(cleaned) <= MAX_ALT_TEXT:
        return cleaned
    return cleaned[: MAX_ALT_TEXT - 1] + "…"
