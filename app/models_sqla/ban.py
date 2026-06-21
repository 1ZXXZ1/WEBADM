"""Ban records for mgmt users and API keys.

Mirrors ``mgmt_bans`` from ``app/ban_db.py``.
"""

from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    Index,
    Integer,
    Text,
)

from app.models_sqla.base import Base


class MgmtBan(Base):
    """A ban applied to a mgmt user or API key.

    The unique partial index ``(target_type, target_name) WHERE is_active``
    prevents two active bans on the same target. SQLAlchemy emulates
    partial indexes via ``sqlite_where`` / ``postgresql_where`` — we use
    the generic ``Index`` form which works on both backends.
    """

    __tablename__ = "mgmt_bans"

    id = Column(Integer, primary_key=True, autoincrement=True)
    target_type = Column(Text, nullable=False)   # 'user' | 'key'
    target_name = Column(Text, nullable=False)
    target_id = Column(Integer, nullable=True)
    reason = Column(Text, default="")
    banned_by = Column(Text, default="")
    banned_by_ip = Column(Text, default="")
    created_at = Column(Text, nullable=False)
    expires_at = Column(Text, nullable=True)     # NULL = permanent
    lifted_at = Column(Text, nullable=True)
    lifted_by = Column(Text, nullable=True)
    lifted_reason = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)


Index(
    "uq_mgmt_bans_active",
    MgmtBan.target_type,
    MgmtBan.target_name,
    sqlite_where=MgmtBan.is_active.is_(True),
    postgresql_where=MgmtBan.is_active.is_(True),
    unique=True,
)
Index("idx_mgmt_bans_target", MgmtBan.target_type, MgmtBan.target_name)
Index("idx_mgmt_bans_active", MgmtBan.is_active, MgmtBan.expires_at)
Index("idx_mgmt_bans_created", MgmtBan.created_at)
