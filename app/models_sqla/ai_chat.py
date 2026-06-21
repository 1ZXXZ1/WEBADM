"""AI chat session + message history.

Mirrors ``ai_chat_sessions`` / ``ai_chat_messages`` in mgmt_db.py.
The legacy schema uses TEXT primary keys (UUID strings) — we keep that
for parity so the psycopg2 layer and the SQLAlchemy layer can read each
other's rows.
"""

from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
)

from app.models_sqla.base import Base


class AiChatSession(Base):
    """AI chat session metadata (one per user conversation)."""

    __tablename__ = "ai_chat_sessions"

    id = Column(Text, primary_key=True)  # UUID string
    title = Column(Text, nullable=False, default="New Chat")
    owner_id = Column(Text, nullable=False, index=True)
    owner_username = Column(Text, default="")
    model = Column(Text, default="")
    system_prompt = Column(Text, default="")
    context = Column(Text, default="{}")  # JSON object
    is_archived = Column(Boolean, default=False, nullable=False)
    created_at = Column(Text, nullable=True)
    updated_at = Column(Text, nullable=True)


class AiChatMessage(Base):
    """Individual chat message with cost/usage tracking."""

    __tablename__ = "ai_chat_messages"

    id = Column(Text, primary_key=True)  # UUID string
    chat_id = Column(
        Text,
        ForeignKey("ai_chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    role = Column(Text, nullable=False)  # system | user | assistant | tool
    content = Column(Text, default="")
    model_used = Column(Text, nullable=True)
    tokens_used = Column(Integer, nullable=True)
    cost_rub = Column(Float, nullable=True)
    usage_info = Column(Text, nullable=True)   # JSON
    tool_steps = Column(Text, nullable=True)   # JSON
    timestamp = Column(Text, nullable=False)


Index("idx_ai_chat_messages_chat", AiChatMessage.chat_id, AiChatMessage.timestamp)
Index("idx_ai_chat_messages_ts", AiChatMessage.timestamp)
