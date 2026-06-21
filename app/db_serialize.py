"""
DB serialization: dump / restore / transfer between any SQLAlchemy backends.

v3.2 — Portable cross-backend data movement.

Why JSONL and not SQL dumps?
  SQL dialects differ (SERIAL vs AUTOINCREMENT, JSONB vs TEXT, ON CONFLICT
  syntax, etc.). JSONL is a *logical* format — one row = one JSON object —
  that any backend can ingest. Schema is created separately via
  ``init_db()`` or ``alembic upgrade head``.

Format::

    Line 1:  {"_meta": true, "source_url": "...", "dumped_at": "...", "tables": [...]}
    Line 2+: {"_table": "mgmt_users", "data": {"id": 1, "username": "admin", ...}}
    ...

Public API::

    from app.db_serialize import dump_db, restore_db, transfer_db

    # Backup current DB to file
    dump_db(out_path="backup.jsonl")

    # Restore into current DB (skip existing PKs)
    restore_db("backup.jsonl", mode="skip")

    # Direct DB-to-DB copy (no intermediate file)
    transfer_db(
        from_url="postgresql+psycopg2://user:pwd@host/db",
        to_url="sqlite:///app.db",
    )

Tables are inserted in FK-dependency order (parents first) so that
child rows can reference parent IDs. For SQLite, FK checks are
temporarily disabled during restore. For PostgreSQL, sequences are
reset to MAX(id)+1 after manual inserts (otherwise next INSERT would
collide with restored IDs).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Set

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
#  Tables in FK-dependency order (parents first)
# ═══════════════════════════════════════════════════════════════════════

TABLE_ORDER: List[str] = [
    # mgmt (no FKs)
    "mgmt_users",
    "mgmt_roles",
    "mgmt_api_keys",        # logical FK → mgmt_users (not enforced in SQLite)
    "mgmt_audit_log",
    "mgmt_bans",
    # ai_chat
    "ai_chat_sessions",
    "ai_chat_messages",     # FK → ai_chat_sessions
    # chat
    "chat_rooms",
    "chat_members",         # FK → chat_rooms
    "chat_messages",        # FK → chat_rooms + self-ref
    "chat_attachments",     # FK → chat_messages
    "chat_reactions",       # FK → chat_messages
    "chat_stars",           # FK → chat_messages
    "chat_read_receipts",   # FK → chat_messages
    "chat_calls",
    "chat_call_participants",
]

# Tables we never dump (migration state, not application data)
SKIP_TABLES = {"alembic_version"}


# ═══════════════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════════════


def _ordered_tables(engine: Engine) -> List[str]:
    """Return tables present in the DB, ordered by FK dependencies."""
    insp = inspect(engine)
    present = set(insp.get_table_names())
    ordered = [t for t in TABLE_ORDER if t in present]
    # Forward-compat: append unknown tables at the end
    extras = sorted(present - set(TABLE_ORDER) - SKIP_TABLES)
    return ordered + extras


def _rows_iter(engine: Engine, table: str) -> Iterator[Dict[str, Any]]:
    """Yield all rows from a table as dicts."""
    with engine.connect() as conn:
        result = conn.execute(text(f"SELECT * FROM {table}"))
        cols = list(result.keys())
        for row in result:
            yield dict(zip(cols, row))


def _clean_value(v: Any) -> Any:
    """Convert a DB value to a JSON-serializable Python value."""
    if isinstance(v, (bytes, bytearray, memoryview)):
        return bytes(v).decode("utf-8", errors="replace")
    if hasattr(v, "isoformat"):
        # date / datetime / time
        return v.isoformat()
    if isinstance(v, (int, float, str, bool, type(None))):
        return v
    # Fallback: stringify (shouldn't normally hit this)
    return str(v)


def _clean_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {k: _clean_value(v) for k, v in row.items()}


def _mask_url(url: str) -> str:
    """Mask password in URL for logging/metadata."""
    if "@" in url and "://" in url:
        try:
            scheme, rest = url.split("://", 1)
            creds, host = rest.split("@", 1)
            user = creds.split(":", 1)[0]
            return f"{scheme}://{user}:***@{host}"
        except Exception:  # noqa: BLE001
            pass
    return url


def _get_pk_cols(engine: Engine, table: str) -> List[str]:
    insp = inspect(engine)
    pk = insp.get_pk_constraint(table)
    return pk.get("constrained_columns", []) or []


def _reset_pg_sequences(engine: Engine, conn) -> None:
    """Reset PostgreSQL SERIAL/IDENTITY sequences to MAX(id)+1.

    When you INSERT rows with explicit IDs (as we do during restore),
    PostgreSQL's sequence doesn't advance — next INSERT without an ID
    would collide. This brings the sequence back in sync.
    """
    insp = inspect(engine)
    for table in insp.get_table_names():
        if table in SKIP_TABLES:
            continue
        try:
            pk_cols = _get_pk_cols(engine, table)
            if len(pk_cols) != 1:
                continue
            pk = pk_cols[0]
            seq_name = conn.execute(
                text(f"SELECT pg_get_serial_sequence('{table}', '{pk}')")
            ).scalar()
            if seq_name:
                conn.execute(text(
                    f"SELECT setval('{seq_name}', "
                    f"COALESCE((SELECT MAX({pk}) FROM {table}), 0) + 1, false)"
                ))
        except Exception as exc:
            logger.debug("[pg_seq] skip %s: %s", table, exc)


# ═══════════════════════════════════════════════════════════════════════
#  Schema sync — additive-only ALTER TABLE for missing columns/tables
# ═══════════════════════════════════════════════════════════════════════


# Map SQLAlchemy generic types to dialect-specific DDL strings.
# We use loose type inference — the goal is just "store the data",
# not "preserve exact type semantics". All bets are off on edge cases
# like arrays, custom types, etc.
def _map_col_type(sa_type: Any, dst_dialect: str) -> str:
    """Map a SQLAlchemy column type to a DDL string for the target dialect."""
    type_name = type(sa_type).__name__.upper()
    # stringify for inspection
    s = str(sa_type).upper()

    # Boolean
    if "BOOLEAN" in type_name or "BOOL" in s:
        return "BOOLEAN" if dst_dialect != "sqlite" else "BOOLEAN"
    # Integer family
    if any(k in type_name for k in ("INTEGER", "INT", "BIGIN", "SMALLINT", "TINYINT")):
        if "BIGINT" in s or "BIGINT" in type_name:
            return "BIGINT"
        return "INTEGER"
    # Float / Numeric
    if any(k in type_name for k in ("FLOAT", "REAL", "NUMERIC", "DECIMAL", "DOUBLE")):
        return "REAL" if dst_dialect == "sqlite" else "DOUBLE PRECISION"
    # Text family
    if any(k in type_name for k in ("TEXT", "VARCHAR", "CHAR", "STRING", "CLOB")):
        return "TEXT"
    # Binary
    if any(k in type_name for k in ("BLOB", "BINARY", "BYTEA", "VARBINARY")):
        return "BLOB" if dst_dialect == "sqlite" else "BYTEA"
    # JSON
    if "JSON" in type_name or "JSONB" in s:
        # SQLite has no native JSON type — TEXT works, SQLAlchemy
        # serialises/deserialises on the Python side.
        return "TEXT" if dst_dialect == "sqlite" else "JSONB"
    # Datetime / Date / Time — stored as TEXT in SQLite, TIMESTAMP in PG
    if any(k in type_name for k in ("DATETIME", "TIMESTAMP", "DATE", "TIME")):
        return "TEXT" if dst_dialect == "sqlite" else "TIMESTAMP"
    # UUID
    if "UUID" in type_name:
        return "TEXT" if dst_dialect == "sqlite" else "UUID"
    # Fallback: TEXT (works for almost anything)
    return "TEXT"


def _sync_schema(
    src_engine: Engine,
    dst_engine: Engine,
    tables: List[str],
) -> Dict[str, Any]:
    """Ensure target has all tables/columns that source has.

    Additive only — never drops or modifies existing columns. Creates
    missing tables and adds missing columns via ALTER TABLE.

    Returns a report dict ``{tables_created, columns_added, skipped}``.
    """
    src_insp = inspect(src_engine)
    dst_insp = inspect(dst_engine)
    dst_dialect = dst_engine.dialect.name

    report: Dict[str, Any] = {
        "tables_created": [],
        "columns_added": [],
        "skipped": [],
    }

    for table in tables:
        if not src_insp.has_table(table):
            logger.debug("[sync] source has no table %s — skipping", table)
            continue

        src_cols = {c["name"]: c for c in src_insp.get_columns(table)}

        if not dst_insp.has_table(table):
            # Create the table on target with simple TEXT/INTEGER columns.
            # We don't try to preserve types perfectly — the goal is to
            # not lose data. User can run a proper migration later.
            col_defs = []
            pk_cols = _get_pk_cols(src_engine, table)
            for name, col in src_cols.items():
                col_type = _map_col_type(col["type"], dst_dialect)
                is_pk = name in pk_cols
                nullable = col.get("nullable", True)
                if is_pk:
                    col_defs.append(f'"{name}" {col_type} PRIMARY KEY')
                else:
                    null_str = "" if nullable else " NOT NULL"
                    col_defs.append(f'"{name}" {col_type}{null_str}')
            ddl = f'CREATE TABLE "{table}" ({", ".join(col_defs)})'
            with dst_engine.begin() as conn:
                conn.execute(text(ddl))
            report["tables_created"].append(table)
            logger.info("[sync] created table %s on target (%d cols)",
                        table, len(src_cols))
            continue

        # Table exists — check for missing columns
        dst_cols = {c["name"]: c for c in dst_insp.get_columns(table)}
        missing = set(src_cols.keys()) - set(dst_cols.keys())
        if missing:
            with dst_engine.begin() as conn:
                for col_name in missing:
                    src_col = src_cols[col_name]
                    col_type = _map_col_type(src_col["type"], dst_dialect)
                    # SQLite ALTER TABLE ADD COLUMN can't specify NOT NULL
                    # without a DEFAULT — use NULL to be safe.
                    if dst_dialect == "sqlite":
                        ddl = f'ALTER TABLE "{table}" ADD COLUMN "{col_name}" {col_type}'
                    else:
                        ddl = f'ALTER TABLE "{table}" ADD COLUMN "{col_name}" {col_type}'
                    try:
                        conn.execute(text(ddl))
                        report["columns_added"].append(f"{table}.{col_name}")
                        logger.info("[sync] %s: added column %s (%s)",
                                    table, col_name, col_type)
                    except Exception as exc:
                        report["skipped"].append(f"{table}.{col_name}: {exc}")
                        logger.warning("[sync] %s: cannot add column %s: %s",
                                       table, col_name, exc)

    return report


def _get_dst_columns(dst_engine: Engine, table: str) -> Set[str]:
    """Return the set of column names for ``table`` in the target DB."""
    insp = inspect(dst_engine)
    if not insp.has_table(table):
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def _get_dst_not_null_cols(dst_engine: Engine, table: str) -> Dict[str, str]:
    """Return ``{col_name: default_value}`` for NOT NULL columns on target.

    Includes ALL NOT NULL columns (whether or not they have a DB default)
    because SQLAlchemy's ``default=""`` is a Python-side default that the
    DB doesn't know about — when we INSERT with explicit ``None``, the
    DB will reject it even if the column has a Python default.

    Default values are inferred from the column type:
      - BOOLEAN → False
      - INTEGER / BIGINT → 0
      - REAL / FLOAT → 0.0
      - TEXT / VARCHAR → ""
      - else → ""
    """
    insp = inspect(dst_engine)
    if not insp.has_table(table):
        return {}
    result: Dict[str, str] = {}
    for col in insp.get_columns(table):
        if not col.get("nullable", True):
            col_type = str(col.get("type", "")).upper()
            if "BOOL" in col_type:
                result[col["name"]] = False
            elif any(k in col_type for k in ("INT", "BIGIN", "SMALLINT", "TINYINT")):
                result[col["name"]] = 0
            elif any(k in col_type for k in ("FLOAT", "REAL", "NUMERIC", "DECIMAL", "DOUBLE")):
                result[col["name"]] = 0.0
            else:
                result[col["name"]] = ""
    return result


def _coerce_nulls(row: Dict[str, Any], not_null_defaults: Dict[str, Any]) -> Dict[str, Any]:
    """Replace NULL values with defaults for NOT NULL columns.

    Mutates and returns the row. For each col in ``not_null_defaults``,
    if ``row[col] is None``, set it to the default value.
    """
    for col, default in not_null_defaults.items():
        if col in row and row[col] is None:
            row[col] = default
    return row


def _fill_missing_not_null(
    row: Dict[str, Any],
    cols: List[str],
    not_null_defaults: Dict[str, Any],
) -> tuple:
    """Add NOT NULL columns missing from source row + INSERT cols list.

    When source DB has fewer columns than target (schema was extended on
    target after source was created — e.g. ``is_muted`` added on SQLite
    but not present in legacy PostgreSQL), source rows won't contain
    those columns at all. SQLite then rejects the INSERT because the
    NOT NULL column has no value.

    This function:
      1. Finds NOT NULL columns present in target but missing from source
      2. Adds them to ``row`` with sensible defaults
      3. Returns ``(row, cols_extended)`` where ``cols_extended`` is the
         original cols list plus the new column names

    Parameters
    ----------
    row : dict
        Source row (will be mutated).
    cols : list[str]
        Column list used in INSERT statement (will be extended).
    not_null_defaults : dict
        Output of ``_get_dst_not_null_cols()`` — {col: default}.

    Returns
    -------
    tuple
        ``(row, cols_extended)``.
    """
    cols_extended = list(cols)
    for col, default in not_null_defaults.items():
        if col not in row:
            row[col] = default
            cols_extended.append(col)
    return row, cols_extended


# ═══════════════════════════════════════════════════════════════════════
#  dump
# ═══════════════════════════════════════════════════════════════════════


def dump_db(
    db_url: Optional[str] = None,
    out_path: Optional[str] = None,
    tables: Optional[List[str]] = None,
) -> Path:
    """Dump all data from DB to a JSONL file.

    Parameters
    ----------
    db_url : str, optional
        SQLAlchemy URL. Defaults to current DB_URL from settings.
    out_path : str, optional
        Output file path. Defaults to ``app_db_dump_YYYYMMDD_HHMMSS.jsonl``.
    tables : list[str], optional
        Subset of tables to dump. Defaults to all (in FK order).

    Returns
    -------
    Path
        Path to the written dump file.
    """
    if db_url is None:
        from app.db_sqlalchemy import _resolve_db_url
        db_url = _resolve_db_url()

    engine = create_engine(db_url, future=True)
    all_tables = _ordered_tables(engine)
    if tables:
        # Filter to requested tables, preserving FK order
        wanted = set(tables)
        all_tables = [t for t in all_tables if t in wanted]

    if out_path is None:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        out_path = f"app_db_dump_{ts}.jsonl"
    out = Path(out_path)

    total_rows = 0
    table_counts: Dict[str, int] = {}

    with out.open("w", encoding="utf-8") as f:
        meta = {
            "_meta": True,
            "format": "webadc-jsonl-v1",
            "source_url": _mask_url(db_url),
            "dumped_at": datetime.now(timezone.utc).isoformat(),
            "tables": all_tables,
            "sqlalchemy_version": __import__("sqlalchemy").__version__,
        }
        f.write(json.dumps(meta, ensure_ascii=False) + "\n")

        for table in all_tables:
            count = 0
            for row in _rows_iter(engine, table):
                row_clean = _clean_row(row)
                f.write(json.dumps(
                    {"_table": table, "data": row_clean},
                    ensure_ascii=False,
                ) + "\n")
                count += 1
                total_rows += 1
            table_counts[table] = count
            logger.info("[dump] %s: %d rows", table, count)

    engine.dispose()
    logger.info(
        "[dump] Total %d rows → %s (%d bytes)",
        total_rows, out, out.stat().st_size,
    )
    return out


# ═══════════════════════════════════════════════════════════════════════
#  restore
# ═══════════════════════════════════════════════════════════════════════


def restore_db(
    in_path: str,
    db_url: Optional[str] = None,
    mode: str = "skip",
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Restore data from a JSONL dump into the target DB.

    Parameters
    ----------
    in_path : str
        Path to the JSONL dump file.
    db_url : str, optional
        Target SQLAlchemy URL. Defaults to current DB_URL.
    mode : str
        Conflict handling for existing PKs:
          - ``"skip"`` (default) — keep existing row, skip dump row
          - ``"overwrite"`` — delete existing row, insert dump row
          - ``"fail"`` — raise on any conflict
    dry_run : bool
        If True, parse and validate but don't write anything.

    Returns
    -------
    dict
        Report: ``{inserted, skipped, overwritten, errors, tables}``
    """
    if db_url is None:
        from app.db_sqlalchemy import _resolve_db_url
        db_url = _resolve_db_url()

    in_path = Path(in_path)
    if not in_path.exists():
        raise FileNotFoundError(f"Dump file not found: {in_path}")

    # Parse the dump
    meta: Optional[Dict] = None
    rows_by_table: Dict[str, List[Dict]] = {}

    with in_path.open("r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON at line {line_num}: {exc}")
            if obj.get("_meta"):
                meta = obj
                continue
            table = obj.get("_table")
            data = obj.get("data")
            if not table or data is None:
                continue
            rows_by_table.setdefault(table, []).append(data)

    if meta is None:
        logger.warning("[restore] No metadata header in dump — proceeding anyway")

    logger.info(
        "[restore] Source: %s, dumped_at=%s, %d tables, %d rows total",
        meta.get("source_url", "?") if meta else "?",
        meta.get("dumped_at", "?") if meta else "?",
        len(rows_by_table),
        sum(len(v) for v in rows_by_table.values()),
    )

    if dry_run:
        return {
            "dry_run": True,
            "tables": {t: len(rows) for t, rows in rows_by_table.items()},
            "total_rows": sum(len(v) for v in rows_by_table.values()),
        }

    engine = create_engine(db_url, future=True)

    # Pre-flight: write access check (catches root-owned SQLite files etc.)
    write_err = _check_writable(db_url)
    if write_err:
        engine.dispose()
        raise PermissionError(f"Target DB not writable: {write_err}")

    # Ensure tables exist on target
    from app.db_sqlalchemy import Base
    import app.models_sqla  # noqa: F401 — side-effect: registers models
    Base.metadata.create_all(bind=engine)

    # Insert in FK order (only tables that have rows)
    tables_ordered = [t for t in TABLE_ORDER if t in rows_by_table]
    # Plus any extras at the end
    extras = [t for t in rows_by_table if t not in TABLE_ORDER]
    tables_ordered.extend(sorted(extras))

    is_sqlite = db_url.startswith("sqlite")
    is_postgres = db_url.startswith("postgresql")

    report = {
        "inserted": 0,
        "skipped": 0,
        "overwritten": 0,
        "upserted": 0,
        "errors": 0,
        "tables": {t: 0 for t in tables_ordered},
    }

    with engine.begin() as conn:
        # Disable FK checks during bulk insert (SQLite)
        if is_sqlite:
            conn.execute(text("PRAGMA foreign_keys=OFF"))

        for table in tables_ordered:
            rows = rows_by_table[table]
            if not rows:
                continue

            # Build column list from first row (all rows should have same cols)
            # BUT: also add NOT NULL target columns missing from source row
            # so INSERT doesn't fail with "NOT NULL constraint failed".
            not_null_defaults = _get_dst_not_null_cols(engine, table)
            base_cols = list(rows[0].keys())
            # Extend cols with missing NOT NULL columns
            cols = list(base_cols)
            for col_name in not_null_defaults:
                if col_name not in cols:
                    cols.append(col_name)

            col_list = ", ".join(f'"{c}"' for c in cols)
            param_list = ", ".join(f":{c}" for c in cols)
            insert_sql = text(
                f'INSERT INTO "{table}" ({col_list}) VALUES ({param_list})'
            )

            pk_cols = _get_pk_cols(engine, table)
            count_for_table = 0

            for row in rows:
                try:
                    # Coerce NULLs to defaults for NOT NULL columns
                    if not_null_defaults:
                        _coerce_nulls(row, not_null_defaults)
                        # Also fill missing NOT NULL columns with defaults
                        for col_name, default in not_null_defaults.items():
                            if col_name not in row:
                                row[col_name] = default
                    if mode in ("skip", "overwrite", "upsert") and pk_cols:
                        # Check if PK exists
                        where = " AND ".join(f"{c} = :_pk_{c}" for c in pk_cols)
                        check_sql = text(f"SELECT 1 FROM {table} WHERE {where}")
                        params = {f"_pk_{c}": row.get(c) for c in pk_cols}
                        existing = conn.execute(check_sql, params).first()

                        if existing:
                            if mode == "skip":
                                report["skipped"] += 1
                                continue
                            elif mode == "overwrite":
                                # Delete then insert
                                del_sql = text(
                                    f"DELETE FROM {table} WHERE {where}"
                                )
                                conn.execute(del_sql, params)
                                report["overwritten"] += 1
                            elif mode == "upsert":
                                # UPDATE non-PK columns
                                non_pk_cols = [c for c in cols if c not in pk_cols]
                                if non_pk_cols:
                                    set_clause = ", ".join(f"{c} = :{c}" for c in non_pk_cols)
                                    upd_params = {c: row.get(c) for c in non_pk_cols}
                                    upd_params.update(params)
                                    upd_sql = text(
                                        f"UPDATE {table} SET {set_clause} WHERE {where}"
                                    )
                                    conn.execute(upd_sql, upd_params)
                                report["upserted"] += 1
                                continue  # don't fall through to INSERT

                    # Filter row to only cols present in insert_sql
                    row_filtered = {c: row.get(c) for c in cols}
                    conn.execute(insert_sql, row_filtered)
                    report["inserted"] += 1
                    count_for_table += 1
                except Exception as exc:
                    if mode == "fail":
                        raise
                    report["errors"] += 1
                    logger.warning(
                        "[restore] %s row %s: %s", table, row, exc,
                    )

            report["tables"][table] = count_for_table
            logger.info("[restore] %s: %d inserted", table, count_for_table)

        if is_sqlite:
            conn.execute(text("PRAGMA foreign_keys=ON"))

    # Reset PostgreSQL sequences after manual inserts
    if is_postgres:
        with engine.begin() as conn:
            _reset_pg_sequences(engine, conn)
        logger.info("[restore] PostgreSQL sequences reset")

    engine.dispose()
    return report


# ═══════════════════════════════════════════════════════════════════════
#  transfer (direct DB-to-DB, no intermediate file)
# ═══════════════════════════════════════════════════════════════════════


def _check_writable(db_url: str) -> Optional[str]:
    """Pre-flight check: can we write to the target DB?

    Returns an error message string if not writable, None if OK.
    For SQLite, this checks the file permissions AND the directory
    (SQLite needs to create -wal/-shm/-journal files alongside).
    For other backends, we trust the URL credentials.
    """
    if not db_url.startswith("sqlite"):
        return None
    # Extract file path
    tail = db_url[len("sqlite:///"):]
    if not tail or tail == ":memory:":
        return None
    if tail.startswith("/"):
        path = Path(tail)
    else:
        path = Path.cwd() / tail

    # If file doesn't exist yet, check the parent directory is writable
    if not path.exists():
        parent = path.parent if path.parent.exists() else Path.cwd()
        if not os.access(parent, os.W_OK):
            return (
                f"Не могу создать {path} — нет прав на запись в директорию {parent}. "
                f"Решение: sudo chown $USER:$USER {parent}"
            )
        return None

    # File exists — check if WE can write to it
    if not os.access(path, os.W_OK):
        st = path.stat()
        owner_uid = st.st_uid
        try:
            import pwd
            owner_name = pwd.getpwuid(owner_uid).pw_name
        except Exception:
            owner_name = f"uid={owner_uid}"
        me = os.getuid()
        try:
            my_name = pwd.getpwuid(me).pw_name
        except Exception:
            my_name = f"uid={me}"
        return (
            f"Файл {path} принадлежит '{owner_name}', а вы '{my_name}' — нет прав на запись. "
            f"Решение: sudo chown $USER:$USER {path} {path}-wal {path}-shm 2>/dev/null"
        )
    return None


def transfer_db(
    from_url: str,
    to_url: str,
    tables: Optional[List[str]] = None,
    batch_size: int = 1000,
    sync_schema: bool = True,
    on_conflict: str = "ask",
    on_conflict_choice: Optional[str] = None,
    progress_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    """Copy data directly from one DB to another (no intermediate file).

    The target schema is **auto-extended** to match the source: missing
    tables are created and missing columns are added via ALTER TABLE
    (additive only — no drops). This makes transfer resilient to schema
    drift between the source (e.g. legacy PostgreSQL with extra columns
    like ``totp_enabled``) and the target (fresh SQLite from
    ``init_db()``).

    Tables are copied in FK-dependency order. Unknown tables from the
    source are appended at the end.

    Parameters
    ----------
    from_url : str
        Source SQLAlchemy URL.
    to_url : str
        Target SQLAlchemy URL.
    tables : list[str], optional
        Subset of tables. Defaults to all source tables.
    batch_size : int
        Rows per batch (affects memory, not correctness).
    sync_schema : bool
        If True (default), auto-create missing tables and add missing
        columns on the target before copying data.
    on_conflict : str
        Behaviour when target already has a row with the same PK:
          - ``"ask"`` (default) — prompt the user interactively
          - ``"skip"`` — keep target row, drop source row
          - ``"overwrite"`` — delete target row, insert source row
          - ``"upsert"`` — UPDATE target row with source values
          - ``"fail"`` — raise immediately on first conflict
    on_conflict_choice : str, optional
        If set during an ``"ask"`` session, overrides ``on_conflict``
        for the rest of the transfer. Used to remember the user's
        "apply to all" choice.
    progress_callback : callable, optional
        ``fn(table, current_row, total_rows)`` called after each row.
        Used by the CLI to render a rich progress bar.

    Returns
    -------
    dict
        Report: ``{copied, skipped, overwritten, upserted, errors,
                  on_conflict, tables: {t: n}, schema_sync: {...}}``
    """
    src = create_engine(from_url, future=True)
    dst = create_engine(to_url, future=True)

    # Pre-flight: check write access to target (esp. SQLite file)
    write_err = _check_writable(to_url)
    if write_err:
        src.dispose()
        dst.dispose()
        raise PermissionError(f"Target DB not writable: {write_err}")

    # Ensure dst has the base schema from our models (so FK constraints
    # exist even if source has a slightly different shape).
    from app.db_sqlalchemy import Base
    import app.models_sqla  # noqa: F401
    Base.metadata.create_all(bind=dst)

    # Determine the full table list from the SOURCE (not from our models).
    src_insp = inspect(src)
    src_all_tables = set(src_insp.get_table_names()) - SKIP_TABLES

    if tables is None:
        ordered_known = [t for t in TABLE_ORDER if t in src_all_tables]
        extras = sorted(src_all_tables - set(TABLE_ORDER))
        tables = ordered_known + extras
    else:
        wanted = set(tables)
        ordered_known = [t for t in TABLE_ORDER if t in wanted and t in src_all_tables]
        extras = sorted(wanted - set(TABLE_ORDER) - set() & src_all_tables)
        tables = ordered_known + extras

    # Auto-sync schema: create missing tables, add missing columns.
    schema_report: Dict[str, Any] = {"tables_created": [], "columns_added": [], "skipped": []}
    if sync_schema and tables:
        try:
            schema_report = _sync_schema(src, dst, tables)
        except Exception as exc:
            logger.warning("[transfer] schema sync failed: %s", exc)

    dst_is_sqlite = to_url.startswith("sqlite")
    dst_is_postgres = to_url.startswith("postgresql")

    # Resolve effective conflict mode (may be overridden mid-transfer
    # if the user picks "apply to all" during an interactive prompt).
    effective_mode = on_conflict_choice or on_conflict
    if effective_mode not in ("ask", "skip", "overwrite", "upsert", "fail"):
        effective_mode = "ask"

    report: Dict[str, Any] = {
        "copied": 0,
        "skipped": 0,
        "overwritten": 0,
        "upserted": 0,
        "errors": 0,
        "on_conflict": effective_mode,
        "tables": {},
        "schema_sync": schema_report,
    }

    # Count rows per table up-front for progress reporting
    table_row_counts: Dict[str, int] = {}
    for table in tables:
        with src.connect() as conn:
            try:
                n = conn.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
                table_row_counts[table] = int(n or 0)
            except Exception:
                table_row_counts[table] = 0

    for table in tables:
        count = 0
        cols: Optional[List[str]] = None
        insert_sql = None
        # For each batch, re-fetch target columns (in case schema sync
        # ran mid-transfer; cheap and safe).
        dst_cols = _get_dst_columns(dst, table)
        if not dst_cols:
            logger.warning("[transfer] %s: missing on target, skipping", table)
            report["tables"][table] = -1
            continue

        # Get NOT NULL columns without DB defaults — we'll coerce NULL
        # values from source to sensible defaults to avoid IntegrityError.
        not_null_defaults = _get_dst_not_null_cols(dst, table)
        pk_cols = _get_pk_cols(dst, table)

        total_for_table = table_row_counts.get(table, 0)

        with dst.begin() as conn:
            if dst_is_sqlite:
                conn.execute(text("PRAGMA foreign_keys=OFF"))

            row_idx = 0
            for row in _rows_iter(src, table):
                row_clean = _clean_row(row)
                # Coerce NULLs to defaults for NOT NULL columns
                if not_null_defaults:
                    _coerce_nulls(row_clean, not_null_defaults)
                if cols is None:
                    # Intersect source columns with target columns so
                    # we never try to INSERT a column that doesn't exist.
                    cols = [c for c in row_clean.keys() if c in dst_cols]
                    if not cols:
                        logger.warning(
                            "[transfer] %s: no common columns between source and target — skipping",
                            table,
                        )
                        break
                    # Add NOT NULL columns missing from source row (e.g.
                    # is_muted added on target after source was created).
                    if not_null_defaults:
                        row_clean, cols = _fill_missing_not_null(
                            row_clean, cols, not_null_defaults,
                        )
                    col_list = ", ".join(f'"{c}"' for c in cols)
                    param_list = ", ".join(f":{c}" for c in cols)
                    insert_sql = text(
                        f'INSERT INTO "{table}" ({col_list}) VALUES ({param_list})'
                    )
                else:
                    # Subsequent rows: still need to fill missing NOT NULL
                    # columns (in case some rows have different shapes)
                    if not_null_defaults:
                        for col_name, default in not_null_defaults.items():
                            if col_name not in row_clean:
                                row_clean[col_name] = default
                # Filter row to only cols present in insert_sql
                row_filtered = {c: row_clean.get(c) for c in cols}

                # Check for PK conflict (only if we have a PK)
                pk_exists = False
                if pk_cols:
                    where = " AND ".join(f'"{c}" = :_pk_{c}' for c in pk_cols)
                    check_sql = text(f'SELECT 1 FROM "{table}" WHERE {where}')
                    pk_params = {f"_pk_{c}": row_filtered.get(c) for c in pk_cols}
                    pk_exists = conn.execute(check_sql, pk_params).first() is not None

                if pk_exists:
                    # Resolve conflict mode (may need to ask the user)
                    mode, apply_to_all = _resolve_conflict_mode(
                        table, row_filtered, effective_mode,
                    )
                    if apply_to_all and mode != effective_mode:
                        # User picked "apply to all" — remember for rest of transfer
                        effective_mode = mode
                        report["on_conflict"] = mode

                    if mode == "skip":
                        report["skipped"] += 1
                        row_idx += 1
                        if progress_callback:
                            progress_callback(table, row_idx, total_for_table)
                        continue
                    elif mode == "overwrite":
                        # Delete then insert
                        where = " AND ".join(f'"{c}" = :_pk_{c}' for c in pk_cols)
                        del_sql = text(f'DELETE FROM "{table}" WHERE {where}')
                        del_params = {f"_pk_{c}": row_filtered.get(c) for c in pk_cols}
                        conn.execute(del_sql, del_params)
                        conn.execute(insert_sql, row_filtered)
                        report["overwritten"] += 1
                        count += 1
                    elif mode == "upsert":
                        # UPDATE all non-PK columns
                        non_pk_cols = [c for c in cols if c not in pk_cols]
                        if non_pk_cols:
                            set_clause = ", ".join(f'"{c}" = :{c}' for c in non_pk_cols)
                            where = " AND ".join(f'"{c}" = :_pk_{c}' for c in pk_cols)
                            upd_params = {c: row_filtered.get(c) for c in non_pk_cols}
                            upd_params.update({f"_pk_{c}": row_filtered.get(c) for c in pk_cols})
                            upd_sql = text(
                                f'UPDATE "{table}" SET {set_clause} WHERE {where}'
                            )
                            conn.execute(upd_sql, upd_params)
                            report["upserted"] += 1
                        else:
                            report["skipped"] += 1
                    elif mode == "fail":
                        raise RuntimeError(
                            f"UNIQUE conflict on {table} PK={pk_cols} "
                            f"value={row_filtered} (--on-conflict=fail)"
                        )
                else:
                    # No conflict — straight insert
                    conn.execute(insert_sql, row_filtered)
                    report["copied"] += 1
                    count += 1

                row_idx += 1
                if progress_callback:
                    progress_callback(table, row_idx, total_for_table)

            if dst_is_sqlite:
                conn.execute(text("PRAGMA foreign_keys=ON"))

        report["tables"][table] = count
        logger.info("[transfer] %s: %d rows (skipped=%d, overwritten=%d, upserted=%d)",
                    table, count,
                    report["skipped"], report["overwritten"], report["upserted"])

    if dst_is_postgres:
        with dst.begin() as conn:
            _reset_pg_sequences(dst, conn)
        logger.info("[transfer] PostgreSQL sequences reset on target")

    src.dispose()
    dst.dispose()
    return report


# ═══════════════════════════════════════════════════════════════════════
#  Interactive conflict resolution
# ═══════════════════════════════════════════════════════════════════════


# Module-level callback the CLI sets to render prompts with rich.
# Default falls back to a plain input() prompt.
_conflict_prompt_fn: Optional[Any] = None


def set_conflict_prompt(fn) -> None:
    """Register a custom conflict-prompt function.

    Called as ``fn(table, row, choices) -> (choice, apply_to_all)``.
    If not set, ``_resolve_conflict_mode`` uses a plain ``input()``.
    """
    global _conflict_prompt_fn
    _conflict_prompt_fn = fn


def _resolve_conflict_mode(
    table: str, row: Dict[str, Any], current_mode: str,
) -> tuple:
    """Resolve what to do with a conflicting row.

    If ``current_mode`` is not ``"ask"``, returns ``(current_mode, True)``
    (the True means "this is the settled mode, don't ask again").

    Otherwise prompts the user via ``_conflict_prompt_fn`` (if set)
    or ``input()``.

    Returns ``(mode, apply_to_all)`` where:
      - ``mode`` ∈ {``skip``, ``overwrite``, ``upsert``, ``fail``}
      - ``apply_to_all`` is True if the user chose "apply to all future conflicts"
    """
    if current_mode != "ask":
        return (current_mode, True)

    # Try the registered prompt
    if _conflict_prompt_fn is not None:
        try:
            choice, apply_to_all = _conflict_prompt_fn(table, row)
            return (choice, apply_to_all)
        except Exception as exc:
            logger.warning("[transfer] conflict prompt failed: %s", exc)
            return ("skip", False)

    # Fallback: plain stdin prompt (non-interactive contexts)
    pk_str = ", ".join(f"{k}={v!r}" for k, v in list(row.items())[:3])
    print(f"\n⚠️  Conflict on table '{table}' (PK: {pk_str})")
    print("  [s]kip   — keep target row, drop source row")
    print("  [o]verwrite — delete target row, insert source row")
    print("  [u]psert — UPDATE target row with source values")
    print("  [f]ail   — abort transfer")
    print("  [S]/[O]/[U] — apply choice to ALL future conflicts")
    try:
        ans = input("Choice? [s/o/u/f/S/O/U] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        return ("skip", False)

    apply_to_all = ans in ("s", "o", "u")
    if ans in ("s", "S"):
        return ("skip", apply_to_all)
    if ans in ("o", "O"):
        return ("overwrite", apply_to_all)
    if ans in ("u", "U"):
        return ("upsert", apply_to_all)
    if ans == "f":
        return ("fail", False)
    return ("skip", False)


# ═══════════════════════════════════════════════════════════════════════
#  info / inspect a dump file
# ═══════════════════════════════════════════════════════════════════════


def dump_info(in_path: str) -> Dict[str, Any]:
    """Read a JSONL dump's metadata + per-table row counts (no DB access)."""
    in_path = Path(in_path)
    if not in_path.exists():
        raise FileNotFoundError(f"Dump file not found: {in_path}")

    meta: Optional[Dict] = None
    counts: Dict[str, int] = {}
    total = 0

    with in_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if obj.get("_meta"):
                meta = obj
                continue
            t = obj.get("_table")
            if t:
                counts[t] = counts.get(t, 0) + 1
                total += 1

    return {
        "path": str(in_path),
        "size_bytes": in_path.stat().st_size,
        "meta": meta or {},
        "row_counts": counts,
        "total_rows": total,
    }
