"""เทสต์ส่วนข้อมูลของโปรแกรมจัดการผู้ใช้ (tools/staff_admin.py) — ไม่ต้องมีจอ

สิ่งที่ต้องไม่พัง:
  - บัญชีที่โปรแกรมสร้าง ต้องล็อกอินผ่านโค้ดเว็บตัวจริงได้ (bcrypt + รูปแบบไฟล์ตรงกัน)
  - ปิดใช้งาน / เปลี่ยนรหัส / สั่งออก = cookie เดิมในเว็บใช้ไม่ได้ทันที
  - ห้ามเขียนทับไฟล์ที่ถูกแก้จากที่อื่น / ไฟล์เสีย และห้ามทำให้ไม่เหลือแอดมิน
ทุกข้อใช้โฟลเดอร์ชั่วคราว ไม่แตะข้อมูลจริง
"""

from __future__ import annotations

import json
import os
import re
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

import staff_admin as sa

REPO = Path(__file__).resolve().parents[2]
PAGES = sa.load_pages()
KEYS = [p["key"] for p in PAGES]
STRONG = "Correct-Horse-42!"


def make_admin(accounts=None, **over):
    accounts = accounts or []
    after, acc, _ = sa.op_create(
        accounts, username=over.pop("username", "boss"), display_name=over.pop("display_name", "หัวหน้า IT"),
        role=over.pop("role", sa.ROLE_ADMIN), pages=over.pop("pages", []), password=STRONG, confirm=STRONG,
        known_pages=PAGES,
    )
    return after, acc


def make_staff(accounts, username="somchai", pages=("tickets", "notes")):
    return sa.op_create(
        accounts, username=username, display_name="สมชาย ใจดี", role=sa.ROLE_STAFF, pages=list(pages),
        password=STRONG, confirm=STRONG, known_pages=PAGES,
    )


# ───────────── ทะเบียนหน้า ─────────────


def test_รายชื่อหน้าตรงกับ_PAGE_KEYS_ของเว็บ():
    """ฝั่งเว็บก็มีเทสต์ข้อนี้ (tests/access.test.cjs) — ข้อนี้กันจากฝั่ง .py เผื่อมีคนแก้ pages.json อย่างเดียว"""
    code = (REPO / "src/lib/access.ts").read_text(encoding="utf-8")
    block = re.search(r"PAGE_KEYS = \[(.*?)\] as const", code, re.S).group(1)
    assert KEYS == re.findall(r'"([^"]+)"', block)
    assert all(p.get("hint") for p in PAGES), "ทุกหน้าต้องมีคำอธิบาย (โชว์ข้างช่องติ๊ก)"


# ───────────── รหัสผ่าน ─────────────


@pytest.mark.parametrize("pw,confirm,user,expect", [
    ("Abcdefgh123!", "Abcdefgh124!", "", "ไม่ตรงกัน"),
    ("Short1!", "Short1!", "", "สั้นเกินไป"),
    ("ก" * 25, "ก" * 25, "", "ยาวเกินไป"),          # 25 ตัวไทย = 75 ไบต์ > 72
    (" Abcdefgh123!", " Abcdefgh123!", "", "ช่องว่าง"),
    ("Abcdefgh\t123!", "Abcdefgh\t123!", "", "ควบคุม"),
    (sa.SEED_PASSWORD, sa.SEED_PASSWORD, "", "รหัสตั้งต้น"),
    ("xx-Somchai-2026!", "xx-Somchai-2026!", "somchai", "ชื่อผู้ใช้"),
    ("aaaaaaaaaaaaaaab", "aaaaaaaaaaaaaaab", "", "ซ้ำๆ"),
])
def test_รหัสผ่านที่ไม่ผ่านเกณฑ์ถูกปฏิเสธพร้อมเหตุผล(pw, confirm, user, expect):
    problem = sa.password_problem(pw, confirm, user)
    assert problem and expect in problem


def test_รหัสผ่านที่ดีผ่าน_และยาวพอดีขอบผ่าน():
    assert sa.password_problem(STRONG, STRONG, "somchai") is None
    exact = "Ab1!" + "x" * (sa.MIN_PASSWORD_LENGTH - 4)
    assert sa.password_problem(exact, exact) is None, "ยาวพอดีขั้นต่ำต้องผ่าน (กันเขียนเงื่อนไขเป็น <=)"
    thai = "รหัสลับ" + "ก" * 17  # 24 ตัวไทย = 72 ไบต์พอดี
    assert sa.password_problem(thai, thai) is None


def test_รหัสที่สุ่มผ่านเกณฑ์เสมอ_มีครบทุกกลุ่ม_และไม่มีตัวที่อ่านสับสน():
    seen = set()
    for _ in range(300):
        pw = sa.generate_password()
        assert sa.password_problem(pw, pw) is None
        assert len(pw) == 16
        assert any(c in sa._LOWER for c in pw) and any(c in sa._UPPER for c in pw)
        assert any(c in sa._DIGITS for c in pw) and any(c in sa._SYMBOLS for c in pw)
        assert not set(pw) & set("0O1lI'\"\\ `")
        seen.add(pw)
    assert len(seen) == 300, "ต้องไม่ซ้ำกันเลย (สุ่มจาก CSPRNG)"


# ───────────── สร้าง / แก้ / ลบ ─────────────


def test_สร้างบัญชี_รูปแบบตรงกับที่เว็บอ่าน():
    accounts, admin = make_admin()
    accounts, staff, log = make_staff(accounts, pages=["notes", "ไม่มีจริง", "tickets"])
    assert staff["pages"] == ["tickets", "notes"], "เรียงตามเมนู ตัดค่าที่ไม่รู้จักทิ้ง"
    assert staff["role"] == "it_staff" and staff["active"] is True and staff["session_version"] == 0
    assert staff["password_hash"].startswith("$2b$10$")
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", staff["created_at"]), "รูปแบบเดียวกับ toISOString()"
    assert admin["pages"] == [], "แอดมินไม่ต้องเก็บรายการหน้า (ได้ทุกหน้าอยู่แล้ว)"
    assert log["action"] == "สร้างบัญชี" and "Tickets" in log["detail"]
    assert STRONG not in json.dumps(log, ensure_ascii=False), "ห้ามมีรหัสผ่านในประวัติ"


@pytest.mark.parametrize("username,expect", [
    ("ab", "3–32"), ("สมชาย", "3–32"), ("has space", "3–32"), ("BOSS", "มีชื่อผู้ใช้"),
])
def test_ชื่อผู้ใช้ผิดรูปแบบหรือซ้ำ_ไม่สนตัวพิมพ์(username, expect):
    accounts, _ = make_admin()
    with pytest.raises(sa.StaffError, match=expect):
        sa.op_create(accounts, username=username, display_name="x", role=sa.ROLE_STAFF, pages=[],
                     password=STRONG, confirm=STRONG, known_pages=PAGES)


def test_แก้ไข_บันทึกเฉพาะที่เปลี่ยน_และประวัติบอกว่าเปลี่ยนอะไร():
    accounts, admin = make_admin()
    accounts, staff, _ = make_staff(accounts)
    same, log = sa.op_update(accounts, staff["id"], username="somchai", display_name="สมชาย ใจดี",
                             role=sa.ROLE_STAFF, pages=["tickets", "notes"], active=True, known_pages=PAGES)
    assert log is None and same is accounts, "ไม่มีอะไรเปลี่ยน = ไม่เขียนไฟล์"

    after, log = sa.op_update(accounts, staff["id"], username="somchai.j", display_name="สมชาย",
                              role=sa.ROLE_STAFF, pages=["tickets", "stock"], active=True, known_pages=PAGES)
    new = next(a for a in after if a["id"] == staff["id"])
    assert new["username"] == "somchai.j" and new["pages"] == ["tickets", "stock"]
    assert new["session_version"] == 0, "แก้สิทธิ์ไม่ต้องเตะออก (เว็บอ่านสิทธิ์ใหม่ทุก request)"
    assert "เพิ่มหน้า: สต็อก" in log["detail"] and "เอาหน้าออก: ฝากข้อความ" in log["detail"]
    assert next(a for a in accounts if a["id"] == staff["id"])["username"] == "somchai", "ห้ามแก้ list เดิม"


def test_ปิดใช้งานเพิ่ม_session_version_เปิดกลับไม่ทำให้_cookie_เก่าฟื้น():
    accounts, _ = make_admin()
    accounts, staff, _ = make_staff(accounts)
    off, log = sa.op_set_active(accounts, staff["id"], False)
    assert log["action"] == "ปิดใช้งาน"
    off_acc = next(a for a in off if a["id"] == staff["id"])
    assert off_acc["active"] is False and off_acc["session_version"] == 1
    on, _ = sa.op_set_active(off, staff["id"], True)
    assert next(a for a in on if a["id"] == staff["id"])["session_version"] == 1, "เปิดกลับต้องไม่ลดเลขกลับไป"
    assert sa.op_set_active(on, staff["id"], True) == (on, None), "สถานะเดิม = ไม่มีอะไรต้องทำ"


def test_ห้ามทำให้ไม่เหลือแอดมินที่ใช้งานได้():
    accounts, admin = make_admin()
    accounts, staff, _ = make_staff(accounts)
    for attempt in (
        lambda: sa.op_set_active(accounts, admin["id"], False),
        lambda: sa.op_delete(accounts, admin["id"]),
        lambda: sa.op_update(accounts, admin["id"], username="boss", display_name="หัวหน้า IT",
                             role=sa.ROLE_STAFF, pages=["tickets"], active=True, known_pages=PAGES),
    ):
        with pytest.raises(sa.StaffError, match="ผู้ดูแลระบบ"):
            attempt()
    # มีแอดมินคนที่สองแล้ว = ทำกับคนแรกได้
    accounts, _ = make_admin(accounts, username="boss2")
    after, _ = sa.op_delete(accounts, admin["id"])
    assert len(sa.active_admins(after)) == 1


def test_ไฟล์ใหม่ยังไม่มีแอดมิน_สร้างเจ้าหน้าที่ได้ไม่ติดล็อก():
    accounts, staff, _ = make_staff([])
    assert sa.op_set_active(accounts, staff["id"], False)[1] is not None


def test_ตั้งรหัสใหม่_เตะทุกเครื่อง_และห้ามซ้ำรหัสเดิม():
    accounts, admin = make_admin()
    with pytest.raises(sa.StaffError, match="ซ้ำกับรหัสเดิม"):
        sa.op_reset_password(accounts, admin["id"], STRONG, STRONG)
    after, log = sa.op_reset_password(accounts, admin["id"], "Brand-New-Pass#7", "Brand-New-Pass#7")
    new = after[0]
    assert new["session_version"] == 1 and new["password_hash"] != admin["password_hash"]
    assert sa.check_password_hash("Brand-New-Pass#7", new["password_hash"])
    assert "Brand-New-Pass#7" not in json.dumps(log, ensure_ascii=False)


def test_บังคับออกจากระบบ_เพิ่มเลขทุกครั้ง():
    accounts, admin = make_admin()
    once, _ = sa.op_force_logout(accounts, admin["id"])
    twice, _ = sa.op_force_logout(once, admin["id"])
    assert twice[0]["session_version"] == 2


def test_บัญชีรหัสซ้ำ_ไม่เดาว่าอันไหนถูก():
    accounts, admin = make_admin()
    with pytest.raises(sa.StaffError, match="ซ้ำ"):
        sa.op_force_logout([admin, dict(admin)], admin["id"])
    with pytest.raises(sa.StaffError, match="ไม่พบ"):
        sa.op_delete(accounts, "ไม่มีจริง")


# ───────────── ไฟล์ในเครื่อง ─────────────


def test_บันทึกแล้วอ่านกลับได้_มี_bak_และประวัติ(tmp_path):
    store = sa.StaffStore(sa.FileBackend(tmp_path))
    store.load()
    assert store.accounts == [] and store.missing
    accounts, admin = make_admin()
    assert store.commit(accounts, {"action": "x", "username": "boss"}) is None
    raw = (tmp_path / sa.ACCOUNTS_FILE).read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf"), "ห้ามมี BOM"
    assert json.loads(raw) == accounts
    accounts2, _ = sa.op_force_logout(accounts, admin["id"])
    store.commit(accounts2, {"action": "y", "username": "boss"})
    assert json.loads((tmp_path / "staff_accounts.json.bak").read_bytes()) == accounts, "สำรองรุ่นก่อนหน้า 1 รุ่น"
    assert [r["action"] for r in store.read_log()] == ["x", "y"]
    assert not list(tmp_path.glob(".*.tmp")), "ไม่มีไฟล์ชั่วคราวค้าง"


def test_โฟลเดอร์_data_ยังไม่มี_สร้างให้ตอนบันทึก(tmp_path):
    store = sa.StaffStore(sa.FileBackend(tmp_path / "ยังไม่มี" / "data"))
    store.load()
    accounts, _ = make_admin()
    assert store.commit(accounts, {"action": "x"}) is None
    assert json.loads((tmp_path / "ยังไม่มี" / "data" / sa.ACCOUNTS_FILE).read_bytes()) == accounts


def test_ไฟล์ถูกแก้จากที่อื่นหลังโหลด_ห้ามเขียนทับ(tmp_path):
    store = sa.StaffStore(sa.FileBackend(tmp_path))
    store.load()
    accounts, _ = make_admin()
    store.commit(accounts, {"action": "x"})
    other = sa.StaffStore(sa.FileBackend(tmp_path))  # โปรแกรมอีกตัว (อีกเครื่อง) เปิดค้างไว้
    other.load()
    more, _, _ = make_staff(accounts)
    store.commit(more, {"action": "y"})
    before = (tmp_path / sa.ACCOUNTS_FILE).read_bytes()
    with pytest.raises(sa.ConflictError):
        other.commit(make_staff(other.accounts, username="ghost")[0], {"action": "z"})
    assert (tmp_path / sa.ACCOUNTS_FILE).read_bytes() == before


@pytest.mark.parametrize("content", [b'[{"id": "x", "username": "a"', b"", b'{"id": "x"}', b'[{"username": "no-id"}]',
                                     b'[{"id": "a", "username": "x"}, {"id": "a", "username": "y"}]'])
def test_ไฟล์เสีย_ไม่ยอมโหลด_และไม่แตะไฟล์(tmp_path, content):
    path = tmp_path / sa.ACCOUNTS_FILE
    path.write_bytes(content)
    store = sa.StaffStore(sa.FileBackend(tmp_path))
    with pytest.raises(sa.SourceError):
        store.load()
    assert path.read_bytes() == content


def test_ชื่อผู้ใช้ซ้ำในไฟล์_โหลดได้เพื่อแก้_แต่บันทึกอย่างอื่นไม่ได้จนกว่าจะแก้(tmp_path):
    accounts, admin = make_admin()
    dup = dict(admin, id="id-dup", username="BOSS")
    (tmp_path / sa.ACCOUNTS_FILE).write_bytes(sa.encode_accounts([*accounts, dup]))
    store = sa.StaffStore(sa.FileBackend(tmp_path))
    store.load()
    assert sa.duplicate_usernames(store.accounts) == ["boss"]
    with pytest.raises(sa.StaffError, match="ชื่อผู้ใช้ซ้ำ"):
        store.commit(sa.op_force_logout(store.accounts, admin["id"])[0], {"action": "x"})
    fixed, log = sa.op_update(store.accounts, "id-dup", username="boss-2", display_name="หัวหน้า IT",
                              role=sa.ROLE_ADMIN, pages=[], active=True, known_pages=PAGES)
    assert store.commit(fixed, log) is None


def test_ประวัติเก็บไม่เกินเพดาน_และไฟล์ประวัติเสียไม่ขวางงาน(tmp_path, monkeypatch):
    monkeypatch.setattr(sa, "LOG_LIMIT", 5)
    (tmp_path / sa.LOG_FILE).write_bytes("{เสีย".encode("utf-8"))
    store = sa.StaffStore(sa.FileBackend(tmp_path))
    store.load()
    accounts, admin = make_admin()
    for i in range(8):
        accounts, log = sa.op_force_logout(accounts, admin["id"])
        assert store.commit(accounts, log) is None
    rows = store.read_log()
    assert len(rows) == 5


# ───────────── Docker (จำลองคำสั่ง docker ด้วย sh ในเครื่อง) ─────────────


def _fake_docker(tmp_path: Path, mangle_crlf: bool = False) -> str:
    """docker compose exec -T app sh -c SCRIPT ... → รัน sh -c SCRIPT ... ตรงๆ ในเครื่อง
    ใช้สคริปต์ shell ตัวจริงของ DockerBackend (sha256sum / cut / mv) ไม่ได้จำลองตรรกะซ้ำ"""
    script = tmp_path / "docker"
    tail = '"$@" | sed "s/$/\\r/"' if mangle_crlf else 'exec "$@"'
    script.write_text(
        "#!/bin/sh\n"
        '[ "$1" = compose ] && [ "$2" = exec ] && [ "$3" = -T ] && [ "$4" = app ] || { echo "unexpected: $*" >&2; exit 99; }\n'
        "shift 4\n"
        f"{tail}\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return str(script)


@pytest.mark.skipif(shutil.which("sh") is None or shutil.which("sha256sum") is None, reason="ต้องมี sh + sha256sum")
def test_docker_อ่านเขียนแบบ_compare_and_swap(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    backend = sa.DockerBackend(project_dir=tmp_path, data_dir=str(data), docker=_fake_docker(tmp_path))
    backend.check()
    assert backend.read(sa.ACCOUNTS_FILE) == (None, "none")

    store = sa.StaffStore(backend)
    store.load()
    accounts, admin = make_admin()
    assert store.commit(accounts, {"action": "x"}) is None
    assert json.loads((data / sa.ACCOUNTS_FILE).read_text(encoding="utf-8")) == accounts
    assert (data / sa.LOG_FILE).exists()

    stale = sa.StaffStore(backend)
    stale.load()
    (data / sa.ACCOUNTS_FILE).write_text("[]")  # มีคนแก้ระหว่างนั้น
    with pytest.raises(sa.ConflictError):
        stale.commit(sa.op_force_logout(stale.accounts, admin["id"])[0], {"action": "y"})
    assert (data / sa.ACCOUNTS_FILE).read_text() == "[]"
    assert not list(data.glob(".*.tmp"))


@pytest.mark.skipif(shutil.which("sh") is None or shutil.which("sha256sum") is None, reason="ต้องมี sh + sha256sum")
def test_docker_ข้อมูลเพี้ยนระหว่างทาง_ต้องรู้ตัว_ไม่ใช้ข้อมูลนั้น(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    (data / sa.ACCOUNTS_FILE).write_bytes(sa.encode_accounts(make_admin()[0]))
    backend = sa.DockerBackend(project_dir=tmp_path, data_dir=str(data), docker=_fake_docker(tmp_path, mangle_crlf=True))
    with pytest.raises(sa.SourceError, match="เพี้ยน"):
        backend.read(sa.ACCOUNTS_FILE)


def test_docker_ไม่ได้ติดตั้ง_บอกเป็นภาษาคน(tmp_path):
    backend = sa.DockerBackend(project_dir=tmp_path, docker=str(tmp_path / "ไม่มีโปรแกรมนี้"))
    with pytest.raises(sa.SourceError, match="Docker"):
        backend.check()


# ───────────── ใช้กับเว็บตัวจริงได้ ─────────────

NODE = shutil.which("node")
HAS_NODE_DEPS = (REPO / "node_modules" / "bcryptjs").is_dir() and (REPO / "node_modules" / "typescript").is_dir()


def _web(workdir: Path, *args: str) -> dict:
    out = subprocess.run([NODE, str(Path(__file__).with_name("web_login_check.cjs")), str(workdir), *args],
                         capture_output=True, timeout=120)
    assert out.returncode == 0, out.stderr.decode("utf-8", "replace")
    return json.loads(out.stdout)


@pytest.mark.skipif(not NODE or not HAS_NODE_DEPS, reason="ต้องมี node + npm install")
def test_บัญชีจากโปรแกรมนี้_ล็อกอินผ่านโค้ดเว็บจริง_และถูกตัดทันทีเมื่อสั่ง(tmp_path):
    store = sa.StaffStore(sa.FileBackend(tmp_path / "data"))
    (tmp_path / "data").mkdir()
    store.load()
    thai_pw = "รหัสไทย-Pass-2569"  # ตัวอักษรไทย: bcrypt ฝั่ง Python กับ bcryptjs ต้องเข้ารหัส UTF-8 เหมือนกัน
    accounts, admin = make_admin()
    accounts, staff, log = sa.op_create(accounts, username="Somchai", display_name="สมชาย", role=sa.ROLE_STAFF,
                                        pages=["stock", "tickets"], password=thai_pw, confirm=thai_pw, known_pages=PAGES)
    store.commit(accounts, log)

    ok = _web(tmp_path, "login", "somchai", thai_pw)
    assert ok["ok"] is True, ok
    assert ok["session"]["pages"] == ["tickets", "stock"]
    assert ok["session"]["displayName"] == "สมชาย"
    assert _web(tmp_path, "login", "somchai", "ผิด")["ok"] is False

    token = ok["token"]
    assert _web(tmp_path, "session", token)["session"]["staffId"] == staff["id"]
    # เปลี่ยนสิทธิ์ = มีผลกับ cookie เดิมทันที
    accounts, log = sa.op_update(store.accounts, staff["id"], username="Somchai", display_name="สมชาย",
                                 role=sa.ROLE_STAFF, pages=["faq"], active=True, known_pages=PAGES)
    store.commit(accounts, log)
    assert _web(tmp_path, "session", token)["session"]["pages"] == ["faq"]
    # สั่งออกจากระบบ = cookie เดิมใช้ไม่ได้ แต่ล็อกอินใหม่ได้
    accounts, log = sa.op_force_logout(store.accounts, staff["id"])
    store.commit(accounts, log)
    assert _web(tmp_path, "session", token)["session"] is None
    fresh = _web(tmp_path, "login", "somchai", thai_pw)
    assert fresh["ok"] is True
    # ปิดใช้งาน = cookie ใหม่ก็ใช้ไม่ได้ และล็อกอินไม่ได้
    accounts, log = sa.op_set_active(store.accounts, staff["id"], False)
    store.commit(accounts, log)
    assert _web(tmp_path, "session", fresh["token"])["session"] is None
    blocked = _web(tmp_path, "login", "somchai", thai_pw)
    assert blocked["ok"] is False and "ปิดใช้งาน" in blocked["error"]
