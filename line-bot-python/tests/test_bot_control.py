"""เทสต์ "ทีม IT เปิด/ปิดบอทเองจากแชท LINE" (พิมพ์ "แอดมิน")

ที่มา: ผู้ใช้ขอ (13 ต.ค. 2026) ให้เปิด/ปิดบอทได้จากฝั่ง LINE Official Account เพื่อจัดการผู้ใช้สะดวกขึ้น
แอป LINE OA ไม่มีสวิตช์รายคน และ LINE ไม่ส่ง webhook ตอนเจ้าหน้าที่ตอบแชท — จึงทำเป็นคำสั่งในแชท
ให้บัญชี LINE ของทีม IT ที่อนุมัติไว้ในหน้าเว็บ (เมนู "บอท LINE")

สิ่งที่ต้องไม่พังเด็ดขาด:
  - คนที่ไม่ใช่ทีม IT พิมพ์ "แอดมิน" = ขอคุยกับเจ้าหน้าที่ตามเดิม (ห้ามเห็นการ์ดควบคุม)
  - ปุ่มบนการ์ดตรวจสิทธิ์ใหม่ทุกครั้ง — คนที่ถูกถอดสิทธิ์กดการ์ดเก่าไม่ได้
  - ปิดบอทแล้วต้องเงียบจริง (แจ้ง 1 ครั้งต่อวัน) และผู้ใช้เปิดเองไม่ได้ ต้องให้ทีม IT เปิด
  - Chat ใน OA ปิดอยู่ = ห้ามปิดบอท (ไม่มีใครเห็นแชท ผู้ใช้จะพิมพ์ใส่ความว่างเปล่า)
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import flow as F  # noqa: E402
from app import messages as M  # noqa: E402
from app.flow import Incoming, handle  # noqa: E402
from app.richmenu import MAIN_BUTTONS  # noqa: E402
from app.store import MemoryStore, RedisStore, bangkok_day  # noqa: E402
from test_flow import USER, FakeBackend, _card_texts, store  # noqa: E402

STAFF = "U_staff_0001"
OTHER = "U_other_0002"
DAY = 24 * 3600


def say(value: str, user: str = USER, name: str | None = "Somchai") -> Incoming:
    return Incoming(kind="text", user_id=user, text=value, display_name=name)


def press(data: dict, user: str = USER, name: str | None = "Somchai") -> Incoming:
    return Incoming(kind="postback", user_id=user, data=data, display_name=name)


def staff_backend(**kw) -> FakeBackend:
    backend = FakeBackend(**kw)
    backend.staff[STAFF] = {"status": "approved", "name": "ฟิล์ม IT"}
    return backend


def rows_of(reply) -> list[dict]:
    """แถวผู้ใช้บนการ์ดควบคุมบอท (กล่องที่มี action แบบ adm_u)"""
    out: list[dict] = []

    def walk(node):
        if isinstance(node, dict):
            action = node.get("action") or {}
            if str(action.get("data", "")).startswith("a=adm_u"):
                out.append(node)
                return
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(reply.flex)
    return out


def row_for(reply, uid: str) -> dict | None:
    return next((r for r in rows_of(reply) if f"u={uid}" in r["action"]["data"]), None)


def parse(data: str) -> dict:
    return F.parse_postback(data)


# ------------------------------------------------------------------ สิทธิ์


async def test_คนทั่วไปพิมพ์แอดมิน_ยังเป็นการขอคุยกับเจ้าหน้าที่ตามเดิม():
    s, backend = store(), FakeBackend()
    r = await handle(say("แอดมิน"), s, backend)
    assert "ส่งต่อให้ทีม IT" in r[0].text
    assert backend.staff_calls == [(USER, "check")], "ต้องถามหลังบ้านก่อนว่าเป็นทีม IT ไหม"
    assert r[0].flex is None or "ควบคุมบอท" not in json.dumps(r[0].flex, ensure_ascii=False)


async def test_หลังบ้านล่มตอนพิมพ์แอดมิน_ไม่ให้สิทธิ์เกินจริง():
    s, backend = store(), staff_backend()
    backend.fail_staff = True
    r = await handle(say("แอดมิน", STAFF), s, backend)
    assert "ส่งต่อให้ทีม IT" in r[0].text, "ตรวจสิทธิ์ไม่ได้ = ถือว่าไม่ใช่ทีม IT"


async def test_ขอสิทธิ์แล้วรออนุมัติ_พิมพ์แอดมินระหว่างรอได้คำบอกสถานะไม่ใช่การส่งต่อ():
    s, backend = store(), FakeBackend()
    r = await handle(say("ขอสิทธิ์แอดมินครับ", OTHER, "Mook"), s, backend)
    assert "ส่งคำขอสิทธิ์ควบคุมบอทแล้ว" in r[0].text
    assert backend.staff[OTHER] == {"status": "pending", "name": "Mook"}

    r = await handle(say("แอดมิน", OTHER, "Mook"), s, backend)
    assert "รอแอดมินอนุมัติ" in r[0].text
    session = await s.get(OTHER)
    assert session is None or not session.in_handoff(), "คนที่รออนุมัติต้องไม่ถูกส่งต่อเงียบๆ"


async def test_ทีมที่อนุมัติแล้วขอสิทธิ์ซ้ำ_ได้ปุ่มเปิดการ์ด():
    s, backend = store(), staff_backend()
    r = await handle(say("ขอสิทธิ์แอดมิน", STAFF), s, backend)
    assert "มีสิทธิ์ควบคุมบอทอยู่แล้ว" in r[0].text
    assert M.ADMIN_BUTTON in r[0].quick


async def test_ถูกถอดสิทธิ์แล้วกดปุ่มบนการ์ดเก่าไม่ได้():
    s, backend = store(), staff_backend()
    await handle(say("สวัสดี"), s, backend)
    backend.staff[STAFF] = {"status": "none", "name": None}
    for data in ({"a": "adm"}, {"a": "adm_all", "v": "off", "ok": "1"}, {"a": "adm_u", "v": "off", "u": USER}):
        r = await handle(press(data, STAFF), s, backend)
        assert "ยังไม่มีสิทธิ์ควบคุมบอท" in r[0].text
    assert await s.get_bot_off() is None
    assert await s.get_user_off(USER) is None


async def test_หลังบ้านล่มตอนกดปุ่มการ์ด_ไม่แตะสถานะอะไรเลย():
    s, backend = store(), staff_backend()
    backend.fail_staff = True
    r = await handle(press({"a": "adm_all", "v": "off", "ok": "1"}, STAFF), s, backend)
    assert "ระบบขัดข้อง" in r[0].text
    assert await s.get_bot_off() is None


# ------------------------------------------------------------------ การ์ดควบคุม


async def test_การ์ดแสดงชื่อ_LINE_ของคนที่ทักมาล่าสุด_ไม่รวมตัวเอง():
    s, backend = store(), staff_backend()
    await handle(say("สวัสดี", USER, "Somchai 🐻"), s, backend)
    await handle(say("ขอสอบถาม", OTHER, "Mook"), s, backend)

    r = await handle(say("แอดมิน", STAFF, "Film"), s, backend)
    assert len(r) == 1 and r[0].flex is not None
    texts = _card_texts(r[0].flex)
    assert "Somchai 🐻" in texts and "Mook" in texts
    assert row_for(r[0], STAFF) is None, "ไม่ต้องโชว์ตัวทีม IT เอง"
    # คนที่ทักล่าสุดอยู่บนสุด
    assert "Mook" in json.dumps(rows_of(r[0])[0], ensure_ascii=False)
    assert "บอททั้งระบบ: เปิดอยู่" in " ".join(texts)
    assert ("🔄 รีเฟรช", "a=adm&p=0") in r[0].quick


async def test_ปิดบอทรายคน_แล้วคนนั้นได้ข้อความแจ้งครั้งเดียวแล้วเงียบ():
    s, backend = store(), staff_backend()
    await handle(say("สวัสดี"), s, backend)
    panel = (await handle(say("แอดมิน", STAFF), s, backend))[0]
    row = row_for(panel, USER)
    assert row is not None and "ปิดบอท" in json.dumps(row, ensure_ascii=False)

    r = await handle(press(parse(row["action"]["data"]), STAFF, "Film"), s, backend)
    assert "ปิดบอทกับ \"Somchai\" แล้ว" in r[0].text
    assert "เปิดบอท" in json.dumps(row_for(r[1], USER), ensure_ascii=False), "แถวต้องเปลี่ยนเป็นปุ่มเปิด"
    info = await s.get_user_off(USER)
    assert info["by"] == "ฟิล์ม IT", "ชื่อคนสั่งมาจากทะเบียนทีม IT ฝั่งหลังบ้าน"

    first = await handle(say("ปริ้นเตอร์เสียครับ"), s, backend)
    assert first == [M.bot_off_notice()] and first[0].keep_unread
    for incoming in (
        say("ฮัลโหล"),
        say("ยกเลิก"),            # ผู้ใช้เปิดบอทเองไม่ได้ (ต่างจากคุยกับเจ้าหน้าที่)
        say("เมนู"),
        say(MAIN_BUTTONS[0]["text"]),  # กด rich menu
        press({"a": "start"}),
        press({"a": "human"}),
        Incoming(kind="image", user_id=USER, image_url="/x.jpg"),
        Incoming(kind="unsupported", user_id=USER),
    ):
        assert await handle(incoming, s, backend) == [], incoming
    assert backend.created == []

    # คนอื่นยังใช้บอทได้ตามปกติ
    r = await handle(say("ยกเลิก", OTHER, "Mook"), s, backend)
    assert r and r[0].text == M.cancelled().text


async def test_ปิดบอทรายคน_ปุ่มดาวและเช็คสถานะบนการ์ดเก่ายังกดได้():
    s, backend = store(), staff_backend()
    await F.pause_bot_for(s, USER, by="Film")
    r = await handle(press({"a": "ticket", "code": "ITRQ2026090158"}), s, backend)
    assert r and "ITRQ2026090158" in r[0].text
    r = await handle(press({"a": "rate", "code": "ITRQ2026090158", "s": "2"}), s, backend)
    assert backend.rates and backend.rates[0]["score"] == 2
    # ดาวต่ำ -> ขอความเห็น -> ความเห็นที่พิมพ์ตามมาต้องถูกบันทึก ไม่ใช่โดนเงียบใส่
    assert (await s.get(USER)).step == F.RATE_COMMENT
    await handle(say("ช่างมาช้า"), s, backend)
    assert backend.rates[-1]["comment"] == "ช่างมาช้า"


async def test_เปิดบอทกลับ_ล้างทั้งการปิดและโหมดคุยกับเจ้าหน้าที่():
    s, backend = store(), staff_backend()
    await handle(press({"a": "human"}), s, backend)  # ผู้ใช้ขอคุยกับคนเอง
    assert (await s.get(USER)).in_handoff()
    panel = (await handle(say("แอดมิน", STAFF), s, backend))[0]
    row = row_for(panel, USER)
    assert "คุยกับเจ้าหน้าที่" in json.dumps(row, ensure_ascii=False)
    assert "v=on" in row["action"]["data"], "คนที่บอทเงียบใส่อยู่ ปุ่มต้องเป็น 'เปิดบอท'"

    await F.pause_bot_for(s, USER, by="Film")
    r = await handle(press({"a": "adm_u", "v": "on", "u": USER}, STAFF), s, backend)
    assert "เปิดบอทกับ" in r[0].text
    assert await s.get_user_off(USER) is None
    session = await s.get(USER)
    assert session is None or not session.in_handoff()
    r = await handle(say("ยกเลิก"), s, backend)
    assert r[0].text == M.cancelled().text, "เปิดแล้วบอทต้องกลับมาตอบจริง"


async def test_คนที่ถูกปิดไว้ขึ้นบนสุดของการ์ดเสมอ_แม้ไม่ได้ทักมานาน():
    s, backend = store(), staff_backend()
    await handle(say("สวัสดี", USER, "Old"), s, backend)
    for i in range(12):
        await handle(say("สวัสดี", f"U_user_{i:04d}", f"คนที่ {i}"), s, backend)
    await F.pause_bot_for(s, USER, by="Film")

    panel = (await handle(say("แอดมิน", STAFF), s, backend))[0]
    first = rows_of(panel)[0]
    assert f"u={USER}" in first["action"]["data"]
    assert "ปิดบอทอยู่" in json.dumps(first, ensure_ascii=False)
    assert len(rows_of(panel)) == F._ADMIN_PAGE_SIZE

    # หน้าถัดไป
    r = await handle(press({"a": "adm", "p": "1"}, STAFF), s, backend)
    assert rows_of(r[0]) and all("p=1" in row["action"]["data"] for row in rows_of(r[0]))


async def test_ปุ่มที่ข้อมูลเพี้ยนไม่แตะ_store():
    s, backend = store(), staff_backend()
    for bad in ("", "../../etc", "U" + "x" * 80, "Uไทย", "C1234"):
        r = await handle(press({"a": "adm_u", "v": "off", "u": bad}, STAFF), s, backend)
        assert r and r[0].flex is not None, "ตอบด้วยการ์ดเดิม ไม่ใช่ error"
    assert await s.list_user_off() == {}


# ------------------------------------------------------------------ ปิดทั้งระบบ


async def test_ปิดทั้งระบบต้องยืนยันก่อน_แล้วทุกคนได้แจ้งครั้งเดียวแล้วเงียบ():
    s, backend = store(), staff_backend()
    r = await handle(press({"a": "adm_all", "v": "off"}, STAFF), s, backend)
    assert "ยืนยันปิดบอททั้งระบบ" in r[0].text
    assert await s.get_bot_off() is None, "ยังไม่ยืนยัน ห้ามปิด"

    r = await handle(press({"a": "adm_all", "v": "off", "ok": "1"}, STAFF, "Film"), s, backend)
    assert "ปิดบอททั้งระบบแล้ว" in r[0].text
    assert "บอททั้งระบบ: ปิดอยู่" in " ".join(_card_texts(r[1].flex))

    for uid in (USER, OTHER):
        assert await handle(say("ขอแจ้งซ่อม", uid), s, backend) == [M.bot_off_notice()]
        assert await handle(say("ขอแจ้งซ่อม", uid), s, backend) == []

    # คนเพิ่งกดเพิ่มเพื่อนก็ได้ข้อความแจ้งแทนข้อความต้อนรับ (ปุ่มในข้อความต้อนรับกดแล้วจะเงียบ)
    r = await handle(Incoming(kind="follow", user_id="U_new_0003", display_name="New"), s, backend)
    assert r == [M.bot_off_notice()]

    # ทีม IT ยังสั่งได้ตามปกติ แล้วเปิดกลับ
    r = await handle(say("แอดมิน", STAFF), s, backend)
    assert r[0].flex is not None
    r = await handle(press({"a": "adm_all", "v": "on"}, STAFF), s, backend)
    assert "เปิดบอททั้งระบบแล้ว" in r[0].text
    assert await s.get_bot_off() is None
    r = await handle(say("ยกเลิก", OTHER), s, backend)
    assert r[0].text == M.cancelled().text


async def test_ข้อความแจ้งตอนปิดบอทส่งใหม่เมื่อขึ้นวันใหม่_ตามเวลาไทย(monkeypatch):
    s, backend = store(), staff_backend()
    await s.set_bot_off({"since": 0, "by": "Film"})
    # 23:30 เวลาไทย = 16:30 UTC
    base = 1_791_909_000.0
    assert bangkok_day(base) != bangkok_day(base + 3600), "ตัวอย่างต้องข้ามเที่ยงคืนเวลาไทยพอดี"
    monkeypatch.setattr(F.time, "time", lambda: base)
    assert await handle(say("a"), s, backend) == [M.bot_off_notice()]
    assert await handle(say("b"), s, backend) == []
    monkeypatch.setattr(F.time, "time", lambda: base + 3600)  # 00:30 วันถัดไป
    assert await handle(say("c"), s, backend) == [M.bot_off_notice()]


async def test_Chat_ใน_OA_ปิดอยู่_สั่งปิดบอทไม่ได้_และการปิดที่ค้างไว้ไม่มีผล():
    s, backend = store(), staff_backend()
    r = await handle(press({"a": "adm_all", "v": "off", "ok": "1"}, STAFF), s, backend,
                     handoff_available=False)
    assert "ปิดบอทตอนนี้ไม่ได้" in r[0].text
    assert await s.get_bot_off() is None
    r = await handle(press({"a": "adm_u", "v": "off", "u": USER}, STAFF), s, backend,
                     handoff_available=False)
    assert "ปิดบอทตอนนี้ไม่ได้" in r[0].text
    assert await s.get_user_off(USER) is None

    # ปิดไว้ก่อน Chat ถูกปิด -> บอทต้องกลับมาตอบเอง ไม่งั้นไม่มีใครเห็นข้อความเลย
    await s.set_bot_off({"since": 0, "by": "Film"})
    r = await handle(say("ยกเลิก"), s, backend, handoff_available=False)
    assert r[0].text == M.cancelled().text
    panel = (await handle(say("แอดมิน", STAFF), s, backend, handoff_available=False))[0]
    assert "Chat ใน LINE OA ปิดอยู่" in " ".join(_card_texts(panel.flex))


# ------------------------------------------------------------------ การ์ด / ข้อจำกัดของ LINE


def test_การ์ดควบคุมไม่เกินลิมิตของ_LINE():
    rows = [
        {"name": "ชื่อยาวมาก" * 10, "status": "🟢 บอทตอบ", "detail": "ทักล่าสุด 12 ต.ค. 14:05",
         "action": "off", "button": "ปิดบอท", "data": f"a=adm_u&v=off&u=U{'a' * 32}&p=4"}
        for _ in range(F._ADMIN_PAGE_SIZE)
    ]
    reply = M.admin_panel(bot_off={"since": 1, "by": "Film"}, rows=rows, page=4, pages=5, total=40, chat_ok=True)
    from app.flex import estimate_size

    assert estimate_size(reply.flex) < 30_000
    for row in rows:
        assert len(row["data"].encode()) <= 300
    assert all(len(label) <= M.MAX_QUICK_REPLY_LABEL for label, _ in reply.quick)


def test_เวลาไทยบนการ์ด():
    now = 1_791_909_000.0  # 13 ต.ค. 2026 23:30 เวลาไทย
    assert M.thai_time(now - 60, now) == "23:29"
    assert M.thai_time(now - DAY, now) == "12 ต.ค. 23:30"
    assert M.thai_time(None, now) == "-"


# ------------------------------------------------------------------ store


async def test_memory_store_จำผู้ใช้ล่าสุดและชื่อ():
    s = MemoryStore(ttl_seconds=1800)
    await s.touch_user("U1", "A")
    await s.touch_user("U2", None)
    await s.touch_user("U1", None)  # ไม่มีชื่อมา = คงชื่อเดิม
    recent = await s.recent_users(10)
    assert [r["user_id"] for r in recent] == ["U1", "U2"]
    assert recent[0]["name"] == "A" and recent[1]["name"] is None


class FakeRedis:
    """Redis ปลอมเฉพาะคำสั่งที่ RedisStore ใช้ — ไม่ต้องติดตั้ง fakeredis เพิ่ม"""

    def __init__(self):
        self.kv: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.zsets: dict[str, dict[str, float]] = {}
        self.ttl: dict[str, int] = {}

    async def get(self, key):
        return self.kv.get(key)

    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.kv:
            return None
        self.kv[key] = value
        if ex:
            self.ttl[key] = ex
        return True

    async def delete(self, key):
        self.kv.pop(key, None)

    async def hget(self, key, field):
        return self.hashes.get(key, {}).get(field)

    async def hset(self, key, field, value):
        self.hashes.setdefault(key, {})[field] = value

    async def hdel(self, key, field):
        self.hashes.get(key, {}).pop(field, None)

    async def hgetall(self, key):
        return dict(self.hashes.get(key, {}))

    async def hmget(self, key, fields):
        return [self.hashes.get(key, {}).get(f) for f in fields]

    async def zrevrange(self, key, start, stop, withscores=False):
        rows = sorted(self.zsets.get(key, {}).items(), key=lambda kv: kv[1], reverse=True)
        rows = rows[start: stop + 1]
        return rows if withscores else [k for k, _ in rows]

    def pipeline(self):
        redis = self
        ops = []

        class Pipe:
            def zadd(self, key, mapping):
                ops.append(lambda: redis.zsets.setdefault(key, {}).update(mapping))

            def hset(self, key, field, value):
                ops.append(lambda: redis.hashes.setdefault(key, {}).__setitem__(field, value))

            def zremrangebyrank(self, key, start, stop):
                def run():
                    rows = sorted(redis.zsets.get(key, {}).items(), key=lambda kv: kv[1])
                    end = len(rows) + stop if stop < 0 else stop
                    if end < start:  # แบบ Redis: ช่วงว่าง = ไม่ลบอะไร (ห้ามใช้ slice ติดลบของ Python)
                        return
                    for k, _ in rows[start: end + 1]:
                        redis.zsets[key].pop(k, None)
                ops.append(run)

            async def execute(self):
                for op in ops:
                    op()
                return []

        return Pipe()


def redis_store() -> RedisStore:
    s = RedisStore.__new__(RedisStore)
    s._redis, s._ttl, s._prefix = FakeRedis(), 1800, "linebot:session:"
    return s


async def test_redis_store_เก็บสถานะปิดบอทแบบไม่หมดอายุ():
    s = redis_store()
    await s.set_bot_off({"since": 1.0, "by": "Film"})
    assert await s.get_bot_off() == {"since": 1.0, "by": "Film"}
    assert "linebot:ctl:bot_off" not in s._redis.ttl, "การปิดบอทต้องอยู่จนกว่าจะสั่งเปิด"
    await s.set_bot_off(None)
    assert await s.get_bot_off() is None

    await s.set_user_off("U1", {"since": 2.0, "by": "Film"})
    assert await s.get_user_off("U1") == {"since": 2.0, "by": "Film"}
    assert await s.list_user_off() == {"U1": {"since": 2.0, "by": "Film"}}
    await s.set_user_off("U1", None)
    assert await s.list_user_off() == {}

    # ค่าเพี้ยน (แก้มือใน Redis ผิด) = ยังถือว่าปิดอยู่ ไม่เดาว่าเปิด
    s._redis.hashes["linebot:ctl:user_off"] = {"U2": "{not json"}
    assert await s.get_user_off("U2") == {"since": None, "by": None}


async def test_redis_store_ผู้ใช้ล่าสุด_จำกัดจำนวนและเรียงใหม่สุดก่อน(monkeypatch):
    from app import store as store_module

    s = redis_store()
    monkeypatch.setattr(store_module, "RECENT_USERS_MAX", 3)
    for i in range(5):
        monkeypatch.setattr(store_module.time, "time", lambda i=i: 1000.0 + i)
        await s.touch_user(f"U{i}", f"name{i}")
    recent = await s.recent_users(10)
    assert [r["user_id"] for r in recent] == ["U4", "U3", "U2"]
    assert recent[0]["name"] == "name4"
    assert await s.user_name("U0") == "name0"


async def test_redis_store_once_per_day():
    s = redis_store()
    assert await s.once_per_day("off_notice:U1") is True
    assert await s.once_per_day("off_notice:U1") is False
    assert await s.once_per_day("off_notice:U2") is True
    key = f"linebot:ctl:once:off_notice:U1:{bangkok_day()}"
    assert s._redis.ttl[key] == 2 * DAY, "ต้องหมดอายุเอง ไม่ต้องมีงานกวาด"


# ------------------------------------------------------------------ main.py: API ภายใน + webhook

KEY = {"x-internal-key": "test-key"}


def test_api_เปิดปิดบอท_ต้องมี_key(bot):
    client, *_ = bot
    for path, body in (("/internal/bot/status", {}), ("/internal/bot/global", {"off": True}),
                       ("/internal/bot/user", {"line_user_id": USER, "off": True})):
        assert client.post(path, json=body).status_code == 401
        assert client.post(path, json=body, headers={"x-internal-key": "wrong"}).status_code == 401


def test_api_ปิดรายคนแล้วหน้า_ticket_เห็นว่าบอทเงียบ_และคืนให้บอทได้(bot):
    client, app, line, send, say_, state = bot
    res = client.post("/internal/bot/user", json={"line_user_id": USER, "off": True, "by": "แอดมินเว็บ"}, headers=KEY)
    assert res.status_code == 200
    body = res.json()
    assert body["users_off"][0]["line_user_id"] == USER and body["users_off"][0]["by"] == "แอดมินเว็บ"

    status = client.post("/internal/handoff/status", json={"line_user_id": USER}, headers=KEY).json()
    assert status["active"] is True and status["bot_off_user"] is True and status["until"] is None

    first = say_("ปริ้นเตอร์เสีย")
    assert len(first) == 1 and "เจ้าหน้าที่ IT ตอบแชทนี้เอง" in first[0].text
    assert not line.mark_as_read.await_count, "ข้อความของคนที่บอทเงียบใส่ ห้ามสั่งอ่านแล้ว"
    assert say_("ยกเลิก") == []

    # ปุ่ม "คืนให้บอทตอบ" บนหน้า ticket (handoff/end) ต้องเปิดบอทกับคนนี้จริง
    ended = client.post("/internal/handoff/end", json={"line_user_id": USER}, headers=KEY).json()
    assert ended["active"] is False and ended["bot_off_user"] is False
    assert say_("ยกเลิก"), "เปิดแล้วบอทต้องกลับมาตอบ"


def test_api_ปิดทั้งระบบ_และ_health_บอกสถานะ(bot):
    client, app, line, send, say_, state = bot
    body = client.post("/internal/bot/global", json={"off": True, "by": "Film"}, headers=KEY).json()
    assert body["bot_off"]["by"] == "Film"
    health = client.get("/health").json()
    assert health["bot_off"] is True and health["users_off"] == 0

    line.get_message_content.reset_mock()
    send({"type": "image", "contentProvider": {"type": "line"}})
    assert not line.get_message_content.await_count, "ปิดบอทอยู่ไม่ต้องโหลดรูปเข้าระบบ"

    client.post("/internal/bot/global", json={"off": False}, headers=KEY)
    assert client.get("/health").json()["bot_off"] is False


def test_api_Chat_ใน_OA_ปิดอยู่_สั่งปิดบอทไม่ได้(bot):
    client, app, line, send, say_, state = bot
    state["chat_mode"] = "bot"
    app.state.bot_info_checked_at = 0.0
    for _ in range(50):
        if client.get("/health").json()["chat_mode"] == "bot":
            break
        time.sleep(0.02)
    assert client.post("/internal/bot/global", json={"off": True}, headers=KEY).status_code == 409
    res = client.post("/internal/bot/user", json={"line_user_id": USER, "off": True}, headers=KEY)
    assert res.status_code == 409 and res.json()["reason"] == "chat_off"


def test_api_payload_เพี้ยนถูกปฏิเสธ(bot):
    client, *_ = bot
    for body in ({}, {"off": "maybe"}, {"off": True, "by": "x" * 200}):
        assert client.post("/internal/bot/global", json=body, headers=KEY).status_code == 422
    for body in ({"off": True}, {"line_user_id": "", "off": True}, {"line_user_id": "U" * 100, "off": True}):
        assert client.post("/internal/bot/user", json=body, headers=KEY).status_code == 422
