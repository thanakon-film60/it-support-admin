"""ที่เก็บ state ของบทสนทนา (ใครคุยอยู่ step ไหน)

ทำไมต้องมี: LINE ไม่ได้เก็บ state ให้ ทุก webhook event ที่ยิงเข้ามาเป็นอิสระจากกัน
เรารู้แค่ userId กับข้อความล่าสุด — ถ้าไม่เก็บเองจะทำบทสนทนาหลาย step ไม่ได้เลย

มี 2 implementation หลัง interface เดียวกัน:
  - MemoryStore : dict ในหน่วยความจำ — ใช้ตอน dev เท่านั้น
                  ข้อจำกัดที่ต้องรู้: restart แล้วหาย และถ้ารันหลาย worker/หลาย pod
                  แต่ละตัวจะเห็น state คนละชุด ผู้ใช้จะเจออาการ "บอทลืมว่าคุยถึงไหน"
  - RedisStore  : ใช้จริงบน production — รอด restart และ worker ทุกตัวเห็นชุดเดียวกัน

การสลับทำผ่าน env REDIS_URL อย่างเดียว โค้ด flow ไม่ต้องแก้แม้แต่บรรทัดเดียว
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Protocol


@dataclass
class Session:
    """สถานะบทสนทนาของผู้ใช้ 1 คน"""

    step: str = "IDLE"
    ticket_type: str | None = None
    branch: str | None = None
    asset_code: str | None = None
    asset_label: str | None = None  # ข้อความสวยๆ ของทรัพย์สินที่เจอ เช่น "NB2501001 — LENOVO ThinkPad E14"
    asset_asked: bool = False  # ถามเรื่องรหัสทรัพย์สินไปแล้วหรือยัง (กันถามซ้ำตอน AI เติมให้ล่วงหน้า)
    items: list[dict[str, Any]] = field(default_factory=list)  # [{"name": str, "qty": int}]
    pending_item_name: str | None = None  # ของที่เพิ่งเลือก กำลังรอให้พิมพ์จำนวน
    pending_item_unit: str = "ชิ้น"
    requester_name: str | None = None
    requester_department: str | None = None
    description: str | None = None
    line_display_name: str | None = None
    updated_at: float = field(default_factory=time.time)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @classmethod
    def from_json(cls, raw: str) -> "Session":
        return cls(**json.loads(raw))


class ConversationStore(Protocol):
    async def get(self, user_id: str) -> Session | None: ...
    async def set(self, user_id: str, session: Session) -> None: ...
    async def clear(self, user_id: str) -> None: ...


class MemoryStore:
    """เก็บใน process — เหมาะกับ dev / ทดสอบ เท่านั้น"""

    def __init__(self, ttl_seconds: int) -> None:
        self._ttl = ttl_seconds
        self._data: dict[str, Session] = {}

    async def get(self, user_id: str) -> Session | None:
        session = self._data.get(user_id)
        if session is None:
            return None
        if time.time() - session.updated_at > self._ttl:
            # หมดอายุแล้ว — ลบทิ้งและถือว่าไม่มี เพื่อให้ผู้ใช้เริ่มใหม่แทนที่จะคุยต่อจากเมื่อวาน
            self._data.pop(user_id, None)
            return None
        return session

    async def set(self, user_id: str, session: Session) -> None:
        session.updated_at = time.time()
        self._data[user_id] = session
        self._evict_expired()

    async def clear(self, user_id: str) -> None:
        self._data.pop(user_id, None)

    def _evict_expired(self) -> None:
        """กวาด session ที่หมดอายุทิ้ง — กัน memory โตขึ้นเรื่อยๆ จากคนที่คุยค้างแล้วหายไป
        (Redis ไม่ต้องทำเพราะมี TTL ในตัว)"""
        now = time.time()
        expired = [k for k, v in self._data.items() if now - v.updated_at > self._ttl]
        for k in expired:
            self._data.pop(k, None)


class RedisStore:
    """เก็บบน Redis — ใช้บน production"""

    def __init__(self, url: str, ttl_seconds: int, prefix: str = "linebot:session:") -> None:
        import redis.asyncio as aioredis  # import ตรงนี้เพื่อไม่บังคับให้ dev ต้องมี redis

        self._redis = aioredis.from_url(url, decode_responses=True)
        self._ttl = ttl_seconds
        self._prefix = prefix

    def _key(self, user_id: str) -> str:
        return f"{self._prefix}{user_id}"

    async def get(self, user_id: str) -> Session | None:
        raw = await self._redis.get(self._key(user_id))
        return Session.from_json(raw) if raw else None

    async def set(self, user_id: str, session: Session) -> None:
        session.updated_at = time.time()
        # setex = set + หมดอายุอัตโนมัติ ไม่ต้องเขียน cleanup job เอง
        await self._redis.setex(self._key(user_id), self._ttl, session.to_json())

    async def clear(self, user_id: str) -> None:
        await self._redis.delete(self._key(user_id))


def build_store(redis_url: str, ttl_seconds: int) -> ConversationStore:
    if redis_url.strip():
        return RedisStore(redis_url, ttl_seconds)
    return MemoryStore(ttl_seconds)
