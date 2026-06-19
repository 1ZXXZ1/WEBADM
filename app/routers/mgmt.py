"""
Management API router — CRUD operations for API users, API keys, roles, and permissions.

Provides endpoints for managing users, API keys, roles (with granular permissions),
and viewing audit logs. These endpoints are used by the web frontend's admin panel.

v2.2 (current) — adds:
  - ``weight`` field on Users / API-keys / Roles (priority for ordering + UI)
  - explicit ``/enable`` and ``/disable`` endpoints for users/keys/roles
  - hard-delete (``DELETE ...?hard=true`` or ``/purge``) alongside soft-delete
  - ``POST /roles/{name}/gen-key`` — generate API-key scoped to a role
  - ``GET /users/{id}/keys`` and ``GET /roles/{name}/users`` — relationship listings
  - ``POST /users/{id}/reset-password`` — password reset (optional random gen)
  - ``POST /users/bulk`` and ``POST /keys/bulk`` — bulk enable/disable/purge
  - ``GET /stats`` — mgmt dashboard summary
  - ``search`` query param on list endpoints

All endpoints require admin-level authentication.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.auth import ApiKeyDep
from app.models.common import ErrorResponse, SuccessResponse

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/mgmt",
    tags=["Management"],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    },
)


# ── Request models ──────────────────────────────────────────────────────

class RoleCreateRequest(BaseModel):
    """Request body for creating a new role."""
    name: str = Field(..., description="Unique role name", min_length=1, max_length=64)
    description: str = Field(default="", description="Human-readable description")
    permissions: List[str] = Field(..., description="List of permission strings")
    weight: int = Field(default=0, ge=-1000, le=1000,
                        description="Priority weight (higher = preferred). Default 0.")


class RoleUpdateRequest(BaseModel):
    """Request body for updating a role."""
    name: Optional[str] = Field(default=None, description="New role name (rename)")
    description: Optional[str] = Field(default=None, description="Updated description")
    permissions: Optional[List[str]] = Field(default=None, description="Updated permission list")
    weight: Optional[int] = Field(default=None, ge=-1000, le=1000, description="Priority weight")
    is_active: Optional[bool] = Field(default=None, description="Enable/disable flag")


class UserCreateRequest(BaseModel):
    """Request body for creating a management user."""
    username: str = Field(..., description="Username", min_length=1, max_length=64)
    password: str = Field(..., description="Password", min_length=1)
    role: str = Field(default="operator", description="Role name")
    full_name: Optional[str] = Field(default="", description="Full name")
    email: Optional[str] = Field(default="", description="Email address")
    weight: int = Field(default=0, ge=-1000, le=1000,
                        description="Priority weight (higher = preferred). Default 0.")


class UserUpdateRequest(BaseModel):
    """Request body for updating a management user."""
    username: Optional[str] = Field(default=None, description="New username")
    password: Optional[str] = Field(default=None, description="New password")
    role: Optional[str] = Field(default=None, description="New role name")
    full_name: Optional[str] = Field(default=None, description="Full name")
    email: Optional[str] = Field(default=None, description="Email address")
    is_active: Optional[bool] = Field(default=None, description="Active status")
    weight: Optional[int] = Field(default=None, ge=-1000, le=1000,
                                  description="Priority weight")


class PasswordResetRequest(BaseModel):
    """Request body for password reset."""
    new_password: Optional[str] = Field(
        default=None,
        description="New password. If omitted, a strong random password is generated and returned.",
    )


class ApiKeyCreateRequest(BaseModel):
    """Request body for creating an API key."""
    user_id: int = Field(..., description="User ID to associate key with")
    name: str = Field(..., description="Key name/description")
    role: str = Field(default="operator", description="Role name")
    expires_days: Optional[int] = Field(
        default=None,
        ge=1, le=3650,
        description="Days until expiry. Must be >= 1. None/null = no expiry. "
                    "Do NOT pass 0 — it would create an immediately-expired key.",
    )
    weight: int = Field(default=0, ge=-1000, le=1000,
                        description="Priority weight (higher = preferred). Default 0.")
    description: Optional[str] = Field(default="", description="Longer description")


class ApiKeyUpdateRequest(BaseModel):
    """Request body for updating an API key."""
    name: Optional[str] = Field(default=None, description="Key name")
    role: Optional[str] = Field(default=None, description="Role name")
    is_active: Optional[bool] = Field(default=None, description="Active status")
    expires_days: Optional[int] = Field(
        default=None,
        ge=1, le=3650,
        description="Reset expiry to N days from now (must be >= 1). "
                    "Null = leave unchanged. To remove expiry, use a very large value.",
    )
    weight: Optional[int] = Field(default=None, ge=-1000, le=1000,
                                  description="Priority weight")
    description: Optional[str] = Field(default=None, description="Longer description")


class GenKeyForRoleRequest(BaseModel):
    """Request body for ``POST /roles/{name}/gen-key`` — generate a key scoped to a role."""
    user_id: int = Field(..., description="Owner of the new key")
    name: Optional[str] = Field(default="", description="Key name. Default: 'key-for-<role>'")
    expires_days: Optional[int] = Field(default=None, description="Days until expiry")
    weight: int = Field(default=0, ge=-1000, le=1000, description="Priority weight")
    description: Optional[str] = Field(default="", description="Longer description")


class BulkActionRequest(BaseModel):
    """Request body for bulk enable/disable/purge operations."""
    ids: List[int] = Field(..., description="List of user/key IDs")
    action: str = Field(..., description="One of: enable, disable, purge")


class PermissionAssignRequest(BaseModel):
    """Request body for assigning permissions to a role."""
    role_name: str = Field(..., description="Role name to assign permissions to")
    permissions: List[str] = Field(..., description="List of permission strings to add")


class PermissionRevokeRequest(BaseModel):
    """Request body for revoking permissions from a role."""
    role_name: str = Field(..., description="Role name to revoke permissions from")
    permissions: List[str] = Field(..., description="List of permission strings to remove")


# ── Helpers for semantic audit events + webhook emit (v2.3.2) ──────────

def _emit_audit_and_webhooks(
    request: Request,
    event_type: str,
    entity: Dict[str, Any],
    *,
    entity_type: str = "user",
) -> None:
    """Best-effort: write semantic audit log entry + emit webhook + live event.

    Called by mgmt endpoints after a successful create/update/delete/
    enable/disable operation to ensure rich audit trail and webhook
    delivery. Silently swallows all errors — audit/webhooks must never
    break the main request flow.

    Parameters
    ----------
    event_type : str
        e.g. "user.created", "key.disabled", "role.updated"
    entity : dict
        The user/key/role record (without sensitive fields)
    entity_type : str
        "user" / "key" / "role" — picks the right webhook emitter
    """
    try:
        # Extract caller info from request state
        auth_method = getattr(request.state, "auth_method", None)
        username = None
        user_id = None
        api_key_id = None
        ip_addr = request.client.host if request.client else ""

        if auth_method == "jwt":
            payload = getattr(request.state, "user", {}) or {}
            username = payload.get("sub") or payload.get("username")
            if username:
                try:
                    from app.api_ma import get_user_by_username
                    u = get_user_by_username(username)
                    if u:
                        user_id = u["id"]
                except Exception:
                    pass
        elif auth_method in ("api_key", "static_api_key"):
            key_info = getattr(request.state, "api_key_info", None) or {}
            user_id = key_info.get("user_id")
            api_key_id = key_info.get("key_id")
            username = key_info.get("username")

        # 1. Semantic audit log entry
        try:
            from app.api_ma import log_semantic
            log_semantic(
                event_type=event_type,
                user_id=user_id,
                username=username,
                api_key_id=api_key_id,
                ip_address=ip_addr,
                details=str(entity)[:1000],  # truncate to keep audit table small
                auth_method=auth_method,
            )
        except Exception:
            pass

        # 2. Webhook emit
        try:
            from app.webhooks import (
                emit_user_event, emit_key_event, emit_role_event,
            )
            if entity_type == "user":
                # Strip the event_type prefix to get the action ("created", "disabled", etc.)
                action = event_type.split(".", 1)[1] if "." in event_type else event_type
                emit_user_event(action, entity)
            elif entity_type == "key":
                action = event_type.split(".", 1)[1] if "." in event_type else event_type
                emit_key_event(action, entity)
            elif entity_type == "role":
                action = event_type.split(".", 1)[1] if "." in event_type else event_type
                emit_role_event(action, entity)
        except Exception:
            pass

        # 3. Live event (SSE/WS)
        try:
            from app.routers.live import publish_event
            publish_event(f"mgmt.{entity_type}.{event_type.split('.', 1)[-1]}", {
                entity_type: entity,
                "actor": {"username": username, "user_id": user_id,
                          "auth_method": auth_method},
            })
        except Exception:
            pass
    except Exception:
        pass


# ── User Management ────────────────────────────────────────────────────

@router.get("/users", summary="List management users")
async def list_users(
    _: ApiKeyDep,
    role: Optional[str] = Query(default=None, description="Filter by role"),
    is_active: Optional[bool] = Query(default=None, description="Filter by active status"),
    search: Optional[str] = Query(default=None, description="Search in username/full_name/email"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    limit: int = Query(default=100, ge=1, le=500, description="Page size"),
) -> Dict[str, Any]:
    """List all management users with optional filtering and pagination."""
    from app.api_ma import list_users as _list_users
    result = _list_users(role=role, is_active=is_active, offset=offset, limit=limit, search=search)
    return {"status": "ok", "data": result}


@router.post("/users", summary="Create management user", status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreateRequest,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Create a new management user."""
    from app.api_ma import create_user as _create_user
    try:
        result = _create_user(
            username=body.username, password=body.password, role=body.role,
            full_name=body.full_name or "", email=body.email or "",
            weight=body.weight,
        )
        # v2.3.2: emit webhook + live event + semantic audit
        _emit_audit_and_webhooks(request, "user.created", result, entity_type="user")
        return {"status": "ok", "data": result}
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/users/{user_id}", summary="Get management user")
async def get_user(
    user_id: int,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Get a specific management user by ID."""
    from app.api_ma import get_user as _get_user
    result = _get_user(user_id)
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "ok", "data": result}


@router.put("/users/{user_id}", summary="Update management user")
async def update_user(
    user_id: int,
    body: UserUpdateRequest,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Update a management user's attributes."""
    from app.api_ma import update_user as _update_user
    kwargs = {k: v for k, v in {
        "username": body.username, "password": body.password, "role": body.role,
        "full_name": body.full_name, "email": body.email, "is_active": body.is_active,
        "weight": body.weight,
    }.items() if v is not None}
    if not kwargs:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        result = _update_user(user_id, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    _emit_audit_and_webhooks(request, "user.updated", result, entity_type="user")
    return {"status": "ok", "data": result}


@router.delete("/users/{user_id}", summary="Delete management user (soft or hard)")
async def delete_user(
    user_id: int,
    request: Request,
    _: ApiKeyDep,
    hard: bool = Query(default=False, description="If true, hard-delete (irreversible). Otherwise soft-delete (default)."),
) -> Dict[str, Any]:
    """Delete a management user.

    By default performs a **soft** delete: sets ``is_active=FALSE`` and
    deactivates all of the user's API keys. Pass ``?hard=true`` for an
    irreversible hard delete that also removes the user's keys via CASCADE.
    Hard-delete refuses to remove the last active admin user.

    Returns clear status:
      * 200 + "deactivated" / "permanently deleted"
      * 404 "User not found (or already inactive)" for soft-delete on already-inactive
      * 400 for hard-delete on last admin
    """
    from app.api_ma import get_user, delete_user as _delete_user, purge_user as _purge_user
    # Pre-check existence
    user = get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail=f"User #{user_id} not found")

    if hard:
        try:
            ok = _purge_user(user_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        if not ok:
            raise HTTPException(status_code=404, detail=f"User #{user_id} not found")
        _emit_audit_and_webhooks(request, "user.deleted", user, entity_type="user")
        return {
            "status": "ok",
            "message": f"User #{user_id} ({user.get('username', '')}) permanently deleted",
            "user_id": user_id,
            "username": user.get("username", ""),
        }

    # Soft delete — check if already inactive
    if not user.get("is_active"):
        return {
            "status": "ok",
            "message": f"User #{user_id} ({user.get('username', '')}) is already inactive (no change)",
            "user_id": user_id,
            "username": user.get("username", ""),
        }
    if not _delete_user(user_id):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to deactivate user #{user_id} (DB error)",
        )
    _emit_audit_and_webhooks(request, "user.disabled", user, entity_type="user")
    return {
        "status": "ok",
        "message": f"User #{user_id} ({user.get('username', '')}) deactivated (and all their API keys)",
        "user_id": user_id,
        "username": user.get("username", ""),
    }


@router.post("/users/{user_id}/enable", summary="Enable user")
async def enable_user(
    user_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Re-activate a previously disabled user.

    Returns clear status:
      * 200 + "User enabled" — was disabled, now active
      * 200 + "User is already active" — no change needed
      * 404 "User not found" — user_id doesn't exist

    Note: this does NOT re-enable the user's API keys. Enable each key
    explicitly via ``POST /api/v1/mgmt/keys/{key_id}/enable``.
    """
    from app.api_ma import get_user, enable_user as _enable_user
    # Pre-check: does the user exist?
    user = get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail=f"User #{user_id} not found")
    # Pre-check: already active?
    if user.get("is_active"):
        return {
            "status": "ok",
            "message": f"User #{user_id} ({user.get('username', '')}) is already active (no change)",
            "user_id": user_id,
            "username": user.get("username", ""),
        }
    # Perform enable
    if not _enable_user(user_id):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to enable user #{user_id} (DB error)",
        )
    _emit_audit_and_webhooks(request, "user.enabled", user, entity_type="user")
    return {
        "status": "ok",
        "message": f"User #{user_id} ({user.get('username', '')}) enabled",
        "user_id": user_id,
        "username": user.get("username", ""),
    }


@router.post("/users/{user_id}/disable", summary="Disable user (soft)")
async def disable_user(
    user_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Disable a user (soft) and all their API keys."""
    from app.api_ma import get_user, disable_user as _disable_user
    user = get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail=f"User #{user_id} not found")
    if not user.get("is_active"):
        return {
            "status": "ok",
            "message": f"User #{user_id} ({user.get('username', '')}) is already disabled (no change)",
            "user_id": user_id,
            "username": user.get("username", ""),
        }
    if not _disable_user(user_id):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to disable user #{user_id} (DB error)",
        )
    _emit_audit_and_webhooks(request, "user.disabled", user, entity_type="user")
    return {
        "status": "ok",
        "message": f"User #{user_id} ({user.get('username', '')}) disabled (and all their API keys)",
        "user_id": user_id,
        "username": user.get("username", ""),
    }


@router.post("/users/{user_id}/purge", summary="Permanently delete user")
async def purge_user(
    user_id: int,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Permanently delete a user record (irreversible).

    Removes the user row and CASCADE-deletes all of its API keys.
    Refuses to purge the last active admin user.
    """
    from app.api_ma import purge_user as _purge_user
    try:
        ok = _purge_user(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not ok:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "ok", "message": f"User {user_id} permanently deleted"}


@router.post("/users/{user_id}/reset-password", summary="Reset user password")
async def reset_password(
    user_id: int,
    body: PasswordResetRequest,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Reset a user's password.

    If ``new_password`` is omitted in the body, a strong random password
    is generated and returned in the response. Otherwise, the provided
    password is set and ``new_password`` is null in the response.
    """
    from app.api_ma import reset_user_password as _reset_user_password
    try:
        new_pw = _reset_user_password(user_id, body.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if new_pw is None:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "status": "ok",
        "message": f"Password for user {user_id} reset",
        "data": {"new_password": new_pw} if not body.new_password else None,
    }


@router.get("/users/{user_id}/keys", summary="List API keys of a user")
async def list_user_keys(
    user_id: int,
    _: ApiKeyDep,
    include_inactive: bool = Query(default=False, description="Include deactivated keys"),
) -> Dict[str, Any]:
    """List all API keys belonging to a given user."""
    from app.api_ma import list_user_keys as _list_user_keys
    result = _list_user_keys(user_id, include_inactive=include_inactive)
    return {"status": "ok", "data": result}


@router.post("/users/bulk", summary="Bulk action on users (enable/disable/purge)")
async def bulk_user_action(
    body: BulkActionRequest,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Apply the same action (enable / disable / purge) to multiple users."""
    if body.action not in ("enable", "disable", "purge"):
        raise HTTPException(status_code=400, detail="action must be one of: enable, disable, purge")
    from app.api_ma import bulk_user_action as _bulk_user_action
    result = _bulk_user_action(body.ids, body.action)
    return {"status": "ok", "data": result}


# ── API Key Management ─────────────────────────────────────────────────

@router.get("/keys", summary="List API keys")
async def list_api_keys(
    _: ApiKeyDep,
    user_id: Optional[int] = Query(default=None, description="Filter by user ID"),
    is_active: Optional[bool] = Query(default=None, description="Filter by active status"),
    search: Optional[str] = Query(default=None, description="Search in name/description"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    limit: int = Query(default=100, ge=1, le=500, description="Page size"),
) -> Dict[str, Any]:
    """List API keys with optional filtering and pagination."""
    from app.api_ma import list_api_keys as _list_api_keys
    result = _list_api_keys(user_id=user_id, is_active=is_active, offset=offset, limit=limit, search=search)
    return {"status": "ok", "data": result}


@router.post("/keys", summary="Create API key", status_code=status.HTTP_201_CREATED)
async def create_api_key(
    body: ApiKeyCreateRequest,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Create a new API key. The plaintext key is returned ONLY once."""
    from app.api_ma import create_api_key as _create_api_key
    try:
        result = _create_api_key(
            user_id=body.user_id, name=body.name, role=body.role,
            expires_days=body.expires_days, description=body.description or "",
            weight=body.weight,
        )
        # v2.3.2: semantic audit + webhook (don't leak the plaintext key)
        _emit_audit_and_webhooks(
            request, "key.created",
            {"user_id": body.user_id, "name": body.name, "role": body.role,
             "expires_days": body.expires_days, "weight": body.weight},
            entity_type="key",
        )
        return {"status": "ok", "data": {"key": result}}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/keys/{key_id}", summary="Get API key details")
async def get_api_key(
    key_id: int,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Get details of a specific API key."""
    from app.api_ma import get_api_key as _get_api_key
    result = _get_api_key(key_id)
    if not result:
        raise HTTPException(status_code=404, detail="API key not found")
    return {"status": "ok", "data": result}


@router.put("/keys/{key_id}", summary="Update API key")
async def update_api_key(
    key_id: int,
    body: ApiKeyUpdateRequest,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Update an API key's attributes."""
    from app.api_ma import update_api_key as _update_api_key
    kwargs = {k: v for k, v in {
        "name": body.name, "role": body.role, "is_active": body.is_active,
        "weight": body.weight, "description": body.description,
    }.items() if v is not None}
    if body.expires_days is not None:
        from datetime import datetime, timedelta, timezone
        kwargs["expires_at"] = (datetime.now(timezone.utc) + timedelta(days=body.expires_days)).isoformat()
    if not kwargs:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        result = _update_api_key(key_id, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not result:
        raise HTTPException(status_code=404, detail="API key not found")
    return {"status": "ok", "data": result}


@router.delete("/keys/{key_id}", summary="Delete API key (soft or hard)")
async def delete_api_key(
    key_id: int,
    request: Request,
    _: ApiKeyDep,
    hard: bool = Query(default=False, description="If true, hard-delete the row. Otherwise soft-delete (deactivate)."),
) -> Dict[str, Any]:
    """Delete an API key.

    Default is a soft-delete (``is_active=FALSE``). Pass ``?hard=true``
    for an irreversible hard delete.

    Returns clear status:
      * 200 + "deactivated" / "permanently deleted"
      * 200 + "already inactive (no change)" for soft-delete on already-inactive
      * 404 "API key not found"
    """
    from app.api_ma import get_api_key, delete_api_key as _delete_api_key, purge_api_key as _purge_api_key
    key = get_api_key(key_id)
    if not key:
        raise HTTPException(status_code=404, detail=f"API key #{key_id} not found")

    if hard:
        if not _purge_api_key(key_id):
            raise HTTPException(status_code=404, detail=f"API key #{key_id} not found")
        _emit_audit_and_webhooks(request, "key.deleted", key, entity_type="key")
        return {
            "status": "ok",
            "message": f"API key #{key_id} ({key.get('name', '')}) permanently deleted",
            "key_id": key_id,
        }

    # Soft delete — check if already inactive
    if not key.get("is_active"):
        return {
            "status": "ok",
            "message": f"API key #{key_id} ({key.get('name', '')}) is already inactive (no change)",
            "key_id": key_id,
        }
    if not _delete_api_key(key_id):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to deactivate API key #{key_id} (DB error)",
        )
    _emit_audit_and_webhooks(request, "key.disabled", key, entity_type="key")
    return {
        "status": "ok",
        "message": f"API key #{key_id} ({key.get('name', '')}) deactivated",
        "key_id": key_id,
    }


@router.post("/keys/{key_id}/rotate", summary="Rotate API key")
async def rotate_api_key(
    key_id: int,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Rotate an API key: deactivate old key and create new one with same settings."""
    from app.api_ma import rotate_api_key as _rotate_api_key
    try:
        result = _rotate_api_key(key_id)
        if result is None:
            raise HTTPException(status_code=404, detail="API key not found")
        return {"status": "ok", "data": {"key": result}}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/keys/{key_id}/enable", summary="Enable API key")
async def enable_api_key(
    key_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Re-activate a previously disabled API key.

    The owning user must still be active, otherwise the key cannot be
    re-enabled.

    Returns clear status:
      * 200 + "API key enabled" — was disabled, now active
      * 200 + "API key is already active" — no change needed
      * 404 "API key not found"
      * 400 "Owning user is inactive" — enable the user first
    """
    from app.api_ma import get_api_key, get_user, enable_api_key as _enable_api_key
    key = get_api_key(key_id)
    if not key:
        raise HTTPException(status_code=404, detail=f"API key #{key_id} not found")
    if key.get("is_active"):
        return {
            "status": "ok",
            "message": f"API key #{key_id} ({key.get('name', '')}) is already active (no change)",
            "key_id": key_id,
        }
    # Check owning user is active
    user = get_user(key.get("user_id", 0))
    if not user:
        raise HTTPException(
            status_code=400,
            detail=f"Owning user #{key.get('user_id')} not found — cannot enable orphaned key",
        )
    if not user.get("is_active"):
        raise HTTPException(
            status_code=400,
            detail=f"Owning user #{user['id']} ({user.get('username', '')}) is disabled. "
                   f"Enable the user first: POST /api/v1/mgmt/users/{user['id']}/enable",
        )
    if not _enable_api_key(key_id):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to enable API key #{key_id} (DB error)",
        )
    _emit_audit_and_webhooks(request, "key.enabled", key, entity_type="key")
    return {
        "status": "ok",
        "message": f"API key #{key_id} ({key.get('name', '')}) enabled",
        "key_id": key_id,
    }


@router.post("/keys/{key_id}/disable", summary="Disable API key (soft)")
async def disable_api_key(
    key_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Deactivate an API key."""
    from app.api_ma import get_api_key, disable_api_key as _disable_api_key
    key = get_api_key(key_id)
    if not key:
        raise HTTPException(status_code=404, detail=f"API key #{key_id} not found")
    if not key.get("is_active"):
        return {
            "status": "ok",
            "message": f"API key #{key_id} ({key.get('name', '')}) is already disabled (no change)",
            "key_id": key_id,
        }
    if not _disable_api_key(key_id):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to disable API key #{key_id} (DB error)",
        )
    _emit_audit_and_webhooks(request, "key.disabled", key, entity_type="key")
    return {
        "status": "ok",
        "message": f"API key #{key_id} ({key.get('name', '')}) disabled",
        "key_id": key_id,
    }


@router.post("/keys/{key_id}/purge", summary="Permanently delete API key")
async def purge_api_key(
    key_id: int,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Permanently delete an API key record (irreversible)."""
    from app.api_ma import purge_api_key as _purge_api_key
    if not _purge_api_key(key_id):
        raise HTTPException(status_code=404, detail="API key not found")
    return {"status": "ok", "message": f"API key {key_id} permanently deleted"}


@router.post("/keys/bulk", summary="Bulk action on API keys (enable/disable/purge)")
async def bulk_key_action(
    body: BulkActionRequest,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Apply the same action (enable / disable / purge) to multiple API keys."""
    if body.action not in ("enable", "disable", "purge"):
        raise HTTPException(status_code=400, detail="action must be one of: enable, disable, purge")
    from app.api_ma import bulk_key_action as _bulk_key_action
    result = _bulk_key_action(body.ids, body.action)
    return {"status": "ok", "data": result}


# ── Role Management ────────────────────────────────────────────────────

@router.get("/roles", summary="List all roles")
async def list_roles(
    _: ApiKeyDep,
    include_disabled: bool = Query(default=True, description="Include disabled roles"),
) -> Dict[str, Any]:
    """List all defined roles with their permission sets."""
    from app.api_ma import list_roles as _list_roles
    result = _list_roles(include_disabled=include_disabled)
    return {"status": "ok", "data": result}


@router.get("/roles/{role_name}", summary="Get role details")
async def get_role(
    role_name: str,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Get details of a specific role including its permissions."""
    from app.api_ma import get_role as _get_role
    result = _get_role(role_name)
    if not result:
        raise HTTPException(status_code=404, detail=f"Role '{role_name}' not found")
    return {"status": "ok", "data": result}


@router.post("/roles", summary="Create custom role", status_code=status.HTTP_201_CREATED)
async def create_role(
    body: RoleCreateRequest,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Create a new custom role with specified permissions.

    Permission strings use the format ``resource.action`` (e.g. ``user.create``,
    ``gpo.delete``, ``dns.recordcreate``).  See ``/api/v1/mgmt/permissions`` for
    the full list of available permissions.
    """
    from app.api_ma import create_role as _create_role
    try:
        result = _create_role(
            name=body.name,
            permissions=body.permissions,
            description=body.description,
            weight=body.weight,
        )
        _emit_audit_and_webhooks(request, "role.created", result, entity_type="role")
        return {"status": "ok", "data": result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/roles/{role_name}", summary="Update role")
async def update_role(
    role_name: str,
    body: RoleUpdateRequest,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Update a role's attributes (description, permissions, weight, is_active, or rename).

    Built-in roles (admin, operator, auditor) can have their permissions
    updated but cannot be renamed or deleted. Disabling a role via
    ``is_active=false`` will reject all API keys referencing it.
    """
    from app.api_ma import update_role as _update_role
    kwargs = {k: v for k, v in {
        "name": body.name, "description": body.description,
        "permissions": body.permissions, "weight": body.weight,
        "is_active": body.is_active,
    }.items() if v is not None}
    if not kwargs:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        result = _update_role(role_name, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not result:
        raise HTTPException(status_code=404, detail=f"Role '{role_name}' not found")
    return {"status": "ok", "data": result}


@router.delete("/roles/{role_name}", summary="Delete custom role (hard)")
async def delete_role(
    role_name: str,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Delete a custom (non-built-in) role.

    This is a HARD delete — the role row is removed permanently.
    Refuses to delete if any active user or API key still references the role;
    reassign or disable them first, or use ``POST /roles/{name}/disable``
    for a reversible operation.
    """
    from app.api_ma import delete_role as _delete_role
    try:
        result = _delete_role(role_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not result:
        raise HTTPException(
            status_code=400,
            detail=f"Role '{role_name}' not found or is a built-in role that cannot be deleted",
        )
    _emit_audit_and_webhooks(request, "role.deleted", {"name": role_name}, entity_type="role")
    return {"status": "ok", "message": f"Role '{role_name}' deleted"}


@router.post("/roles/{role_name}/enable", summary="Enable role")
async def enable_role(
    role_name: str,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Re-enable a previously disabled role.

    Returns clear status:
      * 200 + "Role enabled" — was disabled, now active
      * 200 + "Role is already active" — no change needed
      * 404 "Role not found"
    """
    from app.api_ma import get_role, enable_role as _enable_role
    role = get_role(role_name)
    if not role:
        raise HTTPException(status_code=404, detail=f"Role '{role_name}' not found")
    if role.get("is_active"):
        return {
            "status": "ok",
            "message": f"Role '{role_name}' is already active (no change)",
            "role": role_name,
        }
    if not _enable_role(role_name):
        raise HTTPException(
            status_code=500,
            detail=f"Failed to enable role '{role_name}' (DB error)",
        )
    _emit_audit_and_webhooks(request, "role.enabled", {"name": role_name}, entity_type="role")
    return {"status": "ok", "message": f"Role '{role_name}' enabled", "role": role_name}


@router.post("/roles/{role_name}/disable", summary="Disable role (soft)")
async def disable_role(
    role_name: str,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Disable a role without deleting it.

    All API keys that reference this role will be rejected at validation
    time. Existing JWT sessions are not affected — they expire naturally.
    The ``admin`` role cannot be disabled.

    Returns clear status:
      * 200 + "Role disabled" — was active, now disabled
      * 200 + "Role is already disabled" — no change needed
      * 404 "Role not found"
      * 400 "Cannot disable 'admin' role"
    """
    from app.api_ma import get_role, disable_role as _disable_role
    if role_name == "admin":
        raise HTTPException(
            status_code=400,
            detail="Cannot disable the 'admin' role (would lock out all users)",
        )
    role = get_role(role_name)
    if not role:
        raise HTTPException(status_code=404, detail=f"Role '{role_name}' not found")
    if not role.get("is_active"):
        return {
            "status": "ok",
            "message": f"Role '{role_name}' is already disabled (no change)",
            "role": role_name,
        }
    try:
        if not _disable_role(role_name):
            raise HTTPException(
                status_code=500,
                detail=f"Failed to disable role '{role_name}' (DB error)",
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _emit_audit_and_webhooks(request, "role.disabled", {"name": role_name}, entity_type="role")
    return {
        "status": "ok",
        "message": f"Role '{role_name}' disabled. All API keys with this role are now rejected.",
        "role": role_name,
    }


@router.post("/roles/{role_name}/gen-key", summary="Generate API key for role", status_code=status.HTTP_201_CREATED)
async def gen_key_for_role(
    role_name: str,
    body: GenKeyForRoleRequest,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Generate a new API key already scoped to a given role.

    Convenience endpoint: validates that the role exists and is active,
    then creates an API key for the specified user with that role.
    The plaintext key is returned ONLY once.
    """
    from app.api_ma import gen_key_for_role as _gen_key_for_role
    try:
        result = _gen_key_for_role(
            role_name=role_name,
            user_id=body.user_id,
            name=body.name or "",
            expires_days=body.expires_days,
            description=body.description or "",
            weight=body.weight,
        )
        return {"status": "ok", "data": {"key": result, "role": role_name}}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/roles/{role_name}/users", summary="List users assigned to a role")
async def list_role_users(
    role_name: str,
    _: ApiKeyDep,
    include_inactive: bool = Query(default=False, description="Include inactive users"),
) -> Dict[str, Any]:
    """List all users that have been assigned a given role."""
    from app.api_ma import list_role_users as _list_role_users
    result = _list_role_users(role_name, include_inactive=include_inactive)
    return {"status": "ok", "data": result, "role": role_name}


@router.get("/roles/{role_name}/keys", summary="List API keys assigned to a role")
async def list_role_keys(
    role_name: str,
    _: ApiKeyDep,
    include_inactive: bool = Query(default=False, description="Include inactive keys"),
) -> Dict[str, Any]:
    """List all API keys that have been assigned a given role."""
    from app.api_ma import list_role_keys as _list_role_keys
    result = _list_role_keys(role_name, include_inactive=include_inactive)
    return {"status": "ok", "data": result, "role": role_name}


# ── Permission Management ──────────────────────────────────────────────

@router.get("/permissions", summary="List all available permissions")
async def list_permissions(
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """List all available permissions grouped by category.

    Returns a dictionary mapping resource categories (e.g. 'user', 'group',
    'dns') to lists of permission strings.
    """
    try:
        from app.permissions import get_permissions_by_category, ALL_PERMISSIONS
        return {
            "status": "ok",
            "total": len(ALL_PERMISSIONS),
            "categories": get_permissions_by_category(),
        }
    except ImportError:
        return {"status": "ok", "total": 0, "categories": {}}


@router.post("/permissions/assign", summary="Assign permissions to a role")
async def assign_permissions(
    body: PermissionAssignRequest,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Add one or more permissions to an existing role.

    This appends permissions to the role's current set — it does NOT
    replace existing permissions.
    """
    from app.api_ma import get_role, update_role
    role = get_role(body.role_name)
    if not role:
        raise HTTPException(status_code=404, detail=f"Role '{body.role_name}' not found")

    # Merge: current + new
    current = set(role.get("permissions", []))
    new_perms = current | set(body.permissions)

    # Validate permissions
    try:
        from app.permissions import ALL_PERMISSIONS
        invalid = set(body.permissions) - ALL_PERMISSIONS
        if invalid:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid permission strings: {sorted(invalid)}",
            )
    except ImportError:
        pass

    try:
        result = update_role(body.role_name, permissions=sorted(new_perms))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "ok", "data": result}


@router.post("/permissions/revoke", summary="Revoke permissions from a role")
async def revoke_permissions(
    body: PermissionRevokeRequest,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Remove one or more permissions from an existing role."""
    from app.api_ma import get_role, update_role
    role = get_role(body.role_name)
    if not role:
        raise HTTPException(status_code=404, detail=f"Role '{body.role_name}' not found")

    # Subtract
    current = set(role.get("permissions", []))
    new_perms = current - set(body.permissions)

    try:
        result = update_role(body.role_name, permissions=sorted(new_perms))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "ok", "data": result}


# ── Stats ──────────────────────────────────────────────────────────────

@router.get("/stats", summary="Management dashboard stats")
async def mgmt_stats(
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Return counts and per-role breakdown for the management dashboard."""
    from app.api_ma import get_mgmt_stats as _get_mgmt_stats
    result = _get_mgmt_stats()
    return {"status": "ok", "data": result}


# ── Audit Log ──────────────────────────────────────────────────────────

@router.get("/audit", summary="View audit log")
async def list_audit_log(
    _: ApiKeyDep,
    user_id: Optional[int] = Query(default=None, description="Filter by user ID"),
    action: Optional[str] = Query(default=None, description="Filter by action (exact match)"),
    endpoint: Optional[str] = Query(default=None, description="Filter by endpoint (LIKE prefix)"),
    event_type: Optional[str] = Query(
        default=None,
        description="(v2.3.2) Filter by semantic event type (e.g. 'user.created', 'auth.login_failure')",
    ),
    auth_method: Optional[str] = Query(
        default=None,
        description="(v2.3.2) Filter by auth method: 'jwt', 'api_key', 'static_api_key', 'credentials'",
    ),
    ip_address: Optional[str] = Query(
        default=None,
        description="(v2.3.2) Filter by client IP (exact match)",
    ),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    limit: int = Query(default=100, ge=1, le=500, description="Page size"),
) -> Dict[str, Any]:
    """View audit log entries.

    v2.3.2: Returns rich fields — username, method, status_code,
    duration_ms, user_agent, auth_method, event_type. New filters:
    ``event_type``, ``auth_method``, ``ip_address``.
    """
    try:
        from app.api_ma import list_audit_log as _list_audit_log
        result = _list_audit_log(
            user_id=user_id, action=action, endpoint=endpoint,
            offset=offset, limit=limit,
            event_type=event_type, auth_method=auth_method, ip_address=ip_address,
        )
        return {"status": "ok", "data": result, "count": len(result)}
    except Exception:
        # Audit log may not be available if api_ma is not initialized
        return {"status": "ok", "data": [], "count": 0}
