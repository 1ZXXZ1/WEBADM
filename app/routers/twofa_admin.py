"""
2FA admin router — manage TOTP for OTHER users (admin only).

These endpoints let an administrator enable/disable/reset 2FA on any
user account, identified by user_id. They are mounted under
``/api/v1/mgmt/users/{user_id}/2fa/*`` so they sit naturally next to
the other mgmt user endpoints.

Authentication:
    * X-API-Key header (admin API key from mgmt DB), OR
    * Authorization: Bearer <jwt> (admin JWT)
    The combined_auth_middleware in main.py sets request.state.role
    which we check explicitly here — only "admin" role is allowed.

Endpoints:
    GET    /api/v1/mgmt/users/{user_id}/2fa/status
        — is 2FA enabled for this user?

    POST   /api/v1/mgmt/users/{user_id}/2fa/setup
        — generate a new TOTP secret + otpauth:// URI (NOT stored yet).
          Returns the secret so the admin can hand it to the user
          through a secure channel.

    POST   /api/v1/mgmt/users/{user_id}/2fa/enable
        — verify a TOTP code against a secret and persist+enable 2FA.
          Body: {"secret": "...", "code": "123456"}
          With ?force=true: persist the secret WITHOUT code verification
          (use only when the user cannot provide a code right now — they
          will need to set up their authenticator app with the secret
          before they can log in).

    POST   /api/v1/mgmt/users/{user_id}/2fa/disable
        — disable 2FA for this user (admin override — no password
          re-auth required). The encrypted secret is kept in DB so it
          can be re-enabled later via /enable with the same secret.

    POST   /api/v1/mgmt/users/{user_id}/2fa/reset
        — completely remove the TOTP secret (hard reset). User will
          need to run /setup again to re-enable 2FA.

    GET    /api/v1/mgmt/2fa/enabled
        — list all users with 2FA currently enabled.

    GET    /api/v1/mgmt/2fa/disabled
        — list all users with 2FA disabled (but who have a stored
          secret that could be re-enabled).

Use cases:
    * Admin sets up 2FA for a user who can't do it themselves
    * Admin resets 2FA when a user loses their phone
    * Admin audits who has 2FA enabled
    * Admin temporarily disables 2FA for troubleshooting
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.auth import ApiKeyDep
from app.models.common import ErrorResponse

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/mgmt",
    tags=["Auth — 2FA Admin"],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    },
)


# ── Pydantic models ────────────────────────────────────────────────────

class Admin2FAEnableRequest(BaseModel):
    secret: str = Field(..., description="TOTP secret (Base32) from /setup")
    code: Optional[str] = Field(
        default=None,
        description="6-digit TOTP code from the user's authenticator app. "
                    "Required unless ?force=true is passed.",
        min_length=6, max_length=6,
    )


class Admin2FASetupResponse(BaseModel):
    user_id: int
    username: str
    secret: str
    otpauth_uri: str
    stored: bool = Field(default=False,
                          description="False — secret is NOT yet stored. Call /enable to persist.")


class Admin2FAStatusResponse(BaseModel):
    user_id: int
    username: str
    enabled: bool
    has_secret: bool = Field(description="Whether a TOTP secret is stored (may be disabled)")


# ── Admin guard ────────────────────────────────────────────────────────

def _require_admin(request: Request) -> Dict[str, Any]:
    """Ensure the caller is an admin. Returns caller info dict.

    Raises 401 if not authenticated, 403 if not admin role.
    Works with both JWT Bearer and X-API-Key auth (set by
    combined_auth_middleware in main.py).
    """
    auth_method = getattr(request.state, "auth_method", None)
    if not auth_method:
        raise HTTPException(status_code=401, detail="Not authenticated")

    role = getattr(request.state, "role", "")
    if role != "admin":
        raise HTTPException(
            status_code=403,
            detail=f"Admin role required (your role: '{role}')",
        )

    caller = {
        "auth_method": auth_method,
        "role": role,
    }
    if auth_method == "jwt":
        payload = getattr(request.state, "user", {}) or {}
        caller["username"] = payload.get("sub") or payload.get("username") or ""
    elif auth_method in ("api_key", "static_api_key"):
        key_info = getattr(request.state, "api_key_info", {}) or {}
        caller["username"] = key_info.get("username", "")
        caller["key_id"] = key_info.get("key_id")
    return caller


def _resolve_user(user_id: int) -> Dict[str, Any]:
    """Fetch user by ID. Raises 404 if not found."""
    from app.api_ma import get_user
    user = get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail=f"User #{user_id} not found")
    return user


# ── Endpoints ──────────────────────────────────────────────────────────

@router.get(
    "/users/{user_id}/2fa/status",
    summary="[admin] Check 2FA status for any user",
    response_model=Admin2FAStatusResponse,
)
async def admin_2fa_status(
    user_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Return whether 2FA is enabled for the given user.

    Also reports ``has_secret`` — whether a TOTP secret is stored
    (it may be present but disabled, e.g. after /disable).
    """
    _require_admin(request)
    user = _resolve_user(user_id)

    from app.totp import is_enabled_for_user, get_secret_for_user
    enabled = is_enabled_for_user(user_id)
    has_secret = get_secret_for_user(user_id) is not None
    return {
        "user_id": user_id,
        "username": user.get("username", ""),
        "enabled": enabled,
        "has_secret": has_secret,
    }


@router.post(
    "/users/{user_id}/2fa/setup",
    summary="[admin] Generate a new TOTP secret for any user",
    response_model=Admin2FASetupResponse,
)
async def admin_2fa_setup(
    user_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Generate a new TOTP secret + otpauth:// URI for the given user.

    The secret is **NOT** stored — call ``/enable`` with a 6-digit code
    (or ``?force=true``) to persist it.

    The admin should hand the secret to the user through a secure
    out-of-band channel (e.g. encrypted email, password manager share).
    """
    _require_admin(request)
    user = _resolve_user(user_id)

    from app.totp import generate_secret, build_otpauth_uri
    secret = generate_secret()
    uri = build_otpauth_uri(
        secret,
        username=user.get("username", str(user_id)),
        issuer="SambaAD",
    )
    return {
        "user_id": user_id,
        "username": user.get("username", ""),
        "secret": secret,
        "otpauth_uri": uri,
        "stored": False,
    }


@router.post(
    "/users/{user_id}/2fa/enable",
    summary="[admin] Enable 2FA for any user (with code or force)",
)
async def admin_2fa_enable(
    user_id: int,
    body: Admin2FAEnableRequest,
    request: Request,
    _: ApiKeyDep,
    force: bool = Query(
        default=False,
        description="If true, persist the secret WITHOUT code verification. "
                    "Use only when the user cannot provide a code right now.",
    ),
) -> Dict[str, Any]:
    """Verify a TOTP code and persist+enable 2FA for the given user.

    With ``?force=true`` the secret is stored without code verification
    — the user will be locked out of login until they set up their
    authenticator app with the same secret. Use only for recovery.
    """
    _require_admin(request)
    user = _resolve_user(user_id)

    from app.totp import verify_code, enable_for_user

    if not force:
        if not body.code:
            raise HTTPException(
                status_code=400,
                detail="TOTP code is required (or pass ?force=true to skip verification)",
            )
        if not verify_code(body.secret, body.code):
            raise HTTPException(
                status_code=400,
                detail="Invalid TOTP code — try again, or pass ?force=true to skip verification",
            )

    try:
        enable_for_user(user_id, body.secret)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to enable 2FA: {exc}")

    return {
        "status": "ok",
        "message": f"2FA enabled for user #{user_id} ({user.get('username', '')})",
        "user_id": user_id,
        "username": user.get("username", ""),
        "force": force,
    }


@router.post(
    "/users/{user_id}/2fa/disable",
    summary="[admin] Disable 2FA for any user (admin override, no password)",
)
async def admin_2fa_disable(
    user_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Disable 2FA for the given user.

    Admin override — no password re-auth required (unlike the self-service
    /api/v1/auth/2fa/disable endpoint). The encrypted TOTP secret is
    KEPT in DB so 2FA can be re-enabled later via /enable with the same
    secret. Use /reset to wipe the secret completely.
    """
    _require_admin(request)
    user = _resolve_user(user_id)

    from app.totp import disable_for_user, is_enabled_for_user
    if not is_enabled_for_user(user_id):
        return {
            "status": "ok",
            "message": f"2FA was already disabled for user #{user_id}",
            "user_id": user_id,
            "username": user.get("username", ""),
        }

    try:
        disable_for_user(user_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to disable 2FA: {exc}")

    return {
        "status": "ok",
        "message": f"2FA disabled for user #{user_id} ({user.get('username', '')}). "
                   "Secret kept — use /reset to wipe it.",
        "user_id": user_id,
        "username": user.get("username", ""),
    }


@router.post(
    "/users/{user_id}/2fa/reset",
    summary="[admin] Reset 2FA for any user (wipe stored secret)",
)
async def admin_2fa_reset(
    user_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Hard reset: disable 2FA AND wipe the stored TOTP secret.

    Use this when a user loses their phone and needs to set up 2FA
    from scratch. After reset, the user (or admin) must call /setup
    again to generate a new secret.
    """
    _require_admin(request)
    user = _resolve_user(user_id)

    from app.totp import disable_for_user
    try:
        # disable_for_user sets totp_secret=NULL AND totp_enabled=FALSE
        disable_for_user(user_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to reset 2FA: {exc}")

    # Double-check that secret is gone
    from app.totp import get_secret_for_user
    remaining = get_secret_for_user(user_id)
    if remaining:
        logger.error("[2fa-admin] reset failed for user %s — secret still present", user_id)
        raise HTTPException(status_code=500, detail="Reset incomplete — secret still in DB")

    return {
        "status": "ok",
        "message": f"2FA fully reset for user #{user_id} ({user.get('username', '')}). "
                   "User must run /setup again to re-enable.",
        "user_id": user_id,
        "username": user.get("username", ""),
    }


# ── Bulk listing endpoints ─────────────────────────────────────────────

@router.get(
    "/2fa/enabled",
    summary="[admin] List all users with 2FA enabled",
)
async def admin_2fa_list_enabled(
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """List all users who currently have 2FA enabled."""
    _require_admin(request)

    from app.api_ma import list_users
    users = list_users(is_active=None)
    enabled = []
    for u in users:
        try:
            from app.totp import is_enabled_for_user
            if is_enabled_for_user(u["id"]):
                enabled.append({
                    "id": u["id"],
                    "username": u.get("username", ""),
                    "role": u.get("role", ""),
                    "is_active": u.get("is_active", 1),
                })
        except Exception:
            continue
    return {"status": "ok", "total": len(enabled), "data": enabled}


@router.get(
    "/2fa/disabled",
    summary="[admin] List all users with a stored secret but 2FA disabled",
)
async def admin_2fa_list_disabled(
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """List users who have a TOTP secret in DB but 2FA is currently OFF.

    These users can be re-enabled via /enable without re-running /setup
    (the admin would need to know the original secret, or the user
    would need to provide a code from their still-configured app).
    """
    _require_admin(request)

    from app.api_ma import list_users
    users = list_users(is_active=None)
    disabled_with_secret = []
    for u in users:
        try:
            from app.totp import is_enabled_for_user, get_secret_for_user
            if not is_enabled_for_user(u["id"]) and get_secret_for_user(u["id"]):
                disabled_with_secret.append({
                    "id": u["id"],
                    "username": u.get("username", ""),
                    "role": u.get("role", ""),
                    "is_active": u.get("is_active", 1),
                })
        except Exception:
            continue
    return {"status": "ok", "total": len(disabled_with_secret), "data": disabled_with_secret}
