"""
File manager router for shell-projects.

GET    /api/v1/shell/projet/{projet_id}/files                  — list files
GET    /api/v1/shell/projet/{projet_id}/files/{path:path}      — download a file
PUT    /api/v1/shell/projet/{projet_id}/files/{path:path}      — upload/overwrite a file
DELETE /api/v1/shell/projet/{projet_id}/files/{path:path}      — delete a file
POST   /api/v1/shell/projet/{projet_id}/mkdir/{path:path}      — create a directory

v2.3: Lets the web UI manage files inside a project's workspace without
having to download/re-upload the whole archive. All paths are sandboxed
to the project's workspace directory — symlinks pointing outside are
rejected.
"""
from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app.auth import ApiKeyDep
from app.models.common import ErrorResponse

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/shell/projet",
    tags=["Shell Projects — Files"],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    },
)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


# ── Helpers ────────────────────────────────────────────────────────────

def _resolve_workspace(projet_id: str) -> Path:
    """Resolve and verify a project's workspace directory."""
    from app.config import get_settings
    s = get_settings()
    base = Path(s.SHELL_PROJET_BASE_DIR or "/var/lib/webadc/shell-projets")
    ws = base / projet_id
    if not ws.is_dir():
        raise HTTPException(status_code=404, detail=f"Project workspace not found: {projet_id}")
    return ws


def _safe_resolve(ws: Path, relative: str) -> Path:
    """Resolve a path inside the workspace, refusing escapes via .. or symlinks."""
    if not relative or relative in (".", "./"):
        return ws
    # Strip leading slash
    rel = relative.lstrip("/")
    candidate = (ws / rel).resolve()
    # Ensure the resolved path is still inside ws
    try:
        candidate.relative_to(ws.resolve())
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Path escapes workspace: {relative}",
        )
    # Reject symlinks pointing outside ws
    if candidate.is_symlink():
        target = candidate.resolve()
        try:
            target.relative_to(ws.resolve())
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Symlink escapes workspace: {relative} -> {target}",
            )
    return candidate


def _relative_path(ws: Path, abs_path: Path) -> str:
    try:
        return str(abs_path.relative_to(ws))
    except ValueError:
        return str(abs_path)


# ── Endpoints ──────────────────────────────────────────────────────────

@router.get("/{projet_id}/files", summary="List files in project workspace")
async def list_files(
    projet_id: str,
    _: ApiKeyDep,
    sub: str = "",
) -> Dict[str, Any]:
    """List files and subdirectories inside the project workspace (or a sub-path)."""
    ws = _resolve_workspace(projet_id)
    target = _safe_resolve(ws, sub)
    if not target.is_dir():
        raise HTTPException(status_code=404, detail=f"Not a directory: {sub or '/'}")

    items: List[Dict[str, Any]] = []
    for entry in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        try:
            stat = entry.stat()
            items.append({
                "name": entry.name,
                "path": _relative_path(ws, entry),
                "is_dir": entry.is_dir(),
                "size_bytes": stat.st_size if entry.is_file() else 0,
                "modified_at": stat.st_mtime,
            })
        except OSError:
            continue

    return {
        "status": "ok",
        "data": {
            "projet_id": projet_id,
            "path": sub or "/",
            "items": items,
        },
    }


@router.get("/{projet_id}/files/{file_path:path}", summary="Download a file")
async def download_file(
    projet_id: str,
    file_path: str,
    _: ApiKeyDep,
):
    """Download a single file from the project workspace."""
    ws = _resolve_workspace(projet_id)
    target = _safe_resolve(ws, file_path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    return FileResponse(
        path=str(target),
        filename=target.name,
        media_type="application/octet-stream",
    )


@router.put("/{projet_id}/files/{file_path:path}", summary="Upload/overwrite a file")
async def upload_file(
    projet_id: str,
    file_path: str,
    _: ApiKeyDep,
    file: UploadFile = File(...),
) -> Dict[str, Any]:
    """Upload or overwrite a file at the given path inside the workspace."""
    ws = _resolve_workspace(projet_id)
    target = _safe_resolve(ws, file_path)
    if target.is_dir():
        raise HTTPException(status_code=400, detail=f"Target is a directory: {file_path}")
    target.parent.mkdir(parents=True, exist_ok=True)

    # Stream the upload to disk with a size limit
    written = 0
    try:
        with target.open("wb") as out:
            while True:
                chunk = await file.read(64 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_FILE_SIZE:
                    out.close()
                    target.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large (max {MAX_FILE_SIZE} bytes)",
                    )
                out.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")

    return {
        "status": "ok",
        "data": {
            "projet_id": projet_id,
            "path": file_path,
            "size_bytes": written,
        },
    }


@router.delete("/{projet_id}/files/{file_path:path}", summary="Delete a file or directory")
async def delete_file(
    projet_id: str,
    file_path: str,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Delete a file or directory (recursively) from the workspace."""
    ws = _resolve_workspace(projet_id)
    target = _safe_resolve(ws, file_path)
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"Not found: {file_path}")

    # Refuse to delete the workspace root
    if target.resolve() == ws.resolve():
        raise HTTPException(status_code=400, detail="Refusing to delete workspace root")

    try:
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Delete failed: {exc}")

    return {"status": "ok", "message": f"Deleted: {file_path}"}


@router.post("/{projet_id}/mkdir/{dir_path:path}", summary="Create a directory")
async def make_directory(
    projet_id: str,
    dir_path: str,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Create a directory (and any missing parents) inside the workspace."""
    ws = _resolve_workspace(projet_id)
    target = _safe_resolve(ws, dir_path)
    if target.exists():
        if target.is_dir():
            return {"status": "ok", "message": f"Already exists: {dir_path}"}
        raise HTTPException(status_code=400, detail=f"Path is a file: {dir_path}")
    try:
        target.mkdir(parents=True)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"mkdir failed: {exc}")
    return {"status": "ok", "message": f"Created: {dir_path}"}
