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
        data = await self._get({"kind": "equipment", "code": code})
        return data.get("equipment") if data.get("found") else None

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

    async def list_branches(self) -> list[str]:
        """รายชื่อสาขาที่ระบบรู้จัก — ใช้ตรวจว่าสาขาที่ผู้ใช้พิมพ์มีอยู่จริง"""
        data = await self._get({"kind": "branches"})
        return data.get("branches", [])

    async def fetch_knowledge(self) -> dict[str, Any]:
        """ดึงข้อมูลทั้งชุด (สาขา/ทรัพย์สิน/สต็อก/FAQ) มาให้ชั้น AI ใช้ — บอทจะ cache ต่อเอง"""
        return await self._get({"kind": "knowledge"})

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
