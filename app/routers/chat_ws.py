"""
WebSocket for real-time chat delivery.

WS /ws/chat/{room_id}  — join a chat room, receive messages in real time

Protocol (JSON messages):

Client → Server:
    {"type": "join", "room_id": 123}
    {"type": "typing", "room_id": 123, "is_typing": true}
    {"type": "ping"}

Server → Client:
    {"type": "joined", "room_id": 123, "members_online": 2}
    {"type": "message", "data": {...message...}}
    {"type": "message_edited", "data": {...message...}}
    {"type": "message_deleted", "data": {"id": 456}}
    {"type": "typing", "user_id": 7, "username": "su", "is_typing": true}
    {"type": "member_joined", "user_id": 5, "username": "operator1"}
    {"type": "member_left", "user_id": 5}
    {"type": "pong"}

Auth: pass JWT token as ?token= query param (gateway-level auth).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Dict, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Chat — WebSocket"])

# ── In-memory room → subscribers mapping ───────────────────────────────

_room_subscribers: Dict[int, Set[WebSocket]] = {}
_lock = asyncio.Lock()


async def _subscribe(room_id: int, ws: WebSocket) -> None:
    async with _lock:
        _room_subscribers.setdefault(room_id, set()).add(ws)


async def _unsubscribe(room_id: int, ws: WebSocket) -> None:
    async with _lock:
        subs = _room_subscribers.get(room_id)
        if subs:
            subs.discard(ws)
            if not subs:
                _room_subscribers.pop(room_id, None)


def get_online_count(room_id: int) -> int:
    subs = _room_subscribers.get(room_id)
    return len(subs) if subs else 0


def broadcast_to_room(room_id: int, event: Dict[str, Any]) -> None:
    """Broadcast an event to all subscribers of a room (sync, thread-safe).

    Called from REST handlers (send_message, edit, delete, file upload)
    to push updates to all connected WebSocket clients.
    """
    subs = _room_subscribers.get(room_id)
    if not subs:
        return
    msg = json.dumps(event, ensure_ascii=False, default=str)
    dead = []
    for ws in subs:
        try:
            # schedule send on the event loop
            asyncio.run_coroutine_threadsafe(ws.send_text(msg), asyncio.get_event_loop())
        except Exception:
            dead.append(ws)
    for ws in dead:
        subs.discard(ws)


async def _broadcast_async(room_id: int, event: Dict[str, Any]) -> None:
    """Async version of broadcast_to_room — used from within WS handlers."""
    subs = _room_subscribers.get(room_id)
    if not subs:
        return
    msg = json.dumps(event, ensure_ascii=False, default=str)
    dead = []
    for ws in list(subs):  # copy to avoid mutation during iteration
        try:
            await ws.send_text(msg)
        except WebSocketDisconnect:
            dead.append(ws)
        except Exception:
            dead.append(ws)
    for ws in dead:
        subs.discard(ws)


@router.websocket("/ws/chat/{room_id}")
async def ws_chat(websocket: WebSocket, room_id: int) -> None:
    """WebSocket for real-time chat in a specific room.

    Auth: the gateway should verify the ?token= query param before
    accepting the connection. For dev, accepts any connection.
    """
    await websocket.accept()
    await _subscribe(room_id, websocket)

    # Send join confirmation
    await websocket.send_text(json.dumps({
        "type": "joined",
        "room_id": room_id,
        "members_online": get_online_count(room_id),
        "timestamp": time.time(),
    }))

    # Notify others that a new user joined
    await _broadcast_async(room_id, {
        "type": "member_online",
        "room_id": room_id,
        "members_online": get_online_count(room_id),
    })

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            mtype = data.get("type")

            if mtype == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

            elif mtype == "typing":
                # Broadcast typing indicator to others in the room
                await _broadcast_async(room_id, {
                    "type": "typing",
                    "room_id": room_id,
                    "user_id": data.get("user_id"),
                    "username": data.get("username", ""),
                    "is_typing": data.get("is_typing", True),
                })

            # ── WebRTC signaling for calls (v2.5) ────────────────────
            elif mtype == "webrtc.offer":
                # Caller sends SDP offer → relay to callee
                await _broadcast_async(room_id, {
                    "type": "webrtc.offer",
                    "room_id": room_id,
                    "call_id": data.get("call_id"),
                    "from_user_id": data.get("from_user_id"),
                    "from_username": data.get("from_username", ""),
                    "to_user_id": data.get("to_user_id"),
                    "sdp": data.get("sdp"),
                })

            elif mtype == "webrtc.answer":
                # Callee sends SDP answer → relay to caller
                await _broadcast_async(room_id, {
                    "type": "webrtc.answer",
                    "room_id": room_id,
                    "call_id": data.get("call_id"),
                    "from_user_id": data.get("from_user_id"),
                    "from_username": data.get("from_username", ""),
                    "to_user_id": data.get("to_user_id"),
                    "sdp": data.get("sdp"),
                })

            elif mtype == "webrtc.ice":
                # ICE candidate exchange (both directions)
                await _broadcast_async(room_id, {
                    "type": "webrtc.ice",
                    "room_id": room_id,
                    "call_id": data.get("call_id"),
                    "from_user_id": data.get("from_user_id"),
                    "to_user_id": data.get("to_user_id"),
                    "candidate": data.get("candidate"),
                })

            elif mtype == "webrtc.end":
                # Peer connection closed (not the call itself — that's REST)
                await _broadcast_async(room_id, {
                    "type": "webrtc.end",
                    "room_id": room_id,
                    "call_id": data.get("call_id"),
                    "from_user_id": data.get("from_user_id"),
                })

            # ── Screen sharing (v2.6) ──────────────────────────────────
            elif mtype == "screen.start":
                await _broadcast_async(room_id, {
                    "type": "screen.start",
                    "room_id": room_id,
                    "call_id": data.get("call_id"),
                    "from_user_id": data.get("from_user_id"),
                })

            elif mtype == "screen.stop":
                await _broadcast_async(room_id, {
                    "type": "screen.stop",
                    "room_id": room_id,
                    "call_id": data.get("call_id"),
                    "from_user_id": data.get("from_user_id"),
                })

            # ── E2E encryption key exchange (v2.6) ─────────────────────
            # Server is a dumb relay — never sees the actual encryption keys
            # or message content. Clients exchange public keys via this channel.
            elif mtype == "e2e.key_exchange":
                await _broadcast_async(room_id, {
                    "type": "e2e.key_exchange",
                    "room_id": room_id,
                    "from_user_id": data.get("from_user_id"),
                    "to_user_id": data.get("to_user_id"),
                    "public_key": data.get("public_key"),
                })

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("[ws/chat] error: %s", exc, exc_info=True)
    finally:
        await _unsubscribe(room_id, websocket)
        # Notify others that user left — but DON'T try to send to the
        # disconnecting socket itself (it's already closed). The
        # _broadcast_async function skips dead sockets automatically.
        try:
            await _broadcast_async(room_id, {
                "type": "member_online",
                "room_id": room_id,
                "members_online": get_online_count(room_id),
            })
        except Exception:
            pass
        # Don't call websocket.close() — it's already closed at this point
        # and calling close() again raises WebSocketDisconnect.
