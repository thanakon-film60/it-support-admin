# -*- coding: utf-8 -*-
"""สร้าง QR สำหรับให้พนักงานแอด LINE OA — 3 แบบในไฟล์เดียว

    python make_qr.py

ได้ออกมา 4 ไฟล์ในโฟลเดอร์นี้:
  line-oa-qr.svg        เวกเตอร์ ขยายเท่าไหร่ก็คม ใช้กับงานพิมพ์ทุกขนาด
  line-oa-qr.png        QR ล้วน 820px ไม่มีโลโก้ ใช้ตอนต้องการความเรียบ
  line-oa-qr-logo.png   QR + โลโก้ตรงกลาง 1024px ใช้แปะไลน์กลุ่ม/อีเมล/สไลด์
  qr-card.png           การ์ด 1080x1350 พร้อมข้อความ โพสต์ลงกลุ่มได้เลยไม่ต้องพิมพ์อธิบาย

ต้องมี: segno (pure-python ไม่ต้องลง Pillow ก็สร้าง svg/png พื้นฐานได้), Pillow (สำหรับการ์ด)
    pip install segno pillow
"""
from __future__ import annotations

import sys
from pathlib import Path

import segno
from PIL import Image, ImageDraw, ImageFont

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = Path(__file__).resolve().parent
OA_ID = "@891ujhzo"                                  # เปลี่ยนบรรทัดนี้บรรทัดเดียวถ้าย้าย OA
URL = f"https://line.me/R/ti/p/{OA_ID}"              # ลิงก์เพิ่มเพื่อนมาตรฐานของ LINE

LOGO = HERE.parent / "line-oa" / "source" / "logo-source.png"
FONT_BOLD = HERE.parent / "line-oa" / "fonts" / "NotoSansThai-Bold.ttf"
FONT_REG = HERE.parent / "line-oa" / "fonts" / "NotoSansThai-Regular.ttf"

NAVY, BLUE, GREY = "#0F2B4D", "#1E82D6", "#6B84A3"


def _qr_image(px: int, quiet: int = 2) -> Image.Image:
    """QR ระดับแก้ความผิดพลาด H — ทนการโดนโลโก้บังตรงกลางได้ถึง ~30% ของพื้นที่"""
    qr = segno.make(URL, error="h")
    scale = max(1, px // (qr.symbol_size(scale=1, border=quiet)[0]))
    buf = HERE / "_tmp_qr.png"
    qr.save(buf, scale=scale, border=quiet, dark="#0F2B4D", light="#FFFFFF")
    img = Image.open(buf).convert("RGB").resize((px, px), Image.NEAREST)
    buf.unlink()
    return img


def with_logo(px: int = 1024) -> Image.Image:
    img = _qr_image(px)
    if not LOGO.exists():
        return img
    logo = Image.open(LOGO).convert("RGBA")
    box = logo.split()[3].getbbox()
    if box:
        logo = logo.crop(box)
    side = int(px * 0.22)                            # 22% ยังอยู่ในงบที่ระดับ H ทนได้
    logo = logo.resize((side, side), Image.LANCZOS)
    pad = int(side * 0.10)
    plate = Image.new("RGB", (side + pad * 2, side + pad * 2), "white")
    plate.paste(logo, (pad, pad), logo)
    img.paste(plate, ((px - plate.width) // 2, (px - plate.height) // 2))
    return img


def card(out: Path, w: int = 1080, h: int = 1350) -> None:
    img = Image.new("RGB", (w, h), "#FFFFFF")
    d = ImageDraw.Draw(img)
    f_title = ImageFont.truetype(str(FONT_BOLD), 64)
    f_sub = ImageFont.truetype(str(FONT_REG), 38)
    f_id = ImageFont.truetype(str(FONT_BOLD), 46)
    f_foot = ImageFont.truetype(str(FONT_REG), 34)

    def center(text, font, y, fill):
        bb = d.textbbox((0, 0), text, font=font)
        d.text(((w - (bb[2] - bb[0])) / 2 - bb[0], y), text, font=font, fill=fill)

    d.rectangle([0, 0, w, 250], fill=NAVY)
    center("ระบบแจ้งปัญหา IT", f_title, 62, "#FFFFFF")
    center("แจ้งซ่อม · เบิก–คืนอุปกรณ์ · เช็คสถานะ ในแชทเดียว", f_sub, 152, "#B9D4EE")

    qr = with_logo(700)
    d.rounded_rectangle([(w - 760) / 2, 320, (w + 760) / 2, 1080], radius=36,
                        fill="#FFFFFF", outline="#D7E2F0", width=4)
    img.paste(qr, ((w - 700) // 2, 350))

    center("สแกนเพื่อเพิ่มเพื่อน", f_sub, 1110, GREY)
    center(OA_ID, f_id, 1168, BLUE)
    d.rectangle([0, h - 90, w, h], fill="#EAF0F8")
    center("ทีม IT · โทร. 062-829-3236", f_foot, h - 68, NAVY)
    img.save(out, optimize=True)


if __name__ == "__main__":
    segno.make(URL, error="h").save(HERE / "line-oa-qr.svg", scale=10, border=2, dark=NAVY)
    _qr_image(820).save(HERE / "line-oa-qr.png", optimize=True)
    with_logo(1024).save(HERE / "line-oa-qr-logo.png", optimize=True)
    card(HERE / "qr-card.png")
    print(f"เนื้อหาใน QR: {URL}")
    for name in ("line-oa-qr.svg", "line-oa-qr-logo.png", "qr-card.png"):
        p = HERE / name
        print(f"  {name:22s} {p.stat().st_size/1024:6.0f} KB")
