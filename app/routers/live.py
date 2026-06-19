"""
Live updates via Server-Sent Events (SSE) and WebSocket.

GET  /api/v1/live/events              — SSE stream of all live events
GET  /api/v1/live/events?types=...    — SSE filtered by event type
WS   /ws/live                          — WebSocket equivalent

v2.3: Provides a pub/sub bus for real-time updates to the web UI.
Other parts of the backend call ``publish_event(type, payload)`` to
broadcast, and connected SSE/WS clients receive the events instantly.

Event types currently published:
    mgmt.user.created, mgmt.user.updated, mgmt.user.deleted,
    mgmt.user.enabled, mgmt.user.disabled,
    mgmt.key.created, mgmt.key.rotated, mgmt.key.deleted,
    mgmt.role.created, mgmt.role.updated, mgmt.role.deleted,
    mgmt.role.disabled, mgmt.role.enabled,
    auth.login, auth.logout,
    ban.created, ban.lifted,
    dashboard.refresh  (signal clients to refetch dashboard data)
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from app.auth import ApiKeyDep
from app.models.common import ErrorResponse

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/live",
    tags=["Live Updates"],
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
    },
)


# ── In-memory pub/sub bus ──────────────────────────────────────────────

class _LiveBus:
    """Asyncio pub/sub bus for live events.

    Each subscriber gets its own ``asyncio.Queue``. ``publish_event``
    is sync-safe (can be called from sync code) — it uses
    ``loop.call_soon_threadsafe`` to schedule the broadcast.
    """

    def __init__(self) -> None:
        self._subscribers: Set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()
        # Capture the running loop lazily (so it works in tests too)
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        if self._loop is None or self._loop.is_closed():
            try:
                self._loop = asyncio.get_running_loop()
            except RuntimeError:
                # No running loop — fall back to a new one (rare)
                self._loop = asyncio.new_event_loop()
        return self._loop

    async def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        async with self._lock:
            self._subscribers.add(q)
        return q

    async def unsubscribe(self, q: asyncio.Queue) -> None:
        async with self._lock:
            self._subscribers.discard(q)

    async def _broadcast(self, event: Dict[str, Any]) -> None:
        """Broadcast an event to all subscribers (non-blocking)."""
        dead: List[asyncio.Queue] = []
        async with self._lock:
            subs = list(self._subscribers)
        for q in subs:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # Subscriber is too slow — drop oldest, push newest
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except Exception:
                    dead.append(q)
        if dead:
            async with self._lock:
                for q in dead:
                    self._subscribers.discard(q)

    def publish_event(self, event_type: str, payload: Dict[str, Any]) -> None:
        """Publish an event. Safe to call from sync code."""
        event = {
            "type": event_type,
            "payload": payload,
            "timestamp": time.time(),
        }
        try:
            loop = self._ensure_loop()
            asyncio.run_coroutine_threadsafe(self._broadcast(event), loop)
        except Exception:
            logger.debug("[live] publish failed", exc_info=True)


# Singleton
bus = _LiveBus()


def publish_event(event_type: str, payload: Dict[str, Any]) -> None:
    """Convenience function used by other modules to broadcast events."""
    bus.publish_event(event_type, payload)


# ── SSE endpoint ───────────────────────────────────────────────────────

@router.get("/events", summary="Server-Sent Events stream")
async def sse_events(
    api_key: ApiKeyDep,
    types: Optional[str] = Query(default=None,
                                  description="Comma-separated event types to subscribe to"),
):
    """Stream live events as Server-Sent Events.

    Each event is sent as ``data: <json>\\n\\n``. The connection stays
    open indefinitely; clients should reconnect on disconnect.

    Auth: the request must include a valid ``X-API-Key`` header.
    """
    type_filter = (
        set(t.strip() for t in types.split(",") if t.strip())
        if types else None
    )

    async def event_stream():
        q = await bus.subscribe()
        try:
            # Send an initial hello so the client knows the stream is alive
            yield f"data: {json.dumps({'type': 'stream.open', 'payload': {}})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15.0)
                    if type_filter and event.get("type") not in type_filter:
                        continue
                    yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
                except asyncio.TimeoutError:
                    # Send a keepalive comment
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            await bus.unsubscribe(q)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # nginx: don't buffer
        },
    )


# ── WebSocket endpoint (mounted on /ws/live in main.py) ────────────────

async def ws_live_endpoint(websocket: WebSocket) -> None:
    """WebSocket handler for live events. Mounted at /ws/live in main.py."""
    # NOTE: Auth for WS is handled at the gateway/middleware level
    # (token passed as ?token= query param). Here we just accept.
    await websocket.accept()
    q = await bus.subscribe()
    try:
        # Send hello
        await websocket.send_text(json.dumps({
            "type": "stream.open", "payload": {}, "timestamp": time.time(),
        }))
        # Two-task loop: read incoming (for ping) + push outgoing
        async def _push():
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15.0)
                    await websocket.send_text(json.dumps(event, ensure_ascii=False, default=str))
                except asyncio.TimeoutError:
                    # Send keepalive ping
                    await websocket.send_text(json.dumps({"type": "ping"}))
                except WebSocketDisconnect:
                    break

        async def _read():
            while True:
                try:
                    msg = await websocket.receive_text()
                    # We expect clients to send {"type": "pong"} in response to ping
                    # or {"types": ["mgmt.user.*", ...]} to filter.
                    try:
                        data = json.loads(msg)
                    except json.JSONDecodeError:
                        continue
                    if data.get("type") == "pong":
                        continue
                except WebSocketDisconnect:
                    break

        await asyncio.gather(_push(), _read())
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("[live] ws error: %s", exc, exc_info=True)
    finally:
        await bus.unsubscribe(q)
        try:
            await websocket.close()
        except Exception:
            pass
