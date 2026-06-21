"""Test: simulate schema drift — source has extra columns + tables that target doesn't have."""
import os
import sys
sys.path.insert(0, "/home/z/my-project")

# Setup: create source DB with EXTRA column 'totp_enabled' and EXTRA table 'audit_log'
from sqlalchemy import create_engine, text
from app.db_sqlalchemy import Base
import app.models_sqla  # noqa

# 1. Fresh source DB
os.system("rm -f /tmp/src_test.db /tmp/dst_test.db")

src_engine = create_engine("sqlite:////tmp/src_test.db", future=True)
# Create the source DB with a RELAXED schema — totp_secret nullable.
# This simulates a legacy PostgreSQL where the column was added later
# without NOT NULL.
from sqlalchemy import Column, Integer, Text, Boolean, MetaData, Table
src_metadata = MetaData()
src_users = Table("mgmt_users", src_metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("username", Text, nullable=False, unique=True),
    Column("password_hash", Text, nullable=False),
    Column("full_name", Text, default=""),
    Column("email", Text, default=""),
    Column("role", Text, nullable=False, default="operator"),
    Column("is_active", Boolean, default=True),
    Column("weight", Integer, default=0),
    Column("last_login_at", Text, nullable=True),
    Column("login_count", Integer, default=0),
    Column("totp_secret", Text, nullable=True),  # ← nullable in source!
    Column("created_at", Text),
    Column("updated_at", Text),
)
src_metadata.create_all(bind=src_engine)

# 2. Add extra column + extra table to source (simulating legacy PG)
with src_engine.begin() as conn:
    # Add totp_enabled to mgmt_users (extra column)
    conn.execute(text("ALTER TABLE mgmt_users ADD COLUMN totp_enabled BOOLEAN DEFAULT 0"))
    # Add a 'secret_note' column too (another extra)
    conn.execute(text("ALTER TABLE mgmt_users ADD COLUMN secret_note TEXT"))
    # Insert a user with the extra columns
    conn.execute(text("""
        INSERT INTO mgmt_users (username, password_hash, full_name, email, role, is_active, weight,
                                login_count, totp_secret, created_at, updated_at, totp_enabled, secret_note)
        VALUES ('testuser', '$2b$12$abc', 'Test User', '', 'admin', 1, 0,
                0, '', '2026-06-21T00:00:00+00:00', '2026-06-21T00:00:00+00:00', 1, 'my secret')
    """))
    # Insert admin too
    conn.execute(text("""
        INSERT INTO mgmt_users (username, password_hash, full_name, email, role, is_active, weight,
                                login_count, totp_secret, created_at, updated_at, totp_enabled, secret_note)
        VALUES ('admin', '$2b$12$xyz', 'Admin', '', 'admin', 1, 0,
                0, '', '2026-06-21T00:00:00+00:00', '2026-06-21T00:00:00+00:00', 0, NULL)
    """))
    # Insert user with NULL totp_secret (this is what breaks transfer!
    # Source allows NULL, target declares NOT NULL.)
    conn.execute(text("""
        INSERT INTO mgmt_users (username, password_hash, full_name, email, role, is_active, weight,
                                login_count, totp_secret, created_at, updated_at, totp_enabled, secret_note)
        VALUES ('nulluser', '$2b$12$null', 'Null User', '', 'admin', 1, 0,
                0, NULL, '2026-06-21T00:00:00+00:00', '2026-06-21T00:00:00+00:00', 0, NULL)
    """))
    # Insert a role (need to create mgmt_roles first)
    conn.execute(text("""
        CREATE TABLE mgmt_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT DEFAULT '',
            permissions TEXT DEFAULT '[]',
            is_builtin BOOLEAN DEFAULT 0,
            is_active BOOLEAN DEFAULT 1,
            weight INTEGER DEFAULT 0,
            created_at TEXT,
            updated_at TEXT
        )
    """))
    conn.execute(text("""
        INSERT INTO mgmt_roles (name, description, permissions, is_builtin, is_active,
                                weight, created_at, updated_at)
        VALUES ('admin', 'Admin role', '[]', 1, 1, 0,
                '2026-06-21T00:00:00+00:00', '2026-06-21T00:00:00+00:00')
    """))
    # Create extra table 'audit_log' (not in our models)
    conn.execute(text("""
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY,
            user_id INTEGER,
            action TEXT,
            ip TEXT,
            ts TEXT
        )
    """))
    conn.execute(text("""
        INSERT INTO audit_log (id, user_id, action, ip, ts)
        VALUES (1, 1, 'login', '127.0.0.1', '2026-06-21T00:00:00+00:00')
    """))
    # Create extra table 'projects' (not in our models)
    conn.execute(text("""
        CREATE TABLE projects (
            id INTEGER PRIMARY KEY,
            name TEXT,
            owner TEXT,
            created TEXT
        )
    """))
    conn.execute(text("""
        INSERT INTO projects (id, name, owner, created)
        VALUES (1, 'test-project', 'admin', '2026-06-21T00:00:00+00:00')
    """))

src_engine.dispose()

print("=== Source DB prepared with:")
print("  - mgmt_users with EXTRA columns: totp_enabled, secret_note")
print("  - mgmt_roles (1 row)")
print("  - audit_log (EXTRA table, 1 row)")
print("  - projects (EXTRA table, 1 row)")
print()

# 3. Now do the transfer — should auto-sync schema + copy all tables
print("=== Running transfer ===")
from app.db_serialize import transfer_db
report = transfer_db(
    from_url="sqlite:////tmp/src_test.db",
    to_url="sqlite:////tmp/dst_test.db",
)
print()
print("=== Report ===")
print(f"Copied: {report['copied']} rows")
print(f"Tables:")
for t, n in report["tables"].items():
    print(f"  {t:40s} {n}")
print(f"Schema sync:")
for k, v in report["schema_sync"].items():
    print(f"  {k}: {v}")

# 4. Verify target
print()
print("=== Verify target DB ===")
dst_engine = create_engine("sqlite:////tmp/dst_test.db", future=True)
with dst_engine.connect() as conn:
    # Check mgmt_users — should have totp_enabled + secret_note
    cols = [r[1] for r in conn.execute(text("PRAGMA table_info(mgmt_users)"))]
    print(f"mgmt_users columns: {cols}")
    assert "totp_enabled" in cols, "totp_enabled not added!"
    assert "secret_note" in cols, "secret_note not added!"
    # Check data — nulluser should have totp_secret = '' (coerced from NULL)
    rows = conn.execute(text("SELECT username, totp_secret, secret_note FROM mgmt_users ORDER BY username")).fetchall()
    print(f"mgmt_users data: {rows}")
    for username, totp, note in rows:
        if username == "nulluser":
            assert totp == "", f"nulluser.totp_secret should be '' (coerced from NULL), got {totp!r}"
            print(f"  ✓ nulluser: NULL totp_secret coerced to '' (NOT NULL constraint)")
    # Check audit_log
    rows = conn.execute(text("SELECT * FROM audit_log")).fetchall()
    print(f"audit_log data: {rows}")
    # Check projects
    rows = conn.execute(text("SELECT * FROM projects")).fetchall()
    print(f"projects data: {rows}")
dst_engine.dispose()

print()
print("All tests passed — schema drift handled correctly!")
