"""ตัวเชื่อมไปยังระบบ ticket (Next.js) ผ่าน /api/internal/*

หลักการออกแบบ: bot ไม่รู้จักฐานข้อมูลเลย มันรู้จักแค่ HTTP API ชุดนี้
ผลคือวันที่ระบบหลังบ้านย้ายจาก mock JSON ไป Supabase/Postgres ไฟล์นี้ไม่ต้องแก้อะไรเลย

หมายเหตุเรื่อง performance: ใช้ httpx.AsyncClient ตัวเดียวตลอดอายุ process
(สร้างตอน startup ปิดตอน shutdown) ห้ามสร้างใหม่ทุก request เพราะจะเสียเวลา
handshake TCP/TLS ใหม่ทุกครั้ง และเปลือง file descriptor
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class BackendError(Exception):
    """ยิงไปหลังบ้านแล้วไม่สำเร็จ — flow จะเอาไปแปลงเป็นข้อความขอโทษผู้ใช้"""


class BackendClient:
    def __init__(self, base_url: str, api_key: str, timeout: float = 10.0) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=timeout,
            headers={"x-internal-key": api_key},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _get(self, params: dict[str, str]) -> dict[str, Any]:
        try:
            res = await self._client.get("/api/internal/lookup", params=params)
            res.raise_for_status()
            return res.json()
        except httpx.HTTPError as exc:
            logger.error("เรียก backend ไม่สำเร็จ params=%s err=%s", params, exc)
            raise BackendError(str(exc)) from exc

    async def list_stock_items(self) -> list[dict[str, Any]]:
        data = await self._get({"kind": "stock"})
        return data.get("items", [])

    async def lookup_equipment(self, code: str) -> dict[str, Any] | None:
        """คืนเครื่องแรกที่ตรงรหัส — ใช้ตอนที่ไม่ต้องให้ผู้ใช้เลือก (เช่นตอบคำถาม "ใครถืออยู่")"""
        matches = await self.lookup_equipment_matches(code)
        return matches[0] if matches else None

    async def lookup_equipment_matches(self, code: str) -> list[dict[str, Any]]:
        """คืน "ทุกเครื่อง" ที่ตรงรหัส

        จำเป็นเพราะข้อมูลจริงมีรหัสทรัพย์สินซ้ำกันอยู่ 28 แถว (คนละเครื่อง คนละสาขา)
        ถ้าเอาเครื่องแรกไปใช้เงียบๆ ticket จะผูกกับเครื่องผิดโดยไม่มีใครรู้ — ต้องให้ผู้ใช้เลือกเอง

        รองรับ backend รุ่นเก่าที่ยังไม่มีคีย์ `matches` ด้วย (fallback ไปอ่าน `equipment`)
        จะได้ deploy คนละรอบกันได้โดยไม่พัง
        """
        data = await self._get({"kind": "equipment", "code": code})
        if not data.get("found"):
            return []
        matches = data.get("matches")
        if isinstance(matches, list) and matches:
            return matches
        single = data.get("equipment")
        return [single] if single else []

    async def asset_options(
        self, level: str, *, category: str | None = None, brand: str | None = None
    ) -> list[dict[str, Any]]:
        """ตัวเลือกสำหรับเมนูเลือกทรัพย์สินทีละชั้น

        level="category"                  -> ประเภทที่มีของอยู่จริง
        level="brand" + category          -> ยี่ห้อ/รุ่นในประเภทนั้น
        level="code"  + category + brand  -> รหัสทรัพย์สินที่เหลือหลังกรอง

        คืนลิสต์ของ {"value","label","sub","count"} เรียงมาให้แล้วจากหลังบ้าน
        """
        params = {"kind": "asset_options", "level": level}
        if category:
            params["category"] = category
        if brand:
            params["brand"] = brand
        data = await self._get(params)
        return data.get("options", [])

    async def search_faq(self, query: str) -> list[dict[str, Any]]:
        data = await self._get({"kind": "faq", "q": query})
        return data.get("matches", [])

    async def get_ticket(self, ticket_code: str) -> dict[str, Any] | None:
        """ดูสถานะ ticket จากเลขที่ — ให้ผู้ใช้ติดตามเรื่องเองได้ในแชท"""
        data = await self._get({"kind": "ticket", "code": ticket_code})
        return data.get("ticket") if data.get("found") else None

    async def list_my_tickets(self, line_user_id: str) -> list[dict[str, Any]]:
        """เรื่องทั้งหมดที่ผู้ใช้ LINE คนนี้เคยแจ้งไว้"""
        data = await self._get({"kind": "my_tickets", "line_user_id": line_user_id})
        return data.get("tickets", [])

    async def list_my_assets(self, line_user_id: str) -> dict[str, Any]:
        """ทรัพย์สินที่ผู้ใช้ LINE คนนี้ถือครองอยู่

        คืนทั้งก้อนแทนที่จะคืนแค่ list เพราะต้องแยก 2 กรณีที่ต่างกันมากให้ผู้ใช้เข้าใจ:
          linked=False -> ยังไม่เคยผูกบัญชี (ยังไม่เคยแจ้งเรื่องเลย) ต้องบอกให้แจ้งเรื่องก่อน
          linked=True, assets=[] -> ผูกแล้วแต่ไม่มีของในความรับผิดชอบ ซึ่งเป็นคำตอบที่ถูกต้อง
        ถ้ายุบเป็น list เปล่าเหมือนกันทั้งคู่ ผู้ใช้กลุ่มแรกจะเข้าใจผิดว่าตัวเองไม่มีของ
        """
        return await self._get({"kind": "my_assets", "line_user_id": line_user_id})

    async def list_branches(self) -> list[str]:
        """รายชื่อสาขาที่ระบบรู้จัก — ใช้ตรวจว่าสาขาที่ผู้ใช้พิมพ์มีอยู่จริง"""
        data = await self._get({"kind": "branches"})
        return data.get("branches", [])

    async def branch_options(
        self, level: str, *, company: str | None = None, group: str | None = None
    ) -> list[dict[str, Any]]:
        """ตัวเลือกสำหรับเมนูเลือกสาขาทีละชั้น: บริษัท → กลุ่ม → สาขา

        level="company"                -> Montipa / Motta / ส่วนกลาง
        level="group" + company        -> ภูมิภาค (Montipa) หรือทีม Area Manager (Motta)
        level="branch" + company+group -> สาขาในกลุ่มนั้น
        """
        params = {"kind": "branch_options", "level": level}
        if company:
            params["company"] = company
        if group:
            params["group"] = group
        data = await self._get(params)
        return data.get("options", [])

    async def lookup_branch(self, name: str) -> dict[str, Any]:
        """ผู้ใช้พิมพ์ชื่อสาขาเอง -> บอกว่าอยู่บริษัทไหน และชื่อซ้ำข้ามบริษัทไหม

        จำเป็นเพราะมีสาขาชื่อซ้ำกันจริงข้ามบริษัท (เช่น "ศาลายา" มีทั้ง Montipa และ Motta)
        ถ้าเดาเอาเอง ticket จะไปอยู่บริษัทผิดโดยไม่มีใครรู้จนกว่าจะดูรายงานแยกบริษัท
        """
        return await self._get({"kind": "branch_lookup", "name": name})

    async def fetch_knowledge(self) -> dict[str, Any]:
        """ดึงข้อมูลทั้งชุด (สาขา/ทรัพย์สิน/สต็อก/FAQ) มาให้ชั้น AI ใช้ — บอทจะ cache ต่อเอง"""
        return await self._get({"kind": "knowledge"})

    async def upload_attachment(self, content: bytes, content_type: str) -> str:
        """ส่งไฟล์รูปไปให้ Next.js เซฟ แล้วคืน URL สาธารณะที่ได้กลับมา

        ทำไมไม่เซฟไว้ฝั่งบอทเอง: บอทรันคนละ container และไม่ได้ mount volume `uploads`
        ของแอป ถ้าเซฟเองรูปจะหายทุกครั้งที่ rebuild และหน้าแอดมินก็มองไม่เห็นไฟล์อยู่ดี
        """
        try:
            res = await self._client.post(
                "/api/internal/attachments",
                content=content,
                headers={"Content-Type": content_type},
            )
            res.raise_for_status()
            url = res.json().get("url")
            if not url:
                raise BackendError("backend ไม่ได้คืน url ของรูปกลับมา")
            return url
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:300]
            logger.error("อัปโหลดรูปไม่สำเร็จ status=%s detail=%s", exc.response.status_code, detail)
            raise BackendError(detail) from exc
        except httpx.HTTPError as exc:
            logger.error("อัปโหลดรูปไม่สำเร็จ (เชื่อมต่อไม่ได้): %s", exc)
            raise BackendError(str(exc)) from exc

    async def record_ticket_view(
        self,
        *,
        ticket_code: str,
        line_user_id: str,
        viewer_name: str,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> dict[str, Any]:
        """บันทึกว่ามีคนกดดูสถานะ ticket แล้วคืนสรุปกลับมา

        คืน {"ok", "first_view", "total_views", "acknowledged", "notify"}
        บอทเอา total_views ไปแสดงในการ์ดได้ว่าเรื่องนี้ถูกเปิดดูไปแล้วกี่ครั้ง
        """
        try:
            res = await self._client.post(
                "/api/internal/ticket-views",
                json={
                    "ticket_code": ticket_code,
                    "source": "line-bot",
                    "line_user_id": line_user_id,
                    "viewer_name": viewer_name,
                    "ip": ip,
                    "user_agent": user_agent,
                },
            )
            res.raise_for_status()
            return res.json()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:300]
            logger.error("บันทึก log การเปิดดู ticket ไม่สำเร็จ status=%s detail=%s",
                         exc.response.status_code, detail)
            raise BackendError(detail) from exc
        except httpx.HTTPError as exc:
            logger.error("บันทึก log การเปิดดู ticket ไม่สำเร็จ (เชื่อมต่อไม่ได้): %s", exc)
            raise BackendError(str(exc)) from exc

    async def confirm_ticket(
        self, *, ticket_code: str, line_user_id: str, action: str, viewer_name: str = ""
    ) -> dict[str, Any]:
        """ผู้แจ้งกดยืนยันผลการแก้ไขจากแชท

        action="confirm" -> ปิดเรื่องเป็น "ดำเนินการเสร็จสิ้น"
        action="reject"  -> ดึงกลับเป็น "กำลังดำเนินการ" พร้อมบันทึกว่ายังไม่หาย
        """
        try:
            res = await self._client.post(
                "/api/internal/tickets/confirm",
                json={
                    "ticket_code": ticket_code,
                    "line_user_id": line_user_id,
                    "action": action,
                    "viewer_name": viewer_name,
                },
            )
            # 403 = ไม่ใช่ผู้แจ้งคนนั้น ไม่ใช่ error ของระบบ ต้องบอกผู้ใช้ให้เข้าใจ
            if res.status_code == 403:
                return {"ok": False, "reason": "not_owner"}
            res.raise_for_status()
            return res.json()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:300]
            logger.error("ยืนยันผลการแก้ไขไม่สำเร็จ status=%s detail=%s",
                         exc.response.status_code, detail)
            raise BackendError(detail) from exc
        except httpx.HTTPError as exc:
            logger.error("ยืนยันผลการแก้ไขไม่สำเร็จ (เชื่อมต่อไม่ได้): %s", exc)
            raise BackendError(str(exc)) from exc

    async def create_ticket(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            res = await self._client.post("/api/internal/tickets", json=payload)
            res.raise_for_status()
            return res.json()
        except httpx.HTTPStatusError as exc:
            # ดึงข้อความ error จากหลังบ้านมา log ด้วย จะได้ดีบักง่ายว่า validation ตัวไหนไม่ผ่าน
            detail = exc.response.text[:300]
            logger.error("สร้าง ticket ไม่สำเร็จ status=%s detail=%s", exc.response.status_code, detail)
            raise BackendError(detail) from exc
        except httpx.HTTPError as exc:
            logger.error("สร้าง ticket ไม่สำเร็จ (เชื่อมต่อไม่ได้): %s", exc)
            raise BackendError(str(exc)) from exc
