"""Alembic environment for WEBADC v3.0.

Reads DB_URL from ``app.config`` (or ``DB_URL``/``SAMBA_DB_URL`` env
vars) and runs migrations in **online** mode by default. For offline
mode (emit SQL to stdout) use::

    alembic upgrade head --sql

The target metadata is ``Base.metadata`` from ``app.db_sqlalchemy``,
imported via ``app.models_sqla`` so every model is registered before
``env.py`` reads metadata.
"""

from __future__ import annotations

import logging
import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# Ensure the project root is on sys.path so ``app.*`` imports work
# regardless of where ``alembic`` was invoked from.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# This must come BEFORE importing app.* so .env is loaded.
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

logger = logging.getLogger("alembic.env")


def _resolve_url() -> str:
    """Resolve the DB URL from app config (or env)."""
    # 1. CLI override via --x db-url=...
    x_url = context.get_x_argument(as_dictionary=True).get("db-url")
    if x_url:
        return x_url

    # 2. sqlalchemy.url in alembic.ini (if someone hardcoded it)
    ini_url = config.get_main_option("sqlalchemy.url")
    if ini_url:
        return ini_url

    # 3. app.config.Settings.DB_URL (reads .env)
    try:
        from app.config import get_settings
        s = get_settings()
        url = (getattr(s, "DB_URL", "") or "").strip()
        if url:
            return url
    except Exception as exc:  # noqa: BLE001
        logger.debug("app.config unavailable, falling back to env: %s", exc)

    # 4. Raw env vars
    return os.environ.get("DB_URL") or os.environ.get("SAMBA_DB_URL") or "sqlite:///app.db"


def _target_metadata():
    """Import all models so they register on Base.metadata, then return it."""
    from app.db_sqlalchemy import Base
    import app.models_sqla  # noqa: F401 — side-effect: registers models
    return Base.metadata


target_metadata = _target_metadata()


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode — emit SQL to stdout."""
    url = _resolve_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode — connect to the DB and apply."""
    url = _resolve_url()
    cfg = config.get_section(config.config_ini_section, {}) or {}
    cfg["sqlalchemy.url"] = url

    # SQLite-specific tweaks (must match app.db_sqlalchemy._build_engine)
    is_sqlite = url.startswith("sqlite")
    connectable = engine_from_config(
        cfg,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool if is_sqlite else pool.QueuePool,
        future=True,
        # SQLite needs check_same_thread=False under Alembic too, but
        # NullPool on a fresh connection per migration is simpler.
        connect_args={"check_same_thread": False} if is_sqlite else {},
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            render_as_batch=is_sqlite,  # SQLite ALTER TABLE support
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
