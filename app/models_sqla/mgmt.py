"""Management tables: users, API keys, roles, audit log.

Mirrors ``mgmt_db._SCHEMA`` (PostgreSQL DDL) but written as SQLAlchemy
declarative models so the same code runs on SQLite, PostgreSQL, MySQL.
"""

from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    Index,
    Integer,
    String,
    Text,
)

from app.models_sqla.base import Base


class MgmtUser(Base):
    """API user account with bcrypt-hashed password.

    Legacy table: ``mgmt_users``.
    """

    __tablename__ = "mgmt_users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(Text, nullable=False, unique=True, index=True)
    password_hash = Column(Text, nullable=False)
    full_name = Column(Text, default="")
    email = Column(Text, default="")
    role = Column(Text, nullable=False, default="operator", index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    weight = Column(Integer, default=0, nullable=False)
    last_login_at = Column(Text, nullable=True)
    login_count = Column(Integer, default=0, nullable=False)
    totp_secret = Column(Text, default="", nullable=False)
    created_at = Column(Text, nullable=True)
    updated_at = Column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"<MgmtUser id={self.id} username={self.username!r} role={self.role!r}>"


class MgmtApiKey(Base):
    """Long-lived bearer token tied to a user.

    Legacy table: ``mgmt_api_keys``.
    """

    __tablename__ = "mgmt_api_keys"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key_hash = Column(Text, nullable=False)
    key_prefix = Column(Text, nullable=False, index=True)
    user_id = Column(
        Integer,
        nullable=False,
        index=True,
    )
    name = Column(Text, default="")
    description = Column(Text, default="")
    role = Column(Text, nullable=False, default="operator")
    is_active = Column(Boolean, default=True, nullable=False)
    weight = Column(Integer, default=0, nullable=False)
    expires_at = Column(Text, nullable=True)
    created_at = Column(Text, nullable=True)
    last_used_at = Column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"<MgmtApiKey id={self.id} prefix={self.key_prefix!r} user_id={self.user_id}>"


class MgmtRole(Base):
    """Named role with assigned permission set (JSON array of strings).

    Legacy table: ``mgmt_roles``.
    """

    __tablename__ = "mgmt_roles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False, unique=True)
    description = Column(Text, default="")
    permissions = Column(Text, default="[]", nullable=False)  # JSON-encoded list
    is_builtin = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    weight = Column(Integer, default=0, nullable=False)
    created_at = Column(Text, nullable=True)
    updated_at = Column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"<MgmtRole id={self.id} name={self.name!r}>"


class MgmtAuditLog(Base):
    """Tamper-append log of every authenticated action.

    Legacy table: ``mgmt_audit_log``. v2.3.2 added rich HTTP context
    columns (method, status_code, duration_ms, user_agent, etc.).
    """

    __tablename__ = "mgmt_audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=True, index=True)
    api_key_id = Column(Integer, nullable=True)
    username = Column(Text, default="")
    action = Column(Text, nullable=False)
    endpoint = Column(Text, default="")
    method = Column(Text, default="")
    status_code = Column(Integer, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    ip_address = Column(Text, default="")
    user_agent = Column(Text, default="")
    request_body = Column(Text, default="")
    auth_method = Column(Text, default="", index=True)
    event_type = Column(Text, default="", index=True)
    details = Column(Text, default="")
    timestamp = Column(Text, nullable=True, index=True)

    def __repr__(self) -> str:
        return (
            f"<MgmtAuditLog id={self.id} action={self.action!r} "
            f"user={self.username!r} ts={self.timestamp!r}>"
        )


# Composite indices that don't fit on a single column
Index("idx_mgmt_users_active", MgmtUser.is_active)
Index("idx_mgmt_audit_event", MgmtAuditLog.event_type)
