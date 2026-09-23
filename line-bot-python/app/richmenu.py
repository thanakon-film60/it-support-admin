"""ติดตั้ง Rich Menu ของ LINE OA ให้อัตโนมัติตอนบอทสตาร์ท — รองรับเมนู 2 ชั้น

ทำไมต้องย้ายมาอยู่ในบอท ทั้งที่มี line-oa/setup_richmenu.py อยู่แล้ว:

    สคริปต์นั้นต้องมีคน "รันเอง" บนเครื่องที่ออกเน็ตไปหา api.line.me ได้ — ซึ่งแปลว่า
    ทุกครั้งที่ย้ายเครื่อง ติดตั้งใหม่ หรือมีคนใหม่มาดูแลต่อ จะมีขั้นตอนที่ลืมได้อยู่ 1 ขั้น
    และ "ลืมติดตั้ง rich menu" มีอาการเหมือนระบบพังสนิทในสายตาพนักงาน คือแอดเข้ามาแล้ว
    เจอห้องแชทเปล่าๆ ไม่มีปุ่มอะไรให้กด ต้องเดาเองว่าพิมพ์อะไรได้บ้าง

ทำไมต้อง 2 ชั้น:

    LINE ให้ปุ่มได้ 6 ปุ่มต่อ 1 เมนู แต่บอทตัวนี้ทำได้มากกว่านั้น ความสามารถอย่าง
    "ดูสต็อกคงเหลือ" หรือ "ทรัพย์สินที่ฉันถืออยู่" เดิมต้องพิมพ์เอาเองเท่านั้น
    ซึ่งแทบไม่มีใครรู้ว่าทำได้ — แยกเป็น "แจ้งเรื่อง" (เมนูหลัก) กับ "เช็คข้อมูล" (เมนูย่อย)
    ทำให้เห็นครบทุกอย่างโดยที่แต่ละหน้าจอยังไม่แน่น

    การสลับเมนูใช้ action `richmenuswitch` ซึ่งต้องอ้างผ่าน "alias" ไม่ใช่ id ตรงๆ
    (เพราะ id เปลี่ยนทุกครั้งที่สร้างเมนูใหม่ ถ้าอ้าง id ปุ่มสลับจะพังทุกครั้งที่ติดตั้งซ้ำ)

ออกแบบให้ปลอดภัยต่อการรันซ้ำ (idempotent): ถ้าเมนูครบ + alias ชี้ถูก + เมนูหลักเป็น default อยู่แล้ว
จะข้ามไปเลย ไม่อัปโหลดรูปซ้ำทุกครั้งที่ restart — สำคัญเพราะ LINE ให้ 1 แชนแนลมีเมนูได้ถึง 1,000 อัน
การสร้างใหม่ทุก restart จะค่อยๆ ถมจนเต็มโดยไม่มีใครสังเกต
"""

from __future__ import annotations

import logging
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

MENU_MAIN_NAME = "IT Support Main Menu"
MENU_DATA_NAME = "IT Support Data Menu"

# alias id ต้องเป็น a-z, 0-9, _, - เท่านั้น และไม่ซ้ำกันในแชนแนล
ALIAS_MAIN = "itsupport-main"
ALIAS_DATA = "itsupport-data"

CHAT_BAR_TEXT = "เมนู IT"  # LINE จำกัด 14 ตัวอักษร — "เมนู IT Support" (15) ถูกปฏิเสธทั้ง request

W, H = 2500, 1686
CW, CH = W // 3, H // 2  # 833 x 843 ต่อปุ่ม
MAX_IMAGE_BYTES = 1_000_000

# ---- ปุ่มเมนูหลัก: สิ่งที่ "ทำ" ----
# 4 ปุ่มแรกใช้ action แบบ message โดยตั้งใจ ไม่ใช่ postback เพราะบอทมีชั้นจับ intent อยู่แล้ว
# (ai.py -> INTENT_KEYWORDS) ข้อความธรรมดาจึงเปิด flow ได้เลย และผู้ใช้เห็นคำที่ตัวเองส่งในแชท
# ทำให้เรียนรู้ว่า "พิมพ์เองก็ได้" ไม่ติดอยู่กับการกดปุ่มอย่างเดียว
MAIN_BUTTONS = [
    {"type": "message", "text": "แจ้งซ่อม"},
    {"type": "message", "text": "เบิกอุปกรณ์"},
    {"type": "message", "text": "คืนอุปกรณ์"},
    {"type": "message", "text": "ขอใช้บริการ IT"},
    {"type": "richmenuswitch", "richMenuAliasId": ALIAS_DATA, "data": "a=menu&v=data"},
    {"type": "postback", "data": "a=faq_menu", "displayText": "คำถามที่พบบ่อย"},
]

# ---- ปุ่มเมนูข้อมูล: สิ่งที่ "ดู" ----
# สต็อก/เรื่องที่ฉันแจ้ง ใช้ message เพราะ ai.analyze() จับ intent ได้แม่นอยู่แล้ว
# (ตรวจจริง: "สต็อกคงเหลือ" -> stock_query 0.80, "เรื่องที่ฉันแจ้ง" -> my_tickets_query 0.85)
# ส่วนอีก 2 ปุ่มใช้ postback เพราะยังไม่มี keyword รองรับ และไม่อยากให้เดาผิดเป็นการแจ้งเรื่องใหม่
DATA_BUTTONS = [
    {"type": "message", "text": "สต็อกคงเหลือ"},
    {"type": "message", "text": "เรื่องที่ฉันแจ้ง"},
    {"type": "postback", "data": "a=my_assets", "displayText": "ทรัพย์สินของฉัน"},
    {"type": "postback", "data": "a=find_asset", "displayText": "ค้นหาทรัพย์สิน"},
    {"type": "postback", "data": "a=faq_menu", "displayText": "คำถามที่พบบ่อย"},
    {"type": "richmenuswitch", "richMenuAliasId": ALIAS_MAIN, "data": "a=menu&v=main"},
]

# ใช้ตอนที่ไม่มีรูปเมนูข้อมูล — ถอยกลับไปเป็นเมนูเดียวที่ยังใช้งานได้ครบ
# (ห้ามปล่อยให้เมนูหลักมีปุ่มสลับไปเมนูที่ไม่มีอยู่จริง เพราะกดแล้วจะเงียบ ไม่มีอะไรเกิดขึ้น)
MAIN_BUTTONS_SOLO = [
    {"type": "message", "text": "แจ้งซ่อม"},
    {"type": "message", "text": "เบิกอุปกรณ์"},
    {"type": "message", "text": "คืนอุปกรณ์"},
    {"type": "message", "text": "ขอใช้บริการ IT"},
    {"type": "message", "text": "เรื่องที่ฉันแจ้ง"},
    {"type": "postback", "data": "a=faq_menu", "displayText": "คำถามที่พบบ่อย"},
]


def _areas(buttons: list[dict]) -> list[dict]:
    """แปลงลำดับปุ่มเป็นพิกัดพื้นที่กด — คอลัมน์สุดท้ายกินส่วนที่เหลือทั้งหมด
    เพราะ 2500 หาร 3 ไม่ลงตัว ถ้าใช้ 833 ทั้งสามคอลัมน์จะเหลือขอบขวา 1px ที่กดไม่ได้"""
    areas = []
    for index, action in enumerate(buttons):
        col, row = index % 3, index // 3
        x = col * CW
        areas.append(
            {
                "bounds": {
                    "x": x,
                    "y": row * CH,
                    "width": (W - x) if col == 2 else CW,
                    "height": CH,
                },
                "action": action,
            }
        )
    return areas


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

    async def create_menu(self, name: str, buttons: list[dict]) -> str:
        payload = {
            "size": {"width": W, "height": H},
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


async def ensure_rich_menu(
    access_token: str,
    image_path: str,
    *,
    data_image_path: str = "",
    api_host: str = "https://api.line.me",
    blob_host: str = "https://api-data.line.me",
    force: bool = False,
) -> str:
    """ทำให้แน่ใจว่า rich menu ถูกติดตั้งและตั้งเป็นเมนูเริ่มต้นของผู้ใช้ทุกคน

    มีรูปเมนูข้อมูล -> ติดตั้งแบบ 2 ชั้น (เมนูหลัก + เมนูข้อมูล สลับกันได้)
    ไม่มี            -> ติดตั้งเมนูเดียวแบบเดิม (ยังใช้งานได้ครบ แค่ไม่มีเมนูย่อย)

    คืนข้อความสรุปผลสั้นๆ ไว้ใส่ log และ /health
    force=True เพื่อบังคับติดตั้งใหม่แม้มีอยู่แล้ว (ใช้ตอนเปลี่ยนรูป/เปลี่ยนปุ่ม)
    """
    main_image = _check_image(image_path, "เมนูหลัก")

    two_level = bool(data_image_path)
    data_image: Path | None = None
    if two_level:
        try:
            data_image = _check_image(data_image_path, "เมนูข้อมูล")
        except RichMenuError as exc:
            # ไม่มีรูปเมนูย่อย -> ถอยไปเมนูเดียว ดีกว่าไม่ติดตั้งอะไรเลย
            logger.warning("%s — ติดตั้งเป็นเมนูเดียวแทน", exc)
            two_level = False

    headers = {"Authorization": f"Bearer {access_token}"}
    # timeout สูงกว่าปกติเพราะขั้นอัปโหลดรูปส่งไฟล์ ~200 KB สองครั้ง
    async with httpx.AsyncClient(timeout=30.0, headers=headers) as http:
        c = _Client(http, api_host, blob_host)

        current_default = await c.default_menu_id()
        menus = await c.list_menus()
        aliases = await c.list_aliases()

        by_name = {m.get("name"): m["richMenuId"] for m in menus}
        main_id = by_name.get(MENU_MAIN_NAME)
        data_id = by_name.get(MENU_DATA_NAME)

        # ---- ติดตั้งถูกต้องอยู่แล้วไหม ----
        if not force and main_id and current_default == main_id:
            if not two_level:
                logger.info("rich menu (เมนูเดียว) ติดตั้งไว้แล้ว %s", main_id)
                return f"ok (มีอยู่แล้ว: {main_id})"
            if (
                data_id
                and aliases.get(ALIAS_MAIN) == main_id
                and aliases.get(ALIAS_DATA) == data_id
            ):
                logger.info("rich menu 2 ชั้นติดตั้งไว้แล้ว main=%s data=%s", main_id, data_id)
                return f"ok (2 ชั้น มีอยู่แล้ว: {main_id})"

        # ---- ลบของเก่าที่ชื่อเดียวกัน กันสะสมจนเต็มโควตา 1,000 อัน ----
        for menu in menus:
            if menu.get("name") in (MENU_MAIN_NAME, MENU_DATA_NAME):
                await c.delete_menu(menu["richMenuId"])
                logger.info("ลบเมนูเดิม %s (%s)", menu["richMenuId"], menu.get("name"))

        # ---- สร้างใหม่ ----
        if two_level and data_image is not None:
            new_main = await c.create_menu(MENU_MAIN_NAME, MAIN_BUTTONS)
            new_data = await c.create_menu(MENU_DATA_NAME, DATA_BUTTONS)
            try:
                await c.upload_image(new_main, main_image)
                await c.upload_image(new_data, data_image)
            except RichMenuError:
                # เก็บกวาดเมนูที่สร้างค้างไว้ ไม่งั้นเหลือเมนูไม่มีรูปลอยอยู่ในแชนแนล
                await c.delete_menu(new_main)
                await c.delete_menu(new_data)
                raise

            # alias ต้องตั้งหลังมีเมนูจริงแล้ว เพราะมันชี้ไปที่ id ของเมนู
            await c.upsert_alias(ALIAS_MAIN, new_main)
            await c.upsert_alias(ALIAS_DATA, new_data)
            await c.set_default(new_main)

            logger.info("ติดตั้ง rich menu 2 ชั้นสำเร็จ main=%s data=%s", new_main, new_data)
            return f"installed 2 ชั้น (main={new_main})"

        new_main = await c.create_menu(MENU_MAIN_NAME, MAIN_BUTTONS_SOLO)
        try:
            await c.upload_image(new_main, main_image)
        except RichMenuError:
            await c.delete_menu(new_main)
            raise
        await c.upsert_alias(ALIAS_MAIN, new_main)
        await c.set_default(new_main)

        logger.info("ติดตั้ง rich menu (เมนูเดียว) สำเร็จ: %s", new_main)
        return f"installed ({new_main})"
