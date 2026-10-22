"""เทสต์หน้าจอโปรแกรมจัดการผู้ใช้ — กดปุ่มจริงทุกขั้นตอนบนหน้าต่าง tkinter จริง

ต้องมีจอ (Windows ปกติมีอยู่แล้ว · Linux ใช้ xvfb-run) ไม่มีจอ/ไม่มี tkinter = ข้ามทั้งไฟล์
กล่องข้อความ (ยืนยัน/แจ้งเตือน) ถูกแทนด้วย FakeUi เพราะกล่องจริงหยุดรอคนกด
"""

from __future__ import annotations

import json
import os
import sys

import pytest

tk = pytest.importorskip("tkinter")
if sys.platform != "win32" and not os.environ.get("DISPLAY"):
    pytest.skip("ไม่มีจอ (DISPLAY) — รันผ่าน xvfb-run", allow_module_level=True)

import staff_admin as sa  # noqa: E402

PAGES = sa.load_pages()


class FakeUi:
    def __init__(self):
        self.messages = []
        self.answer = True

    def info(self, title, text):
        self.messages.append(("info", title, text))

    def error(self, title, text):
        self.messages.append(("error", title, text))

    def warn(self, title, text):
        self.messages.append(("warn", title, text))

    def ask(self, title, text, danger=False):
        self.messages.append(("ask", title, text))
        return self.answer

    def choose_dir(self, title):
        return ""


@pytest.fixture()
def app(tmp_path):
    root = tk.Tk()
    ui = FakeUi()
    application = sa.StaffAdminApp(root, sa.StaffStore(sa.FileBackend(tmp_path)), PAGES, ui)
    application.reload()
    yield application
    root.destroy()


def with_dialog(app, step, open_fn):
    """เปิดหน้าต่างย่อยแล้วให้ step ทำงานในหน้าต่างนั้น — กันเทสต์ค้าง: 5 วินาทีแล้วยังไม่ปิด = ปิดให้แล้วล้ม"""
    state = {"timeout": False}

    def run():
        if app.dialog is None:  # หน้าต่างยังไม่ขึ้น รอรอบถัดไป
            app.root.after(20, run)
            return
        app.root.update()
        step(app.dialog)

    def guard():
        if app.dialog is not None:
            state["timeout"] = True
            app.dialog.close()

    app.root.after(20, run)
    timer = app.root.after(5000, guard)
    result = open_fn()
    app.root.after_cancel(timer)
    assert not state["timeout"], f"หน้าต่างไม่ยอมปิด — ข้อความในหน้าต่าง: {getattr(app, '_last_status', '')}"
    return result


def saved(app):
    return json.loads((app.store.backend.data_dir / sa.ACCOUNTS_FILE).read_text(encoding="utf-8"))


def add(app, username, role=sa.ROLE_STAFF, pages=("tickets",)):
    def step(d):
        d.username.set(username)
        d.display_name.set(f"ชื่อ {username}")
        d.role.set(role)
        d._sync_pages()
        for key in pages:
            d.page_vars[key].set(True)
        d.passwords.generate()
        d.save()
        app._last_status = d.status.get()

    return with_dialog(app, step, app.add_user)


def select(app, username):
    acc = next(a for a in app.store.accounts if a["username"] == username)
    app.tree.selection_set(acc["id"])
    return acc


def test_ทุกขั้นตอนผ่านหน้าจอ_เพิ่ม_แก้_รหัส_ปิด_สั่งออก_ลบ_ประวัติ(app):
    assert "ยังไม่มีไฟล์บัญชี" in app.status.get()

    boss = add(app, "boss", role=sa.ROLE_ADMIN, pages=())
    assert boss and boss["role"] == "admin"
    staff = add(app, "somchai", pages=("tickets", "stock"))
    assert saved(app)[1]["pages"] == ["tickets", "stock"]
    assert app.tree.item(staff["id"])["values"][4].startswith("2/")
    assert app.root.clipboard_get() and len(app.root.clipboard_get()) == 16, "สุ่มรหัสแล้วคัดลอกให้เลย"

    # แก้: เอา stock ออก เพิ่ม faq
    select(app, "somchai")

    def edit(d):
        d.page_vars["stock"].set(False)
        d.page_vars["faq"].set(True)
        d.save()

    with_dialog(app, edit, app.edit_user)
    assert saved(app)[1]["pages"] == ["tickets", "faq"]

    # ตั้งรหัสใหม่ — ไม่ตรงกันต้องบอกในหน้าต่าง ไม่ปิดหน้าต่าง
    select(app, "somchai")

    def reset(d):
        d.passwords.password.set("Another-Pass-99!")
        d.passwords.confirm.set("Another-Pass-98!")
        d.save()
        assert "ไม่ตรงกัน" in d.status.get()
        d.passwords.confirm.set("Another-Pass-99!")
        d.save()

    assert with_dialog(app, reset, app.reset_password) is True
    after_reset = saved(app)[1]
    assert after_reset["session_version"] == 1
    assert sa.check_password_hash("Another-Pass-99!", after_reset["password_hash"])

    # ปิดใช้งาน / สั่งออก
    select(app, "somchai")
    assert app.toggle_active() is True
    assert saved(app)[1]["active"] is False and saved(app)[1]["session_version"] == 2
    assert "off" in app.tree.item(staff["id"])["tags"]
    select(app, "somchai")
    assert app.force_logout() is True
    assert saved(app)[1]["session_version"] == 3

    # ปิดแอดมินคนเดียวไม่ได้ — ต้องเห็นข้อความเตือน และไฟล์ไม่เปลี่ยน
    before = saved(app)
    select(app, "boss")
    assert app.toggle_active() is False
    assert app.ui.messages[-1][0] == "error" and "ผู้ดูแลระบบ" in app.ui.messages[-1][2]
    assert saved(app) == before

    # ลบ: ตอบ "ไม่" = ไม่ลบ · ตอบ "ใช่" = ลบ
    select(app, "somchai")
    app.ui.answer = False
    assert app.delete_user() is False
    app.ui.answer = True
    select(app, "somchai")
    assert app.delete_user() is True
    assert [a["username"] for a in saved(app)] == ["boss"]

    # ประวัติ: ใหม่สุดอยู่บน
    def look(d):
        rows = d.tree.get_children()
        assert len(rows) == 7
        assert d.tree.item(rows[0])["values"][2] == "ลบบัญชี"
        d.close()

    with_dialog(app, look, app.show_log)


def test_ช่องติ๊กหน้าใช้ไม่ได้เมื่อเลือกผู้ดูแลระบบ(app):
    def step(d):
        d.role.set(sa.ROLE_ADMIN)
        d._sync_pages()
        assert all(c.instate(["disabled"]) for c in d.page_checks)
        d.role.set(sa.ROLE_STAFF)
        d._sync_pages()
        assert not any(c.instate(["disabled"]) for c in d.page_checks)
        d.close()

    assert with_dialog(app, step, app.add_user) is None


def test_ข้อมูลไม่ครบ_บอกในหน้าต่างและไม่บันทึก(app):
    def step(d):
        d.username.set("x")  # สั้นเกิน
        d.display_name.set("ชื่อ")
        d.passwords.generate()
        d.save()
        assert "3–32" in d.status.get()
        d.close()

    with_dialog(app, step, app.add_user)
    assert not (app.store.backend.data_dir / sa.ACCOUNTS_FILE).exists()


def test_เจ้าหน้าที่ไม่ติ๊กสักหน้า_ต้องถามก่อน(app):
    app.ui.answer = False

    def step(d):
        d.username.set("nobody")
        d.display_name.set("ไม่มีสิทธิ์")
        d.passwords.generate()
        d.save()
        assert app.ui.messages[-1][0] == "ask"
        d.close()

    with_dialog(app, step, app.add_user)
    assert not (app.store.backend.data_dir / sa.ACCOUNTS_FILE).exists()


def test_ไฟล์ถูกแก้จากที่อื่น_เตือนแล้วโหลดใหม่ให้(app):
    add(app, "boss", role=sa.ROLE_ADMIN, pages=())
    (app.store.backend.data_dir / sa.ACCOUNTS_FILE).write_text("[]", encoding="utf-8")
    select(app, "boss")
    assert app.force_logout() is False
    assert any(m[0] == "warn" and "ถูกแก้จากที่อื่น" in m[1] for m in app.ui.messages)
    assert app.store.accounts == [], "ต้องโหลดของล่าสุดมาแสดง"


def test_ค้นหากรองตาราง(app):
    add(app, "boss", role=sa.ROLE_ADMIN, pages=())
    add(app, "somchai")
    app.search.set("SOM")
    assert len(app.tree.get_children()) == 1
    app.search.set("")
    assert len(app.tree.get_children()) == 2


def test_เตือนบัญชีที่ยังใช้รหัสตั้งต้น(app):
    accounts = [{
        "id": "seed", "username": "admin", "password_hash": sa.hash_password(sa.SEED_PASSWORD),
        "display_name": "ผู้ดูแลระบบ IT", "role": "admin", "created_at": sa.now_iso(),
    }]
    (app.store.backend.data_dir / sa.ACCOUNTS_FILE).write_bytes(sa.encode_accounts(accounts))
    app.reload()
    assert any(m[0] == "warn" and "รหัสตั้งต้น" in m[1] for m in app.ui.messages)
    assert "รหัสตั้งต้น" in app.tree.item("seed")["values"][3]
    count = len(app.ui.messages)
    app.reload()
    assert len(app.ui.messages) == count, "กด F5 ซ้ำไม่ต้องเด้งเตือนเรื่องเดิมอีก"
