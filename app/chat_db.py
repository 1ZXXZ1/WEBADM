"""
Chat system DB — tables, schema, and functions for user-to-user messaging.

v2.4: Provides a full-featured chat system with:
  - Direct (1:1) and group chats
  - Text messages with reply/forward
  - File attachments (up to 50 MB)
  - Voice messages (audio files + duration metadata)
  - Message search (ILIKE on text)
  - Read receipts (last_read_message_id per member)
  - Real-time delivery via WebSocket (/ws/chat/{room_id})
  - Member management (add/remove/promote)
  - Message edit/delete (soft delete)
  - Typing indicators (via WS only, not persisted)

Tables:
    chat_rooms        — chat metadata (type, name, owner)
    chat_members      — room membership (user_id, role, last_read)
    chat_messages     — messages (text, reply_to, attachments)
    chat_attachments  — file metadata (filename, size, mime, storage_path)

Storage:
    Files are saved under ``SHELL_PROJET_BASE_DIR/../chat-files/``
    (configurable via ``SAMBA_CHAT_FILE_DIR`` env var).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Schema ─────────────────────────────────────────────────────────────

CHAT_SCHEMA = """
CREATE TABLE IF NOT EXISTS chat_rooms (
    id              SERIAL PRIMARY KEY,
    type            TEXT NOT NULL DEFAULT 'direct',  -- 'direct' | 'group'
    name            TEXT DEFAULT '',
    description     TEXT DEFAULT '',
    owner_id        INTEGER,
    avatar_path     TEXT DEFAULT '',
    is_archived     BOOLEAN DEFAULT FALSE,
    created_at      TEXT,
    updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS chat_members (
    id              SERIAL PRIMARY KEY,
    room_id         INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL,
    username        TEXT DEFAULT '',
    role            TEXT DEFAULT 'member',
    last_read_msg_id INTEGER,
    is_muted        BOOLEAN DEFAULT FALSE,  -- v2.6: mute notifications
    joined_at       TEXT,
    UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id              SERIAL PRIMARY KEY,
    room_id         INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_id       INTEGER NOT NULL,
    sender_username TEXT DEFAULT '',
    text            TEXT DEFAULT '',
    msg_type        TEXT DEFAULT 'text',  -- v2.6: text/file/voice/image/video/system/call_log
    reply_to_id     INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
    forwarded_from_msg_id INTEGER,  -- v2.6: original message ID if forwarded
    forwarded_from_username TEXT DEFAULT '',  -- v2.6: original sender
    forwarded_from_room_id INTEGER,  -- v2.6: original room
    edited_at       TEXT,
    deleted_at      TEXT,
    is_pinned       BOOLEAN DEFAULT FALSE,
    scheduled_for   TEXT,  -- v2.6: ISO timestamp for scheduled messages (NULL = immediate)
    created_at      TEXT
);

CREATE TABLE IF NOT EXISTS chat_attachments (
    id              SERIAL PRIMARY KEY,
    message_id      INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    file_size       BIGINT DEFAULT 0,
    mime_type       TEXT DEFAULT 'application/octet-stream',
    storage_path    TEXT NOT NULL,
    is_voice        BOOLEAN DEFAULT FALSE,
    duration_sec    REAL DEFAULT 0,
    thumbnail_path  TEXT DEFAULT '',  -- v2.6: for image/video previews
    created_at      TEXT
);

-- v2.6: Reactions (emoji) on messages
CREATE TABLE IF NOT EXISTS chat_reactions (
    id              SERIAL PRIMARY KEY,
    message_id      INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL,
    username        TEXT DEFAULT '',
    emoji           TEXT NOT NULL,  -- e.g. '👍', '❤️', '😂'
    created_at      TEXT,
    UNIQUE(message_id, user_id, emoji)
);

-- v2.6: Starred/favorited messages
CREATE TABLE IF NOT EXISTS chat_stars (
    id              SERIAL PRIMARY KEY,
    message_id      INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL,
    created_at      TEXT,
    UNIQUE(message_id, user_id)
);

-- v2.6: Read-by tracking (who read each message)
CREATE TABLE IF NOT EXISTS chat_read_receipts (
    id              SERIAL PRIMARY KEY,
    message_id      INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL,
    username        TEXT DEFAULT '',
    read_at         TEXT,
    UNIQUE(message_id, user_id)
);

-- v2.6: Call participants (for multi-callee / group calls)
CREATE TABLE IF NOT EXISTS chat_call_participants (
    id              SERIAL PRIMARY KEY,
    call_id         INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    username        TEXT DEFAULT '',
    status          TEXT DEFAULT 'invited',  -- invited|joined|left|declined
    joined_at       TEXT,
    left_at         TEXT,
    UNIQUE(call_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_members_room ON chat_members(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_msg ON chat_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_reactions_msg ON chat_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_stars_user ON chat_stars(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_read_msg ON chat_read_receipts(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_calls_parts ON chat_call_participants(call_id);
"""

# ── File storage ───────────────────────────────────────────────────────

_file_dir: Optional[Path] = None
_file_dir_lock = threading.Lock()


def _get_file_dir() -> Path:
    """Return the directory for storing chat file attachments."""
    global _file_dir
    if _file_dir is not None:
        return _file_dir
    with _file_dir_lock:
        if _file_dir is not None:
            return _file_dir
        env_dir = os.environ.get("SAMBA_CHAT_FILE_DIR", "")
        if env_dir:
            p = Path(env_dir)
        else:
            # Default: next to shell-projets
            from app.config import get_settings
            s = get_settings()
            base = Path(getattr(s, "SHELL_PROJET_BASE_DIR", "/var/lib/webadc/shell-projets"))
            p = base.parent / "chat-files"
        p.mkdir(parents=True, exist_ok=True)
        _file_dir = p
        return p


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_conn():
    from app.mgmt_db import _get_conn as _mgmt_get_conn
    return _mgmt_get_conn()


def _return_conn(conn):
    from app.mgmt_db import _return_conn as _mgmt_return_conn
    _mgmt_return_conn(conn)


def ensure_schema() -> None:
    """Create chat tables if they don't exist. Called from main.py startup."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(CHAT_SCHEMA)
        conn.commit()
        logger.info("[chat] schema verified/created")
    except Exception as exc:
        conn.rollback()
        logger.debug("[chat] schema creation failed: %s", exc)
    finally:
        _return_conn(conn)


# ═══════════════════════════════════════════════════════════════════════
#  Chat Rooms
# ═══════════════════════════════════════════════════════════════════════

def create_room(
    room_type: str = "direct",
    name: str = "",
    description: str = "",
    owner_id: Optional[int] = None,
    member_ids: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """Create a new chat room and add initial members."""
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO chat_rooms (type, name, description, owner_id, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (room_type, name, description, owner_id, now, now),
            )
            room_id = cur.fetchone()[0]

            # Add members
            if member_ids:
                for uid in member_ids:
                    role = "admin" if uid == owner_id else "member"
                    # Resolve username
                    cur.execute("SELECT username FROM mgmt_users WHERE id = %s", (uid,))
                    row = cur.fetchone()
                    uname = row[0] if row else ""
                    cur.execute(
                        "INSERT INTO chat_members (room_id, user_id, username, role, joined_at) "
                        "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (room_id, user_id) DO NOTHING",
                        (room_id, uid, uname, role, now),
                    )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return get_room(room_id) or {"id": room_id, "type": room_type, "name": name}


def get_room(room_id: int) -> Optional[Dict[str, Any]]:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, type, name, description, owner_id, avatar_path, is_archived, created_at, updated_at "
                "FROM chat_rooms WHERE id = %s", (room_id,)
            )
            r = cur.fetchone()
            if not r:
                return None
            return {
                "id": r[0], "type": r[1], "name": r[2], "description": r[3],
                "owner_id": r[4], "avatar_path": r[5] or "",
                "is_archived": bool(r[6]), "created_at": r[7], "updated_at": r[8],
            }
    finally:
        _return_conn(conn)


def list_rooms(user_id: int, include_archived: bool = False) -> List[Dict[str, Any]]:
    """List all chat rooms the user is a member of."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cond = "WHERE m.user_id = %s" + ("" if include_archived else " AND r.is_archived = FALSE")
            cur.execute(
                f"SELECT r.id, r.type, r.name, r.description, r.owner_id, r.avatar_path, "
                f"r.is_archived, r.created_at, r.updated_at, m.role, m.last_read_msg_id "
                f"FROM chat_rooms r JOIN chat_members m ON m.room_id = r.id "
                f"{cond} ORDER BY r.updated_at DESC",
                (user_id,),
            )
            rows = cur.fetchall()
            return [
                {
                    "id": r[0], "type": r[1], "name": r[2], "description": r[3],
                    "owner_id": r[4], "avatar_path": r[5] or "",
                    "is_archived": bool(r[6]), "created_at": r[7], "updated_at": r[8],
                    "my_role": r[9], "last_read_msg_id": r[10],
                }
                for r in rows
            ]
    finally:
        _return_conn(conn)


def update_room(room_id: int, **kwargs: Any) -> Optional[Dict[str, Any]]:
    allowed = {"name", "description", "avatar_path", "is_archived"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return get_room(room_id)
    updates["updated_at"] = _now_iso()
    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [room_id]
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE chat_rooms SET {set_clause} WHERE id = %s", values)
            if cur.rowcount == 0:
                return None
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return get_room(room_id)


def delete_room(room_id: int) -> bool:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM chat_rooms WHERE id = %s", (room_id,))
            deleted = cur.rowcount > 0
        conn.commit()
        return deleted
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


# ═══════════════════════════════════════════════════════════════════════
#  Members
# ═══════════════════════════════════════════════════════════════════════

def list_members(room_id: int) -> List[Dict[str, Any]]:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, room_id, user_id, username, role, last_read_msg_id, joined_at "
                "FROM chat_members WHERE room_id = %s ORDER BY joined_at",
                (room_id,),
            )
            return [
                {"id": r[0], "room_id": r[1], "user_id": r[2], "username": r[3],
                 "role": r[4], "last_read_msg_id": r[5], "joined_at": r[6]}
                for r in cur.fetchall()
            ]
    finally:
        _return_conn(conn)


def add_member(room_id: int, user_id: int, role: str = "member") -> Dict[str, Any]:
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT username FROM mgmt_users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise ValueError(f"User {user_id} not found")
            username = row[0]
            cur.execute(
                "INSERT INTO chat_members (room_id, user_id, username, role, joined_at) "
                "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (room_id, user_id) DO UPDATE SET role = %s "
                "RETURNING id",
                (room_id, user_id, username, role, now, role),
            )
            mid = cur.fetchone()[0]
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return {"id": mid, "room_id": room_id, "user_id": user_id, "username": username, "role": role}


def remove_member(room_id: int, user_id: int) -> bool:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM chat_members WHERE room_id = %s AND user_id = %s", (room_id, user_id))
            deleted = cur.rowcount > 0
        conn.commit()
        return deleted
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


def is_member(room_id: int, user_id: int) -> bool:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM chat_members WHERE room_id = %s AND user_id = %s", (room_id, user_id))
            return cur.fetchone() is not None
    finally:
        _return_conn(conn)


def mark_read(room_id: int, user_id: int, message_id: int) -> bool:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE chat_members SET last_read_msg_id = %s WHERE room_id = %s AND user_id = %s",
                (message_id, room_id, user_id),
            )
            found = cur.rowcount > 0
        conn.commit()
        return found
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


# ═══════════════════════════════════════════════════════════════════════
#  Messages
# ═══════════════════════════════════════════════════════════════════════

def send_message(
    room_id: int, sender_id: int, sender_username: str,
    text: str = "", reply_to_id: Optional[int] = None,
) -> Dict[str, Any]:
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO chat_messages (room_id, sender_id, sender_username, text, reply_to_id, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (room_id, sender_id, sender_username, text, reply_to_id, now),
            )
            msg_id = cur.fetchone()[0]
            # Bump room updated_at
            cur.execute("UPDATE chat_rooms SET updated_at = %s WHERE id = %s", (now, room_id))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return get_message(msg_id) or {"id": msg_id, "room_id": room_id, "text": text}


def get_message(msg_id: int) -> Optional[Dict[str, Any]]:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, room_id, sender_id, sender_username, text, reply_to_id, "
                "edited_at, deleted_at, is_pinned, created_at "
                "FROM chat_messages WHERE id = %s", (msg_id,)
            )
            r = cur.fetchone()
            if not r:
                return None
            return {
                "id": r[0], "room_id": r[1], "sender_id": r[2], "sender_username": r[3],
                "text": r[4] or "", "reply_to_id": r[5], "edited_at": r[6],
                "deleted_at": r[7], "is_pinned": bool(r[8]), "created_at": r[9],
            }
    finally:
        _return_conn(conn)


def list_messages(
    room_id: int, offset: int = 0, limit: int = 50,
    before_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """List messages in a room, newest first (pagination by before_id)."""
    conditions = ["room_id = %s"]
    params: list = [room_id]
    if before_id is not None:
        conditions.append("id < %s")
        params.append(before_id)
    where = " AND ".join(conditions)
    params.extend([limit, offset])

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT m.id, m.room_id, m.sender_id, m.sender_username, m.text, "
                f"m.reply_to_id, m.edited_at, m.deleted_at, m.is_pinned, m.created_at "
                f"FROM chat_messages m WHERE {where} "
                f"ORDER BY m.id DESC LIMIT %s OFFSET %s",
                params,
            )
            rows = cur.fetchall()
            results = []
            for r in rows:
                msg = {
                    "id": r[0], "room_id": r[1], "sender_id": r[2], "sender_username": r[3],
                    "text": r[4] or "", "reply_to_id": r[5], "edited_at": r[6],
                    "deleted_at": r[7], "is_pinned": bool(r[8]), "created_at": r[9],
                }
                # Fetch attachments for this message
                cur.execute(
                    "SELECT id, filename, file_size, mime_type, is_voice, duration_sec "
                    "FROM chat_attachments WHERE message_id = %s",
                    (r[0],),
                )
                atts = cur.fetchall()
                msg["attachments"] = [
                    {"id": a[0], "filename": a[1], "file_size": a[2], "mime_type": a[3],
                     "is_voice": bool(a[4]), "duration_sec": a[5]}
                    for a in atts
                ]
                results.append(msg)
            return results
    finally:
        _return_conn(conn)


def edit_message(msg_id: int, new_text: str) -> Optional[Dict[str, Any]]:
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE chat_messages SET text = %s, edited_at = %s WHERE id = %s AND deleted_at IS NULL",
                (new_text, now, msg_id),
            )
            if cur.rowcount == 0:
                return None
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return get_message(msg_id)


def delete_message(msg_id: int) -> bool:
    """Soft delete (sets deleted_at, clears text)."""
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE chat_messages SET deleted_at = %s, text = '' WHERE id = %s AND deleted_at IS NULL",
                (now, msg_id),
            )
            found = cur.rowcount > 0
        conn.commit()
        return found
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


def search_messages(user_id: int, query: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Search messages across all rooms the user is a member of."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT m.id, m.room_id, m.sender_id, m.sender_username, m.text, "
                "m.created_at, r.name as room_name "
                "FROM chat_messages m "
                "JOIN chat_members mem ON mem.room_id = m.room_id AND mem.user_id = %s "
                "JOIN chat_rooms r ON r.id = m.room_id "
                "WHERE m.text ILIKE %s AND m.deleted_at IS NULL "
                "ORDER BY m.id DESC LIMIT %s",
                (user_id, f"%{query}%", limit),
            )
            rows = cur.fetchall()
            return [
                {"id": r[0], "room_id": r[1], "sender_id": r[2], "sender_username": r[3],
                 "text": r[4], "created_at": r[5], "room_name": r[6]}
                for r in rows
            ]
    finally:
        _return_conn(conn)


# ═══════════════════════════════════════════════════════════════════════
#  File Attachments
# ═══════════════════════════════════════════════════════════════════════

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


def save_attachment(
    message_id: int, filename: str, data: bytes, mime_type: str = "",
    is_voice: bool = False, duration_sec: float = 0,
) -> Dict[str, Any]:
    """Save a file attachment to disk and record in DB."""
    now = _now_iso()
    # Generate unique storage filename
    ext = Path(filename).suffix
    stored_name = secrets.token_hex(16) + ext
    storage_path = _get_file_dir() / stored_name
    storage_path.write_bytes(data)

    file_size = len(data)
    rel_path = str(storage_path)

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO chat_attachments (message_id, filename, file_size, mime_type, storage_path, is_voice, duration_sec, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (message_id, filename, file_size, mime_type, rel_path, is_voice, duration_sec, now),
            )
            att_id = cur.fetchone()[0]
        conn.commit()
    except Exception:
        conn.rollback()
        # Clean up file on DB error
        try:
            storage_path.unlink()
        except OSError:
            pass
        raise
    finally:
        _return_conn(conn)

    return {
        "id": att_id, "message_id": message_id, "filename": filename,
        "file_size": file_size, "mime_type": mime_type,
        "is_voice": is_voice, "duration_sec": duration_sec,
        "storage_path": rel_path,
    }


def get_attachment(att_id: int) -> Optional[Dict[str, Any]]:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, message_id, filename, file_size, mime_type, storage_path, is_voice, duration_sec "
                "FROM chat_attachments WHERE id = %s", (att_id,)
            )
            r = cur.fetchone()
            if not r:
                return None
            return {
                "id": r[0], "message_id": r[1], "filename": r[2], "file_size": r[3],
                "mime_type": r[4], "storage_path": r[5], "is_voice": bool(r[6]),
                "duration_sec": r[7],
            }
    finally:
        _return_conn(conn)


# ═══════════════════════════════════════════════════════════════════════
#  v2.6: Reactions, Stars, Read-by, Forward, Pin, Online, Mute, Stats
# ═══════════════════════════════════════════════════════════════════════

def add_reaction(message_id: int, user_id: int, username: str, emoji: str) -> Dict[str, Any]:
    """Add or toggle an emoji reaction on a message."""
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # Check if reaction exists → toggle (remove if exists)
            cur.execute(
                "SELECT id FROM chat_reactions WHERE message_id = %s AND user_id = %s AND emoji = %s",
                (message_id, user_id, emoji),
            )
            existing = cur.fetchone()
            if existing:
                cur.execute("DELETE FROM chat_reactions WHERE id = %s", (existing[0],))
                conn.commit()
                return {"message_id": message_id, "emoji": emoji, "action": "removed"}
            cur.execute(
                "INSERT INTO chat_reactions (message_id, user_id, username, emoji, created_at) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (message_id, user_id, username, emoji, now),
            )
            rid = cur.fetchone()[0]
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return {"id": rid, "message_id": message_id, "user_id": user_id, "username": username,
            "emoji": emoji, "action": "added"}


def list_reactions(message_id: int) -> List[Dict[str, Any]]:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, user_id, username, emoji, created_at "
                "FROM chat_reactions WHERE message_id = %s ORDER BY created_at",
                (message_id,),
            )
            return [
                {"id": r[0], "user_id": r[1], "username": r[2], "emoji": r[3], "created_at": r[4]}
                for r in cur.fetchall()
            ]
    finally:
        _return_conn(conn)


def toggle_star(message_id: int, user_id: int) -> Dict[str, Any]:
    """Star or unstar a message."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM chat_stars WHERE message_id = %s AND user_id = %s",
                (message_id, user_id),
            )
            existing = cur.fetchone()
            if existing:
                cur.execute("DELETE FROM chat_stars WHERE id = %s", (existing[0],))
                conn.commit()
                return {"message_id": message_id, "starred": False}
            cur.execute(
                "INSERT INTO chat_stars (message_id, user_id, created_at) VALUES (%s, %s, %s)",
                (message_id, user_id, _now_iso()),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return {"message_id": message_id, "starred": True}


def list_starred(user_id: int, limit: int = 50) -> List[Dict[str, Any]]:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT m.id, m.room_id, m.sender_id, m.sender_username, m.text, m.created_at, s.created_at as starred_at "
                "FROM chat_stars s JOIN chat_messages m ON m.id = s.message_id "
                "WHERE s.user_id = %s ORDER BY s.created_at DESC LIMIT %s",
                (user_id, limit),
            )
            return [
                {"id": r[0], "room_id": r[1], "sender_id": r[2], "sender_username": r[3],
                 "text": r[4], "created_at": r[5], "starred_at": r[6]}
                for r in cur.fetchall()
            ]
    finally:
        _return_conn(conn)


def mark_message_read(message_id: int, user_id: int, username: str) -> bool:
    """Record that a user has read a specific message (for read-by list)."""
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO chat_read_receipts (message_id, user_id, username, read_at) "
                "VALUES (%s, %s, %s, %s) ON CONFLICT (message_id, user_id) DO NOTHING",
                (message_id, user_id, username, now),
            )
            inserted = cur.rowcount > 0
        conn.commit()
        return inserted
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


def get_read_by(message_id: int) -> List[Dict[str, Any]]:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, username, read_at FROM chat_read_receipts WHERE message_id = %s ORDER BY read_at",
                (message_id,),
            )
            return [
                {"user_id": r[0], "username": r[1], "read_at": r[2]}
                for r in cur.fetchall()
            ]
    finally:
        _return_conn(conn)


def pin_message(message_id: int, pinned: bool = True) -> Optional[Dict[str, Any]]:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE chat_messages SET is_pinned = %s WHERE id = %s AND deleted_at IS NULL",
                (pinned, message_id),
            )
            if cur.rowcount == 0:
                return None
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return get_message(message_id)


def get_pinned_messages(room_id: int) -> List[Dict[str, Any]]:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM chat_messages WHERE room_id = %s AND is_pinned = TRUE AND deleted_at IS NULL ORDER BY id",
                (room_id,),
            )
            ids = [r[0] for r in cur.fetchall()]
        results = []
        for mid in ids:
            msg = get_message(mid)
            if msg:
                results.append(msg)
        return results
    finally:
        _return_conn(conn)


def forward_message(
    msg_id: int, target_room_id: int, sender_id: int, sender_username: str,
) -> Optional[Dict[str, Any]]:
    """Forward a message to another room."""
    original = get_message(msg_id)
    if not original:
        return None
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO chat_messages (room_id, sender_id, sender_username, text, msg_type, "
                "forwarded_from_msg_id, forwarded_from_username, forwarded_from_room_id, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (target_room_id, sender_id, sender_username, original["text"],
                 original.get("msg_type", "text"), msg_id,
                 original.get("sender_username", ""), original.get("room_id"), now),
            )
            new_id = cur.fetchone()[0]
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return get_message(new_id)


def set_mute(room_id: int, user_id: int, muted: bool) -> bool:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE chat_members SET is_muted = %s WHERE room_id = %s AND user_id = %s",
                (muted, room_id, user_id),
            )
            found = cur.rowcount > 0
        conn.commit()
        return found
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


def get_unread_counts(user_id: int) -> Dict[int, int]:
    """Return {room_id: unread_count} for all rooms the user is in."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT m.room_id, m.last_read_msg_id FROM chat_members m WHERE m.user_id = %s",
                (user_id,),
            )
            rows = cur.fetchall()
            result = {}
            for room_id, last_read in rows:
                if last_read is None:
                    cur.execute(
                        "SELECT COUNT(*) FROM chat_messages WHERE room_id = %s AND deleted_at IS NULL",
                        (room_id,),
                    )
                else:
                    cur.execute(
                        "SELECT COUNT(*) FROM chat_messages WHERE room_id = %s AND id > %s AND deleted_at IS NULL",
                        (room_id, last_read),
                    )
                result[room_id] = cur.fetchone()[0] or 0
            return result
    finally:
        _return_conn(conn)


def schedule_message(
    room_id: int, sender_id: int, sender_username: str,
    text: str, scheduled_for: str, reply_to_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Create a scheduled message (will be sent at scheduled_for time)."""
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO chat_messages (room_id, sender_id, sender_username, text, reply_to_id, "
                "scheduled_for, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (room_id, sender_id, sender_username, text, reply_to_id, scheduled_for, now),
            )
            msg_id = cur.fetchone()[0]
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return get_message(msg_id) or {"id": msg_id, "scheduled_for": scheduled_for}


def get_scheduled_messages(user_id: int) -> List[Dict[str, Any]]:
    """List pending scheduled messages for a user."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, room_id, sender_id, sender_username, text, scheduled_for, created_at "
                "FROM chat_messages WHERE sender_id = %s AND scheduled_for IS NOT NULL "
                "AND scheduled_for > %s ORDER BY scheduled_for",
                (user_id, _now_iso()),
            )
            return [
                {"id": r[0], "room_id": r[1], "sender_id": r[2], "sender_username": r[3],
                 "text": r[4], "scheduled_for": r[5], "created_at": r[6]}
                for r in cur.fetchall()
            ]
    finally:
        _return_conn(conn)


def delete_scheduled_message(msg_id: int, user_id: int) -> bool:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM chat_messages WHERE id = %s AND sender_id = %s AND scheduled_for IS NOT NULL",
                (msg_id, user_id),
            )
            deleted = cur.rowcount > 0
        conn.commit()
        return deleted
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


def get_chat_stats() -> Dict[str, Any]:
    """Chat statistics for dashboard."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM chat_rooms")
            rooms = cur.fetchone()[0] or 0
            cur.execute("SELECT COUNT(*) FROM chat_messages WHERE deleted_at IS NULL")
            messages = cur.fetchone()[0] or 0
            cur.execute("SELECT COUNT(*) FROM chat_attachments")
            files = cur.fetchone()[0] or 0
            cur.execute("SELECT COUNT(*) FROM chat_messages WHERE scheduled_for IS NOT NULL AND scheduled_for > %s", (_now_iso(),))
            scheduled = cur.fetchone()[0] or 0
            cur.execute("SELECT COUNT(*) FROM chat_stars")
            stars = cur.fetchone()[0] or 0
        return {
            "rooms": rooms, "messages": messages, "files": files,
            "scheduled_pending": scheduled, "stars": stars,
        }
    finally:
        _return_conn(conn)


def cleanup_deleted_files() -> int:
    """Remove files from disk for messages that have been deleted.
    Returns count of files removed."""
    removed = 0
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT a.id, a.storage_path FROM chat_attachments a "
                "JOIN chat_messages m ON m.id = a.message_id "
                "WHERE m.deleted_at IS NOT NULL",
            )
            rows = cur.fetchall()
        for att_id, path in rows:
            try:
                if os.path.isfile(path):
                    os.remove(path)
                    removed += 1
            except OSError:
                pass
    finally:
        _return_conn(conn)
    return removed


def retention_delete_old(days: int = 90) -> int:
    """Soft-delete messages older than N days. Returns count."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE chat_messages SET deleted_at = %s, text = '' "
                "WHERE created_at < %s AND deleted_at IS NULL",
                (now, cutoff),
            )
            count = cur.rowcount
        conn.commit()
        return count
    except Exception:
        conn.rollback()
        return 0
    finally:
        _return_conn(conn)
