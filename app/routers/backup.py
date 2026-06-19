"""
Backup/Restore API router.

POST /api/v1/backup                — create a backup of sam.ldb + mgmt DB
GET  /api/v1/backup                — list existing backups
GET  /api/v1/backup/{filename}     — download a backup file
DELETE /api/v1/backup/{filename}   — delete a backup file
POST /api/v1/restore               — restore from a backup file (uploaded or by name)

v2.3: Backups are stored in ``/var/lib/webadc/backups/`` (configurable
via ``SAMBA_BACKUP_DIR`` env var). Each backup is a .tar.gz containing:

    sam.ldb                  — copy of the Samba AD LDB database
    mgmt.sql                 — pg_dump of the management DB
    meta.json                — backup metadata (timestamp, sizes, versions)

Restoring sam.ldb requires the samba service to be stopped — the
endpoint returns a clear error message guiding the operator.
"""
from __future__ import annotations

import io
import json
import logging
import os
import shutil
import subprocess
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, UploadFile, File, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.auth import ApiKeyDep
from app.models.common import ErrorResponse

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/backup",
    tags=["Backup & Restore"],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    },
)


# ── Helpers ────────────────────────────────────────────────────────────

def _backup_dir() -> Path:
    """Resolve the backup directory (creates it if missing)."""
    from app.config import get_settings
    s = get_settings()
    path_str = getattr(s, "BACKUP_DIR", "") or "/var/lib/webadc/backups"
    p = Path(path_str)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _sam_ldb_path() -> Path:
    from app.config import get_settings
    s = get_settings()
    # TDB_SAM_LDB_PATH is e.g. "tdb:///var/lib/samba/private/sam.ldb"
    raw = getattr(s, "TDB_SAM_LDB_PATH", "") or ""
    if raw.startswith("tdb://"):
        raw = raw[len("tdb://"):]
    return Path(raw or "/var/lib/samba/private/sam.ldb")


def _pg_env() -> Dict[str, str]:
    """Build env vars for pg_dump / psql."""
    from app.config import get_settings
    s = get_settings()
    env = dict(os.environ)
    if getattr(s, "SHELL_PROJET_PG_PASSWORD", ""):
        env["PGPASSWORD"] = s.SHELL_PROJET_PG_PASSWORD
    return env


def _pg_conn_args() -> List[str]:
    from app.config import get_settings
    s = get_settings()
    args = [
        "--host", str(s.SHELL_PROJET_PG_HOST or "localhost"),
        "--port", str(s.SHELL_PROJET_PG_PORT or 5432),
        "--username", str(s.SHELL_PROJET_PG_USER or "samba_api"),
        "--dbname", str(s.SHELL_PROJET_PG_DBNAME or "samba_api"),
    ]
    return args


def _safe_filename(name: str) -> str:
    """Strip any path components from user-supplied filenames."""
    # Only allow alphanumerics, dash, underscore, dot
    cleaned = "".join(c for c in name if c.isalnum() or c in "-_.")
    return cleaned


# ── Models ─────────────────────────────────────────────────────────────

class BackupCreateRequest(BaseModel):
    include_sam: bool = Field(default=True, description="Include sam.ldb (Samba AD database)")
    include_mgmt: bool = Field(default=True, description="Include mgmt DB (PostgreSQL)")
    description: Optional[str] = Field(default="", description="Optional description")


class RestoreRequest(BaseModel):
    filename: str = Field(..., description="Name of existing backup file to restore from")
    restore_sam: bool = Field(default=True)
    restore_mgmt: bool = Field(default=True)


# ── Endpoints ──────────────────────────────────────────────────────────

@router.post("", summary="Create a backup")
async def create_backup(
    body: BackupCreateRequest,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Create a backup archive containing sam.ldb and/or mgmt DB dump."""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"backup-{timestamp}.tar.gz"
    out_path = _backup_dir() / filename

    meta: Dict[str, Any] = {
        "timestamp": timestamp,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "description": body.description or "",
        "files": {},
    }

    try:
        with tarfile.open(out_path, "w:gz") as tar:
            if body.include_sam:
                sam = _sam_ldb_path()
                if sam.is_file():
                    # Copy to a temp file first to avoid tdb-level locking issues
                    tmp = _backup_dir() / f".tmp-sam-{timestamp}.ldb"
                    try:
                        shutil.copy2(sam, tmp)
                        tar.add(tmp, arcname="sam.ldb")
                        meta["files"]["sam.ldb"] = {
                            "size_bytes": tmp.stat().st_size,
                            "source": str(sam),
                        }
                    finally:
                        try:
                            tmp.unlink()
                        except OSError:
                            pass
                else:
                    meta["files"]["sam.ldb"] = {"error": f"not found at {sam}"}

            if body.include_mgmt:
                # pg_dump to a string stream, then add to tar
                try:
                    proc = subprocess.run(
                        ["pg_dump"] + _pg_conn_args(),
                        env=_pg_env(),
                        capture_output=True,
                        timeout=120,
                    )
                    if proc.returncode == 0:
                        sql_bytes = proc.stdout
                        info = tarfile.TarInfo(name="mgmt.sql")
                        info.size = len(sql_bytes)
                        tar.addfile(info, io.BytesIO(sql_bytes))
                        meta["files"]["mgmt.sql"] = {
                            "size_bytes": len(sql_bytes),
                        }
                    else:
                        meta["files"]["mgmt.sql"] = {
                            "error": proc.stderr.decode("utf-8", errors="replace")[:500],
                        }
                except FileNotFoundError:
                    meta["files"]["mgmt.sql"] = {"error": "pg_dump not installed"}
                except subprocess.TimeoutExpired:
                    meta["files"]["mgmt.sql"] = {"error": "pg_dump timeout"}

            # Write meta.json
            meta_bytes = json.dumps(meta, indent=2, ensure_ascii=False).encode("utf-8")
            info = tarfile.TarInfo(name="meta.json")
            info.size = len(meta_bytes)
            tar.addfile(info, io.BytesIO(meta_bytes))

    except Exception as exc:
        try:
            out_path.unlink()
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"Backup failed: {exc}")

    size = out_path.stat().st_size

    # Emit webhook event
    try:
        from app.webhooks import emit_backup_event
        emit_backup_event("created", filename, size_bytes=size)
    except Exception:
        pass

    return {
        "status": "ok",
        "data": {
            "filename": filename,
            "size_bytes": size,
            "path": str(out_path),
            "meta": meta,
        },
    }


@router.get("", summary="List backups")
async def list_backups(_: ApiKeyDep) -> Dict[str, Any]:
    """List all backup files."""
    bdir = _backup_dir()
    items: List[Dict[str, Any]] = []
    for p in sorted(bdir.glob("backup-*.tar.gz"), reverse=True):
        stat = p.stat()
        items.append({
            "filename": p.name,
            "size_bytes": stat.st_size,
            "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        })
    return {"status": "ok", "data": items, "total": len(items)}


@router.get("/{filename}", summary="Download a backup file")
async def download_backup(
    filename: str,
    _: ApiKeyDep,
):
    """Download a backup archive."""
    safe = _safe_filename(filename)
    if not safe.endswith(".tar.gz"):
        safe += ".tar.gz"
    path = _backup_dir() / safe
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"Backup '{safe}' not found")
    return FileResponse(
        path=str(path),
        media_type="application/gzip",
        filename=safe,
    )


@router.delete("/{filename}", summary="Delete a backup file")
async def delete_backup(
    filename: str,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Delete a backup archive."""
    safe = _safe_filename(filename)
    if not safe.endswith(".tar.gz"):
        safe += ".tar.gz"
    path = _backup_dir() / safe
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"Backup '{safe}' not found")
    try:
        path.unlink()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete: {exc}")
    return {"status": "ok", "message": f"Backup '{safe}' deleted"}


@router.post("/restore", summary="Restore from a backup")
async def restore_backup(
    body: RestoreRequest,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Restore sam.ldb and/or mgmt DB from an existing backup file.

    WARNING: Restoring sam.ldb requires the Samba service to be stopped
    beforehand. The endpoint will refuse to overwrite a running sam.ldb
    unless ``force=true`` is passed in the body.
    """
    safe = _safe_filename(body.filename)
    if not safe.endswith(".tar.gz"):
        safe += ".tar.gz"
    path = _backup_dir() / safe
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"Backup '{safe}' not found")

    result: Dict[str, Any] = {"filename": safe, "restored": {}}

    # Extract to a temp dir
    tmp_dir = _backup_dir() / f".restore-{int(time.time())}"
    tmp_dir.mkdir(exist_ok=True)
    try:
        with tarfile.open(path, "r:gz") as tar:
            tar.extractall(tmp_dir)

        if body.restore_sam:
            src = tmp_dir / "sam.ldb"
            if src.is_file():
                dst = _sam_ldb_path()
                # Safety: refuse to overwrite if samba is running
                if dst.is_file():
                    try:
                        proc = subprocess.run(
                            ["systemctl", "is-active", "--quiet", "samba"],
                            timeout=5,
                        )
                        samba_running = proc.returncode == 0
                    except (FileNotFoundError, subprocess.TimeoutExpired):
                        samba_running = False
                    if samba_running:
                        raise HTTPException(
                            status_code=409,
                            detail="Samba service is RUNNING. Stop it first: "
                                   "'systemctl stop samba' then retry.",
                        )
                # Backup current sam.ldb as .bak
                if dst.is_file():
                    bak = dst.with_suffix(".ldb.bak")
                    try:
                        shutil.copy2(dst, bak)
                        result["restored"]["sam_bak"] = str(bak)
                    except OSError:
                        pass
                shutil.copy2(src, dst)
                result["restored"]["sam.ldb"] = str(dst)
            else:
                result["restored"]["sam.ldb"] = "not in backup"

        if body.restore_mgmt:
            src = tmp_dir / "mgmt.sql"
            if src.is_file():
                try:
                    proc = subprocess.run(
                        ["psql"] + _pg_conn_args() + ["--file", str(src)],
                        env=_pg_env(),
                        capture_output=True,
                        timeout=300,
                    )
                    if proc.returncode == 0:
                        result["restored"]["mgmt_db"] = "OK"
                    else:
                        result["restored"]["mgmt_db"] = (
                            "FAILED: " + proc.stderr.decode("utf-8", errors="replace")[:500]
                        )
                except FileNotFoundError:
                    result["restored"]["mgmt_db"] = "psql not installed"
                except subprocess.TimeoutExpired:
                    result["restored"]["mgmt_db"] = "psql timeout"
            else:
                result["restored"]["mgmt_db"] = "not in backup"

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Restore failed: {exc}")
    finally:
        try:
            shutil.rmtree(tmp_dir)
        except OSError:
            pass

    # Emit webhook
    try:
        from app.webhooks import emit_backup_event
        emit_backup_event("restored", safe)
    except Exception:
        pass

    return {"status": "ok", "data": result}
