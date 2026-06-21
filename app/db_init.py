"""
DB initialization + seeding for the SQLAlchemy layer.

Called from ``app.db_sqlalchemy.init_db(seed=True)`` after
``Base.metadata.create_all``. The seed step is idempotent — running
it on an already-seeded database is a no-op.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Set

from sqlalchemy import select

from app.db_sqlalchemy import session_scope
from app.models_sqla.base import now_iso
from app.models_sqla.mgmt import MgmtRole, MgmtUser

logger = logging.getLogger(__name__)


def _hash_password(plain: str) -> str:
    """Bcrypt-hash a plaintext password (lazy import — bcrypt is heavy)."""
    import bcrypt
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _default_role_permissions() -> Dict[str, Set[str]]:
    """Return the built-in role → permission-set mapping.

    Falls back to a minimal hardcoded set if ``app.permissions`` cannot
    be imported (keeps the seed step resilient during early bootstrap).
    """
    try:
        from app.permissions import DEFAULT_ROLE_PERMISSIONS
        return {k: set(v) for k, v in DEFAULT_ROLE_PERMISSIONS.items()}
    except Exception:  # noqa: BLE001
        return {
            "admin": set(),
            "operator": set(),
            "auditor": set(),
        }


def seed_defaults() -> Dict[str, Any]:
    """Seed default admin user and built-in roles.

    Returns a small report dict ``{"created_user": bool, "roles": int}``.
    """
    report: Dict[str, Any] = {"created_user": False, "roles_synced": 0, "roles_created": 0}

    with session_scope() as db:
        # ── 1. Default admin user (admin / admin) ──────────────────────
        existing = db.execute(
            select(MgmtUser).where(MgmtUser.username == "admin")
        ).scalar_one_or_none()

        if existing is None:
            admin = MgmtUser(
                username="admin",
                password_hash=_hash_password("admin"),
                full_name="Default Administrator",
                email="",
                role="admin",
                is_active=True,
                weight=0,
                login_count=0,
                totp_secret="",
                created_at=now_iso(),
                updated_at=now_iso(),
            )
            db.add(admin)
            db.flush()
            report["created_user"] = True
            logger.warning(
                "[db_init] Created default admin user (username=admin, password=admin) — "
                "CHANGE THE PASSWORD IMMEDIATELY via /api/v1/users/me/password."
            )
        else:
            logger.debug("[db_init] admin user already exists — skipping.")

        # ── 2. Built-in roles ───────────────────────────────────────────
        role_perms = _default_role_permissions()
        for rname, perms in role_perms.items():
            role = db.execute(
                select(MgmtRole).where(MgmtRole.name == rname)
            ).scalar_one_or_none()

            perms_json = json.dumps(sorted(perms), ensure_ascii=False)
            now = now_iso()

            if role is None:
                db.add(MgmtRole(
                    name=rname,
                    description=f"Built-in {rname} role",
                    permissions=perms_json,
                    is_builtin=True,
                    is_active=True,
                    weight=0,
                    created_at=now,
                    updated_at=now,
                ))
                report["roles_created"] += 1
            elif role.is_builtin:
                # Refresh permissions on built-in roles (idempotent sync)
                if role.permissions != perms_json:
                    role.permissions = perms_json
                    role.updated_at = now
                    report["roles_synced"] += 1
            # Non-builtin roles with the same name are left untouched.

    logger.info(
        "[db_init] seed complete: created_user=%s, roles_created=%d, roles_synced=%d",
        report["created_user"], report["roles_created"], report["roles_synced"],
    )
    return report
