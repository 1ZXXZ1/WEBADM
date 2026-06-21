"""Chat system: rooms, members, messages, attachments, reactions.

Mirrors ``CHAT_SCHEMA`` from ``app/chat_db.py``.
"""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)

from app.models_sqla.base import Base


class ChatRoom(Base):
    __tablename__ = "chat_rooms"

    id = Column(Integer, primary_key=True, autoincrement=True)
    type = Column(Text, nullable=False, default="direct")  # direct | group
    name = Column(Text, default="")
    description = Column(Text, default="")
    owner_id = Column(Integer, nullable=True)
    avatar_path = Column(Text, default="")
    is_archived = Column(Boolean, default=False, nullable=False)
    created_at = Column(Text, nullable=True)
    updated_at = Column(Text, nullable=True)


class ChatMember(Base):
    __tablename__ = "chat_members"

    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(
        Integer,
        ForeignKey("chat_rooms.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(Integer, nullable=False)
    username = Column(Text, default="")
    role = Column(Text, default="member")  # member | admin
    last_read_msg_id = Column(Integer, nullable=True)
    is_muted = Column(Boolean, default=False, nullable=False)
    joined_at = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("room_id", "user_id", name="uq_chat_members_room_user"),
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(
        Integer,
        ForeignKey("chat_rooms.id", ondelete="CASCADE"),
        nullable=False,
    )
    sender_id = Column(Integer, nullable=False)
    sender_username = Column(Text, default="")
    text = Column(Text, default="")
    msg_type = Column(Text, default="text")  # text|file|voice|image|video|system|call_log
    reply_to_id = Column(
        Integer,
        ForeignKey("chat_messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    forwarded_from_msg_id = Column(Integer, nullable=True)
    forwarded_from_username = Column(Text, default="")
    forwarded_from_room_id = Column(Integer, nullable=True)
    edited_at = Column(Text, nullable=True)
    deleted_at = Column(Text, nullable=True)
    is_pinned = Column(Boolean, default=False, nullable=False)
    scheduled_for = Column(Text, nullable=True)
    created_at = Column(Text, nullable=True)


class ChatAttachment(Base):
    __tablename__ = "chat_attachments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    message_id = Column(
        Integer,
        ForeignKey("chat_messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    filename = Column(Text, nullable=False)
    file_size = Column(BigInteger, default=0)
    mime_type = Column(Text, default="application/octet-stream")
    storage_path = Column(Text, nullable=False)
    is_voice = Column(Boolean, default=False, nullable=False)
    duration_sec = Column(Float, default=0)
    thumbnail_path = Column(Text, default="")
    created_at = Column(Text, nullable=True)


class ChatReaction(Base):
    """Emoji reaction on a message."""

    __tablename__ = "chat_reactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    message_id = Column(
        Integer,
        ForeignKey("chat_messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(Integer, nullable=False)
    username = Column(Text, default="")
    emoji = Column(Text, nullable=False)
    created_at = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("message_id", "user_id", "emoji", name="uq_chat_reactions"),
    )


class ChatStar(Base):
    """Starred/favorited message by a user."""

    __tablename__ = "chat_stars"

    id = Column(Integer, primary_key=True, autoincrement=True)
    message_id = Column(
        Integer,
        ForeignKey("chat_messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(Integer, nullable=False)
    created_at = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_chat_stars"),
    )


class ChatReadReceipt(Base):
    """Who read each message (per-user tracking)."""

    __tablename__ = "chat_read_receipts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    message_id = Column(
        Integer,
        ForeignKey("chat_messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(Integer, nullable=False)
    username = Column(Text, default="")
    read_at = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_chat_read_receipts"),
    )


class ChatCallParticipant(Base):
    """Call participants (for multi-callee / group calls)."""

    __tablename__ = "chat_call_participants"

    id = Column(Integer, primary_key=True, autoincrement=True)
    call_id = Column(Integer, nullable=False)
    user_id = Column(Integer, nullable=False)
    username = Column(Text, default="")
    status = Column(Text, default="invited")  # invited|joined|left|declined
    joined_at = Column(Text, nullable=True)
    left_at = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("call_id", "user_id", name="uq_chat_call_participants"),
    )


# Composite indices (mirror legacy schema)
Index("idx_chat_members_room", ChatMember.room_id)
Index("idx_chat_members_user", ChatMember.user_id)
Index("idx_chat_messages_room", ChatMessage.room_id, ChatMessage.created_at)
Index("idx_chat_messages_sender", ChatMessage.sender_id)
Index("idx_chat_attachments_msg", ChatAttachment.message_id)
Index("idx_chat_reactions_msg", ChatReaction.message_id)
Index("idx_chat_stars_user", ChatStar.user_id)
Index("idx_chat_read_msg", ChatReadReceipt.message_id)
Index("idx_chat_calls_parts", ChatCallParticipant.call_id)
