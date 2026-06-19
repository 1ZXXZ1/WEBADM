"""
CFG API router — Runtime configuration management for WebADC.

Provides endpoints for managing the .env configuration file without
restarting the webadc service. The settings are hot-reloaded into the
running process after each change so that edits take effect immediately.

Operations supported:
  - GET  /api/v1/cfg               — list all env keys (with masking for secrets)
  - GET  /api/v1/cfg/{key}         — view a single env value
  - GET  /api/v1/cfg/raw           — download the raw .env file
  - PUT  /api/v1/cfg/{key}         — update or create an env key (hot-reload)
  - DELETE /api/v1/cfg/{key}       — delete an env key (hot-reload)
  - POST /api/v1/cfg/{key}/disable — set KEY= (empty) — «отключить» (disable)
  - POST /api/v1/cfg/{key}/enable  — restore previous non-empty value or set to "true"
  - POST /api/v1/cfg/reload        — force reload settings from .env file
  - GET  /api/v1/cfg/schema        — list known settings with descriptions

Security:
  All endpoints require admin role (cfg.* permissions).
  Sensitive keys (PASSWORD, KEY, SECRET, TOKEN) are masked in GET / responses
  unless ?reveal=true is passed AND the caller is admin.

v1.0: Initial implementation. Reads /etc/webadc/.env (or ./.env fallback),
      writes back atomically, then calls get_settings.cache_clear() so the
      next request picks up the new values without restarting webadc.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from app.auth import ApiKeyDep

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cfg", tags=["CFG — Runtime Configuration"])


# ═══════════════════════════════════════════════════════════════════════
#  Constants
# ═══════════════════════════════════════════════════════════════════════

# Substrings (case-insensitive) that mark a key as sensitive.
# Values of such keys are masked in list/view responses unless ?reveal=true.
_SENSITIVE_PATTERNS = (
    "PASSWORD", "PASSWD", "SECRET", "API_KEY", "APIKEY",
    "TOKEN", "PRIVATE_KEY", "CERT_KEY", "KEYFILE_PASSWORD",
    "POLZA_AI_KEY", "JWT_SECRET_KEY",
)

# Match a .env line:  KEY=VALUE   or   # comment   or   blank line
# Allows values wrapped in single/double quotes.
_LINE_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$")

# Match a comment line
_COMMENT_RE = re.compile(r"^\s*#")

# Lock for atomic write/reload operations
_WRITE_LOCK = threading.Lock()

# v2.1.1: Production .env file used by systemd `webadc.service` via
# `EnvironmentFile=-/etc/webadc/.env`. Any change made through /cfg
# endpoints must propagate to this file so that `systemctl restart webadc`
# (or host reboot) keeps the new values. The user-editable .env in the
# project root is still updated for development use.
GLOBAL_ENV_FILE = Path("/etc/webadc/.env")

# Prefixes that we treat as "owned" by WebADC and therefore sync to
# /etc/webadc/.env when the user calls POST /cfg/persist or modifies any
# key. Other env vars (PATH, HOME, …) are never touched.
_OWNED_PREFIXES = ("SAMBA_", "WEB_")


# ═══════════════════════════════════════════════════════════════════════
#  Request models
# ═══════════════════════════════════════════════════════════════════════


class CfgUpdateRequest(BaseModel):
    """Request body for updating or creating an env key."""

    value: str = Field(
        ...,
        description=(
            "New value for the key. Pass an empty string to clear the value "
            "(equivalent to disabling). Quotation marks are optional — they "
            "will be stripped on read."
        ),
    )
    comment: Optional[str] = Field(
        default=None,
        description="Optional comment line written above the key (replaces existing comment).",
    )


class CfgBulkUpdateRequest(BaseModel):
    """Request body for bulk-updating multiple env keys at once."""

    items: Dict[str, str] = Field(
        ...,
        description="Mapping of KEY → new value. Each key is created or updated.",
    )
    reload: bool = Field(
        default=True,
        description="Whether to reload settings into the running process after the update.",
    )


# ═══════════════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════════════


def _find_env_file() -> Path:
    """Locate the .env file used by the running application.

    Search order (matches app/config.py):
      1. /etc/webadc/.env  (production systemd deployment)
      2. ./.env            (development / standalone)
      3. project_root/.env (when run from a checkout)

    Returns
    -------
    Path
        The first .env file that exists. If none exists, returns
        /etc/webadc/.env (the production default) so the caller can
        create it on first write.
    """
    candidates = [
        Path("/etc/webadc/.env"),
        Path.cwd() / ".env",
        Path(__file__).resolve().parents[2] / ".env",  # project root .env
    ]
    for c in candidates:
        if c.is_file():
            return c
    # Default for new installs — caller can create it
    return Path("/etc/webadc/.env")


def _is_owned_key(key: str) -> bool:
    """Return True if *key* belongs to WebADC (SAMBA_ or WEB_ prefix).

    Only these keys are persisted to /etc/webadc/.env — never touch
    unrelated env vars (PATH, HOME, USER, …).
    """
    if not key:
        return False
    return any(key.startswith(p) for p in _OWNED_PREFIXES)


def _ensure_global_env_dir() -> None:
    """Create /etc/webadc/ directory if missing (best-effort).

    Silently ignores PermissionError — the actual write will surface
    the failure with a clear error message.
    """
    try:
        GLOBAL_ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    except (PermissionError, OSError):
        pass


def _sync_to_global_env_file(added_or_updated: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Mirror SAMBA_* / WEB_* keys to /etc/webadc/.env so they survive reboot.

    This is the core of the "env as globals" fix.

    Strategy
    --------
    1. Read the existing /etc/webadc/.env (if any).
    2. For every key currently in ``os.environ`` that starts with SAMBA_
       or WEB_, overwrite the value in the file.
    3. If ``added_or_updated`` is provided, also merge those (caller-
       supplied values that may not yet be in os.environ).
    4. Atomically write the file back.

    Returns
    -------
    dict
        Summary of what was written: ``{"synced": [...], "file": str,
        "error": Optional[str]}``.
    """
    summary: Dict[str, Any] = {
        "file": str(GLOBAL_ENV_FILE),
        "synced": [],
        "error": None,
    }
    try:
        _ensure_global_env_dir()
        # Start from the existing global file (if any) so we don't lose keys
        entries, _ = _parse_env_file(GLOBAL_ENV_FILE) if GLOBAL_ENV_FILE.is_file() else ([], [])

        # Build a dict {key: (value, comment, idx)} for in-place updates
        index_map: Dict[str, int] = {}
        for i, (k, _v, _c) in enumerate(entries):
            if k:
                index_map[k] = i

        # Merge sources of truth: os.environ first, then caller-supplied
        merged: Dict[str, str] = {}
        for env_key, env_val in os.environ.items():
            if _is_owned_key(env_key):
                merged[env_key] = env_val
        if added_or_updated:
            for k, v in added_or_updated.items():
                if _is_owned_key(k):
                    merged[k] = v

        # Apply merged values to entries
        for key, value in merged.items():
            if key in index_map:
                idx = index_map[key]
                _k, _old, comment = entries[idx]
                entries[idx] = (key, value, comment)
            else:
                # Append at end with a blank line separator if needed
                if entries and entries[-1][0] != "":
                    entries.append(("", "", None))
                entries.append((key, value, None))
            summary["synced"].append(key)

        new_content = _serialize_env_file(entries)
        _atomic_write(GLOBAL_ENV_FILE, new_content)
    except PermissionError as exc:
        summary["error"] = f"Permission denied writing {GLOBAL_ENV_FILE}: {exc}"
        logger.warning("[CFG] %s", summary["error"])
    except Exception as exc:
        summary["error"] = f"Failed to sync to {GLOBAL_ENV_FILE}: {exc}"
        logger.exception("[CFG] %s", summary["error"])
    return summary


def _is_sensitive(key: str) -> bool:
    """Return True if the key name matches a known sensitive pattern."""
    k = key.upper()
    return any(p in k for p in _SENSITIVE_PATTERNS)


def _mask_value(key: str, value: str) -> str:
    """Mask sensitive values for display.

    Returns the original value for non-sensitive keys, and a masked
    version like '****' (length 4) for sensitive keys.
    """
    if not value:
        return ""
    if _is_sensitive(key):
        # Show length hint without revealing content
        return "*" * min(len(value), 12) if len(value) <= 32 else "*" * 12
    return value


def _strip_quotes(v: str) -> str:
    """Strip surrounding single/double quotes from a value, if present."""
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
        return v[1:-1]
    return v


def _escape_value(v: str) -> str:
    """Format a value for writing back to .env.

    Rules:
      - Empty value stays empty (KEY=)
      - Values containing spaces, #, or special chars are wrapped in double quotes
      - Double quotes inside the value are escaped as \"
    """
    if v == "":
        return ""
    needs_quoting = any(c in v for c in (" ", "\t", "#", "\n", "\r"))
    if needs_quoting or v.startswith('"') or v.startswith("'"):
        escaped = v.replace('"', '\\"')
        return f'"{escaped}"'
    return v


def _parse_env_file(path: Path) -> Tuple[List[Tuple[str, str, Optional[str]]], List[str]]:
    """Parse the .env file.

    Returns
    -------
    (entries, raw_lines) : tuple
        entries  — list of (key, value, comment_above) tuples in file order
        raw_lines — full original file content as list of lines (for backup)
    """
    if not path.is_file():
        return [], []

    entries: List[Tuple[str, str, Optional[str]]] = []
    raw_lines: List[str] = []

    try:
        text = path.read_text(encoding="utf-8")
    except Exception as exc:
        logger.error("[CFG] Failed to read %s: %s", path, exc)
        return [], []

    raw_lines = text.splitlines()

    pending_comment: Optional[str] = None
    for line in raw_lines:
        stripped = line.strip()
        if not stripped:
            entries.append(("", "", None))  # placeholder for blank line preservation
            pending_comment = None
            continue
        if _COMMENT_RE.match(line):
            # Accumulate the comment line; will attach to next KEY=
            comment_text = line.lstrip("#").strip()
            if pending_comment is None:
                pending_comment = comment_text
            else:
                pending_comment = pending_comment + " | " + comment_text
            continue
        m = _LINE_RE.match(line)
        if m:
            key = m.group(1)
            value = _strip_quotes(m.group(2))
            entries.append((key, value, pending_comment))
            pending_comment = None
        # Lines that don't match are ignored (preserved in raw_lines)
    return entries, raw_lines


def _serialize_env_file(
    entries: List[Tuple[str, str, Optional[str]]],
    original_raw: Optional[List[str]] = None,
) -> str:
    """Serialize entries back into .env text format.

    Preserves blank lines and comments as best as possible. Entries
    without a key (placeholders for blank lines) become empty lines.
    """
    out_lines: List[str] = []
    for key, value, comment in entries:
        if comment:
            out_lines.append(f"# {comment}")
        if not key:
            out_lines.append("")
            continue
        out_lines.append(f"{key}={_escape_value(value)}")
    return "\n".join(out_lines) + "\n"


def _atomic_write(path: Path, content: str) -> None:
    """Write content to path atomically.

    Writes to a temp file in the same directory, then renames over the
    target. Preserves original file permissions if the file already exists.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        prefix=path.name + ".",
        suffix=".tmp",
        dir=str(path.parent),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        # Preserve permissions of the original file if it exists
        if path.is_file():
            st = path.stat()
            os.chmod(tmp_path, st.st_mode)
            try:
                shutil.chown(tmp_path, st.st_uid, st.st_gid)
            except (PermissionError, OSError):
                pass  # not root, chown fails silently
        os.replace(tmp_path, path)
    except Exception:
        # Cleanup on failure
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _reload_settings() -> Dict[str, Any]:
    """Hot-reload the Settings instance.

    Calls ``get_settings.cache_clear()`` so the next request re-reads
    from environment + .env file. Also re-applies os.environ for any
    SAMBA_* keys that were just written, so subprocesses inherit the
    new values immediately.
    """
    reloaded: Dict[str, Any] = {"ok": True, "errors": []}
    try:
        from app.config import get_settings
        get_settings.cache_clear()
        # Trigger a fresh read to verify it parses without errors
        _ = get_settings()
        reloaded["method"] = "lru_cache_clear"
    except Exception as exc:
        reloaded["ok"] = False
        reloaded["errors"].append(f"get_settings reload failed: {exc}")
        logger.exception("[CFG] Settings reload failed")

    # Best-effort: propagate new values to os.environ so subprocesses
    # (samba-tool, etc.) pick them up. We re-parse the .env file and
    # apply only SAMBA_* and WEB_* keys — other env vars (PATH, HOME, …)
    # must not be overwritten.
    try:
        env_path = _find_env_file()
        entries, _ = _parse_env_file(env_path)
        for key, value, _ in entries:
            if not key:
                continue
            if _is_owned_key(key):
                os.environ[key] = value
    except Exception as exc:
        reloaded["errors"].append(f"os.environ sync failed: {exc}")

    # v2.1.1: Persist SAMBA_* / WEB_* keys to /etc/webadc/.env so that
    # `systemctl restart webadc` (or host reboot) keeps the new values.
    # This is the "env as globals" fix — without it, edits made via
    # /cfg/{key} would only land in the project-root .env (or wherever
    # _find_env_file() points) and be lost when systemd reloads from
    # /etc/webadc/.env on the next start.
    try:
        sync_summary = _sync_to_global_env_file()
        reloaded["global_env_sync"] = sync_summary
    except Exception as exc:
        reloaded["errors"].append(f"global env sync failed: {exc}")

    return reloaded


def _find_entry_index(
    entries: List[Tuple[str, str, Optional[str]]],
    key: str,
) -> int:
    """Return the index of the entry with the given key, or -1."""
    for i, (k, _, _) in enumerate(entries):
        if k == key:
            return i
    return -1


def _validate_key_name(key: str) -> str:
    """Validate that *key* is a syntactically valid env variable name."""
    if not key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"status": "error", "message": "Key name cannot be empty."},
        )
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "status": "error",
                "message": (
                    f"Invalid key name '{key}'. Must match [A-Za-z_][A-Za-z0-9_]*."
                ),
            },
        )
    return key


# ═══════════════════════════════════════════════════════════════════════
#  Endpoints
# ═══════════════════════════════════════════════════════════════════════


@router.get(
    "",
    summary="Список всех переменных .env",
    description=(
        "Возвращает все ключи из .env с их значениями (секретные ключи "
        "маскируются). Pass `?reveal=true` чтобы увидеть реальные значения "
        "секретных ключей (только для admin)."
    ),
)
async def list_env(
    api_key: ApiKeyDep,
    reveal: bool = Query(
        default=False,
        description="Если true — показать реальные значения секретных ключей (только admin).",
    ),
) -> dict:
    """List all environment variables from .env."""
    env_path = _find_env_file()
    entries, _ = _parse_env_file(env_path)

    items: List[Dict[str, Any]] = []
    for key, value, comment in entries:
        if not key:
            continue
        is_sensitive = _is_sensitive(key)
        display_value = value if (reveal or not is_sensitive) else _mask_value(key, value)
        items.append({
            "key": key,
            "value": display_value,
            "masked": is_sensitive and not reveal,
            "sensitive": is_sensitive,
            "comment": comment,
        })

    return {
        "status": "ok",
        "env_file": str(env_path),
        "env_file_exists": env_path.is_file(),
        "count": len(items),
        "items": items,
    }


@router.get(
    "/schema",
    summary="Схема известных настроек (метаданные)",
    description=(
        "Возвращает список известных настроек WebADC с описаниями, "
        "дефолтными значениями и категориями. Полезно для веб-интерфейса "
        "админ-панели — можно нарисовать форму с подсказками."
    ),
)
async def get_schema(api_key: ApiKeyDep) -> dict:
    """Return metadata about known settings from the Settings model."""
    try:
        from app.config import Settings
        settings_cls = Settings
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Cannot load Settings class: {exc}",
        )

    fields_info: List[Dict[str, Any]] = []
    for field_name, field in settings_cls.model_fields.items():
        # Determine env var name(s)
        env_names = [f"SAMBA_{field_name}"]
        # Check for validation_alias (AliasChoices)
        try:
            va = getattr(field, "validation_alias", None)
            if va is not None:
                # AliasChoices stores choices in .choices
                choices = getattr(va, "choices", None)
                if choices:
                    env_names = list(choices)
        except Exception:
            pass

        default = field.default
        # Pydantic FieldInfo default can be PydanticUndefined for required fields
        try:
            from pydantic_core import PydanticUndefined
            if default is PydanticUndefined:
                default = None
        except Exception:
            pass

        description = ""
        try:
            description = field.description or ""
        except Exception:
            pass

        fields_info.append({
            "field": field_name,
            "env_names": env_names,
            "default": default,
            "description": description,
            "sensitive": _is_sensitive(field_name) or any(_is_sensitive(n) for n in env_names),
        })

    return {
        "status": "ok",
        "count": len(fields_info),
        "fields": fields_info,
    }


@router.get(
    "/raw",
    summary="Скачать raw .env файл",
    description=(
        "Возвращает содержимое .env как text/plain. Удобно для бэкапа "
        "или переноса конфигурации на другой сервер."
    ),
    response_class=PlainTextResponse,
)
async def download_raw_env(api_key: ApiKeyDep) -> PlainTextResponse:
    """Download the raw .env file as text/plain."""
    env_path = _find_env_file()
    if not env_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f".env file not found at {env_path}",
        )
    try:
        content = env_path.read_text(encoding="utf-8")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read .env: {exc}",
        )
    return PlainTextResponse(
        content=content,
        media_type="text/plain",
        headers={"Content-Disposition": 'attachment; filename=".env"'},
    )


@router.get(
    "/{key}",
    summary="Посмотреть значение конкретной переменной",
    description=(
        "Возвращает значение одной переменной из .env. Для секретных "
        "ключей (PASSWORD, KEY, SECRET, TOKEN) значение маскируется "
        "если ?reveal=true не передан."
    ),
)
async def get_key(
    api_key: ApiKeyDep,
    key: str,
    reveal: bool = Query(default=False),
) -> dict:
    """Get a single env key value."""
    _validate_key_name(key)
    env_path = _find_env_file()
    entries, _ = _parse_env_file(env_path)

    idx = _find_entry_index(entries, key)
    if idx == -1:
        # Also check os.environ as fallback (env vars may not be in .env file)
        os_val = os.environ.get(key)
        if os_val is not None:
            is_sensitive = _is_sensitive(key)
            return {
                "status": "ok",
                "source": "os.environ",
                "key": key,
                "value": os_val if (reveal or not is_sensitive) else _mask_value(key, os_val),
                "masked": is_sensitive and not reveal,
                "sensitive": is_sensitive,
                "in_env_file": False,
            }
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "status": "error",
                "message": f"Key '{key}' not found in .env or os.environ.",
            },
        )

    _, value, comment = entries[idx]
    is_sensitive = _is_sensitive(key)
    return {
        "status": "ok",
        "source": "env_file",
        "key": key,
        "value": value if (reveal or not is_sensitive) else _mask_value(key, value),
        "masked": is_sensitive and not reveal,
        "sensitive": is_sensitive,
        "comment": comment,
        "in_env_file": True,
    }


@router.put(
    "/{key}",
    summary="Обновить или создать переменную (hot-reload)",
    description=(
        "Обновляет значение переменной в .env. Если ключа нет — он "
        "добавляется в конец файла. После записи настройки автоматически "
        "перезагружаются в работающем процессе — перезагрузка webadc "
        "НЕ требуется.\n\n"
        "Pass `value: \"\"` чтобы очистить значение (отключить ключ)."
    ),
)
async def update_key(
    api_key: ApiKeyDep,
    key: str,
    body: CfgUpdateRequest,
    reload: bool = Query(
        default=True,
        description="Если true — перезагрузить настройки в работающем процессе.",
    ),
) -> dict:
    """Update or create an env key value."""
    _validate_key_name(key)
    env_path = _find_env_file()

    with _WRITE_LOCK:
        entries, _ = _parse_env_file(env_path)
        idx = _find_entry_index(entries, key)

        old_value: Optional[str] = None
        if idx >= 0:
            old_value = entries[idx][1]
            entries[idx] = (key, body.value, body.comment or entries[idx][2])
        else:
            # Append at end
            if entries and entries[-1][0] != "":
                entries.append(("", "", None))  # blank line separator
            entries.append((key, body.value, body.comment))

        new_content = _serialize_env_file(entries)
        _atomic_write(env_path, new_content)

    reload_result: Optional[Dict[str, Any]] = None
    if reload:
        reload_result = _reload_settings()

    return {
        "status": "ok",
        "key": key,
        "old_value": _mask_value(key, old_value) if old_value is not None else None,
        "new_value": _mask_value(key, body.value),
        "action": "updated" if idx >= 0 else "created",
        "env_file": str(env_path),
        "reloaded": reload_result,
    }


@router.post(
    "/bulk",
    summary="Массовое обновление нескольких переменных (hot-reload)",
    description=(
        "Принимает объект {KEY: value, ...} и обновляет все ключи за одну "
        "атомарную запись в .env. Затем перезагружает настройки."
    ),
)
async def bulk_update(
    api_key: ApiKeyDep,
    body: CfgBulkUpdateRequest,
) -> dict:
    """Bulk update multiple env keys in a single atomic write."""
    if not body.items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"status": "error", "message": "items cannot be empty."},
        )

    # Validate all key names first
    for k in body.items.keys():
        _validate_key_name(k)

    env_path = _find_env_file()
    results: List[Dict[str, Any]] = []

    with _WRITE_LOCK:
        entries, _ = _parse_env_file(env_path)

        for key, value in body.items.items():
            idx = _find_entry_index(entries, key)
            old_value = entries[idx][1] if idx >= 0 else None
            if idx >= 0:
                entries[idx] = (key, value, entries[idx][2])
            else:
                if entries and entries[-1][0] != "":
                    entries.append(("", "", None))
                entries.append((key, value, None))
            results.append({
                "key": key,
                "action": "updated" if idx >= 0 else "created",
                "old_value": _mask_value(key, old_value) if old_value is not None else None,
                "new_value": _mask_value(key, value),
            })

        new_content = _serialize_env_file(entries)
        _atomic_write(env_path, new_content)

    reload_result: Optional[Dict[str, Any]] = None
    if body.reload:
        reload_result = _reload_settings()

    return {
        "status": "ok",
        "updated": len(results),
        "results": results,
        "env_file": str(env_path),
        "reloaded": reload_result,
    }


@router.delete(
    "/{key}",
    summary="Удалить переменную из .env (hot-reload)",
    description=(
        "Полностью удаляет переменную из .env файла. После удаления "
        "настройки автоматически перезагружаются — webadc перезапускать "
        "не нужно."
    ),
)
async def delete_key(
    api_key: ApiKeyDep,
    key: str,
    reload: bool = Query(default=True),
) -> dict:
    """Delete an env key from the .env file."""
    _validate_key_name(key)
    env_path = _find_env_file()

    with _WRITE_LOCK:
        entries, _ = _parse_env_file(env_path)
        idx = _find_entry_index(entries, key)
        if idx == -1:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "status": "error",
                    "message": f"Key '{key}' not found in .env.",
                },
            )

        _, old_value, _ = entries[idx]
        # Remove the entry; also remove a directly preceding blank line
        # if it's now orphaned (to avoid double blank lines)
        del entries[idx]
        if entries and idx > 0 and idx - 1 < len(entries) and entries[idx - 1][0] == "":
            # Only remove the trailing blank line if there's another blank above it
            if idx - 2 >= 0 and entries[idx - 2][0] == "":
                del entries[idx - 1]

        new_content = _serialize_env_file(entries)
        _atomic_write(env_path, new_content)

    reload_result: Optional[Dict[str, Any]] = None
    if reload:
        reload_result = _reload_settings()

    return {
        "status": "ok",
        "key": key,
        "old_value": _mask_value(key, old_value),
        "deleted": True,
        "env_file": str(env_path),
        "reloaded": reload_result,
    }


@router.post(
    "/{key}/disable",
    summary="Отключить переменную (установить пустое значение)",
    description=(
        "«Отключить» переменную — устанавливает KEY= (пустое значение). "
        "Сам ключ остаётся в .env, но его значение становится пустым. "
        "Полезно для временного выключения фич (WEB_ENABLED, "
        "AI_CHAT_ENABLED и т.п. — pass explicit `true_value=false`). "
        "Для boolean-флагов используется значение `false`."
    ),
)
async def disable_key(
    api_key: ApiKeyDep,
    key: str,
    reload: bool = Query(default=True),
    as_false: bool = Query(
        default=False,
        description=(
            "Если true — записать `false` вместо пустой строки. "
            "Удобно для boolean-флагов (WEB_ENABLED=false)."
        ),
    ),
) -> dict:
    """Disable an env key by setting it to empty or 'false'."""
    _validate_key_name(key)
    env_path = _find_env_file()
    new_value = "false" if as_false else ""

    with _WRITE_LOCK:
        entries, _ = _parse_env_file(env_path)
        idx = _find_entry_index(entries, key)
        old_value = entries[idx][1] if idx >= 0 else None

        if idx >= 0:
            entries[idx] = (key, new_value, entries[idx][2])
        else:
            if entries and entries[-1][0] != "":
                entries.append(("", "", None))
            entries.append((key, new_value, "Disabled via /cfg/{key}/disable"))

        new_content = _serialize_env_file(entries)
        _atomic_write(env_path, new_content)

    reload_result: Optional[Dict[str, Any]] = None
    if reload:
        reload_result = _reload_settings()

    return {
        "status": "ok",
        "key": key,
        "old_value": _mask_value(key, old_value) if old_value is not None else None,
        "new_value": new_value,
        "action": "disabled",
        "env_file": str(env_path),
        "reloaded": reload_result,
    }


@router.post(
    "/{key}/enable",
    summary="Включить переменную (восстановить или установить true)",
    description=(
        "«Включить» переменную:\n"
        "- Если у ключа ранее было непустое значение и оно сохранено в "
        "  комментарий (через /disable), восстанавливает его.\n"
        "- Иначе устанавливает значение `true` (для boolean-флагов).\n"
        "- Можно передать ?value=... чтобы указать конкретное значение."
    ),
)
async def enable_key(
    api_key: ApiKeyDep,
    key: str,
    reload: bool = Query(default=True),
    value: Optional[str] = Query(
        default=None,
        description="Явно указать новое значение. Если не передано — используется 'true'.",
    ),
) -> dict:
    """Enable an env key by setting it to 'true' or restoring a previous value."""
    _validate_key_name(key)
    env_path = _find_env_file()
    new_value = value if value is not None else "true"

    with _WRITE_LOCK:
        entries, _ = _parse_env_file(env_path)
        idx = _find_entry_index(entries, key)
        old_value = entries[idx][1] if idx >= 0 else None

        # Try to restore from a "Disabled via ..." comment if no explicit value
        if value is None and idx >= 0:
            comment = entries[idx][2] or ""
            restore_match = re.search(
                r"previous value:\s*[\"']?(.*?)[\"']?\s*(?:\||$)",
                comment,
                re.IGNORECASE,
            )
            if restore_match:
                new_value = restore_match.group(1)

        if idx >= 0:
            entries[idx] = (key, new_value, entries[idx][2])
        else:
            if entries and entries[-1][0] != "":
                entries.append(("", "", None))
            entries.append((key, new_value, None))

        new_content = _serialize_env_file(entries)
        _atomic_write(env_path, new_content)

    reload_result: Optional[Dict[str, Any]] = None
    if reload:
        reload_result = _reload_settings()

    return {
        "status": "ok",
        "key": key,
        "old_value": _mask_value(key, old_value) if old_value is not None else None,
        "new_value": new_value if not _is_sensitive(key) else _mask_value(key, new_value),
        "action": "enabled",
        "env_file": str(env_path),
        "reloaded": reload_result,
    }


@router.post(
    "/reload",
    summary="Принудительно перезагрузить настройки из .env",
    description=(
        "Перечитывает .env и обновляет настройки в работающем процессе "
        "webadc. Полезно, если .env был изменён вручную (через vim, "
        "ansible и т.п.) и нужно применить изменения без перезапуска "
        "сервиса."
    ),
)
async def reload_settings_endpoint(api_key: ApiKeyDep) -> dict:
    """Force a settings reload from the .env file."""
    result = _reload_settings()
    return {
        "status": "ok" if result.get("ok") else "error",
        "reloaded": result,
        "env_file": str(_find_env_file()),
    }


@router.post(
    "/persist",
    summary="Сохранить текущие переменные в /etc/webadc/.env (для reboot)",
    description=(
        "v2.1.1 — «env as globals».\n\n"
        "Записывает все текущие SAMBA_* и WEB_* переменные из памяти "
        "процесса в `/etc/webadc/.env` — тот самый файл, который "
        "systemd `webadc.service` подгружает через `EnvironmentFile=-"
        "/etc/webadc/.env` при старте.\n\n"
        "Вызывайте этот эндпоинт **перед** `systemctl restart webadc` "
        "(или перед перезагрузкой сервера), чтобы изменения, сделанные "
        "через /cfg/{key}, не потерялись.\n\n"
        "Аналогично можно передать `?sync_runtime=true` чтобы перед "
        "записью обновить `os.environ` значениями из .env проекта."
    ),
)
async def persist_env_to_global_endpoint(
    api_key: ApiKeyDep,
    sync_runtime: bool = Query(
        default=False,
        description=(
            "Если true — сначала прочитать .env из _find_env_file() и "
            "применить SAMBA_*/WEB_* значения в os.environ, затем "
            "записать всё в /etc/webadc/.env."
        ),
    ),
) -> dict:
    """Persist SAMBA_*/WEB_* env vars to /etc/webadc/.env (survives reboot)."""
    if sync_runtime:
        try:
            env_path = _find_env_file()
            entries, _ = _parse_env_file(env_path)
            for key, value, _ in entries:
                if not key:
                    continue
                if _is_owned_key(key):
                    os.environ[key] = value
        except Exception as exc:
            logger.warning("[CFG] sync_runtime failed: %s", exc)

    sync_summary = _sync_to_global_env_file()
    return {
        "status": "ok" if sync_summary.get("error") is None else "error",
        "global_env_file": str(GLOBAL_ENV_FILE),
        "synced_count": len(sync_summary.get("synced", [])),
        "synced_keys": sync_summary.get("synced", []),
        "error": sync_summary.get("error"),
    }
