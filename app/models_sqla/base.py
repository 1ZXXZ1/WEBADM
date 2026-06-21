"""Shared base + helpers for SQLAlchemy models."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Shared declarative base.

    Re-exported from ``app.db_sqlalchemy`` so all code can import from
    a single place. We define it here to break a circular import
    (``db_sqlalchemy`` imports ``models_sqla`` in ``init_db``; if
    ``models_sqla`` imported ``Base`` from ``db_sqlalchemy`` at module
    load time, we'd get an ImportError).
    """

    pass


def now_iso() -> str:
    """Return current UTC time as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()
