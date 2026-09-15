"""ทดสอบ end-to-end ของจริง: LINE webhook -> บอท Python -> Next.js -> ticket ในฐานข้อมูล

ต่างจาก tests/test_flow.py ตรงที่ชุดนี้ไม่ mock อะไรเลยนอกจากตัว LINE API ปลายทาง
ทุกอย่างวิ่งผ่าน HTTP จริง ลายเซ็นจริง และ ticket ที่ได้คือ ticket ที่เขียนลงไฟล์ข้อมูลจริง

ต้องรัน 3 อย่างนี้ก่อน:
  1. Next.js          : PORT 3000 (มี INTERNAL_API_KEY ตรงกับของบอท)
  2. mock LINE server : PORT 3999
  3. บอท Python       : PORT 8000 (LINE_API_HOST ชี้มาที่ mock)

วิธีรัน: python tests/e2e/run_e2e.py
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import time
from pathlib import Path

import httpx

BOT_URL = os.environ.get("BOT_URL", "http://127.0.0.1:8000")
MOCK_LINE_URL = os.environ.get("MOCK_LINE_URL", "http://127.0.0.1:3999")
CHANNEL_SECRET = os.environ.get("LINE_CHANNEL_SECRET", "e2e-test-channel-secret")
USER_ID = os.environ.get("E2E_USER_ID", "U_e2e_00000000000000000000000000001")
# เดิม hardcode เป็น "/home/claude/it-support-admin/data/tickets.json" (path เฉพาะเครื่อง
# dev ตอนเขียนสคริปต์นี้ครั้งแรก) พอรันบนเครื่องอื่นเลย FileNotFoundError ทันที — เปลี่ยนเป็น
# คำนวณจากตำแหน่งไฟล์นี้เอง (ถอยจาก line-bot-python/tests/e2e/ ขึ้นไป root ของ repo) แทน
# ยัง override ผ่าน env ได้เผื่อวันหนึ่งรันเทียบกับ data dir ที่ mount ไว้คนละที่ (เช่นในคอนเทนเนอร์)
TICKETS_FILE = os.environ.get(
    "TICKETS_FILE",
    str(Path(__file__).resolve().parents[3] / "data" / "tickets.json"),
)

failures: list[str] = []
checks = 0


def check(condition: bool, label: str) -> None:
    global checks
    checks += 1
    if condition:
        print(f"  ✅ {label}")
    else:
        print(f"  ❌ {label}")
        failures.append(label)


def sign(body: str) -> str:
    digest = hmac.new(CHANNEL_SECRET.encode(), body.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


def envelope(event: dict) -> dict:
    base = {
        "mode": "active",
        "timestamp": int(time.time() * 1000),
        "source": {"type": "user", "userId": USER_ID},
        "webhookEventId": "01HTESTEVENTID0000000000000",
        "deliveryContext": {"isRedelivery": False},
        "replyToken": f"reply-{int(time.time() * 1000)}",
    }
    base.update(event)
    return {"destination": "Udestination0000000000000000000", "events": [base]}


def send(event: dict, *, bad_signature: bool = False) -> list[dict]:
    """ยิง webhook 1 เหตุการณ์ แล้วคืนข้อความที่บอทส่งไปหา LINE"""
    httpx.post(f"{MOCK_LINE_URL}/_reset", timeout=10)
    body = json.dumps(envelope(event), ensure_ascii=False)
    signature = "invalid" if bad_signature else sign(body)
    response = httpx.post(
        f"{BOT_URL}/webhook",
        content=body.encode("utf-8"),
        headers={"content-type": "application/json", "x-line-signature": signature},
        timeout=30,
    )
    if bad_signature:
        return [{"_status": response.status_code}]
    response.raise_for_status()
    captured = httpx.get(f"{MOCK_LINE_URL}/_captured", timeout=10).json()
    messages: list[dict] = []
    for item in captured["items"]:
        messages.extend(item.get("messages", []))
    return messages


def text_event(message: str) -> dict:
    return {
        "type": "message",
        "message": {"type": "text", "id": "1000000000", "text": message, "quoteToken": "q"},
    }


def postback_event(data: str) -> dict:
    return {"type": "postback", "postback": {"data": data}}


def follow_event() -> dict:
    # SDK บังคับให้ follow event ต้องมี object "follow" ด้วย (LINE ของจริงส่งมาเสมอ)
    # ถ้าไม่มี parser จะตีเป็น UnknownEvent เงียบๆ แล้วบอทจะไม่ตอบอะไรเลย
    return {"type": "follow", "follow": {"isUnblocked": False}}


def quick_labels(message: dict) -> list[str]:
    quick = message.get("quickReply") or {}
    return [i["action"]["label"] for i in quick.get("items", [])]


def main() -> int:
    print("\n=== 0. ตรวจความปลอดภัย: ลายเซ็นผิดต้องถูกปฏิเสธ ===")
    result = send(text_event("สวัสดี"), bad_signature=True)
    check(result[0]["_status"] == 401, "ลายเซ็นผิด -> HTTP 401")

    print("\n=== 1. กดเพิ่มเพื่อน (follow) ===")
    messages = send(follow_event())
    check(len(messages) == 1, "ตอบกลับ 1 ข้อความ")
    check("สวัสดีครับ Film" in messages[0]["text"], "ทักทายด้วยชื่อจากโปรไฟล์ LINE")
    check("📝 แจ้งเรื่องใหม่" in quick_labels(messages[0]), "มีปุ่มแจ้งเรื่องใหม่")

    print("\n=== 2. กดแจ้งเรื่องใหม่ ===")
    messages = send(postback_event("a=start"))
    check("พิมพ์ชื่อสาขาของคุณ" in messages[0]["text"], "ถามชื่อสาขา")

    print("\n=== 3a. พิมพ์สาขาที่ไม่มีในระบบ -> ต้องถูกปฏิเสธ (ตามต้นแบบ) ===")
    messages = send(text_event("ต้องการแจ้งซ่อม"))
    check(
        "ไม่พบสาขาที่ตรงกันครับ ลองพิมพ์ใหม่" in messages[0]["text"],
        "ปฏิเสธสาขาที่ไม่มีจริง",
    )

    print("\n=== 3b. พิมพ์ชื่อสาขาที่ถูกต้อง ===")
    messages = send(text_event("สำนักงานใหญ่"))
    check(messages[0]["text"].startswith("สาขา: สำนักงานใหญ่ ✅"), "ยืนยันสาขา")
    check("แจ้งเรื่องอะไรครับ?" in messages[0]["text"], "ถามประเภทเรื่อง")
    labels = quick_labels(messages[0])
    check(
        labels == ["🖊 แจ้งซ่อม", "📦 เบิกอุปกรณ์", "🔄 คืนอุปกรณ์", "🛠 ขอใช้บริการ IT"],
        f"ปุ่มครบ 4 ประเภทตามต้นแบบ: {labels}",
    )

    print("\n=== 4. เลือกเบิกอุปกรณ์ ===")
    messages = send(postback_event("a=type&v=withdraw"))
    check("ระบุหมายเลขทรัพย์สินครับ" in messages[0]["text"], "ถามรหัสทรัพย์สิน")
    check("ไม่มี/ไม่ทราบ" in quick_labels(messages[0]), "มีปุ่ม 'ไม่มี/ไม่ทราบ'")

    print("\n=== 5. กดไม่ทราบ -> ต้องได้รายการสต็อกจริงจากฐานข้อมูล ===")
    messages = send(postback_event("a=skip_asset"))
    labels = quick_labels(messages[0])
    check("เลือกอุปกรณ์ที่ต้องการเบิกครับ:" in messages[0]["text"], "ให้เลือกอุปกรณ์")
    check("คีย์บอร์ด" in labels, "ปุ่ม 'คีย์บอร์ด' มาจากสต็อกจริงในระบบ")
    print(f"     รายการที่ได้จาก DB: {labels}")

    keyboard_data = None
    stock = httpx.get(
        "http://127.0.0.1:3000/api/internal/lookup",
        params={"kind": "stock"},
        headers={"x-internal-key": os.environ["INTERNAL_API_KEY"]},
        timeout=10,
    ).json()
    before = {s["name"]: s["quantity_available"] for s in stock["items"]}
    for item in stock["items"]:
        if item["name"] == "คีย์บอร์ด":
            keyboard_data = f"a=item&v={item['id']}"
    check(keyboard_data is not None, "หา stock id ของคีย์บอร์ดได้")

    print("\n=== 6. เลือกคีย์บอร์ด ===")
    messages = send(postback_event(keyboard_data))
    check(messages[0]["text"].startswith("เลือก: คีย์บอร์ด ✅"), "ยืนยันของที่เลือก")
    check("ต้องการกี่ชิ้นครับ?" in messages[0]["text"], "ถามจำนวน")

    print("\n=== 7. พิมพ์จำนวน 1 ===")
    messages = send(text_event("1"))
    check("คีย์บอร์ด x1" in messages[0]["text"], "สรุปรายการที่เบิก")

    print("\n=== 8. กดพอแล้ว ===")
    messages = send(postback_event("a=done_items"))
    check("ระบุชื่อผู้เบิก" in messages[0]["text"], "ถามชื่อผู้เบิก")

    print("\n=== 9. พิมพ์ชื่อผู้เบิก ===")
    messages = send(text_event("สมัย"))
    check("มีรายละเอียดเพิ่มเติมไหมครับ?" in messages[0]["text"], "ถามรายละเอียดเพิ่มเติม")

    print("\n=== 10. พิมพ์ '-' -> สร้าง ticket จริง ===")
    messages = send(text_event("-"))
    summary = messages[0]["text"]
    print("     ---- ข้อความสรุปที่ผู้ใช้จะเห็นใน LINE ----")
    for line in summary.splitlines():
        print(f"     | {line}")
    check("✅ รับเรื่องแล้วครับ!" in summary, "ขึ้นข้อความรับเรื่อง")
    check("📍 สาขา: สำนักงานใหญ่" in summary, "แสดงสาขา")
    check("📋 ประเภท: 📦 เบิกอุปกรณ์" in summary, "แสดงประเภท")
    check("👤 ผู้รับ/คืน: สมัย" in summary, "แสดงผู้รับ")
    check("📦 คีย์บอร์ด x1" in summary, "แสดงรายการที่เบิก")
    check("ทีม IT จะติดต่อกลับโดยเร็วที่สุดครับ 🙏" in summary, "ปิดท้ายเหมือนต้นแบบ")

    ticket_code = None
    for line in summary.splitlines():
        if line.startswith("🎫"):
            ticket_code = line.replace("🎫", "").strip()
    check(bool(ticket_code), f"ได้เลขที่ ticket: {ticket_code}")
    check(
        bool(ticket_code) and ticket_code.startswith("ITRQ"),
        "ขึ้นต้นด้วย ITRQ ตามรูปแบบต้นแบบ",
    )

    print("\n=== 11. ตรวจว่า ticket ถูกบันทึกลงฐานข้อมูลจริง ===")
    # ถ้า Next.js รันในคอนเทนเนอร์ (docker-compose) ไฟล์นี้อยู่ใน named volume ข้างใน container
    # ไม่ได้ bind mount ออกมาที่ path บนเครื่อง host เลย เลยเปิดตรงๆ จากตรงนี้ไม่ได้ — ข้าม
    # การตรวจสอบนี้แบบมีเหตุผลชัดเจนแทนที่จะปล่อยให้ทั้งชุดพังด้วย FileNotFoundError (การ์ด 1-10
    # ข้างบนซึ่งอ่านจากข้อความตอบกลับจริงของบอทถือว่าครอบคลุม ticket_code/ประเภท/สาขา/ผู้รับ/รายการ
    # ไปแล้วเกือบทั้งหมด ยังขาดแค่การเทียบ field ดิบใน JSON เช่น status/meta.line_user_id)
    try:
        with open(TICKETS_FILE, encoding="utf-8") as fh:
            tickets = json.load(fh)
        created = next((t for t in tickets if t["ticket_code"] == ticket_code), None)
    except FileNotFoundError:
        print(
            f"  ⚠️  ข้าม: ไม่พบ {TICKETS_FILE} บนเครื่องนี้ "
            "(ปกติถ้า Next.js รันในคอนเทนเนอร์ที่ข้อมูลอยู่ใน named volume — "
            "ตรวจแทนด้วย `docker compose exec app cat /app/data/tickets.json`)"
        )
        created = None
    else:
        check(created is not None, "หา ticket เจอในไฟล์ข้อมูล")
    if created:
        print(f"     ticket ในฐานข้อมูล: {json.dumps(created, ensure_ascii=False)[:320]}")
        check(created["type"] == "withdraw", "type = withdraw")
        check(created["status"] == "pending", "status = pending")
        check(created["location"] == "สำนักงานใหญ่", "location = สำนักงานใหญ่")
        check(created["meta"]["source"] == "line-bot", "meta.source = line-bot")
        check(
            created["meta"]["items"] == [{"name": "คีย์บอร์ด", "qty": 1}],
            "meta.items ถูกต้อง",
        )
        check(created["meta"]["line_user_id"] == USER_ID, "ผูก line_user_id ไว้ด้วย")

    print("\n=== 12. ตรวจว่าสต็อกถูกตัดจริง ===")
    stock_after = httpx.get(
        "http://127.0.0.1:3000/api/internal/lookup",
        params={"kind": "stock"},
        headers={"x-internal-key": os.environ["INTERNAL_API_KEY"]},
        timeout=10,
    ).json()
    after = {s["name"]: s["quantity_available"] for s in stock_after["items"]}
    check(
        after["คีย์บอร์ด"] == before["คีย์บอร์ด"] - 1,
        f"คีย์บอร์ด {before['คีย์บอร์ด']} -> {after['คีย์บอร์ด']} (ลด 1)",
    )

    print("\n=== 13. ชั้น AI: ประโยคเดียวต้องข้ามคำถามที่ตอบไปแล้ว ===")
    messages = send(text_event("ขอเบิกเมาส์ 2 อัน ที่สาขาเชียงใหม่"))
    combined = " ".join(m["text"] for m in messages)
    print(f"     บอทตอบ: {combined[:160]}")
    check("รับทราบครับ" in combined, "บอทสรุปสิ่งที่เข้าใจให้ผู้ใช้ตรวจ")
    check("สาขา: สาขาเชียงใหม่" in combined, "จับสาขาจากประโยคได้")
    check("อุปกรณ์: เมาส์ x2" in combined, "จับชื่อของและจำนวนได้")
    check("ระบุหมายเลขทรัพย์สินครับ" in combined, "ข้ามไปถามเฉพาะสิ่งที่ยังไม่รู้")

    send(text_event("ยกเลิก"))

    print("\n=== 14. ชั้น AI: ถามคำถามทั่วไปต้องตอบจาก FAQ ในระบบ ===")
    messages = send(text_event("ปริ้นเตอร์ใช้ไม่ได้"))
    answer = " ".join(m["text"] for m in messages)
    print(f"     บอทตอบ: {answer[:200]}")
    check("📌" in answer, "ตอบด้วยเนื้อหา FAQ จากฐานข้อมูล")

    print("\n=== 15. ถามยอดสต็อกคงเหลือ -> ต้องดึงตัวเลขสดจากฐานข้อมูล ===")
    # อ่านยอดจริง ณ วินาทีนี้ก่อนถาม เพื่อพิสูจน์ว่าบอทไม่ได้ตอบจากแคชเก่า
    live = httpx.get(
        "http://127.0.0.1:3000/api/internal/lookup",
        params={"kind": "stock"},
        headers={"x-internal-key": os.environ["INTERNAL_API_KEY"]},
        timeout=10,
    ).json()
    expected_qty = next(s["quantity_available"] for s in live["items"] if s["name"] == "คีย์บอร์ด")
    messages = send(text_event("คีย์บอร์ดเหลือกี่อัน"))
    answer = messages[0]["text"]
    print(f"     บอทตอบ: {answer[:200]}")
    check("ข้อมูลสต็อกล่าสุด" in answer, "ตอบข้อมูลสต็อก")
    check(
        f"คีย์บอร์ด: {expected_qty}" in answer,
        f"ตัวเลขตรงกับยอดสดในฐานข้อมูล ({expected_qty})",
    )

    print("\n=== 16. ถามว่าทรัพย์สินอยู่กับใคร ===")
    messages = send(text_event("NB2501001 ใครถืออยู่"))
    answer = messages[0]["text"]
    print(f"     บอทตอบ: {answer[:220]}")
    check("NB2501001" in answer, "ตอบข้อมูลทรัพย์สิน")
    check("ผู้ถือครอง:" in answer, "บอกผู้ถือครองจากฐานข้อมูล")

    print("\n=== 17. ถามสถานะ ticket ที่เพิ่งสร้าง ===")
    messages = send(text_event(f"{ticket_code} ถึงไหนแล้ว"))
    answer = messages[0]["text"]
    print(f"     บอทตอบ: {answer[:240]}")
    check(ticket_code in answer, "ตอบถูก ticket")
    check("สถานะ: 🕐 รอดำเนินการ" in answer, "แสดงสถานะจากฐานข้อมูล")

    print("\n=== 18. ถามเรื่องที่ตัวเองเคยแจ้ง ===")
    messages = send(text_event("ขอดูเรื่องที่แจ้งไปหน่อย"))
    answer = messages[0]["text"]
    print(f"     บอทตอบ: {answer[:240]}")
    check("เรื่องที่คุณแจ้งไว้ล่าสุด" in answer, "ดึงประวัติของผู้ใช้คนนี้")
    check(ticket_code in answer, "มี ticket ที่เพิ่งแจ้งอยู่ในรายการ")

    print("\n" + "=" * 60)
    if failures:
        print(f"❌ ไม่ผ่าน {len(failures)} จาก {checks} ข้อ:")
        for item in failures:
            print(f"   - {item}")
        return 1
    print(f"✅ ผ่านทั้งหมด {checks} ข้อ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
