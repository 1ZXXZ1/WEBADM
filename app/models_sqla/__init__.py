"""
SQLAlchemy ORM models for WEBADC v3.0.

This package mirrors the legacy psycopg2 schema (mgmt_db / chat_db /
ban_db / chat_calls) so the two layers can coexist during migration.
All models share the same ``Base`` from ``app.db_sqlalchemy`` and the
same ``Base.metadata`` — calling ``Base.metadata.create_all(engine)``
creates every table in one shot.

Conventions:
  - All timestamps stored as ISO-8601 UTC strings (TEXT) for parity
    with the legacy schema. Use ``_now_iso()`` helpers.
  - JSON columns use ``JSON`` (works on SQLite, PostgreSQL, MySQL).
  - Boolean columns use ``Boolean`` (mapped to INTEGER 0/1 on SQLite).
  - Foreign keys keep the same ON DELETE behaviour as the legacy schema
    (CASCADE for ownership, SET NULL for optional refs).
"""

from __future__ import annotations

from app.models_sqla.base import Base, now_iso
from app.models_sqla.mgmt import (
    MgmtUser,
    MgmtApiKey,
    MgmtRole,
    MgmtAuditLog,
)
from app.models_sqla.ai_chat import (
    AiChatSession,
    AiChatMessage,
)
from app.models_sqla.ban import MgmtBan
from app.models_sqla.chat import (
    ChatRoom,
    ChatMember,
    ChatMessage,
    ChatAttachment,
    ChatReaction,
    ChatStar,
    ChatReadReceipt,
    ChatCallParticipant,
)
from app.models_sqla.chat_calls import ChatCall

__all__ = [
    "Base",
    "now_iso",
    # mgmt
    "MgmtUser",
    "MgmtApiKey",
    "MgmtRole",
    "MgmtAuditLog",
    # ai chat
    "AiChatSession",
    "AiChatMessage",
    # bans
    "MgmtBan",
    # chat
    "ChatRoom",
    "ChatMember",
    "ChatMessage",
    "ChatAttachment",
    "ChatReaction",
    "ChatStar",
    "ChatReadReceipt",
    "ChatCallParticipant",
    "ChatCall",
]
