"""ติดตั้ง Rich Menu ของ LINE OA ให้อัตโนมัติตอนบอทสตาร์ท — เมนูเดียว 4 ปุ่ม จัดเป็น 2x2

ทำไมต้องย้ายมาอยู่ในบอท ทั้งที่มี line-oa/setup_richmenu.py อยู่แล้ว:

    สคริปต์นั้นต้องมีคน "รันเอง" บนเครื่องที่ออกเน็ตไปหา api.line.me ได้ — ซึ่งแปลว่า
    ทุกครั้งที่ย้ายเครื่อง ติดตั้งใหม่ หรือมีคนใหม่มาดูแลต่อ จะมีขั้นตอนที่ลืมได้อยู่ 1 ขั้น
    และ "ลืมติดตั้ง rich menu" มีอาการเหมือนระบบพังสนิทในสายตาพนักงาน คือแอดเข้ามาแล้ว
    เจอห้องแชทเปล่าๆ ไม่มีปุ่มอะไรให้กด ต้องเดาเองว่าพิมพ์อะไรได้บ้าง

ทำไมเหลือ 4 ปุ่ม (2026-09-25) และทำไมจัดเป็น 2x2 (2026-09-26):

    เดิมเป็นเมนู 2 ชั้น 6 ปุ่ม โดยปุ่ม "เช็คข้อมูล" ทำหน้าที่สลับไปเมนูชั้นที่ 2
    และมีปุ่ม "คำถามที่พบบ่อย" อยู่ทั้งสองชั้น — ทั้งสองอย่างถูกถอดออกตามที่ตกลงกันไว้
    เหลือเฉพาะสิ่งที่ผู้ใช้ "ทำ" จริง 4 อย่าง คือ แจ้งซ่อม / เบิก / คืน / ขอใช้บริการ IT

    ผลข้างเคียงที่ต้องรู้: ความสามารถที่เคยอยู่ในเมนูชั้น 2 (สต็อกคงเหลือ, เรื่องที่ฉันแจ้ง,
    ทรัพย์สินของฉัน, ค้นหาทรัพย์สิน) ไม่ได้ถูกลบทิ้ง แต่ "ไม่มีปุ่มให้กด" แล้ว
    ยังเรียกได้ด้วยการพิมพ์ เพราะ ai.py จับ intent จากข้อความอยู่ และ FAQ ยังอยู่ใน
    quick reply (messages.MENU_BUTTONS) ถ้าจะถอดออกให้หมดจริงๆ ต้องแก้ที่นั่นด้วย

การอัปเกรดจากของเดิม:

    LINE ไม่ลบเมนูเก่าให้เอง และ alias ก็อยู่ระดับแชนแนล ไม่ได้หายไปพร้อมเมนูที่ถูกลบ
    โค้ดชุดนี้จึง "ตามลบ" เมนูชั้น 2 กับ alias ของมันให้ด้วย (LEGACY_*) ไม่งั้นจะค้างถาวร

ออกแบบให้ปลอดภัยต่อการรันซ้ำ (idempotent): ถ้าเมนูที่ติดตั้งอยู่ "ตรงกับโค้ดชุดนี้แล้ว"
(ขนาดรูป + ชุดปุ่มตรงกัน) และเป็น default อยู่แล้ว จะข้ามไปเลย ไม่อัปโหลดรูปซ้ำทุก restart
— สำคัญเพราะ LINE ให้ 1 แชนแนลมีเมนูได้ถึง 1,000 อัน การสร้างใหม่ทุก restart จะค่อยๆ ถมจนเต็ม

ที่เทียบ "ชุดปุ่ม" ไม่ใช่แค่ "มีเมนูชื่อนี้อยู่ไหม" เพราะตอนเปลี่ยนจาก 6 ปุ่มเป็น 4 ปุ่ม
เมนูเก่าก็ชื่อเดียวกันและเป็น default อยู่ ถ้าเช็คแค่ชื่อ deploy ไปแล้วเมนูจะไม่เปลี่ยน
และคนที่ deploy จะเห็นว่า "โค้ดขึ้นแล้วแต่เมนูยังเป็นของเก่า" โดยไม่รู้ว่าต้องไปตั้ง
RICHMENU_FORCE_REINSTALL=true เอง
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import NamedTuple

import httpx

logger = logging.getLogger(__name__)

# ---- สถานะการติดตั้ง: ASCII ล้วน ห้ามเป็นภาษาไทย ----
#
# ทำไมต้องแยกจากข้อความไทย (บทเรียนจาก deploy 2026-09-26):
#
#   deploy.ps1 เคยตัดสินผลด้วยการเทียบข้อความไทยที่ได้จาก /health ตรงๆ
#   แต่ Windows PowerShell 5.1 (ซึ่ง deploy.bat เรียกใช้) ถอดรหัส body ของ
#   Invoke-WebRequest เป็น ISO-8859-1 เมื่อ Content-Type ไม่ได้ระบุ charset มาด้วย
#   ข้อความไทยจึงกลายเป็นอักษรขยะก่อนถึงบรรทัดที่เทียบ ทำให้ "เทียบไม่ตรง" ทุกกรณี
#   ผลคือลูปที่รอให้ติดตั้งเสร็จหลุดออกทันที แล้วรายงานว่า "ติดตั้งไม่สำเร็จ"
#   ทั้งที่ตอนนั้นบอทยังติดตั้งอยู่และสำเร็จในอีกไม่กี่วินาที
#
# กฎที่ได้มา: ค่าที่ "เครื่องอ่านเพื่อตัดสินใจ" กับค่าที่ "คนอ่านเพื่อเข้าใจ"
# ต้องเป็นคนละฟิลด์เสมอ อย่าให้ค่าเดียวทำสองหน้าที่ เพราะวันที่ข้อความเปลี่ยน
# (แปลภาษา แก้คำ หรือโดน encoding เล่นงาน) ตรรกะจะพังเงียบๆ โดยไม่มี error ที่ไหนเลย
STATE_OK = "ok"                  # ติดตั้งถูกต้องอยู่แล้ว รอบนี้ไม่ได้แตะอะไร
STATE_INSTALLED = "installed"    # เพิ่งติดตั้งใหม่สำเร็จในรอบนี้
STATE_INSTALLING = "installing"  # กำลังติดตั้งอยู่ (main.py ตั้งไว้ก่อนเรียก)
STATE_DISABLED = "disabled"      # ปิดการติดตั้งอัตโนมัติไว้
STATE_FAILED = "failed"          # ล้มเหลว — ดูรายละเอียดที่ message
STATE_UNKNOWN = "unknown"        # ยังไม่ทราบ (ถามมาก่อนบอทตั้งค่าเสร็จ)


class RichMenuResult(NamedTuple):
    """ผลการติดตั้ง แยกส่วนที่เครื่องอ่าน ออกจากส่วนที่คนอ่าน"""

    state: str    # หนึ่งใน STATE_* ด้านบน — ใช้ตัดสินใจได้อย่างเดียว
    message: str  # ข้อความไทยไว้ใส่ log และให้คนดู — ห้ามเอาไปเทียบในสคริปต์

MENU_MAIN_NAME = "IT Support Main Menu"

# alias id ต้องเป็น a-z, 0-9, _, - เท่านั้น และไม่ซ้ำกันในแชนแนล
ALIAS_MAIN = "itsupport-main"

# ของเวอร์ชันก่อน (เมนู 2 ชั้น) — เก็บชื่อไว้เพื่อ "ตามลบ" เท่านั้น ห้ามเอาไปสร้างใหม่
LEGACY_MENU_DATA_NAME = "IT Support Data Menu"
LEGACY_ALIAS_DATA = "itsupport-data"

CHAT_BAR_TEXT = "เมนู IT"  # LINE จำกัด 14 ตัวอักษร — "เมนู IT Support" (15) ถูกปฏิเสธทั้ง request

# LINE รับรูป rich menu แค่ 2 ขนาด: 2500x1686 (สูง, 2 แถว) กับ 2500x843 (เตี้ย, 1 แถว)
#
# 2x2 บนรูปสูง: ปุ่มละ 1250x843 ใหญ่กว่าแบบแถวเดียว (625x843) เท่าตัวในแนวนอน
# ทั้งพื้นที่กดและตัวหนังสืออ่านง่ายขึ้นชัดเจนบนมือถือ แลกกับเมนูที่สูงขึ้นเมื่อเปิดค้างไว้
W, H = 2500, 1686
COLS, ROWS = 2, 2
CW, CH = W // COLS, H // ROWS  # 1250 x 843 ต่อปุ่ม
MAX_IMAGE_BYTES = 1_000_000

# ---- ปุ่มเมนูหลัก: สิ่งที่ "ทำ" ----
# ใช้ action แบบ message โดยตั้งใจ ไม่ใช่ postback เพราะบอทมีชั้นจับ intent อยู่แล้ว
# (ai.py -> INTENT_KEYWORDS) ข้อความธรรมดาจึงเปิด flow ได้เลย และผู้ใช้เห็นคำที่ตัวเองส่งในแชท
# ทำให้เรียนรู้ว่า "พิมพ์เองก็ได้" ไม่ติดอยู่กับการกดปุ่มอย่างเดียว
MAIN_BUTTONS = [
    {"type": "message", "text": "แจ้งซ่อม"},
    {"type": "message", "text": "เบิกอุปกรณ์"},
    {"type": "message", "text": "คืนอุปกรณ์"},
    {"type": "message", "text": "ขอใช้บริการ IT"},
]


def _areas(buttons: list[dict]) -> list[dict]:
    """แปลงลำดับปุ่มเป็นพิกัดพื้นที่กด — คอลัมน์สุดท้ายกินส่วนที่เหลือทั้งหมด

    ที่ต้องเผื่อ "ส่วนที่เหลือ" เพราะ W อาจหารจำนวนคอลัมน์ไม่ลงตัว (3 คอลัมน์ในเวอร์ชันก่อน
    เหลือขอบขวา 1px ที่กดไม่ได้) ตอนนี้ 2500/4 = 625 ลงตัวพอดี แต่คงสูตรไว้กันพลาดตอนแก้ COLS
    """
    areas = []
    for index, action in enumerate(buttons):
        col, row = index % COLS, index // COLS
        x = col * CW
        areas.append(
            {
                "bounds": {
                    "x": x,
                    "y": row * CH,
                    "width": (W - x) if col == COLS - 1 else CW,
                    "height": CH,
                },
                "action": action,
            }
        )
    return areas


def _signature(areas: list[dict]) -> list[str]:
    """ลายเซ็นของเมนู 1 ใบ: ชนิดปุ่ม + ข้อความ/ข้อมูลที่ส่ง เรียงตามตำแหน่ง

    ใช้เทียบว่าเมนูที่ติดตั้งอยู่บนแชนแนล "ตรงกับโค้ดชุดนี้" ไหม โดยอ่านเฉพาะฟิลด์ที่เรากำหนดเอง
    ไม่เทียบทั้ง dict เพราะ LINE เติมฟิลด์ของตัวเอง (เช่น label) กลับมาได้ ถ้าเทียบทั้งก้อน
    จะเจอ "ไม่ตรง" ตลอดเวลา แล้วกลายเป็นสร้างเมนูใหม่ทุก restart ซึ่งคือสิ่งที่พยายามเลี่ยงอยู่
    """
    out = []
    for area in areas:
        action = area.get("action") or {}
        detail = action.get("text") or action.get("data") or action.get("richMenuAliasId") or ""
        out.append(f"{action.get('type', '')}:{detail}")
    return out


CURRENT_SIGNATURE = _signature(_areas(MAIN_BUTTONS))
CURRENT_SIZE = {"width": W, "height": H}


class RichMenuError(Exception):
    """ติดตั้งเมนูไม่สำเร็จ — ผู้เรียกต้องกลืนไว้ ห้ามให้บอททั้งตัวตายเพราะเรื่องนี้"""


class _Client:
    """ห่อการเรียก LINE API ไว้ให้สั้น — ทุกเมธอดโยน RichMenuError พร้อมข้อความที่อ่านรู้เรื่อง"""

    def __init__(self, http: httpx.AsyncClient, api: str, blob: str) -> None:
        self.http = http
        self.api = api.rstrip("/")
        self.blob = blob.rstrip("/")

    async def default_menu_id(self) -> str | None:
        res = await self.http.get(f"{self.api}/v2/bot/user/all/richmenu")
        if res.status_code == 200:
            return res.json().get("richMenuId")
        # 404 = ยังไม่เคยตั้งเมนูเริ่มต้น ซึ่งปกติมากตอนติดตั้งครั้งแรก ไม่ใช่ error
        if res.status_code == 404:
            return None
        raise RichMenuError(f"ดูเมนูเริ่มต้นไม่สำเร็จ: {res.status_code} {res.text[:200]}")

    async def list_menus(self) -> list[dict]:
        res = await self.http.get(f"{self.api}/v2/bot/richmenu/list")
        if res.status_code != 200:
            raise RichMenuError(f"ดูรายการเมนูไม่สำเร็จ: {res.status_code} {res.text[:200]}")
        return res.json().get("richmenus", [])

    async def list_aliases(self) -> dict[str, str]:
        """คืน {aliasId: richMenuId}"""
        res = await self.http.get(f"{self.api}/v2/bot/richmenu/alias/list")
        if res.status_code != 200:
            # แชนแนลที่ยังไม่เคยมี alias อาจตอบ 404 — ถือว่าไม่มี ไม่ใช่ error
            return {}
        return {a["richMenuAliasId"]: a["richMenuId"] for a in res.json().get("aliases", [])}

    async def delete_menu(self, menu_id: str) -> None:
        await self.http.delete(f"{self.api}/v2/bot/richmenu/{menu_id}")

    async def delete_alias(self, alias_id: str) -> None:
        """ลบ alias ที่ไม่ได้ใช้แล้ว — ไม่เช็คผลลัพธ์เพราะ 404 (ไม่มีอยู่แล้ว) คือผลที่ต้องการอยู่ดี"""
        await self.http.delete(f"{self.api}/v2/bot/richmenu/alias/{alias_id}")

    async def create_menu(self, name: str, buttons: list[dict]) -> str:
        payload = {
            "size": CURRENT_SIZE,
            # selected=True = เปิดเมนูค้างไว้ตั้งแต่เข้าห้องแชท ผู้ใช้ไม่ต้องกดเปิดเอง
            "selected": True,
            "name": name,
            "chatBarText": CHAT_BAR_TEXT,
            "areas": _areas(buttons),
        }
        res = await self.http.post(f"{self.api}/v2/bot/richmenu", json=payload)
        if res.status_code != 200:
            raise RichMenuError(f"สร้างเมนู '{name}' ไม่สำเร็จ: {res.status_code} {res.text[:300]}")
        return res.json()["richMenuId"]

    async def upload_image(self, menu_id: str, image: Path) -> None:
        # อัปโหลดรูปใช้คนละโดเมนกับตอนสร้างเมนู — ยิงผิดโดเมนได้ 404
        res = await self.http.post(
            f"{self.blob}/v2/bot/richmenu/{menu_id}/content",
            content=image.read_bytes(),
            headers={"Content-Type": "image/png"},
        )
        if res.status_code != 200:
            raise RichMenuError(f"อัปโหลดรูปเมนูไม่สำเร็จ: {res.status_code} {res.text[:300]}")

    async def upsert_alias(self, alias_id: str, menu_id: str) -> None:
        """สร้าง alias ถ้ายังไม่มี / ชี้ไปเมนูใหม่ถ้ามีอยู่แล้ว

        ต้องรองรับทั้งสองทาง เพราะ alias อยู่ระดับแชนแนล ไม่ได้หายไปพร้อมเมนูที่ถูกลบ
        ติดตั้งรอบสองจึงเจอ alias เดิมค้างอยู่เสมอ
        """
        res = await self.http.post(
            f"{self.api}/v2/bot/richmenu/alias",
            json={"richMenuAliasId": alias_id, "richMenuId": menu_id},
        )
        if res.status_code == 200:
            return
        # 400/409 = มี alias นี้อยู่แล้ว -> เปลี่ยนให้ชี้เมนูใหม่แทน
        res = await self.http.post(
            f"{self.api}/v2/bot/richmenu/alias/{alias_id}",
            json={"richMenuId": menu_id},
        )
        if res.status_code != 200:
            raise RichMenuError(f"ตั้ง alias '{alias_id}' ไม่สำเร็จ: {res.status_code} {res.text[:300]}")

    async def set_default(self, menu_id: str) -> None:
        res = await self.http.post(f"{self.api}/v2/bot/user/all/richmenu/{menu_id}")
        if res.status_code != 200:
            raise RichMenuError(f"ตั้งเมนูเริ่มต้นไม่สำเร็จ: {res.status_code} {res.text[:300]}")


def _check_image(path: str, label: str) -> Path:
    image = Path(path)
    if not image.exists():
        raise RichMenuError(
            f"ไม่พบไฟล์รูป{label}ที่ {path} — ตรวจว่า docker-compose mount โฟลเดอร์ line-oa/assets เข้ามาแล้ว"
        )
    size = image.stat().st_size
    if size > MAX_IMAGE_BYTES:
        raise RichMenuError(f"รูป{label}ใหญ่เกินลิมิตของ LINE (1 MB) ตอนนี้ {size / 1024:.0f} KB")
    return image


def _is_current(menu: dict) -> bool:
    """เมนูใบนี้คือของที่โค้ดชุดนี้จะสร้างพอดีไหม (ขนาด + ชุดปุ่มตรงกัน)"""
    size = menu.get("size") or {}
    if (size.get("width"), size.get("height")) != (W, H):
        return False
    return _signature(menu.get("areas") or []) == CURRENT_SIGNATURE


async def ensure_rich_menu(
    access_token: str,
    image_path: str,
    *,
    api_host: str = "https://api.line.me",
    blob_host: str = "https://api-data.line.me",
    force: bool = False,
) -> RichMenuResult:
    """ทำให้แน่ใจว่า rich menu ถูกติดตั้งและตั้งเป็นเมนูเริ่มต้นของผู้ใช้ทุกคน

    คืน RichMenuResult(state, message): state เป็น ASCII ไว้ให้สคริปต์ตัดสินผล
    ส่วน message เป็นข้อความไทยไว้ใส่ log และ /health ให้คนอ่าน
    force=True เพื่อบังคับติดตั้งใหม่แม้มีอยู่แล้ว (ใช้ตอนเปลี่ยนรูปโดยที่ปุ่มเหมือนเดิม —
    เปลี่ยนปุ่มไม่ต้องใช้ force เพราะลายเซ็นปุ่มจะไม่ตรงและติดตั้งใหม่ให้เอง)
    """
    main_image = _check_image(image_path, "เมนูหลัก")

    headers = {"Authorization": f"Bearer {access_token}"}
    # timeout สูงกว่าปกติเพราะขั้นอัปโหลดรูปส่งไฟล์ ~200 KB
    async with httpx.AsyncClient(timeout=30.0, headers=headers) as http:
        c = _Client(http, api_host, blob_host)

        current_default = await c.default_menu_id()
        menus = await c.list_menus()
        aliases = await c.list_aliases()

        installed = next((m for m in menus if m.get("name") == MENU_MAIN_NAME), None)
        leftovers = [m for m in menus if m.get("name") == LEGACY_MENU_DATA_NAME]

        # ---- ติดตั้งถูกต้องอยู่แล้วไหม ----
        # เงื่อนไขครบทุกข้อถึงจะข้ามได้ ขาดข้อไหนแปลว่ายังเป็นของเวอร์ชันก่อนหรือติดตั้งค้างไว้
        if (
            not force
            and installed
            and current_default == installed["richMenuId"]
            and _is_current(installed)
            and not leftovers
            and LEGACY_ALIAS_DATA not in aliases
        ):
            logger.info("rich menu ติดตั้งไว้แล้ว %s", installed["richMenuId"])
            return RichMenuResult(STATE_OK, f"ok (มีอยู่แล้ว: {installed['richMenuId']})")

        # ---- ลบของเก่า: ทั้งเมนูหลักรุ่นก่อนและเมนูชั้น 2 ที่เลิกใช้แล้ว ----
        # กันสะสมจนเต็มโควตา 1,000 อัน และกันไม่ให้เมนูชั้น 2 ค้างอยู่ในแชนแนลตลอดไป
        for menu in menus:
            if menu.get("name") in (MENU_MAIN_NAME, LEGACY_MENU_DATA_NAME):
                await c.delete_menu(menu["richMenuId"])
                logger.info("ลบเมนูเดิม %s (%s)", menu["richMenuId"], menu.get("name"))

        # alias ของเมนูชั้น 2 ต้องลบแยก เพราะมันอยู่ระดับแชนแนล ไม่ได้หายไปพร้อมเมนู
        if LEGACY_ALIAS_DATA in aliases:
            await c.delete_alias(LEGACY_ALIAS_DATA)
            logger.info("ลบ alias ที่เลิกใช้แล้ว %s", LEGACY_ALIAS_DATA)

        # ---- สร้างใหม่ ----
        new_main = await c.create_menu(MENU_MAIN_NAME, MAIN_BUTTONS)
        try:
            await c.upload_image(new_main, main_image)
        except RichMenuError:
            # เก็บกวาดเมนูที่สร้างค้างไว้ ไม่งั้นเหลือเมนูไม่มีรูปลอยอยู่ในแชนแนล
            await c.delete_menu(new_main)
            raise
        await c.upsert_alias(ALIAS_MAIN, new_main)
        await c.set_default(new_main)

        logger.info("ติดตั้ง rich menu (%d ปุ่ม) สำเร็จ: %s", len(MAIN_BUTTONS), new_main)
        return RichMenuResult(STATE_INSTALLED, f"installed ({new_main})")
