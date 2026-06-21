"""
SQLAlchemy 2.0 unified DB layer for WEBADC.

v3.0 — Single source of truth via DB_URL (default ``sqlite:///app.db``).

This module is the *new* foundation. The legacy psycopg2 modules
(``app.mgmt_db``, ``app.chat_db``, ``app.ban_db``) remain functional
during the migration period; new code should target this module and
the models in ``app.models_sqla``.

Public API::

    from app.db_sqlalchemy import engine, Session, Base, get_db, init_db

    # Inside a FastAPI route — yields a scoped session, auto-closed:
    @router.get("/items")
    def list_items(db: Session = Depends(get_db)):
        return db.query(Item).all()

    # Outside FastAPI — use the session factory directly:
    from app.db_sqlalchemy import SessionLocal
    with SessionLocal() as db:
        ...

DB_URL is read once from settings at first import. It supports any
SQLAlchemy backend (SQLite, PostgreSQL, MySQL, etc.). For SQLite we
enable ``check_same_thread=False`` so the engine is safe across
threads (FastAPI runs sync routes in a threadpool).
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import (
    sessionmaker,
    Session,
)

# Import Base from models_sqla.base so all code shares a single
# declarative metadata. Defining Base here would create a *different*
# metadata than the one models register on, and create_all() would
# silently do nothing.
from app.models_sqla.base import Base  # noqa: F401 — re-exported

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
#  Settings access — lazy, so config.py changes are picked up at runtime
# ═══════════════════════════════════════════════════════════════════════


def _resolve_db_url() -> str:
    """Return the effective DB_URL, applying fallbacks.

    Priority:
      1. Explicit SAMBA_DB_URL / DB_URL from settings.
      2. Hard-coded SQLite default (project-local ``app.db``).
    """
    try:
        from app.config import get_settings
        s = get_settings()
        url = (getattr(s, "DB_URL", "") or "").strip()
        if url:
            return url
    except Exception as exc:  # noqa: BLE001
        logger.debug("[db_sqlalchemy] settings not available yet: %s", exc)
    # Hard fallback (e.g. when settings haven't been initialised)
    return os.environ.get("DB_URL") or os.environ.get("SAMBA_DB_URL") or "sqlite:///app.db"


def _resolve_sqlite_path(db_url: str) -> Optional[Path]:
    """Extract the on-disk SQLite file path from a sqlite:/// URL.

    Returns None for non-sqlite URLs or in-memory databases.
    """
    if not db_url.startswith("sqlite:///"):
        return None
    tail = db_url[len("sqlite:///"):]
    if not tail or tail == ":memory:":
        return None
    # sqlite:///app.db       → "app.db"      (relative)
    # sqlite:////var/lib/... → "/var/lib/..." (absolute, four slashes)
    if tail.startswith("/"):
        return Path(tail)
    return Path.cwd() / tail


# ═══════════════════════════════════════════════════════════════════════
#  Engine + session factory
# ═══════════════════════════════════════════════════════════════════════


_engine: Optional[Engine] = None
_SessionLocal: Optional[sessionmaker] = None
_db_url_cache: Optional[str] = None


def _build_engine(db_url: str) -> Engine:
    """Construct a SQLAlchemy engine with backend-appropriate kwargs."""
    is_sqlite = db_url.startswith("sqlite")
    is_postgres = db_url.startswith("postgresql")
    is_duckdb = db_url.startswith("duckdb")

    # v3.3.8 — pe-a-1.4: auto-create DB directory for SQLite
    # (e.g. sqlite:///DB/app.db needs DB/ to exist)
    if is_sqlite:
        sqlite_path = _resolve_sqlite_path(db_url)
        if sqlite_path is not None:
            try:
                sqlite_path.parent.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                logger.warning(
                    "[db_sqlalchemy] Cannot create DB directory %s: %s",
                    sqlite_path.parent, exc,
                )

    echo = False
    try:
        from app.config import get_settings
        echo = bool(getattr(get_settings(), "DB_ECHO", False))
    except Exception:  # noqa: BLE001
        pass

    engine_kwargs: dict = {
        "echo": echo,
        "future": True,
    }
    if is_sqlite:
        # SQLite-specific: disable check_same_thread so the engine is safe
        # across FastAPI's sync-route threadpool. Pool serialises writes.
        engine_kwargs["connect_args"] = {"check_same_thread": False}
    elif is_postgres:
        engine_kwargs["pool_pre_ping"] = True
        try:
            from app.config import get_settings
            s = get_settings()
            engine_kwargs["pool_size"] = getattr(s, "DB_POOL_SIZE", 5)
            engine_kwargs["max_overflow"] = getattr(s, "DB_POOL_MAX_OVERFLOW", 10)
        except Exception:  # noqa: BLE001
            pass

    engine = create_engine(db_url, **engine_kwargs)

    if is_sqlite:
        @event.listens_for(engine, "connect")
        def _set_sqlite_pragma(dbapi_conn, _record):  # noqa: ANN001
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA busy_timeout=5000")
            cur.close()

    if is_duckdb:
        logger.info("[db_sqlalchemy] DuckDB engine created (analytics-only).")

    logger.info(
        "[db_sqlalchemy] Engine created: %s (echo=%s, kwargs=%s)",
        _safe_url_for_log(db_url), echo, list(engine_kwargs.keys()),
    )
    return engine


def _safe_url_for_log(db_url: str) -> str:
    """Mask password in DB URL for log output."""
    if "@" in db_url and "://" in db_url:
        try:
            scheme, rest = db_url.split("://", 1)
            if ":" in rest.split("@", 1)[0]:
                creds, host_part = rest.split("@", 1)
                user = creds.split(":", 1)[0]
                return f"{scheme}://{user}:***@{host_part}"
        except Exception:  # noqa: BLE001
            pass
    return db_url


def get_engine() -> Engine:
    """Return the global engine, building it on first call."""
    global _engine, _db_url_cache
    if _engine is not None and _db_url_cache == _resolve_db_url():
        return _engine
    db_url = _resolve_db_url()
    _engine = _build_engine(db_url)
    _db_url_cache = db_url
    return _engine


def get_session_factory() -> sessionmaker:
    """Return the module-level sessionmaker, building it on first call."""
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(
            bind=get_engine(),
            autoflush=False,
            autocommit=False,
            expire_on_commit=False,
            class_=Session,
            future=True,
        )
    return _SessionLocal


# Convenience aliases (evaluated lazily via module __getattr__ to avoid
# building the engine at import time — important for tests).
def __getattr__(name):  # noqa: D401
    if name == "engine":
        return get_engine()
    if name == "SessionLocal":
        return get_session_factory()
    raise AttributeError(f"module 'app.db_sqlalchemy' has no attribute {name!r}")


# ═══════════════════════════════════════════════════════════════════════
#  Declarative base
# ═══════════════════════════════════════════════════════════════════════
# ``Base`` is re-exported from ``app.models_sqla.base`` at the top of
# this file. Defining it here would create a second metadata instance
# and break ``Base.metadata.create_all()`` — see the import comment above.


# ═══════════════════════════════════════════════════════════════════════
#  FastAPI dependency + context manager
# ═══════════════════════════════════════════════════════════════════════


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a Session, rolled back on exception.

    Usage::

        @router.get("/items")
        def list_items(db: Session = Depends(get_db)):
            return db.query(Item).all()
    """
    factory = get_session_factory()
    db = factory()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Context manager for non-FastAPI code.

    Commits on clean exit, rolls back on exception::

        with session_scope() as db:
            db.add(User(...))
    """
    factory = get_session_factory()
    db = factory()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════
#  Lifecycle helpers
# ═══════════════════════════════════════════════════════════════════════


def init_db(seed: bool = True) -> None:
    """Create all tables (Base.metadata.create_all) + optional seed.

    Idempotent — safe to call on every startup. Tables that already
    exist are left untouched. This is the single entry point invoked
    from ``app.main.lifespan``.

    For schema *migrations* (ALTER TABLE, column renames, etc.) use
    Alembic instead::

        alembic upgrade head
    """
    # Import models so they register on Base.metadata before create_all
    from app import models_sqla  # noqa: F401 — side-effect import

    engine_ = get_engine()
    Base.metadata.create_all(bind=engine_)
    logger.info("[db_sqlalchemy] create_all complete on %s", _safe_url_for_log(_resolve_db_url()))

    if seed:
        try:
            from app.db_init import seed_defaults
            return seed_defaults()
        except Exception as exc:  # noqa: BLE001
            logger.warning("[db_sqlalchemy] seed_defaults failed: %s", exc)
            return None
    return None


def dispose_engine() -> None:
    """Dispose of the engine and reset module state (for tests/reloads)."""
    global _engine, _SessionLocal, _db_url_cache
    if _engine is not None:
        try:
            _engine.dispose()
        except Exception:  # noqa: BLE001
            pass
    _engine = None
    _SessionLocal = None
    _db_url_cache = None
