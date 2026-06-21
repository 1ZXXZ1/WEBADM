"""
cli_sqldb.py — CLI для единого DB-слоя (SQLAlchemy + Alembic + DuckDB).

pe-a-1.4 — выделен из cli.py, использует rich для красивого вывода.

Использование::

    webadc sqldb init
    webadc sqldb info
    webadc sqldb transfer --from URL --to URL --on-conflict ask
    webadc sqldb dump --out backup.jsonl
    webadc sqldb restore --in backup.jsonl --on-conflict upsert

Может вызываться из cli.py (``webadc sqldb ...``) или напрямую как
``python3.14 cli_sqldb.py ...``.
"""

from __future__ import annotations

import argparse
import os
import sys
import traceback
from pathlib import Path

# ── rich (optional, robust fallback to plain-but-aligned tables) ───────

# We try rich, but never fail if it's missing. Plain fallback still
# produces aligned ASCII tables (not just tab-separated lines).
try:
    from rich.console import Console
    from rich.table import Table as RichTable
    from rich.progress import (
        Progress, SpinnerColumn, BarColumn, TextColumn,
        TimeRemainingColumn, MofNCompleteColumn,
    )
    from rich.panel import Panel
    from rich.prompt import Prompt, Confirm
    _HAS_RICH = True
    console = Console()
except ImportError:
    _HAS_RICH = False
    console = None


def _info(msg: str) -> None:
    if _HAS_RICH:
        console.print(msg)
    else:
        # Strip rich markup for plain output
        import re
        clean = re.sub(r"\[/?[a-z_ #0-9]+\]", "", str(msg))
        print(clean)


def _err(msg: str) -> None:
    if _HAS_RICH:
        console.print(f"[red]{msg}[/red]")
    else:
        import re
        clean = re.sub(r"\[/?[a-z_ #0-9]+\]", "", str(msg))
        print(clean, file=sys.stderr)


def _ok(msg: str) -> None:
    if _HAS_RICH:
        console.print(f"[green]✓[/green] {msg}")
    else:
        print(f"✓ {msg}")


def _warn(msg: str) -> None:
    if _HAS_RICH:
        console.print(f"[yellow]⚠[/yellow] {msg}")
    else:
        print(f"⚠ {msg}")


def _table(headers: list, rows: list, title: str = "") -> None:
    """Render a table — rich if available, else aligned ASCII table."""
    if not rows:
        if title:
            _info(f"\n{title}: (no rows)")
        return

    if _HAS_RICH:
        t = RichTable(title=title, show_lines=False, header_style="bold cyan")
        for h in headers:
            t.add_column(h)
        for r in rows:
            t.add_row(*[str(x) for x in r])
        console.print(t)
        return

    # Plain-text aligned table (no rich)
    # Compute column widths based on header + data
    str_rows = [[str(x) for x in r] for r in rows]
    widths = [len(h) for h in headers]
    for r in str_rows:
        for i, cell in enumerate(r):
            if i < len(widths):
                widths[i] = max(widths[i], len(cell))

    # Build separator
    sep = "+" + "+".join("-" * (w + 2) for w in widths) + "+"

    if title:
        print(f"\n{title}")
    print(sep)
    # Header
    header_line = "|" + "|".join(f" {h:<{widths[i]}} " for i, h in enumerate(headers)) + "|"
    print(header_line)
    print(sep)
    # Data rows
    for r in str_rows:
        # Pad row to len(headers)
        while len(r) < len(headers):
            r.append("")
        line = "|" + "|".join(f" {r[i]:<{widths[i]}} " for i in range(len(headers))) + "|"
        print(line)
    print(sep)


# ═══════════════════════════════════════════════════════════════════════
#  Alembic invocation (in-process, no PATH dependency)
# ═══════════════════════════════════════════════════════════════════════


def _alembic_invoke(*args: str) -> int:
    """Run alembic via Python API (no PATH dependency)."""
    try:
        from alembic import command
        from alembic.config import Config
    except ImportError:
        _err("alembic не установлен — установите: pip install alembic")
        return 127

    if _HAS_RICH:
        console.print(f"[dim]$ alembic {' '.join(args)}[/dim]")
    else:
        print(f"  $ alembic {' '.join(args)}")

    project_root = os.path.dirname(os.path.abspath(__file__))
    # If invoked from cli.py, __file__ is cli.py in project root.
    # If invoked directly as cli_sqldb.py, same.
    ini_path = os.path.join(project_root, "alembic.ini")
    if not os.path.exists(ini_path):
        _err(f"alembic.ini не найден: {ini_path}")
        return 1

    cfg = Config(ini_path)
    cfg.set_main_option("script_location", os.path.join(project_root, "alembic"))
    try:
        from app.db_sqlalchemy import _resolve_db_url
        cfg.attributes["db_url"] = _resolve_db_url()
    except Exception:
        pass

    try:
        if not args:
            _err("alembic: missing command")
            return 1
        cmd_name = args[0]
        rest = args[1:]

        if cmd_name == "upgrade":
            target = rest[0] if rest else "head"
            command.upgrade(cfg, target)
        elif cmd_name == "downgrade":
            if not rest:
                _err("alembic downgrade: required target missing")
                return 1
            command.downgrade(cfg, rest[0])
        elif cmd_name == "current":
            command.current(cfg)
        elif cmd_name == "history":
            verbose = "--verbose" in rest or "-v" in rest
            command.history(cfg, verbose=verbose)
        elif cmd_name == "stamp":
            target = rest[0] if rest else "head"
            command.stamp(cfg, target)
        elif cmd_name == "heads":
            command.heads(cfg)
        elif cmd_name == "revision":
            msg = None
            autogenerate = False
            i = 0
            while i < len(rest):
                tok = rest[i]
                if tok in ("-m", "--message"):
                    i += 1
                    if i < len(rest):
                        msg = rest[i]
                elif tok == "--autogenerate":
                    autogenerate = True
                i += 1
            if not msg:
                _err("alembic revision: -m/--message is required")
                return 1
            command.revision(cfg, message=msg, autogenerate=autogenerate)
        else:
            _err(f"alembic: unknown command {cmd_name!r}")
            return 1
        return 0
    except Exception as exc:
        _err(f"alembic error: {exc}")
        traceback.print_exc()
        return 1


# ═══════════════════════════════════════════════════════════════════════
#  Conflict prompt (rich-based)
# ═══════════════════════════════════════════════════════════════════════


def _conflict_prompt(table: str, row: dict) -> tuple:
    """Interactive prompt shown when a PK conflict occurs during transfer.

    Returns ``(choice, apply_to_all)`` where choice ∈
    ``{"skip", "overwrite", "upsert", "fail"}``.
    """
    # Show the conflicting row (truncate long values for display)
    display_row = {k: (str(v)[:50] + "…" if v and len(str(v)) > 50 else v)
                   for k, v in list(row.items())[:5]}

    if _HAS_RICH:
        t = Table(title=f"⚠️  PK conflict on '{table}'", show_header=True, header_style="bold")
        t.add_column("Column", style="cyan", no_wrap=True)
        t.add_column("Value")
        for k, v in display_row.items():
            t.add_row(k, str(v))
        console.print(t)
        console.print()
        console.print("[bold]What should I do with this row?[/bold]")
        console.print("  [cyan]s[/cyan]) skip       — keep target row, drop source row")
        console.print("  [cyan]o[/cyan]) overwrite  — delete target row, insert source row")
        console.print("  [cyan]u[/cyan]) upsert     — UPDATE target row with source values")
        console.print("  [cyan]f[/cyan]) fail       — abort transfer")
        try:
            ans = Prompt.ask("Choice", choices=["s", "o", "u", "f"], default="s")
            if ans != "f":
                apply_all = Confirm.ask(
                    "Apply this choice to ALL future conflicts?",
                    default=False,
                )
            else:
                apply_all = False
        except (EOFError, KeyboardInterrupt):
            return ("skip", False)
    else:
        pk_str = ", ".join(f"{k}={v!r}" for k, v in list(row.items())[:3])
        print(f"\n⚠️  Conflict on table '{table}' (PK: {pk_str})")
        print("  [s]kip   | [o]verwrite | [u]psert | [f]ail")
        try:
            ans = input("Choice? [s/o/u/f] ").strip().lower()
            apply_all = input("Apply to all? [y/N] ").strip().lower() in ("y", "yes")
        except (EOFError, KeyboardInterrupt):
            return ("skip", False)

    if ans == "s":
        return ("skip", apply_all)
    if ans == "o":
        return ("overwrite", apply_all)
    if ans == "u":
        return ("upsert", apply_all)
    if ans == "f":
        return ("fail", False)
    return ("skip", apply_all)


# ═══════════════════════════════════════════════════════════════════════
#  Commands
# ═══════════════════════════════════════════════════════════════════════


def cmd_init(args) -> int:
    """init: create_all() + seed admin/admin."""
    _info("→ [bold]init_db()[/bold]: create_all() + seed admin/admin ..." if _HAS_RICH
          else "→ init_db(): create_all() + seed admin/admin ...")
    try:
        from app.db_sqlalchemy import init_db
        report = init_db(seed=True)
        _ok(f"Tables created. Seed report: {report}")
        _warn("Default admin: username=admin password=admin")
        _warn("Change password via /api/v1/users/me/password")
        return 0
    except Exception as exc:
        _err(f"init_db failed: {exc}")
        traceback.print_exc()
        return 1


def cmd_upgrade(args) -> int:
    """upgrade: alembic upgrade head (with auto-stamp)."""
    _info("→ alembic upgrade head ...")
    try:
        from app.db_sqlalchemy import get_engine
        from sqlalchemy import inspect, text
        engine = get_engine()
        insp = inspect(engine)
        existing = set(insp.get_table_names())
        has_alembic = "alembic_version" in existing
        current_rev = None
        if has_alembic:
            with engine.connect() as conn:
                try:
                    current_rev = conn.execute(
                        text("SELECT version_num FROM alembic_version")
                    ).scalar()
                except Exception:
                    pass
        needed = {
            "mgmt_users", "mgmt_api_keys", "mgmt_roles", "mgmt_audit_log",
            "ai_chat_sessions", "ai_chat_messages", "mgmt_bans",
            "chat_rooms", "chat_members", "chat_messages",
            "chat_attachments", "chat_reactions", "chat_stars",
            "chat_read_receipts", "chat_call_participants", "chat_calls",
        }
        missing = needed - existing
        if not missing and not current_rev:
            _info("ℹ Tables already exist (created via init).")
            _info("ℹ Stamping 0001_initial as applied (no SQL executed).")
            return _alembic_invoke("stamp", "head")
        elif not missing and current_rev:
            _info(f"ℹ Already at revision {current_rev}. Nothing to do.")
            return 0
    except Exception as exc:
        _warn(f"Pre-flight check failed ({exc}), proceeding with upgrade...")
    rc = _alembic_invoke("upgrade", "head")
    if rc == 0:
        _info("ℹ Running seed_defaults() ...")
        try:
            from app.db_init import seed_defaults
            report = seed_defaults()
            _ok(f"Seed report: {report}")
        except Exception as exc:
            _warn(f"Seed failed: {exc}")
    return rc


def cmd_info(args) -> int:
    """info: show DB_URL, engine, tables."""
    try:
        from app.config import get_settings
        from app.db_sqlalchemy import get_engine, _resolve_db_url, _safe_url_for_log
        from sqlalchemy import inspect
        s = get_settings()
        if _HAS_RICH:
            console.print(Panel.fit(
                f"[cyan]DB_URL[/cyan]          : {getattr(s, 'DB_URL', '<unset>')}\n"
                f"[cyan]DB_ECHO[/cyan]         : {getattr(s, 'DB_ECHO', False)}\n"
                f"[cyan]DB_POOL_SIZE[/cyan]    : {getattr(s, 'DB_POOL_SIZE', 5)}\n"
                f"[cyan]DB_DUCKDB_ENABLED[/cyan]: {getattr(s, 'DB_DUCKDB_ENABLED', True)}\n"
                f"[cyan]Effective URL[/cyan]   : {_safe_url_for_log(_resolve_db_url())}",
                title="SQLAlchemy Configuration",
                border_style="cyan",
            ))
        else:
            print(f"DB_URL          : {getattr(s, 'DB_URL', '<unset>')}")
            print(f"Effective URL   : {_safe_url_for_log(_resolve_db_url())}")
        engine = get_engine()
        print(f"Engine          : {engine}")
        print(f"Dialect         : {engine.dialect.name}")
        insp = inspect(engine)
        tables = sorted(insp.get_table_names())
        _table(["Table"], [[t] for t in tables], title=f"Tables ({len(tables)})")
        return 0
    except Exception as exc:
        _err(f"info failed: {exc}")
        traceback.print_exc()
        return 1


def cmd_stats(args) -> int:
    """stats: row counts per table."""
    try:
        from app.db_analytics import stats as duck_stats
        from app.db_sqlalchemy import get_engine
        from sqlalchemy import inspect, text

        # DuckDB layer info
        if _HAS_RICH:
            console.print(Panel.fit(
                "\n".join(f"[cyan]{k}[/cyan]: {v}" for k, v in duck_stats().items()),
                title="DuckDB Analytics Layer",
                border_style="magenta",
            ))
        else:
            print("DuckDB analytics layer:")
            for k, v in duck_stats().items():
                print(f"  {k}: {v}")

        engine = get_engine()
        insp = inspect(engine)
        tables = sorted(insp.get_table_names())
        rows = []
        with engine.connect() as conn:
            for t in tables:
                try:
                    n = conn.execute(text(f'SELECT COUNT(*) FROM "{t}"')).scalar()
                    rows.append([t, n])
                except Exception as exc:
                    rows.append([t, f"error: {exc}"])
        _table(["Table", "Rows"], rows, title=f"Row counts ({engine.dialect.name})")
        return 0
    except Exception as exc:
        _err(f"stats failed: {exc}")
        traceback.print_exc()
        return 1


def cmd_status(args) -> int:
    """status: human-friendly DB overview (DB_URL, size, migrations, top tables).

    Like `stats` but more concise — top 10 tables by row count + DB health.
    """
    try:
        from app.config import get_settings
        from app.db_sqlalchemy import get_engine, _resolve_db_url, _safe_url_for_log
        from sqlalchemy import inspect, text
        from pathlib import Path
        import os

        s = get_settings()
        engine = get_engine()
        db_url = _resolve_db_url()

        # Health summary
        info_lines = []
        info_lines.append(f"DB_URL          : {getattr(s, 'DB_URL', '<unset>')}")
        info_lines.append(f"Effective URL   : {_safe_url_for_log(db_url)}")
        info_lines.append(f"Dialect         : {engine.dialect.name}")

        # File size for SQLite
        if db_url.startswith("sqlite:///"):
            tail = db_url[len("sqlite:///"):]
            if tail.startswith("/"):
                p = Path(tail)
            else:
                p = Path.cwd() / tail
            if p.exists():
                size = p.stat().st_size
                size_str = f"{size/1024:.1f} KB" if size < 1024*1024 else f"{size/1024/1024:.1f} MB"
                info_lines.append(f"File size       : {size_str} ({size:,} bytes)")
                info_lines.append(f"File path       : {p}")

        # Alembic revision
        try:
            insp = inspect(engine)
            if "alembic_version" in insp.get_table_names():
                with engine.connect() as conn:
                    rev = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
                    info_lines.append(f"Alembic revision: {rev or '(none)'}")
        except Exception:
            pass

        # Permissions check for SQLite
        if db_url.startswith("sqlite:///") and 'p' in dir() and p.exists():
            if os.access(p, os.W_OK):
                info_lines.append("Write access    : ✓ yes")
            else:
                info_lines.append("Write access    : ✗ NO (run: sudo chown $USER:$USER " + str(p) + ")")

        if _HAS_RICH:
            console.print(Panel.fit(
                "\n".join(info_lines),
                title="DB Status",
                border_style="cyan",
            ))
        else:
            print("─" * 60)
            print("DB Status")
            print("─" * 60)
            for line in info_lines:
                print(line)
            print("─" * 60)

        # Top 10 tables by row count
        insp = inspect(engine)
        tables = sorted(insp.get_table_names())
        rows_data = []
        with engine.connect() as conn:
            for t in tables:
                try:
                    n = conn.execute(text(f'SELECT COUNT(*) FROM "{t}"')).scalar() or 0
                    rows_data.append([t, n])
                except Exception:
                    rows_data.append([t, 0])
        # Sort by row count desc, take top 10
        rows_data.sort(key=lambda r: r[1] if isinstance(r[1], int) else 0, reverse=True)
        total_rows = sum(r[1] for r in rows_data if isinstance(r[1], int))
        top = rows_data[:10]
        _table(["Table", "Rows"], top, title=f"Top 10 tables by row count (total: {total_rows})")
        return 0
    except Exception as exc:
        _err(f"status failed: {exc}")
        traceback.print_exc()
        return 1


def cmd_query(args) -> int:
    """query: run read-only SQL via DuckDB."""
    sql = args.sql
    if not sql and args.revision_id and args.revision_id.upper().startswith(
        ("SELECT", "INSERT", "UPDATE", "DELETE", "WITH", "PRAGMA", "SHOW")
    ):
        sql = args.revision_id
        args.revision_id = None
    if not sql:
        _err('Требуется SQL: cli_sqldb.py query "SELECT ..."')
        _err('Подсказка: таблицы под схемой app. — например: app.mgmt_users')
        return 1
    try:
        from app.db_analytics import query
        rows = query(sql)
        _ok(f"{len(rows)} row(s)")
        if rows:
            cols = list(rows[0].keys())
            table_rows = [[r.get(c, "") for c in cols] for r in rows[:200]]
            _table(cols, table_rows)
            if len(rows) > 200:
                _warn(f"... ({len(rows) - 200} more rows truncated)")
        return 0
    except Exception as exc:
        _err(f"query failed: {exc}")
        return 1


# ═══════════════════════════════════════════════════════════════════════
#  v3.3.6 — Convenience commands (replacements for old `webadc db ...`)
# ═══════════════════════════════════════════════════════════════════════


def cmd_show(args) -> int:
    """show: display a single record by table + id.

    Replaces old `webadc db show <collection> <id>`.
    """
    table = args.revision_id  # first positional after subcommand
    record_id = args.sql  # second positional
    if not table:
        _err("Использование: cli_sqldb.py show <table> <id>")
        _err("Пример: cli_sqldb.py show mgmt_users 1")
        return 1
    # If only one arg given, maybe it's "<table>.<id>" or just "<id>" for mgmt_users
    if not record_id:
        # Maybe user wrote: sqldb show mgmt_users 1 — but argparse consumed both
        # Try the args.dump_out / args.restore_in slots
        record_id = args.dump_out or args.restore_in
    if not record_id:
        _err(f"Укажите ID записи: cli_sqldb.py show {table} <id>")
        return 1
    try:
        from app.db_sqlalchemy import get_engine
        from sqlalchemy import inspect, text
        engine = get_engine()
        insp = inspect(engine)
        if not insp.has_table(table):
            _err(f"Таблица не найдена: {table}")
            _info("Доступные таблицы:")
            for t in sorted(insp.get_table_names()):
                _info(f"  {t}")
            return 1
        # Get PK column(s)
        pk = insp.get_pk_constraint(table).get("constrained_columns", [])
        if not pk:
            _err(f"У таблицы {table} нет PRIMARY KEY — невозможно найти запись")
            return 1
        # Try to find by first PK column
        where = " AND ".join(f'"{c}" = :_id_{c}' for c in pk)
        params = {f"_id_{c}": record_id for c in pk}
        # Try to cast to int if possible
        for c in pk:
            try:
                params[f"_id_{c}"] = int(record_id)
            except (ValueError, TypeError):
                pass
        sql = f'SELECT * FROM "{table}" WHERE {where}'
        with engine.connect() as conn:
            result = conn.execute(text(sql), params)
            cols = list(result.keys())
            row = result.fetchone()
        if not row:
            _err(f"Запись не найдена: {table} id={record_id}")
            return 1
        row_dict = dict(zip(cols, row))
        _ok(f"Запись: {table} id={record_id}")
        # Render as 2-column table (Field/Value)
        rows = [[k, str(v)[:80]] for k, v in row_dict.items()]
        _table(["Field", "Value"], rows, title=f"{table} / id={record_id}")
        return 0
    except Exception as exc:
        _err(f"show failed: {exc}")
        traceback.print_exc()
        return 1


def cmd_purge(args) -> int:
    """purge: delete all rows from a table.

    Replaces old `webadc db purge <collection>`.
    Asks for confirmation unless --yes.
    """
    table = args.revision_id
    if not table:
        _err("Использование: cli_sqldb.py purge <table>")
        _err("Пример: cli_sqldb.py purge mgmt_audit_log")
        return 1
    try:
        from app.db_sqlalchemy import get_engine
        from sqlalchemy import inspect, text
        engine = get_engine()
        insp = inspect(engine)
        if not insp.has_table(table):
            _err(f"Таблица не найдена: {table}")
            return 1
        # Count rows
        with engine.connect() as conn:
            n = conn.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
        if n == 0:
            _info(f"Таблица {table} уже пустая")
            return 0
        # Confirm
        auto_yes = getattr(args, 'auto_yes', False) or getattr(args, 'dry_run', False)
        if not auto_yes:
            try:
                ans = input(f"Удалить {n} записей из таблицы '{table}'? [y/N] ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                ans = "n"
            if ans not in ("y", "yes"):
                _info("Отменено")
                return 1
        with engine.begin() as conn:
            deleted = conn.execute(text(f'DELETE FROM "{table}"')).rowcount
        _ok(f"Удалено {deleted} записей из таблицы '{table}'")
        return 0
    except Exception as exc:
        _err(f"purge failed: {exc}")
        traceback.print_exc()
        return 1


def cmd_keys(args) -> int:
    """keys: list API keys.

    Replaces old `webadc db keys`.
    """
    try:
        from app.db_sqlalchemy import get_engine
        from sqlalchemy import inspect, text
        engine = get_engine()
        insp = inspect(engine)
        if not insp.has_table("mgmt_api_keys"):
            _err("Таблица mgmt_api_keys не найдена")
            return 1
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT key_prefix, name, role, is_active, user_id, last_used_at, expires_at "
                "FROM mgmt_api_keys ORDER BY key_prefix"
            ))
            cols = list(result.keys())
            rows = [list(r) for r in result.fetchall()]
        if not rows:
            _info("API ключей нет")
            return 0
        _table(["Prefix", "Name", "Role", "Active", "User ID", "Last Used", "Expires"],
               [[r[0], r[1] or "", r[2] or "", "✓" if r[3] else "✗",
                 str(r[4] or ""), str(r[5] or "—")[:19], str(r[6] or "—")[:19]] for r in rows],
               title=f"API Keys ({len(rows)})")
        return 0
    except Exception as exc:
        _err(f"keys failed: {exc}")
        return 1


def cmd_audit(args) -> int:
    """audit: show recent audit log entries.

    Replaces old `webadc db audit`.
    """
    limit = getattr(args, 'limit', 20) or 20
    try:
        from app.db_sqlalchemy import get_engine
        from sqlalchemy import inspect, text
        engine = get_engine()
        insp = inspect(engine)
        if not insp.has_table("mgmt_audit_log"):
            _err("Таблица mgmt_audit_log не найдена")
            return 1
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT timestamp, username, action, endpoint, ip_address, method, status_code "
                "FROM mgmt_audit_log ORDER BY timestamp DESC LIMIT :lim"
            ), {"lim": limit})
            rows = [list(r) for r in result.fetchall()]
        if not rows:
            _info("Записей аудита нет")
            return 0
        _table(["Time", "User", "Action", "Endpoint", "IP", "Method", "Status"],
               [[str(r[0] or "—")[:19], r[1] or "—", r[2] or "—",
                 (r[3] or "—")[:40], r[4] or "—", r[5] or "—", str(r[6] or "—")] for r in rows],
               title=f"Audit Log (last {limit})")
        return 0
    except Exception as exc:
        _err(f"audit failed: {exc}")
        return 1


def cmd_dump(args) -> int:
    """dump: serialize current DB to JSONL."""
    try:
        from app.db_serialize import dump_db
        tables = (
            [t.strip() for t in args.tables_filter.split(",") if t.strip()]
            if args.tables_filter else None
        )
        out = dump_db(out_path=args.dump_out, tables=tables)
        size = out.stat().st_size
        size_str = f"{size/1024:.1f} KB" if size < 1024*1024 else f"{size/1024/1024:.1f} MB"
        _ok(f"Dumped to: {out}")
        _info(f"    Size: {size:,} bytes ({size_str})")
        return 0
    except Exception as exc:
        _err(f"dump failed: {exc}")
        traceback.print_exc()
        return 1


def cmd_dump_info(args) -> int:
    """dump-info: inspect a JSONL dump."""
    if not args.restore_in and not args.dump_out:
        _err('Требуется --in: cli_sqldb.py dump-info --in dump.jsonl')
        return 1
    path = args.restore_in or args.dump_out
    try:
        from app.db_serialize import dump_info
        info = dump_info(path)
        if _HAS_RICH:
            console.print(Panel.fit(
                f"[cyan]Path[/cyan]       : {info['path']}\n"
                f"[cyan]Size[/cyan]       : {info['size_bytes']:,} bytes ({info['size_bytes']/1024:.1f} KB)\n"
                f"[cyan]Total rows[/cyan] : {info['total_rows']}",
                title="JSONL Dump Info",
                border_style="cyan",
            ))
            meta = info["meta"]
            if meta:
                console.print(f"[dim]Format     : {meta.get('format', '?')}[/dim]")
                console.print(f"[dim]Source     : {meta.get('source_url', '?')}[/dim]")
                console.print(f"[dim]Dumped at  : {meta.get('dumped_at', '?')}[/dim]")
        else:
            print(f"Path: {info['path']}")
            print(f"Size: {info['size_bytes']:,} bytes")
            print(f"Total rows: {info['total_rows']}")
        _table(["Table", "Rows"],
               [[t, n] for t, n in info["row_counts"].items()],
               title="Per-table row counts")
        return 0
    except Exception as exc:
        _err(f"dump-info failed: {exc}")
        return 1


def cmd_list_dumps(args) -> int:
    """list-dumps: show all JSONL files in CWD."""
    cwd = Path.cwd()
    dumps = sorted(
        [p for p in cwd.glob("*.jsonl") if p.is_file()],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not dumps:
        _info("JSONL-дампов в текущей директории не найдено.")
        _info("Создайте новый: cli_sqldb.py dump --out backup.jsonl")
        return 0
    from datetime import datetime
    rows = []
    for p in dumps:
        stat = p.stat()
        mtime = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
        size = stat.st_size
        size_str = f"{size/1024:.1f} KB" if size < 1024*1024 else f"{size/1024/1024:.1f} MB"
        rows.append([p.name, size_str, mtime])
    _table(["File", "Size", "Modified"], rows, title=f"Found {len(dumps)} JSONL dump(s)")
    return 0


def cmd_restore(args) -> int:
    """restore: load JSONL dump into current DB."""
    if not args.restore_in:
        _err('Требуется --in: cli_sqldb.py restore --in dump.jsonl')
        _err('Опции: --on-conflict skip|overwrite|upsert|fail, --dry-run')
        _err('Список дампов: cli_sqldb.py list-dumps')
        return 1
    in_path = Path(args.restore_in)
    if not in_path.exists():
        _err(f"Дамп не найден: {in_path}")
        cwd = Path.cwd()
        dumps = sorted(
            [p for p in cwd.glob("*.jsonl") if p.is_file()],
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if dumps:
            _info("Доступные JSONL-файлы:")
            for p in dumps[:10]:
                _info(f"  {p.name}")
        else:
            _info("JSONL-дампов нет. Создайте: cli_sqldb.py dump --out backup.jsonl")
        return 1

    # Map --on-conflict to restore_db mode
    mode = args.on_conflict or "skip"
    try:
        from app.db_serialize import restore_db
        if args.dry_run:
            _info(f"→ [bold]DRY RUN[/bold]: parsing {args.restore_in} ..." if _HAS_RICH
                  else f"→ DRY RUN: parsing {args.restore_in} ...")
            report = restore_db(args.restore_in, mode=mode, dry_run=True)
            _info(f"  Report: {report}")
            return 0
        _info(f"→ restore {args.restore_in} (mode={mode}) ...")
        try:
            report = restore_db(args.restore_in, mode=mode, dry_run=False)
        except PermissionError as perr:
            _err(f"restore failed: {perr}")
            _err("🔒 Целевая БД недоступна для записи.")
            _err(str(perr).replace("Target DB not writable: ", ""))
            return 1
        if _HAS_RICH:
            t = Table(title="Restore Report", show_header=True, header_style="bold")
            t.add_column("Metric", style="cyan")
            t.add_column("Count", justify="right")
            t.add_row("inserted", str(report["inserted"]))
            t.add_row("skipped", str(report["skipped"]))
            t.add_row("overwritten", str(report["overwritten"]))
            t.add_row("upserted", str(report.get("upserted", 0)))
            t.add_row("errors", str(report["errors"]))
            console.print(t)
        else:
            print(f"  inserted   : {report['inserted']}")
            print(f"  skipped    : {report['skipped']}")
            print(f"  overwritten: {report['overwritten']}")
            print(f"  upserted   : {report.get('upserted', 0)}")
            print(f"  errors     : {report['errors']}")
        # Per-table
        rows = [[t, n] for t, n in report["tables"].items()]
        _table(["Table", "Rows"], rows, title="Per-table")
        return 0
    except Exception as exc:
        _err(f"restore failed: {exc}")
        traceback.print_exc()
        return 1


def cmd_transfer(args) -> int:
    """transfer: copy data directly between DBs (no intermediate file)."""
    if not args.transfer_from or not args.transfer_to:
        _err("Требуется --from и --to:")
        _err('')
        _err('Форматы URL:')
        _err('  SQLite       : sqlite:///app.db                          (относительный)')
        _err('  SQLite abs   : sqlite:////var/lib/webadc/app.db          (абсолютный, 4 слеша)')
        _err('  PostgreSQL   : postgresql+psycopg2://USER:PASSWORD@HOST:PORT/DBNAME')
        _err('  MySQL        : mysql+pymysql://USER:PASSWORD@HOST:PORT/DBNAME')
        _err('')
        _err('Пример PostgreSQL → SQLite:')
        _err('  cli_sqldb.py transfer \\')
        _err('    --from "postgresql+psycopg2://samba_api:12345@localhost:5432/samba_api" \\')
        _err('    --to "sqlite:///app.db"')
        _err('')
        _err('Проверить URL до transfer: cli_sqldb.py test-url "..."')
        return 1

    tables = (
        [t.strip() for t in args.tables_filter.split(",") if t.strip()]
        if args.tables_filter else None
    )
    on_conflict = args.on_conflict or "ask"

    if args.dry_run:
        _info("→ [bold]DRY RUN[/bold] transfer:" if _HAS_RICH else "→ DRY RUN transfer:")
        _info(f"    from  : {args.transfer_from}")
        _info(f"    to    : {args.transfer_to}")
        _info(f"    tables: {tables or 'all'}")
        _info(f"    on_conflict: {on_conflict}")
        return 0

    _info("→ [bold]transfer[/bold]:" if _HAS_RICH else "→ transfer:")
    _info(f"    from  : {args.transfer_from}")
    _info(f"    to    : {args.transfer_to}")
    _info(f"    tables: {tables or 'all'}")
    _info(f"    on_conflict: {on_conflict}")

    # Register the rich conflict prompt (unless --on-conflict is non-ask)
    if on_conflict == "ask":
        try:
            from app.db_serialize import set_conflict_prompt
            set_conflict_prompt(_conflict_prompt)
        except ImportError:
            pass

    # Progress bar
    progress_ctx = None
    progress_obj = None
    task_id = None
    current_table = [None]

    def _progress_cb(table: str, current: int, total: int) -> None:
        nonlocal task_id, progress_obj
        if not _HAS_RICH:
            return
        if progress_obj is None:
            return
        if current_table[0] != table:
            current_table[0] = table
            if task_id is not None:
                progress_obj.update(task_id, completed=total, total=total)
            task_id = progress_obj.add_task(table, total=total or 1)
        if task_id is not None:
            progress_obj.update(task_id, completed=current)

    try:
        from app.db_serialize import transfer_db

        if _HAS_RICH:
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                MofNCompleteColumn(),
                TimeRemainingColumn(),
                console=console,
            ) as progress:
                progress_obj = progress
                report = transfer_db(
                    args.transfer_from, args.transfer_to,
                    tables=tables,
                    on_conflict=on_conflict,
                    progress_callback=_progress_cb,
                )
        else:
            report = transfer_db(
                args.transfer_from, args.transfer_to,
                tables=tables,
                on_conflict=on_conflict,
                progress_callback=None,
            )
    except PermissionError as perr:
        _err(f"transfer failed: {perr}")
        _err("🔒 Целевая БД недоступна для записи.")
        _err(str(perr).replace("Target DB not writable: ", ""))
        return 1
    except Exception as exc:
        _err(f"transfer failed: {exc}")
        _diagnose_transfer_error(exc, args.transfer_from, args.transfer_to)
        return 1

    # Report
    schema_sync = report.get("schema_sync", {})
    if schema_sync.get("tables_created"):
        _info(f"ℹ Created {len(schema_sync['tables_created'])} missing table(s) on target:")
        for t in schema_sync["tables_created"]:
            _info(f"    [green]+[/green] {t}")
    if schema_sync.get("columns_added"):
        _info(f"ℹ Added {len(schema_sync['columns_added'])} missing column(s) on target:")
        for c in schema_sync["columns_added"]:
            _info(f"    [green]+[/green] {c}")
    if schema_sync.get("skipped"):
        _warn(f"Skipped {len(schema_sync['skipped'])} column(s):")
        for c in schema_sync["skipped"][:5]:
            _warn(f"    - {c}")

    # Summary
    if _HAS_RICH:
        t = Table(title="Transfer Summary", show_header=True, header_style="bold")
        t.add_column("Metric", style="cyan")
        t.add_column("Count", justify="right")
        t.add_row("copied", str(report["copied"]))
        t.add_row("skipped", str(report["skipped"]))
        t.add_row("overwritten", str(report["overwritten"]))
        t.add_row("upserted", str(report["upserted"]))
        t.add_row("errors", str(report["errors"]))
        t.add_row("[dim]on_conflict[/dim]", report["on_conflict"])
        console.print(t)
    else:
        print(f"  copied     : {report['copied']}")
        print(f"  skipped    : {report['skipped']}")
        print(f"  overwritten: {report['overwritten']}")
        print(f"  upserted   : {report['upserted']}")
        print(f"  errors     : {report['errors']}")

    # Per-table
    rows = []
    for t, n in report["tables"].items():
        if n == -1:
            rows.append([t, "skipped — missing on target"])
        else:
            rows.append([t, n])
    _table(["Table", "Rows"], rows, title=f"Copied across {len(report['tables'])} table(s)")
    return 0


def _diagnose_transfer_error(exc: Exception, from_url: str, to_url: str) -> None:
    """Print helpful diagnostics for common transfer errors."""
    exc_str = str(exc).lower()
    exc_type = type(exc).__name__.lower()
    _err("")
    _err("Возможные причины:")
    if "no module named" in exc_str:
        if "psycopg2" in exc_str:
            _err("  📦 Не установлен psycopg2: pip install psycopg2-binary")
        elif "pymysql" in exc_str:
            _err("  📦 Не установлен pymysql: pip install pymysql")
    elif "operationalerror" in exc_type and ("authentication" in exc_str or "подлинности" in exc_str):
        _err("  🔑 Ошибка аутентификации PostgreSQL")
        _err(f"  URL: {from_url if from_url.startswith('postgresql') else to_url}")
        _err("  Сброс пароля: sudo -u postgres psql -c \"ALTER USER samba_api WITH PASSWORD '12345';\"")
    elif "connection refused" in exc_str or "server closed" in exc_str:
        _err("  🔌 Сервер недоступен: systemctl status postgresql")
    elif "has no column" in exc_str or "no such column" in exc_str:
        _err("  🗄️ Schema drift — обновите app/db_serialize.py")
    elif "readonly" in exc_str or "read-only" in exc_str:
        _err("  🔒 Read-only target — sudo chown $USER:$USER <db_file>")
    elif "not null constraint" in exc_str:
        _err("  ⚠️ NOT NULL — обновите app/db_serialize.py (NULL→default coercion)")
    elif "unique constraint" in exc_str or "duplicate key" in exc_str:
        _err("  ⚠️ UNIQUE conflict — используйте --on-conflict skip|overwrite|upsert")
    _err("")
    _err("Проверить URL: cli_sqldb.py test-url \"<URL>\"")


def cmd_test_url(args) -> int:
    """test-url: verify connection to a DB without writing."""
    url = args.transfer_from or args.revision_id
    if not url:
        _err('Требуется URL: cli_sqldb.py test-url "postgresql+psycopg2://..."')
        _err('Или: cli_sqldb.py test-url --from "sqlite:///app.db"')
        _err('')
        _err('Форматы URL:')
        _err('  SQLite       : sqlite:///app.db')
        _err('  SQLite abs   : sqlite:////var/lib/webadc/app.db')
        _err('  PostgreSQL   : postgresql+psycopg2://USER:PASSWORD@HOST:PORT/DBNAME')
        _err('  MySQL        : mysql+pymysql://USER:PASSWORD@HOST:PORT/DBNAME')
        _err('  DuckDB       : duckdb:///app.duckdb')
        return 1
    try:
        from sqlalchemy import create_engine, inspect, text
        from app.db_serialize import _mask_url
        _info(f"→ Testing connection to: {_mask_url(url)}")
        engine = create_engine(url, future=True)
        with engine.connect() as conn:
            dialect = engine.dialect.name
            if dialect == "sqlite":
                version = conn.execute(text("SELECT sqlite_version()")).scalar()
            elif dialect == "postgresql":
                version = conn.execute(text("SELECT version()")).scalar()
            else:
                version = "?"
            _ok("Connected")
            _info(f"    Dialect: {dialect}")
            _info(f"    Server : {version}")
            insp = inspect(engine)
            tables = sorted(insp.get_table_names())
            _table(["Table"], [[t] for t in tables],
                   title=f"Tables ({len(tables)})")
        engine.dispose()
        return 0
    except Exception as exc:
        _err(f"  ✗ Connection failed: {exc}")
        _err("")
        _err("Возможные причины:")
        exc_str = str(exc).lower()
        if "no module named" in exc_str:
            if "psycopg2" in exc_str:
                _err("  - psycopg2 не установлен: pip install psycopg2-binary")
        elif url.lower().startswith("postgresql"):
            _err("  - Неверный пароль / пользователь")
            _err("  - Сервер не запущен: systemctl status postgresql")
            _err("  - pg_hba.conf блокирует подключение")
        elif url.lower().startswith("sqlite"):
            _err("  - Неверный путь к файлу")
        return 1


def cmd_shell(args) -> int:
    """shell: Python REPL with engine, Session, Base, models."""
    _info("→ Python REPL with engine, Session, Base, models ...")
    _info("  Type Ctrl-D / exit() to leave.")
    try:
        from app.db_sqlalchemy import engine, SessionLocal, Base, session_scope
        import app.models_sqla as models
        from app.db_analytics import query as duck_query
        banner = (
            "Available names:\n"
            "  engine        — SQLAlchemy Engine\n"
            "  SessionLocal  — sessionmaker\n"
            "  session_scope — context manager (use: with session_scope() as db: ...)\n"
            "  Base          — declarative base\n"
            "  models        — app.models_sqla (MgmtUser, MgmtApiKey, MgmtRole, ...)\n"
            "  duck_query    — app.db_analytics.query (read-only DuckDB)\n"
        )
        import code
        code.interact(banner=banner, local={
            "engine": engine,
            "SessionLocal": SessionLocal,
            "session_scope": session_scope,
            "Base": Base,
            "models": models,
            "duck_query": duck_query,
        })
        return 0
    except Exception as exc:
        _err(f"shell failed: {exc}")
        return 1


def cmd_current(args) -> int:
    return _alembic_invoke("current")


def cmd_history(args) -> int:
    return _alembic_invoke("history", "--verbose")


def cmd_stamp(args) -> int:
    target = args.revision_id or "head"
    _info(f"→ alembic stamp {target} ...")
    return _alembic_invoke("stamp", target)


def cmd_downgrade(args) -> int:
    if not args.revision_id:
        _err("Требуется revision_id: cli_sqldb.py downgrade <rev>")
        return 1
    _info(f"→ alembic downgrade {args.revision_id} ...")
    return _alembic_invoke("downgrade", args.revision_id)


def cmd_revision(args) -> int:
    if not args.revision_msg:
        _err('Требуется -m: cli_sqldb.py revision -m "<msg>"')
        return 1
    _info(f"→ alembic revision -m {args.revision_msg!r} --autogenerate ...")
    return _alembic_invoke("revision", "-m", args.revision_msg, "--autogenerate")


# ═══════════════════════════════════════════════════════════════════════
#  CLI entry point
# ═══════════════════════════════════════════════════════════════════════


EPILOG = """\
[bold cyan]Подкоманды pe-a-1.4 — Базовый DB-слой:[/]
  init                              create_all() + seed admin/admin
  upgrade                           alembic upgrade head (auto-stamps if init ran)
  downgrade <rev>                   alembic downgrade <rev>
  stamp [rev]                       пометить миграцию применённой
  revision -m "msg"                 alembic revision --autogenerate
  current                           alembic current
  history                           alembic history
  shell                             Python REPL (engine, Session, models)
  info                              DB_URL + engine + список таблиц
  stats                             количество строк в каждой таблице
  status                            обзор БД (DB_URL, размер, миграции, top-10 таблиц)
  query "SELECT ..."                read-only SQL через DuckDB
  show <table> <id>                 показать запись по PK
  purge <table>                     очистить таблицу (с подтверждением)
  keys                              список API-ключей
  audit [--limit N]                 последние записи аудита

[bold magenta]Подкоманды pe-a-1.4 — Сериализация:[/]
  dump [--out F] [--tables t1,t2]   дамп текущей БД в JSONL
  dump-info --in F                  инфо о JSONL-дампе
  list-dumps                        список *.jsonl в текущей директории
  restore --in F [--on-conflict MODE] [--dry-run]
                                    восстановить из JSONL
  transfer --from URL --to URL [--on-conflict MODE] [--tables t1,t2] [--dry-run]
                                    прямое копирование между БД
  test-url "URL"                    проверить подключение к БД

[bold yellow]--on-conflict MODE[/] (для transfer / restore):
  ask          спросить интерактивно при каждом конфликте (по умолчанию)
  skip         пропустить source-строку (target не трогать)
  overwrite    удалить target-строку, вставить source
  upsert       UPDATE target-строки значениями из source
  fail         прервать при первом конфликте

[bold]Форматы URL:[/]
  SQLite (отн.)  : sqlite:///app.db
  SQLite (абс.)  : sqlite:////var/lib/webadc/app.db          ← 4 слеша!
  PostgreSQL     : postgresql+psycopg2://USER:PASSWORD@HOST:PORT/DBNAME
  MySQL          : mysql+pymysql://USER:PASSWORD@HOST:PORT/DBNAME
  DuckDB         : duckdb:///app.duckdb

[bold]Примеры:[/]
  # PostgreSQL → SQLite (с интерактивным выбором при конфликтах)
  webadc sqldb transfer \\
    --from "postgresql+psycopg2://samba_api:12345@localhost:5432/samba_api" \\
    --to "sqlite:///app.db" --on-conflict ask

  # Backup → restore с overwrite (перезаписать существующие PK)
  webadc sqldb dump --out backup.jsonl
  webadc sqldb restore --in backup.jsonl --on-conflict overwrite

  # Только mgmt_users, skip конфликтующие
  webadc sqldb transfer --from "sqlite:///app.db" --to "sqlite:///copy.db" \\
    --tables mgmt_users --on-conflict skip
"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="webadc sqldb",
        description="WEBADC — единый DB-слой (SQLAlchemy + Alembic + DuckDB), pe-a-1.4",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=EPILOG if not _HAS_RICH else None,
    )
    parser.add_argument("sqldb_cmd", choices=[
        "init", "upgrade", "downgrade", "revision", "stamp",
        "current", "history", "shell", "info", "stats", "status", "query",
        "show", "purge", "keys", "audit",
        "dump", "restore", "transfer", "dump-info",
        "test-url", "list-dumps",
    ], help="Подкоманда")
    parser.add_argument("revision_id", nargs="?", default=None,
                        help="Revision id для downgrade/stamp")
    parser.add_argument("-m", "--message", dest="revision_msg", default=None,
                        help="Сообщение для новой миграции (revision)")
    parser.add_argument("sql", nargs="?", default=None,
                        help="SQL для query")
    parser.add_argument("--out", dest="dump_out", default=None,
                        help="Путь выходного файла для dump")
    parser.add_argument("--in", dest="restore_in", default=None,
                        help="Путь JSONL-файла для restore")
    parser.add_argument("--mode", dest="restore_mode", default=None,
                        help="Алиас для --on-conflict (restore)")
    parser.add_argument("--on-conflict", dest="on_conflict", default=None,
                        choices=["ask", "skip", "overwrite", "upsert", "fail"],
                        help="Поведение при PK-конфликте")
    parser.add_argument("--dry-run", dest="dry_run", action="store_true",
                        help="Только проверить, без записи")
    parser.add_argument("--from", dest="transfer_from", default=None,
                        help="Source URL для transfer")
    parser.add_argument("--to", dest="transfer_to", default=None,
                        help="Target URL для transfer")
    parser.add_argument("--tables", dest="tables_filter", default=None,
                        help="Фильтр таблиц через запятую")
    parser.add_argument("--limit", type=int, default=20,
                        help="Лимит записей для audit (по умолчанию: 20)")
    parser.add_argument("--yes", "-y", action="store_true", dest="auto_yes",
                        help="Auto-confirm destructive actions (purge)")
    return parser


# Map subcommands to handler functions
COMMANDS = {
    "init": cmd_init,
    "upgrade": cmd_upgrade,
    "downgrade": cmd_downgrade,
    "revision": cmd_revision,
    "stamp": cmd_stamp,
    "current": cmd_current,
    "history": cmd_history,
    "shell": cmd_shell,
    "info": cmd_info,
    "stats": cmd_stats,
    "status": cmd_status,
    "query": cmd_query,
    "show": cmd_show,
    "purge": cmd_purge,
    "keys": cmd_keys,
    "audit": cmd_audit,
    "dump": cmd_dump,
    "restore": cmd_restore,
    "transfer": cmd_transfer,
    "dump-info": cmd_dump_info,
    "test-url": cmd_test_url,
    "list-dumps": cmd_list_dumps,
}


def main(argv: list = None) -> int:
    """Entry point. Returns exit code."""
    parser = build_parser()
    args = parser.parse_args(argv)

    # For restore: --on-conflict takes precedence, fall back to --mode for back-compat
    if args.on_conflict is None and args.restore_mode is not None:
        args.on_conflict = args.restore_mode

    handler = COMMANDS.get(args.sqldb_cmd)
    if handler is None:
        _err(f"Неизвестная подкоманда: {args.sqldb_cmd}")
        return 1
    return handler(args) or 0


if __name__ == "__main__":
    sys.exit(main())
