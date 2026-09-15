# -*- coding: utf-8 -*-
"""สร้างไฟล์ภาพทั้งหมดของ LINE OA (rich menu / รูปโปรไฟล์ / ภาพหน้าปก)

รันซ้ำได้ตลอด ผลลัพธ์เหมือนเดิมทุกครั้ง (ไม่มีการสุ่ม) — แก้ข้อความที่ TILES แล้วรันใหม่ได้เลย

    python make_assets.py

ต้องมี: Pillow, ฟอนต์ Noto Sans Thai (ไฟล์ .ttf วางไว้ในโฟลเดอร์ fonts/ ข้างสคริปต์นี้)
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

if hasattr(sys.stdout, "reconfigure"):
    # PowerShell ตั้ง stdout ของโปรเซสลูกเป็น cp1252 -> print ภาษาไทยพังถ้าไม่ตั้งค่านี้
    sys.stdout.reconfigure(encoding="utf-8")

HERE = Path(__file__).resolve().parent
FONT_BOLD = HERE / "fonts" / "NotoSansThai-Bold.ttf"
FONT_REG = HERE / "fonts" / "NotoSansThai-Regular.ttf"

W, H = 2500, 1686           # ขนาด rich menu แบบใหญ่ (ค่าเดียวที่ LINE ยอมรับสำหรับ 2 แถว)
COLS, ROWS = 3, 2
BG = "#EAF0F8"
CARD = "#FFFFFF"
CARD_EDGE = "#D7E2F0"
TEXT = "#0F2B4D"
SUBTEXT = "#6B84A3"

# ไล่เฉดจากน้ำเงินเข้ม -> ฟ้า ตามลำดับปุ่ม ให้ทั้งกริดดูเป็นชุดเดียวกัน
TILES = [
    {"icon": "wrench",    "th": "แจ้งซ่อม",        "en": "Repair",     "color": "#123B6B"},
    {"icon": "box_in",    "th": "เบิกอุปกรณ์",     "en": "Withdraw",   "color": "#17559A"},
    {"icon": "box_out",   "th": "คืนอุปกรณ์",      "en": "Return",     "color": "#1C6FC7"},
    {"icon": "gear",      "th": "ขอใช้บริการ IT",  "en": "IT Service", "color": "#1E82D6"},
    {"icon": "clipboard", "th": "เรื่องที่ฉันแจ้ง", "en": "My Tickets", "color": "#23A0E0"},
    {"icon": "question",  "th": "คำถามที่พบบ่อย",  "en": "FAQ",        "color": "#29B6E8"},
]

S = 3  # supersampling — วาดใหญ่ 3 เท่าแล้วย่อ ทำให้ขอบโค้งเนียน ไม่หยัก


# ------------------------------------------------------------------ ไอคอน
def _icon_mask(kind: str, n: int) -> Image.Image:
    """วาดไอคอนเป็น mask ขาว-ดำ ขนาด n x n (พิกัดอ้างอิงระบบ 0-100 แล้วคูณ n/100)"""
    m = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(m)
    k = n / 100.0

    def P(*pts):
        return [(x * k, y * k) for x, y in pts]

    def box(x0, y0, x1, y1):
        return [x0 * k, y0 * k, x1 * k, y1 * k]

    if kind == "wrench":
        cx, cy, ro, ri = 66, 34, 22, 11
        d.ellipse(box(cx - ro, cy - ro, cx + ro, cy + ro), fill=255)
        d.ellipse(box(cx - ri, cy - ri, cx + ri, cy + ri), fill=0)
        # เจาะปากประแจให้เปิดไปทางขวาบน
        a = math.radians(-45)
        half = math.radians(26)
        far = 60
        d.polygon(
            P((cx, cy),
              (cx + far * math.cos(a - half), cy + far * math.sin(a - half)),
              (cx + far * math.cos(a + half), cy + far * math.sin(a + half))),
            fill=0,
        )
        d.line(P((30, 70), (58, 42)), fill=255, width=int(15 * k))
        d.ellipse(box(23, 63, 37, 77), fill=255)

    elif kind in ("box_in", "box_out"):
        # กล่อง + ลูกศรเข้า (เบิก) / ออก (คืน)
        d.rounded_rectangle(box(22, 52, 78, 86), radius=5 * k, fill=255)
        d.rectangle(box(22, 52, 78, 63), fill=255)
        d.rectangle(box(45, 52, 55, 63), fill=0)
        shaft, head = (28, 44, 8), (50, 34)
        if kind == "box_in":
            d.rectangle(box(46, 10, 54, 36), fill=255)
            d.polygon(P((50, 47), (36, 30), (64, 30)), fill=255)
        else:
            d.rectangle(box(46, 21, 54, 47), fill=255)
            d.polygon(P((50, 10), (36, 27), (64, 27)), fill=255)

    elif kind == "gear":
        cx = cy = 50
        teeth, r_out, r_in, r_hole = 8, 47, 31, 15
        pts = []
        for i in range(teeth * 2):
            ang = math.pi * i / teeth - math.pi / 2
            r = r_out if i % 2 == 0 else r_in
            pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
        d.polygon(P(*pts), fill=255)
        d.ellipse(box(cx - 34, cy - 34, cx + 34, cy + 34), fill=255)
        d.ellipse(box(cx - r_hole, cy - r_hole, cx + r_hole, cy + r_hole), fill=0)

    elif kind == "clipboard":
        d.rounded_rectangle(box(22, 16, 78, 90), radius=8 * k, fill=255)
        d.rounded_rectangle(box(29, 26, 71, 82), radius=4 * k, fill=0)
        d.rounded_rectangle(box(38, 8, 62, 24), radius=5 * k, fill=255)
        for i, y in enumerate((38, 52, 66)):
            d.rounded_rectangle(box(36, y, 64 - i * 8, y + 7), radius=3 * k, fill=255)

    elif kind == "question":
        f = ImageFont.truetype(str(FONT_BOLD), int(86 * k))
        bb = d.textbbox((0, 0), "?", font=f)
        d.text(((n - (bb[2] - bb[0])) / 2 - bb[0], (n - (bb[3] - bb[1])) / 2 - bb[1]),
               "?", font=f, fill=255)

    return m


def _badge(size: int, color: str, kind: str) -> Image.Image:
    """วงกลมสีพร้อมไอคอนสีขาวตรงกลาง"""
    n = size * 4
    circle = Image.new("L", (n, n), 0)
    ImageDraw.Draw(circle).ellipse([0, 0, n - 1, n - 1], fill=255)
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    layer.paste(Image.new("RGBA", (n, n), color), (0, 0), circle)
    icon_n = int(n * 0.52)
    icon = _icon_mask(kind, icon_n)
    white = Image.new("RGBA", (icon_n, icon_n), (255, 255, 255, 255))
    off = (n - icon_n) // 2
    layer.paste(white, (off, off), icon)
    return layer.resize((size, size), Image.LANCZOS)


def _center(d, text, font, cx, y, fill):
    bb = d.textbbox((0, 0), text, font=font)
    d.text((cx - (bb[2] - bb[0]) / 2 - bb[0], y), text, font=font, fill=fill)
    return bb[3] - bb[1]


# ------------------------------------------------------------------ rich menu
def build_richmenu(out: Path) -> None:
    img = Image.new("RGB", (W * S, H * S), BG)
    d = ImageDraw.Draw(img)
    f_th = ImageFont.truetype(str(FONT_BOLD), int(76 * S))
    f_en = ImageFont.truetype(str(FONT_REG), int(40 * S))

    tw, th = W / COLS, H / ROWS
    pad, radius = 26 * S, 40 * S

    for i, tile in enumerate(TILES):
        col, row = i % COLS, i // COLS
        x0, y0 = col * tw * S, row * th * S
        x1, y1 = x0 + tw * S, y0 + th * S
        d.rounded_rectangle([x0 + pad, y0 + pad, x1 - pad, y1 - pad],
                            radius=radius, fill=CARD, outline=CARD_EDGE, width=int(3 * S))
        cx = (x0 + x1) / 2
        bsize = int(212 * S)
        badge = _badge(bsize, tile["color"], tile["icon"])
        img.paste(badge, (int(cx - bsize / 2), int(y0 + 196 * S)), badge)
        _center(d, tile["th"], f_th, cx, y0 + 464 * S, TEXT)
        _center(d, tile["en"], f_en, cx, y0 + 572 * S, SUBTEXT)

    img.resize((W, H), Image.LANCZOS).save(out, optimize=True)


# ------------------------------------------------------------- โปรไฟล์/หน้าปก
def build_profile(src: Path, out: Path, size: int = 640) -> None:
    im = Image.open(src).convert("RGBA")
    bbox = im.split()[3].getbbox()          # ตัดขอบโปร่งใสรอบโลโก้ทิ้งก่อน
    if bbox:
        im = im.crop(bbox)
    side = max(im.size)
    canvas = Image.new("RGBA", (side, side), (255, 255, 255, 255))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    canvas.convert("RGB").resize((size, size), Image.LANCZOS).save(out, optimize=True)


def build_cover(src: Path, out: Path, size=(1080, 878)) -> None:
    im = Image.open(src).convert("RGB")
    tw, th = size
    scale = max(tw / im.width, th / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    left, top = (im.width - tw) // 2, (im.height - th) // 2
    im.crop((left, top, left + tw, top + th)).save(out, quality=95, optimize=True)


if __name__ == "__main__":
    out_dir = HERE / "assets"
    out_dir.mkdir(exist_ok=True)
    src = HERE / "source"
    build_richmenu(out_dir / "richmenu-main.png")
    if (src / "cover-source.png").exists():
        build_cover(src / "cover-source.png", out_dir / "oa-cover-1080x878.jpg")
    if (src / "logo-source.png").exists():
        build_profile(src / "logo-source.png", out_dir / "oa-profile-640.png")
    for p in sorted(out_dir.iterdir()):
        print(f"{p.name}  {p.stat().st_size/1024:.0f} KB")
