"""initial schema — all tables from app.models_sqla

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-21 00:00:00.000000

This migration is a snapshot of Base.metadata at v3.0. It mirrors the
legacy psycopg2 schema (mgmt_db / chat_db / ban_db / chat_calls) so a
fresh SQLite DB is structurally identical to a fresh PostgreSQL DB.

If you already have a database created by ``init_db()`` (which calls
``Base.metadata.create_all``), you should ``alembic stamp head`` to
mark this migration as already-applied instead of running it.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── mgmt_users ─────────────────────────────────────────────────────
    op.create_table(
        "mgmt_users",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("username", sa.Text, nullable=False),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("full_name", sa.Text, server_default=""),
        sa.Column("email", sa.Text, server_default=""),
        sa.Column("role", sa.Text, nullable=False, server_default="operator"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("1")),
        sa.Column("weight", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_login_at", sa.Text, nullable=True),
        sa.Column("login_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("totp_secret", sa.Text, server_default="", nullable=False),
        sa.Column("created_at", sa.Text, nullable=True),
        sa.Column("updated_at", sa.Text, nullable=True),
        sa.UniqueConstraint("username", name="uq_mgmt_users_username"),
    )
    op.create_index("ix_mgmt_users_username", "mgmt_users", ["username"])
    op.create_index("ix_mgmt_users_role", "mgmt_users", ["role"])
    op.create_index("idx_mgmt_users_active", "mgmt_users", ["is_active"])

    # ── mgmt_api_keys ──────────────────────────────────────────────────
    op.create_table(
        "mgmt_api_keys",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("key_hash", sa.Text, nullable=False),
        sa.Column("key_prefix", sa.Text, nullable=False),
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("name", sa.Text, server_default=""),
        sa.Column("description", sa.Text, server_default=""),
        sa.Column("role", sa.Text, nullable=False, server_default="operator"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("1")),
        sa.Column("weight", sa.Integer, nullable=False, server_default="0"),
        sa.Column("expires_at", sa.Text, nullable=True),
        sa.Column("created_at", sa.Text, nullable=True),
        sa.Column("last_used_at", sa.Text, nullable=True),
    )
    op.create_index("ix_mgmt_api_keys_key_prefix", "mgmt_api_keys", ["key_prefix"])
    op.create_index("ix_mgmt_api_keys_user_id", "mgmt_api_keys", ["user_id"])

    # ── mgmt_roles ─────────────────────────────────────────────────────
    op.create_table(
        "mgmt_roles",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text, server_default=""),
        sa.Column("permissions", sa.Text, server_default="[]", nullable=False),
        sa.Column("is_builtin", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("1")),
        sa.Column("weight", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.Text, nullable=True),
        sa.Column("updated_at", sa.Text, nullable=True),
        sa.UniqueConstraint("name", name="uq_mgmt_roles_name"),
    )
    op.create_index("ix_mgmt_roles_is_active", "mgmt_roles", ["is_active"])

    # ── mgmt_audit_log ─────────────────────────────────────────────────
    op.create_table(
        "mgmt_audit_log",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer, nullable=True),
        sa.Column("api_key_id", sa.Integer, nullable=True),
        sa.Column("username", sa.Text, server_default=""),
        sa.Column("action", sa.Text, nullable=False),
        sa.Column("endpoint", sa.Text, server_default=""),
        sa.Column("method", sa.Text, server_default=""),
        sa.Column("status_code", sa.Integer, nullable=True),
        sa.Column("duration_ms", sa.Integer, nullable=True),
        sa.Column("ip_address", sa.Text, server_default=""),
        sa.Column("user_agent", sa.Text, server_default=""),
        sa.Column("request_body", sa.Text, server_default=""),
        sa.Column("auth_method", sa.Text, server_default=""),
        sa.Column("event_type", sa.Text, server_default=""),
        sa.Column("details", sa.Text, server_default=""),
        sa.Column("timestamp", sa.Text, nullable=True),
    )
    op.create_index("ix_mgmt_audit_log_user_id", "mgmt_audit_log", ["user_id"])
    op.create_index("ix_mgmt_audit_log_auth_method", "mgmt_audit_log", ["auth_method"])
    op.create_index("ix_mgmt_audit_log_timestamp", "mgmt_audit_log", ["timestamp"])
    op.create_index("idx_mgmt_audit_event", "mgmt_audit_log", ["event_type"])

    # ── ai_chat_sessions ───────────────────────────────────────────────
    op.create_table(
        "ai_chat_sessions",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("title", sa.Text, nullable=False, server_default="New Chat"),
        sa.Column("owner_id", sa.Text, nullable=False),
        sa.Column("owner_username", sa.Text, server_default=""),
        sa.Column("model", sa.Text, server_default=""),
        sa.Column("system_prompt", sa.Text, server_default=""),
        sa.Column("context", sa.Text, server_default="{}"),
        sa.Column("is_archived", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.Text, nullable=True),
        sa.Column("updated_at", sa.Text, nullable=True),
    )
    op.create_index("idx_ai_chat_sessions_owner", "ai_chat_sessions", ["owner_id"])

    # ── ai_chat_messages ───────────────────────────────────────────────
    op.create_table(
        "ai_chat_messages",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("chat_id", sa.Text, nullable=False),
        sa.Column("role", sa.Text, nullable=False),
        sa.Column("content", sa.Text, server_default=""),
        sa.Column("model_used", sa.Text, nullable=True),
        sa.Column("tokens_used", sa.Integer, nullable=True),
        sa.Column("cost_rub", sa.Float, nullable=True),
        sa.Column("usage_info", sa.Text, nullable=True),
        sa.Column("tool_steps", sa.Text, nullable=True),
        sa.Column("timestamp", sa.Text, nullable=False),
        sa.ForeignKeyConstraint(["chat_id"], ["ai_chat_sessions.id"], ondelete="CASCADE"),
    )
    op.create_index("idx_ai_chat_messages_chat", "ai_chat_messages", ["chat_id", "timestamp"])
    op.create_index("idx_ai_chat_messages_timestamp", "ai_chat_messages", ["timestamp"])

    # ── mgmt_bans ──────────────────────────────────────────────────────
    op.create_table(
        "mgmt_bans",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("target_type", sa.Text, nullable=False),
        sa.Column("target_name", sa.Text, nullable=False),
        sa.Column("target_id", sa.Integer, nullable=True),
        sa.Column("reason", sa.Text, server_default=""),
        sa.Column("banned_by", sa.Text, server_default=""),
        sa.Column("banned_by_ip", sa.Text, server_default=""),
        sa.Column("created_at", sa.Text, nullable=False),
        sa.Column("expires_at", sa.Text, nullable=True),
        sa.Column("lifted_at", sa.Text, nullable=True),
        sa.Column("lifted_by", sa.Text, nullable=True),
        sa.Column("lifted_reason", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("1")),
    )
    op.create_index("idx_mgmt_bans_target", "mgmt_bans", ["target_type", "target_name"])
    op.create_index("idx_mgmt_bans_active", "mgmt_bans", ["is_active", "expires_at"])
    op.create_index("idx_mgmt_bans_created", "mgmt_bans", ["created_at"])
    # Partial unique index — only enforced where is_active=TRUE.
    # SQLite + PostgreSQL syntax.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_mgmt_bans_active "
        "ON mgmt_bans (target_type, target_name) WHERE is_active = 1"
    )

    # ── chat_rooms ─────────────────────────────────────────────────────
    op.create_table(
        "chat_rooms",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("type", sa.Text, nullable=False, server_default="direct"),
        sa.Column("name", sa.Text, server_default=""),
        sa.Column("description", sa.Text, server_default=""),
        sa.Column("owner_id", sa.Integer, nullable=True),
        sa.Column("avatar_path", sa.Text, server_default=""),
        sa.Column("is_archived", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.Text, nullable=True),
        sa.Column("updated_at", sa.Text, nullable=True),
    )

    # ── chat_members ───────────────────────────────────────────────────
    op.create_table(
        "chat_members",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("room_id", sa.Integer, nullable=False),
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("username", sa.Text, server_default=""),
        sa.Column("role", sa.Text, server_default="member"),
        sa.Column("last_read_msg_id", sa.Integer, nullable=True),
        sa.Column("is_muted", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("joined_at", sa.Text, nullable=True),
        sa.ForeignKeyConstraint(["room_id"], ["chat_rooms.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("room_id", "user_id", name="uq_chat_members_room_user"),
    )
    op.create_index("idx_chat_members_room", "chat_members", ["room_id"])
    op.create_index("idx_chat_members_user", "chat_members", ["user_id"])

    # ── chat_messages ──────────────────────────────────────────────────
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("room_id", sa.Integer, nullable=False),
        sa.Column("sender_id", sa.Integer, nullable=False),
        sa.Column("sender_username", sa.Text, server_default=""),
        sa.Column("text", sa.Text, server_default=""),
        sa.Column("msg_type", sa.Text, server_default="text"),
        sa.Column("reply_to_id", sa.Integer, nullable=True),
        sa.Column("forwarded_from_msg_id", sa.Integer, nullable=True),
        sa.Column("forwarded_from_username", sa.Text, server_default=""),
        sa.Column("forwarded_from_room_id", sa.Integer, nullable=True),
        sa.Column("edited_at", sa.Text, nullable=True),
        sa.Column("deleted_at", sa.Text, nullable=True),
        sa.Column("is_pinned", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("scheduled_for", sa.Text, nullable=True),
        sa.Column("created_at", sa.Text, nullable=True),
        sa.ForeignKeyConstraint(["room_id"], ["chat_rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reply_to_id"], ["chat_messages.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_chat_messages_room", "chat_messages", ["room_id", "created_at"])
    op.create_index("idx_chat_messages_sender", "chat_messages", ["sender_id"])

    # ── chat_attachments ───────────────────────────────────────────────
    op.create_table(
        "chat_attachments",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("message_id", sa.Integer, nullable=False),
        sa.Column("filename", sa.Text, nullable=False),
        sa.Column("file_size", sa.BigInteger, server_default="0"),
        sa.Column("mime_type", sa.Text, server_default="application/octet-stream"),
        sa.Column("storage_path", sa.Text, nullable=False),
        sa.Column("is_voice", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("duration_sec", sa.Float, server_default="0"),
        sa.Column("thumbnail_path", sa.Text, server_default=""),
        sa.Column("created_at", sa.Text, nullable=True),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
    )
    op.create_index("idx_chat_attachments_msg", "chat_attachments", ["message_id"])

    # ── chat_reactions ─────────────────────────────────────────────────
    op.create_table(
        "chat_reactions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("message_id", sa.Integer, nullable=False),
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("username", sa.Text, server_default=""),
        sa.Column("emoji", sa.Text, nullable=False),
        sa.Column("created_at", sa.Text, nullable=True),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("message_id", "user_id", "emoji", name="uq_chat_reactions"),
    )
    op.create_index("idx_chat_reactions_msg", "chat_reactions", ["message_id"])

    # ── chat_stars ─────────────────────────────────────────────────────
    op.create_table(
        "chat_stars",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("message_id", sa.Integer, nullable=False),
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("created_at", sa.Text, nullable=True),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("message_id", "user_id", name="uq_chat_stars"),
    )
    op.create_index("idx_chat_stars_user", "chat_stars", ["user_id"])

    # ── chat_read_receipts ─────────────────────────────────────────────
    op.create_table(
        "chat_read_receipts",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("message_id", sa.Integer, nullable=False),
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("username", sa.Text, server_default=""),
        sa.Column("read_at", sa.Text, nullable=True),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("message_id", "user_id", name="uq_chat_read_receipts"),
    )
    op.create_index("idx_chat_read_msg", "chat_read_receipts", ["message_id"])

    # ── chat_call_participants ─────────────────────────────────────────
    op.create_table(
        "chat_call_participants",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("call_id", sa.Integer, nullable=False),
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("username", sa.Text, server_default=""),
        sa.Column("status", sa.Text, server_default="invited"),
        sa.Column("joined_at", sa.Text, nullable=True),
        sa.Column("left_at", sa.Text, nullable=True),
        sa.UniqueConstraint("call_id", "user_id", name="uq_chat_call_participants"),
    )
    op.create_index("idx_chat_calls_parts", "chat_call_participants", ["call_id"])

    # ── chat_calls ─────────────────────────────────────────────────────
    op.create_table(
        "chat_calls",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("room_id", sa.Integer, nullable=False),
        sa.Column("caller_id", sa.Integer, nullable=False),
        sa.Column("caller_username", sa.Text, server_default=""),
        sa.Column("callee_id", sa.Integer, nullable=True),
        sa.Column("callee_username", sa.Text, server_default=""),
        sa.Column("call_type", sa.Text, nullable=False, server_default="audio"),
        sa.Column("status", sa.Text, nullable=False, server_default="ringing"),
        sa.Column("started_at", sa.Text, nullable=True),
        sa.Column("ended_at", sa.Text, nullable=True),
        sa.Column("duration_sec", sa.Float, server_default="0"),
        sa.Column("created_at", sa.Text, nullable=True),
    )
    op.create_index("idx_chat_calls_room", "chat_calls", ["room_id"])
    op.create_index("idx_chat_calls_callee", "chat_calls", ["callee_id"])
    op.create_index("idx_chat_calls_status", "chat_calls", ["status"])


def downgrade() -> None:
    op.drop_table("chat_calls")
    op.drop_table("chat_call_participants")
    op.drop_table("chat_read_receipts")
    op.drop_table("chat_stars")
    op.drop_table("chat_reactions")
    op.drop_table("chat_attachments")
    op.drop_table("chat_messages")
    op.drop_table("chat_members")
    op.drop_table("chat_rooms")
    op.drop_table("mgmt_bans")
    op.drop_table("ai_chat_messages")
    op.drop_table("ai_chat_sessions")
    op.drop_table("mgmt_audit_log")
    op.drop_table("mgmt_roles")
    op.drop_table("mgmt_api_keys")
    op.drop_table("mgmt_users")
