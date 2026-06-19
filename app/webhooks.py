"""
Webhooks module — registration + event dispatcher.

v2.3: Provides a lightweight pub/sub system for management events.
Other modules (mgmt router, ban router, audit middleware) call
``dispatch_event(event_type, payload)`` and all registered webhooks
whose ``events`` list contains that event type receive an HTTP POST
with a JSON body and HMAC-SHA256 signature.

Webhooks are stored in PostgreSQL (table ``mgmt_webhooks``) and
persisted across server restarts. Delivery is fire-and-forget with
exponential backoff (3 attempts: 1s, 5s, 30s). Failed deliveries
bump ``failure_count``; after 10 consecutive failures the webhook
is auto-disabled.

Supported event types:
    user.created, user.updated, user.deleted, user.disabled,
    user.enabled, user.password_reset,
    key.created, key.rotated, key.disabled, key.deleted,
    role.created, role.updated, role.deleted, role.disabled,
    role.enabled,
    ban.created, ban.lifted,
    auth.login_success, auth.login_failure,
    cfg.updated, cfg.deleted,
    backup.created, backup.restored
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Schema (added to mgmt_db._SCHEMA via migration) ────────────────────

WEBHOOK_SCHEMA = """
CREATE TABLE IF NOT EXISTS mgmt_webhooks (
    id              SERIAL PRIMARY KEY,
    url             TEXT NOT NULL,
    secret          TEXT DEFAULT '',
    events          JSONB DEFAULT '[]',
    description     TEXT DEFAULT '',
    is_active       BOOLEAN DEFAULT TRUE,
    failure_count   INTEGER DEFAULT 0,
    last_delivery_at TEXT,
    last_status     INTEGER,
    created_at      TEXT,
    updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_mgmt_webhooks_active ON mgmt_webhooks(is_active);
"""

# ── In-memory event queue + worker thread ───────────────────────────────

_queue: List[Dict[str, Any]] = []
_queue_lock = threading.Lock()
_worker_started = False


def _ensure_worker_started() -> None:
    """Start the background delivery worker (once per process)."""
    global _worker_started
    if _worker_started:
        return
    _worker_started = True
    t = threading.Thread(target=_delivery_worker, name="webhook-worker", daemon=True)
    t.start()
    logger.info("[webhooks] delivery worker started")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── DB helpers ──────────────────────────────────────────────────────────

def _get_conn():
    from app.mgmt_db import _get_conn as _mgmt_get_conn
    return _mgmt_get_conn()


def _return_conn(conn):
    from app.mgmt_db import _return_conn as _mgmt_return_conn
    _mgmt_return_conn(conn)


def list_webhooks(include_inactive: bool = False) -> List[Dict[str, Any]]:
    """List all registered webhooks."""
    cond = "" if include_inactive else "WHERE is_active = TRUE"
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, url, secret, events, description, is_active, "
                f"failure_count, last_delivery_at, last_status, created_at, updated_at "
                f"FROM mgmt_webhooks {cond} ORDER BY id"
            )
            rows = cur.fetchall()
            results = []
            for r in rows:
                events = r[2]
                if isinstance(events, str):
                    try:
                        events = json.loads(events)
                    except json.JSONDecodeError:
                        events = []
                results.append({
                    "id": r[0], "url": r[1], "secret": r[2],
                    "events": events or [], "description": r[3],
                    "is_active": bool(r[4]), "failure_count": r[5] or 0,
                    "last_delivery_at": r[6], "last_status": r[7],
                    "created_at": r[8], "updated_at": r[9],
                })
            return results
    finally:
        _return_conn(conn)


def create_webhook(url: str, events: List[str], secret: str = "",
                   description: str = "") -> Dict[str, Any]:
    """Register a new webhook."""
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO mgmt_webhooks (url, secret, events, description, is_active, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (url, secret, json.dumps(sorted(set(events))), description, True, now, now),
            )
            wh_id = cur.fetchone()[0]
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return {"id": wh_id, "url": url, "events": sorted(set(events)),
            "description": description, "is_active": True}


def update_webhook(wh_id: int, **kwargs: Any) -> Optional[Dict[str, Any]]:
    """Update webhook fields. Accepted: url, secret, events, description, is_active."""
    allowed = {"url", "secret", "events", "description", "is_active"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if "events" in updates and isinstance(updates["events"], list):
        updates["events"] = json.dumps(sorted(set(updates["events"])))
    if not updates:
        return get_webhook(wh_id)
    updates["updated_at"] = _now_iso()
    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [wh_id]
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE mgmt_webhooks SET {set_clause} WHERE id = %s", values)
            if cur.rowcount == 0:
                return None
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)
    return get_webhook(wh_id)


def delete_webhook(wh_id: int) -> bool:
    """Permanently delete a webhook."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM mgmt_webhooks WHERE id = %s", (wh_id,))
            deleted = cur.rowcount > 0
        conn.commit()
        return deleted
    except Exception:
        conn.rollback()
        return False
    finally:
        _return_conn(conn)


def get_webhook(wh_id: int) -> Optional[Dict[str, Any]]:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, url, secret, events, description, is_active, "
                "failure_count, last_delivery_at, last_status, created_at, updated_at "
                "FROM mgmt_webhooks WHERE id = %s", (wh_id,)
            )
            r = cur.fetchone()
            if not r:
                return None
            events = r[2]
            if isinstance(events, str):
                try:
                    events = json.loads(events)
                except json.JSONDecodeError:
                    events = []
            return {
                "id": r[0], "url": r[1], "secret": r[2],
                "events": events or [], "description": r[3],
                "is_active": bool(r[4]), "failure_count": r[5] or 0,
                "last_delivery_at": r[6], "last_status": r[7],
                "created_at": r[8], "updated_at": r[9],
            }
    finally:
        _return_conn(conn)


# ── Dispatch ────────────────────────────────────────────────────────────

def dispatch_event(event_type: str, payload: Dict[str, Any]) -> None:
    """Queue an event for delivery to all matching webhooks.

    Non-blocking — appends to in-memory queue and returns immediately.
    The background worker picks it up and delivers.
    """
    _ensure_worker_started()
    with _queue_lock:
        _queue.append({
            "event_type": event_type,
            "payload": payload,
            "queued_at": _now_iso(),
        })


def _delivery_worker() -> None:
    """Background thread that drains the queue and delivers webhooks."""
    import requests
    while True:
        try:
            with _queue_lock:
                if not _queue:
                    job = None
                else:
                    job = _queue.pop(0)
            if job is None:
                time.sleep(0.5)
                continue

            # Find matching webhooks
            try:
                webhooks = list_webhooks(include_inactive=False)
            except Exception:
                logger.debug("[webhooks] failed to list webhooks", exc_info=True)
                continue

            for wh in webhooks:
                events = wh.get("events", [])
                if event_matches(events, job["event_type"]):
                    _deliver_one(requests, wh, job)

        except Exception:
            logger.debug("[webhooks] worker iteration failed", exc_info=True)
            time.sleep(1.0)


def event_matches(subscribed_events: List[str], event_type: str) -> bool:
    """Check whether any subscribed event matches.

    Supports exact match and prefix wildcard: ``user.*`` matches
    ``user.created``, ``user.updated``, etc.
    """
    for ev in subscribed_events:
        if ev == event_type:
            return True
        if ev.endswith(".*"):
            prefix = ev[:-2]
            if event_type.startswith(prefix + "."):
                return True
        if ev == "*":
            return True
    return False


def _deliver_one(requests, wh: Dict[str, Any], job: Dict[str, Any]) -> None:
    """Deliver one event to one webhook with 3 retries + auto-disable."""
    url = wh["url"]
    secret = wh.get("secret", "")
    body = {
        "event": job["event_type"],
        "payload": job["payload"],
        "timestamp": job["queued_at"],
        "webhook_id": wh["id"],
    }
    body_bytes = json.dumps(body, ensure_ascii=False).encode("utf-8")

    # HMAC-SHA256 signature (so receiver can verify authenticity)
    signature = ""
    if secret:
        signature = hmac.new(
            secret.encode("utf-8"), body_bytes, hashlib.sha256
        ).hexdigest()

    headers = {
        "Content-Type": "application/json",
        "X-Webhook-Event": job["event_type"],
        "X-Webhook-Id": str(wh["id"]),
        "X-Webhook-Timestamp": job["queued_at"],
    }
    if signature:
        headers["X-Webhook-Signature"] = signature

    backoffs = [1, 5, 30]
    last_status = None
    success = False
    for attempt, delay in enumerate([0] + backoffs):
        if delay > 0:
            time.sleep(delay)
        try:
            resp = requests.post(url, data=body_bytes, headers=headers, timeout=15)
            last_status = resp.status_code
            if 200 <= resp.status_code < 300:
                success = True
                break
            elif resp.status_code >= 400 and resp.status_code < 500:
                # 4xx — do not retry, the URL/config is wrong
                break
        except Exception as exc:
            logger.debug("[webhooks] delivery failed (attempt %d): %s",
                         attempt + 1, exc, exc_info=True)
            last_status = None

    # Update webhook status
    _update_delivery_status(wh["id"], success, last_status)


def _update_delivery_status(wh_id: int, success: bool, last_status: Optional[int]) -> None:
    now = _now_iso()
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            if success:
                cur.execute(
                    "UPDATE mgmt_webhooks SET failure_count = 0, "
                    "last_delivery_at = %s, last_status = %s, updated_at = %s WHERE id = %s",
                    (now, last_status, now, wh_id),
                )
            else:
                # Bump failure_count, auto-disable at 10
                cur.execute(
                    "UPDATE mgmt_webhooks SET failure_count = failure_count + 1, "
                    "last_delivery_at = %s, last_status = %s, updated_at = %s, "
                    "is_active = CASE WHEN failure_count + 1 >= 10 THEN FALSE ELSE is_active END "
                    "WHERE id = %s",
                    (now, last_status, now, wh_id),
                )
        conn.commit()
    except Exception:
        conn.rollback()
        logger.debug("[webhooks] failed to update delivery status", exc_info=True)
    finally:
        _return_conn(conn)


# ── Convenience: emit events from existing mgmt operations ──────────────

def emit_user_event(event: str, user: Dict[str, Any]) -> None:
    """Helper for mgmt router to emit user-related events safely."""
    try:
        # Don't leak password_hash
        safe = {k: v for k, v in user.items() if k != "password_hash"}
        dispatch_event(f"user.{event}", {"user": safe})
    except Exception:
        logger.debug("[webhooks] emit_user_event failed", exc_info=True)


def emit_key_event(event: str, key: Dict[str, Any]) -> None:
    try:
        safe = {k: v for k, v in key.items() if k not in ("key_hash", "key")}
        dispatch_event(f"key.{event}", {"key": safe})
    except Exception:
        logger.debug("[webhooks] emit_key_event failed", exc_info=True)


def emit_role_event(event: str, role: Dict[str, Any]) -> None:
    try:
        dispatch_event(f"role.{event}", {"role": role})
    except Exception:
        logger.debug("[webhooks] emit_role_event failed", exc_info=True)


def emit_ban_event(event: str, ban: Dict[str, Any]) -> None:
    try:
        dispatch_event(f"ban.{event}", {"ban": ban})
    except Exception:
        logger.debug("[webhooks] emit_ban_event failed", exc_info=True)


def emit_auth_event(event: str, username: str, ip: str = "",
                    user_id: Optional[int] = None) -> None:
    try:
        dispatch_event(f"auth.{event}", {
            "username": username, "ip": ip, "user_id": user_id,
        })
    except Exception:
        logger.debug("[webhooks] emit_auth_event failed", exc_info=True)


def emit_cfg_event(event: str, key: str) -> None:
    try:
        dispatch_event(f"cfg.{event}", {"key": key})
    except Exception:
        logger.debug("[webhooks] emit_cfg_event failed", exc_info=True)


def emit_backup_event(event: str, filename: str, size_bytes: int = 0) -> None:
    try:
        dispatch_event(f"backup.{event}", {
            "filename": filename, "size_bytes": size_bytes,
        })
    except Exception:
        logger.debug("[webhooks] emit_backup_event failed", exc_info=True)


# ── Schema migration hook ───────────────────────────────────────────────

def ensure_schema() -> None:
    """Called from app.mgmt_db.init_db to create the webhooks table."""
    from app.mgmt_db import _get_conn, _return_conn
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(WEBHOOK_SCHEMA)
        conn.commit()
    except Exception:
        conn.rollback()
        logger.debug("[webhooks] schema migration failed", exc_info=True)
    finally:
        _return_conn(conn)
