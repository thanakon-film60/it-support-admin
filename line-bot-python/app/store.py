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
from dataclasses import asdict, dataclass, field, fields
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
    description_collected: bool = False  # Free-text shortcut may collect details before requester/items.
    line_display_name: str | None = None
    # URL รูปที่ผู้ใช้ส่งเข้ามาระหว่างแจ้งเรื่อง (อัปโหลดเข้าระบบแล้ว) — แนบไปกับ ticket ตอนส่ง
    image_urls: list[str] = field(default_factory=list)
    # ตัวเลือกทรัพย์สินที่รอให้ผู้ใช้เลือก ตอนรหัสเดียวตรงกับหลายเครื่อง
    # เก็บเป็น [{"id", "asset_code", "label"}] — เก็บ label สำเร็จรูปไว้เลย
    # จะได้ไม่ต้องยิงถาม backend ซ้ำตอนผู้ใช้กดปุ่ม
    asset_choices: list[dict[str, Any]] = field(default_factory=list)
    # ---- สถานะของเมนูเลือกทรัพย์สินทีละชั้น (ประเภท -> ยี่ห้อ/รุ่น -> รหัส) ----
    #
    # เก็บไว้ในนี้แทนการยัดลง postback data เพราะ LINE จำกัด data ไว้ที่ 300 ไบต์
    # ชื่อยี่ห้อ/รุ่นภาษาไทยพอ encode แล้วกินตัวละ 9 ไบต์ ยาวนิดเดียวก็ทะลุ
    # ปุ่มจึงส่งมาแค่ "ลำดับที่เท่าไหร่" แล้วมาเปิดค่าจริงจาก pick_values ที่นี่
    pick_level: str | None = None          # "category" | "brand" | "code"
    pick_category: str | None = None
    pick_brand: str | None = None
    # เมนูเลือกสาขาใช้ช่องเก็บชุดเดียวกัน (pick_values / pick_labels / pick_page)
    # แยกกันได้จาก pick_level: สาขาใช้ company|group|branch ส่วนทรัพย์สินใช้ category|brand|code
    # และสองเมนูนี้ไม่มีทางทำงานพร้อมกัน เพราะเลือกสาขาจบก่อนถึงจะถามทรัพย์สิน
    pick_company: str | None = None
    pick_company_label: str | None = None
    pick_group: str | None = None
    pick_group_label: str | None = None
    pick_page: int = 0
    pick_values: list[str] = field(default_factory=list)
    pick_labels: list[str] = field(default_factory=list)
    # เก็บ "ชื่อที่คนอ่าน" ของประเภทที่เลือกไว้ด้วย (เช่น notebook -> โน้ตบุ๊ค)
    # เพราะฝั่งบอทไม่มีตารางแปลชื่อประเภท ตัวแปลอยู่ฝั่ง Next.js ที่เดียว
    pick_category_label: str | None = None
    updated_at: float = field(default_factory=time.time)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @classmethod
    def from_json(cls, raw: str) -> "Session":
        data = json.loads(raw)
        # ทิ้งคีย์ที่ไม่รู้จักแทนที่จะ TypeError
        #
        # เหตุผล: session ค้างอยู่ใน Redis นานถึง 30 นาที ตอน deploy เวอร์ชันที่ "ลบฟิลด์ออก"
        # (หรือตอน rollback) จะมี session รูปแบบเก่าค้างอยู่ ถ้าปล่อยให้ throw ผู้ใช้ที่กำลังคุยค้างไว้
        # จะเจอบอทเงียบไปเลยจนกว่า session จะหมดอายุ — ทิ้งฟิลด์ที่ไม่รู้จักแล้วคุยต่อดีกว่ามาก
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in known})


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


# ---------------------------------------------------------------- กันสแปม


class RateLimiter(Protocol):
    async def hit(self, user_id: str) -> int:
        """นับ 1 ครั้งแล้วคืนจำนวนครั้งสะสมในหน้าต่างเวลาปัจจุบัน"""
        ...


class MemoryRateLimiter:
    """นับในหน่วยความจำ — ใช้ตอน dev หรือเมื่อไม่ได้ตั้ง Redis

    ข้อจำกัดเหมือน MemoryStore: ถ้ารันหลาย worker แต่ละตัวนับแยกกัน
    ลิมิตจริงจะกลายเป็น (limit × จำนวน worker) จึงไม่ควรใช้บน production
    """

    def __init__(self, window_seconds: int = 60) -> None:
        self._window = window_seconds
        self._hits: dict[str, list[float]] = {}

    async def hit(self, user_id: str) -> int:
        now = time.time()
        cutoff = now - self._window
        recent = [t for t in self._hits.get(user_id, []) if t > cutoff]
        recent.append(now)
        self._hits[user_id] = recent

        # กวาดคนที่เงียบไปแล้วทิ้ง ไม่ให้ dict โตขึ้นเรื่อยๆ ตามจำนวนคนที่เคยทักมา
        if len(self._hits) > 1000:
            self._hits = {
                uid: ts for uid, ts in self._hits.items() if ts and ts[-1] > cutoff
            }
        return len(recent)


class RedisRateLimiter:
    """นับบน Redis — worker ทุกตัวเห็นตัวนับเดียวกัน

    ใช้ fixed window (INCR + EXPIRE) ไม่ใช่ sliding window เพราะต้องการแค่
    "กันคนกดรัว/สคริปต์ยิง" ไม่ได้ต้องการความแม่นระดับวินาที และ fixed window
    ใช้คำสั่ง Redis แค่ 2 คำสั่งต่อ event ซึ่งถูกกว่ามาก
    """

    def __init__(self, url: str, window_seconds: int = 60, prefix: str = "linebot:rate:") -> None:
        import redis.asyncio as aioredis

        self._redis = aioredis.from_url(url, decode_responses=True)
        self._window = window_seconds
        self._prefix = prefix

    async def hit(self, user_id: str) -> int:
        # ใส่เลขหน้าต่างเวลาลงใน key เอง — พอข้ามนาที key จะเปลี่ยนและเริ่มนับใหม่อัตโนมัติ
        bucket = int(time.time() // self._window)
        key = f"{self._prefix}{user_id}:{bucket}"
        pipe = self._redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, self._window + 5)
        count, _ = await pipe.execute()
        return int(count)


def build_rate_limiter(redis_url: str, window_seconds: int = 60) -> RateLimiter:
    if redis_url.strip():
        return RedisRateLimiter(redis_url, window_seconds)
    return MemoryRateLimiter(window_seconds)
