"""
Bulk operations router for AD users (Samba-side, not mgmt users).

POST /api/v1/users/bulk           — perform a bulk action on N AD users
                                    (create / delete / enable / disable /
                                     unlock / set_password / move)

v2.3: This complements the existing CSV /import endpoint (which is
async/background-task based) with a synchronous JSON-body bulk API
that the web UI can call directly. Returns per-row results so the
caller can show partial-success state.

Limit: 100 users per call (configurable via ``SAMBA_BULK_MAX_ROWS``).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import ApiKeyDep
from app.models.common import ErrorResponse

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/users",
    tags=["Users — Bulk"],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    },
)

BULK_MAX_ROWS = 100


# ── Pydantic models ────────────────────────────────────────────────────

class BulkUserCreateItem(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1)
    full_name: Optional[str] = ""
    email: Optional[str] = ""
    department: Optional[str] = ""


class BulkUserActionRequest(BaseModel):
    action: str = Field(..., description="create | delete | enable | disable | unlock | set_password | move")
    usernames: Optional[List[str]] = Field(default=None, description="Target usernames for non-create actions")
    users: Optional[List[BulkUserCreateItem]] = Field(default=None, description="For action=create")
    password: Optional[str] = Field(default=None, description="For action=set_password")
    target_ou: Optional[str] = Field(default=None, description="For action=move")


# ── Helpers ────────────────────────────────────────────────────────────

def _result_row(username: str, ok: bool, error: str = "") -> Dict[str, Any]:
    return {"username": username, "ok": ok, "error": error}


# ── Endpoint ───────────────────────────────────────────────────────────

@router.post("/bulk", summary="Bulk operation on AD users")
async def bulk_user_action(
    body: BulkUserActionRequest,
    api_key: ApiKeyDep,
) -> Dict[str, Any]:
    """Perform a bulk action on multiple AD users.

    Actions:
      * ``create``       — create N users (body.users)
      * ``delete``       — delete N users (body.usernames)
      * ``enable``       — enable N users
      * ``disable``      — disable N users
      * ``unlock``       — unlock N users
      * ``set_password`` — set the same password on N users (body.password)
      * ``move``         — move N users to body.target_ou

    Returns a per-user result list so the caller can show partial-success.

    Limit: 100 users per call.
    """
    # Determine target list
    if body.action == "create":
        targets = body.users or []
        target_names = [u.username for u in targets]
    else:
        target_names = body.usernames or []
        targets = []

    if not target_names:
        raise HTTPException(status_code=400, detail="No usernames provided")
    if len(target_names) > BULK_MAX_ROWS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many rows ({len(target_names)} > {BULK_MAX_ROWS}). "
                   f"Split into smaller batches or use the /import CSV endpoint.",
        )

    results: List[Dict[str, Any]] = []
    ok_count = 0

    # Lazy import the per-user functions to avoid circular imports
    from app.routers.user import (
        create_user as _create_user,
        delete_user as _delete_user,
    )

    # We re-use the existing per-user endpoints' internal logic by calling
    # them directly via FastAPI's route handlers is messy; instead we shell
    # out to samba-tool which is what those handlers do under the hood.
    from app.config import get_settings
    from app.executor import run_command

    settings = get_settings()
    tool = settings.SAMBA_TOOL_PATH or "samba-tool"

    def _run_samba_tool(args: List[str]) -> tuple[int, str, str]:
        try:
            rc, out, err = run_command([tool] + args, timeout=60)
            return rc, out, err
        except Exception as exc:
            return -1, "", str(exc)

    for username in target_names:
        try:
            if body.action == "create":
                # find matching user spec
                spec = next((u for u in targets if u.username == username), None)
                if spec is None:
                    results.append(_result_row(username, False, "spec missing"))
                    continue
                args = [
                    "user", "create", username, spec.password,
                    "--full-name=" + (spec.full_name or ""),
                    "--mail-address=" + (spec.email or ""),
                ]
                rc, out, err = _run_samba_tool(args)
                if rc == 0:
                    results.append(_result_row(username, True))
                    ok_count += 1
                else:
                    results.append(_result_row(username, False, (err or out)[:200]))

            elif body.action == "delete":
                rc, out, err = _run_samba_tool(["user", "delete", username])
                if rc == 0:
                    results.append(_result_row(username, True))
                    ok_count += 1
                else:
                    results.append(_result_row(username, False, (err or out)[:200]))

            elif body.action == "enable":
                rc, out, err = _run_samba_tool(
                    ["user", "enable", username]
                )
                if rc == 0:
                    results.append(_result_row(username, True))
                    ok_count += 1
                else:
                    results.append(_result_row(username, False, (err or out)[:200]))

            elif body.action == "disable":
                rc, out, err = _run_samba_tool(
                    ["user", "disable", username]
                )
                if rc == 0:
                    results.append(_result_row(username, True))
                    ok_count += 1
                else:
                    results.append(_result_row(username, False, (err or out)[:200]))

            elif body.action == "unlock":
                rc, out, err = _run_samba_tool(
                    ["user", "unlock", username]
                )
                if rc == 0:
                    results.append(_result_row(username, True))
                    ok_count += 1
                else:
                    results.append(_result_row(username, False, (err or out)[:200]))

            elif body.action == "set_password":
                if not body.password:
                    results.append(_result_row(username, False, "password not provided"))
                    continue
                rc, out, err = _run_samba_tool(
                    ["user", "setpassword", username, "--newpassword=" + body.password]
                )
                if rc == 0:
                    results.append(_result_row(username, True))
                    ok_count += 1
                else:
                    results.append(_result_row(username, False, (err or out)[:200]))

            elif body.action == "move":
                if not body.target_ou:
                    results.append(_result_row(username, False, "target_ou not provided"))
                    continue
                rc, out, err = _run_samba_tool(
                    ["user", "move", username, body.target_ou]
                )
                if rc == 0:
                    results.append(_result_row(username, True))
                    ok_count += 1
                else:
                    results.append(_result_row(username, False, (err or out)[:200]))

            else:
                results.append(_result_row(username, False, f"unknown action: {body.action}"))

        except Exception as exc:
            results.append(_result_row(username, False, str(exc)[:200]))

    return {
        "status": "ok",
        "data": {
            "action": body.action,
            "total": len(target_names),
            "ok": ok_count,
            "failed": len(target_names) - ok_count,
            "results": results,
        },
    }
