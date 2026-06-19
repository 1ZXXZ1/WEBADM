"""
2FA / TOTP router — enable, disable, verify, and login flow integration.

POST   /api/v1/auth/2fa/setup       — generate a new TOTP secret for the current user
POST   /api/v1/auth/2fa/enable      — verify a code and enable 2FA
POST   /api/v1/auth/2fa/disable     — disable 2FA (requires current password)
GET    /api/v1/auth/2fa/status      — check whether 2FA is enabled for the current user
POST   /api/v1/auth/login/verify    — second step of login: verify TOTP code
                                       (called after /auth/login returns totp_required: true)

v2.3.1 fix: The previous version had several bugs:
  1. ``request_state: Any = None`` was never injected by FastAPI — endpoints
     always got ``None`` and returned 401.
  2. ``create_access_token`` was called with kwargs, but it accepts a dict.
  3. ``/verify`` was mounted at ``/api/v1/auth/2fa/verify`` (due to the
     router prefix), but the public path / docs / login flow expected
     ``/api/v1/auth/login/verify``.
  4. The login endpoint in main.py was not integrated with 2FA at all —
     it always returned full tokens even when 2FA was enabled.

This version:
  - Uses ``Request`` from FastAPI to read ``request.state.user`` (JWT)
    or ``request.state.api_key_info`` (API key) — both set by
    ``combined_auth_middleware`` in main.py.
  - Calls ``create_access_token(dict)`` / ``create_refresh_token(dict)``
    matching the real signature.
  - Mounts ``/verify`` at ``/api/v1/auth/login/verify`` (added to
    ``_PUBLIC_PATHS`` in main.py so it does not require auth).
  - The login endpoint in main.py is patched to check ``is_enabled_for_user``
    and return ``{totp_required: true, temp_token: ...}`` when 2FA is on.

The login flow becomes two-step:

  1. POST /api/v1/auth/login  {username, password}
     → if 2FA enabled: returns {totp_required: true, temp_token: "..."}
        (temp_token is a short-lived JWT valid only for /auth/login/verify)
     → else: returns full {access_token, refresh_token, ...}

  2. POST /api/v1/auth/login/verify  {temp_token, totp_code}
     → on success: returns full {access_token, refresh_token, ...}
     → on failure: 401
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.models.common import ErrorResponse

logger = logging.getLogger(__name__)

# Router for /api/v1/auth/2fa/* (these endpoints REQUIRE auth)
router = APIRouter(
    prefix="/api/v1/auth/2fa",
    tags=["Auth — 2FA / TOTP"],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    },
)

# Separate router for /api/v1/auth/login/verify (PUBLIC — no auth required,
# because the user only has a temp_token at this point)
public_router = APIRouter(
    prefix="/api/v1/auth",
    tags=["Auth — 2FA / TOTP"],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
    },
)

# Lifetime of the totp_pending temp token (5 minutes)
TEMP_TOKEN_TTL_MIN = 5


# ── Pydantic models ────────────────────────────────────────────────────

class TwoFAEnableRequest(BaseModel):
    secret: str = Field(..., description="TOTP secret returned by /2fa/setup")
    code: str = Field(..., min_length=6, max_length=6, description="Current 6-digit TOTP code")


class TwoFADisableRequest(BaseModel):
    password: str = Field(..., description="Current password (re-auth required)")


class TwoFAVerifyRequest(BaseModel):
    temp_token: str = Field(..., description="Short-lived token from /auth/login when 2FA required")
    totp_code: str = Field(..., min_length=6, max_length=6)


# ── Helpers ────────────────────────────────────────────────────────────

def _current_user(request: Request) -> Dict[str, Any]:
    """Extract authenticated user info from request state.

    Returns a dict with at least ``user_id`` (int) and ``username`` (str).
    Raises 401 if not authenticated.

    Supports both JWT (``request.state.user`` — payload with ``sub``=username)
    and API key (``request.state.api_key_info`` — dict with ``user_id``).
    """
    auth_method = getattr(request.state, "auth_method", None)

    if auth_method == "jwt":
        payload = getattr(request.state, "user", {}) or {}
        username = payload.get("sub") or payload.get("username") or ""
        if not username:
            raise HTTPException(status_code=401, detail="JWT has no 'sub' claim")
        # Resolve user_id from DB
        try:
            from app.api_ma import get_user_by_username
            user_record = get_user_by_username(username)
            if not user_record:
                raise HTTPException(status_code=401, detail=f"User '{username}' not found in DB")
            return {
                "user_id": user_record["id"],
                "username": username,
                "role": payload.get("role", user_record.get("role", "operator")),
            }
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to resolve user: {exc}")

    elif auth_method in ("api_key", "static_api_key"):
        key_info = getattr(request.state, "api_key_info", {}) or {}
        user_id = key_info.get("user_id")
        username = key_info.get("username", "")
        if not user_id:
            # Static API key — no associated user. Use admin/id=1 fallback.
            # 2FA setup doesn't really make sense for static-key callers,
            # but we don't want to crash. Return a clear error instead.
            raise HTTPException(
                status_code=400,
                detail="2FA management requires a JWT or a DB-backed API key. "
                       "Static API key has no associated user account.",
            )
        return {
            "user_id": int(user_id),
            "username": username,
            "role": getattr(request.state, "role", "operator"),
        }

    # No auth method set — middleware should have blocked this already,
    # but guard anyway.
    raise HTTPException(status_code=401, detail="Not authenticated")


def _issue_temp_token(user_id: int, username: str) -> str:
    """Issue a short-lived temp token for the 2FA verify step."""
    from jose import jwt as _jwt
    from app.config import get_settings
    from app.auth_jwt import _get_jwt_secret
    s = get_settings()
    algorithm = getattr(s, "JWT_ALGORITHM", "HS256")
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "user_id": user_id,
        "username": username,
        "totp_pending": True,
        "iat": now,
        "exp": now + timedelta(minutes=TEMP_TOKEN_TTL_MIN),
        "type": "totp_pending",
    }
    return _jwt.encode(payload, _get_jwt_secret(s), algorithm=algorithm)


def _verify_temp_token(token: str) -> Dict[str, Any]:
    """Verify a temp token; return its payload or raise 401."""
    from jose import jwt as _jwt, JWTError
    from app.config import get_settings
    from app.auth_jwt import _get_jwt_secret
    s = get_settings()
    algorithm = getattr(s, "JWT_ALGORITHM", "HS256")
    try:
        payload = _jwt.decode(token, _get_jwt_secret(s), algorithms=[algorithm])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid temp_token: {exc}")
    if not payload.get("totp_pending"):
        raise HTTPException(status_code=401, detail="Not a 2FA temp token")
    return payload


def _issue_full_tokens(user_id: int, username: str, role: str,
                       permissions: list) -> Dict[str, Any]:
    """Issue a full access+refresh token pair (delegates to auth_jwt)."""
    from app.auth_jwt import create_access_token, create_refresh_token
    from app.config import get_settings
    s = get_settings()
    access_ttl = getattr(s, "JWT_ACCESS_TOKEN_EXPIRE_MINUTES", 30)

    # create_access_token accepts a DICT (not kwargs) — matches auth_jwt.py
    token_data = {
        "sub": username,
        "username": username,
        "role": role,
        "permissions": permissions,
    }
    access = create_access_token(token_data)
    refresh = create_refresh_token(token_data)
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in": access_ttl * 60,
        "role": role,
        "permissions": permissions,
        "username": username,
    }


# ── Endpoints (require auth) ───────────────────────────────────────────

@router.post("/setup", summary="Generate a new TOTP secret")
async def setup_2fa(request: Request) -> Dict[str, Any]:
    """Generate a new TOTP secret for the current user.

    The secret is NOT yet stored — call /enable with a 6-digit code
    from the user's authenticator app to confirm and persist it.

    Returns the secret (Base32) and an otpauth:// URI that can be
    rendered as a QR code by the frontend.
    """
    user = _current_user(request)

    from app.totp import generate_secret, build_otpauth_uri
    secret = generate_secret()
    uri = build_otpauth_uri(
        secret,
        username=user["username"],
        issuer="SambaAD",
    )
    return {
        "status": "ok",
        "data": {
            "secret": secret,
            "otpauth_uri": uri,
            "username": user["username"],
        },
        "next_step": (
            "Open Google Authenticator (or similar), add a new entry by "
            "scanning the QR for the otpauth_uri (or typing the secret "
            "manually), then POST /api/v1/auth/2fa/enable with the 6-digit "
            "code from the app."
        ),
    }


@router.post("/enable", summary="Enable 2FA with a verified TOTP code")
async def enable_2fa(
    body: TwoFAEnableRequest,
    request: Request,
) -> Dict[str, Any]:
    """Verify a TOTP code and persist the secret, enabling 2FA for the user."""
    user = _current_user(request)

    from app.totp import verify_code, enable_for_user
    if not verify_code(body.secret, body.code):
        raise HTTPException(status_code=400, detail="Invalid TOTP code — try again")

    try:
        enable_for_user(user["user_id"], body.secret)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to enable 2FA: {exc}")
    return {"status": "ok", "message": "2FA enabled", "username": user["username"]}


@router.post("/disable", summary="Disable 2FA (requires current password)")
async def disable_2fa(
    body: TwoFADisableRequest,
    request: Request,
) -> Dict[str, Any]:
    """Disable 2FA for the current user. Requires re-authentication."""
    user = _current_user(request)

    from app.api_ma import authenticate_user
    auth = authenticate_user(user["username"], body.password)
    if not auth:
        raise HTTPException(status_code=401, detail="Password incorrect")

    from app.totp import disable_for_user
    try:
        disable_for_user(user["user_id"])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to disable 2FA: {exc}")
    return {"status": "ok", "message": "2FA disabled", "username": user["username"]}


@router.get("/status", summary="Check 2FA status for the current user")
async def status_2fa(request: Request) -> Dict[str, Any]:
    """Return whether 2FA is enabled for the current user."""
    user = _current_user(request)
    from app.totp import is_enabled_for_user
    return {
        "status": "ok",
        "data": {
            "enabled": is_enabled_for_user(user["user_id"]),
            "username": user["username"],
        },
    }


# ── Login verify (second step) — PUBLIC endpoint ───────────────────────
#
# Mounted via public_router at /api/v1/auth/login/verify.
# This endpoint is added to _PUBLIC_PATHS in main.py so the auth middleware
# does not require a Bearer token or API key — the caller only has the
# short-lived temp_token from step 1.

@public_router.post("/login/verify", summary="Verify TOTP code (login step 2)",
                    responses={401: {"model": ErrorResponse}})
async def verify_login(body: TwoFAVerifyRequest) -> Dict[str, Any]:
    """Second step of 2FA login: verify the TOTP code and issue full tokens.

    Called after ``POST /api/v1/auth/login`` returns ``{totp_required: true,
    temp_token: "..."}``. Send the temp_token plus the 6-digit TOTP code
    from the user's authenticator app. On success, returns the standard
    ``{access_token, refresh_token, role, permissions, ...}`` payload.

    v2.3.2: Writes semantic audit events (auth.login_success / auth.login_failure)
    for traceability of 2FA verifications.
    """
    payload = _verify_temp_token(body.temp_token)
    # Prefer user_id claim; fall back to looking up by username
    user_id = payload.get("user_id")
    username = payload.get("username") or payload.get("sub") or ""

    if not user_id and username:
        try:
            from app.api_ma import get_user_by_username
            u = get_user_by_username(username)
            if u:
                user_id = u["id"]
        except Exception:
            pass

    if not user_id:
        # Audit: 2FA verify with invalid temp_token
        try:
            from app.api_ma import log_semantic
            log_semantic(
                "auth.login_failure",
                username=username or "(unknown)",
                action="POST /api/v1/auth/login/verify",
                details="Invalid temp_token payload",
            )
        except Exception:
            pass
        raise HTTPException(status_code=401, detail="Invalid temp_token payload: no user_id")

    from app.totp import verify_for_user
    if not verify_for_user(int(user_id), body.totp_code):
        # Audit: 2FA code invalid
        try:
            from app.api_ma import log_semantic
            log_semantic(
                "auth.login_failure",
                user_id=int(user_id),
                username=username,
                action="POST /api/v1/auth/login/verify",
                details=f"Invalid TOTP code for user #{user_id}",
            )
        except Exception:
            pass
        raise HTTPException(status_code=401, detail="Invalid TOTP code")

    # Issue full tokens
    from app.api_ma import get_user, get_role_permissions
    user_record = get_user(int(user_id))
    if not user_record:
        raise HTTPException(status_code=401, detail="User not found")
    role = user_record.get("role", "operator")
    try:
        perms = sorted(get_role_permissions(role))
    except Exception:
        perms = []

    tokens = _issue_full_tokens(int(user_id), username, role, perms)

    # Audit: 2FA verify success
    try:
        from app.api_ma import log_semantic
        log_semantic(
            "auth.login_success",
            user_id=int(user_id),
            username=username,
            action="POST /api/v1/auth/login/verify",
            details=f"2FA verified for user #{user_id} ({username})",
        )
    except Exception:
        pass

    return {"status": "ok", "data": tokens}
