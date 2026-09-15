"""เทสต์ชั้นทำความสะอาดข้อความไทย + คำพ้อง + การปฏิเสธ

ทุกเคสในไฟล์นี้มาจาก "สิ่งที่คนไทยพิมพ์จริงในแชท" ไม่ใช่เคสสมมติ
ถ้าเคสไหนพัง แปลว่าบอทจะเข้าใจผิดกับข้อความแบบนั้นทันทีในการใช้งานจริง
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import ai  # noqa: E402
from app import thai_text  # noqa: E402

from test_ai import build_knowledge  # noqa: E402


# ------------------------------------------------------------------ normalize


def test_สระเอซ้อนสองตัวต้องกลายเป็นแอ():
    """เคสพิมพ์ผิดที่พบบ่อยที่สุดของภาษาไทย — ตาคนอ่านเหมือนกัน แต่คอมเห็นคนละสตริง"""
    assert thai_text.normalize("เเป้นพิมพ์") == thai_text.normalize("แป้นพิมพ์")
    assert "เเ" not in thai_text.normalize("เเต่ก่อนเเบบนี้")


def test_ยุบตัวอักษรที่ลากซ้ำ():
    assert thai_text.normalize("พังงงง") == "พัง"
    assert thai_text.normalize("เสียยยย") == "เสีย"
    assert thai_text.normalize("goooood") == "good"


def test_ไม่ยุบตัวซ้ำสองตัวที่เป็นคำถูกต้อง():
    """ภาษาไทยมีคำที่พยัญชนะซ้ำ 2 ตัวจริง ห้ามทำลาย"""
    assert "รร" in thai_text.normalize("บรรทัดนี้")
    assert "รร" in thai_text.normalize("ธรรมดา")


def test_ตัดคำลงท้ายสุภาพเฉพาะที่อยู่เป็นคำเดี่ยว():
    assert "ครับ" not in thai_text.normalize("จอไม่ติด ครับ")
    # ไม่ตัดกลางคำ — "หน่อยครับ" ติดกันถือเป็นคำเดียว ตัดแล้วอาจเสียความหมาย
    assert "ครับ" in thai_text.normalize("ขอเบิกเมาส์หน่อยครับ")


def test_แปลงเลขไทยเป็นอารบิก():
    assert "2" in thai_text.normalize("ขอเบิก ๒ ตัว")


# ------------------------------------------------------------------ คำพ้อง


@pytest.mark.parametrize(
    "word,canonical",
    [
        ("แป้นพิมพ์", "คีย์บอร์ด"),
        ("คีบอด", "คีย์บอร์ด"),
        ("keyboard", "คีย์บอร์ด"),
        ("เครื่องปริ้น", "เครื่องพิมพ์"),
        ("ปริ้นเตอร์", "เครื่องพิมพ์"),
        ("มอนิเตอร์", "จอ"),
        ("เน็ต", "อินเทอร์เน็ต"),
    ],
)
def test_แปลงคำพ้องเป็นคำมาตรฐาน(word, canonical):
    assert thai_text.canonicalize(word) == canonical


def test_ขยายคำพ้องแล้วต้องไม่ลบคำเดิมทิ้ง():
    expanded = thai_text.expand_synonyms("เครื่องปริ้นไม่ทำงาน")
    assert "เครื่องปริ้น" in expanded, "ต้องเก็บคำเดิมไว้ เผื่อการเดาคำพ้องผิด"
    assert "เครื่องพิมพ์" in expanded, "ต้องเติมคำมาตรฐานเข้าไปให้ค้นเจอ"


# ------------------------------------------------------------------ การปฏิเสธ


@pytest.mark.parametrize(
    "sentence,keyword,negated",
    [
        ("คีย์บอร์ดเสีย", "เสีย", False),
        ("คีย์บอร์ดยังไม่เสีย", "เสีย", True),
        ("ไม่ได้เบิกของ", "เบิก", True),
        ("ขอเบิกของ", "เบิก", False),
    ],
)
def test_ตรวจจับการปฏิเสธ(sentence, keyword, negated):
    assert thai_text.is_negated(sentence, keyword) is negated


# ------------------------------------------------------------------ ผลต่อชั้น AI จริง


def test_พิมพ์ผิดแบบสระเอซ้อนยังจับชื่อของในสต็อกได้():
    """ก่อนแก้: "เเป้นพิมพ์" ไม่แมตช์อะไรเลย เพราะทั้งพิมพ์ผิดและเป็นคำพ้อง (คนละคำกับคีย์บอร์ด)"""
    kb = build_knowledge()
    analysis = ai.analyze("ขอเบิกเเป้นพิมพ์ 2 อัน", kb)
    assert analysis.intent == "withdraw"
    assert analysis.item_name == "คีย์บอร์ด"
    assert analysis.quantity == 2


def test_คำพ้องล้วนก็ต้องจับของได้():
    kb = build_knowledge()
    analysis = ai.analyze("เบิก keyboard หน่อย", kb)
    assert analysis.item_name == "คีย์บอร์ด"


def test_เมื่อคืนต้องไม่ถูกตีความว่าคืนอุปกรณ์():
    """"คืน" เป็นคีย์เวิร์ดของ intent return แต่ "เมื่อคืน" แปลว่า last night"""
    intent, _ = ai.detect_intent("เมื่อคืนเน็ตล่มทั้งสาขา")
    assert intent != "return"


def test_ยังไม่เสียต้องไม่ใช่การแจ้งซ่อม():
    intent, _ = ai.detect_intent("คีย์บอร์ดยังไม่เสีย แค่ถามเฉยๆ")
    assert intent != "repair"


def test_เสียดายเสียเวลาต้องไม่ใช่การแจ้งซ่อม():
    assert ai.detect_intent("เสียดายที่ไม่ได้ไป")[0] != "repair"
    assert ai.detect_intent("เสียเวลารอนานมาก")[0] != "repair"


# ------------------------------------------------------------------ จำนวน


def test_เลือกเลขที่มีหน่วยนับก่อนเลขอื่น():
    """เคสจริง: ประโยคมีทั้งจำนวนคนและจำนวนของ ต้องเอาจำนวนของ"""
    assert ai.extract_quantity("เบิกเมาส์ให้ห้อง 5 คน 2 ตัว") == 2
    assert ai.extract_quantity("ขอหมึก 3 ตลับ ภายในวันที่ 20") == 3


def test_ไม่มีหน่วยนับให้ใช้เลขเดี่ยวตัวแรก():
    assert ai.extract_quantity("ขอเบิก 4") == 4


def test_ไม่นับตัวเลขที่เป็นรหัสทรัพย์สิน():
    assert ai.extract_quantity("เครื่อง NB2501001 เสีย") is None
