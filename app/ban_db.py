"""
Ban / Unban storage module for the Samba AD DC Management API.

Provides PostgreSQL-backed storage of temporary or permanent bans
applied to **mgmt users** and **API keys**. A ban blocks the target
from authenticating against any `/api/v1/*` endpoint until the ban
expires or is removed.

Tables
------
``mgmt_bans``
    id              SERIAL PRIMARY KEY
    target_type     TEXT NOT NULL       -- 'user' | 'key'
    target_name     TEXT NOT NULL       -- username OR api-key prefix
    target_id       INTEGER             -- mgmt_users.id OR mgmt_api_keys.id
                                          (resolved at creation time; NULL if not found)
    reason          TEXT DEFAULT ''     -- free-form reason
    banned_by       TEXT DEFAULT ''     -- username of the admin who banned
    banned_by_ip    TEXT DEFAULT ''     -- IP of the admin
    created_at      TEXT NOT NULL       -- ISO-8601 UTC
    expires_at      TEXT                -- ISO-8601 UTC or NULL = permanent
    lifted_at       TEXT                -- ISO-8601 UTC or NULL (set on unban)
    lifted_by       TEXT
    lifted_reason   TEXT
    is_active       BOOLEAN DEFAULT TRUE

The combination (target_type, target_name, is_active=TRUE) is unique
via a partial index — you cannot have two active bans on the same
target at the same time. Re-banning after unban creates a new row
(the old row stays as historical record).

Bans auto-expire: ``is_active`` is flipped to FALSE by ``list_active_bans()``
or ``is_banned()`` when ``expires_at`` has passed. No background
worker is required.

v1.2.7_ban: Initial implementation.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Schema (appended to mgmt_db._SCHEMA via ban_db.ensure_schema) ──────

BAN_SCHEMA = """
CREATE TABLE IF NOT EXISTS mgmt_bans (
    id              SERIAL PRIMARY KEY,
    target_type     TEXT NOT NULL,
    target_name     TEXT NOT NULL,
    target_id       INTEGER,
    reason          TEXT DEFAULT '',
    banned_by       TEXT DEFAULT '',
    banned_by_ip    TEXT DEFAULT '',
    created_at      TEXT NOT NULL,
    expires_at      TEXT,
    lifted_at       TEXT,
    lifted_by       TEXT,
    lifted_reason   TEXT,
    is_active       BOOLEAN DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mgmt_bans_active
    ON mgmt_bans (target_type, target_name)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_mgmt_bans_target
    ON mgmt_bans (target_type, target_name);
CREATE INDEX IF NOT EXISTS idx_mgmt_bans_active
    ON mgmt_bans (is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_mgmt_bans_created
    ON mgmt_bans (created_at);
"""


def _now_iso() -> str:
    """Return current UTC time as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _get_conn():
    """Borrow a connection from the mgmt_db pool."""
    from app import mgmt_db
    return mgmt_db._get_conn()


def _return_conn(conn) -> None:
    """Return a borrowed connection to the mgmt_db pool."""
    from app import mgmt_db
    mgmt_db._return_conn(conn)


def ensure_schema() -> None:
    """Create the mgmt_bans table if it does not exist yet.

    Idempotent — safe to call on every server start.
    """
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(BAN_SCHEMA)
        conn.commit()
        logger.info("[BAN DB] Schema verified/created (mgmt_bans table)")
    except Exception as exc:
        conn.rollback()
        logger.error("[BAN DB] Failed to create schema: %s", exc)
        raise
    finally:
        _return_conn(conn)


# ═══════════════════════════════════════════════════════════════════════
# Target resolution helpers
# ═══════════════════════════════════════════════════════════════════════

def _resolve_target(target_type: str, target_name: str) -> Optional[int]:
    """Resolve a target_name to its numeric id in mgmt_users / mgmt_api_keys.

    Returns None if the target cannot be found (the ban can still be
    created — it will just match on name rather than id).
    """
    target_type = (target_type or "").lower().strip()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            if target_type == "user":
                cur.execute("SELECT id FROM mgmt_users WHERE username = %s", (target_name,))
            elif target_type == "key":
                # Accept either a full key (rare) or the stored key_prefix
                # (8-char prefix shown in management UI). Match on prefix.
                cur.execute(
                    "SELECT id FROM mgmt_api_keys WHERE key_prefix = %s ORDER BY id DESC LIMIT 1",
                    (target_name,),
                )
            else:
                return None
            row = cur.fetchone()
            return int(row[0]) if row else None
    except Exception as exc:
        logger.debug("[BAN DB] resolve_target(%s, %s) failed: %s", target_type, target_name, exc)
        return None
    finally:
        _return_conn(conn)


# ═══════════════════════════════════════════════════════════════════════
# Ban CRUD
# ═══════════════════════════════════════════════════════════════════════

def create_ban(
    target_type: str,
    target_name: str,
    reason: str = "",
    banned_by: str = "",
    banned_by_ip: str = "",
    duration_minutes: Optional[int] = None,
) -> Dict[str, Any]:
    """Create a new ban.

    Parameters
    ----------
    target_type : str
        ``"user"`` or ``"key"``.
    target_name : str
        Username (for ``user``) or API-key prefix (for ``key``).
    reason : str
        Free-form reason for the ban.
    banned_by : str
        Username of the admin performing the ban.
    banned_by_ip : str
        IP address of the admin.
    duration_minutes : int or None
        Ban duration in minutes. ``None`` (or ``0``) means **permanent**.

    Returns
    -------
    dict
        The newly created ban record.

    Raises
    ------
    ValueError
        If the target_type is invalid or there is already an active ban
        on the same target.
    """
    target_type = (target_type or "").lower().strip()
    if target_type not in ("user", "key"):
        raise ValueError(f"Invalid target_type: {target_type!r} (must be 'user' or 'key')")
    target_name = (target_name or "").strip()
    if not target_name:
        raise ValueError("target_name is required")

    # Auto-expire any prior active ban on the same target before creating
    # a new one — this makes "re-ban with new duration" idempotent.
    _auto_lift(target_type, target_name, lifted_by=banned_by or "system",
               lifted_reason="superseded by new ban")

    target_id = _resolve_target(target_type, target_name)
    now = _now_iso()
    expires_at: Optional[str] = None
    if duration_minutes and int(duration_minutes) > 0:
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=int(duration_minutes))).isoformat()

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO mgmt_bans
                  (target_type, target_name, target_id, reason,
                   banned_by, banned_by_ip, created_at, expires_at, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, TRUE)
                RETURNING id, target_type, target_name, target_id, reason,
                          banned_by, banned_by_ip, created_at, expires_at,
                          lifted_at, lifted_by, lifted_reason, is_active
                """,
                (target_type, target_name, target_id, reason,
                 banned_by, banned_by_ip, now, expires_at),
            )
            row = cur.fetchone()
        conn.commit()

        logger.info(
            "[BAN DB] Ban created: type=%s name=%s by=%s expires=%s reason=%r",
            target_type, target_name, banned_by, expires_at, reason,
        )
        return _row_to_dict(row)
    except Exception as exc:
        conn.rollback()
        logger.error("[BAN DB] create_ban failed: %s", exc)
        raise
    finally:
        _return_conn(conn)


def lift_ban(
    ban_id: Optional[int] = None,
    target_type: Optional[str] = None,
    target_name: Optional[str] = None,
    lifted_by: str = "",
    lifted_reason: str = "",
) -> Optional[Dict[str, Any]]:
    """Lift (unban) an active ban.

    Either ``ban_id`` OR (``target_type`` + ``target_name``) must be
    provided. If the ban is already expired/lifted, returns None.
    """
    if ban_id is None and not (target_type and target_name):
        raise ValueError("Either ban_id or (target_type + target_name) is required")

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            if ban_id is not None:
                cur.execute(
                    "SELECT id FROM mgmt_bans WHERE id = %s AND is_active = TRUE",
                    (ban_id,),
                )
            else:
                cur.execute(
                    "SELECT id FROM mgmt_bans "
                    "WHERE target_type = %s AND target_name = %s AND is_active = TRUE "
                    "ORDER BY id DESC LIMIT 1",
                    (target_type.lower().strip(), target_name.strip()),
                )
            row = cur.fetchone()
            if not row:
                return None
            bid = int(row[0])

            now = _now_iso()
            cur.execute(
                """
                UPDATE mgmt_bans
                SET is_active = FALSE, lifted_at = %s,
                    lifted_by = %s, lifted_reason = %s
                WHERE id = %s AND is_active = TRUE
                RETURNING id, target_type, target_name, target_id, reason,
                          banned_by, banned_by_ip, created_at, expires_at,
                          lifted_at, lifted_by, lifted_reason, is_active
                """,
                (now, lifted_by, lifted_reason, bid),
            )
            row = cur.fetchone()
        conn.commit()

        if row:
            logger.info(
                "[BAN DB] Ban lifted: id=%s by=%s reason=%r",
                bid, lifted_by, lifted_reason,
            )
            return _row_to_dict(row)
        return None
    except Exception as exc:
        conn.rollback()
        logger.error("[BAN DB] lift_ban failed: %s", exc)
        raise
    finally:
        _return_conn(conn)


def _auto_lift(target_type: str, target_name: str,
               lifted_by: str = "system",
               lifted_reason: str = "") -> None:
    """Internal: lift any active ban on the given target (used by re-ban)."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            now = _now_iso()
            cur.execute(
                """
                UPDATE mgmt_bans
                SET is_active = FALSE, lifted_at = %s,
                    lifted_by = %s, lifted_reason = %s
                WHERE target_type = %s AND target_name = %s AND is_active = TRUE
                """,
                (now, lifted_by, lifted_reason, target_type, target_name),
            )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.debug("[BAN DB] _auto_lift failed (non-fatal): %s", exc)
    finally:
        _return_conn(conn)


def get_ban(ban_id: int) -> Optional[Dict[str, Any]]:
    """Return a single ban record by id (active or historical)."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, target_type, target_name, target_id, reason,
                       banned_by, banned_by_ip, created_at, expires_at,
                       lifted_at, lifted_by, lifted_reason, is_active
                FROM mgmt_bans WHERE id = %s
                """,
                (ban_id,),
            )
            row = cur.fetchone()
        return _row_to_dict(row) if row else None
    except Exception as exc:
        logger.error("[BAN DB] get_ban failed: %s", exc)
        raise
    finally:
        _return_conn(conn)


def list_bans(
    active_only: bool = False,
    target_type: Optional[str] = None,
    target_name: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """List bans with optional filters. Newest first."""
    sql = """
        SELECT id, target_type, target_name, target_id, reason,
               banned_by, banned_by_ip, created_at, expires_at,
               lifted_at, lifted_by, lifted_reason, is_active
        FROM mgmt_bans
        WHERE 1=1
    """
    params: List[Any] = []
    if active_only:
        sql += " AND is_active = TRUE"
    if target_type:
        sql += " AND target_type = %s"
        params.append(target_type.lower().strip())
    if target_name:
        sql += " AND target_name = %s"
        params.append(target_name.strip())
    sql += " ORDER BY id DESC LIMIT %s OFFSET %s"
    params.extend([int(limit), int(offset)])

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception as exc:
        logger.error("[BAN DB] list_bans failed: %s", exc)
        raise
    finally:
        _return_conn(conn)


def count_active_bans() -> int:
    """Return the number of currently active bans."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM mgmt_bans WHERE is_active = TRUE")
            row = cur.fetchone()
            return int(row[0]) if row else 0
    except Exception as exc:
        logger.error("[BAN DB] count_active_bans failed: %s", exc)
        return 0
    finally:
        _return_conn(conn)


# ═══════════════════════════════════════════════════════════════════════
# Ban-check (used by auth middleware)
# ═══════════════════════════════════════════════════════════════════════

def is_banned(target_type: str, target_name: str) -> Optional[Dict[str, Any]]:
    """Check if a target is currently banned.

    Auto-expires any expired bans it encounters (lazy expiry).

    Returns
    -------
    dict or None
        The active ban record if the target is banned, else None.
    """
    if not target_type or not target_name:
        return None
    target_type = target_type.lower().strip()
    target_name = target_name.strip()

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # Lazy-expire: flip is_active=FALSE for expired bans
            now = _now_iso()
            cur.execute(
                """
                UPDATE mgmt_bans
                SET is_active = FALSE,
                    lifted_at = %s,
                    lifted_by = 'system',
                    lifted_reason = 'expired'
                WHERE is_active = TRUE
                  AND expires_at IS NOT NULL
                  AND expires_at < %s
                """,
                (now, now),
            )

            cur.execute(
                """
                SELECT id, target_type, target_name, target_id, reason,
                       banned_by, banned_by_ip, created_at, expires_at,
                       lifted_at, lifted_by, lifted_reason, is_active
                FROM mgmt_bans
                WHERE target_type = %s AND target_name = %s AND is_active = TRUE
                ORDER BY id DESC LIMIT 1
                """,
                (target_type, target_name),
            )
            row = cur.fetchone()
        conn.commit()
        return _row_to_dict(row) if row else None
    except Exception as exc:
        conn.rollback()
        logger.error("[BAN DB] is_banned failed: %s", exc)
        return None
    finally:
        _return_conn(conn)


def is_user_banned(username: str) -> Optional[Dict[str, Any]]:
    """Shortcut: check if a username is currently banned."""
    return is_banned("user", username)


def is_key_banned(key_prefix: str) -> Optional[Dict[str, Any]]:
    """Shortcut: check if an API-key prefix is currently banned."""
    return is_banned("key", key_prefix)


# ═══════════════════════════════════════════════════════════════════════
# Maintenance
# ═══════════════════════════════════════════════════════════════════════

def purge_history(older_than_days: int = 90) -> int:
    """Delete historical (inactive) bans older than N days. Returns count."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=int(older_than_days))).isoformat()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM mgmt_bans WHERE is_active = FALSE AND created_at < %s",
                (cutoff,),
            )
            n = cur.rowcount
        conn.commit()
        logger.info("[BAN DB] purge_history: deleted %d old bans", n)
        return n
    except Exception as exc:
        conn.rollback()
        logger.error("[BAN DB] purge_history failed: %s", exc)
        raise
    finally:
        _return_conn(conn)


def expire_due_bans() -> int:
    """Force-expire any active bans whose expires_at has passed.

    Called lazily by is_banned(), but can also be called explicitly
    by a cron / maintenance task. Returns the number flipped.
    """
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            now = _now_iso()
            cur.execute(
                """
                UPDATE mgmt_bans
                SET is_active = FALSE,
                    lifted_at = %s,
                    lifted_by = 'system',
                    lifted_reason = 'expired'
                WHERE is_active = TRUE
                  AND expires_at IS NOT NULL
                  AND expires_at < %s
                """,
                (now, now),
            )
            n = cur.rowcount
        conn.commit()
        return n
    except Exception as exc:
        conn.rollback()
        logger.error("[BAN DB] expire_due_bans failed: %s", exc)
        return 0
    finally:
        _return_conn(conn)


# ═══════════════════════════════════════════════════════════════════════
# Internal helpers
# ═══════════════════════════════════════════════════════════════════════

def _row_to_dict(row) -> Optional[Dict[str, Any]]:
    """Convert a psycopg2 row tuple to a dict using column names from cursor."""
    if row is None:
        return None
    cols = [
        "id", "target_type", "target_name", "target_id", "reason",
        "banned_by", "banned_by_ip", "created_at", "expires_at",
        "lifted_at", "lifted_by", "lifted_reason", "is_active",
    ]
    return {c: v for c, v in zip(cols, row)}
