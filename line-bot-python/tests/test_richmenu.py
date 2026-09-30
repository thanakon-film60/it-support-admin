"""ตรวจการติดตั้ง rich menu (เมนูเดียว 4 ปุ่ม) ด้วยเซิร์ฟเวอร์จำลอง LINE API

ทำไมต้องจำลองทั้ง API ไม่ mock เป็นฟังก์ชัน: ลำดับการเรียกสำคัญมาก —
alias ต้องตั้งหลังเมนูถูกสร้างจริง, รูปต้องอัปโหลดก่อนตั้งเป็น default,
และของเก่าต้องถูกลบก่อนสร้างใหม่ ถ้า mock ทีละฟังก์ชันจะไม่จับลำดับที่ผิดเลย

สองเรื่องที่ห่วงที่สุด:
  1. สร้างเมนูซ้ำทุก restart — LINE ให้ 1 แชนแนลมีเมนูได้ 1,000 อัน ถ้าเผลอสร้างใหม่ทุกครั้ง
     จะเต็มในไม่กี่เดือนโดยไม่มีใครสังเกต จนวันหนึ่งติดตั้งไม่ได้อีกเลย
  2. อัปเกรดจากเมนู 2 ชั้นรุ่นก่อนแล้วของเก่าไม่ถูกลบ — เมนูชั้น 2 กับ alias ของมัน
     ไม่หายไปเอง และ "เมนูหลักรุ่นเก่า" ก็ชื่อเดียวกัน เป็น default อยู่เหมือนกัน
     ถ้าเช็คแค่ชื่อจะข้ามการติดตั้งใหม่ แล้ว deploy ไปเมนูก็ยังเป็นของเก่า
"""

from __future__ import annotations

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.richmenu import (  # noqa: E402
    ALIAS_MAIN,
    CHAT_BAR_TEXT,
    COLS,
    ROWS,
    LEGACY_ALIAS_DATA,
    LEGACY_MENU_DATA_NAME,
    MAIN_BUTTONS,
    MENU_MAIN_NAME,
    W,
    H,
    STATE_INSTALLED,
    STATE_OK,
    RichMenuError,
    _areas,
    ensure_rich_menu,
)


class FakeLine:
    def __init__(self):
        self.menus: dict[str, dict] = {}
        self.aliases: dict[str, str] = {}
        self.default_id: str | None = None
        self.uploads: list[str] = []
        self.deleted: list[str] = []
        self.calls: list[str] = []      # ลำดับการเรียก ใช้ตรวจว่าทำถูกขั้นตอน
        self._seq = 0

    def new_id(self) -> str:
        self._seq += 1
        return f"richmenu-{self._seq:04d}"

    def seed_legacy(self) -> tuple[str, str]:
        """จำลองแชนแนลที่ยังเป็นเมนู 2 ชั้น 6 ปุ่มของเวอร์ชันก่อน (2500x1686)"""
        old_actions = [
            {"type": "message", "text": "แจ้งซ่อม"},
            {"type": "message", "text": "เบิกอุปกรณ์"},
            {"type": "message", "text": "คืนอุปกรณ์"},
            {"type": "message", "text": "ขอใช้บริการ IT"},
            {"type": "richmenuswitch", "richMenuAliasId": LEGACY_ALIAS_DATA, "data": "a=menu&v=data"},
            {"type": "postback", "data": "a=faq_menu", "displayText": "คำถามที่พบบ่อย"},
        ]
        old_areas = [
            {"bounds": {"x": (i % 3) * 833, "y": (i // 3) * 843, "width": 833, "height": 843},
             "action": a}
            for i, a in enumerate(old_actions)
        ]
        main_id, data_id = self.new_id(), self.new_id()
        for mid, name in ((main_id, MENU_MAIN_NAME), (data_id, LEGACY_MENU_DATA_NAME)):
            self.menus[mid] = {"name": name, "size": {"width": 2500, "height": 1686},
                               "chatBarText": CHAT_BAR_TEXT, "areas": old_areas}
        self.aliases[ALIAS_MAIN] = main_id
        self.aliases[LEGACY_ALIAS_DATA] = data_id
        self.default_id = main_id
        return main_id, data_id


def _handler(state: FakeLine):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code: int, body: bytes = b"{}"):
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            state.calls.append(f"GET {self.path}")
            if self.path == "/v2/bot/user/all/richmenu":
                if state.default_id is None:
                    return self._send(404, b'{"message":"no default"}')
                return self._send(200, json.dumps({"richMenuId": state.default_id}).encode())
            if self.path == "/v2/bot/richmenu/list":
                menus = [{"richMenuId": k, **v} for k, v in state.menus.items()]
                return self._send(200, json.dumps({"richmenus": menus}).encode())
            if self.path == "/v2/bot/richmenu/alias/list":
                aliases = [{"richMenuAliasId": a, "richMenuId": m} for a, m in state.aliases.items()]
                return self._send(200, json.dumps({"aliases": aliases}).encode())
            return self._send(404)

        def do_POST(self):
            state.calls.append(f"POST {self.path}")
            n = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(n) if n else b""

            if self.path == "/v2/bot/richmenu":
                p = json.loads(raw)
                mid = state.new_id()
                state.menus[mid] = {"name": p["name"], "size": p["size"],
                                    "chatBarText": p["chatBarText"], "areas": p["areas"]}
                return self._send(200, json.dumps({"richMenuId": mid}).encode())

            if self.path == "/v2/bot/richmenu/alias":
                p = json.loads(raw)
                aid = p["richMenuAliasId"]
                if aid in state.aliases:
                    # LINE ตอบ 400 เมื่อ alias ซ้ำ — ต้องให้โค้ดไปใช้เส้นทาง update แทน
                    return self._send(400, b'{"message":"conflict"}')
                if p["richMenuId"] not in state.menus:
                    return self._send(400, b'{"message":"rich menu not found"}')
                state.aliases[aid] = p["richMenuId"]
                return self._send(200)

            if self.path.startswith("/v2/bot/richmenu/alias/"):
                aid = self.path.rsplit("/", 1)[-1]
                p = json.loads(raw)
                state.aliases[aid] = p["richMenuId"]
                return self._send(200)

            if self.path.endswith("/content"):
                mid = self.path.split("/")[-2]
                assert self.headers.get("Content-Type") == "image/png"
                assert len(raw) > 0
                state.uploads.append(mid)
                return self._send(200)

            if self.path.startswith("/v2/bot/user/all/richmenu/"):
                state.default_id = self.path.rsplit("/", 1)[-1]
                return self._send(200)

            return self._send(404)

        def do_DELETE(self):
            state.calls.append(f"DELETE {self.path}")
            # ต้องเช็ค alias ก่อน เพราะ path ของ alias ขึ้นต้นด้วย /v2/bot/richmenu/ เหมือนกัน
            if self.path.startswith("/v2/bot/richmenu/alias/"):
                aid = self.path.rsplit("/", 1)[-1]
                if state.aliases.pop(aid, None) is None:
                    return self._send(404, b'{"message":"not found"}')
                return self._send(200)
            if self.path.startswith("/v2/bot/richmenu/"):
                mid = self.path.rsplit("/", 1)[-1]
                state.menus.pop(mid, None)
                state.deleted.append(mid)
                return self._send(200)
            return self._send(404)

    return H


@pytest.fixture
def line():
    state = FakeLine()
    server = HTTPServer(("127.0.0.1", 0), _handler(state))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    state.url = f"http://127.0.0.1:{server.server_port}"
    yield state
    server.shutdown()


def _png(tmp_path: Path, name: str) -> str:
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d494844520000000100000001080200000090"
        "7753de0000000c4944415408d7636060000000040001272635400000000049454e44ae426082"
    )
    p = tmp_path / name
    p.write_bytes(png)
    return str(p)


@pytest.fixture
def image(tmp_path):
    return _png(tmp_path, "richmenu-main.png")


async def _install(line, image, **kw):
    return await ensure_rich_menu("tok", image, api_host=line.url, blob_host=line.url, **kw)


def _only_menu(line) -> dict:
    assert len(line.menus) == 1, f"ต้องเหลือเมนูเดียว แต่เหลือ {len(line.menus)}"
    return next(iter(line.menus.values()))


# ------------------------------------------------------------------ ติดตั้งครั้งแรก


@pytest.mark.asyncio
async def test_ติดตั้งเมนู_4_ปุ่มครบทุกขั้นตอน(line, image):
    result = await _install(line, image)

    assert result.state == STATE_INSTALLED
    menu = _only_menu(line)
    assert menu["name"] == MENU_MAIN_NAME
    assert menu["size"] == {"width": W, "height": H}
    assert len(menu["areas"]) == 4

    menu_id = next(iter(line.menus))
    assert line.uploads == [menu_id], "ต้องอัปโหลดรูปให้เมนูที่เพิ่งสร้าง 1 ครั้ง"
    assert line.aliases[ALIAS_MAIN] == menu_id
    assert line.default_id == menu_id, "ต้องตั้งเป็นเมนูเริ่มต้นของทุกคน"


@pytest.mark.asyncio
async def test_ไม่มีปุ่มสลับเมนูหลงเหลือ(line, image):
    """เลิกใช้เมนูชั้น 2 แล้ว ถ้ายังมีปุ่ม richmenuswitch ค้างอยู่ กดแล้วจะเงียบสนิท หาสาเหตุยากมาก"""
    await _install(line, image)
    types = [a["action"]["type"] for a in _only_menu(line)["areas"]]
    assert "richmenuswitch" not in types


@pytest.mark.asyncio
async def test_alias_ถูกตั้งหลังเมนูถูกสร้างแล้วเท่านั้น(line, image):
    """LINE ปฏิเสธ alias ที่ชี้ไปเมนูที่ยังไม่มี — ลำดับจึงสำคัญ ไม่ใช่แค่ทำครบ"""
    await _install(line, image)
    first_alias = next(i for i, c in enumerate(line.calls) if c == "POST /v2/bot/richmenu/alias")
    last_create = max(i for i, c in enumerate(line.calls) if c == "POST /v2/bot/richmenu")
    assert last_create < first_alias, "ตั้ง alias ก่อนสร้างเมนู"


@pytest.mark.asyncio
async def test_ไม่มีรูปเมนูต้องบอกให้ชัด(line, tmp_path):
    with pytest.raises(RichMenuError) as exc:
        await ensure_rich_menu("tok", str(tmp_path / "ไม่มี.png"), api_host=line.url, blob_host=line.url)
    assert "ไม่พบไฟล์รูป" in str(exc.value)


@pytest.mark.asyncio
async def test_รูปใหญ่เกินลิมิตต้องหยุดก่อนยิง_API(line, tmp_path):
    """LINE ตอบ error ที่อ่านไม่รู้เรื่องเมื่อรูปเกิน 1 MB — ดักตั้งแต่ก่อนสร้างเมนูดีกว่า
    ไม่งั้นจะเหลือเมนูไม่มีรูปลอยอยู่ในแชนแนล"""
    big = tmp_path / "ใหญ่.png"
    big.write_bytes(b"\x89PNG" + b"0" * 1_000_001)
    with pytest.raises(RichMenuError) as exc:
        await ensure_rich_menu("tok", str(big), api_host=line.url, blob_host=line.url)
    assert "ใหญ่เกินลิมิต" in str(exc.value)
    assert line.menus == {}, "ต้องไม่สร้างเมนูค้างไว้"


# ------------------------------------------------------------------ รันซ้ำ / อัปเกรด


@pytest.mark.asyncio
async def test_restart_ซ้ําแล้วไม่สร้างเมนูใหม่(line, image):
    await _install(line, image)
    uploads_after_first = len(line.uploads)

    for _ in range(3):
        assert (await _install(line, image)).state == STATE_OK

    assert len(line.uploads) == uploads_after_first, "restart ซ้ำต้องไม่อัปโหลดรูปใหม่"
    assert len(line.menus) == 1, "ต้องไม่สะสมเมนูจนเต็มโควตา 1,000 อันของ LINE"


@pytest.mark.asyncio
async def test_อัปเกรดจากเมนูสองชั้นรุ่นก่อนแล้วของเก่าหายหมด(line, image):
    """เคสจริงตอน deploy 2026-09-25: แชนแนลมีเมนู 6 ปุ่ม 2 ชั้นอยู่ และเมนูหลักรุ่นเก่า
    ก็ชื่อเดียวกัน + เป็น default อยู่แล้ว ถ้าเช็คแค่ชื่อจะข้ามการติดตั้ง แล้วเมนูไม่เปลี่ยน"""
    old_main, old_data = line.seed_legacy()

    result = await _install(line, image)

    assert result.state == STATE_INSTALLED, "ต้องติดตั้งใหม่เองโดยไม่ต้องตั้ง RICHMENU_FORCE_REINSTALL"
    menu = _only_menu(line)
    assert menu["size"] == {"width": W, "height": H}
    assert len(menu["areas"]) == 4
    new_id = next(iter(line.menus))
    assert {old_main, old_data} <= set(line.deleted), "เมนูเก่าทั้งสองใบต้องถูกลบ"
    assert LEGACY_ALIAS_DATA not in line.aliases, "alias ของเมนูชั้น 2 ต้องถูกลบ ไม่งั้นค้างถาวร"
    assert line.aliases[ALIAS_MAIN] == new_id
    assert line.default_id == new_id


@pytest.mark.asyncio
async def test_เปลี่ยนข้อความปุ่มแล้วติดตั้งใหม่ให้เอง(line, image, monkeypatch):
    """ถ้าเทียบแค่ "ขนาดรูป" จะจับไม่ได้เวลาแก้แค่ข้อความบนปุ่ม แล้วต้องไปตั้ง force เองทุกครั้ง"""
    await _install(line, image)
    menu_id = next(iter(line.menus))
    line.menus[menu_id]["areas"][0]["action"] = {"type": "message", "text": "ของเก่า"}

    assert (await _install(line, image)).state == STATE_INSTALLED, "ปุ่มไม่ตรงกับโค้ดต้องติดตั้งใหม่"
    assert menu_id in line.deleted


@pytest.mark.asyncio
async def test_เมนูเก่าที่ค้างอยู่ถูกเก็บกวาด(line, image):
    for _ in range(3):
        line.menus[line.new_id()] = {"name": MENU_MAIN_NAME, "size": {}, "areas": [], "chatBarText": ""}

    await _install(line, image)

    assert len(line.menus) == 1, "ของค้าง 3 อันต้องถูกลบ เหลือเมนูใหม่ใบเดียว"


@pytest.mark.asyncio
async def test_alias_ค้างจากรอบก่อนถูกชี้ไปเมนูใหม่(line, image):
    """alias อยู่ระดับแชนแนล ไม่หายไปพร้อมเมนูที่ถูกลบ — ติดตั้งรอบสองจึงเจอของค้างเสมอ
    ถ้าไม่อัปเดตให้ชี้เมนูใหม่ alias จะชี้ไปเมนูที่ถูกลบไปแล้ว"""
    await _install(line, image)
    old_main = line.aliases[ALIAS_MAIN]

    await _install(line, image, force=True)

    assert line.aliases[ALIAS_MAIN] != old_main, "alias ต้องชี้ไปเมนูใหม่"
    assert line.aliases[ALIAS_MAIN] in line.menus, "alias ต้องชี้ไปเมนูที่ยังมีอยู่จริง"


# ------------------------------------------------------------------ โครงสร้างปุ่ม


def test_พื้นที่ปุ่มครอบคลุมรูปเต็มพอดีไม่ทับกัน():
    areas = _areas(MAIN_BUTTONS)
    assert len(areas) == len(MAIN_BUTTONS) == COLS * ROWS

    # ไม่เหลือขอบที่กดไม่ได้ ทั้งแนวนอนและแนวตั้ง
    assert max(a["bounds"]["x"] + a["bounds"]["width"] for a in areas) == W
    assert max(a["bounds"]["y"] + a["bounds"]["height"] for a in areas) == H

    for i, a in enumerate(areas):
        for b in areas[i + 1:]:
            ox = min(a["bounds"]["x"] + a["bounds"]["width"], b["bounds"]["x"] + b["bounds"]["width"]) \
                - max(a["bounds"]["x"], b["bounds"]["x"])
            oy = min(a["bounds"]["y"] + a["bounds"]["height"], b["bounds"]["y"] + b["bounds"]["height"]) \
                - max(a["bounds"]["y"], b["bounds"]["y"])
            assert ox <= 0 or oy <= 0, "พื้นที่ปุ่มทับกัน"


def test_ขนาดรูปเป็นค่าที่_LINE_ยอมรับ():
    """LINE รับแค่ 2500x1686 กับ 2500x843 — ค่าอื่นถูกปฏิเสธทั้ง request ตอนสร้างเมนู

    และความสูงต้องสอดคล้องกับจำนวนแถวด้วย: 1 แถวใช้รูปเตี้ย 2 แถวใช้รูปสูง
    ถ้าเผลอแก้ ROWS โดยลืมแก้ H พื้นที่กดจะเลยขอบรูปลงไปครึ่งหนึ่งโดยที่ LINE ไม่เตือนอะไรเลย
    """
    assert (W, H) in ((2500, 1686), (2500, 843))
    assert H == 843 * ROWS, f"{ROWS} แถวต้องใช้รูปสูง {843 * ROWS} ไม่ใช่ {H}"
