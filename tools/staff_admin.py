#!/usr/bin/env python3
"""
จัดการบัญชีผู้ใช้หน้าแอดมิน IT (it-support-admin)
เพิ่มผู้ใช้ · ตั้ง/สุ่มรหัสผ่าน · เลือกหน้าที่เข้าได้ · ปิด/เปิดใช้งาน · บังคับออกจากระบบ · ลบ · ดูประวัติ

วิธีเปิด: ดับเบิลคลิก staff-admin.bat ที่โฟลเดอร์โปรเจกต์ (ติดตั้ง bcrypt ให้เองถ้ายังไม่มี)
         หรือ  py tools\\staff_admin.py              (แก้ข้อมูลจริงในคอนเทนเนอร์ app ผ่าน Docker)
               py tools\\staff_admin.py --data-dir data   (แก้ไฟล์ในเครื่อง — ใช้ตอน npm run dev / ทดสอบ)

ทำไมเป็นโปรแกรมในเครื่อง ไม่ใช่หน้าในเว็บ:
  หน้าเว็บเปิดออกอินเทอร์เน็ต ถ้ามีเมนูสร้างบัญชี/ให้สิทธิ์ในเว็บ ใครได้ cookie ของแอดมินไป
  (หรือเจอช่องโหว่สักจุด) ก็สร้างบัญชีให้ตัวเองได้ทันที — งานนี้จึงทำได้เฉพาะคนที่นั่งหน้าเครื่องเซิร์ฟเวอร์

ข้อมูลอยู่ที่ไหน:
  data/staff_accounts.json ใน docker volume "app_data" (ไม่ใช่โฟลเดอร์ data/ ของโปรเจกต์)
  โปรแกรมจึงอ่าน/เขียนผ่าน `docker compose exec app` แบบเดียวกับ scripts/set-admin-password.ps1
  หน้าเว็บอ่านไฟล์นี้ใหม่ทุก request → เปลี่ยนแล้วมีผลทันที ไม่ต้อง deploy / restart

กติกาที่ต้องตรงกับฝั่งเว็บ (src/lib/auth.ts · src/lib/access.ts):
  role "admin" = เข้าได้ทุกหน้า · "it_staff" = เฉพาะ key ใน pages (รายชื่อหน้าอ่านจาก src/lib/pages.json)
  active=false = ล็อกอินไม่ได้ และ cookie ที่ค้างอยู่ใช้ไม่ได้ทันที
  session_version เพิ่มขึ้น = cookie ทุกใบที่ออกก่อนหน้านั้นใช้ไม่ได้ (ตอนเปลี่ยนรหัส / ปิดใช้งาน / สั่งออก)
  password_hash = bcrypt cost 10 ($2b$) — ตัวเดียวกับที่ bcryptjs ในเว็บตรวจได้
"""

from __future__ import annotations

import argparse
import datetime as dt
import getpass
import hashlib
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

try:  # ไม่มี bcrypt ก็ยังให้ import โมดูลได้ (เทสต์ส่วนที่ไม่แฮช + บอกวิธีติดตั้งในหน้าต่างได้)
    import bcrypt
except ImportError:  # pragma: no cover - ขึ้นกับเครื่อง
    bcrypt = None

# ─────────────────────────────── ค่าคงที่ ───────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
PAGES_FILE = REPO_ROOT / "src" / "lib" / "pages.json"
ACCOUNTS_FILE = "staff_accounts.json"
LOG_FILE = "staff_admin_log.json"
CONTAINER_DATA_DIR = "/app/data"
COMPOSE_SERVICE = "app"

ROLE_ADMIN = "admin"
ROLE_STAFF = "it_staff"
ROLE_LABELS = {ROLE_ADMIN: "ผู้ดูแลระบบ", ROLE_STAFF: "เจ้าหน้าที่"}

# cost 10 = ค่าเดียวกับ src/lib/db/staff.ts และ scripts/admin-password.js
# สูงกว่านี้ไม่ได้ช่วยมาก แต่ทำให้ทุกการล็อกอินกิน CPU ของเซิร์ฟเวอร์ (bcryptjs เป็น JS ล้วน ~70 ms/ครั้งที่ cost 10)
BCRYPT_ROUNDS = 10
# 12 ตัว = ขั้นต่ำเดียวกับ set-admin-password.ps1 — หน้า login เปิดออกอินเทอร์เน็ตและยังไม่มีตัวจำกัดจำนวนครั้ง
MIN_PASSWORD_LENGTH = 12
# bcrypt ใช้แค่ 72 ไบต์แรก: Python bcrypt 5 ปฏิเสธ แต่ bcryptjs ตัดทิ้งเงียบๆ — กันไว้ไม่ให้สองฝั่งตีความต่างกัน
MAX_PASSWORD_BYTES = 72
SEED_PASSWORD = "ITadmin@2026"  # รหัสตั้งต้นที่อยู่ในซอร์สโค้ด (src/lib/db/staff.ts) — ห้ามใช้
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,32}$")
MAX_DISPLAY_NAME = 60
LOG_LIMIT = 2000
TH_TZ = dt.timezone(dt.timedelta(hours=7))  # ไทยไม่มี DST — ไม่ต้องพึ่งฐานข้อมูล timezone ของเครื่อง
TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

# ตัวอักษรที่ใช้สุ่มรหัส: ตัดตัวที่อ่านสับสน (0/O, 1/l/I) และสัญลักษณ์ที่พิมพ์ยากบนมือถือ/ไลน์ออก
_LOWER = "abcdefghijkmnopqrstuvwxyz"
_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_DIGITS = "23456789"
_SYMBOLS = "!@#%+=?-_"


class StaffError(Exception):
    """ข้อผิดพลาดที่ข้อความเป็นภาษาไทยพร้อมโชว์ผู้ใช้ได้ตรงๆ"""


class SourceError(StaffError):
    """อ่าน/เขียนแหล่งข้อมูลไม่ได้ (Docker ไม่เปิด, ไฟล์เสีย, สิทธิ์ไฟล์)"""


class ConflictError(StaffError):
    """ไฟล์ถูกแก้จากที่อื่นหลังจากที่โปรแกรมนี้โหลดมา — ต้องโหลดใหม่ก่อน ห้ามเขียนทับ"""


# ─────────────────────────────── ทะเบียนหน้า ───────────────────────────────


def load_pages(path: Path = PAGES_FILE) -> list[dict]:
    """รายชื่อหน้าจากไฟล์เดียวกับที่เว็บใช้สร้างเมนู — เพิ่มหน้าใหม่ในเว็บแล้วโปรแกรมนี้เห็นเอง"""
    try:
        pages = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SourceError(f"ไม่พบ {path} — โปรแกรมนี้ต้องอยู่ในโฟลเดอร์ tools ของโปรเจกต์ it-support-admin") from None
    except (OSError, ValueError) as exc:
        raise SourceError(f"อ่านรายชื่อหน้า {path} ไม่ได้: {exc}") from None
    if not isinstance(pages, list) or not all(
        isinstance(p, dict) and isinstance(p.get("key"), str) and isinstance(p.get("label"), str) for p in pages
    ):
        raise SourceError(f"{path} ผิดรูปแบบ — ต้องเป็นรายการ {{key, label, ...}}")
    return pages


# ─────────────────────────────── เวลา / ตัวช่วย ───────────────────────────────


def now_iso() -> str:
    """รูปแบบเดียวกับ Date.prototype.toISOString() ของฝั่งเว็บ (UTC + มิลลิวินาที + Z)"""
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def thai_time(iso: str | None) -> str:
    if not iso:
        return "-"
    try:
        d = dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TH_TZ)
    except ValueError:
        return iso
    return f"{d.day} {TH_MONTHS[d.month - 1]} {d.year + 543} · {d:%H:%M}"


def sha256(data: bytes | None) -> str:
    """ลายนิ้วมือของไฟล์ — "none" = ยังไม่มีไฟล์ (ใช้ตรวจว่ามีใครแก้ไฟล์ระหว่างที่เปิดโปรแกรมค้างไว้)"""
    return "none" if data is None else hashlib.sha256(data).hexdigest()


def actor_name() -> str:
    """คนทำรายการ = บัญชี Windows ที่เปิดโปรแกรม (โปรแกรมนี้ไม่มีล็อกอินของตัวเอง)"""
    try:
        user = getpass.getuser()
    except Exception:  # noqa: BLE001 - บางเครื่องไม่มีตัวแปร USERNAME
        user = "ไม่ทราบชื่อ"
    return f"{user}@{socket.gethostname()}"


# ─────────────────────────────── รหัสผ่าน ───────────────────────────────


def require_bcrypt() -> None:
    if bcrypt is None:
        raise StaffError(
            "ยังไม่ได้ติดตั้งไลบรารี bcrypt (ใช้แฮชรหัสผ่านให้ตรงกับเว็บ)\n\n"
            "ติดตั้งด้วยคำสั่ง:  py -m pip install bcrypt\n"
            "หรือเปิดโปรแกรมผ่าน staff-admin.bat ซึ่งติดตั้งให้เอง"
        )


def hash_password(password: str) -> str:
    require_bcrypt()
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("ascii")


def check_password_hash(password: str, password_hash: str) -> bool:
    if bcrypt is None or not isinstance(password_hash, str):
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except ValueError:  # hash เพี้ยน / ยาวเกิน — ถือว่าไม่ตรง ไม่ใช่ทำให้โปรแกรมล้ม
        return False


def generate_password(length: int = 16) -> str:
    """สุ่มจาก secrets (CSPRNG) — มีครบทุกกลุ่มตัวอักษร และไม่มีตัวที่อ่านสับสน"""
    pools = [_LOWER, _UPPER, _DIGITS, _SYMBOLS]
    chars = [secrets.choice(pool) for pool in pools]
    everything = "".join(pools)
    chars += [secrets.choice(everything) for _ in range(max(length, MIN_PASSWORD_LENGTH) - len(chars))]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def password_problem(password: str, confirm: str, username: str = "") -> str | None:
    """คืนข้อความบอกปัญหา (ภาษาไทย) หรือ None ถ้าใช้ได้"""
    if password != confirm:
        return "รหัสผ่านสองช่องไม่ตรงกัน"
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"รหัสผ่านสั้นเกินไป — ขอ {MIN_PASSWORD_LENGTH} ตัวอักษรขึ้นไป (หน้า login เปิดออกอินเทอร์เน็ต)"
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        return f"รหัสผ่านยาวเกินไป — ใช้ได้ไม่เกิน {MAX_PASSWORD_BYTES} ไบต์ (ตัวอักษรไทย 1 ตัว = 3 ไบต์)"
    if password != password.strip():
        return "รหัสผ่านห้ามขึ้นต้นหรือลงท้ายด้วยช่องว่าง (ตอนล็อกอินพิมพ์พลาดง่าย)"
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in password):
        return "รหัสผ่านมีตัวอักษรควบคุม (เช่น Tab) ปนอยู่"
    if password == SEED_PASSWORD:
        return "ห้ามใช้รหัสตั้งต้น — รหัสนี้อยู่ในซอร์สโค้ด ใครอ่าน repo ก็รู้"
    if len(username) >= 3 and username.lower() in password.lower():
        return "รหัสผ่านห้ามมีชื่อผู้ใช้อยู่ข้างใน"
    if len(set(password)) < 5:
        return "รหัสผ่านใช้ตัวอักษรซ้ำๆ เดาง่ายเกินไป"
    return None


# ─────────────────────────────── ตรวจข้อมูลบัญชี ───────────────────────────────


def _same_username(a: str, b: str) -> bool:
    return a.strip().lower() == b.strip().lower()


def username_problem(username: str, accounts: list[dict], exclude_id: str | None = None) -> str | None:
    if not USERNAME_RE.match(username):
        return "ชื่อผู้ใช้ต้องยาว 3–32 ตัว ใช้ได้เฉพาะ a-z A-Z 0-9 จุด ขีดกลาง และขีดล่าง (ไม่มีช่องว่าง/ภาษาไทย)"
    for acc in accounts:
        if acc.get("id") != exclude_id and _same_username(str(acc.get("username", "")), username):
            return f"มีชื่อผู้ใช้ '{acc.get('username')}' อยู่แล้ว (ไม่สนตัวพิมพ์เล็ก-ใหญ่ เพราะหน้า login ไม่สน)"
    return None


def display_name_problem(name: str) -> str | None:
    if not name.strip():
        return "กรอกชื่อที่แสดง (ชื่อนี้ติดไปกับทุกงานที่บัญชีนี้ทำในเว็บ)"
    if len(name.strip()) > MAX_DISPLAY_NAME:
        return f"ชื่อที่แสดงยาวเกิน {MAX_DISPLAY_NAME} ตัวอักษร"
    if any(ord(ch) < 32 for ch in name):
        return "ชื่อที่แสดงมีตัวอักษรควบคุมปนอยู่"
    return None


def is_active(acc: dict) -> bool:
    return acc.get("active") is not False


def active_admins(accounts: list[dict]) -> list[dict]:
    return [a for a in accounts if a.get("role") == ROLE_ADMIN and is_active(a)]


def _guard_last_admin(before: list[dict], after: list[dict]) -> None:
    """ห้ามทำให้ไม่เหลือแอดมินที่ใช้งานได้ — ไม่งั้นไม่มีใครเข้าเว็บไปดูแลระบบได้เลย
    (เช็กเฉพาะกรณี "ก่อนทำมีอยู่" เพื่อให้ไฟล์ใหม่ที่ยังไม่มีแอดมินสร้างเจ้าหน้าที่ได้ ไม่ติดล็อกตัวเอง)"""
    if active_admins(before) and not active_admins(after):
        raise StaffError(
            "ทำไม่ได้ — จะไม่เหลือผู้ดูแลระบบที่ใช้งานได้เลยสักคน\n"
            "สร้าง/เปิดใช้งานผู้ดูแลระบบคนอื่นก่อน แล้วค่อยทำกับบัญชีนี้"
        )


def _find(accounts: list[dict], account_id: str) -> int:
    matches = [i for i, a in enumerate(accounts) if a.get("id") == account_id]
    if not matches:
        raise StaffError("ไม่พบบัญชีนี้แล้ว (อาจถูกลบจากที่อื่น) — กด 'โหลดใหม่'")
    if len(matches) > 1:  # ไม่หยิบอันแรกเมื่อกำกวม — แก้ผิดคนอันตรายกว่าไม่แก้
        raise StaffError("พบบัญชีรหัสซ้ำกันในไฟล์ — แก้ไฟล์ให้ถูกก่อน (ไม่แก้ให้เพราะไม่รู้ว่าอันไหนถูก)")
    return matches[0]


def clean_pages(pages, known_keys: list[str]) -> list[str]:
    """เก็บเฉพาะ key ที่รู้จัก เรียงตามเมนู — ค่าแปลกปลอมจากการแก้ไฟล์มือถูกตัดทิ้ง"""
    wanted = set(pages or [])
    return [key for key in known_keys if key in wanted]


def page_labels(keys: list[str], pages: list[dict]) -> str:
    labels = {p["key"]: p["label"] for p in pages}
    return ", ".join(labels.get(k, k) for k in keys) or "-"


def _bump_version(acc: dict) -> None:
    current = acc.get("session_version")
    acc["session_version"] = (current if isinstance(current, int) and not isinstance(current, bool) else 0) + 1


# ─────────────────────────────── การกระทำ (pure: คืนรายการใหม่ ไม่แตะของเดิม) ───────────────────────────────


def _log(action: str, username: str, detail: str = "") -> dict:
    return {"at": now_iso(), "by": actor_name(), "action": action, "username": username, "detail": detail}


def op_create(
    accounts: list[dict],
    *,
    username: str,
    display_name: str,
    role: str,
    pages: list[str],
    password: str,
    confirm: str,
    known_pages: list[dict],
) -> tuple[list[dict], dict, dict]:
    username = username.strip()
    display_name = display_name.strip()
    for problem in (
        username_problem(username, accounts),
        display_name_problem(display_name),
        None if role in ROLE_LABELS else "ประเภทบัญชีไม่ถูกต้อง",
        password_problem(password, confirm, username),
    ):
        if problem:
            raise StaffError(problem)
    keys = [p["key"] for p in known_pages]
    stamp = now_iso()
    account = {
        "id": str(uuid.uuid4()),
        "username": username,
        "password_hash": hash_password(password),
        "display_name": display_name,
        "role": role,
        "created_at": stamp,
        "pages": clean_pages(pages, keys) if role == ROLE_STAFF else [],
        "active": True,
        "session_version": 0,
        "updated_at": stamp,
    }
    after = [*accounts, account]
    detail = f"{ROLE_LABELS[role]}" + (
        f" · หน้า: {page_labels(account['pages'], known_pages)}" if role == ROLE_STAFF else " · ทุกหน้า"
    )
    return after, account, _log("สร้างบัญชี", username, detail)


def op_update(
    accounts: list[dict],
    account_id: str,
    *,
    username: str,
    display_name: str,
    role: str,
    pages: list[str],
    active: bool,
    known_pages: list[dict],
) -> tuple[list[dict], dict | None]:
    """แก้ชื่อ/ประเภท/หน้า/สถานะ — คืน log=None เมื่อไม่มีอะไรเปลี่ยน (ไม่เขียนไฟล์ให้เปล่าๆ)"""
    i = _find(accounts, account_id)
    old = accounts[i]
    username = username.strip()
    display_name = display_name.strip()
    for problem in (
        username_problem(username, accounts, exclude_id=account_id),
        display_name_problem(display_name),
        None if role in ROLE_LABELS else "ประเภทบัญชีไม่ถูกต้อง",
    ):
        if problem:
            raise StaffError(problem)
    keys = [p["key"] for p in known_pages]
    new = dict(old)
    new.update(username=username, display_name=display_name, role=role, active=bool(active))
    # แอดมินเข้าได้ทุกหน้าอยู่แล้ว — เก็บรายการติ๊กเดิมไว้ ถ้าวันหลังลดเป็นเจ้าหน้าที่จะได้ไม่ต้องติ๊กใหม่ทั้งหมด
    new["pages"] = clean_pages(pages, keys) if role == ROLE_STAFF else clean_pages(old.get("pages"), keys)

    changes = []
    if old.get("username") != username:
        changes.append(f"ชื่อผู้ใช้ {old.get('username')} → {username}")
    if old.get("display_name") != display_name:
        changes.append(f"ชื่อที่แสดง {old.get('display_name')} → {display_name}")
    if old.get("role") != role:
        changes.append(f"ประเภท {ROLE_LABELS.get(old.get('role'), old.get('role'))} → {ROLE_LABELS[role]}")
    if role == ROLE_STAFF:
        before = clean_pages(old.get("pages"), keys) if old.get("role") == ROLE_STAFF else keys
        added = [k for k in new["pages"] if k not in before]
        removed = [k for k in before if k not in new["pages"]]
        if added:
            changes.append(f"เพิ่มหน้า: {page_labels(added, known_pages)}")
        if removed:
            changes.append(f"เอาหน้าออก: {page_labels(removed, known_pages)}")
    if is_active(old) != bool(active):
        changes.append("เปิดใช้งาน" if active else "ปิดใช้งาน")
        if not active:
            # ปิดแล้วเปิดใหม่ทีหลัง cookie เก่า (อายุ 7 วัน) ต้องไม่ฟื้นกลับมาใช้ได้ — จึงตัดรุ่น session ทิ้งด้วย
            _bump_version(new)
    if not changes:
        return accounts, None
    new["updated_at"] = now_iso()
    after = [*accounts[:i], new, *accounts[i + 1:]]
    _guard_last_admin(accounts, after)
    return after, _log("แก้ไขบัญชี", username, " · ".join(changes))


def op_reset_password(accounts: list[dict], account_id: str, password: str, confirm: str) -> tuple[list[dict], dict]:
    i = _find(accounts, account_id)
    old = accounts[i]
    problem = password_problem(password, confirm, str(old.get("username", "")))
    if problem:
        raise StaffError(problem)
    if check_password_hash(password, old.get("password_hash", "")):
        raise StaffError("รหัสใหม่ซ้ำกับรหัสเดิม — ถ้าจะเตะทุกเครื่องออกอย่างเดียว ใช้ปุ่ม 'บังคับออกจากระบบ'")
    new = dict(old, password_hash=hash_password(password), updated_at=now_iso())
    _bump_version(new)  # เปลี่ยนรหัส = ทุกเครื่องที่ล็อกอินค้างด้วยรหัสเก่าต้องหลุด (กรณีรหัสรั่ว)
    after = [*accounts[:i], new, *accounts[i + 1:]]
    return after, _log("ตั้งรหัสผ่านใหม่", str(old.get("username")), "ทุกเครื่องที่ล็อกอินค้างอยู่ถูกออกจากระบบ")


def op_set_active(accounts: list[dict], account_id: str, active: bool) -> tuple[list[dict], dict | None]:
    i = _find(accounts, account_id)
    old = accounts[i]
    if is_active(old) == bool(active):
        return accounts, None
    new = dict(old, active=bool(active), updated_at=now_iso())
    if not active:
        _bump_version(new)
    after = [*accounts[:i], new, *accounts[i + 1:]]
    _guard_last_admin(accounts, after)
    return after, _log("เปิดใช้งาน" if active else "ปิดใช้งาน", str(old.get("username")))


def op_force_logout(accounts: list[dict], account_id: str) -> tuple[list[dict], dict]:
    i = _find(accounts, account_id)
    new = dict(accounts[i], updated_at=now_iso())
    _bump_version(new)
    after = [*accounts[:i], new, *accounts[i + 1:]]
    return after, _log("บังคับออกจากระบบ", str(new.get("username")), "cookie ทุกใบของบัญชีนี้ใช้ไม่ได้แล้ว")


def op_delete(accounts: list[dict], account_id: str) -> tuple[list[dict], dict]:
    i = _find(accounts, account_id)
    old = accounts[i]
    after = [*accounts[:i], *accounts[i + 1:]]
    _guard_last_admin(accounts, after)
    return after, _log("ลบบัญชี", str(old.get("username")), f"{old.get('display_name', '')} ({ROLE_LABELS.get(old.get('role'), old.get('role'))})")


# ─────────────────────────────── แหล่งข้อมูล ───────────────────────────────


class FileBackend:
    """ไฟล์ในเครื่อง — ใช้ตอน npm run dev (data/ อยู่ในโฟลเดอร์โปรเจกต์) หรือตอนทดสอบ"""

    kind = "file"

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)

    def describe(self) -> str:
        return f"ไฟล์ในเครื่อง: {self.data_dir}"

    def check(self) -> None:
        if not self.data_dir.is_dir():
            raise SourceError(f"ไม่พบโฟลเดอร์ {self.data_dir}")

    def read(self, name: str) -> tuple[bytes | None, str]:
        path = self.data_dir / name
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            return None, "none"
        except OSError as exc:
            raise SourceError(f"อ่าน {path} ไม่ได้: {exc}") from None
        return data, sha256(data)

    def write(self, name: str, data: bytes, expected: str) -> None:
        path = self.data_dir / name
        current, current_hash = self.read(name)
        if current_hash != expected:
            raise ConflictError(f"{name} ถูกแก้จากที่อื่นหลังจากที่โปรแกรมนี้โหลดมา")
        tmp = path.with_name(f".{name}.{os.getpid()}.tmp")
        try:
            # เว็บ (npm run dev) สร้างโฟลเดอร์ data ตอน request แรก — ถ้ายังไม่เคยเปิดเว็บเลย สร้างให้เอง
            self.data_dir.mkdir(parents=True, exist_ok=True)
            if current is not None:
                path.with_name(name + ".bak").write_bytes(current)  # สำรองรุ่นก่อนหน้า 1 รุ่น
            tmp.write_bytes(data)
            # เขียนไฟล์ชั่วคราวแล้วสลับชื่อ — ไฟดับกลางทางไฟล์จริงยังเป็นชุดเดิมครบ (atomic เหมือน store.ts)
            # Windows สลับชื่อทับไฟล์ที่โปรแกรมอื่นเปิดค้าง (antivirus) ไม่ได้ชั่วขณะ จึงลองซ้ำสั้นๆ
            for attempt in range(10):
                try:
                    os.replace(tmp, path)
                    break
                except PermissionError:
                    if attempt == 9:
                        raise
                    time.sleep(0.2)
        except OSError as exc:
            try:
                tmp.unlink()
            except OSError:
                pass
            raise SourceError(f"เขียน {path} ไม่สำเร็จ: {exc}") from None


class DockerBackend:
    """ไฟล์ใน docker volume ของคอนเทนเนอร์ app — ข้อมูลจริงของระบบที่ใช้งานอยู่

    ทุกค่าส่งเป็น argument ตำแหน่ง ($1 $2 ...) ไม่เอาไปต่อเป็นสคริปต์ shell — กันค่าแปลกๆ กลายเป็นคำสั่ง
    เนื้อไฟล์ส่งทาง stdin (ไม่ผ่าน argument ซึ่งโผล่ในตาราง process และ `docker inspect`)"""

    kind = "docker"

    # อ่าน: บรรทัดแรกบอกว่ามีไฟล์ไหม + sha256 ที่คำนวณ "ในคอนเทนเนอร์" ตามด้วยเนื้อไฟล์
    # ใช้ hash จากฝั่งคอนเทนเนอร์เทียบกับของที่ได้รับ — ถ้าระหว่างทางมีอะไรแปลงขึ้นบรรทัด (\n → \r\n) จะรู้ทันที
    _READ = (
        'f="$1/$2"; '
        'if [ -f "$f" ]; then printf "FOUND %s\\n" "$(sha256sum "$f" | cut -d" " -f1)"; cat "$f"; '
        'else printf "NONE\\n"; fi'
    )
    # เขียนแบบ compare-and-swap ในคำสั่งเดียว: ไฟล์ปัจจุบันต้องตรงกับที่โหลดมา ($3) ไม่งั้นไม่เขียน (exit 3)
    _WRITE = (
        'f="$1/$2"; cur=none; '
        'if [ -f "$f" ]; then cur=$(sha256sum "$f" | cut -d" " -f1); fi; '
        'if [ "$cur" != "$3" ]; then echo CONFLICT; exit 3; fi; '
        'tmp="$1/.$2.$$.tmp"; '
        'cat > "$tmp" || { rm -f "$tmp"; exit 4; }; '
        'if [ -f "$f" ]; then cp "$f" "$f.bak"; fi; '
        'mv "$tmp" "$f"'
    )

    def __init__(self, project_dir: Path = REPO_ROOT, service: str = COMPOSE_SERVICE,
                 data_dir: str = CONTAINER_DATA_DIR, docker: str = "docker"):
        self.project_dir = Path(project_dir)
        self.service = service
        self.data_dir = data_dir
        self.docker = docker

    def describe(self) -> str:
        return f"Docker: คอนเทนเนอร์ {self.service} ({self.data_dir}) — ข้อมูลจริงของระบบ"

    def _run(self, script: str, *args: str, stdin: bytes | None = None, timeout: int = 60):
        cmd = [self.docker, "compose", "exec", "-T", self.service, "sh", "-c", script, "staff_admin", *args]
        try:
            return subprocess.run(
                cmd, cwd=self.project_dir, input=stdin, capture_output=True, timeout=timeout,
                # ไม่ให้หน้าต่าง console ดำเด้งขึ้นมาทุกครั้งที่เรียก docker (ตอนเปิดผ่าน pythonw)
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except FileNotFoundError:
            raise SourceError("ไม่พบคำสั่ง docker — ติดตั้ง/เปิด Docker Desktop ก่อน") from None
        except subprocess.TimeoutExpired:
            raise SourceError("Docker ไม่ตอบภายในเวลาที่กำหนด — Docker Desktop อาจกำลังเริ่มทำงาน ลองใหม่อีกครั้ง") from None

    @staticmethod
    def _err(result) -> str:
        text = (result.stderr or b"").decode("utf-8", "replace").strip()
        return text[-400:] or f"exit code {result.returncode}"

    def check(self) -> None:
        r = self._run('test -d "$1" && test -w "$1" && echo READY', self.data_dir, timeout=30)
        if r.returncode != 0 or b"READY" not in r.stdout:
            raise SourceError(
                "ติดต่อคอนเทนเนอร์ app ไม่ได้ — Docker Desktop เปิดอยู่ไหม และรัน `docker compose up -d app` แล้วหรือยัง\n\n"
                f"รายละเอียด: {self._err(r)}"
            )

    def read(self, name: str) -> tuple[bytes | None, str]:
        r = self._run(self._READ, self.data_dir, name)
        if r.returncode != 0:
            raise SourceError(f"อ่าน {name} จากคอนเทนเนอร์ไม่ได้: {self._err(r)}")
        head, sep, body = r.stdout.partition(b"\n")
        head = head.rstrip(b"\r")
        if head == b"NONE":
            return None, "none"
        if head.startswith(b"FOUND ") and sep:
            expected = head[6:].decode("ascii", "replace")
            if sha256(body) != expected:
                raise SourceError(f"ข้อมูล {name} เพี้ยนระหว่างส่งออกจาก Docker — ยกเลิกเพื่อไม่ให้เขียนทับของจริง")
            return body, expected
        raise SourceError(f"คำตอบจาก Docker ผิดรูปแบบตอนอ่าน {name}")

    def write(self, name: str, data: bytes, expected: str) -> None:
        r = self._run(self._WRITE, self.data_dir, name, expected, stdin=data)
        if r.returncode == 3:
            raise ConflictError(f"{name} ถูกแก้จากที่อื่นหลังจากที่โปรแกรมนี้โหลดมา")
        if r.returncode != 0:
            raise SourceError(f"เขียน {name} ในคอนเทนเนอร์ไม่สำเร็จ: {self._err(r)}")


# ─────────────────────────────── ที่เก็บบัญชี ───────────────────────────────


def duplicate_usernames(accounts: list[dict]) -> list[str]:
    seen: dict[str, int] = {}
    for acc in accounts:
        key = str(acc.get("username", "")).strip().lower()
        seen[key] = seen.get(key, 0) + 1
    return sorted(name for name, count in seen.items() if count > 1)


def _valid_entry(acc) -> bool:
    return isinstance(acc, dict) and isinstance(acc.get("id"), str) and isinstance(acc.get("username"), str)


def encode_accounts(accounts: list[dict]) -> bytes:
    # รูปแบบเดียวกับ JSON.stringify(data, null, 2) ของ store.ts — UTF-8 ไม่มี BOM, ภาษาไทยไม่ถูก escape
    return json.dumps(accounts, ensure_ascii=False, indent=2).encode("utf-8")


class StaffStore:
    """ถือรายการบัญชีที่โหลดมา + ลายนิ้วมือของไฟล์ตอนโหลด ทุกการบันทึกต้องผ่านที่นี่"""

    def __init__(self, backend):
        self.backend = backend
        self.accounts: list[dict] = []
        self.version = "none"
        self.missing = True

    def load(self) -> None:
        data, version = self.backend.read(ACCOUNTS_FILE)
        if data is None:
            accounts = []
        else:
            try:
                accounts = json.loads(data.decode("utf-8-sig"))
            except (UnicodeDecodeError, ValueError):
                raise SourceError(
                    "ไฟล์บัญชี (staff_accounts.json) อ่านไม่ออก — โปรแกรมจะไม่เขียนทับ\n"
                    "กู้ไฟล์จากโฟลเดอร์ backups/ หรือ staff_accounts.json.bak ก่อน"
                ) from None
            if not isinstance(accounts, list) or not all(_valid_entry(a) for a in accounts):
                raise SourceError("ไฟล์บัญชีผิดรูปแบบ (ต้องเป็นรายการบัญชีที่มี id และ username) — โปรแกรมจะไม่เขียนทับ")
            ids = [a["id"] for a in accounts]
            if len(ids) != len(set(ids)):
                raise SourceError("ไฟล์บัญชีมี id ซ้ำกัน (แก้ไฟล์มือพลาด?) — แก้ให้ไม่ซ้ำก่อน โปรแกรมเดาไม่ได้ว่าอันไหนถูก")
        self.accounts = accounts
        self.version = version
        self.missing = data is None

    def commit(self, accounts: list[dict], log_entry: dict | None) -> str | None:
        """บันทึกรายการใหม่ทั้งชุด → ตรวจว่าเขียนติดจริง → ต่อท้ายประวัติ
        คืนข้อความเตือน (ถ้าบันทึกบัญชีสำเร็จแต่เขียนประวัติไม่สำเร็จ) หรือ None"""
        if log_entry is None:
            return None
        ids = [a["id"] for a in accounts]
        if len(ids) != len(set(ids)):
            raise StaffError("มีบัญชีรหัสซ้ำกัน — ยกเลิกการบันทึก")
        if duplicate_usernames(accounts):
            raise StaffError(
                f"มีชื่อผู้ใช้ซ้ำกัน ({', '.join(duplicate_usernames(accounts))}) — เว็บจะไม่ให้ทั้งคู่ล็อกอิน\n"
                "เปลี่ยนชื่อหรือลบบัญชีที่ซ้ำก่อน แล้วค่อยทำรายการอื่น"
            )
        body = encode_accounts(accounts)
        self.backend.write(ACCOUNTS_FILE, body, self.version)
        # อ่านกลับมาเทียบ — "บันทึกแล้ว" ต้องแปลว่าเว็บจะอ่านเจอค่าใหม่จริง ไม่ใช่แค่คำสั่งไม่ error
        check, version = self.backend.read(ACCOUNTS_FILE)
        if check != body:
            raise SourceError("บันทึกแล้วอ่านกลับมาไม่ตรงกับที่เขียน — ห้ามถือว่าบันทึกสำเร็จ กด 'โหลดใหม่' แล้วตรวจอีกครั้ง")
        self.accounts = accounts
        self.version = version
        self.missing = False
        try:
            self.append_log(log_entry)
        except StaffError as exc:
            return f"บันทึกบัญชีแล้ว แต่เขียนประวัติการแก้ไขไม่สำเร็จ: {exc}"
        return None

    def append_log(self, entry: dict) -> None:
        for _ in range(3):  # ประวัติเป็นแบบต่อท้าย ชนกันก็แค่อ่านใหม่แล้วต่อท้ายอีกรอบ
            data, version = self.backend.read(LOG_FILE)
            try:
                rows = json.loads(data.decode("utf-8")) if data else []
                if not isinstance(rows, list):
                    rows = []
            except (UnicodeDecodeError, ValueError):
                rows = []  # ประวัติเสียไม่ควรขวางการทำงาน (ต่างจากไฟล์บัญชี) — เริ่มชุดใหม่
            rows = [*rows, entry][-LOG_LIMIT:]
            try:
                self.backend.write(LOG_FILE, json.dumps(rows, ensure_ascii=False, indent=2).encode("utf-8"), version)
                return
            except ConflictError:
                continue
        raise StaffError("ประวัติถูกเขียนพร้อมกันจากหลายที่")

    def read_log(self) -> list[dict]:
        data, _ = self.backend.read(LOG_FILE)
        if not data:
            return []
        try:
            rows = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise SourceError("ไฟล์ประวัติ (staff_admin_log.json) อ่านไม่ออก") from None
        return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


# ─────────────────────────────── หน้าจอ (tkinter) ───────────────────────────────

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
except ImportError:  # pragma: no cover - เครื่องที่ไม่มี tk ยังใช้ส่วนข้อมูล/เทสต์ได้
    tk = None


def _pick_font_family(root) -> str | None:
    from tkinter import font as tkfont

    families = set(tkfont.families(root))
    # ฟอนต์ที่อ่านภาษาไทยชัดบน Windows ก่อน แล้วค่อยถอยไปฟอนต์ทั่วไป
    for name in ("Leelawadee UI", "Tahoma", "Segoe UI", "Noto Sans Thai", "Garuda", "DejaVu Sans"):
        if name in families:
            return name
    return None


class Ui:
    """หน้าต่างแจ้งเตือนทั้งหมดผ่านคลาสนี้ — เทสต์แทนที่ได้ (กล่อง messagebox จริงค้างรอคนกด)"""

    def __init__(self, root):
        self.root = root

    def _parent(self):
        # มีหน้าต่างย่อยเปิดอยู่ (ถือ grab) → ผูกกล่องข้อความกับหน้าต่างนั้น ไม่งั้นกล่องไปโผล่ข้างหลังให้งงว่าโปรแกรมค้าง
        return self.root.grab_current() or self.root

    def info(self, title: str, text: str) -> None:
        messagebox.showinfo(title, text, parent=self._parent())

    def error(self, title: str, text: str) -> None:
        messagebox.showerror(title, text, parent=self._parent())

    def warn(self, title: str, text: str) -> None:
        messagebox.showwarning(title, text, parent=self._parent())

    def ask(self, title: str, text: str, danger: bool = False) -> bool:
        # งานอันตราย (ลบ/ปิดใช้งาน) ปุ่มตั้งต้นเป็น "ไม่" — กด Enter รัวๆ แล้วไม่เผลอลบ
        return messagebox.askyesno(
            title, text, parent=self._parent(), icon="warning" if danger else "question",
            default="no" if danger else "yes",
        )

    def choose_dir(self, title: str) -> str:
        return filedialog.askdirectory(parent=self._parent(), title=title, mustexist=True)


class PasswordFields:
    """ช่องรหัสผ่าน + ยืนยัน + ปุ่มสุ่ม/แสดง/คัดลอก — ใช้ทั้งตอนสร้างบัญชีและตอนตั้งรหัสใหม่"""

    def __init__(self, parent, root, row: int, on_status):
        self.root = root
        self.on_status = on_status
        self.password = tk.StringVar()
        self.confirm = tk.StringVar()
        self.show = tk.BooleanVar(value=False)

        ttk.Label(parent, text="รหัสผ่าน").grid(row=row, column=0, sticky="w", pady=3, padx=(0, 8))
        self.entry = ttk.Entry(parent, textvariable=self.password, show="•", width=34)
        self.entry.grid(row=row, column=1, sticky="we", pady=3)
        ttk.Label(parent, text="ยืนยันรหัสผ่าน").grid(row=row + 1, column=0, sticky="w", pady=3, padx=(0, 8))
        self.entry2 = ttk.Entry(parent, textvariable=self.confirm, show="•", width=34)
        self.entry2.grid(row=row + 1, column=1, sticky="we", pady=3)

        bar = ttk.Frame(parent)
        bar.grid(row=row + 2, column=1, sticky="w", pady=(2, 4))
        ttk.Button(bar, text="สุ่มรหัสผ่าน", command=self.generate).pack(side="left")
        ttk.Button(bar, text="คัดลอก", command=self.copy).pack(side="left", padx=4)
        ttk.Checkbutton(bar, text="แสดงรหัส", variable=self.show, command=self._toggle).pack(side="left", padx=4)
        ttk.Label(
            parent,
            text=f"อย่างน้อย {MIN_PASSWORD_LENGTH} ตัว · ห้ามมีชื่อผู้ใช้อยู่ข้างใน · ส่งให้เจ้าของบัญชีแบบส่วนตัว ห้ามแปะในกลุ่มแชท",
            foreground="#666",
        ).grid(row=row + 3, column=0, columnspan=2, sticky="w")

    def _toggle(self) -> None:
        char = "" if self.show.get() else "•"
        self.entry.configure(show=char)
        self.entry2.configure(show=char)

    def generate(self) -> None:
        pw = generate_password()
        self.password.set(pw)
        self.confirm.set(pw)
        self.show.set(True)
        self._toggle()
        self.copy()

    def copy(self) -> None:
        if not self.password.get():
            self.on_status("ยังไม่มีรหัสให้คัดลอก")
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(self.password.get())
        self.on_status("คัดลอกรหัสผ่านแล้ว — วางส่งให้เจ้าของบัญชีแบบส่วนตัว")

    def values(self) -> tuple[str, str]:
        return self.password.get(), self.confirm.get()


class Dialog:
    """หน้าต่างย่อยแบบ modal: Enter = บันทึก · Esc = ยกเลิก"""

    def __init__(self, app, title: str):
        self.app = app
        self.top = tk.Toplevel(app.root)
        self.top.title(title)
        self.top.transient(app.root)
        self.top.resizable(True, False)
        self.body = ttk.Frame(self.top, padding=14)
        self.body.pack(fill="both", expand=True)
        self.body.columnconfigure(1, weight=1)
        self.status = tk.StringVar()
        self.result = None
        self.top.bind("<Escape>", lambda _e: self.close())
        self.top.protocol("WM_DELETE_WINDOW", self.close)

    def say(self, text: str) -> None:
        """ข้อความบอกผลที่ไม่ใช่ข้อผิดพลาด (สีเขียว) — สีแดงสงวนไว้ให้ "ยังบันทึกไม่ได้" เท่านั้น"""
        self.status.set(text)
        self.status_label.configure(foreground="#1b5e20")

    def fail(self, text: str) -> None:
        self.status.set(text)
        self.status_label.configure(foreground="#b00020")

    def footer(self, row: int, save_text: str = "บันทึก", danger: bool = False) -> None:
        self.status_label = ttk.Label(self.body, textvariable=self.status, foreground="#b00020", wraplength=560,
                                      justify="left")
        self.status_label.grid(row=row, column=0, columnspan=2, sticky="w", pady=(8, 0))
        bar = ttk.Frame(self.body)
        bar.grid(row=row + 1, column=0, columnspan=2, sticky="e", pady=(10, 0))
        self.save_button = ttk.Button(bar, text=save_text, command=self.save, style="Danger.TButton" if danger else "TButton")
        self.save_button.pack(side="right")
        ttk.Button(bar, text="ยกเลิก", command=self.close).pack(side="right", padx=6)
        self.top.bind("<Return>", lambda _e: self.save())

    def show(self):
        self.top.update_idletasks()
        # วางกลางหน้าต่างหลัก
        x = self.app.root.winfo_rootx() + max(0, (self.app.root.winfo_width() - self.top.winfo_reqwidth()) // 2)
        y = self.app.root.winfo_rooty() + max(0, (self.app.root.winfo_height() - self.top.winfo_reqheight()) // 3)
        self.top.geometry(f"+{x}+{y}")
        self.top.grab_set()
        self.app.dialog = self
        self.top.wait_window()
        self.app.dialog = None
        return self.result

    def close(self) -> None:
        self.top.grab_release()
        self.top.destroy()

    def save(self) -> None:  # pragma: no cover - คลาสลูกเขียนทับ
        raise NotImplementedError


class AccountDialog(Dialog):
    """เพิ่มบัญชีใหม่ / แก้ชื่อ ประเภท หน้าที่เข้าได้ และสถานะ

    จัดเป็นสองฝั่ง (ซ้าย = ข้อมูลบัญชี · ขวา = หน้าที่เข้าได้) ไม่เรียงยาวลงล่าง เพราะโน้ตบุ๊กจอ 1366×768
    ที่ตั้งขยาย 125–150% สูงไม่พอ ปุ่ม "บันทึก" จะตกขอบจอ — คำอธิบายแต่ละหน้าจึงโชว์ทีละอันตอนชี้/เลือก"""

    def __init__(self, app, account: dict | None):
        super().__init__(app, "แก้ไขบัญชี" if account else "เพิ่มผู้ใช้ใหม่")
        self.account = account
        acc = account or {}
        self.username = tk.StringVar(value=acc.get("username", ""))
        self.display_name = tk.StringVar(value=acc.get("display_name", ""))
        self.role = tk.StringVar(value=acc.get("role") if acc.get("role") in ROLE_LABELS else ROLE_STAFF)
        self.active = tk.BooleanVar(value=is_active(acc))
        keys = [p["key"] for p in app.pages]
        ticked = set(clean_pages(acc.get("pages"), keys))
        self.page_vars = {p["key"]: tk.BooleanVar(value=p["key"] in ticked) for p in app.pages}
        self.hint = tk.StringVar(value="ชี้ที่ชื่อหน้าเพื่อดูว่าหน้านั้นทำอะไรได้บ้าง")

        left = ttk.Frame(self.body)
        left.grid(row=0, column=0, sticky="nw")
        left.columnconfigure(1, weight=1)
        right = ttk.LabelFrame(self.body, text="หน้าที่เข้าได้", padding=8)
        right.grid(row=0, column=1, sticky="nsew", padx=(14, 0))

        ttk.Label(left, text="ชื่อผู้ใช้ (ใช้ล็อกอิน)").grid(row=0, column=0, sticky="w", pady=3, padx=(0, 8))
        self.username_entry = ttk.Entry(left, textvariable=self.username, width=30)
        self.username_entry.grid(row=0, column=1, sticky="we", pady=3)
        ttk.Label(left, text="ชื่อที่แสดง").grid(row=1, column=0, sticky="w", pady=3, padx=(0, 8))
        ttk.Entry(left, textvariable=self.display_name, width=30).grid(row=1, column=1, sticky="we", pady=3)

        role_box = ttk.LabelFrame(left, text="ประเภทบัญชี", padding=8)
        role_box.grid(row=2, column=0, columnspan=2, sticky="we", pady=(8, 4))
        ttk.Radiobutton(role_box, text="เจ้าหน้าที่ — เข้าได้เฉพาะหน้าที่ติ๊กไว้", value=ROLE_STAFF,
                        variable=self.role, command=self._sync_pages).pack(anchor="w")
        ttk.Radiobutton(role_box, text="ผู้ดูแลระบบ — ทุกหน้า รวมหน้าที่จะเพิ่มในอนาคต", value=ROLE_ADMIN,
                        variable=self.role, command=self._sync_pages).pack(anchor="w")

        if account is None:
            pw_box = ttk.LabelFrame(left, text="รหัสผ่านเริ่มต้น", padding=8)
            pw_box.grid(row=3, column=0, columnspan=2, sticky="we", pady=4)
            pw_box.columnconfigure(1, weight=1)
            self.passwords = PasswordFields(pw_box, app.root, 0, lambda text: self.say(text))
        else:
            self.passwords = None
            state = ttk.LabelFrame(left, text="สถานะ", padding=8)
            state.grid(row=3, column=0, columnspan=2, sticky="we", pady=4)
            ttk.Checkbutton(state, text="เปิดใช้งาน", variable=self.active).pack(anchor="w")
            ttk.Label(state, text="เอาติ๊กออก = ล็อกอินไม่ได้ และหลุดจากทุกเครื่องทันที", foreground="#666").pack(anchor="w")
            meta = f"สร้างเมื่อ {thai_time(acc.get('created_at'))}\nแก้ล่าสุด {thai_time(acc.get('updated_at'))}"
            ttk.Label(left, text=meta, foreground="#666", justify="left").grid(row=4, column=0, columnspan=2, sticky="w", pady=(4, 0))

        tools = ttk.Frame(right)
        tools.grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 6))
        self.all_button = ttk.Button(tools, text="เลือกทั้งหมด", command=lambda: self._set_all(True))
        self.all_button.pack(side="left")
        self.none_button = ttk.Button(tools, text="ไม่เลือกเลย", command=lambda: self._set_all(False))
        self.none_button.pack(side="left", padx=6)
        self.page_checks = []
        rows = (len(app.pages) + 1) // 2
        for i, page in enumerate(app.pages):
            check = ttk.Checkbutton(right, text=page["label"], variable=self.page_vars[page["key"]])
            check.grid(row=1 + i % rows, column=i // rows, sticky="w", padx=(0, 18), pady=1)
            hint = f"{page['label']}: {page.get('hint', '')}"
            check.bind("<Enter>", lambda _e, h=hint: self.hint.set(h))
            check.bind("<FocusIn>", lambda _e, h=hint: self.hint.set(h))
            self.page_checks.append(check)
        ttk.Label(right, textvariable=self.hint, foreground="#555", wraplength=330, justify="left").grid(
            row=1 + rows, column=0, columnspan=2, sticky="w", pady=(8, 0))

        self.footer(1, "สร้างบัญชี" if account is None else "บันทึก")
        self._sync_pages()
        self.username_entry.focus_set()

    def _set_all(self, value: bool) -> None:
        for var in self.page_vars.values():
            var.set(value)

    def _sync_pages(self) -> None:
        # แอดมินเข้าได้ทุกหน้าอยู่แล้ว — ปิดช่องติ๊กไว้ไม่ให้เข้าใจผิดว่าเอาติ๊กออกแล้วจะถูกจำกัด
        state = ["disabled"] if self.role.get() == ROLE_ADMIN else ["!disabled"]
        for widget in (*self.page_checks, self.all_button, self.none_button):
            widget.state(state)

    def selected_pages(self) -> list[str]:
        return [key for key, var in self.page_vars.items() if var.get()]

    def save(self) -> None:
        app = self.app
        pages = self.selected_pages()
        if self.role.get() == ROLE_STAFF and not pages:
            if not app.ui.ask("ยังไม่ได้เลือกหน้า", "บัญชีเจ้าหน้าที่นี้จะล็อกอินได้แต่เข้าไม่ได้สักหน้า — บันทึกต่อไหม?"):
                return
        try:
            if self.account is None:
                password, confirm = self.passwords.values()
                accounts, account, log = op_create(
                    app.store.accounts, username=self.username.get(), display_name=self.display_name.get(),
                    role=self.role.get(), pages=pages, password=password, confirm=confirm, known_pages=app.pages,
                )
            else:
                accounts, log = op_update(
                    app.store.accounts, self.account["id"], username=self.username.get(),
                    display_name=self.display_name.get(), role=self.role.get(), pages=pages,
                    active=self.active.get(), known_pages=app.pages,
                )
                account = self.account
        except StaffError as exc:
            self.fail(str(exc))
            return
        if app.commit(accounts, log, f"บันทึก '{self.username.get().strip()}' แล้ว"):
            self.result = account
            self.close()


class PasswordDialog(Dialog):
    def __init__(self, app, account: dict):
        super().__init__(app, f"ตั้งรหัสผ่านใหม่ — {account.get('username')}")
        self.account = account
        ttk.Label(
            self.body, wraplength=520, justify="left",
            text="ตั้งรหัสใหม่แล้ว ทุกเครื่องที่ล็อกอินบัญชีนี้ค้างไว้จะหลุดทันที (กันกรณีรหัสเดิมรั่ว)",
        ).grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 8))
        self.passwords = PasswordFields(self.body, app.root, 1, lambda text: self.say(text))
        self.footer(5, "ตั้งรหัสผ่านใหม่")
        self.passwords.entry.focus_set()

    def save(self) -> None:
        password, confirm = self.passwords.values()
        try:
            accounts, log = op_reset_password(self.app.store.accounts, self.account["id"], password, confirm)
        except StaffError as exc:
            self.fail(str(exc))
            return
        if self.app.commit(accounts, log, f"ตั้งรหัสผ่านใหม่ให้ '{self.account.get('username')}' แล้ว"):
            self.result = True
            self.close()


class LogDialog(Dialog):
    def __init__(self, app, rows: list[dict]):
        super().__init__(app, "ประวัติการแก้ไขบัญชี")
        self.top.resizable(True, True)
        cols = ("at", "by", "action", "username", "detail")
        tree = ttk.Treeview(self.body, columns=cols, show="headings", height=12)
        for col, text, width in (("at", "เวลา", 150), ("by", "ทำโดย", 170), ("action", "รายการ", 130),
                                 ("username", "บัญชี", 120), ("detail", "รายละเอียด", 420)):
            tree.heading(col, text=text)
            tree.column(col, width=width, anchor="w", stretch=col == "detail")
        for r in reversed(rows):  # ใหม่สุดก่อน
            tree.insert("", "end", values=(thai_time(r.get("at")), r.get("by", ""), r.get("action", ""),
                                           r.get("username", ""), r.get("detail", "")))
        scroll = ttk.Scrollbar(self.body, orient="vertical", command=tree.yview)
        tree.configure(yscrollcommand=scroll.set)
        tree.grid(row=0, column=0, columnspan=2, sticky="nsew")
        scroll.grid(row=0, column=2, sticky="ns")
        self.body.rowconfigure(0, weight=1)
        ttk.Label(self.body, text=f"ทั้งหมด {len(rows)} รายการ (เก็บล่าสุด {LOG_LIMIT} รายการ)", foreground="#666").grid(
            row=1, column=0, sticky="w", pady=(6, 0))
        ttk.Button(self.body, text="ปิด", command=self.close).grid(row=1, column=1, sticky="e", pady=(6, 0))
        self.tree = tree


class StaffAdminApp:
    # ผลรวมความกว้างต้องไม่เกินพื้นที่ตารางตอนเปิดหน้าต่างขนาดตั้งต้น ไม่งั้นคอลัมน์ขวาสุดถูกตัดหาย
    COLUMNS = (
        ("username", "ชื่อผู้ใช้", 120),
        ("display", "ชื่อที่แสดง", 160),
        ("role", "ประเภท", 95),
        ("status", "สถานะ", 125),
        ("pages", "หน้าที่เข้าได้", 280),
        ("updated", "แก้ล่าสุด", 165),
    )

    def __init__(self, root, store: StaffStore, pages: list[dict], ui: Ui | None = None):
        self.root = root
        self.store = store
        self.pages = pages
        self.ui = ui or Ui(root)
        self.dialog = None
        self.status = tk.StringVar()
        self.search = tk.StringVar()
        self.source = tk.StringVar(value=store.backend.describe())
        self._seed_flags: dict[str, bool] = {}
        self._warned: set[tuple[str, str]] = set()
        # 1.0 ที่ 96 DPI — จอที่ตั้งขยาย 150% ได้ 1.5 (tk scaling = พิกเซลต่อพอยต์ · 96/72 = 1.333)
        self.scale = max(1.0, float(root.tk.call("tk", "scaling")) / (96 / 72))
        self._build()
        self.search.trace_add("write", lambda *_: self.refresh_table())

    # ---------- โครงหน้าจอ ----------

    def _build(self) -> None:
        root = self.root
        root.title("จัดการผู้ใช้ — IT Admin")
        root.minsize(1000, 520)
        style = ttk.Style(root)
        style.configure("Danger.TButton", foreground="#b00020")
        from tkinter import font as tkfont

        # ความสูงแถวเป็น "พิกเซล" ไม่ขยายตามสเกลจอเอง — คำนวณจากฟอนต์จริง ไม่งั้นสระบน/วรรณยุกต์ไทยถูกตัด
        line = tkfont.nametofont("TkDefaultFont").metrics("linespace")
        style.configure("Treeview", rowheight=max(24, int(line * 1.35) + 4))

        top = ttk.Frame(root, padding=(12, 10, 12, 4))
        top.pack(fill="x")
        ttk.Label(top, textvariable=self.source, foreground="#0b5394").pack(side="left")
        ttk.Button(top, text="เปลี่ยนแหล่งข้อมูล…", command=self.change_source).pack(side="right")
        ttk.Button(top, text="โหลดใหม่ (F5)", command=self.reload).pack(side="right", padx=6)

        bar = ttk.Frame(root, padding=(12, 4))
        bar.pack(fill="x")
        ttk.Label(bar, text="ค้นหา").pack(side="left")
        self.search_entry = ttk.Entry(bar, textvariable=self.search, width=30)
        self.search_entry.pack(side="left", padx=6)
        ttk.Label(bar, text="(ชื่อผู้ใช้ / ชื่อที่แสดง)", foreground="#666").pack(side="left")

        middle = ttk.Frame(root, padding=(12, 4))
        middle.pack(fill="both", expand=True)
        cols = [c[0] for c in self.COLUMNS]
        self.tree = ttk.Treeview(middle, columns=cols, show="headings", selectmode="browse")
        for key, text, width in self.COLUMNS:
            self.tree.heading(key, text=text)
            self.tree.column(key, width=int(width * self.scale), minwidth=int(60 * self.scale), anchor="w",
                             stretch=key == "pages")
        self.tree.tag_configure("off", foreground="#999999")
        self.tree.tag_configure("seed", foreground="#b00020")
        scroll = ttk.Scrollbar(middle, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        # จองที่ให้แถบปุ่มก่อน แล้วตารางค่อยกินพื้นที่ที่เหลือ — ถ้าตารางได้ก่อน ปุ่มจะถูกบีบจนตัวหนังสือขาด
        side = ttk.Frame(middle, padding=(10, 0, 0, 0))
        side.pack(side="right", fill="y")
        scroll.pack(side="right", fill="y")
        self.tree.pack(side="left", fill="both", expand=True)
        buttons = [
            ("เพิ่มผู้ใช้ใหม่", self.add_user, "TButton"),
            ("แก้ไข / สิทธิ์หน้า", self.edit_user, "TButton"),
            ("ตั้งรหัสผ่านใหม่", self.reset_password, "TButton"),
            ("ปิด / เปิดใช้งาน", self.toggle_active, "TButton"),
            ("บังคับออกจากระบบ", self.force_logout, "TButton"),
            ("ลบบัญชี", self.delete_user, "Danger.TButton"),
            (None, None, None),
            ("ประวัติการแก้ไข", self.show_log, "TButton"),
        ]
        for text, command, style_name in buttons:
            if text is None:
                ttk.Separator(side).pack(fill="x", pady=8)
                continue
            ttk.Button(side, text=text, command=command, style=style_name, width=20).pack(fill="x", pady=3)

        ttk.Label(root, textvariable=self.status, padding=(12, 6), relief="sunken", anchor="w").pack(fill="x")

        self.tree.bind("<<TreeviewSelect>>", lambda _e: self._show_selected())
        self.tree.bind("<Double-1>", lambda _e: self.edit_user())
        self.tree.bind("<Return>", lambda _e: self.edit_user())
        self.tree.bind("<Delete>", lambda _e: self.delete_user())
        root.bind("<F5>", lambda _e: self.reload())
        root.bind("<Control-f>", lambda _e: self.search_entry.focus_set())
        root.bind("<Control-n>", lambda _e: self.add_user())

    # ---------- ข้อมูล ----------

    def busy(self, on: bool) -> None:
        # docker exec ใช้เวลา ~1 วินาที และหน้าจอค้างระหว่างนั้น — เปลี่ยนเคอร์เซอร์ให้รู้ว่ากำลังทำงาน
        self.root.configure(cursor="watch" if on else "")
        self.root.update_idletasks()

    def reload(self) -> bool:
        self.busy(True)
        try:
            self.store.load()
        except StaffError as exc:
            self.ui.error("โหลดข้อมูลไม่สำเร็จ", str(exc))
            self.status.set("โหลดข้อมูลไม่สำเร็จ — แก้ปัญหาแล้วกด 'โหลดใหม่'")
            self.store.accounts = []
            self.refresh_table()
            return False
        finally:
            self.busy(False)
        self._scan_seed_passwords()
        self.refresh_table()
        if self.store.missing:
            self.status.set("ยังไม่มีไฟล์บัญชี — สร้าง 'ผู้ดูแลระบบ' คนแรกได้เลย (ถ้าไม่สร้าง เว็บจะสร้างบัญชี admin รหัสตั้งต้นให้เอง)")
        else:
            self.status.set(f"โหลดแล้ว {len(self.store.accounts)} บัญชี · {thai_time(now_iso())}")
        # เตือนครั้งเดียวต่อเรื่องต่อการเปิดโปรแกรม — กด F5 ซ้ำๆ ไม่ต้องเด้งกล่องเดิมทุกครั้ง
        dups = [d for d in duplicate_usernames(self.store.accounts) if ("dup", d) not in self._warned]
        if dups:
            self._warned.update(("dup", d) for d in dups)
            self.ui.warn("พบชื่อผู้ใช้ซ้ำ", f"ชื่อผู้ใช้ซ้ำกัน: {', '.join(dups)}\nเว็บจะไม่ให้บัญชีที่ซ้ำล็อกอินจนกว่าจะเปลี่ยนชื่อหรือลบให้เหลืออันเดียว")
        seeds = [a["username"] for a in self.store.accounts
                 if self._seed_flags.get(a.get("password_hash", "")) and is_active(a) and ("seed", a["id"]) not in self._warned]
        if seeds:
            self._warned.update(("seed", a["id"]) for a in self.store.accounts if a["username"] in seeds)
            self.ui.warn("ยังใช้รหัสตั้งต้น", f"บัญชี {', '.join(seeds)} ยังใช้รหัสผ่านตั้งต้นที่อยู่ในซอร์สโค้ด\n"
                         "ใครเปิดอ่าน repo ก็ล็อกอินได้ — เลือกบัญชีแล้วกด 'ตั้งรหัสผ่านใหม่' ทันที")
        return True

    def _scan_seed_passwords(self) -> None:
        """เตือนบัญชีที่ยังใช้รหัสตั้งต้นจากซอร์สโค้ด — ตรวจครั้งเดียวต่อ hash (bcrypt ช้าโดยตั้งใจ)"""
        flags = {}
        for acc in self.store.accounts:
            h = acc.get("password_hash", "")
            flags[h] = self._seed_flags[h] if h in self._seed_flags else check_password_hash(SEED_PASSWORD, h)
        self._seed_flags = flags

    def _status_text(self, acc: dict) -> str:
        text = "ใช้งาน" if is_active(acc) else "ปิดใช้งาน"
        if self._seed_flags.get(acc.get("password_hash", "")):
            text += " · รหัสตั้งต้น!"
        return text

    def _pages_text(self, acc: dict) -> str:
        if acc.get("role") == ROLE_ADMIN:
            return "ทุกหน้า"
        keys = clean_pages(acc.get("pages"), [p["key"] for p in self.pages])
        return f"{len(keys)}/{len(self.pages)} · {page_labels(keys, self.pages)}" if keys else "— ยังไม่ได้เลือก —"

    def refresh_table(self) -> None:
        selected = self.selected_id()
        self.tree.delete(*self.tree.get_children())
        q = self.search.get().strip().lower()
        rows = sorted(self.store.accounts, key=lambda a: (not is_active(a), a.get("role") != ROLE_ADMIN,
                                                          str(a.get("username", "")).lower()))
        for acc in rows:
            if q and q not in str(acc.get("username", "")).lower() and q not in str(acc.get("display_name", "")).lower():
                continue
            tags = []
            if not is_active(acc):
                tags.append("off")
            if self._seed_flags.get(acc.get("password_hash", "")):
                tags.append("seed")
            self.tree.insert("", "end", iid=acc["id"], tags=tags, values=(
                acc.get("username", ""), acc.get("display_name", ""),
                ROLE_LABELS.get(acc.get("role"), str(acc.get("role", "?"))), self._status_text(acc),
                self._pages_text(acc), thai_time(acc.get("updated_at") or acc.get("created_at")),
            ))
        if selected and self.tree.exists(selected):
            self.tree.selection_set(selected)
            self.tree.see(selected)

    def _show_selected(self) -> None:
        """คอลัมน์หน้าที่เข้าได้ถูกตัดเมื่อยาว — โชว์รายการเต็มที่แถบสถานะตอนเลือกแถว"""
        account_id = self.selected_id()
        acc = next((a for a in self.store.accounts if a.get("id") == account_id), None)
        if acc:
            pages = "ทุกหน้า" if acc.get("role") == ROLE_ADMIN else page_labels(
                clean_pages(acc.get("pages"), [p["key"] for p in self.pages]), self.pages)
            self.status.set(f"{acc.get('username')} ({acc.get('display_name', '')}) — เข้าได้: {pages}")

    def selected_id(self) -> str | None:
        sel = self.tree.selection()
        return sel[0] if sel else None

    def selected_account(self) -> dict | None:
        account_id = self.selected_id()
        if not account_id:
            self.ui.info("ยังไม่ได้เลือกบัญชี", "คลิกเลือกบัญชีในตารางก่อน")
            return None
        for acc in self.store.accounts:
            if acc.get("id") == account_id:
                return acc
        self.ui.info("ไม่พบบัญชี", "บัญชีนี้หายไปแล้ว — กด 'โหลดใหม่'")
        return None

    def commit(self, accounts: list[dict], log: dict | None, done_text: str) -> bool:
        """บันทึก + จัดการทุกกรณีผิดพลาดในที่เดียว คืน True เมื่อสำเร็จ (หรือไม่มีอะไรต้องบันทึก)"""
        if log is None:
            self.status.set("ไม่มีอะไรเปลี่ยน")
            return True
        self.busy(True)
        try:
            warning = self.store.commit(accounts, log)
        except ConflictError:
            self.busy(False)
            self.ui.warn(
                "ข้อมูลถูกแก้จากที่อื่น",
                "ไฟล์บัญชีถูกเปลี่ยนหลังจากที่โปรแกรมนี้โหลดมา (อาจเปิดโปรแกรมนี้ค้างไว้อีกเครื่อง)\n"
                "โปรแกรมจะโหลดข้อมูลล่าสุดให้ — ทำรายการเดิมอีกครั้ง",
            )
            self.reload()
            return False
        except StaffError as exc:
            self.busy(False)
            self.ui.error("บันทึกไม่สำเร็จ", str(exc))
            return False
        self.busy(False)
        self._scan_seed_passwords()
        self.refresh_table()
        self.status.set(f"{done_text} · มีผลกับเว็บทันที")
        if warning:
            self.ui.warn("บันทึกแล้ว แต่มีข้อควรรู้", warning)
        return True

    # ---------- ปุ่ม ----------

    def add_user(self):
        result = AccountDialog(self, None).show()
        if result:
            self.tree.selection_set(result["id"])
            self.tree.see(result["id"])
        return result

    def edit_user(self):
        acc = self.selected_account()
        return AccountDialog(self, acc).show() if acc else None

    def reset_password(self):
        acc = self.selected_account()
        return PasswordDialog(self, acc).show() if acc else None

    def toggle_active(self) -> bool:
        acc = self.selected_account()
        if not acc:
            return False
        turning_on = not is_active(acc)
        question = (f"เปิดใช้งานบัญชี '{acc['username']}' อีกครั้ง?" if turning_on else
                    f"ปิดใช้งานบัญชี '{acc['username']}'?\n\nเจ้าของบัญชีจะหลุดจากทุกเครื่องทันทีและล็อกอินไม่ได้ "
                    "(ข้อมูลและประวัติงานยังอยู่ครบ เปิดกลับได้ทุกเมื่อ)")
        if not self.ui.ask("ยืนยัน", question, danger=not turning_on):
            return False
        try:
            accounts, log = op_set_active(self.store.accounts, acc["id"], turning_on)
        except StaffError as exc:
            self.ui.error("ทำไม่ได้", str(exc))
            return False
        return self.commit(accounts, log, f"{'เปิด' if turning_on else 'ปิด'}ใช้งาน '{acc['username']}' แล้ว")

    def force_logout(self) -> bool:
        acc = self.selected_account()
        if not acc:
            return False
        if not self.ui.ask("ยืนยัน", f"ให้บัญชี '{acc['username']}' หลุดจากทุกเครื่องที่ล็อกอินค้างอยู่?\n"
                                     "(ใช้ตอนทำเครื่องหาย หรือสงสัยว่ามีคนอื่นใช้บัญชีนี้ — เจ้าของล็อกอินใหม่ได้ด้วยรหัสเดิม)"):
            return False
        try:
            accounts, log = op_force_logout(self.store.accounts, acc["id"])
        except StaffError as exc:
            self.ui.error("ทำไม่ได้", str(exc))
            return False
        return self.commit(accounts, log, f"'{acc['username']}' ถูกออกจากระบบทุกเครื่องแล้ว")

    def delete_user(self) -> bool:
        acc = self.selected_account()
        if not acc:
            return False
        if not self.ui.ask(
            "ลบบัญชีถาวร",
            f"ลบบัญชี '{acc['username']}' ({acc.get('display_name', '')}) ถาวร?\n\n"
            "แนะนำ 'ปิดใช้งาน' แทนสำหรับคนที่ลาออก/ย้ายงาน — ได้ผลเหมือนกัน (เข้าไม่ได้ทันที) แต่ย้อนกลับได้\n"
            "ลบเหมาะกับบัญชีที่สร้างผิดเท่านั้น",
            danger=True,
        ):
            return False
        try:
            accounts, log = op_delete(self.store.accounts, acc["id"])
        except StaffError as exc:
            self.ui.error("ทำไม่ได้", str(exc))
            return False
        return self.commit(accounts, log, f"ลบบัญชี '{acc['username']}' แล้ว")

    def show_log(self):
        self.busy(True)
        try:
            rows = self.store.read_log()
        except StaffError as exc:
            self.ui.error("อ่านประวัติไม่สำเร็จ", str(exc))
            return None
        finally:
            self.busy(False)
        return LogDialog(self, rows).show()

    def change_source(self) -> None:
        if self.store.backend.kind == "file":
            if not self.ui.ask("เปลี่ยนแหล่งข้อมูล", "สลับไปแก้ข้อมูลจริงในคอนเทนเนอร์ app ผ่าน Docker?"):
                return
            backend = DockerBackend()
        else:
            folder = self.ui.choose_dir("เลือกโฟลเดอร์ data (ใช้ตอน npm run dev / ทดสอบ)")
            if not folder:
                return
            backend = FileBackend(Path(folder))
        self.busy(True)
        try:
            backend.check()
        except StaffError as exc:
            self.busy(False)
            self.ui.error("เชื่อมต่อไม่ได้", str(exc))
            return
        self.busy(False)
        self.store = StaffStore(backend)
        self._seed_flags = {}
        self.source.set(backend.describe())
        self.reload()


# ─────────────────────────────── เริ่มโปรแกรม ───────────────────────────────


def _dpi_aware() -> None:
    """Windows ขยายหน้าต่างโปรแกรมเก่าแบบภาพแตก ตัวหนังสือไทยเบลอ — ขอวาดเองตาม DPI จริง"""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:  # noqa: BLE001 - Windows รุ่นเก่า/ไม่รองรับ ใช้แบบเดิมได้
        pass


def choose_backend(args, ui: Ui):
    if args.data_dir:
        backend = FileBackend(Path(args.data_dir).resolve())
        backend.check()
        return backend
    backend = DockerBackend()
    try:
        backend.check()
        return backend
    except SourceError as exc:
        if not ui.ask("ติดต่อ Docker ไม่ได้", f"{exc}\n\nเลือกโฟลเดอร์ data ในเครื่องแทนไหม? (สำหรับ npm run dev / ทดสอบ)"):
            return None
    folder = ui.choose_dir("เลือกโฟลเดอร์ data")
    if not folder:
        return None
    backend = FileBackend(Path(folder))
    backend.check()
    return backend


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="จัดการผู้ใช้และสิทธิ์หน้าเว็บ IT Admin")
    parser.add_argument("--data-dir", help="แก้ไฟล์ในโฟลเดอร์นี้แทนคอนเทนเนอร์ Docker (เช่น data ตอน npm run dev)")
    args = parser.parse_args(argv)
    if tk is None:
        print("ไม่พบ tkinter — ติดตั้ง Python จาก python.org (ติ๊ก tcl/tk ตอนติดตั้ง)", file=sys.stderr)
        return 1

    _dpi_aware()
    root = tk.Tk()
    family = _pick_font_family(root)
    if family:
        from tkinter import font as tkfont

        for name in ("TkDefaultFont", "TkTextFont", "TkHeadingFont", "TkMenuFont"):
            tkfont.nametofont(name).configure(family=family, size=10)
    ui = Ui(root)
    try:
        require_bcrypt()
        pages = load_pages()
        backend = choose_backend(args, ui)
    except StaffError as exc:
        ui.error("เปิดโปรแกรมไม่ได้", str(exc))
        root.destroy()
        return 1
    if backend is None:
        root.destroy()
        return 1
    app = StaffAdminApp(root, StaffStore(backend), pages, ui)
    width = min(int(1240 * app.scale), int(root.winfo_screenwidth() * 0.92))
    height = min(int(620 * app.scale), int(root.winfo_screenheight() * 0.85))
    root.geometry(f"{width}x{height}")
    root.after(50, app.reload)
    root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
