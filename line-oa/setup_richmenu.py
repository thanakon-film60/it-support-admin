# -*- coding: utf-8 -*-
"""ติดตั้ง Rich Menu ของ LINE OA ให้ใช้งานจริง (สร้าง -> อัปโหลดรูป -> ตั้งเป็นเมนูเริ่มต้นของทุกคน)

รันซ้ำได้ปลอดภัย: ก่อนสร้างใหม่จะลบเมนูเก่าที่ชื่อเดียวกันทิ้งให้เอง จึงไม่มีเมนูค้างสะสม
ใช้เฉพาะไลบรารีที่ติดมากับ Python (urllib) — ไม่ต้อง pip install อะไรเพิ่ม

    python setup_richmenu.py            # ติดตั้ง/อัปเดตเมนู
    python setup_richmenu.py --list     # ดูว่าตอนนี้มีเมนูอะไรอยู่บ้าง
    python setup_richmenu.py --remove   # ถอดเมนูออก (กลับไปเป็นไม่มี rich menu)

อ่าน LINE_CHANNEL_ACCESS_TOKEN จาก (ตามลำดับ): ตัวแปรสภาพแวดล้อม -> ../line-bot-python/.env -> ../.env
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = Path(__file__).resolve().parent
IMAGE = HERE / "assets" / "richmenu-main.png"

API = "https://api.line.me/v2/bot"
API_DATA = "https://api-data.line.me/v2/bot"

MENU_NAME = "IT Support Main Menu"      # ใช้เป็นกุญแจในการลบของเก่า ห้ามเปลี่ยนโดยไม่จำเป็น
CHAT_BAR_TEXT = "เมนู IT"               # LINE จำกัดไม่เกิน 14 ตัวอักษร

W, H = 2500, 1686
CW, CH = W // 3, H // 2                 # 833 x 843 ต่อ 1 ปุ่ม (คอลัมน์สุดท้ายกว้าง 834 ให้เต็มพอดี)

# ปุ่มเรียงซ้าย->ขวา บน->ล่าง ตรงกับรูปใน assets/richmenu-main.png
# ใช้ action แบบ message เป็นหลัก เพราะบอทมีชั้นจับ intent อยู่แล้ว (ai.py -> INTENT_KEYWORDS)
# ข้อความที่ส่งจึงเปิด flow ให้ทันทีโดยไม่ต้องแก้โค้ดบอทเลยแม้แต่บรรทัดเดียว
BUTTONS = [
    {"action": {"type": "message", "text": "แจ้งซ่อม"}},
    {"action": {"type": "message", "text": "เบิกอุปกรณ์"}},
    {"action": {"type": "message", "text": "คืนอุปกรณ์"}},
    {"action": {"type": "message", "text": "ขอใช้บริการ IT"}},
    {"action": {"type": "message", "text": "เรื่องที่ฉันแจ้ง"}},
    # FAQ ใช้ postback เพราะ flow.py รองรับ a=faq_menu อยู่แล้ว และไม่ต้องให้ข้อความผู้ใช้โผล่ในแชท
    {"action": {"type": "postback", "data": "a=faq_menu", "displayText": "คำถามที่พบบ่อย"}},
]


def _areas() -> list[dict]:
    out = []
    for i, btn in enumerate(BUTTONS):
        col, row = i % 3, i // 3
        x = col * CW
        width = (W - x) if col == 2 else CW
        out.append({
            "bounds": {"x": x, "y": row * CH, "width": width, "height": CH},
            "action": btn["action"],
        })
    return out


def _token() -> str:
    token = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
    if token:
        return token
    for env_path in (HERE.parent / "line-bot-python" / ".env", HERE.parent / ".env"):
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("LINE_CHANNEL_ACCESS_TOKEN="):
                value = line.split("=", 1)[1].strip().strip('"').strip("'")
                if value:
                    print(f"ใช้ token จาก {env_path}")
                    return value
    sys.exit("ไม่พบ LINE_CHANNEL_ACCESS_TOKEN — ตั้งเป็น environment variable หรือใส่ไว้ใน line-bot-python/.env")


def _call(method: str, url: str, token: str, *, body: bytes | None = None,
          content_type: str = "application/json") -> dict:
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if body is not None:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8") or "{}"
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        sys.exit(f"LINE API ตอบ {e.code} ที่ {method} {url}\n{detail}")
    except urllib.error.URLError as e:
        sys.exit(f"ต่อ LINE API ไม่ได้ ({e.reason}) — เช็คอินเทอร์เน็ต/พร็อกซีของเครื่องนี้")
    return json.loads(raw) if raw.strip() else {}


def list_menus(token: str) -> list[dict]:
    return _call("GET", f"{API}/richmenu/list", token).get("richmenus", [])


def remove_all(token: str) -> None:
    try:
        _call("DELETE", f"{API}/user/all/richmenu", token)
    except SystemExit:
        pass  # ยังไม่เคยตั้งเมนูเริ่มต้นไว้ — ไม่ใช่ข้อผิดพลาด
    for menu in list_menus(token):
        _call("DELETE", f"{API}/richmenu/{menu['richMenuId']}", token)
        print(f"ลบเมนูเก่า {menu['richMenuId']} ({menu.get('name')})")


def install(token: str) -> str:
    if not IMAGE.exists():
        sys.exit(f"ไม่พบรูปเมนู {IMAGE} — รัน python make_assets.py ก่อน")
    size = IMAGE.stat().st_size
    if size > 1_000_000:
        sys.exit(f"รูปเมนูใหญ่เกินลิมิตของ LINE (1 MB) ตอนนี้ {size/1024:.0f} KB")

    for menu in list_menus(token):
        if menu.get("name") == MENU_NAME:
            _call("DELETE", f"{API}/richmenu/{menu['richMenuId']}", token)
            print(f"ลบเมนูเดิมชื่อเดียวกัน {menu['richMenuId']}")

    payload = {
        "size": {"width": W, "height": H},
        "selected": True,                 # เปิดเมนูค้างไว้ตั้งแต่เข้าห้องแชท ไม่ต้องให้ผู้ใช้กดเปิดเอง
        "name": MENU_NAME,
        "chatBarText": CHAT_BAR_TEXT,
        "areas": _areas(),
    }
    created = _call("POST", f"{API}/richmenu", token,
                    body=json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    menu_id = created["richMenuId"]
    print(f"สร้างเมนูแล้ว: {menu_id}")

    _call("POST", f"{API_DATA}/richmenu/{menu_id}/content", token,
          body=IMAGE.read_bytes(), content_type="image/png")
    print(f"อัปโหลดรูปแล้ว ({size/1024:.0f} KB)")

    _call("POST", f"{API}/user/all/richmenu/{menu_id}", token)
    print("ตั้งเป็นเมนูเริ่มต้นของผู้ใช้ทุกคนแล้ว")
    return menu_id


def main() -> None:
    token = _token()
    arg = sys.argv[1] if len(sys.argv) > 1 else ""

    if arg == "--list":
        menus = list_menus(token)
        if not menus:
            print("ยังไม่มี rich menu ในแชนแนลนี้")
        for m in menus:
            print(f"{m['richMenuId']}  {m.get('name')}  {m['size']['width']}x{m['size']['height']}")
        return

    if arg == "--remove":
        remove_all(token)
        print("ถอดเมนูออกเรียบร้อย")
        return

    menu_id = install(token)
    print("\nเสร็จแล้ว — เปิดแชท LINE OA แล้วปิด/เปิดห้องแชทใหม่ 1 ครั้งจะเห็นเมนูทันที")
    print(f"ถ้าจะย้อนกลับ: python setup_richmenu.py --remove   (menu id ปัจจุบัน {menu_id})")


if __name__ == "__main__":
    main()
