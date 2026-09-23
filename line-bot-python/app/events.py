"""Serialize each user's events and remember processed webhook IDs for 24 hours."""
from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from weakref import WeakValueDictionary


class EventGuard:
    def __init__(self, redis_url: str = "", lock_seconds: int = 180):
        self._redis = None
        if redis_url.strip():
            import redis.asyncio as redis
            self._redis = redis.from_url(redis_url, decode_responses=True)
        self._locks = WeakValueDictionary()
        self._seen: dict[str, float] = {}
        self._lock_seconds = lock_seconds

    @asynccontextmanager
    async def lock(self, user_id: str):
        if self._redis is not None:
            async with self._redis.lock(
                f"linebot:event-lock:{user_id}", timeout=self._lock_seconds,
                blocking_timeout=self._lock_seconds,
            ):
                yield
        else:
            lock = self._locks.setdefault(user_id, asyncio.Lock())
            async with lock:
                yield

    async def seen(self, event_id: str) -> bool:
        if not event_id:
            return False
        if self._redis is not None:
            return bool(await self._redis.exists(f"linebot:event:{event_id}"))
        return self._seen.get(event_id, 0) > time.time()

    async def mark(self, event_id: str):
        if not event_id:
            return
        if self._redis is not None:
            await self._redis.set(f"linebot:event:{event_id}", "1", ex=86400)
        else:
            now = time.time()
            self._seen = {key: expiry for key, expiry in self._seen.items() if expiry > now}
            self._seen[event_id] = now + 86400

    async def aclose(self):
        if self._redis is not None:
            await self._redis.aclose()
