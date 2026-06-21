"""Chat call records (audio/video via WebRTC).

Mirrors ``CALL_SCHEMA`` from ``app/chat_calls.py``.
"""

from __future__ import annotations

from sqlalchemy import (
    Column,
    Float,
    Index,
    Integer,
    Text,
)

from app.models_sqla.base import Base


class ChatCall(Base):
    """Call metadata: caller, callee, type, status, duration."""

    __tablename__ = "chat_calls"

    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(Integer, nullable=False)
    caller_id = Column(Integer, nullable=False)
    caller_username = Column(Text, default="")
    callee_id = Column(Integer, nullable=True)
    callee_username = Column(Text, default="")
    call_type = Column(Text, nullable=False, default="audio")  # audio | video
    status = Column(Text, nullable=False, default="ringing")  # ringing|accepted|rejected|ended|missed|cancelled
    started_at = Column(Text, nullable=True)
    ended_at = Column(Text, nullable=True)
    duration_sec = Column(Float, default=0)
    created_at = Column(Text, nullable=True)


Index("idx_chat_calls_room", ChatCall.room_id)
Index("idx_chat_calls_callee", ChatCall.callee_id)
Index("idx_chat_calls_status", ChatCall.status)
