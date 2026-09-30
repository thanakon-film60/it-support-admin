# -*- coding: utf-8 -*-
"""แพ็กโฟลเดอร์ skill/it-support-admin/ เป็นไฟล์ .skill (zip) ที่พร้อมนำไปใช้

    python skill/build.py

ทำไมเก็บ "ต้นฉบับเป็นโฟลเดอร์" ไว้ในรีโป ไม่เก็บแค่ไฟล์ .skill:
    .skill คือ zip — git diff มันไม่ได้ รีวิวไม่ได้ และ merge conflict แก้ไม่ได้เลย
    เก็บ .md ไว้ตรงๆ แล้ว build ใหม่เมื่อต้องการ ทำให้การแก้เอกสารในนั้นถูกรีวิวได้
    เหมือนโค้ดปกติ ส่วนไฟล์ .skill ที่ได้ถือเป็นผลลัพธ์ของการ build
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    # PowerShell ตั้ง stdout ของโปรเซสลูกเป็น cp1252 -> print ภาษาไทยพังถ้าไม่ตั้งค่านี้
    sys.stdout.reconfigure(encoding="utf-8")

HERE = Path(__file__).resolve().parent
SRC = HERE / "it-support-admin"
OUT = HERE.parent / "it-support-admin.skill"


def main() -> None:
    if not (SRC / "SKILL.md").exists():
        sys.exit(f"ไม่พบ {SRC / 'SKILL.md'}")

    files = sorted(p for p in SRC.rglob("*") if p.is_file())
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            # เก็บด้วย path แบบ posix เสมอ ไม่งั้น zip ที่สร้างบน Windows จะได้ชื่อเป็น \
            # แล้วเครื่องมือฝั่ง Linux/macOS มองเห็นเป็นไฟล์ชื่อแปลกๆ แทนที่จะเป็นโฟลเดอร์
            zf.write(path, path.relative_to(HERE).as_posix())
            print(" +", path.relative_to(HERE).as_posix())

    print(f"\nสร้าง {OUT.name} ({OUT.stat().st_size / 1024:.1f} KB) จาก {len(files)} ไฟล์")


if __name__ == "__main__":
    main()
