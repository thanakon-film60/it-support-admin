import base64
import hashlib
import hmac
import json
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.main import app, settings


def test_application_starts_and_accepts_signed_webhook(monkeypatch):
    # Exercise the production entry point without external services or real messages.
    monkeypatch.setattr(settings, "line_channel_secret", "test-secret")
    monkeypatch.setattr(settings, "line_channel_access_token", "test-token")
    monkeypatch.setattr(settings, "internal_api_key", "test-key")
    monkeypatch.setattr(settings, "redis_url", "")
    monkeypatch.setattr(settings, "richmenu_auto_install", False)
    monkeypatch.setattr(settings, "ai_provider", "none")

    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["first_step"] == "ASK_BRANCH"
        assert health.json()["first_selection"] == "company"
        assert client.get("/webhook").json()["service"] == "line-bot-python"

        body = b'{"events": []}'
        signature = base64.b64encode(hmac.new(b"test-secret", body, hashlib.sha256).digest()).decode()
        assert client.post("/webhook", content=body, headers={"x-line-signature": signature}).status_code == 200
        assert client.post("/webhook", content=body, headers={"x-line-signature": "invalid"}).status_code == 401

        reply = AsyncMock()
        monkeypatch.setattr(app.state.line, "reply", reply)
        monkeypatch.setattr(app.state.line, "get_display_name", AsyncMock(return_value="Tester"))
        body = json.dumps({"events": [{
            "type": "follow", "timestamp": 1, "mode": "active",
            "follow": {"isUnblocked": False},
            "source": {"type": "user", "userId": "U_test"},
            "replyToken": "test-reply", "webhookEventId": "test-event",
            "deliveryContext": {"isRedelivery": False},
        }]}).encode()
        signature = base64.b64encode(hmac.new(b"test-secret", body, hashlib.sha256).digest()).decode()
        assert client.post("/webhook", content=body, headers={"x-line-signature": signature}).status_code == 200
        reply.assert_awaited_once()
        assert reply.call_args.args[0] == "test-reply"
        assert reply.call_args.args[1]
