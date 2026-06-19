"""
Chat calls DB — voice and video calls via WebRTC.

v2.5: Adds call support to the chat system:
  - Initiate a call (1:1 or group)
  - Accept / reject / end
  - WebRTC signaling (offer/answer/ICE candidates) via WebSocket
  - Call history with duration

Tables:
    chat_calls — call metadata (room, caller, type, status, duration)
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

CALL_SCHEMA = """
CREATE TABLE IF NOT EXISTS chat_calls (
    id              SERIAL PRIMARY KEY,
    room_id         INTEGER NOT NULL,
    caller_id       INTEGER NOT NULL,
    caller_username TEXT DEFAULT '',
    callee_id       INTEGER,
    callee_username TEXT DEFAULT '',
    call_type       TEXT NOT NULL DEFAULT 'audio',  -- 'audio' | 'video'
    status          TEXT NOT NULL DEFAULT 'ringing', -- 'ringing'|'accepted'|'rejected'|'ended'|'missed'|'cancelled'
    started_at      TEXT,
    ended_at        TEXT,
    duration_sec    REAL DEFAULT 0,
    created_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_calls_room ON chat_calls(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_calls_callee ON chat_calls(callee_id);
CREATE INDEX IF NOT EXISTS idx_chat_calls_status ON chat_calls(status);
"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_conn():
    from app.mgmt_db import _get_conn as _mgmt_get_conn
    return _mgmt_get_conn()


def _return_conn(conn):
    from app.mgmt_db import _return_conn as _mgmt_return_conn
    _mgmt_return_conn(conn)


def ensure_schema() -> None:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(CALL_SCHEMA)
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.debug("[chat_calls] schema creation failed: %s", exc)
    finally:
        _return_conn(conn)


# ═══════════════════════════════════════════════════════════════════════
#  Call lifecycle
# ═══════════════════════════════════════════════════════════════════════

def initiate_call(
    room_id: int, caller_id: int, caller_username: str,
    callee_id: Optional[int] = None, callee_username: str = "",
    call_type: str = "audio",
) -> Dict[str, Any]:
    """Initiate a new call. Returns the call record."""
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO chat_calls (room_id, caller_id, caller_username, "
                "callee_id, callee_username, call_type, status, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, 'ringing', %s) RETURNING id",
                (room_id, caller_id, caller_username, callee_id, callee_username,
                 call_type, now),
            )
            call_id = cur.fetchone()[0]
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return get_call(call_id) or {"id": call_id, "status": "ringing"}


def get_call(call_id: int) -> Optional[Dict[str, Any]]:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, room_id, caller_id, caller_username, callee_id, "
                "callee_username, call_type, status, started_at, ended_at, "
                "duration_sec, created_at "
                "FROM chat_calls WHERE id = %s", (call_id,)
            )
            r = cur.fetchone()
            if not r:
                return None
            return {
                "id": r[0], "room_id": r[1], "caller_id": r[2], "caller_username": r[3],
                "callee_id": r[4], "callee_username": r[5], "call_type": r[6],
                "status": r[7], "started_at": r[8], "ended_at": r[9],
                "duration_sec": r[10] or 0, "created_at": r[11],
            }
    finally:
        _return_conn(conn)


def update_call_status(call_id: int, status: str) -> Optional[Dict[str, Any]]:
    """Update call status. Handles timing:
      - 'accepted' → set started_at
      - 'ended' → set ended_at + compute duration_sec
      - 'rejected'/'cancelled'/'missed' → just set status
    """
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            if status == "accepted":
                cur.execute(
                    "UPDATE chat_calls SET status = 'accepted', started_at = %s WHERE id = %s",
                    (now, call_id),
                )
            elif status == "ended":
                # Compute duration from started_at
                cur.execute(
                    "UPDATE chat_calls SET status = 'ended', ended_at = %s, "
                    "duration_sec = EXTRACT(EPOCH FROM (%s::timestamp - started_at::timestamp)) "
                    "WHERE id = %s AND started_at IS NOT NULL",
                    (now, now, call_id),
                )
                if cur.rowcount == 0:
                    # No started_at — just set ended
                    cur.execute(
                        "UPDATE chat_calls SET status = 'ended', ended_at = %s WHERE id = %s",
                        (now, call_id),
                    )
            else:
                cur.execute(
                    "UPDATE chat_calls SET status = %s WHERE id = %s",
                    (status, call_id),
                )
            if cur.rowcount == 0:
                return None
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return get_call(call_id)


def list_calls(
    room_id: Optional[int] = None, user_id: Optional[int] = None,
    status: Optional[str] = None, limit: int = 50,
) -> List[Dict[str, Any]]:
    """List calls, optionally filtered by room/user/status."""
    conditions = []
    params: list = []
    if room_id is not None:
        conditions.append("room_id = %s")
        params.append(room_id)
    if user_id is not None:
        conditions.append("(caller_id = %s OR callee_id = %s)")
        params.extend([user_id, user_id])
    if status is not None:
        conditions.append("status = %s")
        params.append(status)
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.append(limit)
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, room_id, caller_id, caller_username, callee_id, "
                f"callee_username, call_type, status, started_at, ended_at, "
                f"duration_sec, created_at "
                f"FROM chat_calls {where} ORDER BY id DESC LIMIT %s",
                params,
            )
            return [
                {
                    "id": r[0], "room_id": r[1], "caller_id": r[2], "caller_username": r[3],
                    "callee_id": r[4], "callee_username": r[5], "call_type": r[6],
                    "status": r[7], "started_at": r[8], "ended_at": r[9],
                    "duration_sec": r[10] or 0, "created_at": r[11],
                }
                for r in cur.fetchall()
            ]
    finally:
        _return_conn(conn)
