"""
Webhooks REST router — registration and management of webhook endpoints.

POST   /api/v1/webhooks               — register a new webhook
GET    /api/v1/webhooks               — list all webhooks
GET    /api/v1/webhooks/{id}          — get webhook details
PUT    /api/v1/webhooks/{id}          — update webhook
DELETE /api/v1/webhooks/{id}          — delete webhook
POST   /api/v1/webhooks/{id}/test     — send a test event
GET    /api/v1/webhooks/events        — list supported event types
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.auth import ApiKeyDep
from app.models.common import ErrorResponse

router = APIRouter(
    prefix="/api/v1/webhooks",
    tags=["Webhooks"],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    },
)


# ── Pydantic models ────────────────────────────────────────────────────

class WebhookCreateRequest(BaseModel):
    url: str = Field(..., description="HTTPS URL to receive POST notifications")
    events: List[str] = Field(..., description="Event types to subscribe to (e.g. ['user.created', 'ban.*'])")
    secret: Optional[str] = Field(default="", description="HMAC-SHA256 signing secret (recommended)")
    description: Optional[str] = Field(default="", description="Human-readable description")


class WebhookUpdateRequest(BaseModel):
    url: Optional[str] = None
    events: Optional[List[str]] = None
    secret: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


# ── Supported event types ──────────────────────────────────────────────

SUPPORTED_EVENTS: List[str] = [
    "user.created", "user.updated", "user.deleted", "user.disabled",
    "user.enabled", "user.password_reset",
    "key.created", "key.rotated", "key.disabled", "key.deleted",
    "role.created", "role.updated", "role.deleted",
    "role.disabled", "role.enabled",
    "ban.created", "ban.lifted",
    "auth.login_success", "auth.login_failure",
    "cfg.updated", "cfg.deleted",
    "backup.created", "backup.restored",
    # Wildcards
    "user.*", "key.*", "role.*", "ban.*", "auth.*", "cfg.*", "backup.*",
    "*",
]


# ── Endpoints ──────────────────────────────────────────────────────────

@router.get("", summary="List webhooks")
async def list_webhooks(
    _: ApiKeyDep,
    include_inactive: bool = Query(default=False, description="Include inactive webhooks"),
) -> Dict[str, Any]:
    from app.webhooks import list_webhooks as _list
    return {"status": "ok", "data": _list(include_inactive=include_inactive)}


@router.post("", summary="Register webhook", status_code=status.HTTP_201_CREATED)
async def create_webhook(
    body: WebhookCreateRequest,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    from app.webhooks import create_webhook as _create
    try:
        result = _create(url=body.url, events=body.events,
                         secret=body.secret or "", description=body.description or "")
        return {"status": "ok", "data": result}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/events", summary="List supported event types")
async def list_events(_: ApiKeyDep) -> Dict[str, Any]:
    return {"status": "ok", "data": SUPPORTED_EVENTS}


@router.get("/{wh_id}", summary="Get webhook details")
async def get_webhook(
    wh_id: int,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    from app.webhooks import get_webhook as _get
    result = _get(wh_id)
    if not result:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"status": "ok", "data": result}


@router.put("/{wh_id}", summary="Update webhook")
async def update_webhook(
    wh_id: int,
    body: WebhookUpdateRequest,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    from app.webhooks import update_webhook as _update
    kwargs = {k: v for k, v in body.dict().items() if v is not None}
    if not kwargs:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = _update(wh_id, **kwargs)
    if not result:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"status": "ok", "data": result}


@router.delete("/{wh_id}", summary="Delete webhook")
async def delete_webhook(
    wh_id: int,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    from app.webhooks import delete_webhook as _delete
    if not _delete(wh_id):
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"status": "ok", "message": f"Webhook {wh_id} deleted"}


@router.post("/{wh_id}/test", summary="Send a test event to webhook")
async def test_webhook(
    wh_id: int,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    from app.webhooks import dispatch_event, get_webhook
    wh = get_webhook(wh_id)
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook not found")
    dispatch_event("test.ping", {
        "message": "Test event from /api/v1/webhooks/{}/test".format(wh_id),
        "webhook_url": wh["url"],
    })
    return {"status": "ok", "message": "Test event queued for delivery"}
