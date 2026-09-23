"""ตรวจการติดตั้ง rich menu (เมนูเดียว + เมนู 2 ชั้น) ด้วยเซิร์ฟเวอร์จำลอง LINE API

ทำไมต้องจำลองทั้ง API ไม่ mock เป็นฟังก์ชัน: ลำดับการเรียกสำคัญมาก —
alias ต้องตั้งหลังเมนูถูกสร้างจริง, รูปต้องอัปโหลดก่อนตั้งเป็น default,
และของเก่าต้องถูกลบก่อนสร้างใหม่ ถ้า mock ทีละฟังก์ชันจะไม่จับลำดับที่ผิดเลย

สิ่งที่ห่วงที่สุดคือการสร้างเมนูซ้ำทุก restart — LINE ให้ 1 แชนแนลมีเมนูได้ 1,000 อัน
ถ้าเผลอสร้างใหม่ทุกครั้งจะเต็มในไม่กี่เดือนโดยไม่มีใครสังเกต จนวันหนึ่งติดตั้งไม่ได้อีกเลย
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
    ALIAS_DATA,
    ALIAS_MAIN,
    DATA_BUTTONS,
    MAIN_BUTTONS,
    MAIN_BUTTONS_SOLO,
    MENU_DATA_NAME,
    MENU_MAIN_NAME,
    W,
    H,
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
def images(tmp_path):
    return _png(tmp_path, "richmenu-main.png"), _png(tmp_path, "richmenu-data.png")


async def _install(line, images, **kw):
    main, data = images
    return await ensure_rich_menu(
        "tok", main, data_image_path=data, api_host=line.url, blob_host=line.url, **kw
    )


# ------------------------------------------------------------------ เมนู 2 ชั้น


@pytest.mark.asyncio
async def test_ติดตั้งเมนูสองชั้นครบทุกขั้นตอน(line, images):
    result = await _install(line, images)

    assert "installed" in result
    names = sorted(m["name"] for m in line.menus.values())
    assert names == sorted([MENU_MAIN_NAME, MENU_DATA_NAME])

    main_id = next(k for k, v in line.menus.items() if v["name"] == MENU_MAIN_NAME)
    data_id = next(k for k, v in line.menus.items() if v["name"] == MENU_DATA_NAME)

    assert sorted(line.uploads) == sorted([main_id, data_id]), "ต้องอัปโหลดรูปครบทั้งสองเมนู"
    assert line.aliases[ALIAS_MAIN] == main_id
    assert line.aliases[ALIAS_DATA] == data_id
    assert line.default_id == main_id, "เมนูหลักต้องเป็นเมนูเริ่มต้น"


@pytest.mark.asyncio
async def test_ปุ่มสลับเมนูชี้ไป_alias_ที่มีอยู่จริง(line, images):
    """ถ้า alias ที่ปุ่มอ้างไม่มีอยู่ กดแล้วจะเงียบสนิท ไม่มีอะไรเกิดขึ้น หาสาเหตุยากมาก"""
    await _install(line, images)

    for menu in line.menus.values():
        for area in menu["areas"]:
            action = area["action"]
            if action["type"] == "richmenuswitch":
                assert action["richMenuAliasId"] in line.aliases, \
                    f"ปุ่มสลับชี้ไป alias '{action['richMenuAliasId']}' ที่ไม่มีอยู่จริง"


@pytest.mark.asyncio
async def test_alias_ถูกตั้งหลังเมนูถูกสร้างแล้วเท่านั้น(line, images):
    """LINE ปฏิเสธ alias ที่ชี้ไปเมนูที่ยังไม่มี — ลำดับจึงสำคัญ ไม่ใช่แค่ทำครบ"""
    await _install(line, images)
    first_alias = next(i for i, c in enumerate(line.calls) if c == "POST /v2/bot/richmenu/alias")
    last_create = max(i for i, c in enumerate(line.calls) if c == "POST /v2/bot/richmenu")
    assert last_create < first_alias, "ตั้ง alias ก่อนสร้างเมนูครบ"


@pytest.mark.asyncio
async def test_restart_ซ้ําแล้วไม่สร้างเมนูใหม่(line, images):
    await _install(line, images)
    uploads_after_first = len(line.uploads)

    for _ in range(3):
        result = await _install(line, images)
        assert "มีอยู่แล้ว" in result

    assert len(line.uploads) == uploads_after_first, "restart ซ้ำต้องไม่อัปโหลดรูปใหม่"
    assert len(line.menus) == 2, "ต้องไม่สะสมเมนูจนเต็มโควตา 1,000 อันของ LINE"


@pytest.mark.asyncio
async def test_alias_ค้างจากรอบก่อนถูกชี้ไปเมนูใหม่(line, images):
    """alias อยู่ระดับแชนแนล ไม่หายไปพร้อมเมนูที่ถูกลบ — ติดตั้งรอบสองจึงเจอของค้างเสมอ
    ถ้าไม่อัปเดตให้ชี้เมนูใหม่ ปุ่มสลับจะพาไปเมนูที่ถูกลบไปแล้ว"""
    await _install(line, images)
    old_main = line.aliases[ALIAS_MAIN]

    await _install(line, images, force=True)

    assert line.aliases[ALIAS_MAIN] != old_main, "alias ต้องชี้ไปเมนูใหม่"
    assert line.aliases[ALIAS_MAIN] in line.menus, "alias ต้องชี้ไปเมนูที่ยังมีอยู่จริง"
    assert line.aliases[ALIAS_DATA] in line.menus
    assert len(line.menus) == 2


@pytest.mark.asyncio
async def test_เมนูเก่าที่ค้างอยู่ถูกเก็บกวาด(line, images):
    for _ in range(3):
        line.menus[line.new_id()] = {"name": MENU_MAIN_NAME, "size": {}, "areas": [], "chatBarText": ""}

    await _install(line, images)

    assert len(line.menus) == 2, "ของค้าง 3 อันต้องถูกลบ เหลือเมนูใหม่ 2 อัน"


# ------------------------------------------------------------------ ถอยเป็นเมนูเดียว


@pytest.mark.asyncio
async def test_ไม่มีรูปเมนูย่อยให้ถอยเป็นเมนูเดียว(line, images, tmp_path):
    """สำคัญ: ห้ามติดตั้งเมนูหลักที่มีปุ่มสลับไปเมนูที่ไม่มีอยู่ เพราะกดแล้วจะเงียบ"""
    main, _ = images
    result = await ensure_rich_menu(
        "tok", main, data_image_path=str(tmp_path / "ไม่มีไฟล์นี้.png"),
        api_host=line.url, blob_host=line.url,
    )

    assert "installed" in result
    assert len(line.menus) == 1
    menu = next(iter(line.menus.values()))
    types = [a["action"]["type"] for a in menu["areas"]]
    assert "richmenuswitch" not in types, "เมนูเดียวต้องไม่มีปุ่มสลับที่ไปไหนไม่ได้"


@pytest.mark.asyncio
async def test_ไม่มีรูปเมนูหลักเลยต้องบอกให้ชัด(line, tmp_path):
    with pytest.raises(RichMenuError) as exc:
        await ensure_rich_menu("tok", str(tmp_path / "ไม่มี.png"), api_host=line.url, blob_host=line.url)
    assert "ไม่พบไฟล์รูป" in str(exc.value)


# ------------------------------------------------------------------ โครงสร้างปุ่ม


@pytest.mark.parametrize("buttons", [MAIN_BUTTONS, DATA_BUTTONS, MAIN_BUTTONS_SOLO])
def test_พื้นที่ปุ่มครอบคลุมรูปเต็มพอดีไม่ทับกัน(buttons):
    areas = _areas(buttons)
    assert len(areas) == 6

    # ไม่เหลือขอบขวาที่กดไม่ได้ (2500 หาร 3 ไม่ลงตัว)
    for row in (0, 1):
        in_row = [a for a in areas if a["bounds"]["y"] == row * (H // 2)]
        assert max(a["bounds"]["x"] + a["bounds"]["width"] for a in in_row) == W

    for i, a in enumerate(areas):
        for b in areas[i + 1:]:
            ox = min(a["bounds"]["x"] + a["bounds"]["width"], b["bounds"]["x"] + b["bounds"]["width"]) \
                - max(a["bounds"]["x"], b["bounds"]["x"])
            oy = min(a["bounds"]["y"] + a["bounds"]["height"], b["bounds"]["y"] + b["bounds"]["height"]) \
                - max(a["bounds"]["y"], b["bounds"]["y"])
            assert ox <= 0 or oy <= 0, "พื้นที่ปุ่มทับกัน"


def test_เมนูสองชั้นสลับกลับไปกลับมาได้():
    """เมนูหลักต้องมีปุ่มไปเมนูข้อมูล และเมนูข้อมูลต้องมีปุ่มกลับ ไม่งั้นผู้ใช้ติดอยู่ในเมนูย่อย"""
    main_switch = [b for b in MAIN_BUTTONS if b["type"] == "richmenuswitch"]
    data_switch = [b for b in DATA_BUTTONS if b["type"] == "richmenuswitch"]
    assert [b["richMenuAliasId"] for b in main_switch] == [ALIAS_DATA]
    assert [b["richMenuAliasId"] for b in data_switch] == [ALIAS_MAIN]
