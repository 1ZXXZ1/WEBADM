"""
PostgreSQL-backed Management DB for API users, keys, roles, audit log, and AI chat.

v1.8.5-2: Replaced JSON-file-based storage with PostgreSQL.
Uses psycopg2 with ThreadedConnectionPool for thread-safe access.
All data survives server restarts.

Tables:
    mgmt_users       — API user accounts with bcrypt-hashed passwords
    mgmt_api_keys    — Long-lived bearer tokens tied to users
    mgmt_roles       — Named roles with assigned permission sets
    mgmt_audit_log   — Tamper-append log of every authenticated action
    ai_chat_sessions — AI chat session metadata
    ai_chat_messages — Individual chat messages with cost/usage tracking
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Module-level DB connection pool ──────────────────────────────────────

_pool: Optional[Any] = None  # psycopg2.pool.ThreadedConnectionPool
_pool_lock = threading.Lock()


def init_db(
    host: str = "localhost",
    port: int = 5432,
    dbname: str = "samba_api",
    user: str = "samba_api",
    password: str = "",
    dsn: Optional[str] = None,
    min_conn: int = 2,
    max_conn: int = 10,
) -> None:
    """Initialize the PostgreSQL connection pool and create tables if needed."""
    global _pool

    try:
        import psycopg2
        from psycopg2.pool import ThreadedConnectionPool
    except ImportError:
        raise ImportError(
            "psycopg2 is required for PostgreSQL management DB. "
            "Install with: apt-get install python3-psycopg2 (ALT Linux) "
            "or pip install psycopg2-binary"
        )

    _connect_kwargs: Dict[str, Any] = {}
    if dsn:
        _connect_kwargs = {"dsn": dsn}
    else:
        _connect_kwargs = {
            "host": host,
            "port": port,
            "dbname": dbname,
            "user": user,
            "password": password,
        }

    try:
        _pool = ThreadedConnectionPool(min_conn, max_conn, **_connect_kwargs)
        logger.info("[MGMT DB] PostgreSQL connection pool created (min=%d, max=%d)", min_conn, max_conn)
    except Exception as exc:
        logger.error("[MGMT DB] Failed to create PostgreSQL pool: %s", exc)
        raise

    # Create tables
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(_SCHEMA)
            # v2.2 migrations: add weight / is_active columns to existing tables
            _apply_migrations(cur)
        conn.commit()
        logger.info("[MGMT DB] Tables verified/created in PostgreSQL")
    except Exception as exc:
        conn.rollback()
        logger.error("[MGMT DB] Failed to create tables: %s", exc)
        raise
    finally:
        _return_conn(conn)

    # Seed default admin user and roles if tables are empty
    _seed_defaults()


def _apply_migrations(cur) -> None:
    """Apply incremental schema migrations (idempotent).

    v2.2:
      - Add ``weight INTEGER DEFAULT 0`` to mgmt_users, mgmt_api_keys, mgmt_roles.
      - Add ``is_active BOOLEAN DEFAULT TRUE`` to mgmt_roles (so roles can be
        enabled/disabled the same way users and keys can).
      - Add ``last_login_at TEXT`` to mgmt_users (audit/UX convenience).
      - Add ``login_count INTEGER DEFAULT 0`` to mgmt_users.

    Each migration uses ``ADD COLUMN IF NOT EXISTS`` so it is safe to run
    on both fresh and upgraded databases.
    """
    migrations = [
        # weight columns — used for ordering / priority in UI and resolution
        "ALTER TABLE mgmt_users    ADD COLUMN IF NOT EXISTS weight INTEGER DEFAULT 0",
        "ALTER TABLE mgmt_api_keys ADD COLUMN IF NOT EXISTS weight INTEGER DEFAULT 0",
        "ALTER TABLE mgmt_roles    ADD COLUMN IF NOT EXISTS weight INTEGER DEFAULT 0",
        # is_active on roles — allows disabling a role without deleting it
        "ALTER TABLE mgmt_roles    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
        # audit / UX convenience for users
        "ALTER TABLE mgmt_users    ADD COLUMN IF NOT EXISTS last_login_at TEXT",
        "ALTER TABLE mgmt_users    ADD COLUMN IF NOT EXISTS login_count INTEGER DEFAULT 0",
        # convenient search index
        "CREATE INDEX IF NOT EXISTS idx_mgmt_roles_active ON mgmt_roles(is_active)",
        "CREATE INDEX IF NOT EXISTS idx_mgmt_users_active ON mgmt_users(is_active)",
        "CREATE INDEX IF NOT EXISTS idx_mgmt_users_role   ON mgmt_users(role)",
        # v2.3.2: Rich audit log — added columns for HTTP context + semantic events
        "ALTER TABLE mgmt_audit_log ADD COLUMN IF NOT EXISTS username TEXT DEFAULT ''",
        "ALTER TABLE mgmt_audit_log ADD COLUMN IF NOT EXISTS method TEXT DEFAULT ''",
        "ALTER TABLE mgmt_audit_log ADD COLUMN IF NOT EXISTS status_code INTEGER",
        "ALTER TABLE mgmt_audit_log ADD COLUMN IF NOT EXISTS duration_ms INTEGER",
        "ALTER TABLE mgmt_audit_log ADD COLUMN IF NOT EXISTS user_agent TEXT DEFAULT ''",
        "ALTER TABLE mgmt_audit_log ADD COLUMN IF NOT EXISTS request_body TEXT DEFAULT ''",
        "ALTER TABLE mgmt_audit_log ADD COLUMN IF NOT EXISTS auth_method TEXT DEFAULT ''",
        "ALTER TABLE mgmt_audit_log ADD COLUMN IF NOT EXISTS event_type TEXT DEFAULT ''",
        "CREATE INDEX IF NOT EXISTS idx_mgmt_audit_event      ON mgmt_audit_log(event_type)",
        "CREATE INDEX IF NOT EXISTS idx_mgmt_audit_user       ON mgmt_audit_log(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_mgmt_audit_auth_method ON mgmt_audit_log(auth_method)",
    ]
    for stmt in migrations:
        try:
            cur.execute(stmt)
        except Exception as exc:  # noqa: BLE001
            logger.debug("[MGMT DB] migration skipped: %s | stmt=%s", exc, stmt[:80])


def _get_conn():
    """Get a connection from the pool."""
    if _pool is None:
        raise RuntimeError(
            "mgmt_db not initialized — call init_db() first. "
            "Set SAMBA_SHELL_PROJET_PG_* environment variables."
        )
    return _pool.getconn()


def _return_conn(conn) -> None:
    """Return a connection to the pool."""
    if _pool is not None and conn is not None:
        try:
            _pool.putconn(conn)
        except Exception:
            pass


def close_db() -> None:
    """Close all connections in the pool."""
    global _pool
    if _pool is not None:
        try:
            _pool.closeall()
        except Exception:
            pass
        _pool = None
        logger.info("[MGMT DB] PostgreSQL connection pool closed")


def _now_iso() -> str:
    """Return current UTC time as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


# ── Schema (PostgreSQL) ─────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS mgmt_users (
    id              SERIAL PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    full_name       TEXT DEFAULT '',
    email           TEXT DEFAULT '',
    role            TEXT NOT NULL DEFAULT 'operator',
    is_active       BOOLEAN DEFAULT TRUE,
    weight          INTEGER DEFAULT 0,
    last_login_at   TEXT,
    login_count     INTEGER DEFAULT 0,
    created_at      TEXT,
    updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS mgmt_api_keys (
    id              SERIAL PRIMARY KEY,
    key_hash        TEXT NOT NULL,
    key_prefix      TEXT NOT NULL,
    user_id         INTEGER NOT NULL REFERENCES mgmt_users(id) ON DELETE CASCADE,
    name            TEXT DEFAULT '',
    description     TEXT DEFAULT '',
    role            TEXT NOT NULL DEFAULT 'operator',
    is_active       BOOLEAN DEFAULT TRUE,
    weight          INTEGER DEFAULT 0,
    expires_at      TEXT,
    created_at      TEXT,
    last_used_at    TEXT
);

CREATE TABLE IF NOT EXISTS mgmt_roles (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    description     TEXT DEFAULT '',
    permissions     JSONB DEFAULT '[]',
    is_builtin      BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT TRUE,
    weight          INTEGER DEFAULT 0,
    created_at      TEXT,
    updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS mgmt_audit_log (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER,
    api_key_id      INTEGER,
    action          TEXT NOT NULL,
    endpoint        TEXT DEFAULT '',
    ip_address      TEXT DEFAULT '',
    timestamp       TEXT,
    details         TEXT
);

CREATE TABLE IF NOT EXISTS ai_chat_sessions (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL DEFAULT 'New Chat',
    owner_id        TEXT NOT NULL,
    owner_username  TEXT DEFAULT '',
    model           TEXT DEFAULT '',
    system_prompt   TEXT DEFAULT '',
    context         JSONB DEFAULT '{}',
    is_archived     BOOLEAN DEFAULT FALSE,
    created_at      TEXT,
    updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id              TEXT PRIMARY KEY,
    chat_id         TEXT NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT DEFAULT '',
    model_used      TEXT,
    tokens_used     INTEGER,
    cost_rub        REAL,
    usage_info      JSONB,
    tool_steps      JSONB,
    timestamp       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mgmt_users_username ON mgmt_users(username);
CREATE INDEX IF NOT EXISTS idx_mgmt_api_keys_prefix ON mgmt_api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_mgmt_api_keys_user ON mgmt_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_mgmt_audit_timestamp ON mgmt_audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_owner ON ai_chat_sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_chat ON ai_chat_messages(chat_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_timestamp ON ai_chat_messages(timestamp);
"""


def _seed_defaults() -> None:
    """Seed default admin user and built-in roles if tables are empty."""
    import bcrypt

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # Check if admin user exists
            cur.execute("SELECT COUNT(*) FROM mgmt_users WHERE username = 'admin'")
            if cur.fetchone()[0] == 0:
                hashed = bcrypt.hashpw("admin".encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
                now = _now_iso()
                cur.execute(
                    "INSERT INTO mgmt_users (username, password_hash, full_name, role, is_active, created_at, updated_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    ("admin", hashed, "Default Administrator", "admin", True, now, now),
                )
                logger.info("[MGMT DB] Created default admin user (password: admin)")

            # Seed built-in roles
            try:
                from app.permissions import DEFAULT_ROLE_PERMISSIONS
                default_perms = DEFAULT_ROLE_PERMISSIONS
            except ImportError:
                default_perms = {
                    "admin": set(),
                    "operator": set(),
                    "auditor": set(),
                }

            for rname, perms in default_perms.items():
                cur.execute("SELECT COUNT(*) FROM mgmt_roles WHERE name = %s", (rname,))
                if cur.fetchone()[0] == 0:
                    now = _now_iso()
                    cur.execute(
                        "INSERT INTO mgmt_roles (name, description, permissions, is_builtin, created_at, updated_at) "
                        "VALUES (%s, %s, %s, %s, %s, %s)",
                        (rname, f"Built-in {rname} role", json.dumps(sorted(perms)), True, now, now),
                    )
                else:
                    # Update built-in role permissions
                    cur.execute(
                        "UPDATE mgmt_roles SET permissions = %s, updated_at = %s WHERE name = %s AND is_builtin = TRUE",
                        (json.dumps(sorted(perms)), _now_iso(), rname),
                    )

        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.error("[MGMT DB] Seed defaults failed: %s", exc)
        raise
    finally:
        _return_conn(conn)


# ═══════════════════════════════════════════════════════════════════════
#  User Management
# ═══════════════════════════════════════════════════════════════════════

def create_user(username: str, password: str, role: str = "operator",
                full_name: str = "", email: str = "",
                weight: int = 0) -> Dict[str, Any]:
    """Create a new API user. Returns user record without password_hash.

    Parameters
    ----------
    weight : int
        Optional priority/weight for ordering in UI and conflict resolution
        (higher = more important). Defaults to 0.

    Raises
    ------
    ValueError
        * If username already exists
        * If role does not exist (with hint to list roles)
    """
    import bcrypt

    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    now = _now_iso()

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # Check username uniqueness
            cur.execute("SELECT id FROM mgmt_users WHERE username = %s", (username,))
            if cur.fetchone():
                raise ValueError(f"Username '{username}' already exists")

            # Validate role
            cur.execute("SELECT name FROM mgmt_roles WHERE name = %s", (role,))
            if not cur.fetchone():
                raise ValueError(
                    f"Role '{role}' does not exist. "
                    f"List roles: GET /api/v1/mgmt/roles"
                )

            cur.execute(
                "INSERT INTO mgmt_users (username, password_hash, full_name, email, role, is_active, weight, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (username, hashed, full_name, email, role, True, int(weight), now, now),
            )
            user_id = cur.fetchone()[0]
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)

    return get_user(user_id) or {"id": user_id, "username": username, "role": role}


def delete_user(user_id: int) -> bool:
    """Soft-delete user (set is_active=FALSE) and deactivate all API keys."""
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM mgmt_users WHERE id = %s AND is_active = TRUE", (user_id,))
            if not cur.fetchone():
                return False

            cur.execute("UPDATE mgmt_users SET is_active = FALSE, updated_at = %s WHERE id = %s", (now, user_id))
            cur.execute("UPDATE mgmt_api_keys SET is_active = FALSE WHERE user_id = %s", (user_id,))
        conn.commit()
        return True
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


def purge_user(user_id: int) -> bool:
    """Hard-delete user record AND all its API keys (CASCADE).

    Use with caution — this is irreversible. Use :func:`delete_user` for
    the safer soft-delete.
    """
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # Block purging the last active admin to avoid lockout
            cur.execute(
                "SELECT COUNT(*) FROM mgmt_users WHERE role = 'admin' AND is_active = TRUE"
            )
            active_admins = cur.fetchone()[0]
            cur.execute("SELECT role, is_active FROM mgmt_users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                return False
            if row[0] == "admin" and row[1] and active_admins <= 1:
                raise ValueError("Refusing to purge the last active admin user")

            cur.execute("DELETE FROM mgmt_users WHERE id = %s", (user_id,))
            deleted = cur.rowcount > 0
        conn.commit()
        return deleted
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)


def enable_user(user_id: int) -> bool:
    """Re-activate a previously disabled user (does NOT re-enable API keys)."""
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE mgmt_users SET is_active = TRUE, updated_at = %s WHERE id = %s AND is_active = FALSE",
                (now, user_id),
            )
            found = cur.rowcount > 0
        conn.commit()
        return found
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


def disable_user(user_id: int) -> bool:
    """Disable a user (soft). Also disables all their API keys."""
    return delete_user(user_id)


def reset_user_password(user_id: int, new_password: Optional[str] = None) -> Optional[str]:
    """Reset a user's password.

    If ``new_password`` is ``None``, a strong random password is generated
    and returned. Otherwise, the provided password is set and ``None`` is
    returned on success.
    """
    import bcrypt

    if not new_password:
        # 24 chars, alnum + safe punctuation
        new_password = secrets.token_urlsafe(18)

    hashed = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE mgmt_users SET password_hash = %s, updated_at = %s WHERE id = %s",
                (hashed, now, user_id),
            )
            if cur.rowcount == 0:
                return None
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return new_password


def update_user(user_id: int, **kwargs: Any) -> Optional[Dict[str, Any]]:
    """Update user fields. Returns updated user or None.

    Accepted kwargs: username, full_name, email, role, is_active, weight,
    password (stored as password_hash).
    """
    allowed = {"username", "full_name", "email", "role", "is_active", "weight"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}

    if "password" in kwargs:
        import bcrypt
        updates["password_hash"] = bcrypt.hashpw(
            kwargs["password"].encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")

    if not updates:
        return get_user(user_id)

    updates["updated_at"] = _now_iso()
    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [user_id]

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE mgmt_users SET {set_clause} WHERE id = %s", values)
            if cur.rowcount == 0:
                return None
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)

    result = get_user(user_id)
    if result:
        result.pop("password_hash", None)
    return result


def get_user(user_id: int) -> Optional[Dict[str, Any]]:
    """Retrieve a user by ID."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, password_hash, full_name, email, role, is_active, weight, last_login_at, login_count, created_at, updated_at "
                "FROM mgmt_users WHERE id = %s", (user_id,)
            )
            row = cur.fetchone()
            if not row:
                return None
            return {
                "id": row[0], "username": row[1], "password_hash": row[2],
                "full_name": row[3], "email": row[4], "role": row[5],
                "is_active": 1 if row[6] else 0, "weight": row[7] or 0,
                "last_login_at": row[8], "login_count": row[9] or 0,
                "created_at": row[10], "updated_at": row[11],
            }
    finally:
        _return_conn(conn)


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    """Retrieve a user by username."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, password_hash, full_name, email, role, is_active, weight, last_login_at, login_count, created_at, updated_at "
                "FROM mgmt_users WHERE username = %s", (username,)
            )
            row = cur.fetchone()
            if not row:
                return None
            return {
                "id": row[0], "username": row[1], "password_hash": row[2],
                "full_name": row[3], "email": row[4], "role": row[5],
                "is_active": 1 if row[6] else 0, "weight": row[7] or 0,
                "last_login_at": row[8], "login_count": row[9] or 0,
                "created_at": row[10], "updated_at": row[11],
            }
    finally:
        _return_conn(conn)


def list_users(role: Optional[str] = None, is_active: Optional[bool] = None,
               offset: int = 0, limit: int = 100,
               search: Optional[str] = None) -> List[Dict[str, Any]]:
    """List users with optional filtering and pagination.

    v2.2: now supports ``search`` (case-insensitive LIKE on
    username/full_name/email) and returns ``weight``.
    """
    conditions = []
    params: list = []

    if role is not None:
        conditions.append("role = %s")
        params.append(role)
    if is_active is not None:
        conditions.append("is_active = %s")
        params.append(is_active)
    if search:
        conditions.append("(username ILIKE %s OR full_name ILIKE %s OR email ILIKE %s)")
        like = f"%{search}%"
        params.extend([like, like, like])

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.extend([offset, limit])

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, username, full_name, email, role, is_active, weight, last_login_at, login_count, created_at, updated_at "
                f"FROM mgmt_users {where} ORDER BY weight DESC, id OFFSET %s LIMIT %s",
                params,
            )
            rows = cur.fetchall()
            results = []
            for row in rows:
                d = {
                    "id": row[0], "username": row[1], "full_name": row[2],
                    "email": row[3], "role": row[4], "is_active": 1 if row[5] else 0,
                    "weight": row[6] or 0, "last_login_at": row[7],
                    "login_count": row[8] or 0,
                    "created_at": row[9], "updated_at": row[10],
                }
                results.append(d)
            return results
    finally:
        _return_conn(conn)


def list_user_keys(user_id: int, include_inactive: bool = False) -> List[Dict[str, Any]]:
    """Return all API keys belonging to a given user (optionally including inactive)."""
    cond = ["user_id = %s"]
    params: list = [user_id]
    if not include_inactive:
        cond.append("is_active = TRUE")
    where = "WHERE " + " AND ".join(cond)
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, key_prefix, user_id, name, description, role, is_active, weight, expires_at, created_at, last_used_at "
                f"FROM mgmt_api_keys {where} ORDER BY weight DESC, id",
                params,
            )
            rows = cur.fetchall()
            return [
                {
                    "id": r[0], "key_prefix": _mask_key_prefix(r[1]), "user_id": r[2], "name": r[3],
                    "description": r[4], "role": r[5], "is_active": 1 if r[6] else 0,
                    "weight": r[7] or 0, "expires_at": r[8], "created_at": r[9],
                    "last_used_at": r[10],
                }
                for r in rows
            ]
    finally:
        _return_conn(conn)


def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
    """Verify a username/password pair.

    v2.4.1: Returns a dict with ``_auth_status`` key to distinguish:
      - ``None`` → user not found OR password wrong (generic, don't leak)
      - ``{"_auth_status": "disabled", ...}`` → password correct but account disabled
      - ``{...user record...}`` → success (no _auth_status key)

    The login endpoint checks ``_auth_status`` to give a clear error message
    like "Account is disabled" instead of the generic "Invalid username or
    password". Password is verified FIRST, so you can't enumerate disabled
    accounts without knowing the correct password.
    """
    import bcrypt

    user = get_user_by_username(username)
    if user is None:
        return None  # Don't leak whether username exists

    # Check password BEFORE checking is_active — prevents account enumeration
    try:
        password_ok = bcrypt.checkpw(
            password.encode("utf-8"),
            user["password_hash"].encode("utf-8"),
        )
    except Exception:
        logger.warning("bcrypt check failed for user '%s'", username, exc_info=True)
        return None

    if not password_ok:
        return None  # Wrong password — generic error

    # Password is correct — now check if account is disabled
    if not user.get("is_active"):
        # Return a special marker so the login endpoint can give a clear message
        return {
            "_auth_status": "disabled",
            "id": user["id"],
            "username": user.get("username", username),
        }

    # Success — bump login stats
    try:
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE mgmt_users SET last_login_at = %s, login_count = COALESCE(login_count, 0) + 1 WHERE id = %s",
                    (_now_iso(), user["id"]),
                )
            conn.commit()
        finally:
            _return_conn(conn)
    except Exception:
        logger.debug("login stats update failed (non-fatal)", exc_info=True)

    result = dict(user)
    result.pop("password_hash", None)
    return result


# ═══════════════════════════════════════════════════════════════════════
#  API Key Management
# ═══════════════════════════════════════════════════════════════════════

def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _mask_key_prefix(prefix: str) -> str:
    """Mask the key prefix for display.

    For WEBADC-XXXXX-XXXXX-XXXXX format keys (where prefix = full key):
      WEBADC-RGJ4Y-5JXVF-9E2WN  →  WEBADC-RGJ4Y-…

    For legacy keys (first 8 chars of token_urlsafe):
      WMeUw-NV  →  WMeUw-NV  (already short, no masking needed)
    """
    if not prefix:
        return ""
    if prefix.upper().startswith("WEBADC-") and len(prefix) > 12:
        # Show only the first group after WEBADC-
        parts = prefix.split("-")
        if len(parts) >= 2:
            return f"{parts[0]}-{parts[1]}-…"
        return prefix[:12] + "…"
    return prefix


# v2.3.5: Pretty API key format — WEBADC-XXXXX-XXXXX-XXXXX
# Where X is from [A-Z0-9] (uppercase letters + digits, no ambiguous chars).
# 3 groups of 5 chars = 15 random chars = ~78 bits of entropy.
# Old keys (raw token_urlsafe) still validate via _normalize_key().

_KEY_PREFIX = "WEBADC-"
_KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no I, O, 0, 1 (ambiguous)
_KEY_PART_LEN = 5
_KEY_PARTS = 3


def _generate_pretty_key() -> str:
    """Generate a new API key in WEBADC-XXXXX-XXXXX-XXXXX format."""
    parts = [
        "".join(secrets.choice(_KEY_ALPHABET) for _ in range(_KEY_PART_LEN))
        for _ in range(_KEY_PARTS)
    ]
    return f"{_KEY_PREFIX}{'-'.join(parts)}"


def _normalize_key(key: str) -> tuple:
    """Normalise an API key for hashing + prefix lookup.

    Returns (normalised_key, prefix_for_lookup).

    For new-format keys (``WEBADC-XXXXX-XXXXX-XXXXX``):
      * normalised = uppercase, strip whitespace
      * prefix = the full key (it's short enough to be unique)

    For legacy keys (raw ``token_urlsafe``):
      * normalised = as-is
      * prefix = first 8 chars (old behaviour)

    This lets old and new keys coexist in the same DB.
    """
    key = key.strip()
    if key.upper().startswith(_KEY_PREFIX):
        norm = key.upper()
        return norm, norm  # prefix = full key (unique)
    # Legacy key — use first 8 chars as prefix
    return key, key[:8]


def create_api_key(user_id: int, name: str = "", role: str = "operator",
                   expires_days: Optional[int] = None, description: str = "",
                   weight: int = 0) -> str:
    """Generate a new API key. Returns plaintext key ONCE.

    v2.3.5: Keys are now generated in the pretty format
    ``WEBADC-XXXXX-XXXXX-XXXXX`` (e.g. ``WEBADC-K7M3P-Q9X2L-R5N8T``).

    Parameters
    ----------
    weight : int
        Priority for ordering when multiple keys exist for the same user
        (higher = preferred). Defaults to 0.
    expires_days : Optional[int]
        Days until expiry. Must be >= 1 if set. None = no expiry.
        Passing 0 is rejected (would create an immediately-expired key).

    Raises
    ------
    ValueError
        * If the user does not exist (clear message: "User N does not exist")
        * If the user is disabled (clear message with recovery hint)
        * If the role does not exist
        * If expires_days < 1 (must be >= 1 or None)
    """
    # Validate expires_days early — prevent creating immediately-expired keys
    if expires_days is not None and expires_days < 1:
        raise ValueError(
            f"expires_days must be >= 1 (got {expires_days}). "
            f"Pass None for no expiry."
        )

    user = get_user(user_id)
    if not user:
        raise ValueError(
            f"User {user_id} does not exist. "
            f"List users: GET /api/v1/mgmt/users"
        )
    if not user.get("is_active"):
        raise ValueError(
            f"User {user_id} ({user.get('username', '')}) is disabled. "
            f"Enable the user first: POST /api/v1/mgmt/users/{user_id}/enable"
        )

    # v2.3.5: Generate key in WEBADC-XXXXX-XXXXX-XXXXX format
    plaintext_key = _generate_pretty_key()
    norm_key, key_prefix = _normalize_key(plaintext_key)
    key_hash = _hash_key(norm_key)
    now = _now_iso()
    expires_at = None
    if expires_days is not None:
        expires_at = (datetime.now(timezone.utc) + timedelta(days=expires_days)).isoformat()

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # Validate role
            cur.execute("SELECT name FROM mgmt_roles WHERE name = %s", (role,))
            if not cur.fetchone():
                raise ValueError(
                    f"Role '{role}' does not exist. "
                    f"List roles: GET /api/v1/mgmt/roles"
                )

            cur.execute(
                "INSERT INTO mgmt_api_keys (key_hash, key_prefix, user_id, name, description, role, is_active, weight, expires_at, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (key_hash, key_prefix, user_id, name, description, role, True, int(weight), expires_at, now),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)

    return plaintext_key


def delete_api_key(key_id: int) -> bool:
    """Deactivate an API key (soft-delete)."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE mgmt_api_keys SET is_active = FALSE WHERE id = %s AND is_active = TRUE", (key_id,))
            found = cur.rowcount > 0
        conn.commit()
        return found
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


def purge_api_key(key_id: int) -> bool:
    """Hard-delete an API key record (irreversible)."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM mgmt_api_keys WHERE id = %s", (key_id,))
            deleted = cur.rowcount > 0
        conn.commit()
        return deleted
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


def enable_api_key(key_id: int) -> bool:
    """Re-activate a previously disabled API key."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # Make sure the owning user is still active
            cur.execute(
                "UPDATE mgmt_api_keys k SET is_active = TRUE "
                "FROM mgmt_users u "
                "WHERE k.id = %s AND k.user_id = u.id AND u.is_active = TRUE AND k.is_active = FALSE",
                (key_id,),
            )
            found = cur.rowcount > 0
        conn.commit()
        return found
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


def disable_api_key(key_id: int) -> bool:
    """Disable an API key (alias for :func:`delete_api_key`)."""
    return delete_api_key(key_id)


def update_api_key(key_id: int, **kwargs: Any) -> Optional[Dict[str, Any]]:
    """Update API key fields.

    Accepted kwargs: name, description, role, is_active, expires_at, weight.
    """
    allowed = {"name", "description", "role", "is_active", "expires_at", "weight"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}

    if not updates:
        return get_api_key(key_id)

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [key_id]

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE mgmt_api_keys SET {set_clause} WHERE id = %s", values)
            if cur.rowcount == 0:
                return None
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)

    return get_api_key(key_id)


def get_api_key(key_id: int) -> Optional[Dict[str, Any]]:
    """Retrieve an API key record by ID."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, key_hash, key_prefix, user_id, name, description, role, is_active, weight, expires_at, created_at, last_used_at "
                "FROM mgmt_api_keys WHERE id = %s", (key_id,)
            )
            row = cur.fetchone()
            if not row:
                return None
            return {
                "id": row[0], "key_hash": row[1], "key_prefix": _mask_key_prefix(row[2]),
                "user_id": row[3], "name": row[4], "description": row[5],
                "role": row[6], "is_active": 1 if row[7] else 0,
                "weight": row[8] or 0, "expires_at": row[9],
                "created_at": row[10], "last_used_at": row[11],
            }
    finally:
        _return_conn(conn)


def validate_api_key(key_plaintext: str) -> Optional[Dict[str, Any]]:
    """Validate a plaintext API key. Returns enriched info or None.

    v2.4.3: Fixed connection-pool corruption — the ``last_used_at`` UPDATE
    is now done in a SEPARATE connection so it can't interfere with the
    validation reads. Previously, ``conn.commit()`` inside the read cursor
    could leave the pooled connection in a bad state for the next caller,
    causing the same key to validate once then fail on subsequent calls.

    v2.4.2: Returns special markers for disabled accounts/roles/expiry.
    """
    norm_key, key_prefix = _normalize_key(key_plaintext)
    key_hash = _hash_key(norm_key)

    # ── Phase 1: READ-ONLY validation (no commits) ──────────────────
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, key_hash, user_id, role, key_prefix, expires_at, is_active "
                "FROM mgmt_api_keys WHERE key_prefix = %s",
                (key_prefix,),
            )
            row = cur.fetchone()
            if not row:
                return None

            db_id, db_hash, db_user_id, db_role, db_prefix, db_expires, db_active = row

            if not secrets.compare_digest(db_hash, key_hash):
                return None

            # Key itself is inactive — check WHY before returning None.
            # If the owning user is also disabled, return user_disabled so
            # the middleware can give the clear "Account is disabled" message.
            # Otherwise return key_disabled for a clear "key deactivated" msg.
            if not db_active:
                # Look up the user to see if THEY are disabled
                cur.execute("SELECT username, is_active FROM mgmt_users WHERE id = %s", (db_user_id,))
                user_row = cur.fetchone()
                if user_row:
                    _uname = user_row[0]
                    _user_active = bool(user_row[1])
                    if not _user_active:
                        return {
                            "_auth_status": "user_disabled",
                            "key_id": db_id,
                            "user_id": db_user_id,
                            "username": _uname,
                        }
                # User is active but key is deactivated
                return {
                    "_auth_status": "key_disabled",
                    "key_id": db_id,
                    "user_id": db_user_id,
                    "username": user_row[0] if user_row else "",
                }

            # Check expiry
            if db_expires:
                try:
                    exp = datetime.fromisoformat(db_expires)
                    if exp.tzinfo is None:
                        exp = exp.replace(tzinfo=timezone.utc)
                    if datetime.now(timezone.utc) > exp:
                        return {
                            "_auth_status": "key_expired",
                            "key_id": db_id,
                            "user_id": db_user_id,
                            "expires_at": db_expires,
                        }
                except (ValueError, TypeError):
                    pass

            # Check user is active
            cur.execute("SELECT username, is_active FROM mgmt_users WHERE id = %s", (db_user_id,))
            user_row = cur.fetchone()
            if not user_row:
                return None
            username = user_row[0]
            user_is_active = bool(user_row[1])

            if not user_is_active:
                return {
                    "_auth_status": "user_disabled",
                    "key_id": db_id,
                    "user_id": db_user_id,
                    "username": username,
                }

            # Check role is active + get permissions
            role_perms: list = []
            try:
                cur.execute(
                    "SELECT permissions, is_active FROM mgmt_roles WHERE name = %s",
                    (db_role,),
                )
                rr = cur.fetchone()
                if rr:
                    if not rr[1]:
                        return {
                            "_auth_status": "role_disabled",
                            "key_id": db_id,
                            "user_id": db_user_id,
                            "username": username,
                            "role": db_role,
                        }
                    perms = rr[0]
                    if isinstance(perms, str):
                        try:
                            perms = json.loads(perms)
                        except json.JSONDecodeError:
                            perms = []
                    role_perms = list(perms or [])
            except Exception:
                pass

        # Rollback any read-only transaction state before returning the conn
        conn.rollback()

        result = {
            "key_id": db_id,
            "user_id": db_user_id,
            "username": username,
            "role": db_role,
            "key_prefix": _mask_key_prefix(db_prefix),
            "expires_at": db_expires,
            "permissions": role_perms,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)

    # ── Phase 2: Update last_used_at in a SEPARATE connection ───────
    # This isolation prevents the write from corrupting the read-only
    # validation state for the next caller that gets the same pooled conn.
    try:
        conn2 = _get_conn()
        try:
            with conn2.cursor() as cur2:
                cur2.execute(
                    "UPDATE mgmt_api_keys SET last_used_at = %s WHERE id = %s",
                    (_now_iso(), db_id),
                )
            conn2.commit()
        finally:
            _return_conn(conn2)
    except Exception:
        logger.debug("last_used_at update failed (non-fatal)", exc_info=True)

    return result


def list_api_keys(user_id: Optional[int] = None, is_active: Optional[bool] = None,
                  offset: int = 0, limit: int = 100,
                  search: Optional[str] = None) -> List[Dict[str, Any]]:
    """List API keys with optional filtering.

    v2.2: now supports ``search`` (case-insensitive LIKE on name/description)
    and returns ``weight``.
    """
    conditions = []
    params: list = []

    if user_id is not None:
        conditions.append("user_id = %s")
        params.append(user_id)
    if is_active is not None:
        conditions.append("is_active = %s")
        params.append(is_active)
    if search:
        conditions.append("(name ILIKE %s OR description ILIKE %s)")
        like = f"%{search}%"
        params.extend([like, like])

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.extend([offset, limit])

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, key_prefix, user_id, name, description, role, is_active, weight, expires_at, created_at, last_used_at "
                f"FROM mgmt_api_keys {where} ORDER BY weight DESC, id OFFSET %s LIMIT %s",
                params,
            )
            rows = cur.fetchall()
            return [
                {
                    "id": r[0], "key_prefix": _mask_key_prefix(r[1]), "user_id": r[2], "name": r[3],
                    "description": r[4], "role": r[5], "is_active": 1 if r[6] else 0,
                    "weight": r[7] or 0, "expires_at": r[8], "created_at": r[9],
                    "last_used_at": r[10],
                }
                for r in rows
            ]
    finally:
        _return_conn(conn)


def rotate_api_key(key_id: int) -> Optional[str]:
    """Deactivate old key and create new one with same settings."""
    old_key = get_api_key(key_id)
    if old_key is None:
        return None

    delete_api_key(key_id)

    expires_days = None
    if old_key.get("expires_at"):
        try:
            exp = datetime.fromisoformat(old_key["expires_at"])
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            remaining = exp - datetime.now(timezone.utc)
            if remaining.total_seconds() > 0:
                expires_days = max(1, int(remaining.total_seconds() / 86400))
        except (ValueError, TypeError):
            pass

    return create_api_key(
        user_id=old_key["user_id"], name=old_key["name"], role=old_key["role"],
        expires_days=expires_days, description=old_key.get("description", ""),
        weight=old_key.get("weight", 0) or 0,
    )


# ═══════════════════════════════════════════════════════════════════════
#  Role Management
# ═══════════════════════════════════════════════════════════════════════

def list_roles(include_disabled: bool = True) -> List[Dict[str, Any]]:
    """List all defined roles with their permissions.

    v2.2: also returns ``weight`` and ``is_active``. When
    ``include_disabled`` is False, disabled roles are excluded.
    """
    cond = "" if include_disabled else "WHERE is_active = TRUE"
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT name, description, permissions, is_builtin, is_active, weight, created_at, updated_at "
                f"FROM mgmt_roles {cond} ORDER BY weight DESC, name"
            )
            rows = cur.fetchall()
            results = []
            for r in rows:
                perms = r[2]
                if isinstance(perms, str):
                    try:
                        perms = json.loads(perms)
                    except json.JSONDecodeError:
                        perms = []
                results.append({
                    "name": r[0], "description": r[1], "permissions": perms or [],
                    "is_builtin": r[3], "is_active": 1 if r[4] else 0,
                    "weight": r[5] or 0, "created_at": r[6], "updated_at": r[7],
                })
            return results
    finally:
        _return_conn(conn)


def get_role(name: str) -> Optional[Dict[str, Any]]:
    """Retrieve a role by name."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, description, permissions, is_builtin, is_active, weight, created_at, updated_at "
                "FROM mgmt_roles WHERE name = %s", (name,)
            )
            row = cur.fetchone()
            if not row:
                return None
            perms = row[2]
            if isinstance(perms, str):
                try:
                    perms = json.loads(perms)
                except json.JSONDecodeError:
                    perms = []
            return {
                "name": row[0], "description": row[1], "permissions": perms or [],
                "is_builtin": row[3], "is_active": 1 if row[4] else 0,
                "weight": row[5] or 0, "created_at": row[6], "updated_at": row[7],
            }
    finally:
        _return_conn(conn)


def create_role(name: str, permissions: List[str], description: str = "",
                weight: int = 0) -> Dict[str, Any]:
    """Create a new custom role.

    v2.2: now accepts ``weight`` (priority for UI ordering).
    """
    try:
        from app.permissions import ALL_PERMISSIONS
        invalid = set(permissions) - ALL_PERMISSIONS
        if invalid:
            raise ValueError(f"Invalid permissions: {sorted(invalid)}")
    except ImportError:
        pass

    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT name FROM mgmt_roles WHERE name = %s", (name,))
            if cur.fetchone():
                raise ValueError(f"Role '{name}' already exists")

            cur.execute(
                "INSERT INTO mgmt_roles (name, description, permissions, is_builtin, is_active, weight, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (name, description, json.dumps(sorted(set(permissions))), False, True, int(weight), now, now),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)

    return get_role(name) or {"name": name, "permissions": permissions}


def update_role(role_name: str, **kwargs: Any) -> Optional[Dict[str, Any]]:
    """Update a role's attributes.

    Parameters:
        role_name: Current name of the role to update.
        **kwargs: Fields to update — 'name' (rename), 'description',
                  'permissions', 'weight', 'is_active'.

    The first positional parameter is ``role_name`` (not ``name``) so that
    callers can safely pass ``name=...`` in kwargs for rename operations
    without triggering ``TypeError: got multiple values for argument 'name'``.
    """
    updates: Dict[str, Any] = {}

    if "permissions" in kwargs:
        try:
            from app.permissions import ALL_PERMISSIONS
            invalid = set(kwargs["permissions"]) - ALL_PERMISSIONS
            if invalid:
                raise ValueError(f"Invalid permissions: {sorted(invalid)}")
        except ImportError:
            pass
        updates["permissions"] = json.dumps(sorted(set(kwargs["permissions"])))

    if "description" in kwargs:
        updates["description"] = kwargs["description"]

    if "weight" in kwargs:
        updates["weight"] = int(kwargs["weight"])

    if "is_active" in kwargs:
        updates["is_active"] = bool(kwargs["is_active"])

    if not updates:
        return get_role(role_name)

    updates["updated_at"] = _now_iso()

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            set_clause = ", ".join(f"{k} = %s" for k in updates)
            values = list(updates.values()) + [role_name]
            cur.execute(f"UPDATE mgmt_roles SET {set_clause} WHERE name = %s", values)
            if cur.rowcount == 0:
                return None

            # Handle rename
            new_name = kwargs.get("name")
            if new_name and new_name != role_name:
                cur.execute("SELECT name FROM mgmt_roles WHERE name = %s", (new_name,))
                if cur.fetchone():
                    raise ValueError(f"Role '{new_name}' already exists")
                cur.execute("UPDATE mgmt_roles SET name = %s, updated_at = %s WHERE name = %s", (new_name, _now_iso(), role_name))
                cur.execute("UPDATE mgmt_users SET role = %s WHERE role = %s", (new_name, role_name))
                cur.execute("UPDATE mgmt_api_keys SET role = %s WHERE role = %s", (new_name, role_name))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)

    return get_role(kwargs.get("name") or role_name)


def delete_role(name: str) -> bool:
    """Delete a custom (non-built-in) role.

    This is a hard delete — the role and its permission set are removed
    permanently. Users and API keys that referenced this role keep their
    string value but will fail ``has_permission`` checks (they get an
    empty permission set). Prefer :func:`disable_role` for safety.
    """
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT is_builtin FROM mgmt_roles WHERE name = %s", (name,))
            row = cur.fetchone()
            if not row:
                return False
            if row[0]:  # is_builtin
                return False

            # Prevent deletion if any active user/key still references this role
            cur.execute("SELECT COUNT(*) FROM mgmt_users WHERE role = %s AND is_active = TRUE", (name,))
            if cur.fetchone()[0] > 0:
                raise ValueError(
                    f"Role '{name}' is still assigned to active users. "
                    "Reassign or disable those users first, or use disable_role() instead."
                )
            cur.execute("SELECT COUNT(*) FROM mgmt_api_keys WHERE role = %s AND is_active = TRUE", (name,))
            if cur.fetchone()[0] > 0:
                raise ValueError(
                    f"Role '{name}' is still assigned to active API keys. "
                    "Rotate or disable those keys first, or use disable_role() instead."
                )

            cur.execute("DELETE FROM mgmt_roles WHERE name = %s AND is_builtin = FALSE", (name,))
            deleted = cur.rowcount > 0
        conn.commit()
        return deleted
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)


def enable_role(name: str) -> bool:
    """Re-enable a previously disabled role."""
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE mgmt_roles SET is_active = TRUE, updated_at = %s WHERE name = %s AND is_active = FALSE",
                (now, name),
            )
            found = cur.rowcount > 0
        conn.commit()
        return found
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


def disable_role(name: str) -> bool:
    """Disable a role without deleting it.

    All API keys that reference this role will be rejected at validation
    time (see :func:`validate_api_key`). Existing JWT sessions are not
    affected — they expire naturally.
    """
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # Block disabling the admin role (would lock out everyone)
            if name == "admin":
                raise ValueError("Refusing to disable the 'admin' role (would lock out all users)")
            cur.execute(
                "UPDATE mgmt_roles SET is_active = FALSE, updated_at = %s WHERE name = %s AND is_active = TRUE",
                (now, name),
            )
            found = cur.rowcount > 0
        conn.commit()
        return found
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)


def list_role_users(name: str, include_inactive: bool = False) -> List[Dict[str, Any]]:
    """Return all users that have been assigned a given role."""
    cond = ["role = %s"]
    params: list = [name]
    if not include_inactive:
        cond.append("is_active = TRUE")
    where = "WHERE " + " AND ".join(cond)
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, username, full_name, email, is_active, weight, last_login_at, created_at "
                f"FROM mgmt_users {where} ORDER BY weight DESC, id",
                params,
            )
            rows = cur.fetchall()
            return [
                {
                    "id": r[0], "username": r[1], "full_name": r[2], "email": r[3],
                    "is_active": 1 if r[4] else 0, "weight": r[5] or 0,
                    "last_login_at": r[6], "created_at": r[7],
                }
                for r in rows
            ]
    finally:
        _return_conn(conn)


def list_role_keys(name: str, include_inactive: bool = False) -> List[Dict[str, Any]]:
    """Return all API keys that have been assigned a given role."""
    cond = ["role = %s"]
    params: list = [name]
    if not include_inactive:
        cond.append("is_active = TRUE")
    where = "WHERE " + " AND ".join(cond)
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, key_prefix, user_id, name, is_active, weight, expires_at, created_at, last_used_at "
                f"FROM mgmt_api_keys {where} ORDER BY weight DESC, id",
                params,
            )
            rows = cur.fetchall()
            return [
                {
                    "id": r[0], "key_prefix": _mask_key_prefix(r[1]), "user_id": r[2], "name": r[3],
                    "is_active": 1 if r[4] else 0, "weight": r[5] or 0,
                    "expires_at": r[6], "created_at": r[7], "last_used_at": r[8],
                }
                for r in rows
            ]
    finally:
        _return_conn(conn)


def gen_key_for_role(role_name: str, user_id: int, name: str = "",
                     expires_days: Optional[int] = None,
                     description: str = "",
                     weight: int = 0) -> str:
    """Generate a new API key already scoped to a given role.

    This is a convenience helper — it validates that the role exists and
    is active, then delegates to :func:`create_api_key`. The plaintext
    key is returned ONCE.
    """
    role = get_role(role_name)
    if role is None:
        raise ValueError(f"Role '{role_name}' not found")
    if not role.get("is_active"):
        raise ValueError(f"Role '{role_name}' is disabled — enable it first")
    return create_api_key(
        user_id=user_id,
        name=name or f"key-for-{role_name}",
        role=role_name,
        expires_days=expires_days,
        description=description,
        weight=weight,
    )


def get_role_permissions(role_name: str) -> set:
    """Return the set of permission strings for a role.

    v2.2: if the role has been disabled, returns an empty set so the
    middleware denies all requests from users/keys with that role.
    """
    role = get_role(role_name)
    if role:
        if not role.get("is_active", 1):
            return set()
        return set(role.get("permissions", []))

    # Fallback to default permissions from permissions module
    try:
        from app.permissions import DEFAULT_ROLE_PERMISSIONS
        if role_name in DEFAULT_ROLE_PERMISSIONS:
            return set(DEFAULT_ROLE_PERMISSIONS[role_name])
    except ImportError:
        pass

    return set()


def has_permission(role: str, method: str, endpoint: str) -> bool:
    """Check if a role is allowed to call method on endpoint."""
    try:
        from app.permissions import resolve_permission
        required_perm = resolve_permission(method, endpoint)
    except (ImportError, Exception):
        required_perm = None

    if required_perm is None:
        return True

    role_perms = get_role_permissions(role)
    if required_perm in role_perms:
        return True

    if role == "admin":
        return True

    return False


def has_specific_permission(role: str, permission: str) -> bool:
    """Check if a role has a specific named permission."""
    return permission in get_role_permissions(role)


# ═══════════════════════════════════════════════════════════════════════
#  Stats / Bulk operations  (v2.2)
# ═══════════════════════════════════════════════════════════════════════

def get_mgmt_stats() -> Dict[str, Any]:
    """Return a summary of users/keys/roles/audit for the mgmt dashboard.

    v2.3.2: Added ``soon_to_expire_keys`` (keys expiring within 7 days)
    and ``failed_logins_24h`` (count of failed login attempts in the
    last 24 hours, derived from audit log action="POST /api/v1/auth/login"
    AND status_code=401).
    """
    from datetime import timedelta
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), COALESCE(SUM(CASE WHEN is_active THEN 1 ELSE 0 END),0) FROM mgmt_users")
            u_total, u_active = cur.fetchone()
            cur.execute("SELECT COUNT(*), COALESCE(SUM(CASE WHEN is_active THEN 1 ELSE 0 END),0) FROM mgmt_api_keys")
            k_total, k_active = cur.fetchone()
            cur.execute("SELECT COUNT(*), COALESCE(SUM(CASE WHEN is_active THEN 1 ELSE 0 END),0) FROM mgmt_roles")
            r_total, r_active = cur.fetchone()
            cur.execute("SELECT COUNT(*) FROM mgmt_audit_log")
            a_total = cur.fetchone()[0]

            # v2.3.2: Soon-to-expire keys (active, expires_at within next 7 days)
            soon_cutoff = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
            now_iso = datetime.now(timezone.utc).isoformat()
            cur.execute(
                "SELECT COUNT(*) FROM mgmt_api_keys "
                "WHERE is_active = TRUE AND expires_at IS NOT NULL "
                "AND expires_at <= %s AND expires_at > %s",
                (soon_cutoff, now_iso),
            )
            soon_expire = cur.fetchone()[0] or 0

            # v2.3.2: Failed logins in last 24 hours
            # = audit entries with action="POST /api/v1/auth/login" AND status_code=401
            cutoff_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
            cur.execute(
                "SELECT COUNT(*) FROM mgmt_audit_log "
                "WHERE action = 'POST /api/v1/auth/login' "
                "AND status_code = 401 "
                "AND timestamp >= %s",
                (cutoff_24h,),
            )
            failed_logins_24h = cur.fetchone()[0] or 0

            # Successful logins in last 24 hours
            cur.execute(
                "SELECT COUNT(*) FROM mgmt_audit_log "
                "WHERE action = 'POST /api/v1/auth/login' "
                "AND status_code = 200 "
                "AND timestamp >= %s",
                (cutoff_24h,),
            )
            successful_logins_24h = cur.fetchone()[0] or 0

            # per-role counts
            cur.execute(
                "SELECT r.name, r.is_active, "
                " COALESCE(u.cnt, 0) AS users, COALESCE(k.cnt, 0) AS keys "
                "FROM mgmt_roles r "
                "LEFT JOIN (SELECT role, COUNT(*) AS cnt FROM mgmt_users GROUP BY role) u ON u.role = r.name "
                "LEFT JOIN (SELECT role, COUNT(*) AS cnt FROM mgmt_api_keys GROUP BY role) k ON k.role = r.name "
                "ORDER BY r.weight DESC, r.name"
            )
            rows = cur.fetchall()
            roles = [
                {"name": r[0], "is_active": 1 if r[1] else 0,
                 "users": r[2], "keys": r[3]}
                for r in rows
            ]
        return {
            "users":     {"total": u_total or 0, "active": u_active or 0},
            "api_keys":  {"total": k_total or 0, "active": k_active or 0,
                          "soon_to_expire_7d": soon_expire},
            "roles":     {"total": r_total or 0, "active": r_active or 0},
            "audit_log": {"total": a_total or 0},
            "auth":      {
                "failed_logins_24h": failed_logins_24h,
                "successful_logins_24h": successful_logins_24h,
            },
            "roles_breakdown": roles,
        }
    finally:
        _return_conn(conn)


def bulk_user_action(user_ids: List[int], action: str) -> Dict[str, Any]:
    """Apply an action (enable/disable/purge) to multiple users.

    Returns a dict with ``ok`` (list of user IDs that were successfully
    changed) and ``failed`` (list of dicts ``{"id": int, "error": str}``).
    """
    ok: List[int] = []
    failed: List[Dict[str, Any]] = []
    for uid in user_ids:
        try:
            if action == "enable":
                if enable_user(uid):
                    ok.append(uid)
                else:
                    failed.append({"id": uid, "error": "not found or already enabled"})
            elif action == "disable":
                if disable_user(uid):
                    ok.append(uid)
                else:
                    failed.append({"id": uid, "error": "not found or already disabled"})
            elif action == "purge":
                if purge_user(uid):
                    ok.append(uid)
                else:
                    failed.append({"id": uid, "error": "not found"})
            else:
                raise ValueError(f"Unknown action: {action}")
        except Exception as exc:
            failed.append({"id": uid, "error": str(exc)})
    return {"action": action, "ok": ok, "failed": failed}


def bulk_key_action(key_ids: List[int], action: str) -> Dict[str, Any]:
    """Apply an action (enable/disable/purge) to multiple API keys."""
    ok: List[int] = []
    failed: List[Dict[str, Any]] = []
    for kid in key_ids:
        try:
            if action == "enable":
                if enable_api_key(kid):
                    ok.append(kid)
                else:
                    failed.append({"id": kid, "error": "not found, already enabled, or owning user inactive"})
            elif action == "disable":
                if disable_api_key(kid):
                    ok.append(kid)
                else:
                    failed.append({"id": kid, "error": "not found or already disabled"})
            elif action == "purge":
                if purge_api_key(kid):
                    ok.append(kid)
                else:
                    failed.append({"id": kid, "error": "not found"})
            else:
                raise ValueError(f"Unknown action: {action}")
        except Exception as exc:
            failed.append({"id": kid, "error": str(exc)})
    return {"action": action, "ok": ok, "failed": failed}


# ═══════════════════════════════════════════════════════════════════════
#  Audit Log
# ═══════════════════════════════════════════════════════════════════════

def log_action(
    user_id: Optional[int], api_key_id: Optional[int], action: str,
    endpoint: str = "", ip_address: str = "", details: Optional[str] = None,
    *,
    username: Optional[str] = None,
    method: Optional[str] = None,
    status_code: Optional[int] = None,
    duration_ms: Optional[int] = None,
    user_agent: Optional[str] = None,
    request_body: Optional[str] = None,
    auth_method: Optional[str] = None,
    event_type: Optional[str] = None,
) -> None:
    """Append an entry to the audit log.

    v2.3.2: Rich audit log — supports full HTTP context (method,
    status_code, duration, user-agent, request body snippet) plus
    semantic event_type (e.g. "user.created", "key.disabled") for
    business-level events.

    All fields except ``action`` are optional — backward-compatible
    with existing callers.
    """
    now = _now_iso()
    # Truncate request_body to 4 KB — prevents storing huge uploads in audit
    if request_body and len(request_body) > 4096:
        request_body = request_body[:4093] + "..."

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO mgmt_audit_log "
                "(user_id, api_key_id, action, endpoint, ip_address, timestamp, details, "
                " username, method, status_code, duration_ms, user_agent, request_body, "
                " auth_method, event_type) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (user_id, api_key_id, action, endpoint, ip_address, now, details,
                 username, method, status_code, duration_ms, user_agent, request_body,
                 auth_method, event_type),
            )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.debug("Audit log write failed (non-fatal): %s", exc)
    finally:
        _return_conn(conn)


def log_semantic(
    event_type: str,
    *,
    user_id: Optional[int] = None,
    username: Optional[str] = None,
    api_key_id: Optional[int] = None,
    action: Optional[str] = None,
    endpoint: Optional[str] = None,
    ip_address: Optional[str] = None,
    details: Optional[str] = None,
    auth_method: Optional[str] = None,
) -> None:
    """Append a semantic (business-level) audit event.

    Use this for events like "user.created", "key.disabled", "role.updated"
    — separate from the HTTP-level ``log_action`` entries. Lets the
    dashboard filter meaningful events without parsing HTTP logs.
    """
    log_action(
        user_id=user_id,
        api_key_id=api_key_id,
        action=action or event_type,
        endpoint=endpoint or "",
        ip_address=ip_address or "",
        details=details,
        username=username,
        event_type=event_type,
        auth_method=auth_method,
    )


def list_audit_log(
    user_id: Optional[int] = None, action: Optional[str] = None,
    endpoint: Optional[str] = None, offset: int = 0, limit: int = 100,
    event_type: Optional[str] = None,
    auth_method: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """List audit log entries with filtering and pagination.

    v2.3.2: Returns all rich fields. New optional filters:
    ``event_type`` (e.g. "user.created" for semantic events only),
    ``auth_method`` ('jwt' / 'api_key' / 'static_api_key'),
    ``ip_address`` (exact match).
    """
    conditions = []
    params: list = []

    if user_id is not None:
        conditions.append("user_id = %s")
        params.append(user_id)
    if action is not None:
        conditions.append("action = %s")
        params.append(action)
    if endpoint is not None:
        conditions.append("endpoint LIKE %s")
        params.append(f"{endpoint}%")
    if event_type is not None:
        conditions.append("event_type = %s")
        params.append(event_type)
    if auth_method is not None:
        conditions.append("auth_method = %s")
        params.append(auth_method)
    if ip_address is not None:
        conditions.append("ip_address = %s")
        params.append(ip_address)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.extend([offset, limit])

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, user_id, api_key_id, action, endpoint, ip_address, "
                f"timestamp, details, username, method, status_code, duration_ms, "
                f"user_agent, request_body, auth_method, event_type "
                f"FROM mgmt_audit_log {where} ORDER BY id DESC OFFSET %s LIMIT %s",
                params,
            )
            rows = cur.fetchall()
            return [
                {
                    "id": r[0], "user_id": r[1], "api_key_id": r[2],
                    "action": r[3], "endpoint": r[4], "ip_address": r[5],
                    "timestamp": r[6], "details": r[7],
                    "username": r[8] or "",
                    "method": r[9] or "",
                    "status_code": r[10],
                    "duration_ms": r[11],
                    "user_agent": r[12] or "",
                    "request_body": r[13] or "",
                    "auth_method": r[14] or "",
                    "event_type": r[15] or "",
                }
                for r in rows
            ]
    finally:
        _return_conn(conn)


# ═══════════════════════════════════════════════════════════════════════
#  AI Chat Sessions & Messages
# ═══════════════════════════════════════════════════════════════════════

def chat_create_session(session_id: str, title: str, owner_id: str, owner_username: str,
                        model: str, system_prompt: str, context: str,
                        created_at: str, updated_at: str) -> Dict[str, Any]:
    """Insert a new AI chat session record."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO ai_chat_sessions (id, title, owner_id, owner_username, model, system_prompt, context, is_archived, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (session_id, title, owner_id, owner_username, model, system_prompt, context, False, created_at, updated_at),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)

    return {"id": session_id, "title": title, "owner_id": owner_id}


def chat_list_sessions(owner_id: Optional[str] = None, include_archived: bool = False) -> List[Dict[str, Any]]:
    """List chat sessions, optionally filtered by owner."""
    conditions = []
    params: list = []

    if owner_id is not None:
        conditions.append("owner_id = %s")
        params.append(owner_id)
    if not include_archived:
        conditions.append("is_archived = FALSE")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, title, owner_id, owner_username, model, system_prompt, context, is_archived, created_at, updated_at "
                f"FROM ai_chat_sessions {where} ORDER BY updated_at DESC",
                params,
            )
            rows = cur.fetchall()
            return [
                {"id": r[0], "title": r[1], "owner_id": r[2], "owner_username": r[3],
                 "model": r[4], "system_prompt": r[5], "context": r[6],
                 "is_archived": 1 if r[7] else 0, "created_at": r[8], "updated_at": r[9]}
                for r in rows
            ]
    finally:
        _return_conn(conn)


def chat_get_session(session_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve a single chat session by ID."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, title, owner_id, owner_username, model, system_prompt, context, is_archived, created_at, updated_at "
                "FROM ai_chat_sessions WHERE id = %s", (session_id,)
            )
            row = cur.fetchone()
            if not row:
                return None
            return {
                "id": row[0], "title": row[1], "owner_id": row[2], "owner_username": row[3],
                "model": row[4], "system_prompt": row[5], "context": row[6],
                "is_archived": 1 if row[7] else 0, "created_at": row[8], "updated_at": row[9],
            }
    finally:
        _return_conn(conn)


def chat_update_session(session_id: str, **kwargs: Any) -> Optional[Dict[str, Any]]:
    """Update fields on a chat session."""
    allowed = {"title", "system_prompt", "context", "is_archived", "model", "updated_at"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}

    if not updates:
        return chat_get_session(session_id)

    # v1.8-2 fix: JSONB columns (context) must be wrapped with
    # psycopg2.extras.Json() to avoid "can't adapt type 'dict'" errors.
    try:
        from psycopg2.extras import Json as Psycopg2Json
    except ImportError:
        Psycopg2Json = None

    jsonb_columns = {"context"}
    final_values = []
    for k, v in updates.items():
        if k in jsonb_columns and v is not None:
            if Psycopg2Json is not None:
                # Wrap dict/list with psycopg2 adapter
                if isinstance(v, (dict, list)):
                    final_values.append(Psycopg2Json(v))
                elif isinstance(v, str):
                    # Parse string to object, then wrap
                    try:
                        final_values.append(Psycopg2Json(json.loads(v)))
                    except json.JSONDecodeError:
                        final_values.append(v)
                else:
                    final_values.append(v)
            else:
                # Fallback: serialize to JSON string (PostgreSQL auto-casts)
                if isinstance(v, (dict, list)):
                    final_values.append(json.dumps(v))
                else:
                    final_values.append(v)
        else:
            final_values.append(v)

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = final_values + [session_id]

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE ai_chat_sessions SET {set_clause} WHERE id = %s", values)
            if cur.rowcount == 0:
                return None
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)

    return chat_get_session(session_id)


def chat_delete_session(session_id: str) -> bool:
    """Delete a chat session and all its messages."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM ai_chat_messages WHERE chat_id = %s", (session_id,))
            cur.execute("DELETE FROM ai_chat_sessions WHERE id = %s", (session_id,))
            deleted = cur.rowcount > 0
        conn.commit()
        return deleted
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


def chat_count_sessions(owner_id: str) -> int:
    """Count active chat sessions for a user."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM ai_chat_sessions WHERE owner_id = %s AND is_archived = FALSE",
                (owner_id,),
            )
            return cur.fetchone()[0]
    finally:
        _return_conn(conn)


def chat_add_message(msg_id: str, chat_id: str, role: str, content: str,
                     model_used: Optional[str], tokens_used: Optional[int],
                     cost_rub: Optional[float], usage_info: Optional[str],
                     tool_steps: Optional[str], timestamp: str) -> Dict[str, Any]:
    """Insert a new chat message record."""
    # v1.8-2 fix: psycopg2 cannot adapt Python dicts for JSONB parameters,
    # causing "can't adapt type 'dict'" errors. Use psycopg2.extras.Json()
    # wrapper for JSONB column values. PostgreSQL then receives proper JSONB.
    try:
        from psycopg2.extras import Json as Psycopg2Json
        _json_wrapper = Psycopg2Json
    except ImportError:
        # Fallback: pass as string (PostgreSQL auto-casts string → JSONB)
        _json_wrapper = lambda x: json.dumps(x) if not isinstance(x, str) else x

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # Wrap JSONB values with psycopg2.extras.Json adapter
            ui_val = None
            if usage_info:
                try:
                    parsed = json.loads(usage_info) if isinstance(usage_info, str) else usage_info
                    ui_val = _json_wrapper(parsed)
                except json.JSONDecodeError:
                    ui_val = _json_wrapper(usage_info)

            ts_val = None
            if tool_steps:
                try:
                    parsed = json.loads(tool_steps) if isinstance(tool_steps, str) else tool_steps
                    ts_val = _json_wrapper(parsed)
                except json.JSONDecodeError:
                    ts_val = _json_wrapper(tool_steps)

            cur.execute(
                "INSERT INTO ai_chat_messages (id, chat_id, role, content, model_used, tokens_used, cost_rub, usage_info, tool_steps, timestamp) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (msg_id, chat_id, role, content, model_used, tokens_used, cost_rub, ui_val, ts_val, timestamp),
            )
            # Update session updated_at
            cur.execute("UPDATE ai_chat_sessions SET updated_at = %s WHERE id = %s", (timestamp, chat_id))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)

    return {"id": msg_id, "chat_id": chat_id, "role": role}


def chat_get_messages(chat_id: str, limit: int = 50, before: Optional[str] = None) -> Tuple[List[Dict[str, Any]], bool]:
    """Get chat messages. Returns (messages, has_more) in chronological order."""
    conditions = ["chat_id = %s"]
    params: list = [chat_id]

    if before:
        conditions.append("timestamp < %s")
        params.append(before)

    where = f"WHERE {' AND '.join(conditions)}"

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # Get total count for has_more
            cur.execute(f"SELECT COUNT(*) FROM ai_chat_messages {where}", params[:])
            total = cur.fetchone()[0]

            cur.execute(
                f"SELECT id, chat_id, role, content, model_used, tokens_used, cost_rub, usage_info, tool_steps, timestamp "
                f"FROM ai_chat_messages {where} ORDER BY timestamp ASC LIMIT %s",
                params + [limit + 1],
            )
            rows = cur.fetchall()

            has_more = len(rows) > limit
            rows = rows[:limit]

            messages = []
            for r in rows:
                ui = r[7]
                if isinstance(ui, str):
                    try:
                        ui = json.loads(ui)
                    except json.JSONDecodeError:
                        ui = None

                ts = r[8]
                if isinstance(ts, str):
                    try:
                        ts = json.loads(ts)
                    except json.JSONDecodeError:
                        ts = None

                messages.append({
                    "id": r[0], "chat_id": r[1], "role": r[2], "content": r[3],
                    "model_used": r[4], "tokens_used": r[5], "cost_rub": r[6],
                    "usage_info": ui, "tool_steps": ts, "timestamp": r[9],
                })

            return messages, has_more
    finally:
        _return_conn(conn)


def chat_get_messages_for_agent(chat_id: str) -> List[Dict[str, Any]]:
    """Get all messages in OpenAI-compatible format for the agent loop."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT role, content FROM ai_chat_messages WHERE chat_id = %s ORDER BY timestamp ASC",
                (chat_id,),
            )
            rows = cur.fetchall()
            return [{"role": r[0], "content": r[1]} for r in rows]
    finally:
        _return_conn(conn)


def chat_count_messages(chat_id: str) -> int:
    """Count messages in a chat session."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM ai_chat_messages WHERE chat_id = %s", (chat_id,))
            return cur.fetchone()[0]
    finally:
        _return_conn(conn)


def chat_get_cost_summary(chat_id: str) -> Dict[str, Any]:
    """Get cost and usage summary for a chat session."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, model_used, tokens_used, cost_rub, usage_info, timestamp, role "
                "FROM ai_chat_messages WHERE chat_id = %s ORDER BY timestamp ASC",
                (chat_id,),
            )
            rows = cur.fetchall()

        total_cost = 0.0
        total_tokens = 0
        total_prompt = 0
        total_completion = 0
        total_reasoning = 0
        assistant_count = 0
        message_breakdown = []

        for r in rows:
            msg_id, model_used, tokens_used, cost_rub, usage_info, timestamp, role = r

            msg_cost = 0.0
            if cost_rub is not None:
                try:
                    msg_cost = float(cost_rub)
                except (ValueError, TypeError):
                    pass

            if role == "assistant":
                assistant_count += 1
                total_cost += msg_cost
                total_tokens += (tokens_used or 0)

                if usage_info:
                    ui = usage_info if isinstance(usage_info, dict) else None
                    if isinstance(usage_info, str):
                        try:
                            ui = json.loads(usage_info)
                        except json.JSONDecodeError:
                            ui = None
                    if ui:
                        total_prompt += (ui.get("prompt_tokens") or 0)
                        total_completion += (ui.get("completion_tokens") or 0)
                        total_reasoning += (ui.get("reasoning_tokens") or 0)

                if msg_cost > 0 or tokens_used:
                    message_breakdown.append({
                        "id": msg_id, "timestamp": timestamp,
                        "model_used": model_used, "tokens_used": tokens_used,
                        "cost_rub": round(msg_cost, 8),
                    })

        return {
            "total_cost_rub": round(total_cost, 8),
            "total_tokens": total_tokens,
            "total_prompt_tokens": total_prompt,
            "total_completion_tokens": total_completion,
            "total_reasoning_tokens": total_reasoning,
            "assistant_message_count": assistant_count,
            "messages": message_breakdown,
        }
    finally:
        _return_conn(conn)


def chat_get_all_cost_summary() -> Dict[str, Any]:
    """Get cost summary across ALL chat sessions."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, title FROM ai_chat_sessions ORDER BY updated_at DESC")
            sessions = cur.fetchall()
    finally:
        _return_conn(conn)

    grand_total_cost = 0.0
    grand_total_tokens = 0
    chat_costs = []

    for session in sessions:
        chat_id, title = session
        summary = chat_get_cost_summary(chat_id)
        cost = summary["total_cost_rub"]
        tokens = summary["total_tokens"]
        grand_total_cost += cost
        grand_total_tokens += tokens
        chat_costs.append({
            "chat_id": chat_id, "title": title,
            "message_count": summary["assistant_message_count"],
            "total_cost_rub": cost, "total_tokens": tokens,
        })

    return {
        "total_cost_rub": round(grand_total_cost, 8),
        "total_tokens": grand_total_tokens,
        "total_chats": len(sessions),
        "chat_costs": chat_costs,
    }


def chat_prune_old_messages(chat_id: str, max_history: int) -> None:
    """Remove oldest messages when a chat exceeds the max history limit."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM ai_chat_messages WHERE chat_id = %s", (chat_id,))
            count = cur.fetchone()[0]

            if count > max_history:
                cur.execute(
                    "DELETE FROM ai_chat_messages WHERE chat_id = %s AND id IN ("
                    "  SELECT id FROM ai_chat_messages WHERE chat_id = %s ORDER BY timestamp ASC LIMIT %s"
                    ")",
                    (chat_id, chat_id, count - max_history),
                )
        conn.commit()
    except Exception:
        conn.rollback()
    finally:
        _return_conn(conn)


# ═══════════════════════════════════════════════════════════════════════
#  General-purpose PostgreSQL query helper (for AI tools)
# ═══════════════════════════════════════════════════════════════════════

def execute_query(query: str, params: Optional[tuple] = None, fetch: bool = True) -> Any:
    """Execute a SQL query and optionally return results.

    WARNING: This is a low-level function. Use with caution.
    Only SELECT queries should use fetch=True.
    """
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(query, params)
            if fetch:
                columns = [desc[0] for desc in cur.description] if cur.description else []
                rows = cur.fetchall()
                return [dict(zip(columns, row)) for row in rows]
            else:
                conn.commit()
                return {"rows_affected": cur.rowcount}
    except Exception as exc:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)


def execute_select(table: str, columns: str = "*", where: Optional[str] = None,
                   order_by: Optional[str] = None, limit: int = 100,
                   offset: int = 0) -> List[Dict[str, Any]]:
    """Safe SELECT query builder. Only allows read operations."""
    # Validate table name (prevent SQL injection)
    allowed_tables = {
        "mgmt_users", "mgmt_api_keys", "mgmt_roles", "mgmt_audit_log",
        "ai_chat_sessions", "ai_chat_messages",
        "projects", "history", "audit_log", "schedules", "snapshots", "templates",
        "information_schema.tables", "information_schema.columns",
    }
    if table.lower() not in {t.lower() for t in allowed_tables}:
        raise ValueError(f"Table '{table}' is not allowed for SELECT queries. Allowed: {sorted(allowed_tables)}")

    query = f"SELECT {columns} FROM {table}"
    params: list = []

    if where:
        query += f" WHERE {where}"

    if order_by:
        # Validate order_by doesn't contain injection
        if ";" in order_by or "--" in order_by:
            raise ValueError("Invalid order_by clause")
        query += f" ORDER BY {order_by}"

    query += " LIMIT %s OFFSET %s"
    params.extend([limit, offset])

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(query, params)
            columns_list = [desc[0] for desc in cur.description] if cur.description else []
            rows = cur.fetchall()
            return [dict(zip(columns_list, row)) for row in rows]
    finally:
        _return_conn(conn)


def execute_insert(table: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Safe INSERT query builder."""
    allowed_tables = {
        "mgmt_audit_log", "ai_chat_sessions", "ai_chat_messages",
    }
    if table.lower() not in {t.lower() for t in allowed_tables}:
        raise ValueError(f"INSERT not allowed on table '{table}'")

    cols = ", ".join(data.keys())
    placeholders = ", ".join(["%s"] * len(data))
    values = list(data.values())

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"INSERT INTO {table} ({cols}) VALUES ({placeholders})", values)
        conn.commit()
        return {"status": "ok", "rows_affected": 1}
    except Exception as exc:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)


def execute_update(table: str, data: Dict[str, Any], where: str, where_params: Optional[tuple] = None) -> Dict[str, Any]:
    """Safe UPDATE query builder."""
    allowed_tables = {
        "mgmt_users", "mgmt_api_keys", "mgmt_roles",
        "ai_chat_sessions", "ai_chat_messages",
    }
    if table.lower() not in {t.lower() for t in allowed_tables}:
        raise ValueError(f"UPDATE not allowed on table '{table}'")

    set_clause = ", ".join(f"{k} = %s" for k in data.keys())
    values = list(data.values())

    query = f"UPDATE {table} SET {set_clause} WHERE {where}"

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            if where_params:
                cur.execute(query, values + list(where_params))
            else:
                cur.execute(query, values)
            rows_affected = cur.rowcount
        conn.commit()
        return {"status": "ok", "rows_affected": rows_affected}
    except Exception as exc:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)


def execute_delete(table: str, where: str, where_params: Optional[tuple] = None) -> Dict[str, Any]:
    """Safe DELETE query builder."""
    allowed_tables = {
        "ai_chat_sessions", "ai_chat_messages",
    }
    if table.lower() not in {t.lower() for t in allowed_tables}:
        raise ValueError(f"DELETE not allowed on table '{table}'")

    query = f"DELETE FROM {table} WHERE {where}"

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            if where_params:
                cur.execute(query, where_params)
            else:
                cur.execute(query)
            rows_affected = cur.rowcount
        conn.commit()
        return {"status": "ok", "rows_affected": rows_affected}
    except Exception as exc:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)


def list_tables() -> List[Dict[str, Any]]:
    """List all tables in the database with row counts."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                ORDER BY table_name
            """)
            tables = cur.fetchall()

            result = []
            for (table_name,) in tables:
                try:
                    cur.execute(f"SELECT COUNT(*) FROM {table_name}")
                    count = cur.fetchone()[0]
                    result.append({"table": table_name, "row_count": count})
                except Exception:
                    result.append({"table": table_name, "row_count": -1})

            return result
    finally:
        _return_conn(conn)


def describe_table(table_name: str) -> List[Dict[str, Any]]:
    """Describe columns of a table."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_name = %s AND table_schema = 'public'
                ORDER BY ordinal_position
            """, (table_name,))
            rows = cur.fetchall()
            return [
                {"column": r[0], "type": r[1], "nullable": r[2] == "YES", "default": r[3]}
                for r in rows
            ]
    finally:
        _return_conn(conn)
