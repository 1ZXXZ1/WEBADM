"""
Chat REST router — user-to-user messaging API.

v2.4: Full-featured chat with:
  - Direct & group chats
  - Text messages with reply
  - File attachments (≤50 MB)
  - Voice messages
  - Message search
  - Member management
  - Read receipts
  - Message edit/delete

Real-time delivery via WebSocket at /ws/chat/{room_id} (see chat_ws.py).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request, UploadFile, File, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.auth import ApiKeyDep
from app.models.common import ErrorResponse

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/chat",
    tags=["Chat"],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    },
)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


# ── Helpers ────────────────────────────────────────────────────────────

def _current_user(request: Request) -> Dict[str, Any]:
    """Extract user_id + username from request state."""
    auth_method = getattr(request.state, "auth_method", None)
    if auth_method == "jwt":
        payload = getattr(request.state, "user", {}) or {}
        username = payload.get("sub") or payload.get("username") or ""
        user_id = None
        if username:
            try:
                from app.api_ma import get_user_by_username
                u = get_user_by_username(username)
                if u:
                    user_id = u["id"]
            except Exception:
                pass
        if not user_id:
            raise HTTPException(status_code=401, detail="Cannot resolve user_id from JWT")
        return {"user_id": user_id, "username": username}
    elif auth_method in ("api_key", "static_api_key"):
        key_info = getattr(request.state, "api_key_info", {}) or {}
        user_id = key_info.get("user_id")
        username = key_info.get("username", "(static-admin)")
        if not user_id:
            raise HTTPException(
                status_code=400,
                detail="Chat features require a DB-backed API key or JWT. "
                       "Static API key has no user account.",
            )
        return {"user_id": user_id, "username": username}
    raise HTTPException(status_code=401, detail="Not authenticated")


def _check_member(room_id: int, user_id: int) -> None:
    """Verify the user is a member of the room. Raises 403 if not."""
    from app.chat_db import is_member
    if not is_member(room_id, user_id):
        raise HTTPException(
            status_code=403,
            detail=f"You are not a member of chat room #{room_id}",
        )


# ── Pydantic models ────────────────────────────────────────────────────

class RoomCreateRequest(BaseModel):
    type: str = Field(default="direct", description="'direct' or 'group'")
    name: str = Field(default="", description="Room name (required for groups)")
    description: str = Field(default="")
    member_ids: List[int] = Field(..., description="User IDs to add (including yourself)")


class RoomUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_archived: Optional[bool] = None


class MessageSendRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)
    reply_to_id: Optional[int] = Field(default=None, description="Message ID being replied to")


class MessageEditRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)


class MemberAddRequest(BaseModel):
    user_id: int
    role: str = Field(default="member", description="'admin' or 'member'")


# ── Room endpoints ─────────────────────────────────────────────────────

@router.get("/rooms", summary="List my chat rooms")
async def list_rooms(
    request: Request,
    _: ApiKeyDep,
    include_archived: bool = Query(default=False),
) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import list_rooms as _list
    rooms = _list(user["user_id"], include_archived=include_archived)
    return {"status": "ok", "data": rooms, "count": len(rooms)}


@router.post("/rooms", summary="Create a chat room", status_code=status.HTTP_201_CREATED)
async def create_room(
    body: RoomCreateRequest,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import create_room as _create
    # Ensure the creator is in member_ids
    if user["user_id"] not in body.member_ids:
        body.member_ids.append(user["user_id"])
    result = _create(
        room_type=body.type, name=body.name, description=body.description,
        owner_id=user["user_id"], member_ids=body.member_ids,
    )
    return {"status": "ok", "data": result}


@router.get("/rooms/{room_id}", summary="Get chat room details")
async def get_room(
    room_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    user = _current_user(request)
    _check_member(room_id, user["user_id"])
    from app.chat_db import get_room as _get
    result = _get(room_id)
    if not result:
        raise HTTPException(status_code=404, detail="Chat room not found")
    return {"status": "ok", "data": result}


@router.put("/rooms/{room_id}", summary="Update chat room")
async def update_room(
    room_id: int,
    body: RoomUpdateRequest,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    user = _current_user(request)
    _check_member(room_id, user["user_id"])
    from app.chat_db import update_room as _update
    kwargs = {k: v for k, v in body.dict().items() if v is not None}
    result = _update(room_id, **kwargs)
    if not result:
        raise HTTPException(status_code=404, detail="Chat room not found")
    return {"status": "ok", "data": result}


@router.delete("/rooms/{room_id}", summary="Delete chat room (owner only)")
async def delete_room(
    room_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    user = _current_user(request)
    _check_member(room_id, user["user_id"])
    from app.chat_db import get_room, delete_room as _delete
    room = get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Chat room not found")
    if room.get("owner_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the room owner can delete it")
    _delete(room_id)
    return {"status": "ok", "message": f"Chat room #{room_id} deleted"}


# ── Member endpoints ───────────────────────────────────────────────────

@router.get("/rooms/{room_id}/members", summary="List room members")
async def list_members(
    room_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    user = _current_user(request)
    _check_member(room_id, user["user_id"])
    from app.chat_db import list_members as _list
    members = _list(room_id)
    return {"status": "ok", "data": members}


@router.post("/rooms/{room_id}/members", summary="Add member to room")
async def add_member(
    room_id: int,
    body: MemberAddRequest,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    user = _current_user(request)
    _check_member(room_id, user["user_id"])
    from app.chat_db import add_member as _add
    try:
        result = _add(room_id, body.user_id, body.role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "ok", "data": result}


@router.delete("/rooms/{room_id}/members/{user_id}", summary="Remove member from room")
async def remove_member(
    room_id: int,
    user_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    current = _current_user(request)
    _check_member(room_id, current["user_id"])
    from app.chat_db import remove_member as _remove
    if not _remove(room_id, user_id):
        raise HTTPException(status_code=404, detail="Member not found")
    return {"status": "ok", "message": f"User #{user_id} removed from room #{room_id}"}


@router.post("/rooms/{room_id}/read", summary="Mark messages as read")
async def mark_read(
    room_id: int,
    request: Request,
    _: ApiKeyDep,
    message_id: int = Query(..., description="Last read message ID"),
) -> Dict[str, Any]:
    user = _current_user(request)
    _check_member(room_id, user["user_id"])
    from app.chat_db import mark_read as _mark
    _mark(room_id, user["user_id"], message_id)
    return {"status": "ok", "message": "Marked as read"}


# ── Message endpoints ──────────────────────────────────────────────────

@router.get("/rooms/{room_id}/messages", summary="List messages in room")
async def list_messages(
    room_id: int,
    request: Request,
    _: ApiKeyDep,
    before_id: Optional[int] = Query(default=None, description="Pagination: messages before this ID"),
    limit: int = Query(default=50, ge=1, le=200),
) -> Dict[str, Any]:
    user = _current_user(request)
    _check_member(room_id, user["user_id"])
    from app.chat_db import list_messages as _list
    msgs = _list(room_id, offset=0, limit=limit, before_id=before_id)
    return {"status": "ok", "data": msgs, "count": len(msgs)}


@router.post("/rooms/{room_id}/messages", summary="Send a text message")
async def send_message(
    room_id: int,
    body: MessageSendRequest,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    user = _current_user(request)
    _check_member(room_id, user["user_id"])
    from app.chat_db import send_message as _send
    msg = _send(room_id, user["user_id"], user["username"],
                text=body.text, reply_to_id=body.reply_to_id)

    # Broadcast via WebSocket
    try:
        from app.routers.chat_ws import broadcast_to_room
        broadcast_to_room(room_id, {
            "type": "message", "data": msg,
        })
    except Exception:
        pass

    return {"status": "ok", "data": msg}


@router.put("/messages/{msg_id}", summary="Edit a message")
async def edit_message(
    msg_id: int,
    body: MessageEditRequest,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import get_message, edit_message as _edit
    msg = get_message(msg_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg["sender_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only edit your own messages")
    result = _edit(msg_id, body.text)
    if not result:
        raise HTTPException(status_code=404, detail="Message not found or deleted")

    # Broadcast edit via WS
    try:
        from app.routers.chat_ws import broadcast_to_room
        broadcast_to_room(msg["room_id"], {"type": "message_edited", "data": result})
    except Exception:
        pass

    return {"status": "ok", "data": result}


@router.delete("/messages/{msg_id}", summary="Delete a message (soft)")
async def delete_message(
    msg_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import get_message, delete_message as _delete
    msg = get_message(msg_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg["sender_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only delete your own messages")
    _delete(msg_id)

    # Broadcast deletion via WS
    try:
        from app.routers.chat_ws import broadcast_to_room
        broadcast_to_room(msg["room_id"], {"type": "message_deleted", "data": {"id": msg_id}})
    except Exception:
        pass

    return {"status": "ok", "message": f"Message #{msg_id} deleted"}


# ── File attachments ───────────────────────────────────────────────────

@router.post("/rooms/{room_id}/files", summary="Upload a file and send as message")
async def upload_file(
    room_id: int,
    request: Request,
    _: ApiKeyDep,
    file: UploadFile = File(...),
    text: str = "",
) -> Dict[str, Any]:
    user = _current_user(request)
    _check_member(room_id, user["user_id"])

    # Read file data with size limit
    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_FILE_SIZE} bytes)")

    from app.chat_db import send_message, save_attachment
    # Create the message first
    msg = send_message(room_id, user["user_id"], user["username"], text=text or f"📎 {file.filename}")
    # Save attachment
    att = save_attachment(
        message_id=msg["id"], filename=file.filename or "file",
        data=data, mime_type=file.content_type or "application/octet-stream",
    )

    # Broadcast via WS
    try:
        from app.routers.chat_ws import broadcast_to_room
        from app.chat_db import get_message
        full_msg = get_message(msg["id"])
        if full_msg:
            full_msg["attachments"] = [att]
        broadcast_to_room(room_id, {"type": "message", "data": full_msg or msg})
    except Exception:
        pass

    return {"status": "ok", "data": {"message": msg, "attachment": att}}


@router.post("/rooms/{room_id}/voice", summary="Upload a voice message")
async def upload_voice(
    room_id: int,
    request: Request,
    _: ApiKeyDep,
    file: UploadFile = File(...),
    duration_sec: float = Query(default=0, description="Voice duration in seconds"),
    text: str = "",
) -> Dict[str, Any]:
    user = _current_user(request)
    _check_member(room_id, user["user_id"])

    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_FILE_SIZE} bytes)")

    from app.chat_db import send_message, save_attachment
    msg = send_message(room_id, user["user_id"], user["username"], text=text or "🎤 Voice message")
    att = save_attachment(
        message_id=msg["id"], filename=file.filename or "voice.webm",
        data=data, mime_type=file.content_type or "audio/webm",
        is_voice=True, duration_sec=duration_sec,
    )

    try:
        from app.routers.chat_ws import broadcast_to_room
        from app.chat_db import get_message
        full_msg = get_message(msg["id"])
        if full_msg:
            full_msg["attachments"] = [att]
        broadcast_to_room(room_id, {"type": "message", "data": full_msg or msg})
    except Exception:
        pass

    return {"status": "ok", "data": {"message": msg, "attachment": att}}


@router.get("/attachments/{att_id}", summary="Download a file attachment")
async def download_attachment(
    att_id: int,
    request: Request,
    _: ApiKeyDep,
):
    from app.chat_db import get_attachment
    att = get_attachment(att_id)
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    # Verify the user has access to the message's room
    from app.chat_db import get_message, is_member
    msg = get_message(att["message_id"])
    if msg:
        user = _current_user(request)
        _check_member(msg["room_id"], user["user_id"])

    import os
    if not os.path.isfile(att["storage_path"]):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=att["storage_path"],
        filename=att["filename"],
        media_type=att["mime_type"],
    )


# ── Search ─────────────────────────────────────────────────────────────

@router.get("/search", summary="Search messages across all my chats")
async def search_messages(
    request: Request,
    _: ApiKeyDep,
    q: str = Query(..., min_length=1, max_length=200, description="Search query"),
    limit: int = Query(default=50, ge=1, le=200),
) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import search_messages as _search
    results = _search(user["user_id"], q, limit=limit)
    return {"status": "ok", "data": results, "count": len(results)}


# ── Voice / Video Calls (v2.5) ─────────────────────────────────────────
# WebRTC-based calls with server-side signaling via WebSocket.
# The REST API manages call lifecycle; the actual media (audio/video)
# flows P2P between browsers via WebRTC. The WebSocket /ws/chat/{room_id}
# handles offer/answer/ICE exchange.

class CallInitiateRequest(BaseModel):
    callee_id: Optional[int] = Field(default=None, description="Target user (None = group call)")
    call_type: str = Field(default="audio", description="'audio' or 'video'")


@router.post("/rooms/{room_id}/calls", summary="Initiate a call", status_code=status.HTTP_201_CREATED)
async def initiate_call(
    room_id: int,
    body: CallInitiateRequest,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Initiate a voice or video call.

    Creates a call record with status='ringing' and broadcasts a
    ``call.incoming`` event via WebSocket to the room. The callee(s)
    respond via ``POST /calls/{call_id}/accept`` or ``/reject``.

    The actual WebRTC offer/answer/ICE exchange happens over the
    WebSocket connection — the server is just a signaling relay.
    """
    user = _current_user(request)
    _check_member(room_id, user["user_id"])

    # Resolve callee username if specified
    callee_username = ""
    if body.callee_id:
        try:
            from app.api_ma import get_user
            callee = get_user(body.callee_id)
            if callee:
                callee_username = callee.get("username", "")
        except Exception:
            pass

    from app.chat_calls import initiate_call as _init
    call = _init(
        room_id=room_id, caller_id=user["user_id"], caller_username=user["username"],
        callee_id=body.callee_id, callee_username=callee_username,
        call_type=body.call_type,
    )

    # Broadcast incoming call via WS
    try:
        from app.routers.chat_ws import broadcast_to_room
        broadcast_to_room(room_id, {
            "type": "call.incoming",
            "data": call,
        })
    except Exception:
        pass

    return {"status": "ok", "data": call}


@router.post("/calls/{call_id}/accept", summary="Accept a call")
async def accept_call(
    call_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Accept an incoming call. Sets status to 'accepted' and notifies the room."""
    user = _current_user(request)
    from app.chat_calls import get_call, update_call_status
    call = get_call(call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    if call["status"] != "ringing":
        raise HTTPException(status_code=400, detail=f"Call is not ringing (status: {call['status']})")
    _check_member(call["room_id"], user["user_id"])

    result = update_call_status(call_id, "accepted")

    # Broadcast acceptance via WS
    try:
        from app.routers.chat_ws import broadcast_to_room
        broadcast_to_room(call["room_id"], {
            "type": "call.accepted",
            "data": result,
        })
    except Exception:
        pass

    return {"status": "ok", "data": result}


@router.post("/calls/{call_id}/reject", summary="Reject a call")
async def reject_call(
    call_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Reject an incoming call."""
    user = _current_user(request)
    from app.chat_calls import get_call, update_call_status
    call = get_call(call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    _check_member(call["room_id"], user["user_id"])

    result = update_call_status(call_id, "rejected")

    try:
        from app.routers.chat_ws import broadcast_to_room
        broadcast_to_room(call["room_id"], {
            "type": "call.rejected",
            "data": result,
        })
    except Exception:
        pass

    return {"status": "ok", "data": result}


@router.post("/calls/{call_id}/end", summary="End a call")
async def end_call(
    call_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """End an active call. Computes duration and notifies the room."""
    user = _current_user(request)
    from app.chat_calls import get_call, update_call_status
    call = get_call(call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    _check_member(call["room_id"], user["user_id"])

    result = update_call_status(call_id, "ended")

    try:
        from app.routers.chat_ws import broadcast_to_room
        broadcast_to_room(call["room_id"], {
            "type": "call.ended",
            "data": result,
        })
    except Exception:
        pass

    return {"status": "ok", "data": result}


@router.post("/calls/{call_id}/cancel", summary="Cancel a ringing call")
async def cancel_call(
    call_id: int,
    request: Request,
    _: ApiKeyDep,
) -> Dict[str, Any]:
    """Cancel a call that's still ringing (caller side)."""
    user = _current_user(request)
    from app.chat_calls import get_call, update_call_status
    call = get_call(call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    if call["caller_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the caller can cancel")
    if call["status"] not in ("ringing",):
        raise HTTPException(status_code=400, detail=f"Can only cancel ringing calls (status: {call['status']})")

    result = update_call_status(call_id, "cancelled")

    try:
        from app.routers.chat_ws import broadcast_to_room
        broadcast_to_room(call["room_id"], {
            "type": "call.cancelled",
            "data": result,
        })
    except Exception:
        pass

    return {"status": "ok", "data": result}


@router.get("/rooms/{room_id}/calls", summary="List calls in a room")
async def list_calls(
    room_id: int,
    request: Request,
    _: ApiKeyDep,
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> Dict[str, Any]:
    """List call history for a room."""
    user = _current_user(request)
    _check_member(room_id, user["user_id"])
    from app.chat_calls import list_calls as _list
    calls = _list(room_id=room_id, status=status, limit=limit)
    return {"status": "ok", "data": calls, "count": len(calls)}


@router.get("/calls", summary="List my calls (all rooms)")
async def list_my_calls(
    request: Request,
    _: ApiKeyDep,
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> Dict[str, Any]:
    """List all calls where I'm the caller or callee."""
    user = _current_user(request)
    from app.chat_calls import list_calls as _list
    calls = _list(user_id=user["user_id"], status=status, limit=limit)
    return {"status": "ok", "data": calls, "count": len(calls)}


# ═══════════════════════════════════════════════════════════════════════
#  v2.6: Reactions, Stars, Pin, Forward, Read-by, Mute, Schedule, Stats
# ═══════════════════════════════════════════════════════════════════════

class ReactionRequest(BaseModel):
    emoji: str = Field(..., max_length=10, description="Emoji character")


class ForwardRequest(BaseModel):
    target_room_id: int = Field(..., description="Room to forward to")


class ScheduleRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)
    scheduled_for: str = Field(..., description="ISO 8601 timestamp when to send")
    reply_to_id: Optional[int] = None


# ── Reactions ──────────────────────────────────────────────────────────

@router.post("/messages/{msg_id}/reactions", summary="Toggle emoji reaction")
async def toggle_reaction(
    msg_id: int, body: ReactionRequest, request: Request, _: ApiKeyDep,
) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import add_reaction, get_message
    msg = get_message(msg_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    _check_member(msg["room_id"], user["user_id"])
    result = add_reaction(msg_id, user["user_id"], user["username"], body.emoji)
    try:
        from app.routers.chat_ws import broadcast_to_room
        broadcast_to_room(msg["room_id"], {"type": "reaction", "data": result})
    except Exception:
        pass
    return {"status": "ok", "data": result}


@router.get("/messages/{msg_id}/reactions", summary="List reactions on a message")
async def list_reactions(msg_id: int, request: Request, _: ApiKeyDep) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import get_message, list_reactions as _list
    msg = get_message(msg_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    _check_member(msg["room_id"], user["user_id"])
    return {"status": "ok", "data": _list(msg_id)}


# ── Stars / Favorites ──────────────────────────────────────────────────

@router.post("/messages/{msg_id}/star", summary="Star/unstar a message")
async def toggle_star(msg_id: int, request: Request, _: ApiKeyDep) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import toggle_star as _star
    result = _star(msg_id, user["user_id"])
    return {"status": "ok", "data": result}


@router.get("/stars", summary="List my starred messages")
async def list_starred(request: Request, _: ApiKeyDep,
                       limit: int = Query(default=50, ge=1, le=200)) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import list_starred as _list
    return {"status": "ok", "data": _list(user["user_id"], limit), "count": len(_list(user["user_id"], limit))}


# ── Pin ────────────────────────────────────────────────────────────────

@router.post("/messages/{msg_id}/pin", summary="Pin a message")
async def pin_message(msg_id: int, request: Request, _: ApiKeyDep,
                      pinned: bool = Query(default=True)) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import get_message, pin_message as _pin
    msg = get_message(msg_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    _check_member(msg["room_id"], user["user_id"])
    result = _pin(msg_id, pinned)
    try:
        from app.routers.chat_ws import broadcast_to_room
        broadcast_to_room(msg["room_id"], {"type": "message_pinned", "data": result})
    except Exception:
        pass
    return {"status": "ok", "data": result}


@router.get("/rooms/{room_id}/pinned", summary="List pinned messages")
async def list_pinned(room_id: int, request: Request, _: ApiKeyDep) -> Dict[str, Any]:
    user = _current_user(request)
    _check_member(room_id, user["user_id"])
    from app.chat_db import get_pinned_messages
    return {"status": "ok", "data": get_pinned_messages(room_id)}


# ── Forward ────────────────────────────────────────────────────────────

@router.post("/messages/{msg_id}/forward", summary="Forward a message to another room")
async def forward_message(msg_id: int, body: ForwardRequest, request: Request, _: ApiKeyDep) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import forward_message as _fwd, get_message
    original = get_message(msg_id)
    if not original:
        raise HTTPException(status_code=404, detail="Message not found")
    _check_member(original["room_id"], user["user_id"])
    _check_member(body.target_room_id, user["user_id"])
    result = _fwd(msg_id, body.target_room_id, user["user_id"], user["username"])
    if not result:
        raise HTTPException(status_code=500, detail="Forward failed")
    try:
        from app.routers.chat_ws import broadcast_to_room
        broadcast_to_room(body.target_room_id, {"type": "message", "data": result})
    except Exception:
        pass
    return {"status": "ok", "data": result}


# ── Read-by ────────────────────────────────────────────────────────────

@router.get("/messages/{msg_id}/read-by", summary="Who read this message")
async def get_read_by(msg_id: int, request: Request, _: ApiKeyDep) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import get_message, get_read_by as _get
    msg = get_message(msg_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    _check_member(msg["room_id"], user["user_id"])
    return {"status": "ok", "data": _get(msg_id)}


# ── Mute ───────────────────────────────────────────────────────────────

@router.post("/rooms/{room_id}/mute", summary="Mute/unmute room notifications")
async def set_mute(room_id: int, request: Request, _: ApiKeyDep,
                   muted: bool = Query(default=True)) -> Dict[str, Any]:
    user = _current_user(request)
    _check_member(room_id, user["user_id"])
    from app.chat_db import set_mute as _mute
    _mute(room_id, user["user_id"], muted)
    return {"status": "ok", "data": {"room_id": room_id, "muted": muted}}


# ── Unread counts ──────────────────────────────────────────────────────

@router.get("/unread", summary="Unread message counts for all my rooms")
async def get_unread(request: Request, _: ApiKeyDep) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import get_unread_counts
    counts = get_unread_counts(user["user_id"])
    return {"status": "ok", "data": counts, "total_unread": sum(counts.values())}


# ── Scheduled messages ─────────────────────────────────────────────────

@router.post("/rooms/{room_id}/schedule", summary="Schedule a message")
async def schedule_message(room_id: int, body: ScheduleRequest, request: Request, _: ApiKeyDep) -> Dict[str, Any]:
    user = _current_user(request)
    _check_member(room_id, user["user_id"])
    from app.chat_db import schedule_message as _sched
    result = _sched(room_id, user["user_id"], user["username"],
                    body.text, body.scheduled_for, body.reply_to_id)
    return {"status": "ok", "data": result}


@router.get("/scheduled", summary="List my pending scheduled messages")
async def list_scheduled(request: Request, _: ApiKeyDep) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import get_scheduled_messages
    return {"status": "ok", "data": get_scheduled_messages(user["user_id"])}


@router.delete("/scheduled/{msg_id}", summary="Delete a scheduled message")
async def delete_scheduled(msg_id: int, request: Request, _: ApiKeyDep) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import delete_scheduled_message
    if not delete_scheduled_message(msg_id, user["user_id"]):
        raise HTTPException(status_code=404, detail="Scheduled message not found")
    return {"status": "ok", "message": f"Scheduled message #{msg_id} deleted"}


# ── Chat statistics ────────────────────────────────────────────────────

@router.get("/stats", summary="Chat statistics (admin)")
async def chat_stats(request: Request, _: ApiKeyDep) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import get_chat_stats
    return {"status": "ok", "data": get_chat_stats()}


# ── File cleanup (admin) ───────────────────────────────────────────────

@router.post("/cleanup", summary="Clean up files from deleted messages (admin)")
async def cleanup_files(request: Request, _: ApiKeyDep) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import cleanup_deleted_files
    removed = cleanup_deleted_files()
    return {"status": "ok", "data": {"files_removed": removed}}


# ── Message retention (admin) ──────────────────────────────────────────

@router.post("/retention", summary="Delete messages older than N days (admin)")
async def retention_cleanup(request: Request, _: ApiKeyDep,
                            days: int = Query(default=90, ge=1, le=3650)) -> Dict[str, Any]:
    user = _current_user(request)
    from app.chat_db import retention_delete_old
    count = retention_delete_old(days)
    return {"status": "ok", "data": {"messages_deleted": count, "older_than_days": days}}
