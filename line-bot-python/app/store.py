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
from uuid import uuid4


@dataclass
class Session:
    """สถานะบทสนทนาของผู้ใช้ 1 คน"""

    step: str = "IDLE"

    # ---- กันสร้าง ticket ซ้ำตอนกด "ลองส่งใหม่" ----
    #
    # "บอทส่งไม่สำเร็จ" ไม่ได้แปลว่าหลังบ้านไม่ได้สร้าง ticket — timeout หลังจากเขียนข้อมูล
    # ลงไปแล้วเป็นเคสคลาสสิก ถ้ากดส่งซ้ำแล้วยิงเข้าไปเฉยๆ จะได้ ticket 2 ใบและตัดสต็อกซ้ำ 2 รอบ
    #
    # request_id เกิดพร้อม session และคงเดิมตลอด รวมถึงตอนถูก serialize ลง Redis แล้วอ่านกลับมา
    # (เป็นฟิลด์ธรรมดาจึงติดไปกับ asdict/from_json) หลังบ้านเจอค่าซ้ำจะคืน ticket เดิมแทนการสร้างใหม่
    request_id: str = field(default_factory=lambda: uuid4().hex)

    ticket_type: str | None = None
    branch: str | None = None
    asset_code: str | None = None
    asset_label: str | None = None
    # id ของ "เครื่อง" ที่ผูกแล้วจริงๆ — ไม่ใช่รหัสที่พิมพ์มา เพราะรหัสซ้ำกันได้ (ของจริงซ้ำอยู่ 28 แถว)
    # ถ้าส่งแต่ asset_code หลังบ้านต้องเดาเอง แล้ว ticket จะผูกกับเครื่องผิดสาขาโดยไม่มีใครรู้
    equipment_id: str | None = None  # ข้อความสวยๆ ของทรัพย์สินที่เจอ เช่น "NB2501001 — LENOVO ThinkPad E14"
    asset_asked: bool = False  # ถามเรื่องรหัสทรัพย์สินไปแล้วหรือยัง (กันถามซ้ำตอน AI เติมให้ล่วงหน้า)
    items: list[dict[str, Any]] = field(default_factory=list)  # [{"name": str, "qty": int}]
    pending_item_name: str | None = None  # ของที่เพิ่งเลือก กำลังรอให้พิมพ์จำนวน
    pending_item_unit: str = "ชิ้น"
    requester_name: str | None = None
    requester_department: str | None = None
    description: str | None = None
    # ข้อความแรกที่ผู้ใช้พิมพ์มาตอนเปิดเรื่อง (เช่น "NB2501001 เปิดไม่ติด ที่สำนักงานใหญ่")
    #
    # เก็บแยกจาก description เพราะมันคือ "คำบอกเล่าของผู้ใช้" ที่มีบริบทครบที่สุด
    # และเป็นเหตุผลที่บอทไม่ต้องบังคับให้พิมพ์รายละเอียดซ้ำอีกรอบตอนถึงขั้น ASK_DESC
    initial_message: str | None = None
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

    # ---- ผู้แจ้ง (จากทะเบียนพนักงาน) ----
    # requester_user_id = id แถวใน users ของระบบแอดมิน ส่งไปกับ ticket เพื่อผูกประวัติให้ถูกคน
    # ถ้าไม่มีค่านี้ หลังบ้านจะตกไปใช้ "หาจากชื่อ ถ้าไม่เจอสร้างใหม่" ซึ่งทำให้คนคนเดียว
    # กลายเป็นหลายแถวได้ถ้าสะกดต่างกันนิดเดียว
    requester_user_id: str | None = None
    # เคยถามหลังบ้านแล้วว่าบัญชีนี้ผูกกับใคร (True แม้ผลจะเป็น "ยังไม่ผูก")
    # ถ้าไม่มีธงนี้ บอทจะยิงถามซ้ำทุกครั้งที่เดินผ่านขั้นตอนผู้แจ้ง ซึ่งเกิดได้หลายรอบต่อ 1 เรื่อง
    rq_checked: bool = False
    #
    # เมนูเลือกผู้แจ้งใช้ช่องของตัวเอง ไม่ใช้ pick_* ร่วมกับเมนูสาขา/ทรัพย์สิน
    # เพราะผู้ใช้กด "เปลี่ยนคนแจ้ง" ย้อนกลับมาตอนไหนก็ได้ รวมถึงตอนที่ค่าของเมนูอื่นยังต้องใช้อยู่
    rq_level: str | None = None            # "dept" | "person"
    rq_dept: str | None = None
    rq_page: int = 0
    rq_values: list[str] = field(default_factory=list)
    rq_labels: list[str] = field(default_factory=list)
    # คนที่ค้นเจอแล้วรอให้กดยืนยัน — เก็บทั้ง dict เพราะต้องใช้ชื่อ/ฝ่ายไปแสดงตอนยืนยัน
    rq_pending: dict[str, Any] | None = None

    # ---- รอความเห็นหลังให้คะแนนต่ำ (step = RATE_COMMENT) ----
    # เลขที่เรื่องที่เพิ่งให้คะแนน — ข้อความถัดไปที่พิมพ์มาคือความเห็นของเรื่องนี้
    # เก็บใน session ไม่ใช่ใส่ใน postback เพราะความเห็นมาเป็น "ข้อความพิมพ์" ซึ่งไม่มีเลขที่ติดมาด้วย
    rate_code: str | None = None

    # ---- ส่งต่อให้เจ้าหน้าที่ ----
    # เวลา (epoch) ที่บอทจะกลับมาตอบคนนี้เอง — 0 = บอทตอบตามปกติ
    # อยู่ใน session เดียวกับบทสนทนา แต่ต้องอยู่ได้นานกว่า session ปกติ (30 นาที) มาก เพราะ
    # เจ้าหน้าที่อาจตอบช้าเป็นชั่วโมง — store ทั้งสองแบบจึงยืดอายุ session ให้ถึงเวลานี้เสมอ
    handoff_until: float = 0.0

    updated_at: float = field(default_factory=time.time)

    def in_handoff(self, now: float | None = None) -> bool:
        """กำลังให้เจ้าหน้าที่คุยอยู่ไหม (บอทต้องเงียบกับคนนี้)"""
        return self.handoff_until > (time.time() if now is None else now)

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


# ---------------------------------------------------------------- ทีม IT สั่งเปิด/ปิดบอท
#
# เก็บแยกจาก session โดยตั้งใจ: session หมดอายุใน 30 นาที และถูกล้างทิ้งได้หลายทาง (พิมพ์ "ยกเลิก"
# / กดเพิ่มเพื่อนใหม่ / ส่งเรื่องเสร็จ) แต่ "ปิดบอทกับคนนี้" ต้องอยู่จนกว่าทีม IT จะสั่งเปิดเอง
# ถ้าฝากไว้ใน session ผู้ใช้พิมพ์ "ยกเลิก" ครั้งเดียว บอทก็กลับมาตอบแทรกเจ้าหน้าที่ทั้งที่ไม่มีใครสั่ง
#
# ค่าที่เก็บ (info) เป็น dict เล็กๆ {"since": epoch, "by": ชื่อคนสั่ง} — ไว้แสดงบนการ์ด/หน้าเว็บว่าใครปิดไว้ตั้งแต่เมื่อไหร่

# จำผู้ใช้ล่าสุดไว้กี่คน — การ์ดควบคุมบอทแสดงจากรายชื่อนี้ (ทีม IT ต้องเห็นชื่อ LINE ถึงจะเลือกปิดถูกคน)
RECENT_USERS_MAX = 200

# "ครั้งเดียวต่อวัน" นับตามวันที่ของไทย ไม่ใช่ UTC — ไม่งั้นข้อความแจ้งจะรีเซ็ตตอน 7 โมงเช้า
_BANGKOK_OFFSET = 7 * 3600


def bangkok_day(now: float | None = None) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime((time.time() if now is None else now) + _BANGKOK_OFFSET))


class ConversationStore(Protocol):
    async def get(self, user_id: str) -> Session | None: ...
    async def set(self, user_id: str, session: Session) -> None: ...
    async def clear(self, user_id: str) -> None: ...

    # ---- ทีม IT สั่งเปิด/ปิดบอท ----
    async def get_bot_off(self) -> dict | None: ...
    async def set_bot_off(self, info: dict | None) -> None: ...
    async def get_user_off(self, user_id: str) -> dict | None: ...
    async def set_user_off(self, user_id: str, info: dict | None) -> None: ...
    async def list_user_off(self) -> dict[str, dict]: ...
    async def touch_user(self, user_id: str, name: str | None) -> None: ...
    async def recent_users(self, limit: int) -> list[dict]: ...
    async def user_name(self, user_id: str) -> str | None: ...
    async def once_per_day(self, key: str) -> bool: ...


class MemoryStore:
    """เก็บใน process — เหมาะกับ dev / ทดสอบ เท่านั้น"""

    def __init__(self, ttl_seconds: int) -> None:
        self._ttl = ttl_seconds
        self._data: dict[str, Session] = {}
        self._bot_off: dict | None = None
        self._user_off: dict[str, dict] = {}
        self._recent: dict[str, float] = {}
        self._names: dict[str, str] = {}
        self._once: set[str] = set()

    async def get(self, user_id: str) -> Session | None:
        session = self._data.get(user_id)
        if session is None:
            return None
        now = time.time()
        if now - session.updated_at > self._ttl and not session.in_handoff(now):
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
        expired = [
            k for k, v in self._data.items()
            if now - v.updated_at > self._ttl and not v.in_handoff(now)
        ]
        for k in expired:
            self._data.pop(k, None)

    # ---- ทีม IT สั่งเปิด/ปิดบอท ----

    async def get_bot_off(self) -> dict | None:
        return dict(self._bot_off) if self._bot_off else None

    async def set_bot_off(self, info: dict | None) -> None:
        self._bot_off = dict(info) if info else None

    async def get_user_off(self, user_id: str) -> dict | None:
        info = self._user_off.get(user_id)
        return dict(info) if info else None

    async def set_user_off(self, user_id: str, info: dict | None) -> None:
        if info:
            self._user_off[user_id] = dict(info)
        else:
            self._user_off.pop(user_id, None)

    async def list_user_off(self) -> dict[str, dict]:
        return {uid: dict(info) for uid, info in self._user_off.items()}

    async def touch_user(self, user_id: str, name: str | None) -> None:
        self._recent[user_id] = time.time()
        if name:
            self._names[user_id] = name
        if len(self._recent) > RECENT_USERS_MAX:
            keep = sorted(self._recent.items(), key=lambda kv: kv[1], reverse=True)[:RECENT_USERS_MAX]
            self._recent = dict(keep)

    async def recent_users(self, limit: int) -> list[dict]:
        rows = sorted(self._recent.items(), key=lambda kv: kv[1], reverse=True)[: max(0, limit)]
        return [{"user_id": uid, "name": self._names.get(uid), "at": at} for uid, at in rows]

    async def user_name(self, user_id: str) -> str | None:
        return self._names.get(user_id)

    async def once_per_day(self, key: str) -> bool:
        day = bangkok_day()
        token = f"{key}:{day}"
        if token in self._once:
            return False
        if len(self._once) > 5000:
            # ทิ้งของวันก่อนๆ — ไม่งั้นชุดนี้โตไปเรื่อยๆ ตามจำนวนคนที่เคยทักมา
            self._once = {t for t in self._once if t.endswith(day)}
        self._once.add(token)
        return True


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
        # ระหว่างส่งต่อให้เจ้าหน้าที่ key ต้องอยู่ถึงเวลาที่กำหนด ไม่ใช่ 30 นาทีแบบบทสนทนาปกติ
        # ไม่งั้นพอ key หมดอายุ บอทจะลืมว่าต้องเงียบแล้วโผล่มาตอบแทรกเจ้าหน้าที่
        ttl = max(self._ttl, int(session.handoff_until - session.updated_at) + 60)
        # setex = set + หมดอายุอัตโนมัติ ไม่ต้องเขียน cleanup job เอง
        await self._redis.setex(self._key(user_id), ttl, session.to_json())

    async def clear(self, user_id: str) -> None:
        await self._redis.delete(self._key(user_id))

    # ---- ทีม IT สั่งเปิด/ปิดบอท ----
    #
    # key ชุดนี้ไม่มีวันหมดอายุ (ยกเว้น once) — การปิดบอทต้องอยู่รอด restart และ deploy ใหม่
    # Redis ของระบบนี้เก็บลง volume redis_data อยู่แล้ว จึงไม่หายตอนรีสตาร์ทเครื่อง

    _CTL = "linebot:ctl:"

    async def get_bot_off(self) -> dict | None:
        return _load_info(await self._redis.get(f"{self._CTL}bot_off"))

    async def set_bot_off(self, info: dict | None) -> None:
        key = f"{self._CTL}bot_off"
        if info:
            await self._redis.set(key, json.dumps(info, ensure_ascii=False))
        else:
            await self._redis.delete(key)

    async def get_user_off(self, user_id: str) -> dict | None:
        return _load_info(await self._redis.hget(f"{self._CTL}user_off", user_id))

    async def set_user_off(self, user_id: str, info: dict | None) -> None:
        key = f"{self._CTL}user_off"
        if info:
            await self._redis.hset(key, user_id, json.dumps(info, ensure_ascii=False))
        else:
            await self._redis.hdel(key, user_id)

    async def list_user_off(self) -> dict[str, dict]:
        raw = await self._redis.hgetall(f"{self._CTL}user_off") or {}
        out: dict[str, dict] = {}
        for uid, value in raw.items():
            info = _load_info(value)
            if info is not None:
                out[uid] = info
        return out

    async def touch_user(self, user_id: str, name: str | None) -> None:
        pipe = self._redis.pipeline()
        pipe.zadd(f"{self._CTL}recent", {user_id: time.time()})
        if name:
            pipe.hset(f"{self._CTL}names", user_id, name)
        # เก็บแค่ล่าสุด RECENT_USERS_MAX คน — อันดับ 0 คือเก่าสุด ลบตั้งแต่ตัวแรกจนเหลือตามจำนวน
        pipe.zremrangebyrank(f"{self._CTL}recent", 0, -(RECENT_USERS_MAX + 1))
        await pipe.execute()

    async def recent_users(self, limit: int) -> list[dict]:
        if limit <= 0:
            return []
        rows = await self._redis.zrevrange(f"{self._CTL}recent", 0, limit - 1, withscores=True)
        if not rows:
            return []
        uids = [uid for uid, _ in rows]
        names = await self._redis.hmget(f"{self._CTL}names", uids)
        return [
            {"user_id": uid, "name": name, "at": float(at)}
            for (uid, at), name in zip(rows, names)
        ]

    async def user_name(self, user_id: str) -> str | None:
        return await self._redis.hget(f"{self._CTL}names", user_id)

    async def once_per_day(self, key: str) -> bool:
        # SET NX = เขียนได้เฉพาะคนแรกของวัน · หมดอายุเองใน 2 วัน ไม่ต้องมีงานกวาดทิ้ง
        ok = await self._redis.set(
            f"{self._CTL}once:{key}:{bangkok_day()}", "1", nx=True, ex=2 * 24 * 3600
        )
        return bool(ok)


def _load_info(raw: str | None) -> dict | None:
    """อ่านค่าที่เก็บไว้กลับมา — ค่าเพี้ยน (แก้มือใน Redis ผิด) ถือว่า "ปิดอยู่แต่ไม่รู้รายละเอียด"
    ไม่ใช่ "เปิด" เพราะคนที่ตั้งค่านี้ตั้งใจให้บอทเงียบ การเดาว่าเปิดคือทำให้บอทตอบแทรกเจ้าหน้าที่"""
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return {"since": None, "by": None}
    return data if isinstance(data, dict) else {"since": None, "by": None}


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
