"""ห่อ line-bot-sdk v3 ไว้ชั้นเดียว เพื่อไม่ให้ detail ของ SDK รั่วเข้าไปใน flow

ประโยชน์: ถ้า LINE เปลี่ยน SDK (เคยเปลี่ยนมาแล้วตอน v2 -> v3 ซึ่ง breaking ทั้งหมด)
เราแก้แค่ไฟล์นี้ไฟล์เดียว flow.py กับ messages.py ไม่ต้องแตะ
"""

from __future__ import annotations

import logging

from linebot.v3.messaging import (
    AsyncApiClient,
    AsyncMessagingApi,
    Configuration,
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


class LineApi:
    def __init__(self, access_token: str, host: str = "") -> None:
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

    async def aclose(self) -> None:
        await self._client.close()

    async def reply(self, reply_token: str, replies: list[Reply]) -> None:
        messages = to_line_messages(replies)
        if not messages:
            return
        await self._api.reply_message(
            ReplyMessageRequest(reply_token=reply_token, messages=messages)
        )

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


def to_line_messages(replies: list[Reply]) -> list[TextMessage]:
    """แปลง Reply ของเราเป็น TextMessage ของ LINE

    จุดที่พลาดกันบ่อย: LINE จะแสดง quick reply ของ "ข้อความสุดท้าย" เท่านั้น
    ถ้าใส่ปุ่มไว้ที่บับเบิลกลางๆ ผู้ใช้จะไม่เห็นปุ่มนั้นเลย ฟังก์ชันนี้จึงรวบปุ่มทั้งหมด
    ไปไว้ที่ข้อความสุดท้ายให้อัตโนมัติ
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

    messages: list[TextMessage] = []
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
                        )
                    )
                    for label, data in quick_items[:MAX_QUICK_REPLY_ITEMS]
                ]
            )
        messages.append(TextMessage(text=reply.text, quick_reply=quick_reply))

    return messages
