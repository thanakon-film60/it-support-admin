"""ชั้น AI/NLP ของบอท — ทำให้บอทเข้าใจภาษาไทยแบบที่คนพิมพ์จริง

ปัญหาที่ชั้นนี้แก้:
  การจับคู่ FAQ เดิมใช้วิธี "ข้อความมีคำนี้อยู่ไหม" (substring) ซึ่งใช้กับภาษาไทยได้แย่มาก
  เพราะไทยเขียนติดกันไม่มีเว้นวรรค — "ปริ้นเตอร์ไม่ทำงาน" จะไม่แมตช์คีย์เวิร์ด "เครื่องพิมพ์"
  และพิมพ์ผิดนิดเดียว ("คีย์บอด") ก็หลุดทันที

วิธีที่ใช้ (เรียงจากถูก/เร็ว ไปแพง/ฉลาด):
  ชั้น 1  ตัดคำไทยด้วย PyThaiNLP แล้วจัดอันดับด้วย TF-IDF + cosine similarity
          เขียนเองด้วย Python ล้วนราว 40 บรรทัด ไม่ต้องพึ่ง scikit-learn/numpy
          -> ประหยัดขนาด deploy หลายสิบ MB และ cold start เร็วกว่ามาก
  ชั้น 2  fuzzy matching (rapidfuzz) สำหรับจับชื่อของ/รหัสทรัพย์สิน/สาขา ที่พิมพ์ผิดเล็กน้อย
  ชั้น 3  (ปิดไว้ตั้งต้น) เรียก LLM ผ่าน API เพื่อเรียบเรียงคำตอบจาก FAQ ที่ค้นได้
          เปิดเมื่อใส่ AI_PROVIDER + AI_API_KEY เท่านั้น

ข้อมูลทุกอย่างที่ใช้ตัดสินใจ (สาขา, รหัสทรัพย์สิน, รายการสต็อก, FAQ) ดึงจากฐานข้อมูลของ
โปรเจกต์ผ่าน /api/internal/lookup?kind=knowledge ไม่มีการ hardcode รายการไว้ในโค้ดนี้
"""

from __future__ import annotations

import logging
import math
import re
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Iterable

from . import thai_text

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------- การตัดคำไทย

try:
    from pythainlp.corpus.common import thai_stopwords
    from pythainlp.tokenize import word_tokenize

    _STOPWORDS = set(thai_stopwords())
    _HAS_PYTHAINLP = True
except Exception:  # pragma: no cover - ใช้เมื่อเครื่องปลายทางไม่มี pythainlp
    _STOPWORDS = set()
    _HAS_PYTHAINLP = False
    logger.warning("ไม่พบ pythainlp — จะตัดคำแบบหยาบแทน ความแม่นยำของ FAQ จะลดลง")

_PUNCT = re.compile(r"[^\wก-๙]+", re.UNICODE)


def tokenize(text: str) -> list[str]:
    """ตัดข้อความไทย/อังกฤษเป็นคำ แล้วตัดคำหยุด (stopword) ทิ้ง

    ถ้าไม่มี pythainlp จะ fallback เป็นการตัดด้วยช่องว่าง + character bigram
    ซึ่งแย่กว่าแต่ยังพอใช้ได้ ดีกว่าทำให้ทั้งระบบพัง
    """
    # normalize ก่อนเสมอ — แก้สระเอซ้อน/ตัวอักษรลาก/คำลงท้าย ที่ทำให้การเทียบตัวอักษรพังตั้งแต่ต้น
    # (ดูเหตุผลเต็มใน thai_text.py) ถ้าไม่ทำตรงนี้ ทุกชั้นถัดไปจะได้ข้อมูลที่เพี้ยนไปแล้ว
    cleaned = _PUNCT.sub(" ", thai_text.normalize(text)).strip()
    if not cleaned:
        return []

    if _HAS_PYTHAINLP:
        tokens = word_tokenize(cleaned, engine="newmm", keep_whitespace=False)
    else:
        tokens = cleaned.split()
        # เติม bigram ของตัวอักษรเพื่อให้คำไทยที่ติดกันยังพอจับคู่กันได้บ้าง
        for word in list(tokens):
            if len(word) > 3:
                tokens += [word[i : i + 2] for i in range(len(word) - 1)]

    return [t for t in (tok.strip() for tok in tokens) if t and t not in _STOPWORDS and len(t) > 1]


# ---------------------------------------------------------------- TF-IDF ค้นหา FAQ


class TfidfIndex:
    """ดัชนีค้นข้อความแบบ TF-IDF + cosine similarity (เขียนเอง ไม่ใช้ scikit-learn)

    เหมาะกับชุดข้อมูลระดับหลักสิบถึงหลักพันรายการอย่าง FAQ ภายในองค์กร
    ถ้าวันหนึ่งมี FAQ เป็นหมื่นรายการค่อยย้ายไป vector database + embedding จริง
    """

    def __init__(self, documents: list[tuple[str, str]]) -> None:
        self.doc_ids: list[str] = []
        self._vectors: list[dict[str, float]] = []

        # ขยายคำพ้องตั้งแต่ตอนสร้างดัชนี — ถ้า FAQ เขียนว่า "เครื่องพิมพ์" แต่ผู้ใช้พิมพ์ "ปริ้นเตอร์"
        # การขยายฝั่งเดียวไม่พอ ต้องให้ทั้งเอกสารและ query มีรูปมาตรฐานร่วมกันถึงจะเจอกัน
        expanded = [thai_text.expand_synonyms(text) for _, text in documents]
        tokenized = [tokenize(text) for text in expanded]
        total_docs = len(documents) or 1

        document_freq: Counter[str] = Counter()
        for tokens in tokenized:
            document_freq.update(set(tokens))

        # smoothed idf — บวก 1 กันหารศูนย์ และกันคำที่โผล่ทุกเอกสารได้น้ำหนัก 0 พอดี
        self._idf = {
            term: math.log((total_docs + 1) / (freq + 1)) + 1.0
            for term, freq in document_freq.items()
        }
        self._default_idf = math.log(total_docs + 1) + 1.0

        for (doc_id, _), tokens in zip(documents, tokenized):
            self.doc_ids.append(doc_id)
            self._vectors.append(self._vectorize(tokens))

    def _vectorize(self, tokens: list[str]) -> dict[str, float]:
        if not tokens:
            return {}
        term_freq = Counter(tokens)
        length = len(tokens)
        vector = {
            term: (count / length) * self._idf.get(term, self._default_idf)
            for term, count in term_freq.items()
        }
        # normalize ให้เป็นเวกเตอร์หนึ่งหน่วย เพื่อให้ dot product = cosine similarity ตรงๆ
        norm = math.sqrt(sum(v * v for v in vector.values())) or 1.0
        return {term: value / norm for term, value in vector.items()}

    def search(self, query: str, top_k: int = 3) -> list[tuple[str, float]]:
        query_vector = self._vectorize(tokenize(query))
        if not query_vector:
            return []
        scored: list[tuple[str, float]] = []
        for doc_id, vector in zip(self.doc_ids, self._vectors):
            # วนเฉพาะเทอมของ query (สั้นกว่าเอกสาร) เพื่อลดงาน
            score = sum(weight * vector.get(term, 0.0) for term, weight in query_vector.items())
            if score > 0:
                scored.append((doc_id, score))
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:top_k]


# ---------------------------------------------------------------- คลังความรู้จาก DB


@dataclass
class Knowledge:
    """ภาพรวมข้อมูลของระบบที่ดึงมาจากฐานข้อมูลของโปรเจกต์"""

    branches: list[str] = field(default_factory=list)
    # สาขาแบบละเอียด [{"company","name","group","floor",...}] — ใช้หาว่าสาขาหนึ่งอยู่บริษัทไหน
    branch_items: list[dict[str, Any]] = field(default_factory=list)
    companies: list[dict[str, Any]] = field(default_factory=list)
    stock_items: list[dict[str, Any]] = field(default_factory=list)
    equipment: list[dict[str, Any]] = field(default_factory=list)
    faq: list[dict[str, Any]] = field(default_factory=list)
    index: TfidfIndex | None = None
    fetched_at: float = 0.0

    def faq_by_id(self, faq_id: str) -> dict[str, Any] | None:
        return next((f for f in self.faq if f["id"] == faq_id), None)

    def branch_names(self, company: str | None = None) -> list[str]:
        """ชื่อสาขา จำกัดเฉพาะบริษัทที่ระบุ (ไม่ระบุ = ทุกบริษัท)

        ถ้าหลังบ้านยังไม่ส่ง branch_items มา (เว็บรุ่นเก่า) จะตกกลับไปใช้ branches
        ซึ่งเป็นชื่อรวมทุกบริษัท — เสียการกรองบริษัทไป แต่บอทยังทำงานต่อได้
        """
        if not self.branch_items:
            return list(self.branches)
        if company is None:
            return [b["name"] for b in self.branch_items]
        return [b["name"] for b in self.branch_items if b.get("company") == company]

    def companies_of_branch(self, name: str) -> list[str]:
        """บริษัทที่มีสาขาชื่อนี้ — คืนหลายค่าได้ถ้าชื่อซ้ำกันข้ามบริษัท

        ใช้เดาบริษัทให้อัตโนมัติเมื่อผู้ใช้พิมพ์ชื่อสาขามาตรงๆ โดยไม่ได้เลือกบริษัทก่อน
        ถ้าคืนมามากกว่า 1 บริษัท ผู้เรียก "ต้องถามผู้ใช้" ห้ามหยิบตัวแรกมาใช้
        """
        target = (name or "").strip().lower()
        if not target:
            return []
        found: list[str] = []
        for b in self.branch_items:
            if b.get("name", "").strip().lower() == target:
                code = b.get("company")
                if code and code not in found:
                    found.append(code)
        return found

    def branch_groups(self, company: str) -> list[dict[str, Any]]:
        """กลุ่ม/ทีมของบริษัทหนึ่ง เรียงตามลำดับที่หลังบ้านจัดไว้ (ภูมิภาค/ผังทีม)"""
        entry = next((c for c in self.companies if c.get("code") == company), None)
        if entry and entry.get("groups"):
            return entry["groups"]
        groups: list[dict[str, Any]] = []
        for b in self.branch_items:
            if b.get("company") != company or not b.get("group"):
                continue
            hit = next((g for g in groups if g["name"] == b["group"]), None)
            if hit:
                hit["count"] += 1
            else:
                groups.append({"name": b["group"], "count": 1})
        return groups


class KnowledgeCache:
    """ดึงข้อมูลจากหลังบ้านมาเก็บไว้ชั่วคราว + สร้างดัชนี TF-IDF

    ทำไมต้อง cache: ทุกข้อความที่คนพิมพ์เข้ามาต้องใช้ข้อมูลชุดนี้ ถ้ายิง HTTP ใหม่ทุกครั้ง
    บอทจะช้าและสร้างภาระให้แอดมินแพเนลโดยไม่จำเป็น (FAQ กับรายการสต็อกแทบไม่เปลี่ยนรายวินาที)
    """

    def __init__(self, backend, ttl_seconds: int = 300) -> None:
        self._backend = backend
        self._ttl = ttl_seconds
        self._cache: Knowledge | None = None

    async def get(self) -> Knowledge:
        now = time.time()
        if self._cache and now - self._cache.fetched_at < self._ttl:
            return self._cache

        try:
            raw = await self._backend.fetch_knowledge()
        except Exception as exc:  # noqa: BLE001
            logger.error("ดึง knowledge จากหลังบ้านไม่สำเร็จ: %s", exc)
            # ถ้าเคยดึงได้ก่อนหน้านี้ให้ใช้ของเก่าไปก่อน ดีกว่าตอบผู้ใช้ไม่ได้เลย
            return self._cache or Knowledge(fetched_at=now)

        faq = raw.get("faq", [])
        documents = [
            (
                item["id"],
                # รวม title + keywords + content เข้าด้วยกันเป็นเอกสารเดียวสำหรับสร้างดัชนี
                " ".join([item.get("title", ""), " ".join(item.get("keywords", [])), item.get("content", "")]),
            )
            for item in faq
        ]

        knowledge = Knowledge(
            branches=raw.get("branches", []),
            branch_items=raw.get("branch_items", []),
            companies=raw.get("companies", []),
            stock_items=raw.get("stock_items", []),
            equipment=raw.get("equipment", []),
            faq=faq,
            index=TfidfIndex(documents) if documents else None,
            fetched_at=now,
        )
        self._cache = knowledge
        return knowledge

    def invalidate(self) -> None:
        self._cache = None


# ---------------------------------------------------------------- จับ intent + slot

INTENT_KEYWORDS: dict[str, tuple[str, ...]] = {
    "repair": ("ซ่อม", "เสีย", "พัง", "ไม่ติด", "ใช้ไม่ได้", "ค้าง", "ดับ", "ขึ้นจอฟ้า", "repair", "error"),
    "withdraw": ("เบิก", "ขออุปกรณ์", "ขอเพิ่ม", "ต้องการใช้", "ขอยืม", "withdraw"),
    "return": ("คืน", "ส่งคืน", "return"),
    "it_service": (
        "ขอใช้บริการ",
        "ติดตั้ง",
        "ลงโปรแกรม",
        "ขอสิทธิ์",
        "รีเซ็ตรหัส",
        "ย้ายข้อมูล",
        "ตั้งค่า",
        "vpn",
        "อีเมล",
        "email",
    ),
}

# คำทักทายล้วนๆ — ทักกลับแล้วจบ ไม่ต้องพาเข้าขั้นตอนแจ้งเรื่อง
#
# ทำไมต้องดักแยก: ของเดิมข้อความแรกที่ไม่เข้า intent จะถูกตีความว่าเป็น "ชื่อสาขา"
# คนพิมพ์ว่า "สวัสดีครับ" จึงได้คำตอบว่า "ไม่พบสาขา สวัสดีครับ" ซึ่งอ่านแล้วเหมือนระบบเสีย
GREETING_WORDS: tuple[str, ...] = (
    "สวัสดี", "หวัดดี", "ดีครับ", "ดีค่ะ", "ดีคับ", "ทัก", "แวะมา",
    "hello", "hi", "hey", "yo", "good morning", "goodmorning",
)

# คำที่ "ขึ้นต้นด้วยคำทักทาย แต่มีเนื้อความต่อท้าย" ต้องไม่ถูกตัดจบแค่ทักทาย
# เช่น "สวัสดีครับ เครื่องปริ้นเสีย" ต้องเข้า flow แจ้งซ่อมตามปกติ
GREETING_MAX_LEN = 25


def is_greeting(text: str) -> bool:
    """ข้อความนี้เป็น 'คำทักทายล้วน' หรือเปล่า

    เช็คความยาวด้วยโดยตั้งใจ — ประโยคที่ขึ้นต้นด้วยคำทักทายแล้วตามด้วยปัญหาจริง
    ("สวัสดีครับ คอมเปิดไม่ติด") ต้องไม่ถูกตัดจบแค่การทักกลับ ซึ่งจะทำให้ผู้ใช้
    ต้องพิมพ์เรื่องเดิมซ้ำอีกรอบ
    """
    cleaned = (text or "").strip().lower()
    if not cleaned or len(cleaned) > GREETING_MAX_LEN:
        return False
    return any(word in cleaned for word in GREETING_WORDS)


# คำถามที่ต้องไปดึง "ข้อมูลจริง" ในระบบมาตอบ (ไม่ใช่การแจ้งเรื่องใหม่)
DATA_QUERY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "stock_query": ("เหลือ", "คงเหลือ", "มีกี่", "กี่ชิ้น", "กี่อัน", "สต็อก", "stock", "มีของไหม", "พอไหม", "มีไหม"),
    "asset_query": ("ใครถือ", "ใครใช้", "ของใคร", "ผู้ถือครอง", "อยู่ที่ไหน", "ครอบครอง"),
    "ticket_query": ("ถึงไหน", "คืบหน้า", "ความคืบหน้า", "ติดตาม", "เช็คสถานะ", "สถานะ", "ดำเนินการถึง"),
    "my_tickets_query": ("เรื่องของฉัน", "งานของฉัน", "ที่ฉันแจ้ง", "ที่แจ้งไป", "ประวัติการแจ้ง", "เรื่องที่แจ้ง"),
}

# เลขที่ ticket ของระบบ เช่น ITRQ2026090158
_TICKET_CODE_PATTERN = re.compile(r"\b(ITSR|ITRQ|ITRT|ITSV)\s*(\d{6,12})\b", re.IGNORECASE)

# ตัวเลขที่ตามด้วยหน่วยนับ -> ใช้เดาจำนวนที่ต้องการเบิก
_QTY_PATTERN = re.compile(r"(\d+)\s*(ชิ้น|อัน|ตัว|เครื่อง|เล่ม|ชุด|กล่อง)?")
# รูปแบบรหัสทรัพย์สิน เช่น NB2501001, NB-001, pc 002
_ASSET_PATTERN = re.compile(r"\b([A-Za-z]{2,4})\s*[-_ ]?\s*(\d{3,9})\b")

_THAI_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")


@dataclass
class Analysis:
    """ผลการวิเคราะห์ข้อความ 1 ประโยค"""

    # repair | withdraw | return | it_service            -> เปิด flow แจ้งเรื่อง
    # stock_query | asset_query | ticket_query | my_tickets_query -> ตอบจากข้อมูลในระบบ
    # faq | unknown
    intent: str
    confidence: float
    branch: str | None = None
    # บริษัทที่เดาได้จากชื่อสาขา — เติมให้เฉพาะตอนที่สาขานั้นอยู่บริษัทเดียวเท่านั้น
    company: str | None = None
    asset_code: str | None = None
    item_name: str | None = None
    quantity: int | None = None
    ticket_code: str | None = None
    stock_matches: list[dict[str, Any]] = field(default_factory=list)
    faq_matches: list[dict[str, Any]] = field(default_factory=list)

    TICKET_INTENTS = ("repair", "withdraw", "return", "it_service")
    DATA_INTENTS = ("stock_query", "asset_query", "ticket_query", "my_tickets_query")

    def is_ticket_intent(self) -> bool:
        return self.intent in self.TICKET_INTENTS

    def is_data_intent(self) -> bool:
        return self.intent in self.DATA_INTENTS

    def filled_slots(self) -> list[str]:
        """สรุปว่าจับอะไรได้บ้าง — ใช้แสดงให้ผู้ใช้ยืนยันว่าบอทเข้าใจถูก"""
        parts = []
        if self.branch:
            parts.append(f"สาขา: {self.branch}")
        if self.asset_code:
            parts.append(f"ทรัพย์สิน: {self.asset_code}")
        if self.item_name:
            qty = f" x{self.quantity}" if self.quantity else ""
            parts.append(f"อุปกรณ์: {self.item_name}{qty}")
        return parts


_MAX_ENTITY_WINDOW = 5  # ชื่อสาขา/ชื่อของยาวสุดประมาณ 5 คำหลังตัดคำ


def _fuzzy_best(query: str, candidates: Iterable[str], threshold: int) -> tuple[str | None, float]:
    """หาตัวที่ใกล้เคียงที่สุดจากรายการ — ใช้จับสาขา/ชื่อของที่พิมพ์ไม่ตรงเป๊ะ

    วิธี: ตัดประโยคเป็นคำ แล้วเลื่อนหน้าต่าง 1-5 คำ เทียบกับ candidate ทีละอัน เอาคะแนนสูงสุด

    ทำไมไม่ใช้ partial_ratio กับทั้งประโยคตรงๆ: เพราะมันจะจับหน้าต่างตัวอักษรที่กินคำข้างเคียง
    เข้ามาด้วย ทำให้คะแนนของคำที่พิมพ์ผิดตกลงจนหลุด threshold
    วัดจริงกับเคส "ขอเบิกคีย์บอด" เทียบ "คีย์บอร์ด" ได้ 77.8 (หลุด) ส่วนวิธีเลื่อนหน้าต่างได้ 87.5 (ผ่าน)
    ขณะที่เคสที่ไม่ควรแมตช์ยังอยู่แถว 22-38 เท่าเดิม — ช่องว่างระหว่างของจริงกับของปลอมกว้างขึ้นมาก
    """
    candidate_list = [c for c in candidates if c]
    if not candidate_list:
        return None, 0.0

    try:
        from rapidfuzz import fuzz
    except ImportError:  # pragma: no cover
        lowered = query.lower()
        for candidate in candidate_list:
            if candidate.lower() in lowered:
                return candidate, 100.0
        return None, 0.0

    # ใช้การตัดคำแบบดิบ (ไม่ตัด stopword) เพราะชื่อสาขาอาจมีคำทั่วไปปนอยู่ เช่น "สาขา"
    normalized_query = thai_text.normalize(query)
    if _HAS_PYTHAINLP:
        tokens = word_tokenize(normalized_query, engine="newmm", keep_whitespace=False)
    else:  # pragma: no cover
        tokens = normalized_query.split()
    tokens = [t.strip() for t in tokens if t.strip()]
    if not tokens:
        return None, 0.0

    windows = {
        "".join(tokens[start:end])
        for start in range(len(tokens))
        for end in range(start + 1, min(start + _MAX_ENTITY_WINDOW, len(tokens)) + 1)
    }
    # เติมรูปมาตรฐานของคำพ้องเข้าไปเทียบด้วย — fuzzy ช่วยได้เฉพาะคำที่ "สะกดใกล้กัน"
    # แต่ "แป้นพิมพ์" กับ "คีย์บอร์ด" คนละคำสิ้นเชิง (ratio ~15) ต้องพึ่งตารางคำพ้องเท่านั้น
    windows |= {thai_text.canonicalize(w) for w in list(windows)}

    best_candidate: str | None = None
    best_score = 0.0
    for candidate in candidate_list:
        normalized_candidate = thai_text.normalize(candidate)
        # เทียบทั้งชื่อจริงและรูปมาตรฐานของชื่อนั้น เผื่อของในสต็อกถูกตั้งชื่อด้วยคำพ้อง
        targets = {normalized_candidate, thai_text.canonicalize(normalized_candidate)}
        score = max(
            (fuzz.ratio(window, target) for window in windows for target in targets),
            default=0.0,
        )
        if score > best_score:
            best_candidate, best_score = candidate, score

    if best_candidate is not None and best_score >= threshold:
        return best_candidate, float(best_score)
    return None, 0.0


# คำที่ "กินคีย์เวิร์ดสั้นเข้าไปเป็นส่วนหนึ่ง" แล้วทำให้เดา intent ผิด
# เก็บเป็นคู่ (คำที่ดักไว้, คีย์เวิร์ดที่ถูกกิน) — ถ้าเจอคำซ้ายในประโยค จะไม่นับคีย์เวิร์ดขวา
# เจอจริง: "เมื่อคืนเน็ตล่ม" เคยถูกตีความว่าเป็นการ "คืนอุปกรณ์" เพราะมีคำว่า "คืน" อยู่
_KEYWORD_TRAPS: tuple[tuple[str, str], ...] = (
    ("เมื่อคืน", "คืน"),
    ("ทั้งคืน", "คืน"),
    ("ข้ามคืน", "คืน"),
    ("คืนนี้", "คืน"),
    ("เสียดาย", "เสีย"),
    ("เสียหาย", "เสีย"),
    ("ค่าเสีย", "เสีย"),
    ("เสียเวลา", "เสีย"),
    ("เสียใจ", "เสีย"),
    ("ค้างชำระ", "ค้าง"),
    ("ยอดค้าง", "ค้าง"),
)


def _keyword_hits(text: str, keyword: str) -> int:
    """นับว่าคีย์เวิร์ดนี้ "นับได้จริง" กี่ครั้ง หลังหักเคสที่ไม่ควรนับ

    หัก 2 กรณี:
      1. ถูกคำอื่นกินเข้าไปเป็นส่วนหนึ่ง (ดู _KEYWORD_TRAPS)
      2. ถูกปฏิเสธนำหน้า เช่น "ยังไม่เสีย" (ดู thai_text.is_negated)
    """
    haystack = thai_text.normalize(text)
    needle = thai_text.normalize(keyword)
    if not needle or needle not in haystack:
        return 0

    occurrences = haystack.count(needle)

    for trap, trapped_keyword in _KEYWORD_TRAPS:
        if thai_text.normalize(trapped_keyword) == needle:
            occurrences -= haystack.count(thai_text.normalize(trap))

    if occurrences > 0 and thai_text.is_negated(haystack, needle):
        # ปฏิเสธอยู่ -> ไม่ใช่เจตนานั้น เช่น "คีย์บอร์ดยังไม่เสีย" ไม่ใช่การแจ้งซ่อม
        return 0

    return max(occurrences, 0)


def _score_keywords(text: str, table: dict[str, tuple[str, ...]]) -> dict[str, float]:
    """ให้คะแนน intent ตามคำที่เจอ โดยถ่วงน้ำหนักด้วย "ความยาวของคำ"

    ทำไมถ่วงด้วยความยาว: คำเฉพาะเจาะจงมักยาวกว่า เช่นประโยค "ขอสิทธิ์เข้าถึงโฟลเดอร์"
    จะโดนทั้ง "ขอ" (withdraw) และ "ขอสิทธิ์" (it_service) ถ้านับจำนวนคำเฉยๆ จะเสมอกัน
    แต่ถ้าถ่วงด้วยความยาว คำที่เจาะจงกว่าจะชนะ ซึ่งตรงกับเจตนาผู้ใช้มากกว่า

    เดิมใช้ `keyword in lowered` ดิบๆ ซึ่งพลาด 2 เรื่องใหญ่ (แก้แล้วใน _keyword_hits):
      - คำสั้นถูกคำอื่นกิน  "เมื่อคืน" -> นับเป็น intent "คืนอุปกรณ์"
      - ไม่ดูการปฏิเสธ      "ยังไม่เสีย" -> นับเป็น "แจ้งซ่อม"
    """
    scores: dict[str, float] = {}
    for intent, keywords in table.items():
        score = sum(len(keyword) * _keyword_hits(text, keyword) for keyword in keywords)
        if score:
            scores[intent] = float(score)
    return scores


def detect_intent(text: str) -> tuple[str, float]:
    """เดาว่าผู้ใช้ต้องการอะไร จากคำที่ปรากฏในประโยค

    ใช้การจับคำแบบมีน้ำหนัก — เรียบง่าย อธิบายได้ และที่สำคัญคือ "แก้ไขได้"
    เวลาบอทเดาผิดแค่เพิ่มคำใน INTENT_KEYWORDS
    (ต่างจากโมเดลกล่องดำที่พอเดาผิดแล้วทำอะไรไม่ได้นอกจากเทรนใหม่)
    """
    scores = _score_keywords(text, INTENT_KEYWORDS)
    if not scores:
        return "unknown", 0.0
    intent, score = max(scores.items(), key=lambda kv: kv[1])
    confidence = 0.6 if score <= 6 else 0.85
    return intent, confidence


def extract_ticket_code(text: str) -> str | None:
    match = _TICKET_CODE_PATTERN.search(text or "")
    if not match:
        return None
    return f"{match.group(1).upper()}{match.group(2)}"


def extract_quantity(text: str) -> int | None:
    """หาจำนวนที่ผู้ใช้ต้องการเบิกจากประโยค

    เดิมหยิบ "เลขตัวแรกที่ไม่เกิน 99" ซึ่งผิดทันทีเมื่อประโยคมีเลขอื่นมาก่อน:
        "เบิกเมาส์ให้ห้อง 5 คน 2 ตัว"  -> เดิมได้ 5 (จำนวนคน) ทั้งที่ต้องการ 2
        "ขอหมึก 3 ตลับ ภายในวันที่ 20" -> เดิมได้ 3 (บังเอิญถูก) แต่ถ้าสลับลำดับก็พังทันที

    วิธีใหม่: ให้ความสำคัญกับ "เลขที่มีหน่วยนับต่อท้าย" ก่อนเสมอ เพราะหน่วยนับคือสัญญาณ
    ที่ชัดที่สุดว่าเลขนั้นหมายถึงจำนวนของ ไม่ใช่จำนวนคน/วันที่/รหัส
    ถ้าไม่มีเลขไหนมีหน่วยนับเลย ค่อยถอยไปใช้เลขเดี่ยวตัวแรกแบบเดิม (ดีกว่าไม่ตอบอะไรเลย)
    """
    normalized = thai_text.normalize(text).translate(_THAI_DIGITS)

    # ตัดช่วงที่เป็นรหัสทรัพย์สินออกก่อน ไม่งั้น "NB2501001" จะถูกอ่านเป็นตัวเลขจำนวน
    without_assets = _ASSET_PATTERN.sub(" ", normalized)

    fallback: int | None = None
    for raw_number, unit in _QTY_PATTERN.findall(without_assets):
        try:
            value = int(raw_number)
        except ValueError:
            continue
        # ตัดเลขที่ดูเหมือนรหัสทรัพย์สินหรือปี พ.ศ. ออก (ยาวเกินไปไม่น่าใช่จำนวนของ)
        if not (0 < value <= 99 and len(raw_number) <= 2):
            continue
        if unit:
            return value
        if fallback is None:
            fallback = value

    return fallback


def extract_asset_code(text: str, knowledge: Knowledge) -> str | None:
    """หารหัสทรัพย์สินในประโยค แล้วเช็คกับรหัสจริงในฐานข้อมูล"""
    known_codes = [e["asset_code"] for e in knowledge.equipment]
    normalized_map = {re.sub(r"[^A-Z0-9]", "", c.upper()): c for c in known_codes}

    for prefix, digits in _ASSET_PATTERN.findall(text or ""):
        candidate = f"{prefix.upper()}{digits}"
        if candidate in normalized_map:
            return normalized_map[candidate]
        # ผู้ใช้พิมพ์ย่อ เช่น NB-001 ขณะที่ของจริงคือ NB2501001
        suffix_match = next(
            (real for norm, real in normalized_map.items() if norm.startswith(prefix.upper()) and norm.endswith(digits)),
            None,
        )
        if suffix_match:
            return suffix_match
    return None


def analyze(text: str, knowledge: Knowledge) -> Analysis:
    """วิเคราะห์ข้อความเดียวให้ได้ทั้ง intent และข้อมูลย่อยเท่าที่จับได้

    ตัวอย่าง:
      "คีย์บอร์ดเสียที่สาขาภูเก็ต"   -> repair, branch=ภูเก็ต
      "ขอเบิกเมาส์ 2 อัน"           -> withdraw, item=เมาส์, qty=2
      "คีย์บอร์ดเหลือกี่อัน"         -> stock_query (ไปดึงยอดคงเหลือจริงมาตอบ)
      "NB2501001 ใครถืออยู่"        -> asset_query
      "ITRQ2026090158 ถึงไหนแล้ว"   -> ticket_query
    """
    ticket_intent, confidence = detect_intent(text)
    data_scores = _score_keywords(text, DATA_QUERY_KEYWORDS)

    branch, _ = _fuzzy_best(text, knowledge.branch_names(), threshold=82)
    # เดาบริษัทให้ก็ต่อเมื่อไม่กำกวม — สาขาชื่อซ้ำข้ามบริษัทต้องให้ผู้ใช้เลือกเอง
    branch_companies = knowledge.companies_of_branch(branch) if branch else []
    company = branch_companies[0] if len(branch_companies) == 1 else None
    asset_code = extract_asset_code(text, knowledge)
    ticket_code = extract_ticket_code(text)

    stock_names = [s["name"] for s in knowledge.stock_items]
    matched_item, _ = _fuzzy_best(text, stock_names, threshold=80)

    # ค้น FAQ ไว้เสมอ เผื่อไม่เข้าเงื่อนไขอื่น
    faq_matches: list[dict[str, Any]] = []
    if knowledge.index is not None:
        for faq_id, score in knowledge.index.search(text, top_k=3):
            # 0.18 มาจากการลองกับ FAQ ชุดจริง — ต่ำกว่านี้มักเป็นการแมตช์คำทั่วไปที่ไม่เกี่ยวกัน
            if score < 0.18:
                continue
            item = knowledge.faq_by_id(faq_id)
            if item:
                faq_matches.append({**item, "score": round(score, 3)})

    base = dict(
        branch=branch,
        company=company,
        asset_code=asset_code,
        ticket_code=ticket_code,
        faq_matches=faq_matches,
    )

    # ---- ลำดับการตัดสินใจ: เจาะจงที่สุดก่อน ----

    # 1) พูดถึงเลขที่ ticket = อยากรู้สถานะเรื่องนั้น (ชัดเจนที่สุด ไม่ต้องมีคำถามประกอบ)
    if ticket_code:
        return Analysis(intent="ticket_query", confidence=0.95, **base)

    # 2) ถามถึงเรื่องของตัวเอง
    if "my_tickets_query" in data_scores:
        return Analysis(intent="my_tickets_query", confidence=0.85, **base)

    # 3) มีรหัสทรัพย์สิน + ถามเชิงข้อมูล (ไม่ใช่แจ้งว่าเสีย)
    if asset_code and ("asset_query" in data_scores or "ticket_query" in data_scores):
        return Analysis(intent="asset_query", confidence=0.85, **base)

    # 4) ถามยอดคงเหลือของในสต็อก
    if "stock_query" in data_scores:
        if matched_item:
            matches = [s for s in knowledge.stock_items if s["name"] == matched_item]
        else:
            # ไม่ได้เจาะจงชื่อของ -> ตอบของที่ใกล้หมดก่อน เพราะเป็นสิ่งที่คนถามอยากรู้ที่สุด
            matches = sorted(
                knowledge.stock_items, key=lambda s: s.get("quantity_available", 0)
            )[:5]
        return Analysis(intent="stock_query", confidence=0.8, stock_matches=matches, **base)

    # 5) ตั้งใจจะแจ้งเรื่องใหม่
    if ticket_intent != "unknown":
        item_name = matched_item if ticket_intent == "withdraw" else None
        quantity = extract_quantity(text) if item_name else None
        return Analysis(
            intent=ticket_intent,
            confidence=confidence,
            item_name=item_name,
            quantity=quantity,
            **base,
        )

    # 6) ไม่เข้าเงื่อนไขไหนเลย แต่มี FAQ ใกล้เคียง
    if faq_matches:
        return Analysis(
            intent="faq", confidence=min(0.5 + faq_matches[0]["score"], 0.95), **base
        )

    return Analysis(intent="unknown", confidence=0.0, **base)


# ---------------------------------------------------------------- ชั้น LLM (ไม่บังคับ)


async def compose_answer_with_llm(
    question: str,
    faq_matches: list[dict[str, Any]],
    *,
    provider: str,
    api_key: str,
    model: str,
    timeout: float = 12.0,
) -> str | None:
    """ให้ LLM เรียบเรียงคำตอบจาก FAQ ที่ค้นเจอ (RAG)

    สำคัญ: บังคับให้ตอบจากเนื้อหา FAQ ที่ส่งให้เท่านั้น ถ้าไม่มีข้อมูลให้บอกว่าไม่รู้
    ไม่อย่างนั้น LLM จะแต่งวิธีแก้ปัญหา IT ที่ไม่มีอยู่จริงในองค์กรขึ้นมาเอง
    ซึ่งอันตรายกว่าการตอบว่า "ไม่ทราบ" มาก

    คืน None เมื่อเรียกไม่สำเร็จ -> ผู้เรียกต้อง fallback ไปใช้คำตอบจาก FAQ ตรงๆ
    """
    if provider == "none" or not api_key or not faq_matches:
        return None

    context = "\n\n".join(f"[{f['title']}]\n{f['content']}" for f in faq_matches[:3])
    system_prompt = (
        "คุณคือผู้ช่วยฝ่าย IT ขององค์กร ตอบเป็นภาษาไทยสุภาพ สั้น กระชับ ไม่เกิน 4 บรรทัด "
        "ห้ามแต่งข้อมูลเอง ให้ตอบจากข้อมูลอ้างอิงที่ให้มาเท่านั้น "
        "ถ้าข้อมูลอ้างอิงไม่พอให้ตอบว่าไม่ทราบและแนะนำให้กด 'แจ้งเรื่องใหม่'"
    )
    user_prompt = f"ข้อมูลอ้างอิง:\n{context}\n\nคำถามของผู้ใช้: {question}"

    import httpx

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if provider == "anthropic":
                response = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": model,
                        "max_tokens": 400,
                        "system": system_prompt,
                        "messages": [{"role": "user", "content": user_prompt}],
                    },
                )
                response.raise_for_status()
                return response.json()["content"][0]["text"].strip()

            if provider == "openai":
                response = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": model,
                        "max_tokens": 400,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                    },
                )
                response.raise_for_status()
                return response.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:  # noqa: BLE001
        logger.warning("เรียก LLM ไม่สำเร็จ (%s) — ใช้คำตอบจาก FAQ ตรงๆ แทน: %s", provider, exc)
        return None

    logger.warning("ไม่รู้จัก AI_PROVIDER=%s", provider)
    return None
