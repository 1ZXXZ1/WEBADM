"""
Ban / Unban REST API router for the Samba AD DC Management API.

Provides endpoints for banning and unbanning **mgmt users** and
**API keys**, plus listing, inspection, and history queries.

Endpoints
---------
``POST   /api/v1/ban``                  — Create a ban (user or key)
``POST   /api/v1/unban``                — Lift a ban (by id or by target)
``GET    /api/v1/ban``                  — List bans (filters: active, type, name)
``GET    /api/v1/ban/{ban_id}``         — Show one ban record
``DELETE /api/v1/ban/{ban_id}``         — Hard-delete a ban record (admin only)
``GET    /api/v1/ban/check/{type}/{name}`` — Check if target is currently banned

Permissions
-----------
- ``ban.create``  — POST /api/v1/ban
- ``ban.unban``   — POST /api/v1/unban
- ``ban.list``    — GET  /api/v1/ban
- ``ban.show``    — GET  /api/v1/ban/{id}, GET /api/v1/ban/check/*
- ``ban.delete``  — DELETE /api/v1/ban/{id}

All ban permissions are **admin-only** by default. They are NOT included
in ``READ_PERMISSIONS`` (operator) nor in the ``auditor`` role, because
banning disrupts access — even read access to the ban list is sensitive
(it can reveal who has been blocked and why).

Ban enforcement (the actual blocking of banned targets at request time)
happens in ``app/main.py`` auth middleware, which calls
``ban_db.is_banned()`` after authenticating the user/key.

v1.2.7_ban: Initial implementation.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.auth import ApiKeyDep

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ban", tags=["Bans"])


# ═══════════════════════════════════════════════════════════════════════
# Request / response models
# ═══════════════════════════════════════════════════════════════════════

class BanCreateRequest(BaseModel):
    """Request body for POST /api/v1/ban."""

    target_type: str = Field(
        ...,
        description="Тип цели: 'user' (mgmt-пользователь) или 'key' (API-ключ).",
    )
    target_name: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Имя цели: username для user, либо key_prefix (8 символов) для key.",
    )
    reason: str = Field(
        "",
        max_length=2048,
        description="Причина бана (произвольный текст).",
    )
    duration_minutes: Optional[int] = Field(
        None,
        ge=0,
        description=(
            "Длительность бана в минутах. "
            "0 или null = бессрочный бан (permanent)."
        ),
    )


class UnbanRequest(BaseModel):
    """Request body for POST /api/v1/unban."""

    ban_id: Optional[int] = Field(
        None,
        ge=1,
        description="ID бана для снятия. Если указан, target_type/name игнорируются.",
    )
    target_type: Optional[str] = Field(
        None,
        description="Тип цели (если ban_id не указан).",
    )
    target_name: Optional[str] = Field(
        None,
        description="Имя цели (если ban_id не указан).",
    )
    lifted_reason: str = Field(
        "",
        max_length=2048,
        description="Причина снятия бана.",
    )


class BanRecord(BaseModel):
    """Single ban record returned by the API."""

    id: int
    target_type: str
    target_name: str
    target_id: Optional[int] = None
    reason: str = ""
    banned_by: str = ""
    banned_by_ip: str = ""
    created_at: str
    expires_at: Optional[str] = None
    lifted_at: Optional[str] = None
    lifted_by: Optional[str] = None
    lifted_reason: Optional[str] = None
    is_active: bool


class BanListResponse(BaseModel):
    """Response model for GET /api/v1/ban."""

    status: str = "ok"
    total: int
    active: int
    bans: List[BanRecord]


class BanCheckResponse(BaseModel):
    """Response model for GET /api/v1/ban/check/{type}/{name}."""

    target_type: str
    target_name: str
    banned: bool
    ban: Optional[BanRecord] = None


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

def _get_actor(request: Request) -> Dict[str, str]:
    """Extract the acting admin's identity from the request state.

    Returns dict with ``username`` and ``ip`` — both may be empty.
    """
    username = ""
    ip = ""
    try:
        # JWT path
        user = getattr(request.state, "user", None)
        if isinstance(user, dict):
            username = user.get("username") or user.get("sub") or ""
        # API-key path: mgmt_api_keys have a name, not a username — use it
        if not username:
            key_info = getattr(request.state, "api_key_info", None)
            if isinstance(key_info, dict):
                username = key_info.get("name") or key_info.get("username") or ""
        # Static API key fallback
        if not username:
            auth_method = getattr(request.state, "auth_method", "")
            if auth_method == "static_api_key":
                username = "static-admin"
        ip = request.client.host if request.client else ""
    except Exception:
        pass
    return {"username": username, "ip": ip}


def _to_record(ban_dict: Optional[Dict[str, Any]]) -> Optional[BanRecord]:
    """Convert a raw dict from ban_db to a BanRecord pydantic model."""
    if ban_dict is None:
        return None
    return BanRecord(
        id=ban_dict["id"],
        target_type=ban_dict["target_type"],
        target_name=ban_dict["target_name"],
        target_id=ban_dict.get("target_id"),
        reason=ban_dict.get("reason", "") or "",
        banned_by=ban_dict.get("banned_by", "") or "",
        banned_by_ip=ban_dict.get("banned_by_ip", "") or "",
        created_at=ban_dict["created_at"],
        expires_at=ban_dict.get("expires_at"),
        lifted_at=ban_dict.get("lifted_at"),
        lifted_by=ban_dict.get("lifted_by"),
        lifted_reason=ban_dict.get("lifted_reason"),
        is_active=bool(ban_dict.get("is_active", False)),
    )


def _ban_db_or_503():
    """Import ban_db lazily; raise 503 if PostgreSQL is not available."""
    try:
        from app import ban_db
        return ban_db
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "status": "error",
                "message": f"Ban DB unavailable: {exc}",
            },
        )


# ═══════════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════════

@router.post(
    "",
    summary="Создать бан (user или key)",
    description=(
        "Создаёт бан для mgmt-пользователя или API-ключа. "
        "Если на цели уже есть активный бан — он автоматически снимается "
        "и создаётся новый (история сохраняется). "
        "Требуется разрешение `ban.create`."
    ),
    response_model=BanRecord,
    status_code=status.HTTP_201_CREATED,
)
async def create_ban(
    request: Request,
    body: BanCreateRequest,
    _auth: ApiKeyDep,
) -> BanRecord:
    ban_db = _ban_db_or_503()
    actor = _get_actor(request)

    # Validate target_type
    tt = body.target_type.lower().strip()
    if tt not in ("user", "key"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "status": "error",
                "message": f"target_type must be 'user' or 'key', got {body.target_type!r}",
            },
        )

    try:
        ban = ban_db.create_ban(
            target_type=tt,
            target_name=body.target_name.strip(),
            reason=body.reason,
            banned_by=actor["username"],
            banned_by_ip=actor["ip"],
            duration_minutes=body.duration_minutes,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"status": "error", "message": str(exc)},
        )

    # Audit log
    try:
        from app.api_ma import log_action
        log_action(
            user_id=None,
            api_key_id=None,
            action=f"BAN CREATE id={ban['id']} type={tt} name={body.target_name}",
            endpoint="/api/v1/ban",
            ip_address=actor["ip"],
            details=body.reason,
        )
    except Exception:
        pass

    return _to_record(ban)


@router.post(
    "/unban",
    summary="Снять бан (по id или по target_type+target_name)",
    description=(
        "Снимает активный бан. Либо укажите `ban_id`, либо пару "
        "`target_type` + `target_name`. Требуется разрешение `ban.unban`."
    ),
    response_model=BanRecord,
)
async def unban(
    request: Request,
    body: UnbanRequest,
    _auth: ApiKeyDep,
) -> BanRecord:
    ban_db = _ban_db_or_503()
    actor = _get_actor(request)

    if body.ban_id is None and not (body.target_type and body.target_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "status": "error",
                "message": "Either ban_id or (target_type + target_name) is required",
            },
        )

    try:
        ban = ban_db.lift_ban(
            ban_id=body.ban_id,
            target_type=body.target_type.lower().strip() if body.target_type else None,
            target_name=body.target_name.strip() if body.target_name else None,
            lifted_by=actor["username"],
            lifted_reason=body.lifted_reason,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"status": "error", "message": str(exc)},
        )

    if ban is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "status": "error",
                "message": "No active ban found for the given criteria",
            },
        )

    # Audit log
    try:
        from app.api_ma import log_action
        log_action(
            user_id=None,
            api_key_id=None,
            action=f"BAN LIFT id={ban['id']}",
            endpoint="/api/v1/unban",
            ip_address=actor["ip"],
            details=body.lifted_reason,
        )
    except Exception:
        pass

    return _to_record(ban)


# Convenience alias: POST /api/v1/ban/unban mirrors /api/v1/unban
# (some clients prefer a single root resource)
@router.post(
    "/unban/",
    include_in_schema=False,
    response_model=BanRecord,
)
async def unban_trailing(request: Request, body: UnbanRequest, _auth: ApiKeyDep) -> BanRecord:
    return await unban(request, body, _auth)


@router.get(
    "",
    summary="Список банов",
    description=(
        "Возвращает список банов с фильтрами. Без фильтров — последние 200. "
        "Требуется разрешение `ban.list`."
    ),
    response_model=BanListResponse,
)
async def list_bans(
    _auth: ApiKeyDep,
    active: Optional[bool] = Query(None, description="Только активные (true) или только снятые (false)"),
    target_type: Optional[str] = Query(None, description="Фильтр по типу: user | key"),
    target_name: Optional[str] = Query(None, description="Фильтр по имени цели"),
    limit: int = Query(200, ge=1, le=1000, description="Лимит записей"),
    offset: int = Query(0, ge=0, description="Сдвиг для пагинации"),
) -> BanListResponse:
    ban_db = _ban_db_or_503()

    bans = ban_db.list_bans(
        active_only=bool(active) if active is not None else False,
        target_type=target_type,
        target_name=target_name,
        limit=limit,
        offset=offset,
    )
    active_count = ban_db.count_active_bans()

    records = [_to_record(b) for b in bans]
    return BanListResponse(
        total=len(records),
        active=active_count,
        bans=records,
    )


@router.get(
    "/{ban_id}",
    summary="Показать один бан по id",
    response_model=BanRecord,
)
async def show_ban(ban_id: int, _auth: ApiKeyDep) -> BanRecord:
    ban_db = _ban_db_or_503()
    ban = ban_db.get_ban(ban_id)
    if ban is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"status": "error", "message": f"Ban {ban_id} not found"},
        )
    return _to_record(ban)


@router.delete(
    "/{ban_id}",
    summary="Удалить запись бана (hard-delete, admin-only)",
    description=(
        "Полностью удаляет запись бана из БД (история). "
        "Обычно для снятия бана используют POST /api/v1/unban "
        "(он сохраняет историю). Этот endpoint — только для cleanup. "
        "Требуется разрешение `ban.delete`."
    ),
)
async def delete_ban(ban_id: int, _auth: ApiKeyDep) -> Dict[str, Any]:
    ban_db = _ban_db_or_503()
    ban = ban_db.get_ban(ban_id)
    if ban is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"status": "error", "message": f"Ban {ban_id} not found"},
        )

    # Hard-delete via direct SQL
    from app import mgmt_db
    conn = mgmt_db._get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM mgmt_bans WHERE id = %s", (ban_id,))
        conn.commit()
    except Exception as exc:
        conn.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"status": "error", "message": f"Delete failed: {exc}"},
        )
    finally:
        mgmt_db._return_conn(conn)

    return {"status": "ok", "message": f"Ban {ban_id} deleted", "id": ban_id}


@router.get(
    "/check/{target_type}/{target_name}",
    summary="Проверить, забанена ли цель",
    description=(
        "Проверяет, есть ли активный бан на указанную цель. "
        "Не требует специальных разрешений (доступно любому "
        "аутентифицированному пользователю) — позволяет клиенту "
        "понять, почему его запрос был отклонён 403."
    ),
    response_model=BanCheckResponse,
)
async def check_ban(
    target_type: str,
    target_name: str,
    _auth: ApiKeyDep,
) -> BanCheckResponse:
    ban_db = _ban_db_or_503()
    tt = target_type.lower().strip()
    if tt not in ("user", "key"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "status": "error",
                "message": f"target_type must be 'user' or 'key', got {target_type!r}",
            },
        )

    ban = ban_db.is_banned(tt, target_name.strip())
    return BanCheckResponse(
        target_type=tt,
        target_name=target_name,
        banned=ban is not None,
        ban=_to_record(ban) if ban else None,
    )
