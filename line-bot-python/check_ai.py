# -*- coding: utf-8 -*-
"""ตรวจความพร้อมของ "ชั้น AI" ของบอทกับข้อมูลจริงในระบบ (อ่านอย่างเดียว ไม่เขียนอะไรทั้งสิ้น)

รันในคอนเทนเนอร์ bot เพราะต้องใช้ env + เครือข่ายภายในของ compose:

    docker compose exec -T bot python - < line-bot-python/check_ai.py

อ่านผลยังไง:
  intent=faq + คะแนน >= 0.18  -> บอทตอบคำถามนั้นได้จาก FAQ ที่มีอยู่
  intent=repair/withdraw/...   -> บอทจะเปิด flow แจ้งเรื่องให้ (ไม่ใช่ตอบคำถาม)
  intent=unknown               -> ไม่มี FAQ ที่ตรงพอ บอทจะถามกลับ/ชวนแจ้งเรื่องแทน
                                  แก้ได้โดยเพิ่มคำพ้องในคีย์เวิร์ดของ FAQ ที่หน้าแอดมิน
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

from app import ai  # noqa: E402
from app.backend import BackendClient  # noqa: E402

QUESTIONS = [
    "ปริ้นเอกสารไม่ได้",
    "เครื่องพิมพ์กระดาษติด",
    "คอมเปิดไม่ติด",
    "wifi หลุดบ่อย",
    "ลืมรหัสผ่านอีเมล",
    "เข้าอินเทอร์เน็ตไม่ได้",
    "คีย์บอร์ดเหลือกี่อัน",
    "NB2501001 ใครถืออยู่",
    "เรื่องที่ฉันแจ้งถึงไหนแล้ว",
    "ขอเบิกเมาส์ 2 อัน",
    "แจ้งซ่อม",
    "เบิกอุปกรณ์",
    "คืนอุปกรณ์",
    "ขอใช้บริการ IT",
    "เรื่องที่ฉันแจ้ง",
]


async def main() -> None:
    client = BackendClient(
        os.environ["BACKEND_BASE_URL"], os.environ["INTERNAL_API_KEY"], 10.0
    )
    kb = await ai.KnowledgeCache(client, 300).get()
    print(
        f"ข้อมูลที่บอทใช้ตอบ: สาขา {len(kb.branches)} · สต็อก {len(kb.stock_items)} รายการ · "
        f"ทรัพย์สิน {len(kb.equipment)} ชิ้น · FAQ {len(kb.faq)} ข้อ · "
        f"ดัชนี TF-IDF {'พร้อม' if kb.index else 'ไม่ได้สร้าง'}"
    )
    print(f"ชั้น LLM: {os.environ.get('AI_PROVIDER', 'none')}")
    print("-" * 82)
    for q in QUESTIONS:
        a = ai.analyze(q, kb)
        top = a.faq_matches[0] if a.faq_matches else None
        faq = f"{top['title']} ({top['score']})" if top else "-"
        print(f"{q:26s} intent={a.intent:18s} conf={a.confidence:<5} faq={faq}")
    await client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
