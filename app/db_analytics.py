"""
DuckDB read-only analytics layer over the main DB.

v3.0 — Uses DuckDB's ``ATTACH`` statement to mount the SQLite file in
read-only mode, then runs analytical SQL (GROUP BY, window functions,
PIVOT, etc.) that SQLite itself handles poorly or not at all.

Use cases:
  - Dashboard aggregations (e.g. audit-log events per hour per user)
  - Top-N reports with RANK / DENSE_RANK
  - Pivoting chat message counts by day-of-week
  - JSON extraction (DuckDB has native JSON ops; SQLite's JSON1 is
    optional)

Important: this module is **read-only**. All writes go through the
SQLAlchemy layer. DuckDB connections are short-lived (created per
query) to avoid file-lock contention with SQLite writers.

If the main DB is not a SQLite file (e.g. PostgreSQL), the module
auto-disables itself and ``query()`` falls back to running the SQL
directly on the SQLAlchemy engine.
"""

from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.db_sqlalchemy import _resolve_db_url, _resolve_sqlite_path

logger = logging.getLogger(__name__)

_duck_available: Optional[bool] = None
_duck_lock = threading.Lock()


def _duckdb_importable() -> bool:
    """True if the ``duckdb`` Python package is installed."""
    global _duck_available
    if _duck_available is not None:
        return _duck_available
    try:
        import duckdb  # noqa: F401
        _duck_available = True
    except ImportError:
        _duck_available = False
        logger.info("[db_analytics] duckdb package not installed — analytics layer disabled")
    return _duck_available


def is_enabled() -> bool:
    """True if the analytics layer can be used (SQLite + duckdb + flag)."""
    try:
        from app.config import get_settings
        s = get_settings()
        if not getattr(s, "DB_DUCKDB_ENABLED", True):
            return False
    except Exception:  # noqa: BLE001
        pass
    return _duckdb_importable() and _resolve_sqlite_path(_resolve_db_url()) is not None


@contextmanager
def _duck_conn():
    """Open a short-lived DuckDB connection with the SQLite file attached.

    The SQLite file is mounted read-only under the alias ``app`` so
    queries reference tables as ``app.mgmt_users``, ``app.chat_messages``
    etc. — same names as in the SQLAlchemy layer but prefixed.

    Yields the duckdb.Connection. Auto-closes on exit.
    """
    if not _duckdb_importable():
        raise RuntimeError("duckdb package is not installed — install with: pip install duckdb")

    sqlite_path = _resolve_sqlite_path(_resolve_db_url())
    if sqlite_path is None:
        raise RuntimeError(
            "DuckDB analytics layer requires a SQLite DB_URL. "
            f"Current DB_URL = {_resolve_db_url()!r}"
        )
    if not sqlite_path.exists():
        raise FileNotFoundError(
            f"SQLite file not found at {sqlite_path} — call init_db() first"
        )

    import duckdb

    with _duck_lock:
        conn = duckdb.connect(":memory:", read_only=False)
        try:
            # ATTACH the SQLite file as read-only. DuckDB's sqlite_scanner
            # extension is auto-loaded by ATTACH on recent versions.
            conn.execute(
                f"ATTACH '{sqlite_path.as_posix()}' AS app (TYPE sqlite, READ_ONLY)"
            )
            yield conn
        finally:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass


def query(sql: str, params: Optional[List[Any]] = None) -> List[Dict[str, Any]]:
    """Run an analytical SQL query and return rows as dicts.

    Tables from the SQLite file are accessible under the ``app.``
    schema (e.g. ``SELECT * FROM app.mgmt_audit_log``).

    If the DuckDB layer is disabled (no duckdb / non-sqlite DB_URL),
    the query is executed on the SQLAlchemy engine instead. Note that
    DuckDB-specific syntax (e.g. ``PIVOT``, ``UNNEST``) will fail in
    that fallback path — keep analytical SQL portable if you rely on
    this.

    Examples::

        from app.db_analytics import query

        rows = query('''
            SELECT date_trunc('hour', timestamp::TIMESTAMP) AS hour,
                   COUNT(*) AS events
            FROM app.mgmt_audit_log
            WHERE timestamp >= '2026-06-01'
            GROUP BY hour
            ORDER BY hour
        ''')
    """
    sql = (sql or "").strip()
    if not sql:
        return []

    if is_enabled():
        try:
            with _duck_conn() as conn:
                cur = conn.execute(sql, params or [])
                cols = [d[0] for d in cur.description] if cur.description else []
                rows = cur.fetchall()
                return [dict(zip(cols, r)) for r in rows]
        except Exception as exc:  # noqa: BLE001
            logger.warning("[db_analytics] duckdb query failed, falling back to SQLAlchemy: %s", exc)

    # Fallback: run on SQLAlchemy engine (sync)
    from app.db_sqlalchemy import get_engine
    from sqlalchemy import text

    engine = get_engine()
    with engine.connect() as conn:
        cur = conn.execute(text(sql), params or {})
        if cur.returns_rows:
            cols = list(cur.keys())
            return [dict(zip(cols, r)) for r in cur.fetchall()]
    return []


def stats() -> Dict[str, Any]:
    """Return a small health-check report for the analytics layer."""
    info: Dict[str, Any] = {
        "enabled": is_enabled(),
        "duckdb_installed": _duckdb_importable(),
        "db_url": _resolve_db_url(),
    }
    sqlite_path = _resolve_sqlite_path(_resolve_db_url())
    if sqlite_path is not None:
        info["sqlite_path"] = str(sqlite_path)
        info["sqlite_exists"] = sqlite_path.exists()
        if sqlite_path.exists():
            info["sqlite_size_bytes"] = sqlite_path.stat().st_size
    return info
