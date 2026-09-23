import asyncio

import pytest

from app.events import EventGuard
from app.flow import handle
from app.store import Session
from test_flow import FakeBackend, USER, postback, store, text
from test_ai import FakeKnowledgeCache


@pytest.mark.asyncio
async def test_original_message_and_selected_asset_reach_backend():
    s, backend = store(), FakeBackend()
    original = "NB2501001 เปิดไม่ติด ที่สำนักงานใหญ่"
    await handle(text(original), s, backend, knowledge=FakeKnowledgeCache())
    session = await s.get(USER)
    assert session.initial_message == original
    assert session.equipment_id == "eq-1"
    await handle(text("Tester / IT"), s, backend)
    await handle(text("ไม่มี"), s, backend)
    assert backend.created[0]["initial_message"] == original
    assert backend.created[0]["equipment_id"] == "eq-1"


@pytest.mark.asyncio
@pytest.mark.parametrize("ticket_type", ["repair", "withdraw", "return", "it_service"])
async def test_retry_keeps_request_id_and_all_details(ticket_type):
    s, backend = store(), FakeBackend(fail_create=True)
    session = Session(step="ASK_DESC", ticket_type=ticket_type, branch="HQ", requester_name="Tester",
                      initial_message="Original", image_urls=["/uploads/tickets/test.jpg"],
                      items=[{"name": "Mouse", "qty": 1}])
    await s.set(USER, session)
    await handle(text("Detail"), s, backend)
    restored = Session.from_json((await s.get(USER)).to_json())
    assert restored.request_id == session.request_id
    await s.set(USER, restored)
    backend.fail_create = False
    await handle(postback({"a": "retry_submit"}), s, backend)
    assert backend.created[0]["request_id"] == session.request_id
    assert backend.created[0]["description"] == "Detail"
    assert backend.created[0]["image_urls"] == session.image_urls
    assert await s.get(USER) is None


@pytest.mark.asyncio
async def test_stale_retry_button_cannot_submit_incomplete_ticket():
    s, backend = store(), FakeBackend()
    await s.set(USER, Session(step="ASK_BRANCH"))
    await handle(postback({"a": "retry_submit"}), s, backend)
    assert backend.created == []


@pytest.mark.asyncio
async def test_concurrent_redelivery_only_processes_once():
    guard = EventGuard()
    processed = []

    async def delivery():
        async with guard.lock(USER):
            if await guard.seen("event-1"):
                return
            await asyncio.sleep(0)
            processed.append("event-1")
            await guard.mark("event-1")

    await asyncio.gather(delivery(), delivery(), delivery())
    assert processed == ["event-1"]


@pytest.mark.asyncio
async def test_ai_duplicate_asset_waits_for_selection():
    s = store()
    backend = FakeBackend(extra_equipment={"NB2501001": [
        {"id": "first", "asset_code": "NB2501001", "brand_model": "First"},
        {"id": "second", "asset_code": "NB2501001", "brand_model": "Second"},
    ]})
    await handle(text("NB2501001 เปิดไม่ติด ที่สำนักงานใหญ่"), s, backend, knowledge=FakeKnowledgeCache())
    assert (await s.get(USER)).step == "ASK_PICK_ASSET"
    await handle(postback({"a": "pick_asset", "v": "second"}), s, backend)
    assert (await s.get(USER)).equipment_id == "second"
