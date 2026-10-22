"""เทสต์เมนูเลือกสาขา: ปุ่ม "ดูเพิ่ม" ต้องพาไปหน้าถัดไปของเมนูสาขาเอง + พิมพ์ชื่อเขต/AM ได้

ที่มา: ผู้ใช้แจ้ง (13 ต.ค. 2026) พร้อมภาพหน้าจอ — เมนูเลือกเขตของ Motta กด "▼ ดูเพิ่ม (หน้า 2/2)" แล้วบอทตอบ
"ตอนนี้ดึงรายการทรัพย์สินมาให้เลือกไม่ได้ครับ" และหาเขตของน้องใบตองไม่เจอ (อยู่หน้า 2)

สาเหตุ: เมนูสาขาไม่ได้ส่ง page_action ให้ _picker_reply ปุ่มจึงใช้ค่าตั้งต้น a=pk_page ซึ่งเป็นปุ่มของเมนูทรัพย์สิน

สิ่งที่ต้องไม่พัง:
  - ปุ่ม "ดูเพิ่ม" ของเมนูสาขาทุกชั้นพาไปหน้าถัดไปของชั้นนั้น (เขตหน้า 2 · สาขาที่ 9 ขึ้นไป)
  - การ์ดเก่าที่ส่งไปแล้ว (ยังเป็น a=pk_page) กดแล้วต้องได้หน้าถัดไปของเมนูสาขา ไม่ใช่ error ทรัพย์สิน
  - พิมพ์ชื่อเขต/AM ("ใบตอง", "น้องใบตอง") เปิดรายชื่อสาขาของเขตนั้น — แต่ชื่อสาขาตรงเป๊ะยังชนะเสมอ
  - เมนูทรัพย์สินยังใช้ pk_page เหมือนเดิม

15 ต.ค. 2026: Montipa เลิกแบ่งตามภูมิภาค มาแบ่งตามเขตของ Area Manager (ตารางทีมขาย ต.ค. 2026) แบบเดียวกับ Motta
  - การ์ดเขตของ Montipa ต้องยกชื่อ AM ของ Montipa เองเป็นตัวอย่าง (ยกใบตองของ Motta ให้พิมพ์ตามจะไม่เจออะไร)
  - พิมพ์ชื่อ AM ของ Montipa ("ก้อย", "คุณทับทิม") เปิดสาขาของเขตนั้นได้เหมือนกัน
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import flow as F  # noqa: E402
from app import messages as M  # noqa: E402
from app.flow import handle  # noqa: E402
from app.store import Session  # noqa: E402
from test_flow import BRANCH_OPTIONS, USER, FakeBackend, postback, store, text  # noqa: E402

# เขตของ Motta ตามตาราง Area Manager จริง (src/lib/db/branches.ts) — 10 เขต = การ์ด 2 หน้า (หน้าละ 8)
MOTTA_AREAS = [
    ("por", "ทีมปอ"), ("aum", "ทีมอุ้ม"), ("em", "ทีมเอ็ม"), ("ann", "ทีมแอน"), ("beam", "ทีมบีม"),
    ("may", "ทีมเมย์"), ("por-new", "ทีมปอ New"), ("mali", "ทีมมะลิ"), ("nan", "ทีมแนน"),
    ("baitong", "ทีมใบตอง"),
]
POR_BRANCHES = ["ลาดพร้าว", "เวสต์เกสต์", "ภูเก็ต", "หาดใหญ่", "นครศรี", "ท่าพระ", "ตรัง",
                "สุราษฎร์ธานี", "กระบี่", "ถลาง"]
BAITONG_BRANCHES = ["พัทยา", "อมตะ", "สุวรรณภูมิ", "นอร์ทวิลล์", "จันทบุรี", "บ้านฉาง"]
NAN_BRANCHES = ["ฉะเชิงเทรา", "ศรีราชา", "ชลบุรี", "สมุทรปราการ", "ลพบุรี", "ทรูดิจิตอล"]
POR_NEW_BRANCHES = ["สุพรรณบุรี", "ฟิวเจอร์", "สระบุรี", "พระราม 9", "ศรีสมาน"]

# เขตของ Montipa ตามตาราง "สาขาที่รับผิดชอบของทีมขาย MONTIPA เดือน ตุลาคม 2026" — 7 เขต = การ์ดหน้าเดียว
MONTIPA_AREAS = [
    ("pui", "ทีมปุ้ย"), ("ket", "ทีมเกตุ"), ("koy", "ทีมก้อย"), ("joy", "ทีมจอย"),
    ("mint", "ทีมมิ้นท์"), ("pop", "ทีมป๊อป"), ("tubtim", "ทีมทับทิม"),
]
KOY_BRANCHES = ["เซ็นทรัล โคราช", "เซ็นทรัล ขอนแก่น", "เซ็นทรัล อุบล", "โรบินสัน บุรีรัมย์"]
TUBTIM_BRANCHES = ["เซ็นทรัล เชียงราย", "เซ็นทรัล นครสวรรค์"]


def _opts(names: list[str]) -> list[dict]:
    return [{"value": n, "label": n, "sub": None, "count": 1} for n in names]


class AreaBackend(FakeBackend):
    """FakeBackend ที่ Motta มีเขตครบ 10 เขต และ Montipa มีเขตของ AM ครบ 7 เขต เหมือนของจริง"""

    OPTIONS = {
        **BRANCH_OPTIONS,
        ("group", "motta", None): [{"value": k, "label": label, "sub": None, "count": 6} for k, label in MOTTA_AREAS],
        ("branch", "motta", "por"): _opts(POR_BRANCHES),
        ("branch", "motta", "baitong"): _opts(BAITONG_BRANCHES),
        ("branch", "motta", "nan"): _opts(NAN_BRANCHES),
        ("branch", "motta", "por-new"): _opts(POR_NEW_BRANCHES),
        ("group", "montipa", None): [{"value": k, "label": label, "sub": None, "count": 2} for k, label in MONTIPA_AREAS],
        ("branch", "montipa", "koy"): _opts(KOY_BRANCHES),
        ("branch", "montipa", "tubtim"): _opts(TUBTIM_BRANCHES),
    }

    async def branch_options(self, level: str, *, company=None, group=None):
        self.branch_option_calls.append((level, company, group))
        return self.OPTIONS.get((level, company, group), [])

    async def lookup_branch(self, name: str):
        hits = [co for (lvl, co, _g), opts in self.OPTIONS.items()
                if lvl == "branch" and any(o["value"] == name for o in opts)]
        return {"found": bool(hits), "ambiguous": len(set(hits)) > 1, "companies": sorted(set(hits))}


def postbacks(flex) -> list[tuple[str, str]]:
    """ปุ่มทั้งหมดในการ์ด (label, postback data) — ไล่ทั้งต้นไม้ของ Flex"""
    found: list[tuple[str, str]] = []

    def walk(node):
        if isinstance(node, dict):
            action = node.get("action")
            if isinstance(action, dict) and action.get("type") == "postback":
                # แถวในการ์ดเลือกเป็น box ที่ไม่มี label (มีแต่ displayText) — ปุ่มท้ายการ์ดมี label
                found.append((action.get("label") or action.get("displayText") or "", action.get("data") or ""))
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(flex)
    return found


def page_button(reply: M.Reply) -> str:
    """data ของปุ่ม "▼ ดูเพิ่ม" ในการ์ด"""
    datas = [data for label, data in postbacks(reply.flex) if label.startswith("▼ ดูเพิ่ม")]
    assert len(datas) == 1, f"ต้องมีปุ่มดูเพิ่ม 1 ปุ่ม: {postbacks(reply.flex)}"
    return datas[0]


def as_postback(data: str):
    from urllib.parse import parse_qsl

    return postback(dict(parse_qsl(data)))


def row_labels(reply: M.Reply) -> list[str]:
    """ป้ายของแถวที่กดเลือกได้ในการ์ด (ไม่รวมปุ่มท้ายการ์ด)"""
    return [label for label, data in postbacks(reply.flex) if "&i=" in data]


async def at_motta_areas(s, backend):
    await handle(postback({"a": "start"}), s, backend)
    r = await handle(postback({"a": "bk_co", "i": "1"}), s, backend)  # Motta
    session = await s.get(USER)
    assert session.pick_level == "group" and session.pick_company == "motta"
    return r


# ------------------------------------------------------------------ ปุ่มดูเพิ่ม


async def test_ปุ่มดูเพิ่มของเมนูเขตเป็นปุ่มของเมนูสาขา_ไม่ใช่เมนูทรัพย์สิน():
    s, backend = store(), AreaBackend()
    r = await at_motta_areas(s, backend)
    data = page_button(r[0])
    assert data.startswith("a=bk_page") and "pk_page" not in data
    assert "&l=group" in data and data.endswith("&p=1")
    assert len(data.encode("utf-8")) <= 300, "postback data ของ LINE ยาวได้ไม่เกิน 300 ไบต์"


async def test_กดดูเพิ่มแล้วเห็นเขตหน้า2_เลือกทีมใบตองได้จนได้สาขา():
    s, backend = store(), AreaBackend()
    r = await at_motta_areas(s, backend)
    assert "ทีมใบตอง" not in row_labels(r[0]), "หน้าแรกมี 8 เขต ใบตองอยู่หน้า 2"

    r = await handle(as_postback(page_button(r[0])), s, backend)
    assert row_labels(r[0]) == ["ทีมแนน", "ทีมใบตอง"]
    assert "ทรัพย์สิน" not in r[0].text and backend.option_calls == [], "ต้องไม่ไปแตะเมนูทรัพย์สินเลย"
    assert (await s.get(USER)).pick_page == 1

    data = dict(postbacks(r[0].flex))["ทีมใบตอง"]
    r = await handle(as_postback(data), s, backend)
    assert row_labels(r[0]) == BAITONG_BRANCHES
    assert "Motta · ทีมใบตอง" in r[0].text

    r = await handle(postback({"a": "bk_branch", "i": "0"}), s, backend)
    session = await s.get(USER)
    assert session.branch == "พัทยา" and session.step == F.ASK_TYPE


async def test_หน้า2กดดูเพิ่มอีกทีวนกลับหน้าแรก():
    s, backend = store(), AreaBackend()
    r = await at_motta_areas(s, backend)
    r = await handle(as_postback(page_button(r[0])), s, backend)
    assert page_button(r[0]).endswith("&p=0")
    r = await handle(as_postback(page_button(r[0])), s, backend)
    assert row_labels(r[0])[0] == "ทีมปอ" and len(row_labels(r[0])) == 8


async def test_สาขาเกิน8แห่ง_กดดูเพิ่มเห็นสาขาที่เหลือและเลือกได้():
    s, backend = store(), AreaBackend()
    await at_motta_areas(s, backend)
    r = await handle(postback({"a": "bk_grp", "i": "0"}), s, backend)  # ทีมปอ 10 สาขา
    assert len(row_labels(r[0])) == 8
    data = page_button(r[0])
    assert data.startswith("a=bk_page") and "&l=branch" in data

    r = await handle(as_postback(data), s, backend)
    assert row_labels(r[0]) == ["กระบี่", "ถลาง"]
    await handle(postback({"a": "bk_branch", "i": "9"}), s, backend)
    assert (await s.get(USER)).branch == "ถลาง"


async def test_การ์ดเก่าที่ปุ่มยังส่ง_pk_page_กดแล้วได้เขตหน้า2():
    """การ์ดที่ส่งไปก่อนแก้ค้างอยู่ในแชทของผู้ใช้ — ลบไม่ได้ ต้องกดแล้วใช้ได้"""
    s, backend = store(), AreaBackend()
    await at_motta_areas(s, backend)
    r = await handle(postback({"a": "pk_page", "p": "1"}), s, backend)
    assert row_labels(r[0]) == ["ทีมแนน", "ทีมใบตอง"]
    assert r[0].text != M.asset_picker_unavailable().text
    assert backend.option_calls == []


async def test_การ์ดเก่า_pk_page_ตอนอยู่ชั้นสาขา_ได้หน้าถัดไปของสาขา():
    s, backend = store(), AreaBackend()
    await at_motta_areas(s, backend)
    await handle(postback({"a": "bk_grp", "i": "0"}), s, backend)  # ทีมปอ 10 สาขา
    r = await handle(postback({"a": "pk_page", "p": "1"}), s, backend)
    assert row_labels(r[0]) == ["กระบี่", "ถลาง"]


async def test_หน้าเกินจำนวนที่มี_กลับหน้าแรกแทนการ์ดว่าง():
    s, backend = store(), AreaBackend()
    await at_motta_areas(s, backend)
    await handle(postback({"a": "bk_grp", "i": "9"}), s, backend)  # ทีมใบตอง 6 สาขา = หน้าเดียว
    r = await handle(postback({"a": "pk_page", "p": "1"}), s, backend)  # ปุ่มจากการ์ดเขตเก่า
    assert row_labels(r[0]) == BAITONG_BRANCHES
    assert (await s.get(USER)).pick_page == 0


async def test_กดดูเพิ่มจากการ์ดเขตที่เลื่อนขึ้นไปเจอ_ได้หน้าเขตตามการ์ด():
    s, backend = store(), AreaBackend()
    await at_motta_areas(s, backend)
    await handle(postback({"a": "bk_grp", "i": "9"}), s, backend)  # อยู่ชั้นสาขาของทีมใบตองแล้ว
    r = await handle(postback({"a": "bk_page", "l": "group", "p": "1"}), s, backend)
    assert row_labels(r[0]) == ["ทีมแนน", "ทีมใบตอง"]
    assert (await s.get(USER)).pick_level == "group"
    r = await handle(postback({"a": "bk_grp", "i": "8"}), s, backend)
    assert row_labels(r[0]) == NAN_BRANCHES


async def test_ปุ่มดูเพิ่มชั้นสาขาหลังย้อนกลับไปแล้ว_ไม่ดึงสาขาโดยไม่มีเขต():
    s, backend = store(), AreaBackend()
    await at_motta_areas(s, backend)
    await handle(postback({"a": "bk_grp", "i": "0"}), s, backend)
    await handle(postback({"a": "bk_back", "to": "group"}), s, backend)
    backend.branch_option_calls.clear()
    r = await handle(postback({"a": "bk_page", "l": "branch", "p": "1"}), s, backend)
    assert ("branch", "motta", None) not in backend.branch_option_calls
    assert row_labels(r[0]) == ["ทีมแนน", "ทีมใบตอง"]


@pytest.mark.parametrize("level", ["company", "group", "branch"])
async def test_ปุ่มดูเพิ่มของเมนูสาขาทุกชั้นไม่ใช่_pk_page(level):
    many = _opts([f"ตัวเลือก {i}" for i in range(12)])
    reply = {
        "company": lambda: M.ask_branch_company(many),
        "group": lambda: M.ask_branch_group(many, "Motta", "เขต (Area Manager)", by_area=True),
        "branch": lambda: M.ask_branch_list(many, "Motta · ทีมปอ", group_word="เขต"),
    }[level]()
    assert page_button(reply) == f"a=bk_page&l={level}&p=1"


def test_เมนูทรัพย์สินยังใช้_pk_page_เหมือนเดิม():
    many = _opts([f"รุ่น {i}" for i in range(12)])
    assert page_button(M.ask_asset_category(many)) == "a=pk_page&p=1"
    assert page_button(M.ask_asset_brand(many, "โน้ตบุ๊ค")) == "a=pk_page&p=1"


async def test_ปุ่มดูเพิ่มของเมนูทรัพย์สินยังเปิดหน้าถัดไปของทรัพย์สิน():
    s, backend = store(), FakeBackend()
    await s.set(USER, Session(step=F.ASK_ASSET, branch="สำนักงานใหญ่", ticket_type="repair",
                              pick_level="category"))
    await handle(postback({"a": "pk_page", "p": "0"}), s, backend)
    assert backend.option_calls and backend.option_calls[-1][0] == "category"
    assert backend.branch_option_calls == []


# ------------------------------------------------------------------ ป้ายบนการ์ด


async def test_การ์ดเขตของ_Motta_บอกว่าพิมพ์ชื่อ_AM_ได้_และปุ่มย้อนเรียกว่าเขต():
    s, backend = store(), AreaBackend()
    r = await at_motta_areas(s, backend)
    assert M.branch_area_subtitle("ใบตอง") in str(r[0].flex)
    assert "ใบตอง" in r[0].text, "ข้อความสำรอง (แจ้งเตือน/LINE รุ่นเก่า) ก็บอกด้วย"
    r = await handle(postback({"a": "bk_grp", "i": "0"}), s, backend)
    assert ("◀ เปลี่ยนเขต", "a=bk_back&to=group") in postbacks(r[0].flex)


async def test_การ์ดเขตของ_Montipa_แบ่งตาม_AM_และยกชื่อ_AM_ของ_Montipa_เป็นตัวอย่าง():
    s, backend = store(), AreaBackend()
    await handle(postback({"a": "start"}), s, backend)
    r = await handle(postback({"a": "bk_co", "i": "0"}), s, backend)  # Montipa
    assert r[0].text.startswith("เลือกเขต (Area Manager)")
    assert row_labels(r[0]) == [label for _, label in MONTIPA_AREAS]
    assert "▼ ดูเพิ่ม" not in str(r[0].flex), "7 เขตอยู่หน้าเดียว"
    assert M.branch_area_subtitle("ทับทิม") in str(r[0].flex)
    assert "ใบตอง" not in str(r[0].flex) and "ใบตอง" not in r[0].text, "ห้ามยกชื่อ AM ของ Motta ให้คน Montipa"

    r = await handle(postback({"a": "bk_grp", "i": "2"}), s, backend)  # ทีมก้อย
    assert row_labels(r[0]) == KOY_BRANCHES
    assert "Montipa · ทีมก้อย" in r[0].text
    assert ("◀ เปลี่ยนเขต", "a=bk_back&to=group") in postbacks(r[0].flex)

    await handle(postback({"a": "bk_branch", "i": "3"}), s, backend)
    session = await s.get(USER)
    assert session.branch == "โรบินสัน บุรีรัมย์" and session.step == F.ASK_TYPE


@pytest.mark.parametrize("typed, group, branches", [
    ("ก้อย", "koy", KOY_BRANCHES), ("ทีมก้อยค่ะ", "koy", KOY_BRANCHES), ("คุณทับทิม", "tubtim", TUBTIM_BRANCHES),
])
async def test_พิมพ์ชื่อ_AM_ของ_Montipa_เปิดสาขาของเขตนั้น(typed, group, branches):
    s, backend = store(), AreaBackend()
    await handle(postback({"a": "start"}), s, backend)
    r = await handle(text(typed), s, backend)
    assert row_labels(r[0]) == branches
    session = await s.get(USER)
    assert (session.pick_company, session.pick_company_label, session.pick_group) == ("montipa", "Montipa", group)


def test_ตัวอย่างชื่อ_AM_มาจากเขตสุดท้ายของบริษัทนั้น():
    group = M.ask_branch_group(
        [{"value": k, "label": label, "count": 1} for k, label in MONTIPA_AREAS], "Montipa", "เขต (Area Manager)",
        by_area=True)
    assert "(เช่น ทับทิม)" in group.text
    no_example = M.ask_branch_group([], "Montipa", "เขต (Area Manager)", by_area=True)
    assert "เช่น" not in no_example.text and "เช่น" not in str(no_example.flex)


# ------------------------------------------------------------------ พิมพ์ชื่อเขต / AM


@pytest.mark.parametrize(
    "typed",
    ["ใบตอง", "น้องใบตอง", "ทีมใบตอง", "ทีม ใบตอง ครับ", "เขตใบตอง", "AM ใบตอง", "พี่ใบตองค่ะ", "ทีมน้องใบตอง"],
)
async def test_พิมพ์ชื่อ_AM_เปิดรายชื่อสาขาของเขตนั้นทันที(typed):
    s, backend = store(), AreaBackend()
    await handle(postback({"a": "start"}), s, backend)  # ยังไม่ได้เลือกบริษัท
    r = await handle(text(typed), s, backend)
    assert len(r) == 1, "ไม่ต้องขึ้น 'ไม่พบสาขา' ก่อน"
    assert row_labels(r[0]) == BAITONG_BRANCHES
    session = await s.get(USER)
    assert (session.pick_company, session.pick_company_label) == ("motta", "Motta")
    assert (session.pick_group, session.pick_group_label) == ("baitong", "ทีมใบตอง")
    assert session.pick_level == "branch" and session.step == F.ASK_BRANCH

    await handle(postback({"a": "bk_branch", "i": "5"}), s, backend)
    session = await s.get(USER)
    assert session.branch == "บ้านฉาง" and session.step == F.ASK_TYPE


@pytest.mark.parametrize("typed, group", [("ปอ", "por"), ("ทีมปอ", "por"), ("ปอ new", "por-new"),
                                          ("ทีมปอ New", "por-new"), ("มะลิ", "mali")])
async def test_ชื่อเขตต้องตรงทั้งคำ_ปอไม่ใช่ปอ_New(typed, group):
    s, backend = store(), AreaBackend()
    await at_motta_areas(s, backend)
    await handle(text(typed), s, backend)
    assert (await s.get(USER)).pick_group == group


async def test_เลือก_Montipa_ไว้แล้วพิมพ์ใบตอง_ย้ายไปเขตของ_Motta():
    s, backend = store(), AreaBackend()
    await handle(postback({"a": "start"}), s, backend)
    await handle(postback({"a": "bk_co", "i": "0"}), s, backend)  # Montipa
    r = await handle(text("ใบตอง"), s, backend)
    assert row_labels(r[0]) == BAITONG_BRANCHES
    assert "Motta · ทีมใบตอง" in r[0].text


async def test_ชื่อสาขาตรงเป๊ะยังได้สาขาทันทีเหมือนเดิม():
    s, backend = store(), AreaBackend()
    await at_motta_areas(s, backend)
    r = await handle(text("ภูเก็ต"), s, backend)
    session = await s.get(USER)
    assert session.branch == "ภูเก็ต" and session.step == F.ASK_TYPE
    assert "สาขา: ภูเก็ต" in r[0].text


@pytest.mark.parametrize("typed", ["ดาวอังคาร", "ท", "ทีม", "น้อง"])
async def test_คำที่ไม่ใช่ชื่อเขต_ยังตอบว่าไม่พบสาขาเหมือนเดิม(typed):
    s, backend = store(), AreaBackend()
    await at_motta_areas(s, backend)
    r = await handle(text(typed), s, backend)
    assert r[0].text.startswith("ไม่พบสาขาที่ตรงกัน")
    session = await s.get(USER)
    assert session.pick_group is None and session.pick_level == "group"


async def test_หลังบ้านล่มตอนค้นชื่อเขต_ยังบอกว่าไม่พบสาขาได้ไม่พัง():
    s, backend = store(), AreaBackend()
    await at_motta_areas(s, backend)

    async def broken(*_a, **_kw):
        raise F.BackendError("หลังบ้านล่ม")

    backend.branch_options = broken
    r = await handle(text("ใบตอง"), s, backend)
    assert r[0].text.startswith("ไม่พบสาขาที่ตรงกัน")
